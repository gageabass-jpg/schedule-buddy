import { useState } from "react";
import { buildMonthGrid, fmtDate, dayKindFromShifts, WEEKDAYS_3, type Shift, type ShiftMap } from "../data";
import type { CalLayout, EventMap, ViewFilter } from "../App";
import type { Event as SbEvent, HouseholdState } from "../state";
import { isPaydayOn } from "../state";
import { dayColors, eventColor, personColor, rgba, MANAGER_ORANGE, BRAND_FONT, type Palette, type ThemeTokens } from "../theme";
import { BrandMark } from "./BrandMark";
import { YearView } from "./YearView";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { AgendaView } from "./AgendaView";
import { eventInitial } from "./EventAvatar";
import { wvuGameLabel, type WvuGame } from "../lib/wvuSchedule";

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
  onOpenAskClaude: () => void;
  onOpenChatManager: () => void;
  viewFilter: ViewFilter;
  coverageDates?: Set<string>;
  onOpenShiftDetail?: (date: string, shift: Shift, anchor?: DOMRect) => void;
  /** A click on the day cell itself opens the day-detail popover. */
  onOpenDayDetail?: (date: string, anchor?: DOMRect) => void;
  calLayout: CalLayout;
  onSetCalLayout: (layout: CalLayout) => void;
  selfName: string;
  partnerName: string;
  eventsByDate: EventMap;
  onEditEvent: (ev: SbEvent) => void;
  wvuGames: Map<string, WvuGame>;
}

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Week-row geometry for the spanning "no childcare" bar: 7 columns with six
// 4px gaps (24px total). CARE_COL = one column's width, CARE_STEP = the
// column-to-column stride (column + gap).
const CARE_COL = "((100% - 24px) / 7)";
const CARE_STEP = `(${CARE_COL} + 4px)`;

export function MonthGrid({
  palette, t, dark, flat, shifts, state, viewYear, viewMonth, selected, today,
  onSelectDate, onPrev, onNext, onToday, onNewShift, onOpenAskClaude,
  onOpenChatManager,
  viewFilter, coverageDates, onOpenShiftDetail, onOpenDayDetail, calLayout, onSetCalLayout, selfName, partnerName,
  eventsByDate, onEditEvent, wvuGames,
}: Props) {
  const [hoverTab, setHoverTab] = useState<string | null>(null);
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

  // Dates with an accepted coverage request — drives the green "confirmed
  // childcare" bar along the bottom edge of the cell.
  const confirmedCareDates = new Set(
    (state?.coverageRequests ?? [])
      .filter((r) => r.status === "confirmed")
      .map((r) => r.date),
  );

  // Dates explicitly marked "no childcare" (caregiver off), date → label.
  // Drives the spanning red pill + bar; takes precedence over the green bar.
  const noCareByDate = new Map<string, string>(
    (state?.childcareOff ?? []).map((c) => [c.date, c.label || "No childcare"]),
  );

  // Date → block label, for every date covered by any active schedule
  // block. Drives the red diagonal-stripe overlay on cells.
  const blockByDate = new Map<string, string>();
  for (const b of state?.scheduleBlocks ?? []) {
    // Walk every day in [startDate, endDate] inclusive and mark it.
    let cursor = b.startDate;
    let safety = 0;                            // guard against bad ranges
    while (cursor <= b.endDate && safety < 400) {
      blockByDate.set(cursor, b.label || "Schedule block");
      const [y, m, d] = cursor.split("-").map(Number);
      const nx = new Date(y!, m! - 1, d! + 1);
      cursor = `${nx.getFullYear()}-${String(nx.getMonth() + 1).padStart(2, "0")}-${String(nx.getDate()).padStart(2, "0")}`;
      safety++;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          // Top inset matches the sidebar's wordmark line (which is pushed
          // down by the traffic-light drag strip), so both headers align.
          padding: "44px 18px 16px",
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
        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          {(["day", "week", "month", "year", "agenda"] as const).map((v) => {
            const active = calLayout === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onSetCalLayout(v)}
                onMouseEnter={() => setHoverTab(v)}
                onMouseLeave={() => setHoverTab((h) => (h === v ? null : h))}
                style={{
                  padding: "6px 9px",
                  border: 0,
                  borderRadius: 0,
                  borderBottom: active ? `2px solid ${palette.G}` : "2px solid transparent",
                  background: "transparent",
                  color: active ? t.text : t.text2,
                  fontSize: active ? 15 : 13,
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textTransform: "capitalize",
                  letterSpacing: "-0.01em",
                  transformOrigin: "bottom center",
                  transform: `${active ? "translateY(-2px)" : ""}${hoverTab === v ? " scale(1.08)" : ""}`.trim() || "none",
                  transition: "transform 0.12s ease, font-size 0.12s ease, color 0.12s ease",
                }}
              >
                {v}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onOpenAskClaude}
          title="Ask nucleusAI — natural-language schedule editing"
          aria-label="Ask nucleusAI"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 34,
            padding: "0 12px",
            borderRadius: 4,
            border: `1px solid ${palette.G}`,
            background: "#D8E7E4",
            color: palette.G,
            fontFamily: BRAND_FONT,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <BrandMark size={15} color={palette.G} />
          Ask
        </button>
        {/* Chat Manager — compose an In-Basket message as "Manager".
            Deliberately the same dimensions as the inbox button beside it. */}
        <button
          type="button"
          onClick={onOpenChatManager}
          title="Chat Manager"
          aria-label="Chat Manager"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 26,
            padding: 0,
            borderRadius: 6,
            border: `0.5px solid ${t.sep}`,
            background: "transparent",
            cursor: "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          <img
            src="assets/chat-bubble.png"
            alt=""
            aria-hidden="true"
            width={15}
            height={15}
            draggable={false}
            style={{ display: "block", userSelect: "none", pointerEvents: "none" }}
          />
        </button>
        <button
          type="button"
          onClick={onNewShift}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            height: 32,
            padding: "0 14px",
            borderRadius: 8,
            border: 0,
            background: palette.G,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
            lineHeight: 1,
          }}
        >
          New shift
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
          wvuGames={wvuGames}
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
          wvuGames={wvuGames}
        />
      )}

      {calLayout === "agenda" && (
        <AgendaView
          palette={palette}
          t={t}
          dark={dark}
          shifts={shifts}
          state={state}
          today={today}
          selfName={selfName}
          partnerName={partnerName}
          eventsByDate={eventsByDate}
          onSelectDate={onSelectDate}
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
        <div style={{ flex: 1, display: "grid", gridTemplateRows: `repeat(${weeks.length}, 1fr)`, gap: 1, minHeight: 0, background: t.sep, border: `1px solid ${t.sep}`, borderRadius: 10, overflow: "hidden" }}>
          {weeks.map((week, wi) => {
            // Group adjacent no-childcare days in this row into contiguous runs,
            // each drawn as a single red bar spanning those columns.
            const careRuns: Array<{ start: number; len: number; label: string }> = [];
            week.forEach((c, ci) => {
              const label = noCareByDate.get(fmtDate(c.y, c.mo, c.d));
              if (label === undefined) return;
              const last = careRuns[careRuns.length - 1];
              if (last && last.start + last.len === ci) last.len++;
              else careRuns.push({ start: ci, len: 1, label });
            });
            return (
            <div key={wi} style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: t.sep }}>
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
                  (viewFilter === "k" && (kind === "k" || kind === "both")) ||
                  (viewFilter === "coverage" && !!coverageDates?.has(key));
                const cellOpacity = c.other ? 0.4 : matchesFilter ? 1 : 0.3;
                return (
                  <button
                    key={ci}
                    type="button"
                    // A cell click opens the day popover only — it deliberately
                    // does NOT re-point the right panel, so the day card there
                    // stays put while you browse the month.
                    onClick={(e) => onOpenDayDetail?.(key, e.currentTarget.getBoundingClientRect())}
                    style={{
                      position: "relative",
                      border: 0,
                      padding: 6,
                      cursor: "pointer",
                      textAlign: "left",
                      background: t.bgElev,
                      borderRadius: isToday || isSel ? 6 : 0,
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
                    {confirmedCareDates.has(key) && !noCareByDate.has(key) && (
                      <div
                        title="Childcare coverage confirmed"
                        style={{
                          position: "absolute",
                          left: 5,
                          right: 5,
                          bottom: 3,
                          height: 3,
                          borderRadius: 2,
                          background: "#0F6E64",
                          boxShadow: "0 0 4px rgba(15,110,100,0.5)",
                          pointerEvents: "none",
                        }}
                      />
                    )}
                    {blockByDate.has(key) && (
                      <div
                        title={`${blockByDate.get(key)} — ${confirmedCareDates.has(key) ? "covered" : "nobody yet"}`}
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 4,
                          bottom: 4,
                          width: 3,
                          borderRadius: 3,
                          // Clay left edge, replacing the red diagonal hatch. The
                          // hatch carried meaning by hue alone (worst case for
                          // red/green colour-blindness) and fought the shift chips.
                          // Solid = the block is covered, dashed = nobody has it yet.
                          background: confirmedCareDates.has(key)
                            ? "#C56B52"
                            : "repeating-linear-gradient(#C56B52 0, #C56B52 4px, transparent 4px, transparent 8px)",
                          pointerEvents: "none",
                        }}
                      />
                    )}
                    {wvuGames.has(key) && (
                      <img
                        src="assets/wvu.png"
                        alt=""
                        aria-hidden="true"
                        title={wvuGameLabel(wvuGames.get(key)!)}
                        draggable={false}
                        style={{
                          position: "absolute",
                          right: 4,
                          bottom: 4,
                          width: 24,
                          height: 22,
                          objectFit: "contain",
                          pointerEvents: "none",
                          filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.45))",
                        }}
                      />
                    )}
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
                            // White chip with the person's hue as a left-edge bar
                            // and Ink text (design boards).
                            return (
                              <div
                                key={`s${i}`}
                                onClick={onOpenShiftDetail ? (e) => { e.stopPropagation(); onOpenShiftDetail(key, s, e.currentTarget.getBoundingClientRect()); } : undefined}
                                title={onOpenShiftDetail ? "Shift details" : undefined}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  letterSpacing: "-0.01em",
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: t.bgElev,
                                  color: t.text,
                                  border: `1px solid ${t.sep}`,
                                  borderLeft: `3px solid ${color}`,
                                  overflow: "hidden",
                                  whiteSpace: "nowrap",
                                  textOverflow: "ellipsis",
                                  cursor: onOpenShiftDetail ? "pointer" : "default",
                                }}
                              >
                                <span>{s.label}</span>
                              </div>
                            );
                          })}
                          {/* Life items — leaf glyph + the event's time. No pill:
                              these read as a quiet marker next to the work shifts. */}
                          {eventSlice.map((ev) => (
                            <div
                              key={ev.id}
                              onClick={(e) => { e.stopPropagation(); onEditEvent(ev); }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 10.5,
                                fontWeight: 600,
                                letterSpacing: "-0.01em",
                                padding: "1px 3px",
                                color: ev.pending ? "#8A4B38" : t.text2,
                                overflow: "hidden",
                                whiteSpace: "nowrap",
                                cursor: "pointer",
                              }}
                              title={`${ev.startTime ? `${formatChipTime(ev.startTime)} · ` : ""}${ev.title}${ev.pending ? " (pending)" : ""}`}
                            >
                              {ev.pending ? (
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#8A4B38", flexShrink: 0, boxShadow: "0 0 4px rgba(138,75,56,0.6)" }} />
                              ) : (
                                <img
                                  src="assets/green-leaf.png"
                                  alt=""
                                  aria-hidden="true"
                                  width={11}
                                  height={11}
                                  style={{ display: "block", flexShrink: 0 }}
                                />
                              )}
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {ev.startTime ? formatChipTime(ev.startTime) : ev.title}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </button>
                );
              })}
              {careRuns.flatMap((run, ri) => {
                const left = `calc(${run.start} * ${CARE_STEP} + 5px)`;
                const width = `calc(${run.len - 1} * ${CARE_STEP} + ${CARE_COL} - 10px)`;
                return [
                  // Event-style dashed pill spanning the blocked run, floating
                  // over the lower part of the cells (not the very bottom).
                  <div
                    key={`care-pill-${ri}`}
                    title={run.label}
                    style={{
                      position: "absolute",
                      bottom: 10,
                      left,
                      width,
                      height: 16,
                      boxSizing: "border-box",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 6px",
                      borderRadius: 5,
                      border: `1px dashed ${rgba("#8A4B38", 0.8)}`,
                      background: dark ? "rgba(138,75,56,0.18)" : "rgba(138,75,56,0.10)",
                      color: "#8A4B38",
                      fontSize: 10.5,
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      pointerEvents: "none",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {run.label}
                    </span>
                  </div>,
                  // Thin bar pinned at the very bottom edge.
                  <div
                    key={`care-bar-${ri}`}
                    style={{
                      position: "absolute",
                      bottom: 3,
                      left,
                      width,
                      height: 3,
                      borderRadius: 2,
                      background: "#8A4B38",
                      boxShadow: "0 0 4px rgba(138,75,56,0.5)",
                      pointerEvents: "none",
                    }}
                  />,
                ];
              })}
            </div>
            );
          })}
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
    <span style={{ fontSize: 22, fontWeight: 700, color: t.text, letterSpacing: "-0.02em", fontFamily: BRAND_FONT }}>{s}</span>
  );
  const light = (s: string) => (
    <span style={{ fontSize: 22, fontWeight: 400, color: t.text2, letterSpacing: "-0.02em", fontFamily: BRAND_FONT }}>{s}</span>
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

