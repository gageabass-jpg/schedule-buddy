import { useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState } from "../state";
import { buildShiftMap, compactTime } from "../state";
import { findScheduleImport, importFor, type ImportTarget } from "../scheduleImports";
import { applyScheduleComparison, type SheetChange } from "../lib/writeScheduleImport";
import { parseScheduleXlsx, type XlsxParseResult } from "../lib/parseScheduleXlsx";
import { compareSchedule, type AppShiftInfo, type Comparison, type ShiftDiff, type Who } from "../lib/compareSchedule";
import { muteChangeNotices, notify } from "../lib/toast";
import { MONTHS_LONG, WEEKDAYS_3 } from "../data";
import { BRAND_TEAL, BRAND_FONT } from "./BrandMark";
import { useModalMotion } from "../lib/modalMotion";
import { useHouseholdLook } from "../lib/householdLook";

const CLAY = "#8A4B38";

interface Props {
  scheduleId: string | null;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
}

type Choice = "sheet" | "app";

type Phase =
  | { kind: "upload" }
  | { kind: "compare"; comparison: Comparison; fileName: string }
  | { kind: "saving" }
  | { kind: "saved"; changed: number };

/** "Work Schedule" / "School Schedule" — the subtitle beside the person. */
function scheduleKindLabel(target: ImportTarget): string {
  return target === "dependent-daisy" ? "School Schedule" : "Work Schedule";
}

function whoFor(target: ImportTarget): Who {
  return target === "self-ot" ? "G" : target === "partner" ? "K" : "D";
}

/** "Oct 5" from an ISO date. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS_LONG[m - 1].slice(0, 3)} ${d}`;
}

function weekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS_3[new Date(y, m - 1, d).getDay()];
}

const hours = (h: { start: string; end: string }) => `${compactTime(h.start)} – ${compactTime(h.end)}`;

/** What the sheet says for a row, as text. */
function sheetText(diff: ShiftDiff): string {
  if (!diff.sheet) return "No shift";
  if (diff.sheet.start && diff.sheet.end) return hours({ start: diff.sheet.start, end: diff.sheet.end });
  return diff.sheet.start ? `${compactTime(diff.sheet.start)} start` : diff.sheet.label;
}

/** The sheet has a shift for this row but its hours can't be read, so it can't be applied. */
function unreadable(diff: ShiftDiff): boolean {
  return diff.kind !== "app-only" && !!diff.sheet && (!diff.sheet.start || !diff.sheet.end);
}

/** Can this row take the sheet's side at all? */
function applicable(diff: ShiftDiff): boolean {
  return !diff.locked && !unreadable(diff);
}

export function ScheduleImportModal({ scheduleId, onClose, t, dark, householdId, state }: Props) {
  // The sidebar row that opened the modal fixes which schedule is being
  // compared — the person is named in the header, not re-chosen in here.
  const [activeId, setActiveId] = useState<string | null>(scheduleId);
  const look = useHouseholdLook();
  const found = activeId ? findScheduleImport(activeId) : undefined;
  const def = found ? importFor(found, look) : undefined;
  const [phase, setPhase] = useState<Phase>({ kind: "upload" });
  /** A spreadsheet export, read locally. */
  const [sheet, setSheet] = useState<{ name: string; size: number; result: XlsxParseResult } | null>(null);
  /** Per row (`s:date` for a shift, `o:date` for on call): whose side wins. */
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [err, setErr] = useState<string | null>(null);

  // Reset whenever the modal is (re)opened on a different schedule.
  useEffect(() => {
    if (!scheduleId) return;
    setActiveId(scheduleId);
    setPhase({ kind: "upload" });
    setSheet(null);
    setChoices({});
    setErr(null);
  }, [scheduleId]);

  // Fade and rise in, sink out, Escape to close (shared with every modal).
  const mm = useModalMotion(!!scheduleId, onClose);

  if (!scheduleId || !def) return null;
  const who = whoFor(def.target);

  const onPickFile = async (file: File) => {
    setErr(null);
    if (!isSpreadsheet(file)) {
      setErr("That isn't a spreadsheet. Choose the schedule's .xlsx export.");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const result = parseScheduleXlsx(buf, def.personLabel, state?.shiftTypes ?? []);
      if (result.error) {
        const names = result.peopleFound.length
          ? ` The sheet lists: ${result.peopleFound.slice(0, 6).join(", ")}${result.peopleFound.length > 6 ? "…" : ""}.`
          : "";
        setErr(result.error + names);
        return;
      }
      if (!result.dateFrom || !result.dateTo) {
        setErr("Couldn't find the dates in that spreadsheet.");
        return;
      }
      setSheet({ name: file.name || "schedule.xlsx", size: file.size, result });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read that spreadsheet.");
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void onPickFile(file);
  };

  /** Lay the sheet next to what the app already has. */
  const onCompare = () => {
    if (!sheet || !state) return;
    const { result } = sheet;
    const from = result.dateFrom as string;
    const to = result.dateTo as string;
    const filled: HouseholdState = { ...state, template: state.template ?? [], overrides: state.overrides ?? [], ot: state.ot ?? [] };
    const shifts = buildShiftMap(filled, from, to);
    const comparison = compareSchedule({
      rows: result.rows,
      onCallDates: result.onCallDates,
      from, to, who, shifts,
      shiftTypes: state.shiftTypes ?? [],
      // A person's recurring days can't be taken off one at a time here, except
      // Gage's (switched off with a one-off day).
      canRemove: (date) => {
        if (who === "G") return true;
        if (who === "K") return !(shifts[date] ?? []).some((s) => s.who === "K" && s.source?.kind === "template");
        return !state.weeklyTemplates?.daisy;
      },
      appOnCall: (state.partner?.onCall ?? []).map((o) => o.date),
    });
    const next: Record<string, Choice> = {};
    for (const d of comparison.diffs) next[`s:${d.date}`] = applicable(d) ? "sheet" : "app";
    for (const o of comparison.onCall) next[`o:${o.date}`] = "sheet";
    setChoices(next);
    setErr(null);
    setPhase({ kind: "compare", comparison, fileName: sheet.name });
  };

  const setChoice = (key: string, c: Choice) => setChoices((prev) => ({ ...prev, [key]: c }));
  const setAll = (c: Choice) => {
    if (phase.kind !== "compare") return;
    const next: Record<string, Choice> = {};
    for (const d of phase.comparison.diffs) next[`s:${d.date}`] = c === "sheet" && applicable(d) ? "sheet" : "app";
    for (const o of phase.comparison.onCall) next[`o:${o.date}`] = c;
    setChoices(next);
  };

  // What Apply would do: the rows set to the sheet's side.
  const chosenShifts = phase.kind === "compare"
    ? phase.comparison.diffs.filter((d) => choices[`s:${d.date}`] === "sheet" && applicable(d))
    : [];
  const chosenOnCall = phase.kind === "compare"
    ? phase.comparison.onCall.filter((o) => choices[`o:${o.date}`] === "sheet")
    : [];
  const applyCount = chosenShifts.length + chosenOnCall.length;

  const onApply = async () => {
    if (phase.kind !== "compare") return;
    if (!householdId) { setErr("No household linked."); return; }
    const changes: SheetChange[] = chosenShifts.map((d) =>
      d.kind === "app-only"
        ? { date: d.date, action: "remove" }
        : {
            date: d.date, action: "set",
            shift: { start: d.sheet!.start as string, end: d.sheet!.end as string, label: d.sheet!.label, ...(d.sheet!.note ? { note: d.sheet!.note } : {}) },
          });
    const { comparison } = phase;
    setErr(null);
    setPhase({ kind: "saving" });
    try {
      await applyScheduleComparison({
        householdId,
        scheduleId: def.id,
        target: def.target,
        changes,
        onCall: {
          add: chosenOnCall.filter((o) => o.kind === "sheet-only").map((o) => o.date),
          remove: chosenOnCall.filter((o) => o.kind === "app-only").map((o) => o.date),
        },
        monthCovered: comparison.from.slice(0, 7),
        lastShiftDate: comparison.lastShiftDate,
      });
      // Say it here, in the words of what the user just did, and keep the
      // generic "N shifts changed" notice quiet when the write echoes back.
      muteChangeNotices();
      notify(`Updated ${applyCount} ${applyCount === 1 ? "day" : "days"} from the sheet. You should see them change now.`);
      setPhase({ kind: "saved", changed: applyCount });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the changes.");
      setPhase({ kind: "compare", comparison, fileName: phase.fileName });
    }
  };

  const headTitle =
    phase.kind === "compare" ? "Sheet and app compared"
      : phase.kind === "saving" ? "Updating the schedule"
        : phase.kind === "saved" ? "Schedule updated"
          : "Compare a schedule";

  const headSub =
    phase.kind === "compare"
      ? `${def.personLabel}  |  ${scheduleKindLabel(def.target)} · ${shortDate(phase.comparison.from)} – ${shortDate(phase.comparison.to)}`
      : `${def.personLabel}  |  ${scheduleKindLabel(def.target)}`;

  const footerNote =
    phase.kind === "upload" ? "Nucleus compares the sheet with what's in the app. Nothing changes until you apply."
      : phase.kind === "compare" ? "Only rows set to the sheet are changed."
        : phase.kind === "saving" ? "Saving…"
          : "";

  return (
    <>
      <div onClick={onClose} style={{ ...mm.backdrop, position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1100 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compare a schedule"
        style={{ ...mm.panel,
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: phase.kind === "compare" ? "min(860px, calc(100vw - 32px))" : "min(660px, calc(100vw - 32px))",
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

        {phase.kind === "upload" && (
          <UploadPhase
            t={t} dark={dark} sheet={sheet}
            onDrop={onDrop} onPickFile={onPickFile}
            onClear={() => setSheet(null)}
          />
        )}

        {phase.kind === "compare" && (
          <ComparePhase
            comparison={phase.comparison}
            fileName={phase.fileName}
            choices={choices}
            onChoose={setChoice}
            onAll={setAll}
            t={t} dark={dark}
            personName={def.personLabel}
          />
        )}

        {phase.kind === "saving" && (
          <div style={{ padding: "48px 16px", textAlign: "center", color: t.text2, fontSize: 13 }}>
            Updating the schedule…
          </div>
        )}

        {phase.kind === "saved" && (
          <div style={{ padding: "32px 24px", textAlign: "center" }}>
            <div style={{ fontFamily: BRAND_FONT, fontSize: 17, fontWeight: 600, color: t.text }}>
              Updated {phase.changed} {phase.changed === 1 ? "day" : "days"}.
            </div>
            <div style={{ fontSize: 12.5, color: t.text2, marginTop: 6, lineHeight: 1.45 }}>
              They're on the schedule now and synced to iOS.
            </div>
          </div>
        )}

        {err && (
          <div style={{ flexShrink: 0, padding: "10px 22px 0", fontSize: 12.5, color: t.clayText, lineHeight: 1.45 }}>{err}</div>
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
              <button type="button" onClick={onCompare} disabled={!sheet} style={primaryBtn(!sheet, t)}>
                Compare
              </button>
            </>
          )}
          {phase.kind === "compare" && (
            phase.comparison.diffs.length === 0 && phase.comparison.onCall.length === 0 ? (
              <button type="button" onClick={onClose} style={primaryBtn(false, t)}>Done</button>
            ) : (
              <>
                <button type="button" onClick={onClose} style={ghostBtn(t)}>Cancel</button>
                <button type="button" onClick={onApply} disabled={applyCount === 0} style={primaryBtn(applyCount === 0, t)}>
                  {applyCount === 0 ? "Nothing to change" : `Change ${applyCount} ${applyCount === 1 ? "day" : "days"}`}
                </button>
              </>
            )
          )}
          {phase.kind === "saved" && (
            <button type="button" onClick={onClose} style={primaryBtn(false, t)}>Done</button>
          )}
          {phase.kind === "saving" && (
            <button type="button" onClick={onClose} style={ghostBtn(t)}>Cancel</button>
          )}
        </div>
      </div>
    </>
  );
}

// ── Compare phase ────────────────────────────────────────────────────────────

const KIND_LABEL: Record<ShiftDiff["kind"], string> = {
  "different": "DIFFERENT HOURS",
  "sheet-only": "ONLY ON THE SHEET",
  "app-only": "ONLY IN THE APP",
};

const GRID = "92px 1fr 1fr 150px";

function ComparePhase({
  comparison, fileName, choices, onChoose, onAll, t, dark, personName,
}: {
  comparison: Comparison;
  fileName: string;
  choices: Record<string, Choice>;
  onChoose: (key: string, c: Choice) => void;
  onAll: (c: Choice) => void;
  t: ThemeTokens;
  dark: boolean;
  personName: string;
}) {
  const { diffs, onCall, matches, from, to } = comparison;
  const paper = dark ? "rgba(255,255,255,0.03)" : "#F7F6F3";
  const total = diffs.length + onCall.length;

  const chip = (n: number, text: string, tone: "ok" | "warn") => (
    <span
      style={{
        display: "inline-flex", alignItems: "center", height: 32, padding: "0 14px", borderRadius: 4,
        background: tone === "ok" ? t.tealTint : t.clayTint,
        color: tone === "ok" ? t.tealText : t.clayText,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 7, lineHeight: 1 }}>
        <span style={{ fontFamily: BRAND_FONT, fontSize: 15, fontWeight: 700 }}>{n}</span>
        <span style={{ fontSize: 13.5 }}>{text}</span>
      </span>
    </span>
  );

  const by = (k: ShiftDiff["kind"]) => diffs.filter((d) => d.kind === k).length;

  if (total === 0) {
    return (
      <div style={{ padding: "36px 24px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", marginBottom: 10 }}><CheckIcon color={BRAND_TEAL} size={30} /></div>
        <div style={{ fontFamily: BRAND_FONT, fontSize: 17, fontWeight: 600, color: t.text }}>
          The sheet and the app agree.
        </div>
        <div style={{ fontSize: 13, color: t.text2, marginTop: 6, lineHeight: 1.5 }}>
          {personName}'s {matches} {matches === 1 ? "shift" : "shifts"} from {shortDate(from)} to {shortDate(to)} match {fileName}.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 22px 0", flexWrap: "wrap" }}>
        {chip(matches, matches === 1 ? "day matches" : "days match", "ok")}
        {by("different") > 0 && chip(by("different"), "different hours", "warn")}
        {by("sheet-only") > 0 && chip(by("sheet-only"), "only on the sheet", "warn")}
        {by("app-only") > 0 && chip(by("app-only"), "only in the app", "warn")}
        {onCall.length > 0 && chip(onCall.length, onCall.length === 1 ? "on-call difference" : "on-call differences", "warn")}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 14 }}>
          <button type="button" onClick={() => onAll("sheet")} style={{ ...linkBtn(BRAND_TEAL), textDecoration: "underline" }}>Use the sheet for all</button>
          <button type="button" onClick={() => onAll("app")} style={{ ...linkBtn(t.text2), textDecoration: "underline" }}>Keep the app for all</button>
        </span>
      </div>

      <div style={{ padding: "12px 22px 0", fontSize: 13, color: t.text2, lineHeight: 1.45 }}>
        Days not listed here agree. A day the sheet leaves empty counts as a day off.
      </div>

      <div style={{ padding: "12px 22px 12px" }}>
        <div
          style={{
            display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "0 0 8px 13px",
            borderBottom: `1px solid ${t.sep}`, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", color: t.text3,
          }}
        >
          <span>DATE</span><span>THE SHEET</span><span>THE APP</span><span>USE</span>
        </div>

        {diffs.map((d, i) => (
          <DiffRow
            key={`s${d.date}`}
            first={i === 0}
            paper={paper}
            t={t}
            date={d.date}
            tag={KIND_LABEL[d.kind]}
            sheet={sheetText(d)}
            sheetEmpty={!d.sheet}
            app={d.app}
            appEmpty={d.app.length === 0}
            choice={choices[`s:${d.date}`] ?? "app"}
            disabledNote={d.locked ?? (unreadable(d) ? (d.sheet?.start ? "The sheet doesn't say when it ends." : "Can't read those hours.") : undefined)}
            onChoose={(c) => onChoose(`s:${d.date}`, c)}
          />
        ))}

        {onCall.map((o, i) => (
          <DiffRow
            key={`o${o.date}`}
            first={diffs.length === 0 && i === 0}
            paper={paper}
            t={t}
            date={o.date}
            tag="ON CALL"
            sheet={o.kind === "sheet-only" ? "On call" : "Not on call"}
            sheetEmpty={o.kind !== "sheet-only"}
            app={[]}
            appText={o.kind === "app-only" ? "On call" : "Not on call"}
            appEmpty={o.kind !== "app-only"}
            choice={choices[`o:${o.date}`] ?? "sheet"}
            onChoose={(c) => onChoose(`o:${o.date}`, c)}
          />
        ))}
      </div>
    </div>
  );
}

function DiffRow({
  first, paper, t, date, tag, sheet, sheetEmpty, app, appText, appEmpty, choice, disabledNote, onChoose,
}: {
  first: boolean;
  paper: string;
  t: ThemeTokens;
  date: string;
  tag: string;
  sheet: string;
  sheetEmpty: boolean;
  app: AppShiftInfo[];
  appText?: string;
  appEmpty: boolean;
  choice: Choice;
  disabledNote?: string;
  onChoose: (c: Choice) => void;
}) {
  const side = (text: string, empty: boolean, picked: boolean) => (
    <div style={{ minWidth: 0, minHeight: 38, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ fontSize: 13.5, fontWeight: picked ? 600 : 400, color: empty ? t.text3 : t.text, fontVariantNumeric: "tabular-nums" }}>{text}</div>
    </div>
  );
  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: GRID, gap: 10, alignItems: "start",
        padding: "10px 0 10px 10px", marginLeft: -10,
        borderTop: first ? "none" : `1px solid ${t.sep}`,
        borderLeft: `3px solid ${CLAY}`,
        background: paper,
      }}
    >
      <div style={{ minHeight: 38, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>{weekday(date)} {shortDate(date)}</div>
      </div>
      {side(sheet, sheetEmpty, choice === "sheet")}
      {appEmpty || appText
        ? side(appText ?? "No shift", appEmpty, choice === "app")
        : (
          <div style={{ minWidth: 0, minHeight: 38, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            {app.map((a, i) => (
              <div key={i} style={{ fontSize: 13.5, fontWeight: choice === "app" ? 600 : 400, color: t.text, fontVariantNumeric: "tabular-nums" }}>{hours(a)}</div>
            ))}
          </div>
        )}
      <div>
        <div role="group" aria-label={`Use for ${shortDate(date)}`} style={{ display: "inline-flex", border: `1px solid ${t.sep}`, borderRadius: 4, overflow: "hidden", height: 38 }}>
          {(["sheet", "app"] as const).map((c) => {
            const on = choice === c;
            const blocked = c === "sheet" && !!disabledNote;
            return (
              <button
                key={c}
                type="button"
                disabled={blocked}
                aria-pressed={on}
                title={blocked ? disabledNote : undefined}
                onClick={() => onChoose(c)}
                style={{
                  padding: "0 14px", border: 0, cursor: blocked ? "not-allowed" : "pointer",
                  background: on ? BRAND_TEAL : t.bgElev, color: on ? "#FFFFFF" : blocked ? t.text3 : t.text,
                  fontFamily: BRAND_FONT, fontSize: 12.5, fontWeight: 600,
                }}
              >
                {c === "sheet" ? "Sheet" : "App"}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.08em", color: t.clayText, marginTop: 5 }}>{tag}</div>
        {disabledNote && <div style={{ fontSize: 11, color: t.text3, marginTop: 3, lineHeight: 1.35 }}>{disabledNote}</div>}
      </div>
    </div>
  );
}

// ── Upload phase ─────────────────────────────────────────────────────────────

/** The schedule export is a spreadsheet; nothing else is read here. */
export function isSpreadsheet(file: File): boolean {
  return /\.(xlsx|xlsm)$/i.test(file.name) ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function UploadPhase({
  t, dark, sheet, onDrop, onPickFile, onClear,
}: {
  t: ThemeTokens;
  dark: boolean;
  sheet: { name: string; size: number; result: XlsxParseResult } | null;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPickFile: (f: File) => void;
  onClear: () => void;
}) {
  const paper = dark ? "rgba(255,255,255,0.03)" : "#F7F6F3";
  const r = sheet?.result;
  return (
    <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "18px 22px 8px", display: "flex", flexDirection: "column", gap: 16 }}>
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
        {sheet && r ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
            <SheetIcon color={BRAND_TEAL} />
            <div style={{ fontFamily: BRAND_FONT, fontSize: 16, fontWeight: 600, color: t.text, marginTop: 4 }}>{sheet.name}</div>
            <div style={{ fontSize: 13, color: t.text2 }}>
              {r.rows.length} shift{r.rows.length === 1 ? "" : "s"} · {shortDate(r.dateFrom as string)} – {shortDate(r.dateTo as string)} · {fileSize(sheet.size)}
            </div>
            <button type="button" onClick={onClear} style={linkBtn(t.text2)}>Choose a different file</button>
          </div>
        ) : (
          <div style={{ textAlign: "center" }}>
            <SheetIcon color={t.text3} />
            <div style={{ fontFamily: BRAND_FONT, fontSize: 16.5, fontWeight: 600, color: t.text, marginTop: 12, letterSpacing: "-0.01em" }}>
              Drop the schedule's spreadsheet
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
                accept=".xlsx,.xlsm"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); }}
                style={{ display: "none" }}
              />
            </label>
          </div>
        )}
      </div>

      <div style={{ fontSize: 12.5, color: t.text3 }}>
        An .xlsx export only. It's read here on this Mac, and compared with what the app already has.
      </div>
    </div>
  );
}

/** Bytes as the user thinks of them — "2.4 MB". */
function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ── Icons ────────────────────────────────────────────────────────────────────

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
function CheckIcon({ color, size = 17 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l5 5 9-11" />
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
