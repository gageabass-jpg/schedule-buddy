// Pure geometry + data for the horizontal timeline. No React, no DOM.
//
// Time runs left to right on ONE continuous axis, so a night shift that
// crosses midnight is a single block, not two clipped halves. Everything is
// stored as a fractional day index ("days since 1970-01-01, local date") and
// converted to pixels only at the edge: x = (day - origin) * pxPerDay + gutter.
//
// Zoom is just pxPerDay. A day fills the screen near 1000 px/day; a month
// fits near 35 px/day. Level-of-detail (what gets labelled) keys off the same
// number, so there is no separate "day mode" and "month mode" to keep in sync.

import { buildShiftMap, type Event as SbEvent, type HouseholdState } from "../state";
import { daisyDayRanges, shiftSegmentsFor } from "./computeOverlap";
import type { ShiftMap } from "../data";

export const MIN_PER_DAY = 1440;

/** Zoom limits, in pixels per day. Max ≈ 125 px/hour; min ≈ 6 weeks on screen. */
export const MIN_PX_PER_DAY = 24;
export const MAX_PX_PER_DAY = 3000;

export const clampPpd = (ppd: number): number =>
  Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, ppd));

// ── Dates ───────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" → whole day index. UTC arithmetic, so DST never shifts it. */
export function dayIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}

export function isoFromDayIndex(idx: number): string {
  const dt = new Date(idx * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 0 = Sunday. Day index 0 (1970-01-01) was a Thursday. */
export const weekdayOf = (idx: number): number => (((idx + 4) % 7) + 7) % 7;

// ── Zoom + scroll ───────────────────────────────────────────────────────────

/** Pixels per day that put `spanDays` across a track `trackPx` wide. */
export const fitPpd = (spanDays: number, trackPx: number): number =>
  clampPpd(trackPx / spanDays);

/** Day (fractional, relative to `origin`) under viewport x `vx`. */
export const dayAtViewportX = (
  scrollLeft: number, vx: number, gutter: number, ppd: number,
): number => (scrollLeft + vx - gutter) / ppd;

/** scrollLeft that puts relative day `day` under viewport x `vx`. */
export const scrollLeftFor = (
  day: number, vx: number, gutter: number, ppd: number,
): number => day * ppd + gutter - vx;

/** New scrollLeft after a zoom that keeps the time under `vx` where it is. */
export function zoomedScrollLeft(
  scrollLeft: number, vx: number, gutter: number, oldPpd: number, newPpd: number,
): number {
  return scrollLeftFor(dayAtViewportX(scrollLeft, vx, gutter, oldPpd), vx, gutter, newPpd);
}

// ── Level of detail ─────────────────────────────────────────────────────────

export type HourStep = 1 | 3 | 0;   // hours between labels; 0 = no hour row

export interface Lod {
  /** Top header row shows each day ("Mon, Oct 5") instead of each month. */
  topIsDays: boolean;
  /** Hours between labelled ticks in the second row; 0 = second row is days. */
  hourStep: HourStep;
  /** Draw a half-hour gridline. */
  halfHour: boolean;
  /** Day cell text: "Mon 5" / "5" / none. */
  dayLabel: "weekday-number" | "number" | "none";
  /** Work-block text: name + times / short chip / none. */
  blockText: "full" | "chip" | "none";
}

export function lodFor(ppd: number): Lod {
  const perHour = ppd / 24;
  const hourStep: HourStep = perHour >= 44 ? 1 : perHour >= 14 ? 3 : 0;
  return {
    topIsDays: hourStep !== 0,
    hourStep,
    halfHour: perHour >= 100,
    dayLabel: ppd >= 90 ? "weekday-number" : ppd >= 28 ? "number" : "none",
    blockText: ppd >= 700 ? "full" : ppd >= 120 ? "chip" : "none",
  };
}

/** The text a block can carry at a given pixel width. */
export function blockTextFor(widthPx: number): Lod["blockText"] {
  return widthPx >= 120 ? "full" : widthPx >= 34 ? "chip" : "none";
}

// ── Blocks ──────────────────────────────────────────────────────────────────

export type BlockKind = "work" | "rest" | "school" | "coverage" | "event";

export interface TlBlock {
  id: string;
  kind: BlockKind;
  /** Absolute minutes: dayIndex * 1440 + minute-of-day. May run past midnight. */
  startMin: number;
  endMin: number;
  label: string;
  /** Short text for narrow blocks — the shift chip ("7p"). */
  chip?: string;
  /** Second line: the time range, or a status. */
  sub?: string;
  /** ISO date of the day this block belongs to (for opening detail). */
  date: string;
  who?: "G" | "K" | "D";
  /** Index into the day's shift list, when the block is a shift. */
  shiftIndex?: number;
  event?: SbEvent;
  allDay?: boolean;
  pending?: boolean;
}

const parseHM = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

const clock = (min: number): string => {
  const m = ((min % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h < 12 ? "a" : "p";
  const h12 = h % 12 || 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")}${ap}` : `${h12}${ap}`;
};

export const rangeLabel = (startMin: number, endMin: number): string =>
  `${clock(startMin)}–${clock(endMin)}`;

/** Shifts + the rest around them for one person, over the days [from, to]. */
export function personBlocks(
  state: HouseholdState,
  shifts: ShiftMap,
  who: "G" | "K" | "D",
  fromIdx: number,
  toIdx: number,
): TlBlock[] {
  const out: TlBlock[] = [];
  for (let idx = fromIdx; idx <= toIdx; idx++) {
    const date = isoFromDayIndex(idx);
    (shifts[date] ?? []).forEach((s, shiftIndex) => {
      if (s.who !== who) return;
      const seg = shiftSegmentsFor(s.shiftTypeId, state, 0);
      if (!seg) return;
      const base = idx * MIN_PER_DAY;
      const typ = state.shiftTypes.find((t) => t.id === s.shiftTypeId);
      out.push({
        id: `w-${who}-${date}-${shiftIndex}`,
        kind: "work",
        startMin: base + seg.work.startMin,
        endMin: base + seg.work.endMin,
        label: typ?.name ?? s.label,
        chip: s.label,
        sub: rangeLabel(seg.work.startMin, seg.work.endMin),
        date,
        who,
        shiftIndex,
        pending: (s as { pending?: boolean }).pending,
      });
      // Rest is only modelled for the two parents.
      if (who === "D") return;
      seg.sleep.forEach((r, i) => {
        out.push({
          id: `r-${who}-${date}-${shiftIndex}-${i}`,
          kind: "rest",
          startMin: base + r.startMin,
          endMin: base + r.endMin,
          label: "Resting",
          sub: rangeLabel(r.startMin, r.endMin),
          date,
          who,
        });
      });
    });
  }
  return out;
}

/** Daisy's school time, as blocks. */
export function schoolBlocks(state: HouseholdState, fromIdx: number, toIdx: number): TlBlock[] {
  const out: TlBlock[] = [];
  for (let idx = fromIdx; idx <= toIdx; idx++) {
    const date = isoFromDayIndex(idx);
    daisyDayRanges(state, date).forEach((r, i) => {
      out.push({
        id: `s-${date}-${i}`,
        kind: "school",
        startMin: idx * MIN_PER_DAY + r.startMin,
        endMin: idx * MIN_PER_DAY + r.endMin,
        label: "School",
        sub: rangeLabel(r.startMin, r.endMin),
        date,
        who: "D",
      });
    });
  }
  return out;
}

/** Open and confirmed coverage windows. */
export function coverageBlocks(state: HouseholdState, fromIdx: number, toIdx: number): TlBlock[] {
  const out: TlBlock[] = [];
  for (const r of state.coverageRequests ?? []) {
    if (r.status !== "pending" && r.status !== "confirmed") continue;
    const idx = dayIndex(r.date);
    if (idx < fromIdx - 1 || idx > toIdx) continue;
    const start = parseHM(r.startTime);
    let end = parseHM(r.endTime);
    if (r.endsNextDay || end <= start) end += MIN_PER_DAY;
    out.push({
      id: `c-${r.id}`,
      kind: "coverage",
      startMin: idx * MIN_PER_DAY + start,
      endMin: idx * MIN_PER_DAY + end,
      label: r.status === "confirmed" ? "Coverage" : "Coverage (pending)",
      sub: rangeLabel(start, end),
      date: r.date,
      pending: r.status === "pending",
    });
  }
  return out;
}

/** Events. Untimed events fill their whole day; a missing end is one hour. */
export function eventBlocks(events: SbEvent[], fromIdx: number, toIdx: number): TlBlock[] {
  const out: TlBlock[] = [];
  for (const ev of events) {
    const idx = dayIndex(ev.date);
    if (idx < fromIdx - 1 || idx > toIdx) continue;
    const allDay = !ev.startTime;
    const start = allDay ? 0 : parseHM(ev.startTime!);
    let end = allDay ? MIN_PER_DAY : ev.endTime ? parseHM(ev.endTime) : start + 60;
    if (!allDay && end <= start) end += MIN_PER_DAY;
    out.push({
      id: `e-${ev.id}`,
      kind: "event",
      startMin: idx * MIN_PER_DAY + start,
      endMin: idx * MIN_PER_DAY + end,
      label: ev.title,
      sub: allDay ? "All day" : rangeLabel(start, end),
      date: ev.date,
      event: ev,
      allDay,
      pending: ev.pending,
    });
  }
  return out;
}

/** Greedy row packing so overlapping blocks stack instead of hiding each other.
 *  Returns each block's row, and how many rows were used. `gapMin` keeps two
 *  blocks that almost touch off the same row (their labels would collide). */
export function packRows(
  blocks: TlBlock[], gapMin = 0,
): { rows: Map<string, number>; count: number } {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const rowEnds: number[] = [];
  const rows = new Map<string, number>();
  for (const b of sorted) {
    let r = rowEnds.findIndex((end) => end + gapMin <= b.startMin);
    if (r === -1) { r = rowEnds.length; rowEnds.push(b.endMin); }
    else rowEnds[r] = b.endMin;
    rows.set(b.id, r);
  }
  return { rows, count: Math.max(1, rowEnds.length) };
}

/** Shifts for a window straight from household state — the app's own map only
 *  covers the visible month, and the timeline pans past it. */
export function shiftsForWindow(
  state: HouseholdState, fromIdx: number, toIdx: number,
): ShiftMap {
  // One day of margin each side: rest and overnight tails reach across.
  return buildShiftMap(
    { ...state, template: state.template ?? [], overrides: state.overrides ?? [], ot: state.ot ?? [] },
    isoFromDayIndex(fromIdx - 1),
    isoFromDayIndex(toIdx + 1),
  );
}

// ── Header ticks ────────────────────────────────────────────────────────────

export interface MonthSpan { key: string; startIdx: number; days: number; label: string }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Month spans clipped to [fromIdx, toIdx] (so a label never starts off-screen
 *  and renders at a huge negative offset). `daysFull` = real length for width. */
export function monthSpans(fromIdx: number, toIdx: number): MonthSpan[] {
  const out: MonthSpan[] = [];
  let idx = fromIdx;
  while (idx <= toIdx) {
    const dt = new Date(idx * 86_400_000);
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth();
    const nextStart = Math.round(Date.UTC(y, m + 1, 1) / 86_400_000);
    out.push({
      key: `${y}-${m}`,
      startIdx: idx,
      days: Math.min(nextStart, toIdx + 1) - idx,
      label: `${MONTHS[m]} ${y}`,
    });
    idx = nextStart;
  }
  return out;
}
