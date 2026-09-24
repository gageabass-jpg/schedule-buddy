import { useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import { personColor } from "../theme";
import type { HouseholdState } from "../state";
import { compactTime } from "../state";
import {
  SCHEDULE_IMPORTS,
  findScheduleImport,
  type ImportTarget,
} from "../scheduleImports";
import { writeScheduleImport, type ImportRow } from "../lib/writeScheduleImport";
import { MONTHS_LONG, WEEKDAYS_3 } from "../data";
import type { ParsedShiftRow } from "../global";
import { BRAND_TEAL, BRAND_FONT } from "./BrandMark";

const CLAY = "#8A4B38";
const TEAL_TINT = "#D8E7E4";
const CLAY_TINT = "#EFDFDB";
const SKIP_STRIKE = "#A9B3B0";

interface Props {
  scheduleId: string | null;
  onClose: () => void;
  onNeedApiKey: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
  /** "YYYY-MM-DD" — today's local date. */
  today: string;
  /** "YYYY-MM" — the month the user currently has open in the calendar. */
  contextMonth: string;
}

type Phase =
  | { kind: "upload" }
  | { kind: "parsing" }
  | { kind: "review"; rows: EditableRow[]; monthCovered?: string }
  | { kind: "saving" }
  | { kind: "saved"; count: number };

interface EditableRow extends ParsedShiftRow {
  /** Local row id for React keys + skip-toggle. */
  rid: string;
  /** If true, user has skipped this row — won't write. */
  skipped: boolean;
}

/** Person whose colour rule the cards carry, from the import target. */
function whoFor(target: ImportTarget): "G" | "K" | "D" {
  return target === "self-ot" ? "G" : target === "partner" ? "K" : "D";
}

export function ScheduleImportModal({
  scheduleId, onClose, onNeedApiKey, palette, t, dark, householdId, state,
  today, contextMonth,
}: Props) {
  // The modal opens on one person's row but carries the prototype's person
  // tabs; switching a tab re-targets the import to that person.
  const [activeId, setActiveId] = useState<string | null>(scheduleId);
  const def = activeId ? findScheduleImport(activeId) : undefined;
  const [phase, setPhase] = useState<Phase>({ kind: "upload" });
  const [image, setImage] = useState<{ dataUrl: string; base64: string; mediaType: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean>(false);

  // Reset whenever the modal is (re)opened on a different schedule.
  useEffect(() => {
    if (!scheduleId) return;
    setActiveId(scheduleId);
    setPhase({ kind: "upload" });
    setImage(null);
    setErr(null);
    window.sbm?.hasApiKey().then(setHasKey).catch(() => setHasKey(false));
  }, [scheduleId]);

  if (!scheduleId || !def) return null;

  // Switch the active person tab — a fresh upload for that person.
  const onPickPerson = (id: string) => {
    if (id === activeId) return;
    setActiveId(id);
    setPhase({ kind: "upload" });
    setImage(null);
    setErr(null);
  };

  const onPickFile = async (file: File) => {
    setErr(null);
    try {
      // Always re-encode through canvas so we (a) normalize HEIC/BMP/etc. to
      // JPEG and (b) downscale + recompress until we're under Anthropic's
      // 5 MB image limit.
      const { bytes, mediaType } = await normalizeImage(file);
      const u8 = new Uint8Array(bytes);
      let binary = "";
      for (let i = 0; i < u8.byteLength; i++) binary += String.fromCharCode(u8[i]);
      const base64 = btoa(binary);
      setImage({
        dataUrl: `data:${mediaType};base64,${base64}`,
        base64,
        mediaType,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't process this image.";
      const decodeFail = /decode|format/i.test(msg);
      setErr(
        decodeFail
          ? `Couldn't read this image (${file.type || "unknown format"}). In Photos, right-click → Export → Export 1 Photo → JPEG, then drop the exported file here.`
          : msg,
      );
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      void onPickFile(file);
    } else {
      setErr("Drop an image file.");
    }
  };

  const onParse = async () => {
    if (!image) return;
    if (!window.sbm) {
      setErr("Vision parsing only works inside the Nucleus Manager app.");
      return;
    }
    if (!hasKey) {
      onNeedApiKey();
      return;
    }
    setErr(null);
    setPhase({ kind: "parsing" });
    const result = await window.sbm.parseSchedule({
      imageBase64: image.base64,
      imageMediaType: image.mediaType,
      scheduleHint: def.parserHint,
      personLabel: def.personLabel,
      shiftTypes: (state?.shiftTypes ?? []).map((s) => ({ id: s.id, name: s.name, start: s.start, end: s.end })),
      today,
      contextMonth,
    });
    if (!result.ok || !result.rows) {
      setErr(result.error || "Parsing failed.");
      setPhase({ kind: "upload" });
      return;
    }
    // Force any shiftTypeId Claude returned that doesn't match the current
    // catalog back to null so the user is prompted to map it before save.
    const validIds = new Set((state?.shiftTypes ?? []).map((s) => s.id));
    const editable: EditableRow[] = result.rows.map((r, i) => ({
      ...r,
      shiftTypeId: r.shiftTypeId && validIds.has(r.shiftTypeId) ? r.shiftTypeId : null,
      rid: `r${i}`,
      skipped: false,
    }));
    setPhase({ kind: "review", rows: editable, monthCovered: result.monthCovered });
  };

  const onSave = async () => {
    if (phase.kind !== "review") return;
    if (!householdId) {
      setErr("No household linked.");
      return;
    }
    const validIds = new Set((state?.shiftTypes ?? []).map((s) => s.id));
    const rows: ImportRow[] = phase.rows
      .filter((r) => !r.skipped && r.shiftTypeId && validIds.has(r.shiftTypeId))
      .map((r) => ({ date: r.date, shiftTypeId: r.shiftTypeId as string, label: r.label }));
    if (rows.length === 0) {
      setErr("Nothing to add — every day is skipped or still needs a shift type.");
      return;
    }
    setErr(null);
    setPhase({ kind: "saving" });
    try {
      await writeScheduleImport({
        householdId,
        scheduleId: def.id,
        target: def.target,
        rows,
        monthCovered: phase.monthCovered,
      });
      setPhase({ kind: "saved", count: rows.length });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the import.");
      setPhase({ kind: "review", rows: phase.rows, monthCovered: phase.monthCovered });
    }
  };

  const updateRow = (rid: string, patch: Partial<EditableRow>) => {
    setPhase((p) => {
      if (p.kind !== "review") return p;
      return { ...p, rows: p.rows.map((r) => (r.rid === rid ? { ...r, ...patch } : r)) };
    });
  };

  const shiftTypes = state?.shiftTypes ?? [];
  const who = whoFor(def.target);

  // Footer count — days that will actually be written.
  const validIds = new Set(shiftTypes.map((s) => s.id));
  const addCount =
    phase.kind === "review"
      ? phase.rows.filter((r) => !r.skipped && r.shiftTypeId && validIds.has(r.shiftTypeId)).length
      : 0;

  const showTabs = phase.kind !== "saved";

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1100 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Read from a photo"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(560px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 64px)",
          background: t.bgElev,
          color: t.text,
          border: `1px solid ${t.sep}`,
          borderRadius: 12,
          boxShadow: dark ? "0 24px 64px rgba(0,0,0,0.6)" : "0 24px 64px rgba(20,32,30,0.28)",
          zIndex: 1101,
          fontFamily: "inherit",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 16px 12px" }}>
          <span style={{ fontFamily: BRAND_FONT, fontWeight: 600, fontSize: 16, letterSpacing: "-0.01em", color: t.text }}>
            Read from a photo
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 30, height: 30, flexShrink: 0, padding: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              border: `1px solid ${t.sep}`, borderRadius: 4, background: t.bgElev, color: t.text, cursor: "pointer",
            }}
          >
            <XIcon />
          </button>
        </div>

        {/* Person tabs + review heading */}
        {showTabs && (
          <div style={{ flexShrink: 0, padding: "0 16px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", border: `1px solid ${t.sep}`, borderRadius: 6, overflow: "hidden", background: t.bgElev }}>
              {SCHEDULE_IMPORTS.map((s, i) => {
                const on = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onPickPerson(s.id)}
                    style={{
                      flexGrow: 1, flexBasis: 0, minWidth: 0, height: 40,
                      border: 0, borderLeft: i === 0 ? 0 : `1px solid ${t.sep}`,
                      background: on ? TEAL_TINT : t.bgElev,
                      color: on ? BRAND_TEAL : t.text2,
                      fontFamily: "inherit", fontSize: 13, fontWeight: on ? 600 : 500,
                      cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {s.personLabel}
                  </button>
                );
              })}
            </div>

            {phase.kind === "review" && <ReviewHeading rows={phase.rows} shiftTypes={shiftTypes} t={t} />}
          </div>
        )}

        {/* Body */}
        {phase.kind === "upload" && (
          <UploadPhase
            t={t} dark={dark} palette={palette} who={who} def={def}
            image={image} hasKey={hasKey}
            onDrop={onDrop} onPickFile={onPickFile} onClear={() => setImage(null)}
            onNeedApiKey={onNeedApiKey}
          />
        )}

        {phase.kind === "parsing" && (
          <div style={{ padding: "48px 16px", textAlign: "center", color: t.text2, fontSize: 13 }}>
            Reading {def.personLabel}'s schedule…
          </div>
        )}

        {phase.kind === "review" && (
          <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "0 16px 4px", display: "flex", flexDirection: "column", gap: 9 }}>
            {phase.rows.map((r) => (
              <DayCard
                key={r.rid}
                row={r}
                who={who}
                palette={palette}
                shiftTypes={shiftTypes}
                t={t}
                onUpdate={updateRow}
              />
            ))}
            {phase.rows.length === 0 && (
              <div style={{ padding: "28px 8px", textAlign: "center", color: t.text3, fontSize: 13 }}>
                No days found. The photo may not show a recognizable schedule.
              </div>
            )}
          </div>
        )}

        {phase.kind === "saving" && (
          <div style={{ padding: "48px 16px", textAlign: "center", color: t.text2, fontSize: 13 }}>
            Adding to the schedule…
          </div>
        )}

        {phase.kind === "saved" && (
          <div style={{ padding: "32px 24px", textAlign: "center" }}>
            <div style={{ fontFamily: BRAND_FONT, fontSize: 17, fontWeight: 600, color: t.text }}>
              Added {phase.count} day{phase.count === 1 ? "" : "s"}.
            </div>
            <div style={{ fontSize: 12.5, color: t.text2, marginTop: 6, lineHeight: 1.45 }}>
              They're on the schedule now and synced to iOS.
            </div>
          </div>
        )}

        {err && (
          <div style={{ flexShrink: 0, padding: "0 16px", fontSize: 12, color: CLAY, lineHeight: 1.45 }}>{err}</div>
        )}

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: "12px 16px 16px", borderTop: `1px solid ${t.sep}`, display: "flex", flexDirection: "column", gap: 9 }}>
          {phase.kind === "upload" && (
            <button
              type="button"
              onClick={onParse}
              disabled={!image || !hasKey}
              style={footerBtn(!image || !hasKey)}
            >
              {hasKey ? "Read the schedule" : "Add an API key first"}
            </button>
          )}
          {phase.kind === "review" && (
            <>
              <button type="button" onClick={onSave} disabled={addCount === 0} style={footerBtn(addCount === 0)}>
                Add {addCount} to schedule
              </button>
              <span style={{ textAlign: "center", fontSize: 11, color: t.text3 }}>
                Nothing is written until you tap this.
              </span>
            </>
          )}
          {phase.kind === "saved" && (
            <button type="button" onClick={onClose} style={footerBtn(false)}>Done</button>
          )}
          {(phase.kind === "parsing" || phase.kind === "saving") && (
            <button type="button" onClick={onClose} style={secondaryBtn(t)}>Cancel</button>
          )}
        </div>
      </div>
    </>
  );
}

// ── Review heading ("Found N days · M need a look") ──────────────────────────

function ReviewHeading({
  rows, shiftTypes, t,
}: {
  rows: EditableRow[];
  shiftTypes: Array<{ id: string }>;
  t: ThemeTokens;
}) {
  const validIds = new Set(shiftTypes.map((s) => s.id));
  const needLook = rows.filter(
    (r) => !r.skipped && (!(r.shiftTypeId && validIds.has(r.shiftTypeId)) || r.confidence < 0.5),
  ).length;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontFamily: BRAND_FONT, fontWeight: 600, fontSize: 17, color: t.text }}>
        Found {rows.length} day{rows.length === 1 ? "" : "s"}
      </span>
      {needLook > 0 && (
        <span style={{ fontSize: 13, color: CLAY }}>{needLook} need a look</span>
      )}
    </div>
  );
}

// ── One reviewed day ─────────────────────────────────────────────────────────

function DayCard({
  row, who, palette, shiftTypes, t, onUpdate,
}: {
  row: EditableRow;
  who: "G" | "K" | "D";
  palette: Palette;
  shiftTypes: Array<{ id: string; name: string; start: string; end: string }>;
  t: ThemeTokens;
  onUpdate: (rid: string, patch: Partial<EditableRow>) => void;
}) {
  const [y, m, d] = row.date.split("-").map(Number);
  const dow = Number.isFinite(y) ? new Date(y, m - 1, d).getDay() : 0;
  const month3 = (MONTHS_LONG[m - 1] ?? "").slice(0, 3).toUpperCase();
  const wd = (WEEKDAYS_3[dow] ?? "").toUpperCase();

  const stype = row.shiftTypeId ? shiftTypes.find((s) => s.id === row.shiftTypeId) : undefined;
  const mapped = !!stype;
  const skipped = row.skipped;
  const rule = skipped ? t.text3 : personColor(who, palette);

  // A row wants attention if it has no shift type yet, or Nucleus was unsure.
  const needLook = !skipped && (!mapped || row.confidence < 0.5);
  const note = skipped
    ? "Won't be added."
    : !mapped
      ? "Pick a shift type."
      : row.confidence < 0.5
        ? "Low confidence — worth a check."
        : null;
  const noteColor = !skipped && !mapped ? CLAY : t.text2;

  return (
    <div
      style={{
        border: `1px solid ${needLook ? CLAY : t.sep}`,
        borderRadius: 8,
        background: skipped ? t.bg : t.bgElev,
        overflow: "hidden",
        opacity: skipped ? 0.85 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px" }}>
        <span style={{ width: 3, alignSelf: "stretch", minHeight: 34, borderRadius: 2, flexShrink: 0, background: rule }} />
        <span style={{ width: 40, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: t.text2 }}>{month3}</span>
          <span style={{ fontFamily: BRAND_FONT, fontWeight: 600, fontSize: 22, lineHeight: 1.05, color: skipped ? t.text3 : t.text }}>
            {Number.isFinite(d) ? d : "—"}
          </span>
          <span style={{ fontSize: 9, letterSpacing: "0.08em", color: t.text2 }}>{wd}</span>
        </span>

        {mapped && !skipped ? (
          <span style={{ flexGrow: 1, minWidth: 0, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 15, color: t.text }}>
            {compactTime(stype!.start)}
            <span style={{ color: t.text2 }}>→</span>
            {compactTime(stype!.end)}
          </span>
        ) : skipped ? (
          <span style={{ flexGrow: 1, minWidth: 0, fontSize: 15, textDecoration: "line-through", color: SKIP_STRIKE }}>
            {mapped ? `${compactTime(stype!.start)} → ${compactTime(stype!.end)}` : (row.label || "—")}
          </span>
        ) : (
          <select
            value={row.shiftTypeId ?? ""}
            onChange={(e) => onUpdate(row.rid, { shiftTypeId: e.target.value || null })}
            style={{
              flexGrow: 1, minWidth: 0, height: 34, padding: "0 8px",
              border: `1px solid ${t.sep}`, borderRadius: 6, background: t.bg, color: t.text,
              fontFamily: "inherit", fontSize: 13, cursor: "pointer",
              colorScheme: t.bg === "#000" ? "dark" : "light",
            }}
          >
            <option value="">{row.label ? `${row.label} — pick a type` : "Pick a shift type"}</option>
            {shiftTypes.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({compactTime(s.start)})</option>
            ))}
          </select>
        )}

        <button
          type="button"
          aria-label="Keep this day"
          onClick={() => onUpdate(row.rid, { skipped: false })}
          style={{
            width: 40, height: 40, flexShrink: 0, borderRadius: 6, cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            border: skipped ? `1px solid ${t.sep}` : `1px solid ${BRAND_TEAL}`,
            background: skipped ? t.bgElev : BRAND_TEAL,
          }}
        >
          <CheckIcon color={skipped ? t.text3 : "#FFFFFF"} />
        </button>
        <button
          type="button"
          aria-label="Drop this day"
          onClick={() => onUpdate(row.rid, { skipped: true })}
          style={{
            width: 40, height: 40, flexShrink: 0, borderRadius: 6, cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            border: `1px solid ${CLAY}`,
            background: skipped ? CLAY_TINT : "transparent",
          }}
        >
          <TrashIcon color={CLAY} />
        </button>
      </div>

      {note && (
        <div style={{ padding: "0 12px 10px 27px", fontSize: 11, lineHeight: 1.45, color: noteColor }}>
          {note}
        </div>
      )}
    </div>
  );
}

// ── Upload phase ─────────────────────────────────────────────────────────────

function UploadPhase({
  t, dark, palette, who, def, image, hasKey, onDrop, onPickFile, onClear, onNeedApiKey,
}: {
  t: ThemeTokens;
  dark: boolean;
  palette: Palette;
  who: "G" | "K" | "D";
  def: { personLabel: string };
  image: { dataUrl: string } | null;
  hasKey: boolean;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPickFile: (f: File) => void;
  onClear: () => void;
  onNeedApiKey: () => void;
}) {
  return (
    <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "0 16px 4px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12.5, color: t.text2, lineHeight: 1.45 }}>
        Drop a photo of {def.personLabel}'s schedule. Nucleus reads it, you review, then add it.
      </div>
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{
          minHeight: 200,
          border: `1px dashed ${t.sep}`,
          borderRadius: 8,
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)",
        }}
      >
        {image ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <img src={image.dataUrl} alt="" style={{ maxWidth: 360, maxHeight: 240, borderRadius: 8, border: `1px solid ${t.sep}` }} />
            <button type="button" onClick={onClear} style={linkBtn(t.text2)}>Choose a different photo</button>
          </div>
        ) : (
          <div style={{ textAlign: "center", color: t.text2 }}>
            <span style={{ width: 3, height: 26, borderRadius: 2, background: personColor(who, palette), display: "inline-block", marginBottom: 8 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Drop a schedule photo here</div>
            <div style={{ fontSize: 11.5, marginTop: 4 }}>or</div>
            <label
              style={{
                display: "inline-block", marginTop: 8, padding: "7px 14px", borderRadius: 6,
                border: `1px solid ${t.sep}`, background: t.bgElev, color: t.text,
                fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              }}
            >
              Browse files
              <input
                type="file"
                accept="image/*"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); }}
                style={{ display: "none" }}
              />
            </label>
          </div>
        )}
      </div>
      {!hasKey && (
        <button type="button" onClick={onNeedApiKey} style={{ ...linkBtn(BRAND_TEAL), alignSelf: "flex-start" }}>
          Add an API key to read photos →
        </button>
      )}
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function XIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
function CheckIcon({ color }: { color: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l5 5 9-11" />
    </svg>
  );
}
function TrashIcon({ color }: { color: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

function footerBtn(disabled: boolean): React.CSSProperties {
  return {
    width: "100%", height: 46, boxSizing: "border-box",
    borderRadius: 8, border: "none", background: BRAND_TEAL, color: "#FFFFFF",
    fontFamily: BRAND_FONT, fontWeight: 600, fontSize: 15,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
  };
}

function secondaryBtn(t: ThemeTokens): React.CSSProperties {
  return {
    width: "100%", height: 46, boxSizing: "border-box",
    borderRadius: 8, border: `1px solid ${t.sep}`, background: t.bgElev, color: t.text,
    fontFamily: BRAND_FONT, fontWeight: 600, fontSize: 14, cursor: "pointer",
  };
}

function linkBtn(color: string): React.CSSProperties {
  return {
    background: "transparent", border: 0, color, fontSize: 12.5, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit", padding: 0,
  };
}

/**
 * Decode an arbitrary image file via the browser and re-encode as a JPEG
 * that fits under Anthropic's 5 MB image limit. Iterates max-edge then
 * quality, falling back to ever-smaller dimensions until under budget.
 *
 * Throws if the browser can't decode the source (e.g. HEIC in Chromium).
 */
async function normalizeImage(file: File): Promise<{ bytes: ArrayBuffer; mediaType: string }> {
  // Stay well under 5 MB even after base64 inflation (~33%). 3.5 MB raw
  // ≈ 4.66 MB base64 — comfortable.
  const TARGET_BYTES = 3.5 * 1024 * 1024;

  const dataUrl = await readDataUrl(file);
  const img = await decodeImage(dataUrl);

  const longest = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const edges = [2048, 1600, 1280, 1024, 768];
  const qualities = [0.9, 0.82, 0.72, 0.6];

  for (const maxEdge of edges) {
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const w = Math.round((img.naturalWidth || img.width) * scale);
    const h = Math.round((img.naturalHeight || img.height) * scale);
    for (const q of qualities) {
      const blob = await encodeJpeg(img, w, h, q);
      if (blob.size <= TARGET_BYTES) {
        return { bytes: await blob.arrayBuffer(), mediaType: "image/jpeg" };
      }
    }
  }

  // Pathological — extreme resolution + non-photographic content. Last-resort
  // hard compress at the smallest tier.
  const blob = await encodeJpeg(img, 768, 768, 0.5);
  return { bytes: await blob.arrayBuffer(), mediaType: "image/jpeg" };
}

async function encodeJpeg(img: HTMLImageElement, w: number, h: number, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Couldn't re-encode as JPEG."))),
      "image/jpeg",
      quality,
    );
  });
}

async function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read the file."));
    r.readAsDataURL(file);
  });
}

async function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Couldn't decode this image format."));
    i.src = dataUrl;
  });
}
