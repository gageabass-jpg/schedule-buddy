import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { HouseholdState } from "../state";

export type ShiftTarget = "self-ot" | "partner";

export interface NewShiftInput {
  householdId: string;
  target: ShiftTarget;
  date: string;        // YYYY-MM-DD
  shiftTypeId: string;
  label?: string;
  coworkers?: string;
}

export class WriteShiftError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WriteShiftError";
  }
}

/**
 * Read state/main, append the new shift in the right array, write back the
 * whole document. Mirrors the iOS app's pattern (BRIDGE.md §5.1) — full
 * overwrite, no atomic field merges, debounced upstream when needed.
 *
 *   target === "self-ot"  →  state.ot.push({ date, shiftTypeId, label })
 *   target === "partner"  →  state.partner.shifts.push({ date, shiftTypeId, label })
 */
export async function writeNewShift(input: NewShiftInput): Promise<void> {
  const { householdId, target, date, shiftTypeId } = input;
  const label = input.label?.trim() ?? "";

  const ref = doc(db, "households", householdId, "state", "main");
  let current: HouseholdState | null;
  try {
    const snap = await getDoc(ref);
    current = (snap.exists() ? (snap.data() as HouseholdState) : null);
  } catch (e) {
    throw new WriteShiftError("Couldn't read the household schedule.", e);
  }
  if (!current) {
    throw new WriteShiftError("Schedule document doesn't exist yet — open the iOS app once to initialize it.");
  }

  // Build the next state, copying fields we don't touch.
  const next: HouseholdState = {
    ...current,
    ot: [...(current.ot ?? [])],
    partner: { ...current.partner, shifts: [...(current.partner?.shifts ?? [])] },
  };

  if (target === "self-ot") {
    next.ot.push({
      date,
      shiftTypeId,
      label,
      ...(input.coworkers ? { coworkers: input.coworkers } : {}),
    });
  } else {
    next.partner.shifts.push({ date, shiftTypeId, label });
  }

  try {
    await setDoc(ref, next);
  } catch (e) {
    throw new WriteShiftError("Couldn't save the new shift. Check your connection and try again.", e);
  }
}
