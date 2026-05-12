import { useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState } from "../state";
import { compactTime } from "../state";
import { findScheduleImport } from "../scheduleImports";
import { writeScheduleImport, type ImportRow } from "../lib/writeScheduleImport";
import type { ParsedShiftRow } from "../global";

interface Props {
  scheduleId: string | null;
  onClose: () => void;
  onNeedApiKey: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
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

export function ScheduleImportModal({
  scheduleId, onClose, onNeedApiKey, palette, t, dark, householdId, state,
}: Props) {
  const def = scheduleId ? findScheduleImport(scheduleId) : undefined;
  const [phase, setPhase] = useState<Phase>({ kind: "upload" });
  const [image, setImage] = useState<{ dataUrl: string; base64: string; mediaType: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean>(false);

  // Reset whenever a different schedule is opened.
  useEffect(() => {
    if (!scheduleId) return;
    setPhase({ kind: "upload" });
    setImage(null);
    setErr(null);
    window.sbm?.hasApiKey().then(setHasKey).catch(() => setHasKey(false));
  }, [scheduleId]);

  if (!scheduleId || !def) return null;

  const onPickFile = async (file: File) => {
    setErr(null);
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    setImage({
      dataUrl: `data:${file.type};base64,${base64}`,
      base64,
      mediaType: file.type || "image/jpeg",
    });
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
      setErr("Vision parsing only works inside the Schedule Buddy Manager app.");
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
    });
    if (!result.ok || !result.rows) {
      setErr(result.error || "Parsing failed.");
      setPhase({ kind: "upload" });
      return;
    }
    const editable: EditableRow[] = result.rows.map((r, i) => ({
      ...r,
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
    const rows: ImportRow[] = phase.rows
      .filter((r) => !r.skipped && r.shiftTypeId)
      .map((r) => ({ date: r.date, shiftTypeId: r.shiftTypeId as string, label: r.label }));
    if (rows.length === 0) {
      setErr("Nothing to save — every row is skipped or missing a shift type.");
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

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Import ${def.label}`}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(720px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 64px)",
          background: t.bgElev,
          color: t.text,
          borderRadius: 16,
          padding: "20px 22px 16px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
          zIndex: 1101,
          fontFamily: "inherit",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>{def.label}</div>
            <div style={{ fontSize: 12, color: t.text2, marginTop: 4, lineHeight: 1.45 }}>
              Drop a photo of {def.personLabel}'s schedule. Claude reads it, you review, then save.
            </div>
          </div>
          {!hasKey && phase.kind === "upload" && (
            <button type="button" onClick={onNeedApiKey} style={linkBtn(palette.G)}>
              Add API key →
            </button>
          )}
        </div>

        {phase.kind === "upload" && (
          <UploadPhase
            t={t}
            dark={dark}
            palette={palette}
            image={image}
            hasKey={hasKey}
            onDrop={onDrop}
            onPickFile={onPickFile}
            onParse={onParse}
            onClear={() => setImage(null)}
          />
        )}

        {phase.kind === "parsing" && (
          <div style={{ padding: 40, textAlign: "center", color: t.text2, fontSize: 13 }}>
            Asking Claude to read the schedule…
          </div>
        )}

        {phase.kind === "review" && (
          <ReviewPhase
            t={t}
            dark={dark}
            rows={phase.rows}
            monthCovered={phase.monthCovered}
            shiftTypes={shiftTypes}
            onUpdate={updateRow}
          />
        )}

        {phase.kind === "saving" && (
          <div style={{ padding: 40, textAlign: "center", color: t.text2, fontSize: 13 }}>
            Saving to the household schedule…
          </div>
        )}

        {phase.kind === "saved" && (
          <div style={{ padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>
              Imported {phase.count} shift{phase.count === 1 ? "" : "s"}.
            </div>
            <div style={{ fontSize: 12, color: t.text2, marginTop: 6 }}>
              They're live on the schedule now and synced to iOS.
            </div>
          </div>
        )}

        {err && <div style={{ fontSize: 12, color: "#FF453A" }}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {phase.kind === "review" && (
            <button type="button" onClick={onSave} style={primaryBtn(palette.G, false)}>
              Save to schedule
            </button>
          )}
          <button type="button" onClick={onClose} style={secondaryBtn(t)}>
            {phase.kind === "saved" ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </>
  );
}

function UploadPhase({
  t, dark, palette, image, hasKey, onDrop, onPickFile, onParse, onClear,
}: {
  t: ThemeTokens;
  dark: boolean;
  palette: Palette;
  image: { dataUrl: string } | null;
  hasKey: boolean;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPickFile: (f: File) => void;
  onParse: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{
          flex: 1,
          minHeight: 220,
          border: `1px dashed ${t.sep}`,
          borderRadius: 12,
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
        }}
      >
        {image ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <img src={image.dataUrl} alt="" style={{ maxWidth: 360, maxHeight: 240, borderRadius: 8 }} />
            <button type="button" onClick={onClear} style={linkBtn(t.text2)}>Clear photo</button>
          </div>
        ) : (
          <div style={{ textAlign: "center", color: t.text2 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Drop a schedule photo here</div>
            <div style={{ fontSize: 11.5, marginTop: 4 }}>or</div>
            <label
              style={{
                display: "inline-block",
                marginTop: 6,
                padding: "6px 12px",
                borderRadius: 6,
                border: `0.5px solid ${t.sep}`,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Browse files
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickFile(f);
                }}
                style={{ display: "none" }}
              />
            </label>
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onParse}
          disabled={!image || !hasKey}
          style={primaryBtn(palette.G, !image || !hasKey)}
        >
          Parse with Claude
        </button>
      </div>
    </>
  );
}

function ReviewPhase({
  t, dark, rows, monthCovered, shiftTypes, onUpdate,
}: {
  t: ThemeTokens;
  dark: boolean;
  rows: EditableRow[];
  monthCovered?: string;
  shiftTypes: Array<{ id: string; name: string; start: string; end: string }>;
  onUpdate: (rid: string, patch: Partial<EditableRow>) => void;
}) {
  const kept = rows.filter((r) => !r.skipped && r.shiftTypeId).length;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 12, color: t.text2 }}>
          {monthCovered && <>Detected: {monthCovered} · </>}
          {kept} of {rows.length} ready to save
        </div>
        <div style={{ fontSize: 11, color: t.text3 }}>
          • high  · ok  ◦ low confidence
        </div>
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          border: `0.5px solid ${t.sep}`,
          borderRadius: 8,
          padding: 0,
          minHeight: 200,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)" }}>
              <Th>Date</Th>
              <Th>Shift type</Th>
              <Th>Label</Th>
              <Th>Conf</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rid} style={{ opacity: r.skipped ? 0.4 : 1 }}>
                <Td t={t}>
                  <input
                    type="date"
                    value={r.date}
                    onChange={(e) => onUpdate(r.rid, { date: e.target.value })}
                    style={tdInput(t)}
                  />
                </Td>
                <Td t={t}>
                  <select
                    value={r.shiftTypeId ?? ""}
                    onChange={(e) => onUpdate(r.rid, { shiftTypeId: e.target.value || null })}
                    style={tdInput(t)}
                  >
                    <option value="">— pick —</option>
                    {shiftTypes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({compactTime(s.start)})
                      </option>
                    ))}
                  </select>
                </Td>
                <Td t={t}>
                  <input
                    type="text"
                    value={r.label}
                    onChange={(e) => onUpdate(r.rid, { label: e.target.value })}
                    style={tdInput(t)}
                  />
                </Td>
                <Td t={t}>
                  <ConfidenceDot c={r.confidence} />
                </Td>
                <Td t={t}>
                  <button
                    type="button"
                    onClick={() => onUpdate(r.rid, { skipped: !r.skipped })}
                    style={{
                      border: 0,
                      background: "transparent",
                      color: t.text3,
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "inherit",
                    }}
                  >
                    {r.skipped ? "Include" : "Skip"}
                  </button>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 20, color: t.text3, fontSize: 12, textAlign: "center" }}>
                  No rows. The image may not contain a recognizable schedule.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ConfidenceDot({ c }: { c: number }) {
  const symbol = c >= 0.8 ? "●" : c >= 0.5 ? "·" : "◦";
  const color = c >= 0.8 ? "#30D158" : c >= 0.5 ? "#A2845E" : "#FF453A";
  return <span style={{ color, fontSize: 12, fontWeight: 700 }} title={`Confidence: ${c.toFixed(2)}`}>{symbol}</span>;
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th style={{
      textAlign: "left",
      padding: "8px 10px",
      fontSize: 10.5,
      fontWeight: 700,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "rgba(235,235,245,0.5)",
    }}>{children}</th>
  );
}

function Td({ children, t }: { children: React.ReactNode; t: ThemeTokens }) {
  return <td style={{ padding: "6px 10px", borderTop: `0.5px solid ${t.sep}` }}>{children}</td>;
}

function tdInput(t: ThemeTokens): React.CSSProperties {
  return {
    padding: "4px 6px",
    background: t.bg,
    border: `0.5px solid ${t.sep}`,
    borderRadius: 5,
    color: t.text,
    fontSize: 12,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    colorScheme: t.bg === "#000" ? "dark" : "light",
  };
}

function primaryBtn(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    border: 0,
    borderRadius: 8,
    background: color,
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
  };
}

function secondaryBtn(t: ThemeTokens): React.CSSProperties {
  return {
    padding: "8px 14px",
    border: `0.5px solid ${t.sep}`,
    borderRadius: 8,
    background: "transparent",
    color: t.text,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
  };
}

function linkBtn(color: string): React.CSSProperties {
  return {
    background: "transparent",
    border: 0,
    color,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
  };
}
