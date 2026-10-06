// Who works when, and when nobody is home — for any household.
//
// The any-household counterparts of buildShiftMap (shared/state.ts) and
// computeOverlapCandidates (shared/computeOverlap.ts), which only know Gage,
// Kaylene and Daisy. Same rules, same numbers: tests/model.test.mjs converts
// legacy records and checks both give identical results.

import {
  coverageWindowsFrom, intersectBlocks, unavailableBlocksFrom,
  type Intersection, type MinuteRange, type OverlapCandidate, type UnavailableBlock,
} from "./computeOverlap";
import type { DatedShift, HouseholdModel, Person } from "./model";
import { fmtDate } from "./schedule";
import { compactTime, customTypeId, type ShiftType, type TemplateSlot } from "./state";

export type PersonShiftSource =
  | { kind: "template" }
  | { kind: "alt-weekend" }
  | { kind: "replace"; shiftId: string }
  | { kind: "add"; shiftId: string };

export interface PersonShift {
  personId: string;
  label: string;
  shiftTypeId?: string;
  source: PersonShiftSource;
  note?: string;
  where?: string;
}

/** date → every shift on it, people in household order. */
export type PersonShiftMap = Record<string, PersonShift[]>;

function dowOf(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** A template slot's type id and chip label (custom slots carry their times). */
function slotShift(slot: TemplateSlot | undefined, types: Map<string, ShiftType>):
  { shiftTypeId: string; label: string } | null {
  if (slot == null) return null;
  if (typeof slot === "string") {
    const t = types.get(slot);
    return t ? { shiftTypeId: slot, label: compactTime(t.start) } : null;
  }
  return { shiftTypeId: customTypeId(slot.start, slot.end), label: compactTime(slot.start) };
}

/** A person's pattern shift on a date: alternate weekend, else weekly slot. */
function patternShift(person: Person, dateISO: string, types: Map<string, ShiftType>):
  { shiftTypeId: string; label: string; kind: "template" | "alt-weekend" } | null {
  const w = person.weekly;
  // Outside the template window neither the week nor the alternate weekend
  // applies; dated shifts still do.
  if (w?.startDate && dateISO < w.startDate) return null;
  if (w?.endDate && dateISO > w.endDate) return null;
  const dow = dowOf(dateISO);

  const alt = person.altWeekend;
  if (alt?.enabled && alt.refSat && (dow === 6 || dow === 0)) {
    const weeks = Math.round((new Date(dateISO).getTime() - new Date(alt.refSat).getTime()) / (7 * 86_400_000));
    const id = weeks % 2 === 0 ? (dow === 6 ? alt.sat : alt.sun) : null;
    const s = slotShift(id, types);
    return s ? { ...s, kind: "alt-weekend" } : null;
  }
  const s = slotShift(w?.days[dow], types);
  return s ? { ...s, kind: "template" } : null;
}

const byOrder = (a: Person, b: Person) => a.order - b.order || a.id.localeCompare(b.id);
const byCreated = (a: DatedShift, b: DatedShift) =>
  (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id);

/** Every shift for every person with a schedule, over [from, to]. */
export function resolveShifts(model: HouseholdModel, from: string, to: string): PersonShiftMap {
  const out: PersonShiftMap = {};
  const types = new Map(model.shiftTypes.map((t) => [t.id, t]));

  const dated = new Map<string, DatedShift[]>();
  for (const s of model.shifts) {
    if (s.date < from || s.date > to) continue;
    const k = `${s.personId}|${s.date}`;
    (dated.get(k) ?? dated.set(k, []).get(k)!).push(s);
  }
  for (const list of dated.values()) list.sort(byCreated);

  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const end = new Date(ty, tm - 1, td);

  for (const person of model.people.filter((p) => p.role !== "child").sort(byOrder)) {
    const employer = person.employer?.trim() || undefined;
    for (const cur = new Date(fy, fm - 1, fd); cur <= end; cur.setDate(cur.getDate() + 1)) {
      const date = fmtDate(cur.getFullYear(), cur.getMonth(), cur.getDate());
      const todays = dated.get(`${person.id}|${date}`) ?? [];
      const push = (s: PersonShift) => (out[date] ??= []).push(s);

      const replace = todays.find((s) => s.mode === "replace");
      if (replace) {
        const t = replace.shiftTypeId ? types.get(replace.shiftTypeId) : undefined;
        if (t) push(clean({
          personId: person.id, label: compactTime(t.start), shiftTypeId: t.id,
          source: { kind: "replace", shiftId: replace.id },
          note: replace.note, where: replace.where?.trim() || employer,
        }));
      } else {
        const p = patternShift(person, date, types);
        if (p) push(clean({
          personId: person.id, label: p.label, shiftTypeId: p.shiftTypeId,
          source: { kind: p.kind }, where: employer,
        }));
      }

      for (const s of todays) {
        if (s.mode !== "add") continue;
        // A typed shift shows its start time; an untyped one (a class) its label.
        const t = s.shiftTypeId ? types.get(s.shiftTypeId) : undefined;
        const label = s.shiftTypeId ? (t ? compactTime(t.start) : null) : (s.label || null);
        if (!label) continue;
        push(clean({
          personId: person.id, label, shiftTypeId: s.shiftTypeId ?? undefined,
          source: { kind: "add", shiftId: s.id },
          note: s.note || s.coworkers || undefined, where: s.where?.trim() || employer,
        }));
      }
    }
  }
  return out;
}

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as Array<keyof T>) if (o[k] === undefined) delete o[k];
  return o;
}

/** Custom template times become synthetic shift types the engine can look up. */
function withCustomTypes(model: HouseholdModel): { shiftTypes: ShiftType[] } {
  const have = new Set(model.shiftTypes.map((t) => t.id));
  const shiftTypes = model.shiftTypes.slice();
  for (const p of model.people) {
    for (const slot of p.weekly?.days ?? []) {
      if (!slot || typeof slot !== "object") continue;
      const id = customTypeId(slot.start, slot.end);
      if (have.has(id)) continue;
      have.add(id);
      const [sh, sm] = slot.start.split(":").map(Number);
      const [eh, em] = slot.end.split(":").map(Number);
      shiftTypes.push({ id, name: id, start: slot.start, end: slot.end, crossesMidnight: eh * 60 + em <= sh * 60 + sm });
    }
  }
  return { shiftTypes };
}

/**
 * The windows nobody can watch the kids: every adult is at work, travelling or
 * asleep. With two adults this is the familiar two-parent overlap; with one it
 * is simply their time away; with three or more, all of them at once.
 * Households without childcare get nothing.
 */
export function coverageGaps(model: HouseholdModel, shifts: PersonShiftMap): OverlapCandidate[] {
  if (!model.root.childcare) return [];
  // The adults the kids can be left with (a roommate, say, isn't one).
  const adults = model.people.filter((p) => p.role === "adult" && p.watchesKids !== false).sort(byOrder);
  if (adults.length === 0) return [];
  const engine = withCustomTypes(model);

  const dates = new Set(Object.keys(shifts));
  for (const d of Object.keys(shifts)) {
    const [y, m, dd] = d.split("-").map(Number);
    const next = new Date(y, m - 1, dd + 1);
    dates.add(fmtDate(next.getFullYear(), next.getMonth(), next.getDate()));
  }

  const out: OverlapCandidate[] = [];
  for (const date of Array.from(dates).sort()) {
    const lanes: UnavailableBlock[][] = adults.map((a) => unavailableBlocksFrom(
      date,
      (d) => (shifts[d] ?? []).filter((s) => s.personId === a.id).map((s) => s.shiftTypeId),
      engine,
    ));
    if (lanes.some((l) => l.length === 0)) continue;

    // Intersect lane by lane: what's left is time every adult is away.
    let hits: Intersection[] = lanes[0].map((b) => ({
      startMin: b.startMin, endMin: b.endMin,
      reason: b.kind === "work" ? "both-working" : "both-sleeping",
    }));
    for (const lane of lanes.slice(1)) {
      const next: Intersection[] = [];
      for (const h of hits) for (const b of lane) {
        const ix = intersectBlocks(h, b);
        if (ix) next.push(ix);
      }
      hits = next;
    }
    out.push(...coverageWindowsFrom(date, hits));
  }
  return out;
}

/** A caregiver's own commitments on a date (classes, work): time they can't
 *  cover. Only shifts with known times count. */
export function caregiverDayRanges(model: HouseholdModel, shifts: PersonShiftMap, personId: string, date: string): MinuteRange[] {
  const engine = withCustomTypes(model);
  const types = new Map(engine.shiftTypes.map((t) => [t.id, t]));
  const ranges: MinuteRange[] = [];
  for (const s of shifts[date] ?? []) {
    if (s.personId !== personId || !s.shiftTypeId) continue;
    const t = types.get(s.shiftTypeId);
    if (!t) continue;
    const [sh, sm] = t.start.split(":").map(Number);
    const [eh, em] = t.end.split(":").map(Number);
    const startMin = sh * 60 + sm;
    let endMin = eh * 60 + em;
    if (t.crossesMidnight || endMin <= startMin) endMin += 24 * 60;
    ranges.push({ startMin, endMin });
  }
  ranges.sort((a, b) => a.startMin - b.startMin);
  const merged: MinuteRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.startMin <= last.endMin) last.endMin = Math.max(last.endMin, r.endMin);
    else merged.push({ ...r });
  }
  return merged;
}
