// Does a household on the any-household model draw exactly what its legacy
// record drew? The migration runs this before it switches a household over,
// and tests/model.test.mjs runs it on hundreds of households.
//
// Compared, over a window of dates:
//   - the calendar: every chip — person, label, shift type, source, note, where
//   - the coverage gaps
//   - the caregiver's unavailable time
// and, for a model read back from the database, that it holds exactly the
// records the conversion produced.

import { computeOverlapCandidates, daisyDayRanges } from "./computeOverlap";
import type { LegacyPeople } from "./fromLegacy";
import type { HouseholdModel } from "./model";
import { caregiverDayRanges, coverageGaps, resolveShifts } from "./resolve";
import { fmtDate } from "./schedule";
import { buildShiftMap, expandCustomTemplateTypes, type HouseholdState } from "./state";

/** At most this many of each kind of problem, so one widespread difference
 *  can't hide another. */
const MAX_PER_KIND = 10;

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "undefined";
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return fmtDate(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

const SOURCE: Record<string, string> = {
  template: "template", "alt-weekend": "alt-weekend", override: "replace", ot: "add", partner: "add",
};

/** The two engines side by side on [from, to]. Returns what differs (empty = same). */
export function compareDrawing(state: HouseholdState, model: HouseholdModel, people: LegacyPeople,
  from: string, to: string): string[] {
  const problems: string[] = [];
  const counts = new Map<string, number>();
  const note = (m: string) => {
    const kind = m.replace(/ on .*$/, "");
    const n = counts.get(kind) ?? 0;
    counts.set(kind, n + 1);
    if (n < MAX_PER_KIND) problems.push(m);
  };
  const expanded = expandCustomTemplateTypes(state);
  const caregiver = model.people.find((p) => p.role === "caregiver")?.id;
  const whoToId: Record<string, string | undefined> = { G: people.G, K: people.K, D: people.D };

  // Calendar.
  const legacyMap = buildShiftMap(expanded, from, to);
  const newMap = resolveShifts(model, from, to);
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const a = (legacyMap[d] ?? []).map((s) => ({
      personId: whoToId[s.who], label: s.label, shiftTypeId: s.shiftTypeId,
      // Legacy caregiver shifts carry no source (they were display-only).
      source: s.who === "D" || !s.source ? undefined : SOURCE[s.source.kind], note: s.note, where: s.where,
    }));
    const b = (newMap[d] ?? []).map((s) => ({
      personId: s.personId, label: s.label, shiftTypeId: s.shiftTypeId,
      source: s.personId === caregiver ? undefined : s.source.kind, note: s.note, where: s.where,
    }));
    if (stable(a) !== stable(b)) note(`calendar differs on ${d}`);
  }

  // Coverage gaps, away from the window's edges (the legacy map also lists
  // extras outside the window, which reach a day either side).
  const inner = (c: { date: string }) => c.date > from && c.date < addDays(to, -1);
  const legacyGaps = computeOverlapCandidates(legacyMap, expanded).filter(inner);
  const newGaps = coverageGaps(model, newMap).filter(inner);
  if (stable(legacyGaps) !== stable(newGaps)) {
    const dates = new Set([...legacyGaps, ...newGaps].map((g) => g.date));
    for (const d of [...dates].sort()) {
      const a = legacyGaps.filter((g) => g.date === d);
      const b = newGaps.filter((g) => g.date === d);
      if (stable(a) !== stable(b)) note(`coverage gaps differ on ${d}`);
    }
  }

  // Caregiver time.
  if (people.D) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (stable(caregiverDayRanges(model, newMap, people.D, d)) !== stable(daisyDayRanges(expanded, d))) {
        note(`caregiver time differs on ${d}`);
      }
    }
  }
  return problems;
}

/** Every record of `expected` is in `actual` with the same content, and nothing more. */
export function compareRecords(expected: HouseholdModel, actual: HouseholdModel): string[] {
  const problems: string[] = [];
  const note = (m: string) => { if (problems.length < MAX_PER_KIND * 3) problems.push(m); };
  const keys = Object.keys(expected).filter((k) => Array.isArray((expected as unknown as Record<string, unknown>)[k]));
  for (const key of keys) {
    const index = (m: HouseholdModel) => new Map(((m as unknown as Record<string, Array<{ id: string }>>)[key] ?? [])
      .map((r) => [r.id, stable(r)]));
    const want = index(expected);
    const got = index(actual);
    for (const [id, v] of want) {
      if (!got.has(id)) note(`${key}/${id} is missing`);
      else if (got.get(id) !== v) note(`${key}/${id} differs`);
    }
    for (const id of got.keys()) if (!want.has(id)) note(`${key}/${id} shouldn't be there`);
  }
  if (stable(expected.settings) !== stable(actual.settings)) note("settings differ");
  return problems;
}
