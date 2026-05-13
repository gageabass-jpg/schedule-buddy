import { buildMonthGrid, fmtDate, dayKindFromShifts, WEEKDAYS_3, type ShiftMap } from "../data";
import type { CalLayout, EventMap, ViewFilter } from "../App";
import type { CaregiverRequest, Event as SbEvent, HouseholdState } from "../state";
import { isPaydayOn } from "../state";
import { InboxTray } from "./InboxTray";
import { dayColors, eventColor, personColor, rgba, MANAGER_ORANGE, type Palette, type ThemeTokens } from "../theme";
import { YearView } from "./YearView";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { eventInitial } from "./EventAvatar";

interface Props {
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  flat: boolean;
  shifts: ShiftMap;
  state: HouseholdState | null;
  viewYear: number;
  viewMonth: number;
  selected: string;
  today: string;
  onSelectDate: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNewShift: () => void;
  onOpenInbox: (focusId?: string) => void;
  inboxRequests: CaregiverRequest[];
  viewFilter: ViewFilter;
  calLayout: CalLayout;
  onSetCalLayout: (layout: CalLayout) => void;
  selfName: string;
  partnerName: string;
  eventsByDate: EventMap;
  onEditEvent: (ev: SbEvent) => void;
}

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function MonthGrid({
  palette, t, dark, flat, shifts, state, viewYear, viewMonth, selected, today,
  onSelectDate, onPrev, onNext, onToday, onNewShift,
  viewFilter, calLayout, onSetCalLayout, selfName, partnerName,
  eventsByDate, onEditEvent, onOpenInbox, inboxRequests,
}: Props) {
  const weeks = buildMonthGrid(viewYear, viewMonth);

  // Sun..Sat range that contains "today", as ISO strings for cheap comparison.
  const [ty, tm, td] = today.split("-").map(Number);
  const todayDate = new Date(ty, tm - 1, td);
  const weekStartDate = new Date(todayDate);
  weekStartDate.setDate(todayDate.getDate() - todayDate.getDay());
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekStartDate.getDate() + 6);
  const weekStartKey = fmtDate(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate());
  const weekEndKey = fmtDate(weekEndDate.getFullYear(), weekEndDate.getMonth(), weekEndDate.getDate());

  return (
    <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 18px",
          borderBottom: `0.5px solid ${t.sep}`,
          background: t.bg,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <ToolbarTitle
            calLayout={calLayout}
            viewYear={viewYear}
            viewMonth={viewMonth}
            selected={selected}
            t={t}
          />
        </div>
        <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
          <button style={navBtn(t)} type="button" onClick={onPrev}>‹</button>
          <button
            style={{ ...navBtn(t), padding: "0 10px", width: "auto", fontSize: 12, fontWeight: 600 }}
            type="button"
            onClick={onToday}
          >Today</button>
          <button style={navBtn(t)} type="button" onClick={onNext}>›</button>
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            padding: 2,
            borderRadius: 6,
            background: dark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.06)",
          }}
        >
          {(["day", "week", "month", "year"] as const).map((v) => {
            const active = calLayout === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onSetCalLayout(v)}
                style={{
                  padding: "3px 10px",
                  border: 0,
                  borderRadius: 4,
                  background: active ? (dark ? "#3A3A3C" : "#fff") : "transparent",
                  color: t.text,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
                  fontFamily: "inherit",
                  textTransform: "capitalize",
                }}
              >
                {v}
              </button>
            );
          })}
        </div>
        <InboxTray
          palette={palette}
          t={t}
          dark={dark}
          requests={inboxRequests}
          onOpenFullInbox={(focusId) => onOpenInbox(focusId)}
        />
        <button
          type="button"
          onClick={onNewShift}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            height: 26,
            padding: "0 12px",
            borderRadius: 6,
            border: 0,
            background: palette.G,
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
            lineHeight: 1,
          }}
        >
          + New shift
        </button>
      </div>

      {calLayout === "year" && (
        <YearView
          palette={palette}
          t={t}
          dark={dark}
          shifts={shifts}
          viewYear={viewYear}
          selected={selected}
          onSelectDate={onSelectDate}
          onDrillIntoMonth={(mo) => {
            onSetCalLayout("month");
            // viewMonth is owned by App.tsx — selecting a date drills there.
            onSelectDate(fmtDate(viewYear, mo, 1));
          }}
        />
      )}

      {calLayout === "week" && (
        <WeekView
          palette={palette}
          t={t}
          dark={dark}
          shifts={shifts}
          state={state}
          selected={selected}
          today={today}
          onSelectDate={onSelectDate}
          eventsByDate={eventsByDate}
          onEditEvent={onEditEvent}
        />
      )}

      {calLayout === "day" && (
        <DayView
          palette={palette}
          t={t}
          dark={dark}
          shifts={shifts}
          state={state}
          selected={selected}
          today={today}
          selfName={selfName}
          partnerName={partnerName}
          events={eventsByDate[selected] ?? []}
          onEditEvent={onEditEvent}
        />
      )}

      {calLayout === "month" && (
      /* Month grid */
      <div style={{ flex: 1, padding: 14, display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {WEEKDAYS_3.map((w, i) => (
            <div
              key={w}
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: i === 0 || i === 6 ? rgba(palette.G, 0.85) : t.text3,
                padding: "4px 6px",
              }}
            >
              {w}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateRows: `repeat(${weeks.length}, 1fr)`, gap: 4, minHeight: 0 }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
              {week.map((c, ci) => {
                const key = fmtDate(c.y, c.mo, c.d);
                const dayShifts = shifts[key];
                const kind = dayKindFromShifts(dayShifts);
                const colors = dayColors(kind, palette, dark);
                const isToday = key === today;
                const isSel = key === selected;
                const matchesFilter =
                  viewFilter === "all" ||
                  (viewFilter === "both" && kind === "both") ||
                  (viewFilter === "couple" && kind === "off") ||
                  (viewFilter === "this-week" && key >= weekStartKey && key <= weekEndKey) ||
                  (viewFilter === "g" && (kind === "g" || kind === "both")) ||
                  (viewFilter === "k" && (kind === "k" || kind === "both"));
                const cellOpacity = c.other ? 0.4 : matchesFilter ? 1 : 0.3;
                return (
                  <button
                    key={ci}
                    type="button"
                    onClick={() => onSelectDate(key)}
                    style={{
                      border: 0,
                      padding: 6,
                      cursor: "pointer",
                      textAlign: "left",
                      background: kind === "off" ? t.bgElev : colors.tint,
                      borderRadius: 8,
                      opacity: cellOpacity,
                      transition: "opacity 0.15s",
                      boxShadow: isSel
                        ? `inset 0 0 0 2px ${colors.accent}`
                        : isToday
                          ? `inset 0 0 0 1.5px ${MANAGER_ORANGE}`
                          : "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                      overflow: "hidden",
                      minHeight: 0,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: isToday ? 700 : 600,
                          color: isToday ? "#fff" : t.text,
                          background: isToday ? MANAGER_ORANGE : "transparent",
                          borderRadius: 999,
                          padding: isToday ? "1px 6px" : "1px 0",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {c.d}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        {state?.paydays?.G && isPaydayOn(key, state.paydays.G) && (
                          <span
                            title="Gage payday"
                            style={{
                              fontSize: 10, fontWeight: 700, color: "#fff",
                              background: palette.G,
                              padding: "1px 5px", borderRadius: 999, lineHeight: 1,
                            }}
                          >$</span>
                        )}
                        {state?.paydays?.K && isPaydayOn(key, state.paydays.K) && (
                          <span
                            title="Kaylene payday"
                            style={{
                              fontSize: 10, fontWeight: 700, color: "#fff",
                              background: palette.K,
                              padding: "1px 5px", borderRadius: 999, lineHeight: 1,
                            }}
                          >$</span>
                        )}
                        {(() => {
                          const dayEvents = eventsByDate[key] ?? [];
                          const totalItems = (dayShifts?.length ?? 0) + dayEvents.length;
                          return totalItems > 1 ? (
                            <span style={{ fontSize: 9, color: t.text3, fontWeight: 600 }}>{totalItems}</span>
                          ) : null;
                        })()}
                      </div>
                    </div>
                    {(() => {
                      const dayEvents = eventsByDate[key] ?? [];
                      const shiftSlice = (dayShifts ?? []).slice(0, 3);
                      const eventSlice = dayEvents.slice(0, Math.max(0, 3 - shiftSlice.length));
                      if (shiftSlice.length === 0 && eventSlice.length === 0) return null;
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {shiftSlice.map((s, i) => {
                            const color = personColor(s.who, palette);
                            return (
                              <div
                                key={`s${i}`}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  fontSize: 10.5,
                                  fontWeight: 600,
                                  letterSpacing: "-0.01em",
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                  background: flat ? color : rgba(color, 0.28),
                                  color: flat ? "#fff" : t.text,
                                  borderLeft: flat ? "none" : `2px solid ${color}`,
                                }}
                              >
                                <span style={{ opacity: 0.85 }}>{s.who}</span>
                                <span>{s.label}</span>
                              </div>
                            );
                          })}
                          {eventSlice.map((ev) => {
                            const color = eventColor(ev.who, palette);
                            return (
                              <div
                                key={ev.id}
                                onClick={(e) => { e.stopPropagation(); onEditEvent(ev); }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  fontSize: 10.5,
                                  fontWeight: 500,
                                  letterSpacing: "-0.01em",
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                  background: "transparent",
                                  color: t.text,
                                  border: `1px dashed ${rgba(color, 0.7)}`,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  cursor: "pointer",
                                }}
                                title={ev.title}
                              >
                                <span style={{ fontSize: 9.5, fontWeight: 700, color: eventColor(ev.who, palette), opacity: 0.95 }}>
                                  {eventInitial(ev.who)}
                                </span>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {ev.startTime ? `${formatChipTime(ev.startTime)} ` : ""}{ev.title}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}

function ToolbarTitle({
  calLayout, viewYear, viewMonth, selected, t,
}: {
  calLayout: CalLayout;
  viewYear: number;
  viewMonth: number;
  selected: string;
  t: ThemeTokens;
}) {
  const big = (s: string) => (
    <span style={{ fontSize: 22, fontWeight: 700, color: t.text, letterSpacing: "-0.02em" }}>{s}</span>
  );
  const light = (s: string) => (
    <span style={{ fontSize: 22, fontWeight: 400, color: t.text2, letterSpacing: "-0.02em" }}>{s}</span>
  );

  if (calLayout === "year") {
    return big(String(viewYear));
  }
  if (calLayout === "month") {
    return (
      <>
        {big(MONTH_LABELS[viewMonth])}
        {light(String(viewYear))}
      </>
    );
  }
  // week + day operate on `selected`
  const [y, m, d] = selected.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (calLayout === "week") {
    const ws = new Date(date);
    ws.setDate(date.getDate() - date.getDay());
    const we = new Date(ws);
    we.setDate(ws.getDate() + 6);
    const sameMonth = ws.getMonth() === we.getMonth();
    const range = sameMonth
      ? `${MONTH_LABELS[ws.getMonth()]} ${ws.getDate()} – ${we.getDate()}`
      : `${MONTH_LABELS[ws.getMonth()].slice(0, 3)} ${ws.getDate()} – ${MONTH_LABELS[we.getMonth()].slice(0, 3)} ${we.getDate()}`;
    return (
      <>
        {big(range)}
        {light(String(we.getFullYear()))}
      </>
    );
  }
  // day
  const dayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  return (
    <>
      {big(`${dayShort}, ${MONTH_LABELS[date.getMonth()]} ${date.getDate()}`)}
      {light(String(date.getFullYear()))}
    </>
  );
}

/** Compact "07:00" → "7a", "13:30" → "1:30p" for tight cell chips. */
function formatChipTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr) || 0;
  const m = Number(mStr) || 0;
  const mSuffix = m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
  if (h === 0) return `12${mSuffix}a`;
  if (h === 12) return `12${mSuffix}p`;
  if (h < 12) return `${h}${mSuffix}a`;
  return `${h - 12}${mSuffix}p`;
}

function navBtn(t: ThemeTokens): React.CSSProperties {
  return {
    width: 26,
    height: 26,
    borderRadius: 5,
    border: 0,
    background: "transparent",
    color: t.text2,
    fontSize: 14,
    cursor: "pointer",
  };
}

