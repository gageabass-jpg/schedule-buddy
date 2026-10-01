/**
 * Named schedule import slots — the rows under "Schedules" in the sidebar.
 *
 * Each row writes parsed shifts to a different place in state/main:
 *   - gage-nights      → state.ot[]                  (additive OT for self)
 *   - kaylene-nights   → state.partner.shifts[]      (partner's dated shifts)
 *   - daisy-school     → state.dependents.daisy.shifts[]  (new; iOS round-trips)
 */

export type ImportTarget = "self-ot" | "partner" | "dependent-daisy";

export interface ScheduleImportDef {
  id: string;
  label: string;
  target: ImportTarget;
  /** Display name for the person whose schedule this is. */
  personLabel: string;
  /** Hint to the parser describing what kind of schedule to expect. */
  parserHint: string;
}

export const SCHEDULE_IMPORTS: ScheduleImportDef[] = [
  {
    id: "gage-nights",
    label: "Gage",
    target: "self-ot",
    personLabel: "Gage",
    parserHint:
      "This is a hospital nights schedule for Gage. Extract every shift with its date and the shift's start time / shift code (e.g. 7p, 11p, N12).",
  },
  {
    id: "kaylene-nights",
    label: "Kaylene",
    target: "partner",
    personLabel: "Kaylene",
    parserHint:
      "This is a hospital nights schedule for Kaylene. Extract every shift with its date and the shift's start time / shift code.",
  },
  {
    id: "daisy-school",
    label: "Daisy",
    target: "dependent-daisy",
    personLabel: "Daisy",
    parserHint:
      "This is Daisy's college class schedule. Extract every date she has class. A simple 'class' label is fine; flag half-days or no-class days separately if visible.",
  },
];

export function findScheduleImport(id: string): ScheduleImportDef | undefined {
  return SCHEDULE_IMPORTS.find((s) => s.id === id);
}

/**
 * An import slot for this household: its people's names, and — for any
 * household but the one the hints above were tuned for — a plain hint.
 */
export function importFor(
  def: ScheduleImportDef,
  look: { names: { G: string; K: string; D: string }; familyPhotos: boolean },
): ScheduleImportDef {
  if (look.familyPhotos) return def;
  const name = def.target === "partner" ? look.names.K : def.target === "dependent-daisy" ? look.names.D : look.names.G;
  const parserHint = def.target === "dependent-daisy"
    ? `This is ${name}'s schedule. Extract every date they're busy, with the start and end times where shown.`
    : `This is a work schedule for ${name}. Extract every shift with its date and the shift's start time / shift code.`;
  return { ...def, label: name, personLabel: name, parserHint };
}
