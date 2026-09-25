import { useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState, ShiftType } from "../state";
import { compactTime, isCustomType } from "../state";
import { findScheduleImport, type ImportTarget } from "../scheduleImports";
import { writeScheduleImport, type ImportRow } from "../lib/writeScheduleImport";
import { parseScheduleXlsx, parseTimeRange, type XlsxParseResult } from "../lib/parseScheduleXlsx";
import { normalizeImage } from "../lib/normalizeImage";
import { MONTHS_LONG } from "../data";
import type { ParsedShiftRow } from "../global";
import { BRAND_TEAL, BRAND_FONT } from "./BrandMark";

const CLAY = "#8A4B38";
const TEAL_TINT = "#D8E7E4";
const CLAY_TINT = "#EFDFDB";

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
  | { kind: "parsing"; step: ParseStep }
  | { kind: "review"; rows: EditableRow[]; monthCovered?: string; countedDays?: number; source: "photo" | "sheet" }
  | { kind: "saving" }
  | { kind: "saved"; count: number };

/**
 * Chosen in a row's type dropdown to mean "make a type out of what the photo
 * said". Nothing is created until Save, and one type is made per distinct pair
 * of hours however many rows asked for it.
 */
const NEW_TYPE = "__new__";

/** A fresh catalog id. Module scope: it is impure, and nothing about it
 *  belongs in a component's render. */
function newTypeId(): string {
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** The hours a row's own label implies, if it reads as a time range. */
function hoursFromLabel(label: string): { start: string; end: string } | null {
  const t = parseTimeRange(label || "");
  return t ? { start: t.start, end: t.end } : null;
}

/** Where the read has got to — drives the checklist on the parsing screen. */
type ParseStep = "reading" | "rows" | "matching";

interface EditableRow extends ParsedShiftRow {
  /** Local row id for React keys + skip-toggle. */
  rid: string;
  /** If true, user has skipped this row — won't write. */
  skipped: boolean;
}

/** "Work Schedule" / "School Schedule" — the subtitle beside the person. */
function scheduleKindLabel(target: ImportTarget): string {
  return target === "dependent-daisy" ? "School Schedule" : "Work Schedule";
}

export function ScheduleImportModal({
  scheduleId, onClose, onNeedApiKey, palette: _palette, t, dark, householdId, state,
  today, contextMonth,
}: Props) {
  // The sidebar row that opened the modal fixes which schedule is being
  // imported — the person is named in the header, not re-chosen in here.
  const [activeId, setActiveId] = useState<string | null>(scheduleId);
  const def = activeId ? findScheduleImport(activeId) : undefined;
  const [phase, setPhase] = useState<Phase>({ kind: "upload" });
  const [image, setImage] = useState<{ dataUrl: string; base64: string; mediaType: string; name: string; size: number } | null>(null);
  /** A spreadsheet export, read locally — no model and no API key involved. */
  const [sheet, setSheet] = useState<{ name: string; size: number; result: XlsxParseResult } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean>(false);

  // Reset whenever the modal is (re)opened on a different schedule.
  useEffect(() => {
    if (!scheduleId) return;
    setActiveId(scheduleId);
    setPhase({ kind: "upload" });
    setImage(null);
    setSheet(null);
    setErr(null);
    window.sbm?.hasApiKey().then(setHasKey).catch(() => setHasKey(false));
  }, [scheduleId]);

  if (!scheduleId || !def) return null;

  const onPickFile = async (file: File) => {
    setErr(null);
    if (isSpreadsheet(file)) {
      try {
        const buf = await file.arrayBuffer();
        const result = parseScheduleXlsx(buf, def.personLabel, state?.shiftTypes ?? []);
        if (result.error) {
          const who = result.peopleFound.length
            ? ` The sheet lists: ${result.peopleFound.slice(0, 6).join(", ")}${result.peopleFound.length > 6 ? "…" : ""}.`
            : "";
          setErr(result.error + who);
          return;
        }
        if (result.rows.length === 0) {
          setErr(`Found ${def.personLabel}'s row, but no shifts in it.`);
          return;
        }
        setImage(null);
        setSheet({ name: file.name || "schedule.xlsx", size: file.size, result });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't read that spreadsheet.");
      }
      return;
    }
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
        // The original file's name/size — what the parsing screen shows. The
        // encoded size differs after downscaling, so keep the user's own.
        name: file.name || "photo",
        size: file.size,
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
    if (file && (file.type.startsWith("image/") || isSpreadsheet(file))) {
      void onPickFile(file);
    } else {
      setErr("Drop a photo or an .xlsx schedule export.");
    }
  };

  const onParse = async () => {
    if (sheet) {
      const validIds = new Set((state?.shiftTypes ?? []).map((x) => x.id));
      const editable: EditableRow[] = sheet.result.rows.map((r, i) => ({
        ...r,
        shiftTypeId: r.shiftTypeId && validIds.has(r.shiftTypeId) ? r.shiftTypeId : null,
        rid: `x${i}`,
        skipped: false,
      }));
      setPhase({
        kind: "review",
        rows: editable,
        monthCovered: sheet.result.monthCovered,
        countedDays: sheet.result.countedDays,
        source: "sheet",
      });
      return;
    }
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
    // "reading" covers the encode we have already done; the request is the
    // "rows" step; the shift-type reconciliation below is "matching".
    setPhase({ kind: "parsing", step: "rows" });
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
    setPhase({ kind: "parsing", step: "matching" });
    // Force any shiftTypeId Claude returned that doesn't match the current
    // catalog back to null so the user is prompted to map it before save.
    const editable: EditableRow[] = result.rows.map((r, i) => ({
      ...r,
      shiftTypeId: r.shiftTypeId && validIds.has(r.shiftTypeId) ? r.shiftTypeId : null,
      rid: `r${i}`,
      skipped: false,
    }));
    setPhase({ kind: "review", rows: editable, monthCovered: result.monthCovered, countedDays: result.countedDays, source: "photo" });
  };

  const onSave = async () => {
    if (phase.kind !== "review") return;
    if (!householdId) {
      setErr("No household linked.");
      return;
    }
    // Rows asking for a new type are grouped by their hours, so five days of
    // "10a-730p" make one type rather than five.
    const newShiftTypes: ShiftType[] = [];
    const idForHours = new Map<string, string>();
    for (const r of readyRows) {
      if (r.shiftTypeId !== NEW_TYPE) continue;
      const hours = hoursFromLabel(r.label);
      if (!hours) continue;
      const key = `${hours.start}-${hours.end}`;
      if (idForHours.has(key)) continue;
      const existing = shiftTypes.find((t) => t.start === hours.start && t.end === hours.end);
      if (existing) { idForHours.set(key, existing.id); continue; }
      const id = newTypeId();
      idForHours.set(key, id);
      newShiftTypes.push({
        id,
        // Named after what the photo said, so it's recognisable in the catalog.
        name: (r.label || `${compactTime(hours.start)}-${compactTime(hours.end)}`).trim(),
        start: hours.start,
        end: hours.end,
        crossesMidnight: hours.end <= hours.start,
      });
    }

    const rows: ImportRow[] = readyRows.map((r) => {
      const hours = r.shiftTypeId === NEW_TYPE ? hoursFromLabel(r.label) : null;
      const resolved = hours ? idForHours.get(`${hours.start}-${hours.end}`) : r.shiftTypeId;
      return {
        date: r.date,
        shiftTypeId: resolved as string,
        label: r.label,
        ...(r.note ? { note: r.note } : {}),
      };
    });
    if (rows.length === 0) {
      setErr("Nothing to add — every row is skipped, needs a shift type, or still has a flag to clear.");
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
        newShiftTypes,
      });
      setPhase({ kind: "saved", count: rows.length });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the import.");
      setPhase({
        kind: "review",
        rows: phase.rows,
        monthCovered: phase.monthCovered,
        countedDays: phase.countedDays,
        source: phase.source,
      });
    }
  };

  const updateRow = (rid: string, patch: Partial<EditableRow>) => {
    setPhase((p) => {
      if (p.kind !== "review") return p;
      return { ...p, rows: p.rows.map((r) => (r.rid === rid ? { ...r, ...patch } : r)) };
    });
  };

  // Custom template slots resolve to synthetic __cst_ types that live only in
  // memory, so offering one here guarantees the save fails against Firestore.
  const shiftTypes = (state?.shiftTypes ?? []).filter((s) => !isCustomType(s.id));

  // Footer count — days that will actually be written.
  const validIds = new Set(shiftTypes.map((s) => s.id));
  const readyRows: EditableRow[] =
    phase.kind === "review"
      ? phase.rows.filter((r) => !r.skipped && !!r.shiftTypeId && (r.shiftTypeId === NEW_TYPE || validIds.has(r.shiftTypeId)))
      : [];
  const addCount = readyRows.length;

  const monthLabel = (ym: string): string => {
    const [yy, mm] = ym.split("-").map(Number);
    return `${MONTHS_LONG[(mm || 1) - 1]} ${yy}`;
  };

  const headTitle =
    phase.kind === "parsing" ? "Reading the photo"
      : phase.kind === "review" ? "Review your Shifts"
        : phase.kind === "saving" ? "Adding to the schedule"
          : phase.kind === "saved" ? "Added to the schedule"
            : "Read a schedule from a photo";

  const headSub =
    phase.kind === "parsing"
      ? `${def.personLabel} ${def.target === "dependent-daisy" ? "school" : "nights"} · ${monthLabel(contextMonth)}`
      : phase.kind === "review"
        ? `${def.personLabel}  |  ${scheduleKindLabel(def.target)} · ${phase.rows.length} shift${phase.rows.length === 1 ? "" : "s"} extracted`
        : `${def.personLabel}  |  ${scheduleKindLabel(def.target)}`;

  const canExtract = !!sheet || (!!image && hasKey);

  const footerNote =
    phase.kind === "upload" ? "Nucleus reads it, then you check every shift before anything is saved."
      : phase.kind === "review" ? "A skipped row is not saved."
        : phase.kind === "parsing" ? "Nothing is saved yet. You check every row next."
          : phase.kind === "saving" ? "Saving…"
            : "";

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
          width: phase.kind === "review" ? "min(960px, calc(100vw - 32px))" : "min(660px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 64px)",
          background: t.bgElev,
          color: t.text,
          border: `1px solid ${t.sep}`,
          borderRadius: 10,
          boxShadow: dark ? "0 24px 64px rgba(0,0,0,0.6)" : "0 24px 64px rgba(20,32,30,0.28)",
          zIndex: 1101,
          fontFamily: "inherit",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header — the title, then which schedule this is, over a rule. */}
        <div
          style={{
            flexShrink: 0, padding: "20px 22px 16px", borderBottom: `1px solid ${t.sep}`,
            display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: BRAND_FONT, fontWeight: 600, fontSize: 20, letterSpacing: "-0.02em", lineHeight: 1.15, color: t.text }}>
              {headTitle}
            </div>
            {/* The sidebar row that opened this already picked the person, so
                the schedule is named here rather than re-chosen with tabs. */}
            <div style={{ marginTop: 6, fontSize: 14, color: t.text2 }}>{headSub}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 38, height: 38, flexShrink: 0, padding: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              border: `1px solid ${t.sep}`, borderRadius: 4, background: t.bgElev, color: t.text, cursor: "pointer",
            }}
          >
            <XIcon />
          </button>
        </div>

        {/* Body */}
        {phase.kind === "upload" && (
          <UploadPhase
            t={t} dark={dark}
            image={image} sheet={sheet} hasKey={hasKey}
            onDrop={onDrop} onPickFile={onPickFile}
            onClear={() => { setImage(null); setSheet(null); }}
            onNeedApiKey={onNeedApiKey}
          />
        )}

        {phase.kind === "parsing" && (
          <ParsingPhase t={t} dark={dark} image={image} step={phase.step} />
        )}

        {phase.kind === "review" && (
          <ReviewPhase
            rows={phase.rows}
            shiftTypes={shiftTypes}
            t={t}
            dark={dark}
            contextMonth={contextMonth}
            countedDays={phase.countedDays}
            source={phase.source}
            image={image}
            onUpdate={updateRow}
          />
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

        {/* Footer — the reassurance on the left, the actions on the right. */}
        <div
          style={{
            flexShrink: 0, padding: "14px 22px", borderTop: `1px solid ${t.sep}`,
            background: dark ? "rgba(255,255,255,0.03)" : "#F7F6F3",
            display: "flex", alignItems: "center", gap: 12,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: t.text2, lineHeight: 1.4 }}>{footerNote}</span>
          {phase.kind === "upload" && (
            <>
              <button type="button" onClick={onClose} style={ghostBtn(t)}>Cancel</button>
              <button type="button" onClick={onParse} disabled={!canExtract} style={primaryBtn(!canExtract, t)}>
                Extract
              </button>
            </>
          )}
          {phase.kind === "review" && (
            <>
              <button type="button" onClick={onClose} style={ghostBtn(t)}>Cancel</button>
              <button type="button" onClick={onSave} disabled={addCount === 0} style={primaryBtn(addCount === 0, t)}>
                Save {addCount} shift{addCount === 1 ? "" : "s"}
              </button>
            </>
          )}
          {phase.kind === "saved" && (
            <button type="button" onClick={onClose} style={primaryBtn(false, t)}>Done</button>
          )}
          {(phase.kind === "parsing" || phase.kind === "saving") && (
            <button type="button" onClick={onClose} style={ghostBtn(t)}>Cancel</button>
          )}
        </div>
      </div>
    </>
  );
}

// ── Review phase ─────────────────────────────────────────────────────────────

type RowFlag = "ready" | "needs-type" | "wrong-month" | "not-a-time";

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function count(n: number): string {
  return n <= 10 ? NUMBER_WORDS[n] : String(n);
}

const FLAG_LABEL: Record<Exclude<RowFlag, "ready">, string> = {
  "needs-type": "NEEDS A TYPE",
  "wrong-month": "WRONG MONTH?",
  "not-a-time": "NOT A TIME",
};

/** Does the label read like a time the parser could have meant? */
const TIME_TOKEN = String.raw`\d{1,4}(?::\d{2})?\s*(?:[ap]\.?m?\.?)?`;
const TIME_LIKE = new RegExp(`^\\s*${TIME_TOKEN}\\s*(?:(?:-|–|—|to)\\s*${TIME_TOKEN})?\\s*$`, "i");
const WORD_LIKE = /^(school|no school|half day|class|off|pto|vacation)$/i;

/**
 * What is wrong with a row, if anything. Every one of these is a check run on
 * the text we got back — none is the reader's own opinion, which is why the
 * screen says so above the table.
 */
function flagFor(row: EditableRow, validIds: Set<string>, contextMonth: string): RowFlag {
  if (!row.date.startsWith(contextMonth)) return "wrong-month";
  if (row.shiftTypeId !== NEW_TYPE && (!row.shiftTypeId || !validIds.has(row.shiftTypeId))) return "needs-type";
  const label = (row.label || "").trim();
  if (label && !TIME_LIKE.test(label) && !WORD_LIKE.test(label)) return "not-a-time";
  return "ready";
}

function ReviewPhase({
  rows, shiftTypes, t, dark, contextMonth, countedDays, source, image, onUpdate,
}: {
  rows: EditableRow[];
  shiftTypes: Array<{ id: string; name: string; start: string; end: string }>;
  t: ThemeTokens;
  dark: boolean;
  contextMonth: string;
  countedDays?: number;
  source: "photo" | "sheet";
  image: { dataUrl: string } | null;
  onUpdate: (rid: string, patch: Partial<EditableRow>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const paper = dark ? "rgba(255,255,255,0.03)" : "#F7F6F3";
  const validIds = new Set(shiftTypes.map((s) => s.id));

  const flags = rows.map((r) => (r.skipped ? "ready" : flagFor(r, validIds, contextMonth)) as RowFlag);
  // "Ready to save" means it has a type — the same test the Save button uses.
  // The month and label flags stay on the row as warnings to look at.
  const readyCount = rows.filter((r) => !r.skipped && !!r.shiftTypeId && (r.shiftTypeId === NEW_TYPE || validIds.has(r.shiftTypeId))).length;
  const needTypeCount = flags.filter((f) => f === "needs-type").length;
  const offMonth = rows.filter((r) => !r.date.startsWith(contextMonth));
  const offMonthName = offMonth.length
    ? MONTHS_LONG[(Number(offMonth[0].date.split("-")[1]) || 1) - 1]
    : "";

  const firstProblem = rows.find((_, i) => flags[i] !== "ready");
  const shown = expanded ? rows : rows.slice(0, 10);
  const hidden = rows.length - shown.length;

  // The number and the label share a baseline, and that baseline group is
  // centred in the pill — aligning to the baseline alone pins the line to the
  // top of a fixed-height box.
  const chip = (n: number, text: string, tone: "ok" | "warn") => (
    <span
      style={{
        display: "inline-flex", alignItems: "center", height: 32, padding: "0 14px", borderRadius: 4,
        background: tone === "ok" ? TEAL_TINT : CLAY_TINT,
        color: tone === "ok" ? BRAND_TEAL : CLAY,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 7, lineHeight: 1 }}>
        <span style={{ fontFamily: BRAND_FONT, fontSize: 15, fontWeight: 700 }}>{n}</span>
        <span style={{ fontSize: 13.5 }}>{text}</span>
      </span>
    </span>
  );

  return (
    <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto" }}>
      {/* Tallies + a jump to the first thing that needs a decision. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 22px 0", flexWrap: "wrap" }}>
        {chip(readyCount, "ready to save", "ok")}
        {needTypeCount > 0 && chip(needTypeCount, "need a shift type", "warn")}
        {offMonth.length > 0 && chip(offMonth.length, `fall in ${offMonthName}`, "warn")}
        {firstProblem && (
          <button
            type="button"
            onClick={() => document.getElementById(`imp-${firstProblem.rid}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}
            style={{ ...linkBtn(BRAND_TEAL), marginLeft: "auto", textDecoration: "underline" }}
          >
            Go to the first problem
          </button>
        )}
      </div>

      {/* Whole-import warnings. */}
      <div style={{ padding: "12px 22px 0", display: "flex", flexDirection: "column", gap: 1 }}>
        {offMonth.length > 0 && (
          <Banner t={t}>
            You picked {MONTHS_LONG[(Number(contextMonth.split("-")[1]) || 1) - 1]}, and {count(offMonth.length)}{" "}
            {offMonth.length === 1 ? "row came" : "rows came"} back in {offMonthName}. That usually means the photo shows the
            end of the last month. Fix the date or skip {offMonth.length === 1 ? "that row" : "those rows"}.
          </Banner>
        )}
        {countedDays !== undefined && countedDays !== rows.length && (
          <Banner t={t} action={image ? { label: showPhoto ? "Hide the photo" : "Open the photo", onClick: () => setShowPhoto((v) => !v) } : undefined}>
            The reader counted <b>{countedDays}</b> dated squares on the photo and gave back {rows.length} rows.{" "}
            {countedDays > rows.length ? "One may be missing." : "One may be doubled."}
          </Banner>
        )}
      </div>

      {showPhoto && image && (
        <div style={{ padding: "12px 22px 0" }}>
          <img src={image.dataUrl} alt="The photo that was read" style={{ maxWidth: "100%", borderRadius: 6, border: `1px solid ${t.sep}` }} />
        </div>
      )}

      <div style={{ padding: "12px 22px 0", fontSize: 13, color: t.text2 }}>
        Each flag below is a check Nucleus ran on the text, not a guess by the reader.
      </div>

      {/* The rows. */}
      <div style={{ padding: "12px 22px 8px" }}>
        <div
          style={{
            display: "grid", gridTemplateColumns: "116px 1fr 124px 132px 34px", gap: 10,
            padding: "0 0 8px", marginLeft: 3, borderBottom: `1px solid ${t.sep}`,
            fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", color: t.text3,
          }}
        >
          <span>DATE</span><span>SHIFT TYPE</span><span>WHAT IT SAID</span><span>STATUS</span><span />
        </div>

        {shown.map((r, i) => (
          <ReviewRow
            key={r.rid}
            row={r}
            flag={flags[rows.indexOf(r)]}
            shiftTypes={shiftTypes}
            t={t}
            paper={paper}
            source={source}
            first={i === 0}
            onUpdate={onUpdate}
          />
        ))}

        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{
              width: "100%", marginTop: 10, background: "transparent", border: 0, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 12, color: t.text3, fontSize: 12.5, fontFamily: "inherit",
            }}
          >
            <span style={{ flex: 1, height: 1, background: t.sep }} />
            {hidden} more row{hidden === 1 ? "" : "s"}
            <span style={{ flex: 1, height: 1, background: t.sep }} />
          </button>
        )}

        {rows.length === 0 && (
          <div style={{ padding: "28px 8px", textAlign: "center", color: t.text3, fontSize: 13 }}>
            No days found. The photo may not show a recognizable schedule.
          </div>
        )}
      </div>
    </div>
  );
}

function Banner({ t: _t, children, action }: { t: ThemeTokens; children: React.ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: CLAY_TINT, color: CLAY }}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M12 4.5L21 19.5H3L12 4.5z" stroke={CLAY} strokeWidth={1.7} strokeLinejoin="round" />
        <path d="M12 10v4M12 16.4v.2" stroke={CLAY} strokeWidth={1.7} strokeLinecap="round" />
      </svg>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.45 }}>{children}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            flexShrink: 0, height: 34, padding: "0 14px", borderRadius: 4, border: `1px solid ${CLAY}`,
            background: "transparent", color: CLAY, fontFamily: BRAND_FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function ReviewRow({
  row, flag, shiftTypes, t, paper, source, first, onUpdate,
}: {
  row: EditableRow;
  flag: RowFlag;
  shiftTypes: Array<{ id: string; name: string; start: string; end: string }>;
  t: ThemeTokens;
  paper: string;
  source: "photo" | "sheet";
  first: boolean;
  onUpdate: (rid: string, patch: Partial<EditableRow>) => void;
}) {
  const problem = !row.skipped && flag !== "ready";
  const needsType = !row.skipped && flag === "needs-type";
  const newHours = hoursFromLabel(row.label);
  return (
    <div
      id={`imp-${row.rid}`}
      style={{
        display: "grid", gridTemplateColumns: "116px 1fr 124px 132px 34px", gap: 10, alignItems: "start",
        padding: "10px 0 10px 10px", marginLeft: -10,
        borderTop: first ? "none" : `1px solid ${t.sep}`,
        background: problem ? paper : "transparent",
        borderLeft: problem ? `3px solid ${CLAY}` : "3px solid transparent",
        opacity: row.skipped ? 0.45 : 1,
      }}
    >
      <div>
        <input
          type="date"
          value={row.date}
          onChange={(e) => onUpdate(row.rid, { date: e.target.value })}
          style={{
            width: "100%", height: 38, padding: "0 8px", borderRadius: 4, boxSizing: "border-box",
            border: `1px solid ${flag === "wrong-month" ? CLAY : t.sep}`,
            background: t.bgElev, color: flag === "wrong-month" ? CLAY : t.text,
            fontFamily: "inherit", fontSize: 13.5,
            colorScheme: t.bg === "#000" ? "dark" : "light",
          }}
        />
        {flag === "wrong-month" && (
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: CLAY, marginTop: 4 }}>
            IN {MONTHS_LONG[(Number(row.date.split("-")[1]) || 1) - 1].toUpperCase()}
          </div>
        )}
      </div>

      <select
        value={row.shiftTypeId ?? ""}
        onChange={(e) => onUpdate(row.rid, { shiftTypeId: e.target.value || null })}
        style={{
          width: "100%", height: 38, padding: "0 8px", borderRadius: 4, boxSizing: "border-box",
          border: needsType ? `1px dashed ${CLAY}` : `1px solid ${t.sep}`,
          background: t.bgElev, color: needsType ? CLAY : t.text,
          fontFamily: "inherit", fontSize: 13.5,
        }}
      >
        <option value="">Pick a shift type</option>
        {newHours && (
          <option value={NEW_TYPE}>
            ＋ New type · {compactTime(newHours.start)} – {compactTime(newHours.end)}
          </option>
        )}
        {shiftTypes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {compactTime(s.start)} – {compactTime(s.end)}
          </option>
        ))}
      </select>

      <div style={{ minWidth: 0, minHeight: 38, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: 13.5, color: flag === "not-a-time" ? CLAY : t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.label || "—"}
        </div>
        {row.note ? (
          <div title={row.note} style={{ fontSize: 12, color: t.text2, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.note}
          </div>
        ) : (
          <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.08em", color: t.text3, marginTop: 3 }}>
            {source === "sheet" ? "READ FROM SHEET" : "READ FROM PHOTO"}
          </div>
        )}
      </div>

      <div style={{ minHeight: 38, display: "flex", alignItems: "center" }}>
        {row.skipped ? (
          <span style={{ fontSize: 12.5, color: t.text3, textDecoration: "line-through" }}>skipped</span>
        ) : flag === "ready" ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: BRAND_TEAL }}>
            <CheckIcon color={BRAND_TEAL} /> ready
          </span>
        ) : (
          <span
            style={{
              display: "inline-block", padding: "4px 8px", borderRadius: 3, border: `1px solid ${CLAY}`,
              color: CLAY, fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap",
            }}
          >
            {FLAG_LABEL[flag]}
          </span>
        )}
      </div>

      <button
        type="button"
        aria-label={row.skipped ? "Keep this row" : "Skip this row"}
        title={row.skipped ? "Keep this row" : "Skip this row"}
        onClick={() => onUpdate(row.rid, { skipped: !row.skipped })}
        style={{ width: 30, height: 38, padding: 0, border: 0, background: "transparent", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >
        <TrashIcon color={row.skipped ? BRAND_TEAL : t.text3} />
      </button>
    </div>
  );
}


// ── Upload phase ─────────────────────────────────────────────────────────────

/** Spreadsheet exports we can read without a model. */
export function isSpreadsheet(file: File): boolean {
  return /\.(xlsx|xlsm)$/i.test(file.name) ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function UploadPhase({
  t, dark, image, sheet, hasKey, onDrop, onPickFile, onClear, onNeedApiKey,
}: {
  t: ThemeTokens;
  dark: boolean;
  image: { dataUrl: string } | null;
  sheet: { name: string; size: number; result: { rows: unknown[]; countedDays: number } } | null;
  hasKey: boolean;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPickFile: (f: File) => void;
  onClear: () => void;
  onNeedApiKey: () => void;
}) {
  const paper = dark ? "rgba(255,255,255,0.03)" : "#F7F6F3";
  return (
    <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "18px 22px 8px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Reading a photo needs the Anthropic key, which lives in the Mac
          keychain — say so up front rather than failing at Extract. */}
      {!hasKey && !sheet && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "14px 16px", borderRadius: 6,
            border: `1px dashed ${CLAY}`, background: CLAY_TINT,
          }}
        >
          <KeyIcon />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: CLAY }}>No API key yet</div>
            <div style={{ fontSize: 12.5, color: CLAY, marginTop: 2, lineHeight: 1.4 }}>
              Reading a photo requires one. It is stored on this Mac only.
            </div>
          </div>
          <button
            type="button"
            onClick={onNeedApiKey}
            style={{
              flexShrink: 0, height: 40, padding: "0 16px", borderRadius: 4,
              border: `1px solid ${CLAY}`, background: "transparent", color: CLAY,
              fontFamily: BRAND_FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}
          >
            Add a key
          </button>
        </div>
      )}

      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{
          minHeight: 260,
          border: `1px dashed ${t.sep}`,
          borderRadius: 6,
          padding: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: paper,
        }}
      >
        {sheet ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
            <SheetIcon color={BRAND_TEAL} />
            <div style={{ fontFamily: BRAND_FONT, fontSize: 16, fontWeight: 600, color: t.text, marginTop: 4 }}>{sheet.name}</div>
            <div style={{ fontSize: 13, color: t.text2 }}>
              {sheet.result.rows.length} shift{sheet.result.rows.length === 1 ? "" : "s"} found · read without a model
            </div>
            <button type="button" onClick={onClear} style={linkBtn(t.text2)}>Choose a different file</button>
          </div>
        ) : image ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <img src={image.dataUrl} alt="" style={{ maxWidth: 400, maxHeight: 260, borderRadius: 6, border: `1px solid ${t.sep}` }} />
            <button type="button" onClick={onClear} style={linkBtn(t.text2)}>Choose a different photo</button>
          </div>
        ) : (
          <div style={{ textAlign: "center" }}>
            <CameraIcon color={t.text3} />
            <div style={{ fontFamily: BRAND_FONT, fontSize: 16.5, fontWeight: 600, color: t.text, marginTop: 12, letterSpacing: "-0.01em" }}>
              Drop a photo or a spreadsheet export
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px auto 0", maxWidth: 240 }}>
              <span style={{ flex: 1, height: 1, background: t.sep }} />
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", color: t.text3 }}>OR</span>
              <span style={{ flex: 1, height: 1, background: t.sep }} />
            </div>
            <label
              style={{
                display: "inline-block", marginTop: 16, padding: "10px 18px", borderRadius: 4,
                border: `1px solid ${t.sep}`, background: t.bgElev, color: t.text,
                fontFamily: BRAND_FONT, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
              }}
            >
              Browse files
              <input
                type="file"
                accept="image/*,.xlsx,.xlsm"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); }}
                style={{ display: "none" }}
              />
            </label>
          </div>
        )}
      </div>

      <div style={{ fontSize: 12.5, color: t.text3 }}>
        JPG, PNG or HEIC, up to 10 MB — or an .xlsx export, which is read here without a model.
      </div>
    </div>
  );
}

/** Bytes as the user thinks of them — "2.4 MB". */
function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * "Reading the photo" — the wait. The three steps are real transitions, not a
 * timer: the photo is already encoded when we arrive here, the request is in
 * flight during "rows", and "matching" is the shift-type reconciliation we do
 * locally on the reply. There is no row count until the reply lands, so the
 * bar reports which step we are on rather than a fake percentage.
 */
function ParsingPhase({
  t, dark, image, step,
}: {
  t: ThemeTokens;
  dark: boolean;
  image: { dataUrl: string; name: string; size: number; mediaType: string } | null;
  step: ParseStep;
}) {
  const paper = dark ? "rgba(255,255,255,0.03)" : "#F7F6F3";
  const order: ParseStep[] = ["reading", "rows", "matching"];
  const at = order.indexOf(step);
  const pct = [18, 55, 88][at] ?? 18;
  const steps: Array<[ParseStep, string]> = [
    ["reading", "Photo read"],
    ["rows", "Finding the rows"],
    ["matching", "Matching your shift types"],
  ];

  return (
    <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "18px 22px 8px", display: "flex", flexDirection: "column", gap: 18 }}>
      {/* What is being read. */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: 14, border: `1px solid ${t.sep}`, borderRadius: 6 }}>
        <div
          style={{
            width: 84, height: 84, flexShrink: 0, borderRadius: 4, background: paper,
            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
          }}
        >
          {image ? (
            <img src={image.dataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <CameraIcon color={t.text3} />
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {image?.name ?? "photo"}
          </div>
          <div style={{ fontSize: 13, color: t.text2, marginTop: 4 }}>
            {image ? `${fileSize(image.size)} · ${image.mediaType.replace("image/", "").toUpperCase()}` : ""}
          </div>
        </div>
      </div>

      {/* Progress. */}
      <div>
        <div style={{ height: 8, borderRadius: 4, background: dark ? "rgba(255,255,255,0.08)" : "#E7E5DF", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: BRAND_TEAL, borderRadius: 4, transition: "width 0.4s ease" }} />
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginTop: 10 }}>
          <span style={{ fontSize: 13, color: t.text2 }}>Most photos take about ten seconds.</span>
        </div>
      </div>

      {/* The checklist. */}
      <div style={{ background: paper, border: `1px solid ${t.sep}`, borderRadius: 6, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        {steps.map(([key, label], i) => {
          const done = i < at;
          const now = i === at;
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <StepDot done={done} now={now} t={t} />
              <span style={{ fontSize: 14, fontWeight: now ? 600 : 400, color: done || now ? t.text : t.text3 }}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepDot({ done, now, t }: { done: boolean; now: boolean; t: ThemeTokens }) {
  if (done) {
    return (
      <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true" style={{ flexShrink: 0 }}>
        <circle cx={10} cy={10} r={9} fill={BRAND_TEAL} />
        <path d="M5.8 10.3l2.7 2.7 5.5-5.6" stroke="#FFFFFF" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx={10} cy={10} r={8} fill="none" stroke={now ? BRAND_TEAL : t.sep} strokeWidth={now ? 2.4 : 1.6} />
    </svg>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function KeyIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx={8} cy={12} r={3.2} stroke={CLAY} strokeWidth={1.7} />
      <path d="M11.2 12H20M17 12v3M14 12v2" stroke={CLAY} strokeWidth={1.7} strokeLinecap="round" />
    </svg>
  );
}

function CameraIcon({ color }: { color: string }) {
  return (
    <svg width={46} height={46} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x={2.6} y={6.4} width={18.8} height={13} rx={2.4} stroke={color} strokeWidth={1.4} />
      <path d="M8.6 6.4l1.3-2.1h4.2l1.3 2.1" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      <circle cx={12} cy={12.9} r={3.6} stroke={color} strokeWidth={1.4} />
    </svg>
  );
}

function SheetIcon({ color }: { color: string }) {
  return (
    <svg width={42} height={42} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x={3.4} y={3.4} width={17.2} height={17.2} rx={2.2} stroke={color} strokeWidth={1.4} />
      <path d="M3.6 9.2h16.8M3.6 14.8h16.8M9.2 3.6v17M14.8 3.6v17" stroke={color} strokeWidth={1.1} />
    </svg>
  );
}

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

function ghostBtn(t: ThemeTokens): React.CSSProperties {
  return {
    height: 44, padding: "0 20px", boxSizing: "border-box", flexShrink: 0,
    borderRadius: 4, border: `1px solid ${t.sep}`, background: t.bgElev, color: t.text,
    fontFamily: BRAND_FONT, fontWeight: 600, fontSize: 13, cursor: "pointer",
  };
}

function primaryBtn(disabled: boolean, t: ThemeTokens): React.CSSProperties {
  return {
    height: 44, padding: "0 22px", boxSizing: "border-box", flexShrink: 0,
    borderRadius: 4, border: `1px solid ${disabled ? t.sep : BRAND_TEAL}`,
    background: disabled ? t.bgElev2 : BRAND_TEAL,
    color: disabled ? t.text3 : "#FFFFFF",
    fontFamily: BRAND_FONT, fontWeight: 600, fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function linkBtn(color: string): React.CSSProperties {
  return {
    background: "transparent", border: 0, color, fontSize: 12.5, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit", padding: 0,
  };
}

