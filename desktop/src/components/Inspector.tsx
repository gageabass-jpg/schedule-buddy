import { useState, useRef, useEffect } from "react";
import { dayKindFromShifts, MONTHS_LONG, WEEKDAYS_3, type Shift, type ShiftMap } from "../data";
import { buildShiftMap, compactTime, type CoverageStatus, type Event as SbEvent, type HouseholdState } from "../state";
import { dayColors, eventColor, lifeColor, personColor, rgba, type Palette, type ThemeTokens } from "../theme";
import { PhotoAv } from "./PhotoAv";
import { EventAvatar } from "./EventAvatar";
import { FatigueHeatmap } from "./FatigueHeatmap";
import { blockForDate } from "../lib/writeScheduleBlock";
import { daisyDayRanges, daisyCoverageConflict, type MinuteRange } from "../lib/computeOverlap";
import type { WvuGame } from "../lib/wvuSchedule";

interface Props {
  selected: string;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  shifts: ShiftMap;
  state: HouseholdState | null;
  selfName: string;
  partnerName: string;
  onEditShift?: (date: string, shift: Shift) => void;
  onDeleteShift?: (date: string, shift: Shift) => void;
  events: SbEvent[];
  /** All events keyed by date — powers the Life tab's next-60-days list. */
  eventsByDate: Record<string, SbEvent[]>;
  onAddEvent: () => void;
  onEditEvent: (ev: SbEvent) => void;
  onSendCoverageForDay: (date: string) => void;
  onToggleChildcareOff: (date: string, off: boolean) => void;
  onSelectDate?: (date: string) => void;
  onOpenScheduleBlock: () => void;
  onOpenCleaner: () => void;
  /** Reminder cards above the day card. `reminderUpdate` is the 4-week
   *  cadence nudge; `reminderCaregiver` is condition-driven (uncovered days). */
  reminderUpdate?: boolean;
  reminderCaregiver?: boolean;
  /** How many upcoming days still need a caregiver. */
  coverageNeedsCount?: number;
  onDismissReminder?: (which: "update" | "caregiver") => void;
  onSendCaregiverRequests?: () => void;
  wvuGames: Map<string, WvuGame>;
}

const COVERAGE_STATUS_COLOR: Record<CoverageStatus, string> = {
  pending:   "#14201E",
  confirmed: "#0F6E64",
  declined:  "#8A4B38",
  issue:     "#8A4B38",
};
const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  pending:   "Pending",
  confirmed: "Confirmed",
  declined:  "Declined",
  issue:     "Issue",
};

export function Inspector({
  selected, palette, t, dark, shifts: allShifts, state, selfName, partnerName,
  onEditShift, onDeleteShift, events, eventsByDate, onAddEvent, onEditEvent, onSendCoverageForDay,
  onToggleChildcareOff, onSelectDate,
  onOpenScheduleBlock, onOpenCleaner,
  reminderUpdate, reminderCaregiver, coverageNeedsCount = 0,
  onDismissReminder, onSendCaregiverRequests, wvuGames,
}: Props) {
  const [y, m, d] = selected.split("-").map(Number);
  const shifts = allShifts[selected];
  const wvuGame = wvuGames.get(selected);
  const kind = dayKindFromShifts(shifts);
  const colors = dayColors(kind, palette, dark);
  const accent = colors.accent;

  // Which shift row has its edit/delete buttons revealed. Double-click
  // the row to toggle. Single-click reading-only state stays calm.
  const [revealedIdx, setRevealedIdx] = useState<number | null>(null);
  const dayLabel = `${WEEKDAYS_3[new Date(y, m - 1, d).getDay()]} · ${MONTHS_LONG[m - 1]} ${d}`;

  // Coverage requests on the selected day.
  const dayCoverage = (state?.coverageRequests ?? []).filter((r) => r.date === selected);
  // A "gap" worth flagging = both partners working with no caregiver request yet.
  const isGapDay = kind === "both" && dayCoverage.length === 0;
  // Has this day been explicitly marked "no childcare" (caregiver off)?
  const isChildcareOff = (state?.childcareOff ?? []).some((c) => c.date === selected);
  // Schedule block covering this day (vacation, travel, etc.) — surfaces a
  // red striped notice card right under the Selected Day header.
  const dayBlock = blockForDate(state?.scheduleBlocks, selected);
  // Daisy's (caregiver) school time on the selected day — when she can't cover.
  const daisyName = state?.dependents?.daisy?.name || "Daisy";
  const daisySchool = state ? daisyDayRanges(state, selected) : [];

  // Overview rail tabs (design boards): the header stays tied to the tapped
  // day; the tabs below switch the broader view (Month / Childcare / Life).
  const [railTab, setRailTab] = useState<"month" | "childcare" | "life">("month");

  // Life tab data: every event in the next 60 days, sorted, with a "clash"
  // flag = the day has an event AND nobody is off (both parents working).
  const _pad = (n: number) => String(n).padStart(2, "0");
  const _now = new Date();
  const _todayIso = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}`;
  const _end = new Date(_now); _end.setDate(_end.getDate() + 60);
  const _endIso = `${_end.getFullYear()}-${_pad(_end.getMonth() + 1)}-${_pad(_end.getDate())}`;
  const upcomingLife = Object.values(eventsByDate)
    .flat()
    .filter((e) => e.date >= _todayIso && e.date <= _endIso)
    .sort((a, b) => (a.date === b.date
      ? (a.startTime || "").localeCompare(b.startTime || "")
      : a.date.localeCompare(b.date)));
  const isClashDay = (date: string): boolean => dayKindFromShifts(allShifts[date]) === "both";
  const lifeClashCount = upcomingLife.filter((e) => isClashDay(e.date)).length;

  return (
    <div
      style={{
        background: dark ? "rgba(20,20,22,0.5)" : "rgba(255,255,255,0.6)",
        borderLeft: `0.5px solid ${t.sep}`,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflowY: "auto",
        overflowX: "hidden",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* Schedule cadence reminders — raised by the last-Friday Cloud Function,
          dismissible, sit above the working card until acted on. */}
      {(reminderUpdate || reminderCaregiver) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {reminderUpdate && (
            <AlertCard
              color="#14201E"
              title="Update the schedule"
              body="This 4-week schedule is wrapping up — add the next block of shifts."
              onDismiss={onDismissReminder ? () => onDismissReminder("update") : undefined}
              t={t}
              dark={dark}
            />
          )}
          {reminderCaregiver && (
            <AlertCard
              color="#0F6E64"
              title="Send caregiver requests"
              body={
                coverageNeedsCount === 1
                  ? "1 upcoming day has no caregiver lined up."
                  : `${coverageNeedsCount} upcoming days have no caregiver lined up.`
              }
              actionLabel="Send to caregiver"
              onAction={onSendCaregiverRequests}
              onDismiss={onDismissReminder ? () => onDismissReminder("caregiver") : undefined}
              t={t}
              dark={dark}
            />
          )}
        </div>
      )}

      {/* Selected day card */}
      <div
        style={{
          borderRadius: 12,
          padding: 14,
          background: kind === "off" ? t.bgElev : rgba(accent, dark ? 0.18 : 0.10),
          border: `0.5px solid ${kind === "off" ? t.sep : rgba(accent, 0.35)}`,
        }}
      >
        <div style={subhead(t)}>{dayLabel}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: t.text, letterSpacing: "-0.02em", marginTop: 2 }}>
          {kind === "off"
            ? "Both off"
            : kind === "both"
              ? "Both working"
              : kind === "g"
                ? `${selfName} works`
                : `${partnerName} works`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {(shifts ?? []).map((s, i) => {
            const c = personColor(s.who, palette);
            const editable = !!s.source && !!s.shiftTypeId && !!onEditShift;
            const deletable = !!s.source && !!onDeleteShift;
            const recurring = s.source?.kind === "template" || s.source?.kind === "alt-weekend";
            // Pill: shift-type label + start time, no end time.
            // The user's shift names often embed a "start-end" range
            // (e.g., "Night (8hr) 11p-730a") which is redundant in the
            // pill. We strip any trailing "<time>-<time>" pattern from
            // the name, then append just the compact start time.
            const stype = state?.shiftTypes.find((x) => x.id === s.shiftTypeId);
            // Strip a trailing time range from the shift name so the pill stays
            // short — both "11p-730a" style and a parenthesized 24h "(0930-1800)".
            const TIME_RANGE = /\s*\d{1,2}:?\d{0,2}\s?[ap]\.?m?\.?\s*[-–]\s*\d{1,2}:?\d{0,2}\s?[ap]\.?m?\.?\s*$/i;
            const PAREN_RANGE = /\s*\(\s*\d{3,4}\s*[-–]\s*\d{3,4}\s*\)\s*$/;
            const pillText = stype
              ? `${stype.name.replace(PAREN_RANGE, "").replace(TIME_RANGE, "").trim()} · ${compactTime(stype.start)}`
              : s.label;
            const revealed = revealedIdx === i;
            const hasActions = editable || deletable;
            return (
              <div
                key={i}
                onDoubleClick={() => hasActions && setRevealedIdx(revealed ? null : i)}
                title={hasActions ? "Double-click to reveal edit/delete" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 8px",
                  borderRadius: 8,
                  background: t.bgElev,
                  cursor: hasActions ? "pointer" : "default",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <PhotoAv who={s.who} size={26} palette={palette} dark={dark} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>
                    {s.who === "G" ? selfName : s.who === "K" ? partnerName : daisyName}
                  </div>
                  <div style={{ fontSize: 10.5, color: t.text3 }}>
                    {s.label}{recurring ? " · recurring" : ""}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: rgba(c, 0.18),
                    color: c,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                    maxWidth: 180,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    flexShrink: 1,
                    // Without this, flex min-content keeps the pill from
                    // shrinking, so a long shift name overran the person's name.
                    minWidth: 0,
                  }}
                  title={pillText}
                >
                  {pillText}
                </span>
                {hasActions && (
                  // Slide-out tray. Hidden (translated off the right edge)
                  // by default; double-click toggles it into view. Width
                  // animates so the row stays compact when collapsed.
                  <div
                    style={{
                      display: "inline-flex",
                      gap: 4,
                      overflow: "hidden",
                      maxWidth: revealed ? 70 : 0,
                      opacity: revealed ? 1 : 0,
                      transform: `translateX(${revealed ? 0 : 12}px)`,
                      transition:
                        "max-width 0.22s ease, opacity 0.18s ease, transform 0.22s ease",
                      pointerEvents: revealed ? "auto" : "none",
                    }}
                  >
                    {editable && (
                      <button
                        type="button"
                        aria-label="Edit shift"
                        onClick={(e) => { e.stopPropagation(); onEditShift?.(selected, s); }}
                        style={iconBtnStyle(t)}
                        title={recurring ? "Edit this date (creates an override)" : "Edit"}
                      >
                        ✎
                      </button>
                    )}
                    {deletable && (
                      <button
                        type="button"
                        aria-label="Delete shift"
                        onClick={(e) => { e.stopPropagation(); onDeleteShift?.(selected, s); }}
                        style={iconBtnStyle(t)}
                        title={recurring ? "Mark this date off" : "Delete"}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {(!shifts || shifts.length === 0) && (
            <div style={{ fontSize: 12, color: t.text3, padding: 8 }}>Free day. Plan something together.</div>
          )}
        </div>

        {/* Game Day — drops down from the work-status card on WVU game days. */}
        {wvuGame && <GameDayDropdown game={wvuGame} t={t} dark={dark} />}
      </div>

      {/* Schedule block — only renders when the selected day is covered
          by an active block. Red striped header echoes the calendar's
          diagonal-stripe overlay so users connect the two visually. */}
      {dayBlock && (
        <div>
          <div style={{ ...subhead(t), marginBottom: 6 }}>Schedule Block</div>
          <div
            style={{
              borderRadius: 12,
              padding: 14,
              background: "rgba(138,75,56,0.10)",
              border: `0.5px solid rgba(138,75,56,0.45)`,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Faint diagonal stripe overlay so the card reads as a "blocked" day */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "repeating-linear-gradient(135deg, rgba(138,75,56,0.18) 0px, rgba(138,75,56,0.18) 6px, rgba(138,75,56,0) 6px, rgba(138,75,56,0) 14px)",
                pointerEvents: "none",
              }}
            />
            <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ScheduleBlockOctagon size={14} />
                <div style={{ fontSize: 14, fontWeight: 700, color: t.text, letterSpacing: "-0.01em" }}>
                  {dayBlock.label || "Schedule block"}
                </div>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 9.5, fontWeight: 700,
                    padding: "2px 7px", borderRadius: 999,
                    background: "rgba(138,75,56,0.18)",
                    color: "#8A4B38",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Blocked
                </span>
              </div>
              <div style={{ fontSize: 12, color: t.text2, fontVariantNumeric: "tabular-nums" }}>
                {dayBlock.startDate === dayBlock.endDate
                  ? humanDate(dayBlock.startDate)
                  : `${humanDate(dayBlock.startDate)} → ${humanDate(dayBlock.endDate)}`}
                {dayBlock.startDate !== dayBlock.endDate && (
                  <span style={{ color: t.text3 }}>
                    {" "}· day {dayOfBlock(dayBlock.startDate, selected)} of {totalBlockDays(dayBlock.startDate, dayBlock.endDate)}
                  </span>
                )}
              </div>
              {dayBlock.notes && (
                <div style={{ fontSize: 12, color: t.text2, lineHeight: 1.4 }}>{dayBlock.notes}</div>
              )}
              <button
                type="button"
                onClick={onOpenScheduleBlock}
                style={{
                  alignSelf: "flex-start",
                  padding: "5px 11px",
                  borderRadius: 7,
                  border: `0.5px solid rgba(138,75,56,0.45)`,
                  background: "transparent",
                  color: "#8A4B38",
                  fontSize: 11.5,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  letterSpacing: "-0.01em",
                }}
              >
                Manage blocks
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Childcare tab — coverage for the selected day */}
      {railTab === "childcare" && (
      <div>
        <div style={{ ...subhead(t), marginBottom: 6 }}>Childcare</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {isChildcareOff && (
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                background: rgba("#8A4B38", dark ? 0.14 : 0.1),
                border: `0.5px solid ${rgba("#8A4B38", 0.5)}`,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, color: t.text, lineHeight: 1.4 }}>
                <span style={{ fontWeight: 700, color: "#8A4B38" }}>No childcare</span>
                {" "}— caregiver scheduled off this day.
              </div>
              <button
                type="button"
                onClick={() => onToggleChildcareOff(selected, false)}
                style={{
                  alignSelf: "flex-start",
                  padding: "6px 12px",
                  border: `0.5px solid ${t.sep}`,
                  borderRadius: 7,
                  background: t.bgElev,
                  color: t.text,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "-0.01em",
                }}
              >
                Childcare available again
              </button>
            </div>
          )}

          {!isChildcareOff && dayCoverage.length === 0 && !isGapDay && daisySchool.length === 0 && (
            <div style={{ fontSize: 12, color: t.text3, padding: "4px 2px" }}>
              No Coverage needed.
            </div>
          )}

          {!isChildcareOff && isGapDay && (
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                background: rgba("#8A4B38", dark ? 0.14 : 0.1),
                border: `0.5px solid ${rgba("#8A4B38", 0.5)}`,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, color: t.text, lineHeight: 1.4 }}>
                <span style={{ fontWeight: 700, color: "#8A4B38" }}>Both working</span>
                {" "}— no caregiver lined up for this day.
              </div>
              <button
                type="button"
                onClick={() => onSendCoverageForDay(selected)}
                style={{
                  alignSelf: "flex-start",
                  padding: "6px 12px",
                  border: 0,
                  borderRadius: 7,
                  background: palette.G,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "-0.01em",
                }}
              >
                Send to caregiver
              </button>
            </div>
          )}

          {dayCoverage.map((req) => {
            const sc = COVERAGE_STATUS_COLOR[req.status];
            return (
              <div
                key={req.id}
                style={{
                  padding: "9px 11px",
                  borderRadius: 9,
                  background: t.bgElev,
                  border: `0.5px solid ${t.sep}`,
                  borderLeft: `3px solid ${sc}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 999,
                      background: rgba(sc, 0.18),
                      color: sc,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                    }}
                  >
                    {COVERAGE_STATUS_LABEL[req.status]}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: t.text, fontVariantNumeric: "tabular-nums" }}>
                    {req.startTime} → {req.endTime}{req.endsNextDay ? " +1d" : ""}
                  </span>
                </div>
                {req.arriveBy && (
                  <div style={{ fontSize: 10.5, color: t.text3 }}>
                    Arrive by <span style={{ color: t.text2, fontWeight: 600 }}>{req.arriveBy}</span>
                  </div>
                )}
                {req.notes && (
                  <div style={{ fontSize: 11.5, color: t.text2, lineHeight: 1.4 }}>{req.notes}</div>
                )}
                {req.caregiverNote && (
                  <div style={{ fontSize: 11.5, color: t.text2, lineHeight: 1.4, fontStyle: "italic" }}>
                    <span style={{ fontStyle: "normal", fontWeight: 600, color: t.text }}>
                      {req.status === "declined" ? "Caregiver said:" :
                       req.status === "issue"    ? "Caregiver reported:" :
                                                    "Caregiver noted:"}
                    </span>{" "}
                    {req.caregiverNote}
                  </div>
                )}
              </div>
            );
          })}

          {!isChildcareOff && (
            <button
              type="button"
              onClick={() => onToggleChildcareOff(selected, true)}
              title="Mark this day as having no childcare (caregiver off)"
              style={{
                alignSelf: "flex-start",
                marginTop: 2,
                padding: "5px 10px",
                border: `0.5px solid ${t.sep}`,
                borderRadius: 7,
                background: "transparent",
                color: t.text2,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                letterSpacing: "-0.01em",
              }}
            >
              Mark no childcare
            </button>
          )}
        </div>
      </div>
      )}

      {/* Health-calendar appointments for the selected day (styled distinctly). */}
      {events.some((e) => e.healthId) && (
        <div>
          <div style={{ ...subhead(t), marginBottom: 8 }}>Appointments</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {events.filter((e) => e.healthId).map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={() => onEditEvent(ev)}
                style={{
                  display: "flex", gap: 12, alignItems: "stretch", width: "100%",
                  background: "transparent", border: 0, padding: 0, cursor: "pointer",
                  textAlign: "left", fontFamily: "inherit",
                }}
              >
                <div style={{ width: 4, borderRadius: 4, background: "#0F6E64", flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: dark ? "#0F6E64" : "#0F6E64" }}>{apptTimeRange(ev)}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: t.text, marginTop: 2, letterSpacing: "-0.01em" }}>{ev.title}</div>
                  {ev.notes && <div style={{ fontSize: 12.5, color: t.text2, marginTop: 1 }}>{ev.notes}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Life tab — events for the selected day */}
      {railTab === "life" && (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <span style={subhead(t)}>Life · next 60 days</span>
          {lifeClashCount > 0 && (
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#8A4B38" }}>
              {lifeClashCount} clash{lifeClashCount === 1 ? "" : "es"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {upcomingLife.length === 0 && (
            <div style={{ fontSize: 12, color: t.text3, padding: "4px 2px" }}>
              Nothing in the next 60 days.
            </div>
          )}
          {upcomingLife.map((ev) => {
            const clash = isClashDay(ev.date);
            const [, em, ed] = ev.date.split("-").map(Number);
            const eyebrow = `${MONTHS_LONG[em - 1].slice(0, 3).toUpperCase()} ${ed}`;
            const badge = ev.healthId ? "APPT" : ev.seriesId ? "REPEATS" : null;
            const personName =
              ev.who === "G" ? selfName :
              ev.who === "K" ? partnerName :
              ev.who === "Daisy" ? (state?.dependents?.daisy?.name || "Daisy") : "Family";
            const timeLabel = ev.startTime ? compactTime(ev.startTime) : "All day";
            const k = dayKindFromShifts(allShifts[ev.date]);
            const cover =
              k === "both" ? "Nobody is off." :
              k === "off" ? "Both off." :
              k === "g" ? `${selfName} works · ${partnerName} off.` :
              k === "k" ? `${partnerName} works · ${selfName} off.` : "";
            const desc = ev.notes && ev.notes.trim() ? ev.notes : cover;
            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => onEditEvent(ev)}
                style={{
                  display: "flex", flexDirection: "column", gap: 4, width: "100%",
                  textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                  padding: "10px 12px", borderRadius: 10, color: t.text,
                  background: clash ? rgba("#8A4B38", dark ? 0.14 : 0.10) : t.bgElev,
                  border: clash ? `1px dashed ${rgba("#8A4B38", 0.55)}` : `0.5px solid ${t.sep}`,
                }}
              >
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", color: clash ? "#8A4B38" : t.text3 }}>
                  {eyebrow}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.01em", color: t.text }}>
                    {ev.title}
                  </span>
                  {badge && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
                      padding: "1px 6px", borderRadius: 999,
                      background: ev.healthId ? rgba("#0F6E64", 0.14) : t.bgElev2,
                      color: ev.healthId ? "#0F6E64" : t.text2,
                    }}>{badge}</span>
                  )}
                  {ev.pending && <span style={{ fontSize: 10.5, color: "#8A4B38", fontWeight: 700 }}>(pending)</span>}
                </div>
                <div style={{ fontSize: 11.5, color: t.text2, lineHeight: 1.35 }}>
                  {timeLabel} · {personName}{desc ? ` — ${desc}` : ""}
                </div>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onAddEvent}
          style={{
            marginTop: 8, width: "100%", padding: "10px 12px", borderRadius: 10,
            border: `0.5px solid ${t.sep}`, background: t.bgElev, color: t.text,
            fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            letterSpacing: "-0.01em",
          }}
        >
          New life event
        </button>
        <div style={{ fontSize: 11, color: t.text3, lineHeight: 1.4, marginTop: 8, padding: "0 2px" }}>
          A clash means the day matters and nobody is off. Nucleus never moves a shift for you.
        </div>
      </div>
      )}

      {/* Month tab — fatigue heatmap + this-month totals */}
      {railTab === "month" && (
      <>
        <FatigueHeatmap
          shifts={allShifts}
          state={state}
          anchorDate={selected}
          t={t}
          onSelectDate={onSelectDate}
        />
        <MonthTotals state={state} palette={palette} t={t} selfName={selfName} partnerName={partnerName} daisyName={daisyName} />
      </>
      )}

      {/* Childcare tab — running total of confirmed coverage hours */}
      {railTab === "childcare" && (
        <CaregiverCoverageAnalysis state={state} daisyName={daisyName} palette={palette} t={t} />
      )}

      {/* Bottom tab bar — Month / Childcare / Life (design boards) */}
      <InspectorTabBar
        tab={railTab}
        onTab={setRailTab}
        childcareCount={coverageNeedsCount}
        lifeCount={lifeClashCount}
        t={t}
      />
    </div>
  );
}

// Bottom segmented control for the Inspector rail. Pinned to the base of the
// scroll area; the selected tab reads as a white card with Teal label.
function InspectorTabBar({ tab, onTab, childcareCount, lifeCount, t }: {
  tab: "month" | "childcare" | "life";
  onTab: (t: "month" | "childcare" | "life") => void;
  childcareCount: number;
  lifeCount: number;
  t: ThemeTokens;
}) {
  const tabs: Array<{ key: "month" | "childcare" | "life"; label: string; count: number }> = [
    { key: "month", label: "Month", count: 0 },
    { key: "childcare", label: "Childcare", count: childcareCount },
    { key: "life", label: "Life", count: lifeCount },
  ];
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        marginTop: "auto",
        display: "flex",
        gap: 4,
        padding: 4,
        borderRadius: 12,
        background: t.bgElev,
        border: `0.5px solid ${t.sep}`,
      }}
    >
      {tabs.map((x) => {
        const active = tab === x.key;
        return (
          <button
            key={x.key}
            type="button"
            onClick={() => onTab(x.key)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "7px 4px",
              borderRadius: 9,
              border: 0,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              background: active ? t.bgElev2 : "transparent",
              color: active ? "#0F6E64" : t.text2,
              boxShadow: active ? `inset 0 0 0 1px ${t.sep}` : "none",
            }}
          >
            {x.label}
            {x.count > 0 && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  minWidth: 15,
                  height: 15,
                  padding: "0 4px",
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: active ? "#0F6E64" : t.sep,
                  color: active ? "#fff" : t.text2,
                }}
              >
                {x.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// This-month totals across the household + a per-shift-type breakdown.
// Mirrors the web app's "This Month" stats panel.
function MonthTotals({ state, palette, t, selfName, partnerName, daisyName }: {
  state: HouseholdState | null;
  palette: Palette;
  t: ThemeTokens;
  selfName: string;
  partnerName: string;
  daisyName: string;
}) {
  if (!state) return null;
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (dd: number) => `${y}-${pad(m + 1)}-${pad(dd)}`;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const map = buildShiftMap(state, iso(1), iso(daysInMonth));

  const types: Record<string, { name: string; start: string; end: string; crossesMidnight: boolean }> = {};
  for (const st of state.shiftTypes || []) types[st.id] = st;
  const toMin = (s: string) => { const [h, mm] = (s || "").split(":").map(Number); return (h || 0) * 60 + (mm || 0); };
  const hoursOf = (id?: string) => {
    const ty = id ? types[id] : null;
    if (!ty) return 0;
    let d = toMin(ty.end) - toMin(ty.start);
    if (ty.crossesMidnight || d <= 0) d += 1440;
    return d / 60;
  };

  const byType = new Map<string, { count: number; hours: number }>();
  const per: Record<string, { count: number; hours: number }> = { G: { count: 0, hours: 0 }, K: { count: 0, hours: 0 }, D: { count: 0, hours: 0 } };
  const workDays = new Set<string>();
  let totalShifts = 0, totalHours = 0;
  for (let dd = 1; dd <= daysInMonth; dd++) {
    const key = iso(dd);
    for (const s of (map[key] || [])) {
      const hrs = hoursOf(s.shiftTypeId);
      const name = (s.shiftTypeId && types[s.shiftTypeId]?.name) || s.label || "Shift";
      totalShifts++; totalHours += hrs; workDays.add(key);
      const cur = byType.get(name) || { count: 0, hours: 0 };
      cur.count++; cur.hours += hrs; byType.set(name, cur);
      if (per[s.who]) { per[s.who].count++; per[s.who].hours += hrs; }
    }
  }
  const daysOff = daysInMonth - workDays.size;
  const typesArr = [...byType.entries()].map(([name, v]) => ({ name, count: v.count, hours: v.hours })).sort((a, b) => b.hours - a.hours);
  const maxHours = Math.max(0.01, ...typesArr.map((x) => x.hours));

  const PAL = [palette.G, palette.K, "#14201E", "#8A4B38", "#0F6E64", "#14201E", "#D78F77", "#0F6E64"];
  const nameFor: Record<string, string> = { G: selfName, K: partnerName, D: daisyName };
  const dotFor: Record<string, string> = { G: palette.G, K: palette.K, D: "#0F6E64" };
  const stats: [string, string][] = [
    ["Shifts", String(totalShifts)],
    ["Hours", `${Math.round(totalHours)}h`],
    ["Avg / shift", `${(totalShifts ? totalHours / totalShifts : 0).toFixed(1)}h`],
    ["Days off", String(daysOff)],
  ];

  return (
    <div>
      <div style={{ ...subhead(t), marginBottom: 6 }}>This Month</div>
      <div style={{ background: t.bgElev, border: `0.5px solid ${t.sep}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{MONTHS_LONG[m]} {y}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {stats.map(([k, v]) => (
            <div key={k} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: t.text }}>{v}</div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: t.text3, marginTop: 3 }}>{k}</div>
            </div>
          ))}
        </div>
        {(["G", "K", "D"] as const).some((w) => per[w].count > 0) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
            {(["G", "K", "D"] as const).filter((w) => per[w].count > 0).map((w) => (
              <span key={w} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: t.text2 }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: dotFor[w] }} />
                {nameFor[w]} · <b style={{ color: t.text }}>{per[w].hours.toFixed(1)}h</b> · {per[w].count}
              </span>
            ))}
          </div>
        )}
        {typesArr.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {typesArr.map((x, i) => (
              <div key={x.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: PAL[i % PAL.length], flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: t.text, width: 118, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 }}>{x.name}</span>
                <span style={{ flex: 1, height: 8, background: rgba(PAL[i % PAL.length], 0.16), borderRadius: 4, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${(x.hours / maxHours * 100).toFixed(1)}%`, background: PAL[i % PAL.length], borderRadius: 4 }} />
                </span>
                <span style={{ width: 22, textAlign: "right", fontSize: 12, fontWeight: 700, color: t.text3, flexShrink: 0 }}>{x.count}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: t.text3 }}>No shifts this month.</div>
        )}
      </div>
    </div>
  );
}

// Caregiver pay model — flat $400 a month ($200 twice a month).
const CAREGIVER_MONTHLY_PAY = 400;

/** Bottom-of-Inspector readout of the caregiver's confirmed coverage: total
 *  hours, flat-pay cost model, effective $/hr per month, blended rate, cadence,
 *  and date range. Computed from state.coverageRequests (status confirmed). */
function CaregiverCoverageAnalysis({ state, daisyName, palette, t }: {
  state: HouseholdState | null;
  daisyName: string;
  palette: Palette;
  t: ThemeTokens;
}) {
  const reqs = state?.coverageRequests ?? [];
  const toMin = (s: string) => { const [h, m] = (s || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const dur = (r: { startTime: string; endTime: string; endsNextDay?: boolean }) => {
    let d = toMin(r.endTime) - toMin(r.startTime);
    if (r.endsNextDay || d <= 0) d += 1440;   // overnight window
    return d;
  };
  const confirmed = reqs.filter((r) => r.status === "confirmed" && r.date && r.startTime && r.endTime);
  const totalH = confirmed.reduce((s, r) => s + dur(r), 0) / 60;

  const hoursByMonth = new Map<string, number>();
  confirmed.forEach((r) => { const k = r.date.slice(0, 7); hoursByMonth.set(k, (hoursByMonth.get(k) ?? 0) + dur(r) / 60); });
  const monthKeys = [...hoursByMonth.keys()].sort();
  const dates = confirmed.map((r) => r.date).sort();
  // Flat $400/month, paid consistently (including through her time off).
  const rows = monthKeys.map((k) => {
    const hours = hoursByMonth.get(k) ?? 0;
    return { k, hours, cost: CAREGIVER_MONTHLY_PAY, rate: hours > 0 ? CAREGIVER_MONTHLY_PAY / hours : 0 };
  });
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const blended = totalH > 0 ? totalCost / totalH : 0;
  const avgMo = monthKeys.length ? totalH / monthKeys.length : 0;
  const avgWk = avgMo / 4.345;

  const sessByMonth = new Map<string, number>();
  confirmed.forEach((r) => { const k = r.date.slice(0, 7); sessByMonth.set(k, (sessByMonth.get(k) ?? 0) + 1); });

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtMonth = (k: string) => { const [y, m] = k.split("-").map(Number); return `${MONTHS[(m ?? 1) - 1]} '${String(y).slice(2)}`; };
  const recent = rows.slice(-6).map((r) => ({ ...r, sessions: sessByMonth.get(r.k) ?? 0 }));
  const maxRate = Math.max(0.01, ...recent.map((r) => r.rate));
  const maxHours = Math.max(0.01, ...recent.map((r) => r.hours));
  const maxSess = Math.max(1, ...recent.map((r) => r.sessions));
  let run = 0; const cum = rows.map((r) => ({ k: r.k, y: (run += r.hours) })).slice(-6);
  const acc = palette.G;
  const stats: [string, string][] = [
    ["Total hours", `${totalH.toFixed(1)} h`],
    ["Total paid", `$${Math.round(totalCost).toLocaleString()}`],
    ["Blended rate", `$${blended.toFixed(2)}/hr`],
    ["Cadence", `~${avgWk.toFixed(0)} h/wk`],
  ];

  // Click-to-cycle visuals with a little shuffle animation on change.
  const [view, setView] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof el.animate !== "function") return;
    el.animate(
      [
        { opacity: 0, transform: "translateX(18px) rotate(1.6deg) scale(0.97)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 300, easing: "cubic-bezier(.2,.7,.3,1)" },
    );
  }, [view]);
  const VIEWS = [
    { title: "Effective $/hr by month", note: "Lower is better value; vacation months read higher." },
    { title: "Hours per month", note: "Confirmed coverage hours each month." },
    { title: "Cumulative hours", note: "Running total across the period." },
    { title: "Sessions per month", note: "Confirmed coverage sessions each month." },
  ];
  const cur = VIEWS[view];

  const rowBar = (label: string, frac: number, value: React.ReactNode, key: string) => (
    <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 44, fontSize: 11, color: t.text2, flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, height: 8, background: rgba(acc, 0.14), borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`, height: "100%", background: acc, borderRadius: 4 }} />
      </div>
      <div style={{ width: 74, textAlign: "right", fontSize: 11, color: t.text, flexShrink: 0 }}>{value}</div>
    </div>
  );

  let body: React.ReactNode;
  if (view === 0) {
    body = <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{recent.map((r) =>
      rowBar(fmtMonth(r.k), r.rate / maxRate, <><span style={{ fontWeight: 600 }}>${r.rate.toFixed(2)}</span><span style={{ color: t.text3 }}> · {r.hours.toFixed(0)}h</span></>, r.k))}</div>;
  } else if (view === 1) {
    body = <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{recent.map((r) =>
      rowBar(fmtMonth(r.k), r.hours / maxHours, <span style={{ fontWeight: 600 }}>{r.hours.toFixed(1)}h</span>, r.k))}</div>;
  } else if (view === 3) {
    body = <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{recent.map((r) =>
      rowBar(fmtMonth(r.k), r.sessions / maxSess, <span style={{ fontWeight: 600 }}>{r.sessions}</span>, r.k))}</div>;
  } else if (cum.length) {
    // Cumulative-hours mini area.
    const w = 264, h = 96, L = 6, R = 6, T = 10, B = 18, iw = w - L - R, ih = h - T - B;
    const maxY = Math.max(1, ...cum.map((p) => p.y));
    const X = (i: number) => cum.length > 1 ? L + iw * (i / (cum.length - 1)) : L + iw / 2;
    const Y = (v: number) => T + ih - (v / maxY) * ih;
    let line = `M ${X(0)} ${Y(cum[0].y)}`;
    cum.forEach((p, i) => { if (i) line += ` L ${X(i)} ${Y(p.y)}`; });
    const area = `${line} L ${X(cum.length - 1)} ${T + ih} L ${X(0)} ${T + ih} Z`;
    const last = cum[cum.length - 1];
    body = (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", overflow: "visible" }} aria-label="Cumulative hours">
        <path d={area} fill={rgba(acc, 0.14)} />
        <path d={line} fill="none" stroke={acc} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {cum.map((p, i) => <circle key={p.k} cx={X(i)} cy={Y(p.y)} r={i === cum.length - 1 ? 3.5 : 2.5} fill={acc} />)}
        {cum.map((p, i) => <text key={`${p.k}l`} x={X(i)} y={h - 4} textAnchor="middle" style={{ fill: t.text3, fontSize: "9px", fontFamily: "monospace" }}>{fmtMonth(p.k).split(" ")[0]}</text>)}
        <text x={X(cum.length - 1)} y={Y(last.y) - 6} textAnchor="end" style={{ fill: t.text, fontSize: "10px", fontWeight: 600, fontFamily: "monospace" }}>{last.y.toFixed(0)}h</text>
      </svg>
    );
  }

  return (
    <div>
      <div style={{ ...subhead(t), marginBottom: 6 }}>Caregiver Coverage Analysis</div>
      {confirmed.length === 0 ? (
        <div style={{ fontSize: 12, color: t.text3, padding: "4px 2px" }}>No confirmed coverage logged yet.</div>
      ) : (
        <div
          onClick={() => setView((v) => (v + 1) % VIEWS.length)}
          style={{ background: t.bgElev, border: `0.5px solid ${t.sep}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 12, cursor: "pointer" }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px" }}>
            {stats.map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: t.text3 }}>{k}</div>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", color: t.text, marginTop: 1 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: t.text3 }}>
            {daisyName} · {confirmed.length} session{confirmed.length === 1 ? "" : "s"} · {humanDate(dates[0])} → {humanDate(dates[dates.length - 1])}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: t.text3 }}>{cur.title}</div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {VIEWS.map((_, i) => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: i === view ? acc : t.sep }} />)}
              </div>
            </div>
            <div ref={bodyRef} style={{ minHeight: 120, display: "flex", flexDirection: "column", justifyContent: "center" }}>{body}</div>
            <div style={{ fontSize: 10, color: t.text3, marginTop: 7, lineHeight: 1.45, minHeight: 28 }}>{cur.note}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────── Game Day dropdown ───────────────────

// WVU brand colors — gold accent for the game-day panel.
const WVU_GOLD = "#8A4B38";

/** Collapsible game-details panel that drops down from the work-status card
 *  on WVU game days. Header shows the matchup at a glance; expanding reveals
 *  home/away, kickoff, TV, and venue. */
function GameDayDropdown({ game, t, dark }: { game: WvuGame; t: ThemeTokens; dark: boolean }) {
  const [open, setOpen] = useState(true);
  const matchup = `WVU ${game.neutral || game.home ? "vs" : "at"} ${game.opponent}`;
  const homeAway = game.neutral ? "Neutral site" : game.home ? "Home" : "Away";
  const kickoff = game.kickoff && game.kickoff !== "TBD" ? game.kickoff : "Time TBD";
  return (
    <div
      style={{
        marginTop: 12,
        borderRadius: 10,
        overflow: "hidden",
        background: rgba(WVU_GOLD, dark ? 0.13 : 0.1),
        border: `0.5px solid ${rgba(WVU_GOLD, 0.5)}`,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 11px",
          background: "transparent",
          border: 0,
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
          color: t.text,
        }}
      >
        <img
          src="assets/wvu.png"
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{ width: 24, height: 22, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))" }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: rgba(WVU_GOLD, dark ? 0.95 : 0.85) }}>
            Game Day
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: t.text, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {matchup}
          </div>
        </div>
        <span
          style={{
            color: t.text3,
            fontSize: 11,
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
            flexShrink: 0,
          }}
        >
          ›
        </span>
      </button>
      {open && (
        <div style={{ padding: "2px 11px 11px", display: "flex", flexDirection: "column", gap: 0 }}>
          <div style={{ height: 0.5, background: rgba(WVU_GOLD, 0.35), margin: "0 0 8px" }} />
          <GameDetailRow label="Where" value={homeAway} t={t} />
          <GameDetailRow label="Kickoff" value={kickoff} t={t} />
          {game.tv && <GameDetailRow label="TV" value={game.tv} t={t} />}
          {game.location && <GameDetailRow label="Venue" value={game.location} t={t} />}
        </div>
      )}
    </div>
  );
}

function GameDetailRow({ label, value, t }: { label: string; value: string; t: ThemeTokens }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "3px 0" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: t.text3, width: 58, flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ fontSize: 12.5, color: t.text, fontWeight: 500, minWidth: 0 }}>{value}</div>
    </div>
  );
}

// ─────────────────── Utilities helpers ───────────────────

function UtilityRow({ icon, label, hint, onClick, t }: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  t: ThemeTokens;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: "transparent",
        border: 0,
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        color: t.text,
      }}
    >
      <div style={{ width: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>{label}</div>
        <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>{hint}</div>
      </div>
      <span style={{ color: t.text3, fontSize: 13 }}>›</span>
    </button>
  );
}

function WrenchIcon({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  // Subtle gray wrench — simplified silhouette.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M22 7a5 5 0 0 1-6.5 4.77L5.83 21.46a2.83 2.83 0 1 1-4-4L11.5 7.83A5 5 0 0 1 18 1.31l-3.18 3.18 2.7 2.7L20.7 4Z"
        fill={color}
        opacity={0.65}
      />
    </svg>
  );
}

function StopOctagonInline({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 2 H16 L22 8 V16 L16 22 H8 L2 16 V8 Z" fill="#8A4B38" />
    </svg>
  );
}

function WandIcon({ size = 14, color = "#56B7A9" }: { size?: number; color?: string }) {
  // Four 4-pointed sparkle stars in a loose cluster, varied sizes:
  //   - Big star, upper-left center (the dominant element)
  //   - Small star, upper-right corner
  //   - Medium star, middle-right
  //   - Tiny star, lower-left
  // Each star is an 8-point polygon with the inner vertices pulled
  // close to the center to give the pointed-tip / "sparkle" look.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      aria-hidden
    >
      {/* Big star — upper-left center */}
      <path d="M8 3.5 L9.5 7.5 L13.5 9 L9.5 10.5 L8 14.5 L6.5 10.5 L2.5 9 L6.5 7.5 Z" />
      {/* Small star — upper-right */}
      <path d="M18 2.5 L18.7 4.3 L20.5 5 L18.7 5.7 L18 7.5 L17.3 5.7 L15.5 5 L17.3 4.3 Z" />
      {/* Medium star — middle-right */}
      <path d="M17 10.5 L18 13 L20.5 14 L18 15 L17 17.5 L16 15 L13.5 14 L16 13 Z" />
      {/* Tiny star — lower-left */}
      <path d="M8 16 L8.5 17.5 L10 18 L8.5 18.5 L8 20 L7.5 18.5 L6 18 L7.5 17.5 Z" />
    </svg>
  );
}

function iconBtnStyle(t: ThemeTokens): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    border: `0.5px solid ${t.sep}`,
    background: "transparent",
    color: t.text2,
    borderRadius: 6,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

/** Daisy school ranges → "8a–3p" span. */
function schoolSpanLabel(rs: MinuteRange[]): string {
  const f = (m: number) => {
    const mm = ((m % 1440) + 1440) % 1440;
    let h = Math.floor(mm / 60); const min = mm % 60;
    const ap = h < 12 ? "a" : "p"; h = h % 12 || 12;
    return min ? `${h}:${String(min).padStart(2, "0")}${ap}` : `${h}${ap}`;
  };
  const s = Math.min(...rs.map((r) => r.startMin));
  const e = Math.max(...rs.map((r) => r.endMin));
  return `${f(s)}–${f(e)}`;
}

// Appointment time range, e.g. "4:00–5:00p" / "11:00a–1:00p".
function hm12(hhmm?: string): { h: number; mm: string; ap: string } {
  const [H, M] = (hhmm || "").split(":").map(Number);
  return { h: (H % 12) || 12, mm: String(M || 0).padStart(2, "0"), ap: (H || 0) < 12 ? "a" : "p" };
}
function apptTimeRange(ev: SbEvent): string {
  if (!ev.startTime) return "All day";
  const s = hm12(ev.startTime);
  if (!ev.endTime) return `${s.h}:${s.mm}${s.ap}`;
  const e = hm12(ev.endTime);
  const sPart = s.ap === e.ap ? `${s.h}:${s.mm}` : `${s.h}:${s.mm}${s.ap}`;
  return `${sPart}–${e.h}:${e.mm}${e.ap}`;
}

function subhead(t: ThemeTokens): React.CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 700,
    color: t.text3,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: 4,
  };
}

// A tinted, dismissible reminder card. Matches the existing inline notice
// pattern (gap warning / no-childcare) but generalized so both cadence
// reminders share one shape.
function AlertCard({
  color, title, body, actionLabel, onAction, onDismiss, t, dark,
}: {
  color: string;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  t: ThemeTokens;
  dark: boolean;
}) {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 10,
        background: rgba(color, dark ? 0.14 : 0.1),
        border: `0.5px solid ${rgba(color, 0.5)}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ fontSize: 12, color: t.text, lineHeight: 1.4 }}>
          <span style={{ fontWeight: 700, color }}>{title}</span>
          <div style={{ color: t.text2, marginTop: 2 }}>{body}</div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            style={{
              border: 0,
              background: "transparent",
              color: t.text3,
              cursor: "pointer",
              fontSize: 13,
              lineHeight: 1,
              padding: 2,
              flexShrink: 0,
              fontFamily: "inherit",
            }}
          >
            ✕
          </button>
        )}
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          style={{
            alignSelf: "flex-start",
            padding: "6px 12px",
            border: 0,
            borderRadius: 7,
            background: color,
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            letterSpacing: "-0.01em",
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ─────────────────── schedule block helpers ───────────────────

const BLOCK_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${BLOCK_MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}
function dayOfBlock(startIso: string, todayIso: string): number {
  // Inclusive 1-based: startIso → 1, startIso+1 → 2, etc.
  const [y1, m1, d1] = startIso.split("-").map(Number);
  const [y2, m2, d2] = todayIso.split("-").map(Number);
  const a = new Date(y1!, (m1 ?? 1) - 1, d1 ?? 1).getTime();
  const b = new Date(y2!, (m2 ?? 1) - 1, d2 ?? 1).getTime();
  return Math.round((b - a) / 86400000) + 1;
}
function totalBlockDays(startIso: string, endIso: string): number {
  return dayOfBlock(startIso, endIso);
}
function ScheduleBlockOctagon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 2 H16 L22 8 V16 L16 22 H8 L2 16 V8 Z" fill="#8A4B38" />
    </svg>
  );
}

