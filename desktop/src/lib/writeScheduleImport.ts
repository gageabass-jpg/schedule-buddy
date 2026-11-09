import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { buildShiftMap, compactTime } from "../state";
import type {
  ShiftType,
  HouseholdState,
  OTShift,
  PartnerShift,
  DependentShift,
  ImportRecord,
} from "../state";
import type { ImportTarget } from "../scheduleImports";
import { readHouseholdState, writeHouseholdState } from "./householdState";

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
  /** Days to mark on call (partner imports only): the asterisks on her
   *  schedule. Merged into partner.onCall; a day can be on call with no shift,
   *  so these can arrive without any rows. */
  onCallDates?: string[];
  monthCovered?: string;
  /** Types the review table asked to create, from hours the photo showed that
   *  nothing in the catalog matched. Added before the rows are validated. */
  newShiftTypes?: ShiftType[];
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
  const onCallDates = target === "partner" ? [...new Set(input.onCallDates ?? [])] : [];
  if (!rows.length && !onCallDates.length) throw new WriteImportError("Nothing to save.");

  let current: HouseholdState | null;
  try {
    current = await readHouseholdState(householdId);
  } catch (e) {
    throw new WriteImportError("Couldn't read the household schedule.", e);
  }
  if (!current) {
    throw new WriteImportError("Schedule document doesn't exist yet — open the iOS app once to initialize it.");
  }

  // Types the user asked for go in first, so rows pointing at them validate.
  // Anything already in the catalog with the same hours is reused rather than
  // duplicated — re-importing shouldn't grow the list every time.
  const catalog: ShiftType[] = [...(current.shiftTypes ?? [])];
  for (const t of input.newShiftTypes ?? []) {
    if (!catalog.some((x) => x.start === t.start && x.end === t.end)) catalog.push(t);
  }

  // Defensive: refuse rows whose shiftTypeId isn't in the catalog. Otherwise
  // buildShiftMap will silently drop them and they'd never render.
  const validIds = new Set(catalog.map((s) => s.id));
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
    shiftTypes: catalog,
    ot: [...(current.ot ?? [])],
    partner: {
      ...current.partner,
      shifts: [...(current.partner?.shifts ?? [])],
      ...(current.partner?.onCall ? { onCall: [...current.partner.onCall] } : {}),
    },
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
      if (onCallDates.length) {
        const have = new Set((next.partner.onCall ?? []).map((o) => o.date));
        next.partner.onCall = [
          ...(next.partner.onCall ?? []),
          ...onCallDates.filter((d) => !have.has(d)).map((date) => ({ date })),
        ];
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
        daisy: { name: existing.name || "Caregiver", shifts: [...kept, ...additions] },
      };
      break;
    }
  }

  // The last day of shifts in this upload: where its schedule period ends.
  const lastShiftDate = [...dates].sort().pop();
  const record: ImportRecord = {
    id: newId(),
    scheduleId,
    importedAt: Date.now(),
    importedBy: auth.currentUser?.uid,
    monthCovered: input.monthCovered,
    addedDates: rows.map((r) => r.date),
    noteCount: rows.length,
    ...(lastShiftDate ? { lastShiftDate } : {}),
  };
  next.imports!.push(record);

  try {
    await writeHouseholdState(householdId, next);
  } catch (e) {
    throw new WriteImportError("Couldn't save the import. Check your connection.", e);
  }
  return record;
}


/** One day the user chose to take from the sheet. */
export interface SheetChange {
  date: string;
  /** "set": the sheet's shift replaces whatever the app has. "remove": the
   *  sheet has no shift, so the app's goes. */
  action: "set" | "remove";
  /** The sheet's shift, for "set". */
  shift?: { start: string; end: string; label: string; note?: string };
}

export interface ApplyComparisonInput {
  householdId: string;
  scheduleId: string;
  target: ImportTarget;
  changes: SheetChange[];
  /** Kaylene's on-call days to add and to take off. */
  onCall?: { add: string[]; remove: string[] };
  monthCovered?: string;
  /** The last day the sheet has a shift for this person. `changes` only holds
   *  the days that differed, so the end of the period can't be read from them. */
  lastShiftDate?: string;
}

/**
 * Apply the days a comparison found, in one write. For each day the app's own
 * shifts for that person are cleared first, wherever they came from (a dated
 * entry, a one-off day, or a recurring day, which is switched off for just that
 * date), then the sheet's shift is added when there is one.
 */
export async function applyScheduleComparison(input: ApplyComparisonInput): Promise<{ set: number; removed: number; onCall: number }> {
  const { householdId, scheduleId, target, changes } = input;
  const onCallAdd = target === "partner" ? [...new Set(input.onCall?.add ?? [])] : [];
  const onCallRemove = target === "partner" ? new Set(input.onCall?.remove ?? []) : new Set<string>();
  if (!changes.length && !onCallAdd.length && !onCallRemove.size) throw new WriteImportError("Nothing to change.");

  let current: HouseholdState | null;
  try {
    current = await readHouseholdState(householdId);
  } catch (e) {
    throw new WriteImportError("Couldn't read the household schedule.", e);
  }
  if (!current) throw new WriteImportError("Schedule document doesn't exist yet — open the iOS app once to initialize it.");

  const next: HouseholdState = {
    ...current,
    shiftTypes: [...(current.shiftTypes ?? [])],
    ot: [...(current.ot ?? [])],
    overrides: [...(current.overrides ?? [])],
    partner: {
      ...current.partner,
      shifts: [...(current.partner?.shifts ?? [])],
      ...(current.partner?.onCall ? { onCall: [...current.partner.onCall] } : {}),
    },
    dependents: { ...(current.dependents ?? {}) },
    imports: [...(current.imports ?? [])],
  };

  // Which kinds of entry make Gage's day today, so a recurring one can be
  // switched off for that date after the dated ones are dropped.
  const dates = changes.map((c) => c.date).sort();
  const shown = dates.length ? buildShiftMap(current, dates[0], dates[dates.length - 1]) : {};

  // The type for a shift's hours: an existing one, or a new one named for the
  // sheet's own text so it's recognisable in the catalog.
  const typeFor = (sh: { start: string; end: string; label: string }): string => {
    const found = next.shiftTypes.find((t) => t.start === sh.start && t.end === sh.end);
    if (found) return found.id;
    const id = `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    next.shiftTypes.push({
      id,
      name: (sh.label || `${compactTime(sh.start)}-${compactTime(sh.end)}`).trim(),
      start: sh.start,
      end: sh.end,
      crossesMidnight: sh.end <= sh.start,
    });
    return id;
  };

  const touched = new Set(dates);
  let set = 0, removed = 0;

  if (target === "dependent-daisy") {
    const existing = next.dependents?.daisy ?? { name: "Daisy", shifts: [] };
    next.dependents = {
      ...next.dependents,
      daisy: { name: existing.name || "Caregiver", shifts: (existing.shifts ?? []).filter((x) => !touched.has(x.date)) },
    };
  } else if (target === "self-ot") {
    next.ot = next.ot.filter((o) => !touched.has(o.date));
  } else {
    next.partner.shifts = next.partner.shifts.filter((x) => !touched.has(x.date));
  }

  for (const c of changes) {
    if (target === "self-ot") {
      const kinds = (shown[c.date] ?? []).filter((x) => x.who === "G").map((x) => x.source?.kind);
      if (kinds.some((k) => k === "template" || k === "alt-weekend" || k === "override")) {
        const off = { date: c.date, shiftTypeId: null, label: "" };
        const at = next.overrides.findIndex((o) => o.date === c.date);
        if (at >= 0) next.overrides[at] = off; else next.overrides.push(off);
      }
    }
    if (c.action === "remove" || !c.shift) { removed++; continue; }
    const shiftTypeId = typeFor(c.shift);
    const note = c.shift.note;
    if (target === "self-ot") {
      next.ot.push({ date: c.date, shiftTypeId, label: c.shift.label, ...(note ? { note, coworkers: note } : {}) } as OTShift);
    } else if (target === "partner") {
      next.partner.shifts.push({ date: c.date, shiftTypeId, label: c.shift.label, ...(note ? { note } : {}) } as PartnerShift);
    } else {
      next.dependents!.daisy!.shifts.push({ date: c.date, shiftTypeId, label: c.shift.label, ...(note ? { note } : {}) } as DependentShift);
    }
    set++;
  }

  if (target === "partner" && (onCallAdd.length || onCallRemove.size)) {
    const kept = (next.partner.onCall ?? []).filter((o) => !onCallRemove.has(o.date));
    const have = new Set(kept.map((o) => o.date));
    next.partner.onCall = [...kept, ...onCallAdd.filter((d) => !have.has(d)).map((date) => ({ date }))];
  }

  next.imports!.push({
    id: newId(),
    scheduleId,
    importedAt: Date.now(),
    importedBy: auth.currentUser?.uid,
    monthCovered: input.monthCovered,
    addedDates: changes.filter((c) => c.action === "set").map((c) => c.date),
    noteCount: set,
    ...(input.lastShiftDate ? { lastShiftDate: input.lastShiftDate } : {}),
  });

  try {
    await writeHouseholdState(householdId, next);
  } catch (e) {
    throw new WriteImportError("Couldn't save the changes. Check your connection.", e);
  }
  return { set, removed, onCall: onCallAdd.length + onCallRemove.size };
}
