import type { ShiftMap } from "../data";
import type { HouseholdState } from "../state";

const MIN_PER_DAY = 24 * 60;

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

/** Range a shift occupies as work, plus an optional sleep window after end. */
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
  const blocks: UnavailableBlock[] = [{ startMin, endMin, kind: "work" }];
  const sleep = (t.sleepHours ?? 0) * 60;
  if (sleep > 0) {
    blocks.push({ startMin: endMin, endMin: endMin + sleep, kind: "sleep" });
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

/** Collect every minute-range a parent is unavailable on `date`. Includes
 *  - today's work + sleep-after blocks, and
 *  - yesterday's blocks shifted forward by 24h (so a late-night shift or its
 *    morning sleep tail correctly lands on today's axis). */
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
  return out;
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
 * (working OR sleeping post-shift), compute the widest pairwise
 * intersection. The "reason" surfaces *why* — both-working / work-and-
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

    let widest: Intersection | null = null;
    for (const g of gBlocks) {
      for (const k of kBlocks) {
        const ix = intersectBlocks(g, k);
        if (!ix) continue;
        if (
          !widest ||
          (ix.endMin - ix.startMin) > (widest.endMin - widest.startMin) ||
          (
            (ix.endMin - ix.startMin) === (widest.endMin - widest.startMin) &&
            reasonRank(ix.reason) < reasonRank(widest.reason)
          )
        ) widest = ix;
      }
    }
    if (!widest) continue;

    const endsNextDay = widest.endMin >= MIN_PER_DAY;
    const startTime = fmtHM(widest.startMin);
    const endTime = fmtHM(widest.endMin);
    const label = `${compactTime(startTime)} – ${compactTime(endTime)}${endsNextDay ? " (next day)" : ""}`;

    out.push({ date, startTime, endTime, endsNextDay, label, reason: widest.reason });
  }

  return out;
}
