import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { HouseholdState } from "../state";
import type { ShiftSource } from "../data";

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

async function readState(householdId: string): Promise<HouseholdState> {
  const ref = doc(db, "households", householdId, "state", "main");
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (e) {
    throw new WriteShiftError("Couldn't read the household schedule.", e);
  }
  if (!snap.exists()) {
    throw new WriteShiftError("Schedule document doesn't exist yet — open the iOS app once to initialize it.");
  }
  return snap.data() as HouseholdState;
}

async function writeState(householdId: string, next: HouseholdState): Promise<void> {
  const ref = doc(db, "households", householdId, "state", "main");
  try {
    await setDoc(ref, next);
  } catch (e) {
    throw new WriteShiftError("Couldn't save the change. Check your connection and try again.", e);
  }
}

/**
 * Delete (or "mark off") a shift on a given date, branching on source:
 *   - ot[i] / partner.shifts[i]  → splice out at that index
 *   - override                   → remove the override entry for this date
 *                                   (restores whatever template says)
 *   - template / alt-weekend     → add an override with shiftTypeId: null
 *                                   so just THIS date is off
 */
export async function deleteShift(
  householdId: string,
  dateISO: string,
  source: ShiftSource,
): Promise<void> {
  const current = await readState(householdId);
  const next: HouseholdState = {
    ...current,
    ot: [...(current.ot ?? [])],
    overrides: [...(current.overrides ?? [])],
    partner: { ...current.partner, shifts: [...(current.partner?.shifts ?? [])] },
  };

  switch (source.kind) {
    case "ot":
      if (source.index < 0 || source.index >= next.ot.length) {
        throw new WriteShiftError("This shift no longer exists. Refresh and try again.");
      }
      next.ot.splice(source.index, 1);
      break;
    case "partner":
      if (source.index < 0 || source.index >= next.partner.shifts.length) {
        throw new WriteShiftError("This shift no longer exists. Refresh and try again.");
      }
      next.partner.shifts.splice(source.index, 1);
      break;
    case "override":
      next.overrides = next.overrides.filter((o) => o.date !== dateISO);
      break;
    case "template":
    case "alt-weekend": {
      const existing = next.overrides.findIndex((o) => o.date === dateISO);
      const offEntry = { date: dateISO, shiftTypeId: null, label: "" };
      if (existing >= 0) next.overrides[existing] = offEntry;
      else next.overrides.push(offEntry);
      break;
    }
  }

  await writeState(householdId, next);
}

export interface EditShiftInput {
  shiftTypeId: string;
  label: string;
}

/**
 * Edit a discrete shift entry (ot/override/partner). For template/alt-weekend,
 * this writes an override for the given date with the new shiftTypeId so the
 * change is local to that date (the template itself is edited via writeTemplate).
 */
export async function editShift(
  householdId: string,
  dateISO: string,
  source: ShiftSource,
  updates: EditShiftInput,
): Promise<void> {
  const current = await readState(householdId);
  const next: HouseholdState = {
    ...current,
    ot: [...(current.ot ?? [])],
    overrides: [...(current.overrides ?? [])],
    partner: { ...current.partner, shifts: [...(current.partner?.shifts ?? [])] },
  };

  const label = updates.label?.trim() ?? "";

  switch (source.kind) {
    case "ot":
      if (source.index < 0 || source.index >= next.ot.length) {
        throw new WriteShiftError("This shift no longer exists. Refresh and try again.");
      }
      next.ot[source.index] = { ...next.ot[source.index], shiftTypeId: updates.shiftTypeId, label };
      break;
    case "partner":
      if (source.index < 0 || source.index >= next.partner.shifts.length) {
        throw new WriteShiftError("This shift no longer exists. Refresh and try again.");
      }
      next.partner.shifts[source.index] = {
        ...next.partner.shifts[source.index],
        shiftTypeId: updates.shiftTypeId,
        label,
      };
      break;
    case "override":
    case "template":
    case "alt-weekend": {
      const existing = next.overrides.findIndex((o) => o.date === dateISO);
      const entry = { date: dateISO, shiftTypeId: updates.shiftTypeId, label };
      if (existing >= 0) next.overrides[existing] = entry;
      else next.overrides.push(entry);
      break;
    }
  }

  await writeState(householdId, next);
}
