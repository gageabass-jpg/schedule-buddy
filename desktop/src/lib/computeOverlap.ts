import type { ShiftMap } from "../data";
import type { HouseholdState } from "../state";

const MIN_PER_DAY = 24 * 60;

/** Minutes from local-day start. End may exceed 24h if the shift crosses midnight. */
export interface MinuteRange {
  startMin: number;
  endMin: number;
}

export interface OverlapCandidate {
  date: string;                    // YYYY-MM-DD
  startTime: string;               // "HH:MM"
  endTime: string;                 // "HH:MM"
  endsNextDay: boolean;
  /** Pretty label like "7p – 11p" or "11p – 7a (next day)". */
  label: string;
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

function shiftRange(shiftTypeId: string | undefined, state: HouseholdState): MinuteRange | null {
  if (!shiftTypeId) return null;
  const t = state.shiftTypes.find((s) => s.id === shiftTypeId);
  if (!t) return null;
  const startMin = parseHM(t.start);
  let endMin = parseHM(t.end);
  if (t.crossesMidnight || endMin <= startMin) endMin += MIN_PER_DAY;
  return { startMin, endMin };
}

function intersect(a: MinuteRange, b: MinuteRange): MinuteRange | null {
  const startMin = Math.max(a.startMin, b.startMin);
  const endMin = Math.min(a.endMin, b.endMin);
  return endMin > startMin ? { startMin, endMin } : null;
}

/**
 * For every date in the shifts map where both G and K work, compute the
 * intersection of their shift time ranges — that's the window the caregiver
 * needs to cover.
 *
 * If a day has multiple shifts per person, we take the broadest pair-wise
 * intersection (Phase 1 keeps this simple; complex multi-shift days can be
 * trimmed by the user in the review modal).
 */
export function computeOverlapCandidates(
  shifts: ShiftMap,
  state: HouseholdState,
): OverlapCandidate[] {
  const out: OverlapCandidate[] = [];

  const dates = Object.keys(shifts).sort();
  for (const date of dates) {
    const list = shifts[date] ?? [];
    const gShifts = list.filter((s) => s.who === "G");
    const kShifts = list.filter((s) => s.who === "K");
    if (gShifts.length === 0 || kShifts.length === 0) continue;

    let widest: MinuteRange | null = null;
    for (const g of gShifts) {
      const gr = shiftRange(g.shiftTypeId, state);
      if (!gr) continue;
      for (const k of kShifts) {
        const kr = shiftRange(k.shiftTypeId, state);
        if (!kr) continue;
        const ix = intersect(gr, kr);
        if (!ix) continue;
        if (!widest || (ix.endMin - ix.startMin) > (widest.endMin - widest.startMin)) {
          widest = ix;
        }
      }
    }
    if (!widest) continue;

    const endsNextDay = widest.endMin >= MIN_PER_DAY;
    const startTime = fmtHM(widest.startMin);
    const endTime = fmtHM(widest.endMin);
    const label = `${compactTime(startTime)} – ${compactTime(endTime)}${endsNextDay ? " (next day)" : ""}`;

    out.push({ date, startTime, endTime, endsNextDay, label });
  }

  return out;
}
