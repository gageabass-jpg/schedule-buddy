import { useEffect, useMemo, useState } from "react";
import { rgba, BRAND_FONT, type Palette, type ThemeTokens } from "../theme";
import type { HouseholdState } from "../state";
import { hmToMin, daisyCoverageConflict, type OverlapCandidate, type MinuteRange, type DaySegments } from "../lib/computeOverlap";
import { addCoverageRequests, type CoverageRequestInput } from "../lib/writeCoverageRequest";
import { pendingCoverageNeeds } from "../lib/pendingCoverageNeeds";
import { timelineForDate, parentShiftStarts } from "../lib/timelineData";
import { DayTimeline } from "./DayTimeline";

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
/** Just the shift start time(s) for the "Working hours" column. */
function startsLabel(starts: number[]): string {
  if (starts.length === 0) return "off";
  return starts.map(hm12).join(", ");
}
/** "13:00" → "01:00 PM" for a coverage-window pill. */
function pill12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = (h ?? 0) < 12 ? "AM" : "PM";
  const hh = ((h ?? 0) % 12) || 12;
  return `${String(hh).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")} ${ap}`;
}
function durationHours(startTime: string, endTime: string, endsNextDay?: boolean): string {
  const h = (hmToMin(endTime, endsNextDay) - hmToMin(startTime)) / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

export function CoverageRequestModal({
  open, onClose, palette, t, dark, householdId, state, today,
}: Props) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-seed each open. Logic is unchanged from before the redesign: today
  // forward, engine windows (lead + travel already folded in), minus days
  // already lined up.
  useEffect(() => {
    if (!open) return;
    if (!state) { setRows([]); return; }
    const candidates = pendingCoverageNeeds(state, today);
    setRows(candidates.map((c, i) => ({ ...c, rowId: `${c.date}#${i}`, notes: "", skipped: false })));
    setOpenRow(null);
    setErr(null);
  }, [open, state, today]);

  const selfName = state?.selfName || "You";
  const partnerName = state?.partner?.name || "Kaylene";
  const daisyName = state?.dependents?.daisy?.name || "Daisy";
  // Design green as a solid accent color, darkened in light / lightened in dark
  // so it clears contrast on both the tinted chip and the white card.
  const greenText = dark ? "#56B7A9" : "#0F6E64";

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

  const keep = rows.filter((r) => !r.skipped);
  const update = (rowId: string, patch: Partial<DraftRow>) =>
    setRows((arr) => arr.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));

  const onSend = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    if (keep.length === 0) { setErr("Every day is denied."); return; }
    setErr(null);
    setBusy(true);
    try {
      const inputs: CoverageRequestInput[] = keep.map((r) => ({
        date: r.date, startTime: r.startTime, endTime: r.endTime,
        endsNextDay: r.endsNextDay, notes: r.notes || undefined, reason: r.reason,
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
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "24px 28px 16px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: t.text3 }}>Batch request</div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", color: t.text, marginTop: 3, fontFamily: BRAND_FONT }}>Send to caregiver</div>
            <div style={{ fontSize: 13, color: t.text2, marginTop: 5, lineHeight: 1.45, maxWidth: 520 }}>
              Upcoming days where both of you are unavailable and no coverage is lined up yet. The start is when the caregiver should arrive. Adjust times or notes, then send the batch.
            </div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 14, background: rgba("#0F6E64", dark ? 0.2 : 0.12), color: greenText, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#0F6E64" }} />
            {keep.length} of {rows.length} ready
          </div>
        </div>

        {/* Column labels */}
        {rows.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "6px 28px", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: t.text3 }}>
            <span style={{ width: 74, flexShrink: 0 }}>Date</span>
            <span style={{ width: 300, flexShrink: 0 }}>Coverage window</span>
            <span style={{ flex: 1 }}>Working hours</span>
            <span style={{ width: 84, textAlign: "center", flexShrink: 0 }}>Hrs</span>
            <span style={{ width: 34, flexShrink: 0 }} />
          </div>
        )}

        {/* Rows */}
        <div style={{ padding: "0 20px 16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 200 }}>
          {rows.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: t.text3, fontSize: 13 }}>
              No upcoming days need coverage. Days before today, and days that already have coverage lined up, are hidden.
            </div>
          ) : rows.map((r) => {
            const [, mm, dd] = r.date.split("-").map(Number);
            const dt = new Date(r.date.split("-").map(Number)[0], (mm || 1) - 1, dd || 1);
            const monthAbbr = dt.toLocaleDateString(undefined, { month: "short" }).toUpperCase();
            const weekday = dt.toLocaleDateString(undefined, { weekday: "short" });
            const info = dayInfoByDate[r.date] ?? { self: { work: [], sleep: [] }, partner: { work: [], sleep: [] }, selfStarts: [], partnerStarts: [], daisy: [] };
            const daisyClash = state ? daisyCoverageConflict(state, r.date, r.startTime, r.endTime, r.endsNextDay) : null;
            const isOpen = openRow === r.rowId;
            const coverage: MinuteRange = { startMin: hmToMin(r.startTime), endMin: hmToMin(r.endTime, r.endsNextDay) };
            return (
              <div key={r.rowId} style={{ opacity: r.skipped ? 0.45 : 1 }}>
                <div
                  onClick={() => setOpenRow(isOpen ? null : r.rowId)}
                  title={isOpen ? "Hide day timeline" : "Show day timeline"}
                  style={{ display: "flex", alignItems: "center", gap: 16, minHeight: 88, cursor: "pointer", background: dark ? "rgba(255,255,255,0.04)" : "#fff", borderRadius: 18, padding: "12px 16px 12px 0", boxShadow: dark ? "none" : "0 1px 3px rgba(0,0,0,0.05)", border: dark ? `0.5px solid ${t.sep}` : "none" }}
                >
                  {/* Accent */}
                  <div style={{ width: 4, alignSelf: "stretch", margin: "8px 0", borderRadius: 4, background: "linear-gradient(180deg,#56B7A9,#0F6E64)", boxShadow: `0 0 10px ${rgba("#0F6E64", 0.55)}`, flexShrink: 0 }} />
                  {/* Date */}
                  <div style={{ width: 74, textAlign: "center", flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#8A4B38" }}>{monthAbbr}</div>
                    <div style={{ fontSize: 30, fontWeight: 800, color: t.text, lineHeight: 1 }}>{dd}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: t.text3 }}>{weekday}</div>
                  </div>
                  {/* Coverage window pills */}
                  <div onClick={(e) => e.stopPropagation()} style={{ width: 300, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <TimePill value={r.startTime} onChange={(v) => update(r.rowId, { startTime: v })} display={pill12(r.startTime)} t={t} dark={dark} />
                    <span style={{ color: t.text3 }}>→</span>
                    <TimePill value={r.endTime} onChange={(v) => update(r.rowId, { endTime: v })} display={pill12(r.endTime)} t={t} dark={dark} />
                    {r.endsNextDay && <span style={{ fontSize: 10, color: t.text3, fontWeight: 700 }}>+1d</span>}
                  </div>
                  {/* Working hours — each parent's shift START time(s) */}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    <HoursPill letter={selfName[0]?.toUpperCase() || "G"} text={startsLabel(info.selfStarts)} accent={palette.G} bg={rgba(palette.G, dark ? 0.22 : 0.12)} t={t} />
                    <HoursPill letter={partnerName[0]?.toUpperCase() || "K"} text={startsLabel(info.partnerStarts)} accent={palette.K} bg={rgba(palette.K, dark ? 0.24 : 0.12)} t={t} />
                    {daisyClash && (
                      <span title="Daisy has class during this window — she may not be able to cover"
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#8A4B38" }}>
                        ⚠ {daisyName} in class
                      </span>
                    )}
                  </div>
                  {/* Hrs */}
                  <div style={{ width: 84, display: "flex", alignItems: "baseline", justifyContent: "center", gap: 5, flexShrink: 0 }}>
                    <span style={{ width: 34, textAlign: "right", fontSize: 22, fontWeight: 800, color: greenText }}>{durationHours(r.startTime, r.endTime, r.endsNextDay)}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: dark ? "#56B7A9" : "#0F6E64" }}>Hours</span>
                  </div>
                  {/* Approve / deny */}
                  <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 7, flexShrink: 0, marginLeft: 4 }}>
                    <RoundBtn label="✓" active={!r.skipped} color="#0F6E64" t={t} dark={dark}
                      title="Approve — include in the batch" onClick={() => update(r.rowId, { skipped: false })} />
                    <RoundBtn label="✕" active={r.skipped} color="#8A4B38" t={t} dark={dark}
                      title="Deny — leave out of the batch" onClick={() => update(r.rowId, { skipped: true })} />
                  </div>
                </div>
                {isOpen && (
                  <div style={{ padding: "0 6px" }}>
                    <DayTimeline date={r.date} self={info.self} partner={info.partner} daisy={info.daisy} daisyName={daisyName}
                      coverage={coverage} selfName={selfName} partnerName={partnerName} includeWeekday
                      palette={palette} t={t} dark={dark} />
                    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 6px 10px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: t.text3, flexShrink: 0 }}>Note</span>
                      <input type="text" value={r.notes} onChange={(e) => update(r.rowId, { notes: e.target.value })}
                        placeholder="e.g. dinner ready in fridge"
                        style={{ flex: 1, padding: "8px 12px", borderRadius: 11, border: `1px solid ${t.sep}`, background: dark ? "rgba(255,255,255,0.05)" : "#fff", color: t.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {err && <div style={{ fontSize: 12, color: "#8A4B38", padding: "8px 28px 0" }}>{err}</div>}

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "18px 28px 24px", borderTop: `1px solid ${t.sep}` }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ padding: "11px 22px", borderRadius: 14, border: `1px solid ${t.sep}`, background: dark ? "rgba(255,255,255,0.05)" : "#fff", color: t.text2, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button type="button" onClick={onSend} disabled={busy || keep.length === 0}
            style={{ padding: "11px 22px", borderRadius: 14, border: 0, background: "#0F6E64", color: "#fff", fontSize: 15, fontWeight: 700, cursor: busy || keep.length === 0 ? "not-allowed" : "pointer", opacity: busy || keep.length === 0 ? 0.5 : 1, fontFamily: "inherit", boxShadow: "0 6px 18px rgba(15,110,100,0.35)" }}>
            {busy ? "Sending…" : `Send ${keep.length} request${keep.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </>
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

function HoursPill({ letter, text, accent, bg, t }: { letter: string; text: string; accent: string; bg: string; t: ThemeTokens }) {
  // The person's color rides on the bold letter (an accent glyph, not the info),
  // while the time range stays in t.text so it's legible on the tint in both
  // themes regardless of which palette is active.
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 20, background: bg, fontSize: 13, fontWeight: 700, alignSelf: "flex-start", maxWidth: "100%" }}>
      <b style={{ fontWeight: 800, color: accent }}>{letter}</b>
      <span style={{ color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
    </span>
  );
}

function RoundBtn({ label, active, color, title, onClick, t, dark }: {
  label: string; active: boolean; color: string; title: string; onClick: () => void; t: ThemeTokens; dark: boolean;
}) {
  // The glyph always carries its color (green ✓ / red ✕) so the affordance
  // reads at a glance; the tinted fill just deepens on the active choice.
  return (
    <button type="button" title={title} onClick={onClick}
      style={{
        width: 30, height: 30, borderRadius: "50%", border: 0, cursor: "pointer", fontFamily: "inherit",
        fontSize: 13, fontWeight: 800, lineHeight: 1,
        background: active ? rgba(color, dark ? 0.3 : 0.18) : (dark ? "rgba(255,255,255,0.06)" : "#F7F6F3"),
        color: color,
        opacity: active ? 1 : 0.6,
      }}>
      {label}
    </button>
  );
}
