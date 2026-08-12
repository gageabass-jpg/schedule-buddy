// Which upcoming days still need a caregiver.
//
// One source of truth for BOTH the Inspector's "Send caregiver requests"
// reminder card and the Send-to-caregiver modal, so the card's count and the
// modal's rows can never disagree.
//
// Deliberately computed over a fixed forward window from TODAY rather than the
// month you happen to be looking at: "days on the current schedule that need
// coverage" shouldn't change because you paged the calendar to March.
//
// Scope rules mirror rewriteCoverage.ts:
//   - today forward only (you can't staff a day that's gone)
//   - a day with a PENDING or CONFIRMED request is already lined up
//   - declined / issue days stay eligible, so a fresh ask can replace a "no"

import { buildShiftMap, type HouseholdState } from "../state";
import { computeOverlapCandidates, type OverlapCandidate } from "./computeOverlap";

/** Six weeks — comfortably past one 4-week schedule, so the next block's
 *  gaps surface while you're still finishing the current one. */
export const COVERAGE_LOOKAHEAD_DAYS = 42;

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Overlap windows from today forward that have no coverage lined up yet.
 * Empty array = nothing to send.
 */
export function pendingCoverageNeeds(
  state: HouseholdState | null,
  today: string = todayIso(),
  daysAhead: number = COVERAGE_LOOKAHEAD_DAYS,
): OverlapCandidate[] {
  if (!state) return [];

  // Start a day early so a night shift's post-midnight sleep tail lands on
  // today's axis (same reason rewriteCoverage.ts backs up one day).
  const from = addDays(today, -1);
  const to = addDays(today, daysAhead);

  // buildShiftMap assumes these arrays exist.
  const st: HouseholdState = {
    ...state,
    template: state.template ?? [],
    overrides: state.overrides ?? [],
    ot: state.ot ?? [],
  };

  const linedUp = new Set(
    (state.coverageRequests ?? [])
      .filter((r) => r.status === "pending" || r.status === "confirmed")
      .map((r) => r.date),
  );

  return computeOverlapCandidates(buildShiftMap(st, from, to), st)
    .filter((c) => c.date >= today && c.date <= to && !linedUp.has(c.date));
}

/** Stable signature of the current need-set, used to decide whether a
 *  dismissed reminder should come back (it should, once the days change). */
export function coverageNeedsSignature(needs: OverlapCandidate[]): string {
  return Array.from(new Set(needs.map((n) => n.date))).sort().join(",");
}
