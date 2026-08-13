// Builds the per-day timeline data (both parents' unavailable ranges + the
// coverage window) for the DayTimeline component, from household state.
//
// The lanes are real: parentDayRanges reuses the same availability the overlap
// engine computes, so an expanded row shows exactly why coverage was needed.

import { buildShiftMap, type HouseholdState } from "../state";
import { parentDaySegments, hmToMin, type MinuteRange, type DaySegments } from "./computeOverlap";

/** Each parent's actual shift START time(s) on `date`, as minutes-past-midnight,
 *  sorted. This is the clock-in time (e.g. a 3pm Evening shift → 900), NOT the
 *  unavailable window that folds in the arrival lead / travel / sleep — the
 *  "Working hours" column wants the plain shift start. */
export function parentShiftStarts(
  state: HouseholdState | null,
  date: string,
): { self: number[]; partner: number[] } {
  if (!state) return { self: [], partner: [] };
  const st: HouseholdState = {
    ...state,
    template: state.template ?? [],
    overrides: state.overrides ?? [],
    ot: state.ot ?? [],
  };
  const shifts = buildShiftMap(st, date, date);
  const byId = new Map((st.shiftTypes ?? []).map((s) => [s.id, s]));
  const startsFor = (who: "G" | "K"): number[] =>
    (shifts[date] ?? [])
      .filter((s) => s.who === who && s.shiftTypeId)
      .map((s) => byId.get(s.shiftTypeId!)?.start)
      .filter((x): x is string => !!x)
      .map((hm) => hmToMin(hm))
      .sort((a, b) => a - b);
  return { self: startsFor("G"), partner: startsFor("K") };
}

export interface DayTimelineData {
  self: DaySegments;
  partner: DaySegments;
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
  if (!state) return { self: { work: [], sleep: [] }, partner: { work: [], sleep: [] }, coverage: null };
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
    self: parentDaySegments(date, "G", shifts, st),
    partner: parentDaySegments(date, "K", shifts, st),
    coverage: cov,
  };
}
