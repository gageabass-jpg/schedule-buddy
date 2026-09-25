import { useEffect, useMemo, useState } from "react";
import { rgba, BRAND_FONT, type Palette, type ThemeTokens } from "../theme";
import type { HouseholdState } from "../state";
import { hmToMin, daisyCoverageConflict, type OverlapCandidate, type MinuteRange, type DaySegments } from "../lib/computeOverlap";
import { addCoverageRequests, type CoverageRequestInput } from "../lib/writeCoverageRequest";
import { pendingCoverageNeeds } from "../lib/pendingCoverageNeeds";
import { timelineForDate, parentShiftStarts } from "../lib/timelineData";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
  /** Same date the Inspector's reminder card used, so the card's count and
   *  these rows can't resolve different days across a midnight boundary. */
  today: string;
}

interface DraftRow extends OverlapCandidate {
  /** A date can carry multiple windows, so date alone isn't unique. */
  rowId: string;
  notes: string;
  skipped: boolean;
}

/** minutes-past-midnight → "11am" / "9:30am" / "11:30pm" (12h, compact). */
function hm12(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h < 12 ? "am" : "pm";
  h = h % 12 || 12;
  return mm === 0 ? `${h}${ap}` : `${h}:${String(mm).padStart(2, "0")}${ap}`;
}
/** "13:00" → "01:00 PM" for a coverage-window pill. */
function pill12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = (h ?? 0) < 12 ? "AM" : "PM";
  const hh = ((h ?? 0) % 12) || 12;
  return `${String(hh).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")} ${ap}`;
}
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function countWord(n: number): string { return n <= 10 ? COUNT_WORDS[n] : String(n); }

function durationHours(startTime: string, endTime: string, endsNextDay?: boolean): string {
  const h = (hmToMin(endTime, endsNextDay) - hmToMin(startTime)) / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

export function CoverageRequestModal({
  open, onClose, palette, t, dark, householdId, state, today,
}: Props) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** One note that goes out with every day, rather than a note per row. */
  const [message, setMessage] = useState("");
  /** Ready-to-send groups start collapsed; each shares a window. */
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  // Re-seed each open. Logic is unchanged from before the redesign: today
  // forward, engine windows (lead + travel already folded in), minus days
  // already lined up.
  useEffect(() => {
    if (!open) return;
    if (!state) { setRows([]); return; }
    const candidates = pendingCoverageNeeds(state, today);
    setRows(candidates.map((c, i) => ({ ...c, rowId: `${c.date}#${i}`, notes: "", skipped: false })));
    setOpenGroup(null);
    setErr(null);
    setMessage("");
  }, [open, state, today]);

  const selfName = state?.selfName || "You";
  const partnerName = state?.partner?.name || "Kaylene";
  const daisyName = state?.dependents?.daisy?.name || "Daisy";

  // Per-parent availability by date — depends only on the schedule, not on the
  // per-row time edits, so it doesn't rebuild on every keystroke.
  const datesKey = rows.map((r) => r.date).join(",");
  const dayInfoByDate = useMemo(() => {
    const map: Record<string, { self: DaySegments; partner: DaySegments; selfStarts: number[]; partnerStarts: number[]; daisy: MinuteRange[] }> = {};
    for (const r of rows) {
      if (map[r.date]) continue;
      const tl = timelineForDate(state, r.date, null);
      const starts = parentShiftStarts(state, r.date);
      map[r.date] = { self: tl.self, partner: tl.partner, selfStarts: starts.self, partnerStarts: starts.partner, daisy: tl.daisy };
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, datesKey]);

  if (!open) return null;

  // What the header and the two sections are made of. A day whose window runs
  // into Daisy's class needs a decision, so those sort first; the rest share
  // windows and are grouped, because deciding them one at a time is busywork.
  const clashFor = (r: DraftRow): MinuteRange | null =>
    state ? daisyCoverageConflict(state, r.date, r.startTime, r.endTime, r.endsNextDay) : null;

  const withClash = rows.filter((r) => clashFor(r));
  const withoutClash = rows.filter((r) => !clashFor(r));

  const hoursOf = (r: DraftRow) => (hmToMin(r.endTime, r.endsNextDay) - hmToMin(r.startTime)) / 60;
  const totalHours = rows.filter((r) => !r.skipped).reduce((sum, r) => sum + hoursOf(r), 0);

  const fmtDay = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const sorted = [...rows].map((r) => r.date).sort();
  const rangeLabel = sorted.length ? `${fmtDay(sorted[0])} to ${fmtDay(sorted[sorted.length - 1])}` : "";

  /** Ready days that share a window are one line with a count. */
  const groups = Object.values(
    withoutClash.reduce<Record<string, { key: string; window: string; rows: DraftRow[] }>>((acc, r) => {
      const key = `${r.startTime}-${r.endTime}-${r.endsNextDay ? 1 : 0}`;
      acc[key] ??= { key, window: `${hm12(hmToMin(r.startTime))} – ${hm12(hmToMin(r.endTime, r.endsNextDay))}`, rows: [] };
      acc[key].rows.push(r);
      return acc;
    }, {}),
  ).sort((a, b) => b.rows.length - a.rows.length);



  const keep = rows.filter((r) => !r.skipped);
  const update = (rowId: string, patch: Partial<DraftRow>) =>
    setRows((arr) => arr.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));

  const onSend = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    if (keep.length === 0) { setErr("Every day is denied."); return; }
    setErr(null);
    setBusy(true);
    try {
      const shared = message.trim();
      const inputs: CoverageRequestInput[] = keep.map((r) => ({
        date: r.date, startTime: r.startTime, endTime: r.endTime,
        endsNextDay: r.endsNextDay,
        notes: [shared, r.notes.trim()].filter(Boolean).join(" — ") || undefined,
        reason: r.reason,
      }));
      await addCoverageRequests(householdId, inputs);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send the requests.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }} />
      <div
        role="dialog" aria-modal="true" aria-label="Send to caregiver"
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: "min(780px, calc(100vw - 32px))", maxHeight: "calc(100vh - 64px)",
          background: dark ? t.bgElev : "#F7F6F3", color: t.text,
          borderRadius: 22, boxShadow: "0 30px 80px rgba(0,0,0,0.4)",
          zIndex: 1101, fontFamily: "inherit", display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header — who, how many days, over what span, and the total ask. */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "22px 26px 14px", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: t.text3 }}>Coverage request</div>
            <div style={{ fontFamily: BRAND_FONT, fontSize: 25, fontWeight: 600, letterSpacing: "-0.02em", color: t.text, marginTop: 4 }}>
              Ask {daisyName} to cover {countWord(keep.length)} day{keep.length === 1 ? "" : "s"}
            </div>
            <div style={{ fontSize: 13.5, color: t.text2, marginTop: 5 }}>{rangeLabel}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <button type="button" onClick={onClose} aria-label="Close"
              style={{ width: 34, height: 34, borderRadius: "50%", border: 0, background: dark ? "rgba(255,255,255,0.08)" : "#EDECE8", color: t.text2, fontSize: 16, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
          </div>
        </div>

        {/* What the caregiver's own timetable does to this batch. */}
        {withClash.length > 0 && (
          <div style={{ margin: "0 26px 14px", padding: "12px 14px", borderRadius: 6, background: dark ? rgba("#8A4B38", 0.16) : "#EFDFDB", border: `1px dashed ${rgba("#8A4B38", 0.5)}`, flexShrink: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#8A4B38" }}>
              ⚠ {countWord(withClash.length).replace(/^./, (c) => c.toUpperCase())} of these run into her class time
            </div>
            <div style={{ fontSize: 12.5, color: "#8A4B38", marginTop: 3, lineHeight: 1.45 }}>
              Some requested shifts overlap with {daisyName}&rsquo;s class schedule. Review who&rsquo;s home and your scheduled hours to determine a course of action.
            </div>
          </div>
        )}

        {/* Legend for the timelines. */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 26px 12px", flexWrap: "wrap", flexShrink: 0 }}>
          <LegendKey color={palette.G} label={`${selfName} at work`} t={t} />
          <LegendKey color={palette.K} label={`${partnerName} at work`} t={t} />
          <LegendKey color={dark ? "#6B7672" : "#5A6663"} label={`${daisyName} in class`} t={t} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: t.text2 }}>
            <span style={{ width: 22, height: 10, borderRadius: 2, border: `1px dashed ${rgba("#8A4B38", 0.7)}`, background: dark ? rgba("#8A4B38", 0.15) : "#EFDFDB" }} />
            Hours Requested
          </span>
        </div>

        <div style={{ padding: "0 26px 16px", overflowY: "auto", flex: 1, minHeight: 180 }}>
          {rows.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: t.text3, fontSize: 13 }}>
              No upcoming days need coverage. Days before today, and days that already have coverage lined up, are hidden.
            </div>
          )}

          {/* Days that need a decision come first. */}
          {withClash.length > 0 && (
            <SectionHead t={t} label="Needs review" count={withClash.length} />
          )}
          {withClash.map((r) => {
            const [, mm, dd] = r.date.split("-").map(Number);
            const dt = new Date(r.date.split("-").map(Number)[0], (mm || 1) - 1, dd || 1);
            const info = dayInfoByDate[r.date] ?? { self: { work: [], sleep: [] }, partner: { work: [], sleep: [] }, selfStarts: [], partnerStarts: [], daisy: [] };
            const coverage: MinuteRange = { startMin: hmToMin(r.startTime), endMin: hmToMin(r.endTime, r.endsNextDay) };
            return (
              <div key={r.rowId}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", marginBottom: 10, borderRadius: 6, background: dark ? "rgba(255,255,255,0.03)" : "#fff", border: `1px dashed ${rgba("#8A4B38", 0.45)}`, opacity: r.skipped ? 0.45 : 1 }}>
                <Tick checked={!r.skipped} onChange={(v) => update(r.rowId, { skipped: !v })} />
                <DateBlock month={dt.toLocaleDateString(undefined, { month: "short" }).toUpperCase()} day={dd ?? 1} weekday={dt.toLocaleDateString(undefined, { weekday: "short" })} t={t} />
                <div style={{ width: 200, flexShrink: 0 }}>
                  <MiniTimeline self={info.self.work} partner={info.partner.work} daisy={info.daisy}
                    coverage={coverage} palette={palette} t={t} dark={dark} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: BRAND_FONT, fontSize: 15, fontWeight: 600, color: t.text }}>
                    {hm12(hmToMin(r.startTime))} – {hm12(hmToMin(r.endTime, r.endsNextDay))}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#8A4B38", marginTop: 3 }}>⚠ {daisyName} has class</div>
                </div>
                <div style={{ width: 44, textAlign: "right", fontSize: 14, fontWeight: 700, color: t.text2, flexShrink: 0 }}>
                  {durationHours(r.startTime, r.endTime, r.endsNextDay)}h
                </div>
              </div>
            );
          })}

          {/* The rest, grouped by the window they share. */}
          {groups.length > 0 && (
            <SectionHead t={t} label="Ready to send" count={withoutClash.length} />
          )}
          {groups.map((g) => {
            const isOpen = openGroup === g.key;
            const hours = g.rows.reduce((sum, r) => sum + hoursOf(r), 0);
            const allOn = g.rows.every((r) => !r.skipped);
            return (
              <div key={g.key} style={{ marginBottom: 10, borderRadius: 6, background: dark ? "rgba(255,255,255,0.03)" : "#fff", border: `1px solid ${t.sep}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px" }}>
                  <Tick checked={allOn} onChange={(v) => g.rows.forEach((r) => update(r.rowId, { skipped: !v }))} />
                  <div style={{ width: 30, textAlign: "center", fontFamily: BRAND_FONT, fontSize: 20, fontWeight: 700, color: t.text, flexShrink: 0 }}>{g.rows.length}</div>
                  <div style={{ width: 180, flexShrink: 0, fontFamily: BRAND_FONT, fontSize: 15, fontWeight: 600, color: t.text }}>{g.window}</div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: t.text3 }}>No clash with her timetable</div>
                  <div style={{ width: 44, textAlign: "right", fontSize: 14, fontWeight: 700, color: t.text2, flexShrink: 0 }}>{Math.round(hours)}h</div>
                  <button type="button" onClick={() => setOpenGroup(isOpen ? null : g.key)}
                    style={{ padding: "9px 12px", borderRadius: 4, border: `1px solid ${t.sep}`, background: "transparent", color: t.text, fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
                    ✎ Change all {g.rows.length}
                  </button>
                </div>
                <div style={{ padding: "0 14px 10px", fontSize: 12, color: t.text3 }}>
                  {g.rows.map((r) => fmtDay(r.date)).join(", ")}
                </div>
                {isOpen && (
                  <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {g.rows.map((r) => (
                      <div key={r.rowId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 70, fontSize: 12.5, color: t.text2, flexShrink: 0 }}>{fmtDay(r.date)}</span>
                        <TimePill value={r.startTime} onChange={(v) => update(r.rowId, { startTime: v })} display={pill12(r.startTime)} t={t} dark={dark} />
                        <span style={{ color: t.text3 }}>→</span>
                        <TimePill value={r.endTime} onChange={(v) => update(r.rowId, { endTime: v })} display={pill12(r.endTime)} t={t} dark={dark} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* One note for the whole batch. It sits directly under a scrolling
            list, so it needs its own breathing room above the label. */}
        <div style={{ padding: "18px 26px 12px", flexShrink: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: t.text3, marginBottom: 9 }}>
            Message:
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder={`Hey ${daisyName} — take whichever of these work around your classes, and say no to the rest.`}
            style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 6, border: `1px solid ${t.sep}`, background: dark ? "rgba(255,255,255,0.04)" : "#fff", color: t.text, fontSize: 13.5, fontFamily: "inherit", outline: "none", resize: "vertical", lineHeight: 1.45 }}
          />
        </div>

        {err && <div style={{ fontSize: 12, color: "#8A4B38", padding: "8px 28px 0" }}>{err}</div>}

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 26px 20px", borderTop: `1px solid ${t.sep}`, background: dark ? "rgba(255,255,255,0.03)" : "#F7F6F3", flexShrink: 0 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: t.text2, lineHeight: 1.4 }}>
            {daisyName} gets one message listing {countWord(keep.length)} day{keep.length === 1 ? "" : "s"}. She accepts or declines them one at a time, and you see each answer as it lands.
          </span>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ padding: "11px 20px", borderRadius: 4, border: `1px solid ${t.sep}`, background: dark ? "rgba(255,255,255,0.05)" : "#fff", color: t.text, fontFamily: BRAND_FONT, fontSize: 14, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
            Cancel
          </button>
          <button type="button" onClick={onSend} disabled={busy || keep.length === 0}
            style={{ padding: "11px 20px", borderRadius: 4, border: 0, background: "#0F6E64", color: "#fff", fontFamily: BRAND_FONT, fontSize: 14, fontWeight: 600, cursor: busy || keep.length === 0 ? "not-allowed" : "pointer", opacity: busy || keep.length === 0 ? 0.5 : 1, flexShrink: 0 }}>
            {busy ? "Sending…" : `Send — ${keep.length} day${keep.length === 1 ? "" : "s"}, ${Math.round(totalHours)} hours`}
          </button>
        </div>
      </div>
    </>
  );
}

const AXIS_FROM = 6 * 60, AXIS_TO = 24 * 60;

/**
 * The day at a glance, on one line: each person's working (or class) hours as
 * a bar, and the window being asked for drawn dashed over them. Same axis as
 * the legend above it.
 */
function MiniTimeline({
  self, partner, daisy, coverage, palette, t, dark,
}: {
  self: MinuteRange[]; partner: MinuteRange[]; daisy: MinuteRange[];
  coverage: MinuteRange; palette: Palette; t: ThemeTokens; dark: boolean;
}) {
  const place = (r: MinuteRange) => {
    const a = Math.max(r.startMin, AXIS_FROM), b = Math.min(r.endMin, AXIS_TO);
    if (b <= a) return null;
    return { left: `${((a - AXIS_FROM) / (AXIS_TO - AXIS_FROM)) * 100}%`, width: `${((b - a) / (AXIS_TO - AXIS_FROM)) * 100}%` };
  };
  const lane = (ranges: MinuteRange[], color: string) => (
    <div style={{ position: "relative", height: 7 }}>
      {ranges.map((r, i) => {
        const p = place(r);
        return p && <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: p.left, width: p.width, borderRadius: 2, background: color }} />;
      })}
    </div>
  );
  const cov = place(coverage);
  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {lane(self, palette.G)}
        {lane(partner, palette.K)}
        {lane(daisy, dark ? "#6B7672" : "#5A6663")}
      </div>
      {cov && (
        <div style={{
          position: "absolute", top: -3, bottom: -3, left: cov.left, width: cov.width,
          borderRadius: 3, border: `1px dashed ${rgba("#8A4B38", 0.75)}`,
          background: dark ? rgba("#8A4B38", 0.14) : rgba("#8A4B38", 0.10),
        }} />
      )}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 9, color: t.text3 }}>
        <span>6a</span><span>12p</span><span>6p</span><span>12a</span>
      </div>
    </div>
  );
}

/** A swatch and what it means, above the timelines. */
function LegendKey({ color, label, t }: { color: string; label: string; t: ThemeTokens }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: t.text2 }}>
      <span style={{ width: 22, height: 6, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}

/** "NEEDS A LOOK 3", with the reason it is ordered that way. */
function SectionHead({ t, label, count }: { t: ThemeTokens; label: string; count: number }) {
  return (
    <div style={{ margin: "6px 0 10px", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: t.text3 }}>
      {label} <span style={{ color: t.text2 }}>{count}</span>
    </div>
  );
}

/** Include this day in the batch. */
function Tick({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      title={checked ? "Included — click to leave out" : "Left out — click to include"}
      style={{
        width: 22, height: 22, flexShrink: 0, padding: 0, borderRadius: 4, cursor: "pointer",
        border: checked ? "1px solid #0F6E64" : "1px solid #C9CCC8",
        background: checked ? "#0F6E64" : "transparent",
        color: "#fff", fontSize: 13, lineHeight: 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}
    >{checked ? "✓" : ""}</button>
  );
}

/** The date, stacked the way the prototype sets it. */
function DateBlock({ month, day, weekday, t }: { month: string; day: number; weekday: string; t: ThemeTokens }) {
  return (
    <div style={{ width: 46, textAlign: "center", flexShrink: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "#8A4B38" }}>{month}</div>
      <div style={{ fontFamily: BRAND_FONT, fontSize: 24, fontWeight: 700, color: t.text, lineHeight: 1.05 }}>{day}</div>
      <div style={{ fontSize: 10.5, color: t.text3 }}>{weekday}</div>
    </div>
  );
}

function TimePill({ value, onChange, display, t, dark }: {
  value: string; onChange: (v: string) => void; display: string; t: ThemeTokens; dark: boolean;
}) {
  // Native time input styled as a fixed-width pill. `display` is the intended
  // 12h label; the native control renders its own locale format on top, which
  // on US macOS is also 12h — kept editable so times can be adjusted.
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={display}
      style={{
        width: 118, textAlign: "center", padding: "9px 0", borderRadius: 11,
        border: `1px solid ${t.sep}`, background: dark ? "rgba(255,255,255,0.06)" : "#F7F6F3",
        color: t.text, fontSize: 14, fontWeight: 700, fontFamily: "inherit", outline: "none",
        colorScheme: dark ? "dark" : "light",
      }}
    />
  );
}


