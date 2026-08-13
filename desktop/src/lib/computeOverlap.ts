import type { ShiftMap } from "../data";
import type { HouseholdState } from "../state";

const MIN_PER_DAY = 24 * 60;

// ── How a shift actually consumes a parent's day ────────────────────────────
// A shift is not just its clock hours. The parent is gone before it (getting
// ready + travelling), still gone after it (travelling home), awake for a
// while once home, and only then asleep. Modelling only the clock hours made
// the engine hand back windows that didn't match reality — coverage that
// started too late, ended before anyone was actually home, and ignored the
// daytime sleep a night worker needs BEFORE clocking on.

/** Getting ready + travel before a shift. Coverage must start this far ahead:
 *  the caregiver's arrival time IS the start of the request (BRIDGE.md). */
export const LEAVE_LEAD_MIN = 120;   // 1h to get ready + 1h to travel
/** Travel home after a shift ends — still not available to watch anyone. */
export const TRAVEL_HOME_MIN = 30;
/** Awake-at-home buffer after arriving, before post-shift sleep begins. */
export const SETTLE_MIN = 60;
/** Overlaps shorter than this are handoff slivers (one parent leaving a few
 *  minutes before the other lands), not something you call a caregiver for. */
export const MIN_WINDOW_MIN = 60;

/** Minutes from a reference local-day start. Ranges may extend past 24h
 *  when a shift (or its sleep window) spills into the next day. */
export interface MinuteRange {
  startMin: number;
  endMin: number;
}

/** Why a candidate was generated — useful in the review UI so the user
 *  understands the source of each row. */
export type OverlapReason = "both-working" | "work-and-sleep" | "both-sleeping";

export interface OverlapCandidate {
  date: string;                    // YYYY-MM-DD
  startTime: string;               // "HH:MM"
  endTime: string;                 // "HH:MM"
  endsNextDay: boolean;
  /** Pretty label like "7p – 11p" or "11p – 7a (next day)". */
  label: string;
  /** Highest-priority reason that contributes to this window. */
  reason: OverlapReason;
}

function parseHM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fmtHM(mins: number): string {
  const dayMins = ((mins % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const h = Math.floor(dayMins / 60);
  const m = dayMins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function compactTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr) || 0;
  const m = Number(mStr) || 0;
  const mSuffix = m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
  if (h === 0) return `12${mSuffix}a`;
  if (h === 12) return `12${mSuffix}p`;
  if (h < 12) return `${h}${mSuffix}a`;
  return `${h - 12}${mSuffix}p`;
}

interface UnavailableBlock extends MinuteRange {
  kind: "work" | "sleep";
}

/**
 * Every range a shift makes its owner unavailable, in order:
 *
 *   pre-shift sleep → [leaves ─ works ─ travels home] → settle → recovery sleep
 *
 * The "away" range folds the leave lead and the drive home into the work
 * block, so the coverage window this produces already starts when the parent
 * walks out and ends when someone walks back in — callers do NOT apply a
 * separate arrival lead on top.
 *
 * The settle gap is deliberately NOT a block: they're home and awake then,
 * which is exactly why a night worker can cover the kid for an hour after a
 * shift before going down.
 */
function shiftBlocksFor(
  shiftTypeId: string | undefined,
  state: HouseholdState,
  /** Offset (in minutes) to add to every range — used to shift yesterday's
   *  shifts into today's minute axis. */
  offsetMin = 0,
): UnavailableBlock[] {
  if (!shiftTypeId) return [];
  const t = state.shiftTypes.find((s) => s.id === shiftTypeId);
  if (!t) return [];
  const startMin = parseHM(t.start) + offsetMin;
  let endMin = parseHM(t.end) + offsetMin;
  if (t.crossesMidnight || endMin <= startMin) endMin += MIN_PER_DAY;

  const leavesAt = startMin - LEAVE_LEAD_MIN;
  const homeAt = endMin + TRAVEL_HOME_MIN;
  const blocks: UnavailableBlock[] = [{ startMin: leavesAt, endMin: homeAt, kind: "work" }];

  // Daytime sleep before a night shift, ending when they start getting ready.
  const preSleep = (t.preSleepHours ?? 0) * 60;
  if (preSleep > 0) {
    blocks.push({ startMin: leavesAt - preSleep, endMin: leavesAt, kind: "sleep" });
  }

  // Recovery sleep — begins once home and settled, not the moment they clock out.
  const sleep = (t.sleepHours ?? 0) * 60;
  if (sleep > 0) {
    const sleepStart = homeAt + SETTLE_MIN;
    blocks.push({ startMin: sleepStart, endMin: sleepStart + sleep, kind: "sleep" });
  }
  return blocks;
}

/** ISO date "YYYY-MM-DD" → previous local-day "YYYY-MM-DD". */
function prevIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() - 1);
  const y2 = dt.getFullYear();
  const m2 = String(dt.getMonth() + 1).padStart(2, "0");
  const d2 = String(dt.getDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
}

/** ISO date "YYYY-MM-DD" → next local-day "YYYY-MM-DD". */
function nextIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + 1);
  const y2 = dt.getFullYear();
  const m2 = String(dt.getMonth() + 1).padStart(2, "0");
  const d2 = String(dt.getDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
}

/** Collect every minute-range a parent is unavailable on `date`. Includes
 *  - today's own blocks,
 *  - yesterday's shifted forward by 24h (a night shift, its drive home, or its
 *    morning recovery sleep landing on today's axis), and
 *  - tomorrow's shifted back by 24h, because pre-shift sleep reaches backwards
 *    and an early enough start puts that sleep on today. */
function unavailableBlocks(
  date: string,
  who: "G" | "K",
  shifts: ShiftMap,
  state: HouseholdState,
): UnavailableBlock[] {
  const out: UnavailableBlock[] = [];
  const today = (shifts[date] ?? []).filter((s) => s.who === who);
  for (const s of today) out.push(...shiftBlocksFor(s.shiftTypeId, state, 0));
  const ydate = prevIsoDate(date);
  const yesterday = (shifts[ydate] ?? []).filter((s) => s.who === who);
  for (const s of yesterday) {
    for (const b of shiftBlocksFor(s.shiftTypeId, state, -MIN_PER_DAY)) {
      // Only carry forward the portion that lands on today's axis.
      if (b.endMin <= 0) continue;
      out.push({ ...b, startMin: Math.max(b.startMin, 0) });
    }
  }
  const tdate = nextIsoDate(date);
  const tomorrow = (shifts[tdate] ?? []).filter((s) => s.who === who);
  for (const s of tomorrow) {
    for (const b of shiftBlocksFor(s.shiftTypeId, state, MIN_PER_DAY)) {
      // Only carry back the portion that reaches into today.
      if (b.startMin >= MIN_PER_DAY) continue;
      out.push({ ...b, endMin: Math.min(b.endMin, MIN_PER_DAY) });
    }
  }
  return out;
}

// ── Day-timeline support ────────────────────────────────────────────────────
// The redesigned coverage dialogs draw a per-day timeline: one lane per parent
// showing when they're unavailable, one lane for the coverage window. The axis
// runs 6am → midnight. These helpers expose the SAME availability the overlap
// engine computes, so the lanes are truthful rather than illustrative.

export const TIMELINE_START_MIN = 6 * 60;   // 6:00am
export const TIMELINE_END_MIN = 24 * 60;    // midnight
export const TIMELINE_SPAN_MIN = TIMELINE_END_MIN - TIMELINE_START_MIN;

/** Merge overlapping/adjacent ranges and clamp them to the timeline axis. */
function mergeToAxis(ranges: MinuteRange[]): MinuteRange[] {
  const clamped = ranges
    .map((r) => ({
      startMin: Math.max(r.startMin, TIMELINE_START_MIN),
      endMin: Math.min(r.endMin, TIMELINE_END_MIN),
    }))
    .filter((r) => r.endMin > r.startMin)
    .sort((a, b) => a.startMin - b.startMin);
  const out: MinuteRange[] = [];
  for (const r of clamped) {
    const last = out[out.length - 1];
    if (last && r.startMin <= last.endMin) last.endMin = Math.max(last.endMin, r.endMin);
    else out.push({ ...r });
  }
  return out;
}

/** A parent's unavailable ranges on `date`, clamped to the timeline axis —
 *  work + travel + sleep already folded in by shiftBlocksFor. */
export function parentDayRanges(
  date: string,
  who: "G" | "K",
  shifts: ShiftMap,
  state: HouseholdState,
): MinuteRange[] {
  return mergeToAxis(unavailableBlocks(date, who, shifts, state));
}

/** Working hours vs resting hours, split for the day timeline. `work` is the
 *  PURE shift clock hours (not the lead/travel the coverage engine folds in);
 *  `sleep` is the pre-shift and post-shift rest windows. Both clamped to the
 *  6am–midnight axis. */
export interface DaySegments { work: MinuteRange[]; sleep: MinuteRange[]; }

function shiftSegmentsFor(
  shiftTypeId: string | undefined,
  state: HouseholdState,
  offsetMin: number,
): { work: MinuteRange; sleep: MinuteRange[] } | null {
  if (!shiftTypeId) return null;
  const t = state.shiftTypes.find((s) => s.id === shiftTypeId);
  if (!t) return null;
  const startMin = parseHM(t.start) + offsetMin;
  let endMin = parseHM(t.end) + offsetMin;
  if (t.crossesMidnight || endMin <= startMin) endMin += MIN_PER_DAY;

  const sleep: MinuteRange[] = [];
  const leavesAt = startMin - LEAVE_LEAD_MIN;
  const homeAt = endMin + TRAVEL_HOME_MIN;
  const pre = (t.preSleepHours ?? 0) * 60;
  if (pre > 0) sleep.push({ startMin: leavesAt - pre, endMin: leavesAt });
  const post = (t.sleepHours ?? 0) * 60;
  if (post > 0) {
    const s = homeAt + SETTLE_MIN;
    sleep.push({ startMin: s, endMin: s + post });
  }
  return { work: { startMin, endMin }, sleep };
}

export function parentDaySegments(
  date: string,
  who: "G" | "K",
  shifts: ShiftMap,
  state: HouseholdState,
): DaySegments {
  const work: MinuteRange[] = [];
  const sleep: MinuteRange[] = [];
  // today, yesterday shifted +24h, tomorrow shifted −24h — same span
  // unavailableBlocks scans, so cross-midnight work and next-day pre-sleep land.
  const collect = (d: string, offset: number) => {
    for (const s of (shifts[d] ?? []).filter((x) => x.who === who)) {
      const seg = shiftSegmentsFor(s.shiftTypeId, state, offset);
      if (!seg) continue;
      work.push(seg.work);
      sleep.push(...seg.sleep);
    }
  };
  collect(date, 0);
  collect(prevIsoDate(date), -MIN_PER_DAY);
  collect(nextIsoDate(date), MIN_PER_DAY);
  return { work: mergeToAxis(work), sleep: mergeToAxis(sleep) };
}

/** "HH:MM" (+ optional next-day flag) → minutes on today's axis. */
export function hmToMin(hhmm: string, nextDay = false): number {
  return parseHM(hhmm) + (nextDay ? MIN_PER_DAY : 0);
}

interface Intersection extends MinuteRange {
  reason: OverlapReason;
}

function intersectBlocks(a: UnavailableBlock, b: UnavailableBlock): Intersection | null {
  const startMin = Math.max(a.startMin, b.startMin);
  const endMin = Math.min(a.endMin, b.endMin);
  if (endMin <= startMin) return null;
  let reason: OverlapReason;
  if (a.kind === "work" && b.kind === "work") reason = "both-working";
  else if (a.kind === "sleep" && b.kind === "sleep") reason = "both-sleeping";
  else reason = "work-and-sleep";
  return { startMin, endMin, reason };
}

function reasonRank(r: OverlapReason): number {
  // Prefer the most "live" framing if multiple overlap on a single day.
  if (r === "both-working") return 0;
  if (r === "work-and-sleep") return 1;
  return 2;
}

/**
 * For every dated cell where both G and K have unavailable blocks
 * (working OR sleeping post-shift), compute EVERY pairwise intersection,
 * then merge overlapping/adjacent ones into contiguous coverage windows —
 * one candidate per window. A day can produce multiple windows (e.g. an
 * afternoon work-while-recovering gap AND a both-working evening); we
 * must report them all, not just the widest, or a real gap silently
 * disappears. The "reason" surfaces *why* — both-working / work-and-
 * sleep / both-sleeping — so callers can label cards accordingly.
 *
 * We scan today + yesterday's shifts for each parent so a shift type's
 * post-shift sleep window correctly bridges across midnight.
 */
export function computeOverlapCandidates(
  shifts: ShiftMap,
  state: HouseholdState,
): OverlapCandidate[] {
  const out: OverlapCandidate[] = [];

  // Include any date that has either G or K shifts today OR yesterday,
  // since yesterday's tail can land on today.
  const datesWithShifts = new Set<string>(Object.keys(shifts));
  // Also include the day-after of every shift date so a sleep tail lands.
  for (const d of Object.keys(shifts)) {
    const [y, m, dd] = d.split("-").map(Number);
    const next = new Date(y, (m || 1) - 1, dd || 1);
    next.setDate(next.getDate() + 1);
    const ny = next.getFullYear();
    const nm = String(next.getMonth() + 1).padStart(2, "0");
    const nd = String(next.getDate()).padStart(2, "0");
    datesWithShifts.add(`${ny}-${nm}-${nd}`);
  }

  const dates = Array.from(datesWithShifts).sort();
  for (const date of dates) {
    const gBlocks = unavailableBlocks(date, "G", shifts, state);
    const kBlocks = unavailableBlocks(date, "K", shifts, state);
    if (gBlocks.length === 0 || kBlocks.length === 0) continue;

    // Collect every pairwise intersection …
    const hits: Intersection[] = [];
    for (const g of gBlocks) {
      for (const k of kBlocks) {
        const ix = intersectBlocks(g, k);
        if (ix) hits.push(ix);
      }
    }
    if (hits.length === 0) continue;

    // … then merge overlapping/adjacent ones into contiguous windows.
    // E.g. G leaving 6a meets K's work block (til 7a) and her sleep block
    // (7a → recovery end) — two touching hits that are ONE coverage need.
    hits.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    const windows: Intersection[] = [];
    for (const ix of hits) {
      const last = windows[windows.length - 1];
      if (last && ix.startMin <= last.endMin) {
        last.endMin = Math.max(last.endMin, ix.endMin);
        if (reasonRank(ix.reason) < reasonRank(last.reason)) last.reason = ix.reason;
      } else {
        windows.push({ ...ix });
      }
    }

    // Drop handoff slivers before folding — otherwise a 30-minute gap while
    // one parent drives home after the other has already left would drag the
    // day's whole window hours earlier than anyone actually needs a caregiver.
    for (let i = windows.length - 1; i >= 0; i--) {
      if (windows[i].endMin - windows[i].startMin < MIN_WINDOW_MIN) windows.splice(i, 1);
    }
    if (windows.length === 0) continue;

    // One coverage window per day. Disjoint overlaps on the same date (e.g. a
    // morning work+sleep stretch, a couple of free hours, then a both-working
    // evening) used to become two separate requests — but nobody sends a
    // caregiver home for two hours and calls her back, so that's two asks for
    // one shift. Fold them into a single continuous window: earliest start →
    // latest end. The start is the earliest overlap, so the arrival lead
    // applied downstream still lands 2h before the FIRST parent leaves.
    if (windows.length > 1) {
      const startMin = Math.min(...windows.map((w) => w.startMin));
      const endMin = Math.max(...windows.map((w) => w.endMin));
      // Keep the most "live" framing across the folded windows.
      const reason = windows.reduce(
        (best, w) => (reasonRank(w.reason) < reasonRank(best) ? w.reason : best),
        windows[0].reason,
      );
      windows.splice(0, windows.length, { startMin, endMin, reason });
    }

    for (const w of windows) {
      const endsNextDay = w.endMin >= MIN_PER_DAY;
      const startTime = fmtHM(w.startMin);
      const endTime = fmtHM(w.endMin);
      const label = `${compactTime(startTime)} – ${compactTime(endTime)}${endsNextDay ? " (next day)" : ""}`;
      out.push({ date, startTime, endTime, endsNextDay, label, reason: w.reason });
    }
  }

  return out;
}
