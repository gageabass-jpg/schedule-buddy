import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { compactTime, type HouseholdState, type OTShift, type PartnerShift, type DependentShift, type Override } from "../state";
import type { ShiftSource } from "../data";
import { crossesMidnight, generateShiftTypeId } from "./writeShiftTypes";

// "dependent-daisy" writes a childcare block on Daisy's timeline
// (state.dependents.daisy.shifts) — a nested field, safe under the iOS
// contract — rather than a work shift on the G/K grids.
export type ShiftTarget = "self-ot" | "partner" | "dependent-daisy";

export interface NewShiftInput {
  householdId: string;
  target: ShiftTarget;
  date: string;        // YYYY-MM-DD
  shiftTypeId: string;
  label?: string;
  /** Free text the household should know, shown as the shift's NOTE. */
  note?: string;
  coworkers?: string;
  /** Optional location for the shift (e.g. "Thomas Hospital"). Stored as a
   *  NESTED field on the shift object, which is safe under the iOS contract
   *  (only new TOP-LEVEL state.main fields are unsafe). */
  where?: string;
  /** One-off custom times ("HH:MM"). When given, a matching basic shift type
   *  is reused (or created) and referenced — so the shift works everywhere
   *  that keys off shiftTypeId with no other changes. */
  customTime?: { start: string; end: string };
  /** Repeat/recurrence: when present and non-empty, one shift entry is pushed
   *  for EACH date in this list within the SAME state/main write (no per-date
   *  read+overwrite race). When absent, the single `date` is used, so existing
   *  callers behave exactly as before. */
  dates?: string[];
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
  const { householdId, target, date } = input;
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
    shiftTypes: [...(current.shiftTypes ?? [])],
    dependents: { ...(current.dependents ?? {}) },
  };

  // Daisy's childcare blocks live on her own timeline; copy that array up
  // front so the per-date loop can push into it.
  if (target === "dependent-daisy") {
    const existing = current.dependents?.daisy;
    next.dependents = {
      ...next.dependents,
      daisy: { name: existing?.name || "Daisy", shifts: [...(existing?.shifts ?? [])] },
    };
  }

  // Resolve the shift type. A custom time reuses a matching basic type or
  // mints a new one, in this same write, so the entry can reference it by id.
  let shiftTypeId = input.shiftTypeId;
  if (input.customTime) {
    const { start, end } = input.customTime;
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      throw new WriteShiftError("Enter a valid custom start and end time.");
    }
    const match = next.shiftTypes.find(
      (s) => s.start === start && s.end === end && !s.sleepHours && !s.preSleepHours,
    );
    if (match) {
      shiftTypeId = match.id;
    } else {
      shiftTypeId = generateShiftTypeId(next.shiftTypes);
      next.shiftTypes.push({
        id: shiftTypeId,
        name: `Custom ${compactTime(start)}-${compactTime(end)}`,
        start,
        end,
        crossesMidnight: crossesMidnight(start, end),
      });
    }
  }
  if (!shiftTypeId) {
    throw new WriteShiftError("Pick a shift type or enter a custom time.");
  }

  // The full date list: an explicit `dates` array (recurrence) or the single
  // `date`. Deduped and filtered to well-formed values so one bad entry can't
  // poison the whole write.
  const rawDates = input.dates && input.dates.length ? input.dates : [date];
  const dateList = Array.from(
    new Set(rawDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))),
  );
  if (!dateList.length) {
    throw new WriteShiftError("Pick a date for the shift.");
  }
  const where = input.where?.trim();
  const note = input.note?.trim();

  for (const d of dateList) {
    if (target === "self-ot") {
      const entry: OTShift = {
        date: d,
        shiftTypeId,
        label,
        ...(input.coworkers ? { coworkers: input.coworkers } : {}),
        ...(note ? { note } : {}),
      };
      // `where` is a nested field not in the strict OTShift type — attach it
      // via a widened reference so it serializes without a type error.
      if (where) (entry as OTShift & { where?: string }).where = where;
      next.ot.push(entry);
    } else if (target === "partner") {
      const entry: PartnerShift = { date: d, shiftTypeId, label, ...(note ? { note } : {}) };
      if (where) (entry as PartnerShift & { where?: string }).where = where;
      next.partner.shifts.push(entry);
    } else {
      // dependent-daisy — a childcare block on Daisy's timeline.
      const entry: DependentShift = { date: d, shiftTypeId, label, ...(note ? { note } : {}) };
      if (where) (entry as DependentShift & { where?: string }).where = where;
      next.dependents!.daisy!.shifts.push(entry);
    }
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
  /** The shift's note. Empty clears it. */
  note: string;
}

/** The entry with its note set, or with the key removed when the note is
 *  empty — Firestore rejects an undefined field. */
function withNote<T extends { note?: string }>(entry: T, note: string): T {
  const { note: _old, ...rest } = entry;
  return (note ? { ...rest, note } : rest) as T;
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

  const note = updates.note?.trim() ?? "";

  switch (source.kind) {
    case "ot":
      if (source.index < 0 || source.index >= next.ot.length) {
        throw new WriteShiftError("This shift no longer exists. Refresh and try again.");
      }
      next.ot[source.index] = withNote({ ...next.ot[source.index], shiftTypeId: updates.shiftTypeId }, note);
      break;
    case "partner":
      if (source.index < 0 || source.index >= next.partner.shifts.length) {
        throw new WriteShiftError("This shift no longer exists. Refresh and try again.");
      }
      next.partner.shifts[source.index] = withNote(
        { ...next.partner.shifts[source.index], shiftTypeId: updates.shiftTypeId },
        note,
      );
      break;
    case "override":
    case "template":
    case "alt-weekend": {
      // Editing a recurring day writes a one-off for that date, which is also
      // where its note lives.
      const existing = next.overrides.findIndex((o) => o.date === dateISO);
      const entry = withNote<Override>(
        { date: dateISO, shiftTypeId: updates.shiftTypeId, label: existing >= 0 ? next.overrides[existing].label : "" },
        note,
      );
      if (existing >= 0) next.overrides[existing] = entry;
      else next.overrides.push(entry);
      break;
    }
  }

  await writeState(householdId, next);
}
