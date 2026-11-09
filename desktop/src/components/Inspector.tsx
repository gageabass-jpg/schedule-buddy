import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayKindFromShifts, MONTHS_LONG, WEEKDAYS_3, type Shift, type ShiftMap } from "../data";
import { buildShiftMap, compactTime, type Event as SbEvent, type HouseholdState } from "../state";
import { personColor, rgba, BRAND_FONT, type Palette, type ThemeTokens } from "../theme";
import { BrandMark } from "./BrandMark";
import { blockForDate } from "../lib/writeScheduleBlock";
import {
  computeOverlapCandidates, parentDayRanges,
  hmToMin, MIN_WINDOW_MIN, TIMELINE_START_MIN, TIMELINE_SPAN_MIN, type MinuteRange,
} from "../lib/computeOverlap";
import type { WvuGame } from "../lib/wvuSchedule";
import { StretchBadge } from "./StretchBadge";
import type { StretchDay } from "../lib/stretch";
import { HolidayPayTag } from "./HolidayPayTag";
import { BlockTip } from "./BlockTip";
import { PhotoAv } from "./PhotoAv";
import { CaregiverChip } from "./CaregiverChip";
import { holidayOn } from "../../../shared/holidays";
import { GovernmentLineIcon } from "./ui/government-line-icon";
import { leaveByRange, type CommuteResult } from "../lib/commute";
import { FLAG_RED } from "./DayFlagPopover";
import { useHouseholdLook } from "../lib/householdLook";
import { OnCallRow } from "./OnCallBadge";
import { RouteMap } from "./RouteMap";
import { onCallOn } from "../lib/onCall";

/** localStorage key: whether the Month card's "This week" half is open. */
const WEEK_OPEN_KEY = "sbm.rail.weekOpen";

interface Props {
  selected: string;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  shifts: ShiftMap;
  /** Kaylene's stretches by date, for the fire beside her hours. */
  stretches?: Map<string, StretchDay>;
  /** "Leave by" results keyed `${date}_${who}` (lib/commute.ts). */
  commute?: Map<string, CommuteResult>;
  state: HouseholdState | null;
  selfName: string;
  partnerName: string;
  onEditShift?: (date: string, shift: Shift) => void;
  onDeleteShift?: (date: string, shift: Shift) => void;
  onOpenShiftDetail?: (date: string, shift: Shift, anchor?: DOMRect) => void;
  events: SbEvent[];
  /** All events keyed by date — powers the Life tab's next-60-days list. */
  eventsByDate: Record<string, SbEvent[]>;
  onAddEvent: () => void;
  onEditEvent: (ev: SbEvent) => void;
  onSendCoverageForDay: (date: string) => void;
  onToggleChildcareOff: (date: string, off: boolean) => void;
  onOpenScheduleBlock: () => void;
  /** Reminder cards above the day card. `reminderUpdate` is the 4-week
   *  cadence nudge; `reminderCaregiver` is condition-driven (uncovered days). */
  reminderUpdate?: boolean;
  reminderCaregiver?: boolean;
  /** How many upcoming days still need a caregiver. */
  coverageNeedsCount?: number;
  onDismissReminder?: (which: "update" | "caregiver") => void;
  onSendCaregiverRequests?: () => void;
  /** Open nucleusAI — the Childcare card's "Ask" action. */
  onAsk?: () => void;
  wvuGames: Map<string, WvuGame>;
}


export function Inspector({
  selected, palette, t, dark, shifts: allShifts, stretches, commute, state, selfName, partnerName,
  onEditShift, onDeleteShift, onOpenShiftDetail, events, eventsByDate, onAddEvent, onEditEvent, onSendCoverageForDay: _onSendCoverageForDay,
  onToggleChildcareOff: _onToggleChildcareOff,
  onOpenScheduleBlock, reminderUpdate, reminderCaregiver, coverageNeedsCount = 0,
  onDismissReminder, onSendCaregiverRequests, onAsk, wvuGames,
}: Props) {
  const look = useHouseholdLook();

  // The day cards slide between the selected day and the one after it. `page`
  // belongs to a selection: choosing another day starts back on the first card.
  const nextDate = shiftIso(selected, 1);
  const [pageState, setPageState] = useState<{ date: string; page: 0 | 1 }>({ date: selected, page: 0 });
  const page = pageState.date === selected ? pageState.page : 0;
  const pagerRef = useRef<HTMLDivElement>(null);
  const slideA = useRef<HTMLDivElement>(null);
  const slideB = useRef<HTMLDivElement>(null);
  // Each slide's height, so the strip is as tall as the card in view rather than
  // as tall as the taller of the two.
  const [slideHeights, setSlideHeights] = useState<{ date: string; h: [number, number] } | null>(null);
  const pagerHeight = slideHeights?.date === selected ? slideHeights.h[page] : undefined;
  useEffect(() => {
    const a = slideA.current, b = slideB.current;
    if (!a || !b) return;
    const measure = () => setSlideHeights({ date: selected, h: [a.offsetHeight, b.offsetHeight] });
    const ro = new ResizeObserver(measure);
    ro.observe(a); ro.observe(b);
    return () => ro.disconnect();
  }, [selected]);

  /** The strip follows the finger; this just notes which card is more than half in view. */
  const onPagerScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const next: 0 | 1 = e.currentTarget.scrollLeft > (slideB.current?.offsetLeft ?? 0) / 2 ? 1 : 0;
    setPageState((cur) => (cur.date === selected && cur.page === next ? cur : { date: selected, page: next }));
  };
  const goToPage = (to: 0 | 1, fromKeyboard: boolean) => {
    const box = pagerRef.current;
    if (!box) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ left: to === 0 ? 0 : (slideB.current?.offsetLeft ?? 0), behavior: reduce ? "auto" : "smooth" });
    // The card the button sat on goes inert as the strip moves, which would drop a
    // keyboard user's focus; hand it to the same control on the card that arrives.
    if (fromKeyboard) {
      box.addEventListener("scrollend", () => {
        (to === 0 ? slideA : slideB).current?.querySelector<HTMLElement>("[data-pager]")?.focus({ preventScroll: true });
      }, { once: true });
    }
  };

  // Schedule block covering the selected day (vacation, travel, etc.) — surfaces
  // a red striped notice card right under the day cards. Everything under the
  // cards stays on the selected day while the cards slide.
  const shifts = allShifts[selected];
  const dayBlock = blockForDate(state?.scheduleBlocks, selected);
  // Daisy's (caregiver) school time on the selected day — when she can't cover.
  const daisyName = state?.dependents?.daisy?.name?.trim() || (look.familyPhotos ? "Daisy" : "Caregiver");

  // Overview rail tabs (design boards): the header stays tied to the tapped
  // day; the tabs below switch the broader view (Month / Childcare / Life).
  const [railTab, setRailTab] = useState<"month" | "childcare" | "life">("month");

  // The Month card's "This week" half folds away, so the rail tucks up and only
  // scrolls when what's left still doesn't fit. Remembered between launches.
  const [weekOpen, setWeekOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(WEEK_OPEN_KEY) !== "0"; } catch { return true; }
  });
  const toggleWeek = () => {
    const next = !weekOpen;
    setWeekOpen(next);
    try { localStorage.setItem(WEEK_OPEN_KEY, next ? "1" : "0"); } catch { /* storage unavailable */ }
  };

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

  // "Today" / "Tomorrow" for the two cards, when they are that. The second
  // card says it up front; the first card's slide button names it ("Today").
  const selectedRel = relativeDay(selected, _todayIso);
  const nextRel = relativeDay(nextDate, _todayIso);
  const cardProps = {
    state, palette, t, dark, selfName, partnerName, daisyName, stretches, commute,
    onEditShift, onDeleteShift, onOpenShiftDetail,
  };

  return (
    <div
      className="glass-panel"
      style={{
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflowY: "auto",
        overflowX: "hidden",
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

      {/* The day cards: the selected day, and one slide over, the day after it
          ("Tomorrow" when that's what it is). The strip is a scroll-snap row, so a
          two-finger swipe on the trackpad drags it; the corner button on each card
          does the same for a mouse and the keyboard. Sliding only changes which day's
          card you're reading: the maps, schedule block and appointments below
          stay on the selected day. */}
      <div
        key={selected}
        ref={pagerRef}
        className="day-pager"
        onScroll={onPagerScroll}
        style={{
          flexShrink: 0,
          height: pagerHeight,
          transition: "height 240ms ease-in-out",
        }}
      >
        <div ref={slideA} className="day-pager-slide" inert={page !== 0}>
          <DayCard
            date={selected}
            pager={{ dir: "next", label: nextRel ?? "Next day", onClick: (e) => goToPage(1, e.detail === 0) }}
            {...cardProps}
            shifts={allShifts[selected]}
            wvuGame={wvuGames.get(selected)}
          />
        </div>
        <div ref={slideB} className="day-pager-slide" inert={page !== 1}>
          <DayCard
            date={nextDate}
            eyebrow={nextRel}
            pager={{ dir: "prev", label: selectedRel ?? shortDate(selected), onClick: (e) => goToPage(0, e.detail === 0) }}
            {...cardProps}
            shifts={allShifts[nextDate]}
            wvuGame={wvuGames.get(nextDate)}
          />
        </div>
      </div>

      {/* Route maps under the day cards: whoever leaves first goes first. They
          belong to the Month view; Childcare and Life give the room to their own cards. */}
      {railTab === "month" && (() => {
        const maps = (["G", "K"] as const)
          .map((who) => {
            const sh = (shifts ?? []).find((s) => s.who === who);
            const stype = sh && state?.shiftTypes.find((x) => x.id === sh.shiftTypeId);
            const r = commute?.get(`${selected}_${who}`);
            return r && stype && r.shiftStart === stype.start && r.routes?.length ? { who, r } : null;
          })
          .filter((m): m is { who: "G" | "K"; r: CommuteResult } => !!m)
          .sort((a, b) => a.r.leaveByMs - b.r.leaveByMs);
        return maps.map(({ who, r }) => (
          <RouteMap
            key={who} result={r} t={t} dark={dark}
            name={who === "G" ? selfName : partnerName}
            color={personColor(who, palette)}
          />
        ));
      })()}

      {/* Schedule block — only renders when the selected day is covered
          by an active block. Red striped header echoes the calendar's
          diagonal-stripe overlay so users connect the two visually. */}
      {dayBlock && (
        <div>
          <div style={{ ...subhead(t), marginBottom: 6 }}>Schedule Block</div>
          <div
            style={{
              borderRadius: 4,
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
                    color: t.clayText,
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
                  color: t.clayText,
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

      {/* Childcare tab — who has the kids this week, and what nobody holds. */}
      {railTab === "childcare" && look.childcare && (
        <ChildcareCard
          selected={selected}
          state={state}
          t={t}
          dark={dark}
          selfName={selfName}
          partnerName={partnerName}
          daisyName={daisyName}
          palette={palette}
          onRequestCover={onSendCaregiverRequests}
          onAsk={onAsk}
        />
      )}
      {railTab === "childcare" && look.childcare && (
        <CoverageCard
          selected={selected}
          state={state}
          t={t}
          dark={dark}
          selfName={selfName}
          partnerName={partnerName}
          daisyName={daisyName}
          palette={palette}
        />
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

      {/* Life tab — the next 60 days of occasions, in one Surface card. */}
      {railTab === "life" && (
      <div style={{ background: "var(--glass-fill-soft)", border: `1px solid var(--glass-line)`, borderRadius: 16, boxShadow: "inset 0 1px 0 var(--glass-edge)", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <span style={{ ...subhead(t), marginBottom: 0 }}>Life · next 60 days</span>
          {lifeClashCount > 0 && (
            <span style={{ fontSize: 13, fontWeight: 600, color: t.clayText }}>
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
              ev.who === "Daisy" ? (state?.dependents?.daisy?.name || "Caregiver") : "Family";
            const timeLabel = ev.startTime ? compactTime(ev.startTime) : "All day";
            const k = dayKindFromShifts(allShifts[ev.date]);
            const cover =
              k === "both" ? "Nobody is off." :
              k === "off" ? (look.hasPartner ? "Both off." : "Day off.") :
              k === "g" ? `${selfName} works · ${partnerName} off.` :
              k === "k" ? `${partnerName} works · ${selfName} off.` : "";
            // Notes get their own lines under the time; with none, the day's
            // cover (who's off) takes their place beside it.
            const notes = ev.notes?.trim() ?? "";
            const desc = notes ? "" : cover;
            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => onEditEvent(ev)}
                style={{
                  display: "grid", gridTemplateColumns: "56px 1fr", gap: 12, width: "100%",
                  alignItems: "start", textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                  padding: "12px 14px", borderRadius: 4, color: t.text,
                  background: clash ? (dark ? rgba("#8A4B38", 0.14) : "#EFDFDB") : t.bgElev,
                  border: clash ? `1px dashed ${rgba("#8A4B38", 0.55)}` : `1px solid ${t.sep}`,
                }}
              >
                {/* The date owns a column of its own, so the titles line up
                    down the list however long a date reads. */}
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: clash ? "#8A4B38" : t.text3, paddingTop: 2 }}>
                  {eyebrow}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: clash ? "#8A4B38" : t.text }}>
                      {ev.title}
                    </span>
                    {badge && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
                        padding: "2px 7px", borderRadius: 3,
                        background: clash ? t.bgElev : (ev.healthId ? rgba("#0F6E64", 0.14) : t.bgElev2),
                        border: clash ? `1px solid ${rgba("#8A4B38", 0.35)}` : "none",
                        color: clash ? "#8A4B38" : (ev.healthId ? "#0F6E64" : t.text2),
                      }}>{badge}</span>
                    )}
                    {ev.pending && <span style={{ fontSize: 10.5, color: t.clayText, fontWeight: 700 }}>(pending)</span>}
                  </div>
                  <div style={{ fontSize: 13, color: clash ? "#8A4B38" : t.text2, lineHeight: 1.4, marginTop: 5 }}>
                    {timeLabel} · {personName}{desc ? ` — ${desc}` : ""}
                  </div>
                  {notes && (
                    <div style={{ fontSize: 12.5, color: clash ? "#8A4B38" : t.text3, lineHeight: 1.45, marginTop: 3, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
                      {notes}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ height: 1, background: t.sep, marginTop: 14 }} />
        <div style={{ fontSize: 12, color: t.text3, lineHeight: 1.45, marginTop: 12, padding: "0 2px" }}>
          A clash means a childcare gap has been flagged. Nucleus never moves a shift for you.
        </div>
        <button
          type="button"
          onClick={onAddEvent}
          style={{
            marginTop: 12, width: "100%", padding: "12px 12px", borderRadius: 4,
            border: `1px solid ${t.sep}`, background: t.bgElev, color: t.text,
            fontFamily: BRAND_FONT, fontSize: 14, fontWeight: 600, cursor: "pointer",
            letterSpacing: "-0.01em",
          }}
        >
          Add an Event
        </button>
      </div>
      )}

      {/* Month tab — one card: this-month totals, then the week deltas. */}
      {railTab === "month" && (
        <div style={{ background: "var(--glass-fill-soft)", border: `1px solid var(--glass-line)`, borderRadius: 16, boxShadow: "inset 0 1px 0 var(--glass-edge)", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <MonthTotals state={state} palette={palette} t={t} selfName={selfName} partnerName={partnerName} daisyName={daisyName} />
          <div style={{ height: 1, background: t.sep }} />
          <MonthWeekDeltas selected={selected} state={state} t={t} open={weekOpen} onToggle={toggleWeek} />
        </div>
      )}

      {/* Bottom tab bar — Month / Childcare / Life (design boards). The strip
          behind it (.glass-foot) runs out over the rail's 14px padding and
          frosts whatever scrolls underneath it rather than hiding it. */}
      <div
        className="glass-foot"
        style={{
          position: "sticky",
          bottom: -14,
          zIndex: 1,
          marginTop: "auto",
          marginLeft: -14,
          marginRight: -14,
          marginBottom: -14,
          padding: "8px 14px 14px",
        }}
      >
        <InspectorTabBar
          tab={railTab}
          onTab={setRailTab}
          childcareCount={coverageNeedsCount}
          lifeCount={lifeClashCount}
          t={t}
        />
      </div>
    </div>
  );
}

/**
 * One day's card: the Month rail's headline for a date. The rail slides between
 * two of these (the selected day, then the day after it), so it takes the date
 * rather than reading the selection, and keeps its own edit-tray state.
 */
function DayCard({
  date, eyebrow, pager, shifts, wvuGame, state, palette, t, dark, selfName, partnerName, daisyName,
  stretches, commute, onEditShift, onDeleteShift, onOpenShiftDetail,
}: {
  date: string;
  /** "Tomorrow", "Today": set before the date when the card is that day. */
  eyebrow?: string | null;
  pager: { dir: "next" | "prev"; label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void };
  shifts: Shift[] | undefined;
  wvuGame?: WvuGame;
  state: HouseholdState | null;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  selfName: string;
  partnerName: string;
  daisyName: string;
  stretches?: Map<string, StretchDay>;
  commute?: Map<string, CommuteResult>;
  onEditShift?: (date: string, shift: Shift) => void;
  onDeleteShift?: (date: string, shift: Shift) => void;
  onOpenShiftDetail?: (date: string, shift: Shift, anchor?: DOMRect) => void;
}) {
  const look = useHouseholdLook();
  const [y, m, d] = date.split("-").map(Number);
  const kind = dayKindFromShifts(shifts);
  const holiday = holidayOn(date);
  const dayLabel = `${WEEKDAYS_3[new Date(y, m - 1, d).getDay()]} · ${MONTHS_LONG[m - 1]} ${d}`;
  // Which shift row has its edit/delete buttons revealed. Double-click
  // the row to toggle. Single-click reading-only state stays calm.
  const [revealedIdx, setRevealedIdx] = useState<number | null>(null);

  return (
    <div
      style={{
        borderRadius: 16,
        padding: 16,
        background: "var(--glass-fill-soft)",
        border: "1px solid var(--glass-line)",
        boxShadow: "inset 0 1px 0 var(--glass-edge)",
        // Fixed 2px Clay top accent — the day card's signature (prototype).
        borderTop: "2px solid #8A4B38",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ ...subhead(t), fontSize: 10, minWidth: 0 }}>
          {eyebrow && <span style={{ color: t.text, fontWeight: 700 }}>{eyebrow} · </span>}
          {dayLabel}
          {holiday && (
            <span style={{ color: t.tealText }}>
              {" · "}
              <GovernmentLineIcon size={11} aria-hidden="true" style={{ color: t.text3, verticalAlign: "-1.5px", marginRight: 3 }} />
              {holiday.name}
            </span>
          )}
        </div>
        {/* The slide control: next day from the first card, back from the second. */}
        <button
          type="button"
          data-pager=""
          onClick={pager.onClick}
          aria-label={pager.dir === "next" ? `Show ${pager.label}'s card` : `Back to ${pager.label}`}
          className="opacity-80 transition-opacity hover:opacity-100"
          style={{
            flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 1,
            margin: "-3px -4px 0 0", padding: "3px 4px 3px 6px", borderRadius: 6,
            border: 0, background: "transparent", cursor: "pointer", fontFamily: "inherit",
            fontSize: 11, fontWeight: 600, letterSpacing: "-0.01em", color: t.text2,
          }}
        >
          {pager.dir === "prev" && <ChevronLeft size={14} aria-hidden="true" />}
          {pager.label}
          {pager.dir === "next" && <ChevronRight size={14} aria-hidden="true" />}
        </button>
      </div>
      <div style={{ fontFamily: BRAND_FONT, fontSize: 20, fontWeight: 600, color: t.text, letterSpacing: "-0.02em", marginTop: 4, lineHeight: 1.15 }}>
        {kind === "off"
          ? (look.hasPartner ? "Both off" : "Day off")
          : kind === "both"
            ? "Both working"
            : kind === "g"
              ? `${selfName} works`
              : `${partnerName} works`}
      </div>
      {(() => {
        const onCall = onCallOn(state, date);
        return onCall ? <OnCallRow entry={onCall} name={partnerName} color={palette.K} t={t} fontSize={13.5} margin="8px 0 0" /> : null;
      })()}
      <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
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
              onClick={(e) => onOpenShiftDetail?.(date, s, e.currentTarget.getBoundingClientRect())}
              onDoubleClick={() => hasActions && setRevealedIdx(revealed ? null : i)}
              title={hasActions ? "Double-click to reveal edit/delete" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "11px 2px",
                // Hairline above each row — the under-title rule and the
                // between-row rules both come from this (prototype).
                borderTop: `1px solid ${t.sep}`,
                cursor: onOpenShiftDetail || hasActions ? "pointer" : "default",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <span style={{ width: 4, alignSelf: "stretch", minHeight: 22, borderRadius: 2, background: c, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.who === "G" ? selfName : s.who === "K" ? partnerName : daisyName}
                {s.who === "D" && daisyName !== "Caregiver" && <CaregiverChip t={t} fontSize={12} />}
                {recurring && <span style={{ fontWeight: 400, color: t.text3 }}> · recurring</span>}
                {(() => {
                  // Leave by, from the traffic check before this shift.
                  const c = (s.who === "G" || s.who === "K") ? commute?.get(`${date}_${s.who}`) : undefined;
                  if (!c || !stype || c.shiftStart !== stype.start) return null;
                  const window_ = leaveByRange(c, compactTime);
                  // Wraps rather than clips: the row's name line is nowrap.
                  return (
                    <div
                      style={{ fontSize: 12, fontWeight: 500, marginTop: 2, color: c.heavy ? FLAG_RED : t.text2, whiteSpace: "normal", lineHeight: 1.35 }}
                      title={`${c.durationMin} min to ${c.placeLabel}${c.live ? " right now" : " expected"}${c.usualMin ? ` · usually ${c.usualMin} min` : ""}`}
                    >
                      <div>{c.heavy && c.earlierMin ? `Traffic: ${c.earlierMin} min earlier · ` : ""}{window_}</div>
                      <div style={{ fontWeight: 400, color: c.heavy ? FLAG_RED : t.text3 }}>{c.durationMin} min drive</div>
                    </div>
                  );
                })()}
              </div>
              {holiday && (s.who === "G" || s.who === "K") && <HolidayPayTag t={t} fontSize={11.5} />}
              {s.who === "K" && stretches?.get(date) && (
                <StretchBadge stretch={stretches.get(date)!} name={partnerName} size={15} fontSize={14} />
              )}
              <span
                style={{
                  fontSize: 14,
                  color: t.text2,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
                title={pillText}
              >
                {stype ? `${compactTime(stype.start)} – ${compactTime(stype.end)}` : s.label}
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
                      onClick={(e) => { e.stopPropagation(); onEditShift?.(date, s); }}
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
                      onClick={(e) => { e.stopPropagation(); onDeleteShift?.(date, s); }}
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
          <div style={{ fontSize: 12, color: t.text3, padding: "12px 2px", borderTop: `1px solid ${t.sep}` }}>{look.hasPartner ? "Free day. Plan something together." : "Nothing scheduled."}</div>
        )}
      </div>

      {/* Game Day — drops down from the work-status card on WVU game days. */}
      {wvuGame && <GameDayDropdown game={wvuGame} t={t} dark={dark} />}
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
  const look = useHouseholdLook();
  const tabs: Array<{ key: "month" | "childcare" | "life"; label: string; count: number }> = [
    { key: "month", label: "Month", count: 0 },
    ...(look.childcare ? [{ key: "childcare" as const, label: "Childcare", count: childcareCount }] : []),
    { key: "life", label: "Life", count: lifeCount },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: 4,
        borderRadius: 4,
        background: "var(--glass-cell)",
        border: "1px solid var(--glass-line)",
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
              borderRadius: 4,
              border: 0,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              background: active ? "var(--glass-chip)" : "transparent",
              color: active ? t.text : t.text2,
              boxShadow: active ? "inset 0 0 0 1px var(--glass-line), inset 0 1px 0 var(--glass-edge)" : "none",
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

  const per: Record<string, { count: number; hours: number }> = { G: { count: 0, hours: 0 }, K: { count: 0, hours: 0 }, D: { count: 0, hours: 0 } };
  const workDays = new Set<string>();
  let totalShifts = 0, totalHours = 0;
  for (let dd = 1; dd <= daysInMonth; dd++) {
    const key = iso(dd);
    for (const s of (map[key] || [])) {
      const hrs = hoursOf(s.shiftTypeId);
      totalShifts++; totalHours += hrs; workDays.add(key);
      if (per[s.who]) { per[s.who].count++; per[s.who].hours += hrs; }
    }
  }
  const daysOff = daysInMonth - workDays.size;
  const nameFor: Record<string, string> = { G: selfName, K: partnerName, D: daisyName };
  const stats: [string, string][] = [
    ["Shifts", String(totalShifts)],
    ["Hours", String(Math.round(totalHours))],
    ["Avg", (totalShifts ? totalHours / totalShifts : 0).toFixed(1)],
    ["Off", String(daysOff)],
  ];
  const persons = (["G", "K", "D"] as const).filter((w) => per[w].count > 0);
  const maxPersonH = Math.max(0.01, ...persons.map((w) => per[w].hours));

  const BAR = palette.G; // teal magnitude bar (design board), name carries identity
  return (
    <div>
      {/* Stat row — big Sora number over a short caps label (design board). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {stats.map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: 19, fontWeight: 500, letterSpacing: "-0.01em", color: t.text, fontVariantNumeric: "tabular-nums" }}>{v}</div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: t.text3, marginTop: 3 }}>{k}</div>
          </div>
        ))}
      </div>
      {/* Per-person hours — a thin teal magnitude bar per person, not a dot. */}
      {persons.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          {persons.map((w) => (
            <div key={w} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 56, fontSize: 14, fontWeight: 400, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 }}>{nameFor[w]}</span>
              <span style={{ flex: 1, height: 8, background: t.bgElev2, borderRadius: 2, overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${(per[w].hours / maxPersonH * 100).toFixed(1)}%`, background: BAR, borderRadius: 2 }} />
              </span>
              <span style={{ width: 46, textAlign: "right", fontSize: 12, fontWeight: 600, color: t.text, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{per[w].hours.toFixed(1)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: t.text3, marginTop: 12 }}>No shifts this month.</div>
      )}
    </div>
  );
}

// Caregiver pay model — flat $400 a month ($200 twice a month).


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
        borderRadius: 4,
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





function iconBtnStyle(t: ThemeTokens): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    border: `1px solid ${t.sep}`,
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

// "This week vs 8-week average" deltas for the Month tab (design boards).
// Splits each of the last 9 weeks into: your work hours, together (both parents
// home, 6am–midnight), you-solo (you home while your partner works), and
// uncovered (the coverage engine's real gap hours). Compares this week to the
// mean of the trailing 8. Together/solo are the parents-only picture, so they
// can differ slightly from the web app's caregiver-adjusted figures.
function MonthWeekDeltas({ selected, state, t, open, onToggle }: {
  selected: string;
  state: HouseholdState | null;
  t: ThemeTokens;
  open: boolean;
  onToggle: () => void;
}) {
  const bodyId = useId();
  if (!state) return null;
  const AXIS_START = 6 * 60, AXIS_END = 24 * 60, SLOT = 15;
  /** Length of an uncovered window in hours, rolling over midnight. */
  const winHours = (c: { startTime: string; endTime: string; endsNextDay: boolean }): number => {
    const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
    let d = toMin(c.endTime) - toMin(c.startTime);
    if (c.endsNextDay || d <= 0) d += 1440;
    return d / 60;
  };
  /** Length of an uncovered window in hours, rolling over midnight. */
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const parseHM = (hhmm: string): number => { const [h, m] = hhmm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const inRanges = (min: number, ranges: MinuteRange[]): boolean => ranges.some((r) => min >= r.startMin && min < r.endMin);
  const [sy, sm, sd] = selected.split("-").map(Number);
  const thisWeekStart = new Date(sy, sm - 1, sd);
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay()); // Sunday
  const WEEKS = 9; // this week + 8 trailing
  const firstStart = new Date(thisWeekStart); firstStart.setDate(thisWeekStart.getDate() - 7 * (WEEKS - 1));
  const stFilled: HouseholdState = { ...state, template: state.template ?? [], overrides: state.overrides ?? [], ot: state.ot ?? [] };
  const fromDt = new Date(firstStart); fromDt.setDate(firstStart.getDate() - 1);
  const toDt = new Date(thisWeekStart); toDt.setDate(thisWeekStart.getDate() + 8);
  const shiftMap = buildShiftMap(stFilled, iso(fromDt), iso(toDt));
  const cands = computeOverlapCandidates(shiftMap, stFilled);
  const dur = (typeId: string | undefined): number => {
    if (!typeId) return 0;
    const ty = state.shiftTypes.find((x) => x.id === typeId);
    if (!ty) return 0;
    let d = parseHM(ty.end) - parseHM(ty.start);
    if (ty.crossesMidnight || d <= 0) d += 1440;
    return d / 60;
  };

  const your: number[] = [], together: number[] = [], solo: number[] = [], uncovered: number[] = [];
  for (let w = 0; w < WEEKS; w++) {
    const ws = new Date(firstStart); ws.setDate(firstStart.getDate() + 7 * w);
    let yourH = 0, togMin = 0, soloMin = 0, uncH = 0;
    for (let dd = 0; dd < 7; dd++) {
      const d = new Date(ws); d.setDate(ws.getDate() + dd);
      const date = iso(d);
      for (const s of (shiftMap[date] ?? [])) if (s.who === "G") yourH += dur(s.shiftTypeId);
      const gR = parentDayRanges(date, "G", shiftMap, stFilled);
      const kR = parentDayRanges(date, "K", shiftMap, stFilled);
      for (let m = AXIS_START; m < AXIS_END; m += SLOT) {
        const mid = m + SLOT / 2;
        const gB = inRanges(mid, gR), kB = inRanges(mid, kR);
        if (!gB && !kB) togMin += SLOT;          // both home
        else if (!gB && kB) soloMin += SLOT;     // you home, partner working
      }
      for (const c of cands) if (c.date === date) uncH += winHours(c);
    }
    your.push(yourH);
    together.push(togMin / 60);
    solo.push(soloMin / 60);
    uncovered.push(uncH);
  }

  const metrics = [
    { label: "Your hours", arr: your, goodUp: false },
    { label: "Together", arr: together, goodUp: true },
    { label: "You solo", arr: solo, goodUp: false },
    { label: "Uncovered", arr: uncovered, goodUp: false },
  ];
  const fmt = (h: number): string => (h % 1 === 0 ? String(h) : h.toFixed(1));

  return (
    <div>
      {/* The heading is the control: it folds the rows away and leaves just itself. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        style={{
          display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8,
          padding: 0, border: 0, background: "transparent", cursor: "pointer",
          fontFamily: "inherit", textAlign: "left", color: "inherit",
        }}
      >
        <span style={{ ...subhead(t), marginBottom: 0 }}>This week</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 11, color: t.text2,
              opacity: open ? 1 : 0, transition: "opacity 200ms ease",
            }}
          >
            vs 8-week average
          </span>
          <ChevronRight
            size={14}
            strokeWidth={2}
            aria-hidden
            className="motion-reduce:transition-none"
            style={{
              color: t.text3, flexShrink: 0,
              transform: open ? "rotate(90deg)" : "none", transition: "transform 200ms ease",
            }}
          />
        </span>
      </button>
      {/* Rows sit in a 1fr/0fr grid so the card eases shut to the heading's height. */}
      <div
        id={bodyId}
        inert={!open}
        className="motion-reduce:transition-none"
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
          transition: "grid-template-rows 280ms ease-in-out, opacity 200ms ease",
        }}
      >
      <div style={{ minHeight: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 10 }}>
        {metrics.map((mtr) => {
          const cur = mtr.arr[mtr.arr.length - 1] ?? 0;
          const past = mtr.arr.slice(0, -1);
          const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : 0;
          const delta = cur - avg;
          const near0 = Math.abs(delta) < 0.05;
          const good = (delta > 0) === mtr.goodUp;
          const bad = !good && !near0;
          const maxV = Math.max(0.1, ...mtr.arr);
          return (
            <div key={mtr.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: t.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mtr.label}</span>
              <span style={{ fontSize: 15, color: t.text, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmt(cur)}h</span>
              {/* Delta pill — Clay-Tint when the move is bad, quiet Track otherwise. */}
              <span style={{
                fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                padding: "2px 7px", borderRadius: 3, flexShrink: 0,
                background: bad ? t.clayTint : t.bgElev2,
                color: bad ? t.clayText : t.text2,
              }}>
                {near0 ? "±0" : `${delta > 0 ? "▲" : "▼"} ${fmt(Math.abs(delta))}`}
              </span>
              {/* Trailing 9-week sparkline; the current week is the coloured bar. */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 20, width: 56, flexShrink: 0, justifyContent: "flex-end" }}>
                {mtr.arr.map((v, i) => (
                  <span key={i} style={{
                    width: 4, borderRadius: 1,
                    height: Math.max(2, (v / maxV) * 20),
                    background: i === mtr.arr.length - 1 ? (bad ? "#8A4B38" : "#0F6E64") : t.bgElev2,
                  }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      </div>
      </div>
    </div>
  );
}

const AXIS_END = TIMELINE_START_MIN + TIMELINE_SPAN_MIN;

/** The free stretches on the 6am–midnight axis, given a parent's busy ranges. */
function freeOf(busy: MinuteRange[]): MinuteRange[] {
  const out: MinuteRange[] = [];
  let at = TIMELINE_START_MIN;
  for (const b of busy.slice().sort((a, c) => a.startMin - c.startMin)) {
    if (b.startMin > at) out.push({ startMin: at, endMin: b.startMin });
    at = Math.max(at, b.endMin);
  }
  if (at < AXIS_END) out.push({ startMin: at, endMin: AXIS_END });
  return out;
}

/** Where `free` and `busy` overlap, dropping handoff slivers under an hour. */
function within(free: MinuteRange[], busy: MinuteRange[]): MinuteRange[] {
  const out: MinuteRange[] = [];
  for (const f of free) for (const b of busy) {
    const a = Math.max(f.startMin, b.startMin), z = Math.min(f.endMin, b.endMin);
    if (z - a >= MIN_WINDOW_MIN) out.push({ startMin: a, endMin: z });
  }
  return out;
}

const sumHours = (rs: MinuteRange[]) => rs.reduce((n, r) => n + (r.endMin - r.startMin), 0) / 60;

/** The Sunday-to-Saturday week around `selected`, as ISO dates. */
function weekDays(selected: string): string[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const [sy, sm, sd] = selected.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
}

// Childcare coverage card: the week's hours with the kids, 6am to midnight, as
// one bar each for the two parents and the caregiver. A parent's hours are the
// time they're home solo (free while the other is out or asleep); the
// caregiver's are her confirmed requests.
function CoverageCard({
  selected, state, t, dark, selfName, partnerName, daisyName, palette,
}: {
  selected: string;
  state: HouseholdState | null;
  t: ThemeTokens;
  dark: boolean;
  selfName: string;
  partnerName: string;
  daisyName: string;
  palette: Palette;
}) {
  const look = useHouseholdLook();
  if (!state) return null;
  const days = weekDays(selected);
  const filled: HouseholdState = { ...state, template: state.template ?? [], overrides: state.overrides ?? [], ot: state.ot ?? [] };
  const prev = new Date(days[0].replace(/-/g, "/")); prev.setDate(prev.getDate() - 1);
  const next = new Date(days[6].replace(/-/g, "/")); next.setDate(next.getDate() + 2);
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const shiftMap = buildShiftMap(filled, iso(prev), iso(next));

  const parents = { G: { solo: 0 }, K: { solo: 0 } };
  for (const date of days) {
    const gBusy = parentDayRanges(date, "G", shiftMap, filled);
    const kBusy = parentDayRanges(date, "K", shiftMap, filled);
    parents.G.solo += sumHours(within(freeOf(gBusy), kBusy));
    parents.K.solo += sumHours(within(freeOf(kBusy), gBusy));
  }

  let confirmed = 0;
  for (const r of state.coverageRequests ?? []) {
    if (!days.includes(r.date)) continue;
    const a = Math.max(hmToMin(r.startTime), TIMELINE_START_MIN);
    const z = Math.min(hmToMin(r.endTime, r.endsNextDay || r.endTime <= r.startTime), AXIS_END);
    if (z <= a) continue;
    if (r.status === "confirmed") confirmed += (z - a) / 60;
  }

  type Row = { key: "G" | "K" | "D"; name: string; hours: number };
  const h = (n: number) => `${Math.round(n)}h`;
  const rows: Row[] = [
    { key: "G", name: selfName, hours: parents.G.solo },
    ...(look.hasPartner ? [{ key: "K" as const, name: partnerName, hours: parents.K.solo }] : []),
    { key: "D", name: daisyName, hours: confirmed },
  ];
  const max = Math.max(1, ...rows.map((r) => r.hours));
  const [wy, wm, wd] = days[0].split("-").map(Number);
  const [ey, em, ed] = days[6].split("-").map(Number);
  void wy; void ey;
  const range = wm === em ? `${MONTHS_LONG[wm - 1].slice(0, 3)} ${wd}–${ed}` : `${MONTHS_LONG[wm - 1].slice(0, 3)} ${wd} – ${MONTHS_LONG[em - 1].slice(0, 3)} ${ed}`;

  return (
    <div style={{ background: "var(--glass-fill-soft)", border: `1px solid var(--glass-line)`, borderRadius: 16, boxShadow: "inset 0 1px 0 var(--glass-edge)", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ ...subhead(t), marginBottom: 0 }}>Childcare coverage</span>
        <span style={{ fontSize: 12, color: t.text3, whiteSpace: "nowrap" }}>{range}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((r) => {
          const color = personColor(r.key, palette);
          return (
            <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <PhotoAv who={r.key} size={26} palette={palette} dark={dark} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{r.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: t.text, fontVariantNumeric: "tabular-nums" }}>{h(r.hours)}</span>
                </div>
                <div
                  role="img"
                  aria-label={`${r.name}: ${h(r.hours)}`}
                  style={{ display: "flex", height: 10, marginTop: 4, borderRadius: 2, background: t.bgElev2, overflow: "hidden" }}
                >
                  <div style={{ width: `${(r.hours / max) * 100}%`, background: color }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Childcare tab card: who has the kids this week. One track per day on the
// 6am–midnight axis, showing the time neither parent is home and who holds it,
// in the same marks as the Childcare Matrix: solid = Daisy, dashed Teal =
// holding (asked, not yet answered), dashed Clay = a gap. Each bar's hover
// card says who is watching and when. Days nobody holds are
// then spelled out as consequences. Gaps come from the app's own overlap
// engine, so a night shift's rest still lands here when there is one.
type HoldKind = "has" | "waiting" | "nobody";

function ChildcareCard({
  selected, state, t, dark, selfName, partnerName, daisyName, palette, onRequestCover, onAsk,
}: {
  selected: string;
  palette: Palette;
  state: HouseholdState | null;
  t: ThemeTokens;
  dark: boolean;
  selfName: string;
  partnerName: string;
  daisyName: string;
  onRequestCover?: () => void;
  onAsk?: () => void;
}) {
  const look = useHouseholdLook();
  if (!state) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const [sy, sm, sd] = selected.split("-").map(Number);
  const weekStart = new Date(sy, sm - 1, sd);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // back to Sunday
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); days.push(iso(d));
  }
  const fromDt = new Date(weekStart); fromDt.setDate(weekStart.getDate() - 1);
  const toDt = new Date(weekStart); toDt.setDate(weekStart.getDate() + 7);
  const stFilled: HouseholdState = {
    ...state,
    template: state.template ?? [],
    overrides: state.overrides ?? [],
    ot: state.ot ?? [],
  };
  const shiftMap = buildShiftMap(stFilled, iso(fromDt), iso(toDt));
  const cands = computeOverlapCandidates(shiftMap, stFilled);
  const requests = state.coverageRequests ?? [];
  const hm = (h: number): string => {
    const H = Math.floor(h); const M = Math.round((h - H) * 60);
    return M ? `${H}h${pad(M)}` : `${H}h`;
  };
  const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const CLAY = "#8A4B38";
  const TEAL = dark ? "#9ACFC6" : "#0F6E64";

  // Where a range sits on the 6am–midnight axis, as percentages.
  const place = (startMin: number, endMin: number) => {
    const a = Math.max(startMin, TIMELINE_START_MIN);
    const b = Math.min(endMin, TIMELINE_START_MIN + TIMELINE_SPAN_MIN);
    if (b <= a) return null;
    return {
      left: ((a - TIMELINE_START_MIN) / TIMELINE_SPAN_MIN) * 100,
      width: ((b - a) / TIMELINE_SPAN_MIN) * 100,
    };
  };

  // Each day's gaps and who holds them. A request on the day is what's
  // actually been asked for, so it wins over the engine's window; a gap with
  // no live request is nobody's.
  const rows = days.map((date) => {
    const dayReqs = requests.filter((r) => r.date === date);
    const held: Array<{ kind: HoldKind; startMin: number; endMin: number; declined: boolean }> = dayReqs.map((r) => ({
      kind: r.status === "confirmed" ? "has" : r.status === "pending" ? "waiting" : "nobody",
      startMin: hmToMin(r.startTime),
      endMin: hmToMin(r.endTime, r.endsNextDay || r.endTime <= r.startTime),
      declined: r.status === "declined" || r.status === "issue",
    }));
    if (dayReqs.length === 0) {
      for (const c of cands.filter((x) => x.date === date)) {
        held.push({ kind: "nobody", startMin: hmToMin(c.startTime), endMin: hmToMin(c.endTime, c.endsNextDay), declined: false });
      }
    }
    const nobody = held.filter((h) => h.kind === "nobody");
    return {
      date,
      held,
      nobody,
      uncoveredHours: nobody.reduce((sum, h) => sum + (h.endMin - h.startMin), 0) / 60,
    };
  });
  const needCover = rows.filter((r) => r.nobody.length > 0).length;

  // Solo with the kids: one parent is free and the other is away or asleep
  // (the same unavailable ranges the gaps come from). It can't overlap a gap,
  // which is when neither is free. Handoff slivers under an hour don't count.
  type Solo = { who: "G" | "K"; startMin: number; endMin: number };
  const soloByDay: Solo[][] = days.map((date) => {
    if (!look.hasPartner) return [];
    const gBusy = parentDayRanges(date, "G", shiftMap, stFilled);
    const kBusy = parentDayRanges(date, "K", shiftMap, stFilled);
    return [
      ...within(freeOf(gBusy), kBusy).map((r) => ({ who: "G" as const, ...r })),
      ...within(freeOf(kBusy), gBusy).map((r) => ({ who: "K" as const, ...r })),
    ];
  });
  const anyGap = rows.some((r) => r.held.length > 0) || soloByDay.some((d) => d.length > 0);

  // The days nobody holds, said as a consequence: what each person who could
  // be home is doing instead.
  const typeOf = (id?: string) => state.shiftTypes.find((x) => x.id === id);
  const gaps = rows.flatMap((r, i) => {
    const date = r.date;
    const [gy, gm, dd] = date.split("-").map(Number);
    const prev = new Date(gy, gm - 1, dd - 1);
    const dayShifts = shiftMap[date] ?? [];
    const partnerToday = dayShifts.find((x) => x.who === "K");
    const partnerYesterday = (shiftMap[iso(prev)] ?? []).find((x) => x.who === "K");
    const selfToday = dayShifts.find((x) => x.who === "G");
    const daisyToday = dayShifts.find((x) => x.who === "D");
    const title = (s: string) => `${s.charAt(0)}${s.slice(1).toLowerCase()}`;

    return r.nobody.map((g) => {
      const parts: string[] = [];
      if (g.declined) parts.push(`${daisyName} said no.`);
      const pt = partnerToday ? typeOf(partnerToday.shiftTypeId) : undefined;
      const yt = partnerYesterday ? typeOf(partnerYesterday.shiftTypeId) : undefined;
      if (pt && (pt.preSleepHours ?? 0) > 0 && g.startMin < hmToMin(pt.start)) {
        parts.push(`${partnerName} rests before her night.`);
      } else if (pt) {
        parts.push(`${partnerName} works ${compactTime(pt.start)}.`);
      } else if (yt && (yt.sleepHours ?? 0) > 0) {
        parts.push(`${partnerName} recovers from ${title(WD[(i + 6) % 7])} night.`);
      } else {
        parts.push(`${partnerName} is out.`);
      }
      if (selfToday) {
        const st = typeOf(selfToday.shiftTypeId);
        parts.push(st ? `You work ${compactTime(st.start)}.` : "You work.");
      }
      if (daisyToday) {
        const dt = typeOf(daisyToday.shiftTypeId);
        parts.push(dt ? `${daisyName} has class until ${compactTime(dt.end)}.` : `${daisyName} has class.`);
      }
      const hhmm = (m: number) => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
      return {
        key: `${date}-${g.startMin}`,
        head: `${title(WD[i])} ${dd} · ${compactTime(hhmm(g.startMin))} – ${compactTime(hhmm(g.endMin))}${g.endMin > 1440 ? " +1d" : ""}`,
        body: parts.join(" "),
      };
    });
  });

  // "2p – 3:30p" (and "+1d" when it runs past midnight), for the hover cards.
  const clock = (m: number) => compactTime(`${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`);
  const span = (a: number, b: number) => `${clock(a)} – ${clock(b)}${b > 1440 ? " +1d" : ""}`;
  const tipFor = (h: { kind: HoldKind; startMin: number; endMin: number; declined: boolean }) =>
    h.kind === "has"
      ? { name: daisyName, detail: `${span(h.startMin, h.endMin)} · Confirmed` }
      : h.kind === "waiting"
        ? { name: daisyName, detail: `${span(h.startMin, h.endMin)} · Holding, not answered yet` }
        : { name: "Gap", detail: `${span(h.startMin, h.endMin)} · ${h.declined ? `${daisyName} said no` : "Nobody is watching"}` };

  const barStyle = (kind: HoldKind): React.CSSProperties =>
    kind === "has" ? { background: dark ? "#8A9591" : "#5A6663" } :
    kind === "waiting" ? { border: `1.5px dashed ${TEAL}` } :
    { background: dark ? rgba(CLAY, 0.18) : "#EFDFDB", border: `1.5px dashed ${rgba(CLAY, 0.8)}` };

  return (
    <div style={{ background: "var(--glass-fill-soft)", border: `1px solid var(--glass-line)`, borderRadius: 16, boxShadow: "inset 0 1px 0 var(--glass-edge)", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ ...subhead(t), marginBottom: 0 }}>Who has the kids this week?</span>
        {needCover > 0 && (
          <span style={{ fontSize: 13, fontWeight: 600, color: t.clayText, whiteSpace: "nowrap" }}>{needCover} need cover</span>
        )}
      </div>

      {!anyGap ? (
        <div style={{ fontSize: 13.5, color: t.text2, lineHeight: 1.45 }}>
          {look.hasPartner
            ? <>Someone&rsquo;s home all week. {selfName} and {partnerName} are never both out at once.</>
            : <>{selfName} is home whenever the kids need someone this week.</>}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {rows.map((r, i) => (
              <div key={r.date} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 30, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", color: t.text2 }}>{WD[i]}</span>
                {/* The track is the waking day, 6am to midnight; a gap sits
                    where it actually falls, so the shape of the week reads. */}
                <div style={{ flex: 1, height: 17, borderRadius: 2, background: t.bgElev2, position: "relative", overflow: "hidden" }}>
                  {r.held.map((h, k) => {
                    const p = place(h.startMin, h.endMin);
                    if (!p) return null;
                    const tip = tipFor(h);
                    return (
                      <BlockTip
                        key={k}
                        avatar={h.kind === "nobody"
                          ? <span style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, boxSizing: "border-box", ...barStyle("nobody") }} />
                          : <PhotoAv who="D" size={30} palette={palette} dark={dark} />}
                        name={tip.name}
                        detail={tip.detail}
                      >
                        <div style={{
                          position: "absolute", top: 2, bottom: 2, left: `${p.left}%`, width: `${p.width}%`,
                          borderRadius: 2, boxSizing: "border-box", ...barStyle(h.kind),
                        }} />
                      </BlockTip>
                    );
                  })}
                  {soloByDay[i].map((x, k) => {
                    const p = place(x.startMin, x.endMin);
                    if (!p) return null;
                    const name = x.who === "G" ? selfName : partnerName;
                    return (
                      <BlockTip
                        key={`s${k}`}
                        avatar={<PhotoAv who={x.who} size={30} palette={palette} dark={dark} />}
                        name={`${name} is home solo`}
                        detail={`${span(x.startMin, x.endMin)} · ${x.who === "G" ? partnerName : selfName} is out`}
                      >
                        <div style={{
                          position: "absolute", top: 5, bottom: 5, left: `${p.left}%`, width: `${p.width}%`,
                          borderRadius: 2, boxSizing: "border-box", background: personColor(x.who, palette),
                        }} />
                      </BlockTip>
                    );
                  })}
                </div>
                <span style={{ width: 34, textAlign: "right", fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: r.uncoveredHours > 0 ? CLAY : "transparent" }}>
                  {r.uncoveredHours > 0 ? hm(r.uncoveredHours) : "·"}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 11.5, color: t.text2 }}>
            {(["has", "waiting", "nobody"] as const).map((k) => (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 18, height: 10, borderRadius: 2, boxSizing: "border-box", ...barStyle(k) }} />
                {k === "has" ? daisyName : k === "waiting" ? "Holding" : "Gap"}
              </span>
            ))}
          </div>
        </>
      )}

      {gaps.length > 0 && (
        <>
          <div style={{ height: 1, background: t.sep }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {gaps.map((g) => (
              <div key={g.key} style={{ padding: "9px 11px", borderRadius: 4, background: dark ? rgba(CLAY, 0.14) : "#EFDFDB", border: `1px dashed ${rgba(CLAY, 0.5)}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>{g.head}</div>
                <div style={{ fontSize: 12, color: t.text2, lineHeight: 1.4, marginTop: 3 }}>{g.body}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onAsk}
          style={{ minHeight: 44, display: "inline-flex", alignItems: "center", gap: 7, padding: "0 14px", borderRadius: 4, border: 0, background: t.tealTint, color: dark ? t.tealText : "#0A4F48", fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "-0.01em" }}
        >
          <BrandMark size={14} color={dark ? t.tealText : "#0A4F48"} /> Ask
        </button>
        {needCover > 0 && (
          <button
            type="button"
            onClick={onRequestCover}
            style={{ flex: 1, minHeight: 44, padding: "0 14px", borderRadius: 4, border: `1px solid ${t.sep}`, background: t.bgElev, color: t.clayText, fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "-0.01em" }}
          >
            Request cover
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: t.text2, lineHeight: 1.5 }}>
        {look.hasPartner
          ? <>A gap is time when neither {selfName} nor {partnerName} is home.</>
          : <>A gap is time when {selfName} isn&rsquo;t home.</>}
      </div>
    </div>
  );
}

function subhead(t: ThemeTokens): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 600,
    color: t.text3,
    letterSpacing: "0.1em",
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
        borderRadius: 4,
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
          // Squarer than the old pill, and it lifts and glows on hover — this
          // is the one action on the card, so it should feel like a button
          // rather than a tag.
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.04)";
            e.currentTarget.style.boxShadow = `0 4px 18px ${rgba(color, 0.55)}`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.boxShadow = `0 1px 3px ${rgba(color, 0.3)}`;
          }}
          style={{
            alignSelf: "flex-start",
            padding: "10px 16px",
            border: 0,
            borderRadius: 4,
            background: color,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: BRAND_FONT,
            letterSpacing: "-0.01em",
            boxShadow: `0 1px 3px ${rgba(color, 0.3)}`,
            transition: "transform 0.14s ease, box-shadow 0.14s ease",
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
/** An ISO date moved by whole days (local time, so DST can't skip a day). */
function shiftIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** "Today", "Tomorrow" or "Yesterday" for those dates, otherwise null. */
function relativeDay(iso: string, today: string): string | null {
  if (iso === today) return "Today";
  if (iso === shiftIso(today, 1)) return "Tomorrow";
  if (iso === shiftIso(today, -1)) return "Yesterday";
  return null;
}

/** "Nov 20", for a slide button that has no better name for its day. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS_LONG[m - 1].slice(0, 3)} ${d}`;
}

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

