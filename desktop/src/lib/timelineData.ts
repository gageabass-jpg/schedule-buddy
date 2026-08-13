// Builds the per-day timeline data (both parents' unavailable ranges + the
// coverage window) for the DayTimeline component, from household state.
//
// The lanes are real: parentDayRanges reuses the same availability the overlap
// engine computes, so an expanded row shows exactly why coverage was needed.

import { buildShiftMap, type HouseholdState } from "../state";
import { parentDayRanges, hmToMin, type MinuteRange } from "./computeOverlap";

export interface DayTimelineData {
  selfRanges: MinuteRange[];
  partnerRanges: MinuteRange[];
  coverage: MinuteRange | null;
}

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function timelineForDate(
  state: HouseholdState | null,
  date: string,
  coverage: { startTime: string; endTime: string; endsNextDay?: boolean } | null,
): DayTimelineData {
  if (!state) return { selfRanges: [], partnerRanges: [], coverage: null };
  const st: HouseholdState = {
    ...state,
    template: state.template ?? [],
    overrides: state.overrides ?? [],
    ot: state.ot ?? [],
  };
  // A one-day margin each side so a cross-midnight shift or its sleep tail
  // resolves onto this date's axis.
  const shifts = buildShiftMap(st, addDays(date, -1), addDays(date, 1));
  const cov: MinuteRange | null = coverage
    ? { startMin: hmToMin(coverage.startTime), endMin: hmToMin(coverage.endTime, coverage.endsNextDay) }
    : null;
  return {
    selfRanges: parentDayRanges(date, "G", shifts, st),
    partnerRanges: parentDayRanges(date, "K", shifts, st),
    coverage: cov,
  };
}
