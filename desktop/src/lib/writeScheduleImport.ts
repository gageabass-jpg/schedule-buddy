import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import type {
  HouseholdState,
  OTShift,
  PartnerShift,
  DependentShift,
  ImportRecord,
} from "../state";
import type { ImportTarget } from "../scheduleImports";

export class WriteImportError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WriteImportError";
  }
}

/**
 * One row the user has confirmed in the review table. shiftTypeId is required
 * by the time we save — the UI prompts the user to map any null rows or skip
 * them.
 */
export interface ImportRow {
  date: string;            // YYYY-MM-DD
  shiftTypeId: string;
  label: string;
  /** Whatever else the source cell said — carried onto the saved shift. */
  note?: string;
}

export interface WriteImportInput {
  householdId: string;
  scheduleId: string;
  target: ImportTarget;
  rows: ImportRow[];
  monthCovered?: string;
}

function newId(): string {
  return `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Replace any existing shifts at the same target+date with the new entries.
 * (Re-importing the same month overwrites instead of duplicating.) Appends
 * an audit row to state.imports so the user can trace where shifts came from.
 */
export async function writeScheduleImport(input: WriteImportInput): Promise<ImportRecord> {
  const { householdId, scheduleId, target, rows } = input;
  if (!rows.length) throw new WriteImportError("Nothing to save.");

  const ref = doc(db, "households", householdId, "state", "main");
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (e) {
    throw new WriteImportError("Couldn't read the household schedule.", e);
  }
  if (!snap.exists()) {
    throw new WriteImportError("Schedule document doesn't exist yet — open the iOS app once to initialize it.");
  }
  const current = snap.data() as HouseholdState;

  // Defensive: refuse rows whose shiftTypeId isn't in the catalog. Otherwise
  // buildShiftMap will silently drop them and they'd never render.
  const validIds = new Set((current.shiftTypes ?? []).map((s) => s.id));
  const bad = rows.filter((r) => !validIds.has(r.shiftTypeId));
  if (bad.length > 0) {
    const list = bad.slice(0, 3).map((r) => `${r.date} → ${r.shiftTypeId}`).join(", ");
    throw new WriteImportError(
      `${bad.length} row${bad.length === 1 ? "" : "s"} reference a shift type that doesn't exist (${list}${bad.length > 3 ? "…" : ""}). Map them to a real type in the review table first.`,
    );
  }

  const dates = new Set(rows.map((r) => r.date));

  const next: HouseholdState = {
    ...current,
    ot: [...(current.ot ?? [])],
    partner: { ...current.partner, shifts: [...(current.partner?.shifts ?? [])] },
    dependents: { ...(current.dependents ?? {}) },
    imports: [...(current.imports ?? [])],
  };

  switch (target) {
    case "self-ot": {
      next.ot = next.ot.filter((o) => !dates.has(o.date));
      for (const r of rows) {
        const entry: OTShift = {
          date: r.date, shiftTypeId: r.shiftTypeId, label: r.label,
          ...(r.note ? { note: r.note, coworkers: r.note } : {}),
        };
        next.ot.push(entry);
      }
      break;
    }
    case "partner": {
      next.partner.shifts = next.partner.shifts.filter((s) => !dates.has(s.date));
      for (const r of rows) {
        const entry: PartnerShift = {
          date: r.date, shiftTypeId: r.shiftTypeId, label: r.label,
          ...(r.note ? { note: r.note } : {}),
        };
        next.partner.shifts.push(entry);
      }
      break;
    }
    case "dependent-daisy": {
      const existing = next.dependents?.daisy ?? { name: "Daisy", shifts: [] };
      const kept = (existing.shifts ?? []).filter((s) => !dates.has(s.date));
      const additions: DependentShift[] = rows.map((r) => ({
        date: r.date,
        shiftTypeId: r.shiftTypeId,
        label: r.label,
        ...(r.note ? { note: r.note } : {}),
      }));
      next.dependents = {
        ...next.dependents,
        daisy: { name: existing.name || "Daisy", shifts: [...kept, ...additions] },
      };
      break;
    }
  }

  const record: ImportRecord = {
    id: newId(),
    scheduleId,
    importedAt: Date.now(),
    importedBy: auth.currentUser?.uid,
    monthCovered: input.monthCovered,
    addedDates: rows.map((r) => r.date),
    noteCount: rows.length,
  };
  next.imports!.push(record);

  try {
    await setDoc(ref, next);
  } catch (e) {
    throw new WriteImportError("Couldn't save the import. Check your connection.", e);
  }
  return record;
}
