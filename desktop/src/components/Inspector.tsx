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
  pending:   "#5E5CE6",
  confirmed: "#30D158",
  declined:  "#FF453A",
  issue:     "#FF9F0A",
};
const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  pending:   "Pending",
  confirmed: "Confirmed",
  declined:  "Declined",
  issue:     "Issue",
};

export function Inspector({
  selected, palette, t, dark, shifts: allShifts, state, selfName, partnerName,
  onEditShift, onDeleteShift, events, onAddEvent, onEditEvent, onSendCoverageForDay,
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

  // Soft tinted "boxes" for the Childcare (amber) + Life (blue) sections.
  const CHILD_BG = rgba("#E0A82E", dark ? 0.14 : 0.10);
  const CHILD_LABEL = dark ? "#E8BB55" : "#9A7212";
  const LIFE_BLUE = palette.G;
  const LIFE_BG = rgba(LIFE_BLUE, dark ? 0.16 : 0.09);
  const LIFE_LABEL = dark ? "#7FB0FF" : "#2563EB";
  const boxBtn: React.CSSProperties = {
    alignSelf: "stretch", textAlign: "center", padding: "8px 10px",
    border: `0.5px solid ${t.sep}`, borderRadius: 11, background: t.bgElev,
    color: t.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
    fontFamily: "inherit", letterSpacing: "-0.01em",
  };

  return (
    <div
      style={{
        background: dark ? "rgba(20,20,22,0.5)" : "rgba(255,255,255,0.6)",
        borderLeft: `0.5px solid ${t.sep}`,
        padding: 11,
        display: "flex",
        flexDirection: "column",
        gap: 9,
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
              color="#5E5CE6"
              title="Update the schedule"
              body="This 4-week schedule is wrapping up — add the next block of shifts."
              onDismiss={onDismissReminder ? () => onDismissReminder("update") : undefined}
              t={t}
              dark={dark}
            />
          )}
          {reminderCaregiver && (
            <AlertCard
              color="#30D158"
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
          borderRadius: 14,
          padding: 12,
          background: kind === "off" ? t.bgElev : rgba(accent, dark ? 0.18 : 0.10),
          border: `0.5px solid ${kind === "off" ? t.sep : rgba(accent, 0.35)}`,
        }}
      >
        <div style={subhead(t)}>{dayLabel}</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: t.text, letterSpacing: "-0.02em", marginTop: 2 }}>
          {kind === "off"
            ? "Both off"
            : kind === "both"
              ? "Both working"
              : kind === "g"
                ? `${selfName} works`
                : `${partnerName} works`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
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
              background: "rgba(255,69,58,0.10)",
              border: `0.5px solid rgba(255,69,58,0.45)`,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Faint diagonal stripe overlay so the card reads as a "blocked" day */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "repeating-linear-gradient(135deg, rgba(255,69,58,0.18) 0px, rgba(255,69,58,0.18) 6px, rgba(255,69,58,0) 6px, rgba(255,69,58,0) 14px)",
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
                    background: "rgba(255,69,58,0.18)",
                    color: "#FF453A",
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
                  border: `0.5px solid rgba(255,69,58,0.45)`,
                  background: "transparent",
                  color: "#FF453A",
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

      {/* Childcare + Life — side-by-side soft boxes */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "stretch" }}>
      {/* Childcare coverage for the selected day — soft amber box */}
      <div style={{ background: CHILD_BG, borderRadius: 16, padding: 11, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: CHILD_LABEL }}>Childcare</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
          {daisySchool.length > 0 && (
            <div style={{ fontSize: 12, color: CHILD_LABEL, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
              Unavailable
            </div>
          )}
          {isChildcareOff && (
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                background: rgba("#FF453A", dark ? 0.14 : 0.1),
                border: `0.5px solid ${rgba("#FF453A", 0.5)}`,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, color: t.text, lineHeight: 1.4 }}>
                <span style={{ fontWeight: 700, color: "#FF453A" }}>No childcare</span>
                {" "}— caregiver scheduled off this day.
              </div>
              <button
                type="button"
                onClick={() => onToggleChildcareOff(selected, false)}
                style={boxBtn}
              >
                Childcare available again
              </button>
            </div>
          )}

          {!isChildcareOff && dayCoverage.length === 0 && !isGapDay && daisySchool.length === 0 && (
            <div style={{ fontSize: 13, color: CHILD_LABEL, fontWeight: 500 }}>
              No coverage needed.
            </div>
          )}

          {!isChildcareOff && isGapDay && (
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                background: rgba("#FF9F0A", dark ? 0.14 : 0.1),
                border: `0.5px solid ${rgba("#FF9F0A", 0.5)}`,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, color: t.text, lineHeight: 1.4 }}>
                <span style={{ fontWeight: 700, color: "#FF9F0A" }}>Both working</span>
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
                  padding: "8px 9px",
                  borderRadius: 9,
                  background: t.bgElev,
                  border: `0.5px solid ${t.sep}`,
                  borderLeft: `3px solid ${sc}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                  minWidth: 0,
                }}
              >
                {/* Status pill on its own line, then the window on ONE line —
                    small + no-wrap so "16:45 → 00:00 +1d" never breaks. */}
                <span
                  style={{
                    alignSelf: "flex-start",
                    fontSize: 8.5,
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: 999,
                    background: rgba(sc, 0.18),
                    color: sc,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                  }}
                >
                  {COVERAGE_STATUS_LABEL[req.status]}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: t.text, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
                  {req.startTime} → {req.endTime}
                  {req.endsNextDay && <span style={{ color: t.text3, fontWeight: 600 }}> +1d</span>}
                </span>
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
            <BoxButton
              label="Mark no childcare"
              onClick={() => onToggleChildcareOff(selected, true)}
              accent={CHILD_LABEL}
              t={t}
              title="Mark this day as having no childcare (caregiver off)"
            />
          )}
        </div>
      </div>

      {/* Events for the selected day — soft blue box */}
      <div style={{ background: LIFE_BG, borderRadius: 16, padding: 11, display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: LIFE_LABEL }}>Life</span>
        {/* Avatars sit right under the label (top-aligned, wrapping); the
            "+ Add life item" button's margin-top:auto keeps it pinned below. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", alignContent: "flex-start", gap: 8, margin: "2px 0 6px" }}>
          {/* EVERY event on the day gets an avatar here — life items AND
              health appointments — so the cell always agrees with the
              details list below (an event never shows in one but not the other). */}
          {events.length === 0 && (
            <div style={{ fontSize: 13, color: LIFE_LABEL, fontWeight: 500 }}>
              No life items yet.
            </div>
          )}
          {events.map((ev) => {
            const personName =
              ev.who === "G" ? selfName :
              ev.who === "K" ? partnerName :
              ev.who === "Daisy" ? "Daisy" : "Family";
            // Same 12h formatter as the rows below so hover + row agree.
            const title = `${ev.title}${ev.pending ? " (pending)" : ""} · ${apptTimeRange(ev)} · ${personName}`;
            return (
              <LifeAvatarButton
                key={ev.id}
                ev={ev}
                title={title}
                palette={palette}
                dark={dark}
                onClick={() => onEditEvent(ev)}
              />
            );
          })}
        </div>
        <BoxButton
          label="+ Add life item"
          onClick={onAddEvent}
          accent={LIFE_LABEL}
          t={t}
        />
      </div>
      </div>{/* /Childcare + Life grid */}

      {/* Health-calendar appointments for the selected day (only when present). */}
      {events.some((e) => e.healthId) && (
        <div>
          <div style={{ ...subhead(t), marginBottom: 8 }}>Appointments</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {events.filter((e) => e.healthId).map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={() => onEditEvent(ev)}
                style={{
                  display: "flex", gap: 10, alignItems: "stretch", width: "100%",
                  background: "transparent", border: 0, padding: 0, cursor: "pointer",
                  textAlign: "left", fontFamily: "inherit", minWidth: 0,
                }}
              >
                <div style={{ width: 4, borderRadius: 4, background: "#34C759", flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: dark ? "#30D158" : "#1e9e4a" }}>{apptTimeRange(ev)}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginTop: 1, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.title}</div>
                  {ev.notes && <div style={{ fontSize: 12, color: t.text2, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.notes}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Life items — the details for every non-health event, in the same row
          style as Appointments. Pairs with the avatars in the Life cell above:
          an avatar there always has a row here, and vice-versa. */}
      {events.some((e) => !e.healthId) && (
        <div>
          <div style={{ ...subhead(t), marginBottom: 8 }}>Life items</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {events.filter((e) => !e.healthId).map((ev) => {
              const color = ev.pending ? "#FF9F0A" : lifeColor(ev.who);
              const personName =
                ev.who === "G" ? selfName :
                ev.who === "K" ? partnerName :
                ev.who === "Daisy" ? "Daisy" : "Family";
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onEditEvent(ev)}
                  style={{
                    display: "flex", gap: 10, alignItems: "stretch", width: "100%",
                    background: "transparent", border: 0, padding: 0, cursor: "pointer",
                    textAlign: "left", fontFamily: "inherit", minWidth: 0,
                  }}
                >
                  <div style={{ width: 4, borderRadius: 4, background: color, flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color }}>{apptTimeRange(ev)}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginTop: 1, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {ev.title}
                      {ev.pending && <span style={{ color: "#FF9F0A", fontWeight: 700 }}> (pending)</span>}
                    </div>
                    {/* One line, ellipsized — long notes must not grow the panel. */}
                    <div style={{ fontSize: 12, color: t.text2, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {personName}{ev.seriesId ? " · series" : ""}{ev.pending ? " · awaiting confirm" : ""}
                      {ev.notes ? ` · ${ev.notes}` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Fatigue heatmap */}
      <FatigueHeatmap
        shifts={allShifts}
        state={state}
        anchorDate={selected}
        t={t}
        onSelectDate={onSelectDate}
      />

      {/* This Month ⟷ Caregiver Coverage — one toggling slot (‹ › flips) */}
      <StatSlot state={state} palette={palette} t={t} selfName={selfName} partnerName={partnerName} daisyName={daisyName} />
    </div>
  );
}

// One card slot that flips between the month totals and the caregiver
// coverage analysis. Keeping them in a single slot (instead of two stacked
// cards) is what keeps the right panel from scrolling.
function StatSlot({ state, palette, t, selfName, partnerName, daisyName }: {
  state: HouseholdState | null;
  palette: Palette;
  t: ThemeTokens;
  selfName: string;
  partnerName: string;
  daisyName: string;
}) {
  const [view, setView] = useState<0 | 1>(0);
  const toggle = () => setView((v) => (v === 0 ? 1 : 0));
  return view === 0
    ? <MonthTotals state={state} palette={palette} t={t} selfName={selfName} partnerName={partnerName} daisyName={daisyName} onToggle={toggle} />
    : <CaregiverCoverageAnalysis state={state} daisyName={daisyName} palette={palette} t={t} onToggle={toggle} />;
}

// Shared height for the two toggling stat cards so flipping between them never
// changes the panel's height (they stay the same size).
const STAT_CARD_MIN_H = 350;

// Bottom-pinned action button for the Childcare / Life boxes. Fixed height so
// the two always match, and it grows + glows on hover (in the box's accent).
function BoxButton({ label, onClick, accent, t, title }: {
  label: string;
  onClick: () => void;
  accent: string;
  t: ThemeTokens;
  title?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      style={{
        alignSelf: "stretch",
        width: "100%",
        marginTop: "auto",
        height: 38,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 8px",
        border: `0.5px solid ${hover ? rgba(accent, 0.5) : t.sep}`,
        borderRadius: 11,
        background: t.bgElev,
        color: accent,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        whiteSpace: "nowrap",
        cursor: "pointer",
        fontFamily: "inherit",
        transform: hover ? "scale(1.045)" : "none",
        boxShadow: hover ? `0 7px 20px ${rgba(accent, 0.34)}` : "none",
        transition: "transform .16s ease, box-shadow .16s ease, border-color .16s ease",
      }}
    >
      {label}
    </button>
  );
}

// A life event rendered as a round avatar with the green life-leaf badged into
// its corner. Tap opens the event; the title/time show on hover. Grows a touch
// on hover to signal it's tappable.
function LifeAvatarButton({ ev, title, palette, dark, onClick }: {
  ev: SbEvent;
  title: string;
  palette: Palette;
  dark: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      aria-label={title}
      style={{
        position: "relative",
        width: 32,
        height: 32,
        padding: 0,
        border: 0,
        background: "transparent",
        cursor: "pointer",
        borderRadius: "50%",
        flex: "none",
        lineHeight: 0,
        transform: hover ? "scale(1.1)" : "none",
        transition: "transform .15s ease",
      }}
    >
      {/* The disc + leaf are not hover targets, so the BUTTON's title (event ·
          time · person) is what the tooltip shows. EventAvatar's letter disc
          carries its own "Daisy"/"Family" title and would otherwise win. */}
      <span style={{ display: "block", lineHeight: 0, pointerEvents: "none" }}>
        <EventAvatar who={ev.who} size={32} palette={palette} dark={dark} />
      </span>
      <img
        src="assets/green-leaf.png"
        alt=""
        aria-hidden="true"
        width={14}
        height={14}
        style={{
          position: "absolute",
          right: -3,
          bottom: -3,
          pointerEvents: "none",
          display: "block",
          borderRadius: "50%",
          background: dark ? "#1C1C1E" : "#FFFFFF",
          border: `2px solid ${dark ? "#1C1C1E" : "#FFFFFF"}`,
          objectFit: "contain",
          boxSizing: "border-box",
        }}
      />
      {ev.pending && (
        <span
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#FF9F0A",
            border: `2px solid ${dark ? "#1C1C1E" : "#FFFFFF"}`,
            boxSizing: "border-box",
          }}
        />
      )}
    </button>
  );
}

// Two-dot slot indicator (● ○ / ○ ●) shown at the bottom of each stat card.
function SlotDots({ active, t }: { active: 0 | 1; t: ThemeTokens }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 6, paddingTop: 4 }}>
      {[0, 1].map((i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: i === active ? t.text : t.sep }} />
      ))}
    </div>
  );
}

// This-month totals across the household + a per-shift-type breakdown.
// Mirrors the web app's "This Month" stats panel.
function MonthTotals({ state, palette, t, selfName, partnerName, daisyName, onToggle }: {
  state: HouseholdState | null;
  palette: Palette;
  t: ThemeTokens;
  selfName: string;
  partnerName: string;
  daisyName: string;
  onToggle: () => void;
}) {
  if (!state) return null;
  const base = new Date();
  const y = base.getFullYear(), m = base.getMonth();
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

  const PAL = [palette.G, palette.K, "#BF5AF2", "#FF9F0A", "#30D158", "#5E5CE6", "#FF6961", "#40C8E0"];
  const nameFor: Record<string, string> = { G: selfName, K: partnerName, D: daisyName };
  const dotFor: Record<string, string> = { G: palette.G, K: palette.K, D: "#30D158" };
  const stats: [string, string][] = [
    ["Shifts", String(totalShifts)],
    ["Hours", `${Math.round(totalHours)}h`],
    ["Avg / shift", `${(totalShifts ? totalHours / totalShifts : 0).toFixed(1)}h`],
    ["Days off", String(daysOff)],
  ];

  const anyPeople = (["G", "K", "D"] as const).some((w) => per[w].count > 0);

  return (
    <div style={{ background: t.bgElev, border: `0.5px solid ${t.sep}`, borderRadius: 20, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: STAT_CARD_MIN_H }}>

        {/* Header — month name + slot toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px 8px" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: t.text, letterSpacing: "-0.01em" }}>{MONTHS_LONG[m]} {y}</div>
          <CardPager onPrev={onToggle} onNext={onToggle} t={t} />
        </div>

        {/* Stats — 4 up, left-rule dividers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "0 14px 10px" }}>
          {stats.map(([k, v], i) => (
            <div key={k} style={{ paddingLeft: i === 0 ? 0 : 9, borderLeft: i === 0 ? "none" : `1px solid ${t.sep}` }}>
              <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", color: t.text, lineHeight: 1 }}>{v}</div>
              <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: t.text3, marginTop: 5 }}>{k}</div>
            </div>
          ))}
        </div>

        {anyPeople && <div style={{ height: 1, background: t.sep, margin: "0 14px" }} />}

        {/* People chips */}
        {anyPeople && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "8px 14px" }}>
            {(["G", "K", "D"] as const).filter((w) => per[w].count > 0).map((w) => (
              <span key={w} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: t.bg, borderRadius: 999, padding: "5px 9px" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotFor[w], flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: t.text2, fontWeight: 500 }}>{nameFor[w]}</span>
                <b style={{ fontSize: 12, color: t.text, fontWeight: 700 }}>{per[w].hours.toFixed(1)}h</b>
                <span style={{ fontSize: 11, color: t.text3 }}>{per[w].count}</span>
              </span>
            ))}
          </div>
        )}

        <div style={{ height: 1, background: t.sep, margin: "0 14px" }} />

        {/* Shift-type breakdown */}
        <div style={{ padding: "9px 14px 8px", display: "flex", flexDirection: "column", gap: 7 }}>
          {typesArr.length ? typesArr.slice(0, 6).map((x, i) => (
            <div key={x.name} style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr) 84px 20px", alignItems: "center", gap: 9 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: PAL[i % PAL.length] }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</span>
              <span style={{ height: 8, background: rgba(PAL[i % PAL.length], 0.18), borderRadius: 999, position: "relative", overflow: "hidden" }}>
                <span style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(x.hours / maxHours * 100).toFixed(1)}%`, background: PAL[i % PAL.length], borderRadius: 999 }} />
              </span>
              <span style={{ textAlign: "right", fontSize: 12.5, fontWeight: 600, color: t.text3 }}>{x.count}</span>
            </div>
          )) : (
            <div style={{ fontSize: 12.5, color: t.text3 }}>No shifts this month.</div>
          )}
        </div>

        <div style={{ marginTop: "auto", paddingBottom: 10 }}>
          <SlotDots active={0} t={t} />
        </div>
    </div>
  );
}

// Small ‹ › (and optional ⟲ reset) pager used on the Inspector cards.
function CardPager({ onPrev, onNext, onReset, t }: {
  onPrev: () => void;
  onNext: () => void;
  onReset?: () => void;
  t: ThemeTokens;
}) {
  const btn: React.CSSProperties = {
    width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center",
    borderRadius: 6, border: `0.5px solid ${t.sep}`, background: t.bg, color: t.text2,
    cursor: "pointer", fontFamily: "inherit", fontSize: 13, lineHeight: 1, padding: 0,
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={(e) => e.stopPropagation()}>
      {onReset && (
        <button type="button" onClick={onReset} title="Back to current" style={{ ...btn, fontSize: 11 }}>●</button>
      )}
      <button type="button" onClick={onPrev} aria-label="Previous" title="Previous" style={btn}>‹</button>
      <button type="button" onClick={onNext} aria-label="Next" title="Next" style={btn}>›</button>
    </div>
  );
}

// Caregiver pay model — flat $400 a month ($200 twice a month).
const CAREGIVER_MONTHLY_PAY = 400;

/** Bottom-of-Inspector readout of the caregiver's confirmed coverage: total
 *  hours, flat-pay cost model, effective $/hr per month, blended rate, cadence,
 *  and date range. Computed from state.coverageRequests (status confirmed). */
function CaregiverCoverageAnalysis({ state, daisyName, palette, t, onToggle }: {
  state: HouseholdState | null;
  daisyName: string;
  palette: Palette;
  t: ThemeTokens;
  onToggle: () => void;
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

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtMonth = (k: string) => { const [y, m] = k.split("-").map(Number); return `${MONTHS[(m ?? 1) - 1]} '${String(y).slice(2)}`; };
  const recent = rows.slice(-6);
  const maxRate = Math.max(0.01, ...recent.map((r) => r.rate));
  const acc = palette.G;
  const stats: [string, string][] = [
    ["Total hours", `${totalH.toFixed(1)} h`],
    ["Total paid", `$${Math.round(totalCost).toLocaleString()}`],
    ["Blended rate", `$${blended.toFixed(2)}/hr`],
    ["Cadence", `~${avgWk.toFixed(0)} h/wk`],
  ];

  return (
    <div style={{ background: t.bgElev, border: `0.5px solid ${t.sep}`, borderRadius: 20, padding: "13px 14px 10px", display: "flex", flexDirection: "column", minHeight: STAT_CARD_MIN_H }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: t.text3 }}>Caregiver Coverage</div>
        <CardPager onPrev={onToggle} onNext={onToggle} t={t} />
      </div>

      {confirmed.length === 0 ? (
        <div style={{ fontSize: 13, color: t.text3, padding: "14px 2px 18px" }}>No confirmed coverage logged yet.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "9px 10px", marginTop: 9 }}>
            {stats.map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: t.text3 }}>{k}</div>
                <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: t.text, marginTop: 3 }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11.5, color: t.text3, fontWeight: 500, marginTop: 9 }}>
            {daisyName} · {confirmed.length} session{confirmed.length === 1 ? "" : "s"} · {humanDate(dates[0])} → {humanDate(dates[dates.length - 1])}
          </div>

          <div style={{ height: 1, background: t.sep, margin: "9px 0" }} />

          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: t.text3 }}>Effective $/hr by month</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
            {recent.map((r) => (
              <div key={r.k} style={{ display: "grid", gridTemplateColumns: "52px minmax(0,1fr) auto", alignItems: "center", gap: 9 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: t.text2, whiteSpace: "nowrap" }}>{fmtMonth(r.k)}</span>
                <span style={{ height: 9, borderRadius: 999, background: rgba(acc, 0.16), position: "relative", overflow: "hidden" }}>
                  <span style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${Math.round((r.rate / maxRate) * 100)}%`, background: acc, borderRadius: 999 }} />
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: t.text, textAlign: "right", whiteSpace: "nowrap" }}>
                  ${r.rate.toFixed(2)} <span style={{ color: t.text3, fontWeight: 500 }}>· {r.hours.toFixed(0)}h</span>
                </span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: t.text3, fontWeight: 500, marginTop: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Lower $/hr = better value.</div>
        </>
      )}

      <div style={{ marginTop: "auto", paddingTop: 10 }}>
        <SlotDots active={1} t={t} />
      </div>
    </div>
  );
}

// ─────────────────── Game Day dropdown ───────────────────

// WVU brand colors — gold accent for the game-day panel.
const WVU_GOLD = "#EAAA00";

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
      <path d="M8 2 H16 L22 8 V16 L16 22 H8 L2 16 V8 Z" fill="#FF453A" />
    </svg>
  );
}

function WandIcon({ size = 14, color = "#7FA86A" }: { size?: number; color?: string }) {
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
      <path d="M8 2 H16 L22 8 V16 L16 22 H8 L2 16 V8 Z" fill="#FF453A" />
    </svg>
  );
}

