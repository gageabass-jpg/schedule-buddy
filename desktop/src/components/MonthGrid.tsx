import { useEffect, useRef, useState } from "react";
import { buildMonthGrid, fmtDate, dayKindFromShifts, WEEKDAYS_3, type Shift, type ShiftMap } from "../data";
import type { CalLayout, EventMap, ViewFilter } from "../App";
import type { Event as SbEvent, HouseholdState } from "../state";
import { compactTime, isPaydayOn } from "../state";
import { dayColors, personColor, rgba, MANAGER_ORANGE, BRAND_FONT, type Palette, type ThemeTokens } from "../theme";
import { BrandMark } from "./BrandMark";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Flag3FilledIcon } from "@/components/ui/flag-3-filled";
import { FLAG_RED } from "./DayFlagPopover";
import type { DayFlag } from "../lib/dayFlags";
import { ShinyButton } from "@/components/ui/shiny-button";
import { CircleCheckIcon, type CircleCheckIconHandle } from "@/components/ui/circle-check";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { YearView } from "./YearView";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { AgendaView } from "./AgendaView";
import { wvuGameLabel, type WvuGame } from "../lib/wvuSchedule";

/** The arrow the New shift button slides in on hover. */
const NewShiftArrow = () => <ArrowRight className="size-3.5" />;

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
  viewFilter: ViewFilter;
  coverageDates?: Set<string>;
  /** Where each coverage day stands, drawn as a chip in the Coverage view. */
  coverageMarks?: Map<string, CoverageMark>;
  onOpenShiftDetail?: (date: string, shift: Shift, anchor?: DOMRect) => void;
  /** A click on the day cell itself opens the day-detail popover. */
  onOpenDayDetail?: (date: string, anchor?: DOMRect) => void;
  calLayout: CalLayout;
  onSetCalLayout: (layout: CalLayout) => void;
  selfName: string;
  partnerName: string;
  eventsByDate: EventMap;
  onEditEvent: (ev: SbEvent) => void;
  /** Rendered at the far right of the toolbar, after New shift (the bell). */
  toolbarEnd?: React.ReactNode;
  /** Flagged days, keyed by date. */
  dayFlags?: Map<string, DayFlag>;
  /** Open the flag editor for a day, beside its cell. */
  onFlagDay?: (date: string, anchor: DOMRect) => void;
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
  palette, t, dark, flat: _flat, shifts, state, viewYear, viewMonth, selected, today,
  onSelectDate, onPrev, onNext, onToday, onNewShift, onOpenAskClaude,
  viewFilter, coverageDates, coverageMarks, onOpenShiftDetail, onOpenDayDetail, calLayout, onSetCalLayout, selfName, partnerName,
  eventsByDate, onEditEvent, wvuGames, dayFlags, onFlagDay, toolbarEnd,
}: Props) {
  // Two-finger swipe (horizontal trackpad scroll) moves a month, anywhere in
  // the window while the month view shows: over a chip, the rail, the toolbar,
  // or the dimmed area around nucleusAI. A gesture that starts in a text field,
  // over something that really scrolls sideways, or inside a dialog (nucleusAI,
  // a popover card) is left to that thing.
  //
  // One swipe is one month. deltaX adds up past a threshold, then the swipe
  // locks so its momentum tail can't skip months. macOS keeps momentum events
  // flowing for up to a second after the fingers lift, so waiting for quiet
  // would swallow a second swipe made in that time. Instead a lock ends when
  // the scroll speeds up again for two events running (momentum only ever
  // slows, so a sustained rise is fingers on the pad; one doubled event from a
  // busy frame isn't) or turns round, and the next swipe counts straight away.
  const nav = useRef({ onNext, onPrev });
  nav.current = { onNext, onPrev };
  useEffect(() => {
    if (calLayout !== "month") return;
    const g = {
      acc: 0, locked: false, dir: 0, lastAbs: 0, rises: 0, triggeredAt: 0,
      ignore: false, active: false, timer: undefined as number | undefined,
    };
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (!g.active) { g.active = true; g.ignore = swipeBelongsElsewhere(e.target); }
      window.clearTimeout(g.timer);
      g.timer = window.setTimeout(() => {
        g.acc = 0; g.locked = false; g.active = false; g.lastAbs = 0; g.rises = 0;
      }, 180);
      if (g.ignore) return;

      const abs = Math.abs(e.deltaX);
      const now = performance.now();
      if (g.locked) {
        const turned = Math.sign(e.deltaX) !== g.dir;
        g.rises = abs > 3 && abs > g.lastAbs * 1.2 ? g.rises + 1 : 0;
        const speedingUp = g.rises >= 2 && now - g.triggeredAt > 120;
        if (turned || speedingUp) { g.locked = false; g.acc = 0; g.rises = 0; }
      }
      g.lastAbs = abs;
      if (g.locked) return;

      g.acc += e.deltaX;
      if (Math.abs(g.acc) > 50) {
        g.locked = true;
        g.dir = Math.sign(g.acc);
        g.triggeredAt = now;
        g.acc = 0;
        if (g.dir > 0) nav.current.onNext(); else nav.current.onPrev();
      }
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.clearTimeout(g.timer);
    };
  }, [calLayout]);

  // Which way the month just moved, so the new grid slides in from that side
  // (swipe or arrows alike). Derived during render; it sticks until the next
  // change so an unrelated re-render can't cut the slide short.
  const monthIndex = viewYear * 12 + viewMonth;
  const [lastMonthIndex, setLastMonthIndex] = useState(monthIndex);
  const [slide, setSlide] = useState<"next" | "prev" | null>(null);
  if (monthIndex !== lastMonthIndex) {
    setLastMonthIndex(monthIndex);
    setSlide(monthIndex > lastMonthIndex ? "next" : "prev");
  }

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
          padding: "16px 18px",
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
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Shiny border that follows the pointer, around the app icon's teal. */}
            {/* 36px outside so the teal face inside the 2px shine is 32px,
                the same as New shift beside it. */}
            <ShinyButton
              type="button"
              size="sm"
              style={{ height: 36, paddingInline: 14 }}
              aria-label="Ask nucleusAI"
              onClick={onOpenAskClaude}
              // On dark, a white shine reads as a frame; Teal Light glows instead.
              gradientFrom={dark ? "#9ACFC6" : "#FFFFFF"}
              gradientTo={dark ? "#56B7A9" : "#9ACFC6"}
              gradientOpacity={dark ? 0.7 : 1}
              borderWidth={2}
              className="bg-linear-to-b from-[#0F6E64] to-[#0A4F48]"
              overlayClassName="bg-white/10"
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#fff", fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>
                <BrandMark size={15} color="#F7F6F3" />
                Ask
              </span>
            </ShinyButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Ask nucleusAI <span className="text-muted-foreground">· ⌘K</span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* 21st.dev enhanced button. The palette's colour rides in as
                --primary so bg-primary and its hover shade follow it. */}
            <Button
              type="button"
              onClick={onNewShift}
              variant="expandIcon"
              Icon={NewShiftArrow}
              iconPlacement="right"
              className="h-8 rounded-md px-3.5 text-[13px] font-semibold leading-none cursor-pointer"
              style={{ "--primary": palette.G } as React.CSSProperties}
            >
              New shift
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            New shift <span className="text-muted-foreground">· ⌘N</span>
          </TooltipContent>
        </Tooltip>
        {toolbarEnd}
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
      <div style={{ flex: 1, padding: 14, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* The calendar is one self-contained card: weekday header, grid, and
            legend share a single border, hairlines drawn by 1px cell gaps. */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", border: `1px solid ${t.sep}`, borderRadius: 10, overflow: "hidden", background: t.bgElev }}>
        <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${t.sep}` }}>
          {WEEKDAYS_3.map((w, i) => (
            <div
              key={w}
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: i === 0 || i === 6 ? (dark ? t.tealText : rgba(palette.G, 0.85)) : t.text3,
                padding: "6px 8px",
              }}
            >
              {w}
            </div>
          ))}
        </div>
        <div
          key={monthIndex}
          data-motion=""
          style={{
            flex: 1, display: "grid", gridTemplateRows: `repeat(${weeks.length}, 1fr)`, gap: 1, minHeight: 0, background: t.sep,
            animation: slide ? `nucleus-month-in-${slide} 240ms cubic-bezier(.2,.8,.2,1) both` : undefined,
          }}
        >
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
                    data-day-cell=""
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
                      <CareCheck right={wvuGames.has(key) ? 32 : 5} />
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
                    <div style={{ display: "flex", alignItems: "center" }}>
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
                      {onFlagDay && (() => {
                        const flag = dayFlags?.get(key);
                        // A flag on the day: red, always shown, remarks on hover.
                        // No flag: a faint one appears while the day is hovered.
                        // It's a span, not a button, because the cell is already a
                        // button; the day popover's Flag row is the keyboard route.
                        const mark = (
                          <span
                            aria-hidden="true"
                            onClick={(e) => {
                              e.stopPropagation();
                              const cell = (e.currentTarget as HTMLElement).closest("[data-day-cell]");
                              onFlagDay(key, (cell ?? e.currentTarget).getBoundingClientRect());
                            }}
                            className={flag ? "flex cursor-pointer" : "flex cursor-pointer opacity-0 transition-opacity duration-150 day-hover:opacity-60 hover:!opacity-100"}
                            style={{ marginLeft: 4, color: flag ? FLAG_RED : t.text3, padding: 2 }}
                          >
                            <Flag3FilledIcon size={13} />
                          </span>
                        );
                        return flag?.remarks ? (
                          <Tooltip>
                            <TooltipTrigger asChild>{mark}</TooltipTrigger>
                            <TooltipContent side="top" size="sm" className="max-w-64 whitespace-pre-wrap">{flag.remarks}</TooltipContent>
                          </Tooltip>
                        ) : mark;
                      })()}
                      <div style={{ display: "flex", alignItems: "center", gap: 3, marginLeft: "auto" }}>
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
                      // In the Coverage view a coverage day leads with where its
                      // cover stands, and gives up one of the three rows for it.
                      const cover = viewFilter === "coverage" ? coverageMarks?.get(key) : undefined;
                      const shiftSlice = (dayShifts ?? []).slice(0, cover ? 2 : 3);
                      const eventSlice = dayEvents.slice(0, Math.max(0, (cover ? 2 : 3) - shiftSlice.length));
                      if (!cover && shiftSlice.length === 0 && eventSlice.length === 0) return null;
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {cover && <CoverageChip mark={cover} t={t} dark={dark} daisyName={state?.dependents?.daisy?.name || "Daisy"} />}
                          {shiftSlice.map((s, i) => {
                            const color = personColor(s.who, palette);
                            const name = s.who === "G" ? selfName : s.who === "K" ? partnerName : (state?.dependents?.daisy?.name || "Daisy");
                            const st = state?.shiftTypes?.find((x) => x.id === s.shiftTypeId);
                            const hours = st ? `${compactTime(st.start)}–${compactTime(st.end)}` : s.label;
                            // White chip with the person's hue as a left-edge bar
                            // and Ink text (design boards). Hovering the day sweeps
                            // the chip in that hue and swaps the label for who's on.
                            return (
                              <div
                                key={`s${i}`}
                                className="relative"
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
                                <span
                                  aria-hidden="true"
                                  className="pointer-events-none absolute bottom-0 left-0 size-80 -translate-x-full translate-y-full rotate-[-40deg] rounded mb-6 ml-6 transition-all duration-500 ease-out day-hover:mb-[7.5rem] day-hover:ml-0 day-hover:translate-x-0 motion-reduce:transition-none"
                                  style={{ background: color }}
                                />
                                <span className="relative min-w-0 flex-1 transition-colors duration-300 ease-in-out day-hover:text-white">
                                  <span className="block overflow-hidden text-ellipsis transition-opacity duration-200 day-hover:opacity-0">{s.label}</span>
                                  {/* Hovered: who's on at the left, their hours popping in at
                                      the right just after the sweep lands. */}
                                  <span className="absolute inset-0 flex items-center gap-1.5">
                                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis opacity-0 transition-opacity delay-150 duration-200 day-hover:opacity-100">{name}</span>
                                    <span className="shrink-0 font-medium opacity-0 translate-x-2 scale-90 transition-all delay-200 duration-300 ease-[cubic-bezier(.2,1.4,.4,1)] day-hover:translate-x-0 day-hover:scale-100 day-hover:opacity-90 motion-reduce:transition-none">{hours}</span>
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                          {/* Life items — leaf glyph + the event's time. No pill:
                              these read as a quiet marker next to the work shifts. */}
                          {eventSlice.map((ev) => (
                            <Tooltip key={ev.id}>
                            <TooltipTrigger asChild>
                            <div
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
                            </TooltipTrigger>
                            <TooltipContent side="top" size="sm" className="max-w-64">
                              <EventTip ev={ev} selfName={selfName} partnerName={partnerName} daisyName={state?.dependents?.daisy?.name || "Daisy"} t={t} />
                            </TooltipContent>
                            </Tooltip>
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
                      color: t.clayText,
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
        {/* Legend — schedule-block states + the reassurance note. */}
        <div style={{ height: 40, flexShrink: 0, boxSizing: "border-box", padding: "0 20px", borderTop: `1px solid ${t.sep}`, background: t.bg, display: "flex", alignItems: "center", gap: 18, fontSize: 12, color: t.text2 }}>
          {viewFilter === "coverage" && (["has", "waiting", "nobody"] as const).map((k) => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
              <CoverageDot kind={k} dark={dark} />
              {k === "has" ? `${state?.dependents?.daisy?.name || "Daisy"} has it` : k === "waiting" ? "Waiting on her" : "Nobody has the kids"}
            </span>
          ))}
          {viewFilter !== "coverage" && (<>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
            <CircleCheckIcon size={15} color={CARE_CHECK} isAnimated={false} />
            Care confirmed
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9, whiteSpace: "nowrap" }}>
            <span style={{ width: 3, height: 15, borderLeft: "3px solid #8A4B38", display: "inline-block", flexShrink: 0 }} />
            Blocked, covered
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9, whiteSpace: "nowrap" }}>
            <span style={{ width: 3, height: 15, borderLeft: "3px dashed #8A4B38", display: "inline-block", flexShrink: 0 }} />
            Blocked, nobody home
          </span>
          </>)}
          <span style={{ marginLeft: "auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            A block reserves time. It never moves a shift.
          </span>
        </div>
        </div>{/* /calendar card */}
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


/** The app icon's tile colour. */
const APP_ICON_TEAL = "#0F6E64";

/** Teal, the house "fine": the same colour the confirmed-care line used. */
const CARE_CHECK = "#0F6E64";

/**
 * Childcare confirmed for the day: a check in the cell's bottom-right corner
 * (nudged left when a game logo holds that corner). Hovering the day plays
 * the check's draw-in once; leaving resets it. It listens on the day cell
 * itself so a hover doesn't re-render the grid.
 */
function CareCheck({ right }: { right: number }) {
  const holder = useRef<HTMLSpanElement | null>(null);
  const icon = useRef<CircleCheckIconHandle | null>(null);

  useEffect(() => {
    const cell = holder.current?.closest("button");
    if (!cell) return;
    const play = () => icon.current?.startAnimation();
    const reset = () => icon.current?.stopAnimation();
    cell.addEventListener("mouseenter", play);
    cell.addEventListener("mouseleave", reset);
    return () => {
      cell.removeEventListener("mouseenter", play);
      cell.removeEventListener("mouseleave", reset);
    };
  }, []);

  return (
    <span
      ref={holder}
      role="img"
      aria-label="Childcare coverage confirmed"
      title="Childcare coverage confirmed"
      style={{ position: "absolute", right, bottom: 4, display: "flex", pointerEvents: "none" }}
    >
      <CircleCheckIcon ref={icon} size={15} color={CARE_CHECK} />
    </span>
  );
}

/** Whether a sideways swipe starting on `target` is that element's own
 *  business: typing, a dialog, or something that scrolls horizontally. */
function swipeBelongsElsewhere(target: EventTarget | null): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (el.matches('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return true;
    const { overflowX } = getComputedStyle(el);
    if ((overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth) return true;
  }
  return false;
}

/** What a life event's hover card says: title, when, who, and any notes. */
function EventTip({ ev, selfName, partnerName, daisyName, t }: {
  ev: SbEvent; selfName: string; partnerName: string; daisyName: string; t: ThemeTokens;
}) {
  const when = ev.startTime
    ? `${formatChipTime(ev.startTime)}${ev.endTime ? ` – ${formatChipTime(ev.endTime)}` : ""}`
    : "All day";
  const who = ev.who === "G" ? selfName : ev.who === "K" ? partnerName : ev.who === "Daisy" ? daisyName : "Family";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontWeight: 600 }}>{ev.title || "Event"}</div>
      <div className="text-muted-foreground">{when} · {who}</div>
      {ev.notes && <div style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{ev.notes}</div>}
      {ev.pending && <div style={{ color: t.clayText, fontWeight: 600, marginTop: 2 }}>Pending approval</div>}
    </div>
  );
}

/** A coverage day in the Coverage view: the gap or request's hours and who
 *  holds them. Same marks as the Coverage with Daisy panel. */
export interface CoverageMark {
  kind: "has" | "waiting" | "nobody";
  startTime: string;
  endTime: string;
  /** False for a gap nobody has been asked about yet. */
  requested: boolean;
}

const COVER_TEAL = "#0F6E64";
const COVER_CLAY = "#8A4B38";
const COVER_DAISY = "#5A6663";

/** Filled dot = she has it, hollow ring = waiting, short bar = nobody. */
function CoverageDot({ kind, dark }: { kind: CoverageMark["kind"]; dark: boolean }) {
  const teal = dark ? "#9ACFC6" : COVER_TEAL;
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true" style={{ flexShrink: 0 }}>
      {kind === "has" && <circle cx="5" cy="5" r="4" fill={dark ? "#A9B3B0" : COVER_DAISY} />}
      {kind === "waiting" && <circle cx="5" cy="5" r="3.4" fill="none" stroke={teal} strokeWidth="1.6" />}
      {kind === "nobody" && <rect x="1" y="4" width="8" height="2.2" rx="1" fill={COVER_CLAY} />}
    </svg>
  );
}

function CoverageChip({ mark, t, dark, daisyName }: { mark: CoverageMark; t: ThemeTokens; dark: boolean; daisyName: string }) {
  const who = mark.kind === "has" ? daisyName : mark.kind === "waiting" ? "Asked" : "Nobody";
  const hours = `${compactTime(mark.startTime)}–${compactTime(mark.endTime)}`;
  const box: React.CSSProperties =
    mark.kind === "has"
      ? { background: dark ? "rgba(169,179,176,0.16)" : "#EEF0EF", border: `1px solid ${dark ? "rgba(169,179,176,0.4)" : "#C9CFCD"}` }
      : mark.kind === "waiting"
        ? { background: t.bgElev, border: `1px solid ${dark ? "rgba(154,207,198,0.6)" : "#9ACFC6"}` }
        : { background: dark ? "rgba(138,75,56,0.18)" : "#EFDFDB", border: `1px dashed ${COVER_CLAY}` };
  const title =
    mark.kind === "has" ? `${daisyName} has the kids ${hours}`
      : mark.kind === "waiting" ? `Asked ${daisyName} for ${hours}; waiting on her`
        : mark.requested ? `${daisyName} can't do ${hours}; nobody has the kids`
          : `Nobody has the kids ${hours}`;
  return (
    <div
      title={title}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600, letterSpacing: "-0.01em",
        color: mark.kind === "nobody" ? (dark ? "#D9A08E" : COVER_CLAY) : t.text,
        whiteSpace: "nowrap", overflow: "hidden",
        ...box,
      }}
    >
      <CoverageDot kind={mark.kind} dark={dark} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{who}</span>
      <span style={{ marginLeft: "auto", fontWeight: 500, opacity: 0.85, flexShrink: 0 }}>{hours}</span>
    </div>
  );
}
