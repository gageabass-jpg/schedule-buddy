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

// The pure geometry (zoom, pan, level of detail, header ticks, row packing)
// lives in shared-ui/ and is re-exported here, so existing imports keep working.

import { buildShiftMap, type Event as SbEvent, type HouseholdState } from "../state";
import { daisyDayRanges, shiftSegmentsFor } from "./computeOverlap";
import type { ShiftMap } from "../data";
import { MIN_PER_DAY, dayIndex, isoFromDayIndex, parseHM, rangeLabel } from "@nucleus/ui/lib/timelineAxis";

export * from "@nucleus/ui/lib/timelineAxis";

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

export interface TimelineData {
  shifts: ShiftMap;
  G: TlBlock[];
  K: TlBlock[];
  /** Null when the household has no dependent. */
  D: TlBlock[] | null;
  cov: TlBlock[];
  ev: TlBlock[];
}

/** Every lane's blocks for the days [fromIdx, toIdx].
 *
 *  Daisy's lane is her school time from the coverage engine only. buildShiftMap
 *  also lists her school as "D" shifts, and those cover the same hours — drawing
 *  both would stack two blocks on every school day. The engine's ranges also
 *  include custom start/end slots that never become a "D" shift. */
export function timelineData(
  state: HouseholdState, events: SbEvent[], fromIdx: number, toIdx: number,
): TimelineData {
  const shifts = shiftsForWindow(state, fromIdx, toIdx);
  return {
    shifts,
    G: personBlocks(state, shifts, "G", fromIdx, toIdx),
    K: personBlocks(state, shifts, "K", fromIdx, toIdx),
    D: state.dependents?.daisy ? schoolBlocks(state, fromIdx, toIdx) : null,
    cov: coverageBlocks(state, fromIdx, toIdx),
    ev: eventBlocks(events, fromIdx, toIdx),
  };
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
