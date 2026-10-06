// The any-household model back into the legacy state/main shape — the bridge
// that lets screens written for state/main run on a migrated household while
// they move over one at a time (docs/data-model.md, step 3).
//
// The legacy shape has three slots: the first adult is "self" (G), the second
// the partner (K), the first caregiver D. Anyone else, and anything the slots
// can't express, is left out of the legacy view — never deleted: an edit made
// through the bridge writes only the records it changed (bridgeWrites in
// store.ts), so what the view leaves out stays as it is.
//
// Record ids ride along as `_id` on legacy list entries, and fromLegacy reads
// them back, so model → legacy → model keeps every id.

import type { HouseholdModel, Person } from "./model";
import { fromLegacy, type LegacyPeople } from "./fromLegacy";
import { bridgeWrites, type WriteOp } from "./store";
import type {
  CoverageRequest, DependentShift, EventWho, HouseholdMeta, HouseholdState, OTOpportunity, OTShift,
  Override, PartnerShift,
} from "./state";

export interface LegacyView {
  state: HouseholdState;
  people: LegacyPeople;
  /** Things in the model the legacy view can't show. */
  hidden: string[];
}

const byOrder = (a: Person, b: Person) => a.order - b.order || a.id.localeCompare(b.id);

/** Drop undefined fields, as a stored document would. */
function clean<T extends object>(o: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

export function toLegacy(model: HouseholdModel): LegacyView {
  const hidden: string[] = [];
  const adults = model.people.filter((p) => p.role === "adult").sort(byOrder);
  const caregivers = model.people.filter((p) => p.role === "caregiver").sort(byOrder);
  // "Self" is the first adult; the partner slot takes the first partner (a
  // person with no relation is from before relations, so a partner too) —
  // never a roommate or other adult, whatever order they were added in.
  const g = adults[0];
  const k = adults.find((p) => p !== g && (p.relation === "partner" || p.relation === undefined));
  const d = caregivers[0];
  for (const p of [...adults.filter((a) => a !== g && a !== k), ...caregivers.slice(1)]) {
    hidden.push(`${p.name} (${p.relation ?? p.role}) has no legacy slot`);
  }

  const people: LegacyPeople = { G: g?.id ?? "", ...(k ? { K: k.id } : {}), ...(d ? { D: d.id } : {}) };
  const slotOf = new Map<string, "G" | "K" | "D">();
  if (g) slotOf.set(g.id, "G");
  if (k) slotOf.set(k.id, "K");
  if (d) slotOf.set(d.id, "D");

  const overrides: Override[] = [];
  const ot: OTShift[] = [];
  const partnerShifts: PartnerShift[] = [];
  const daisyShifts: DependentShift[] = [];
  const sorted = model.shifts.slice().sort((a, b) =>
    a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id));
  for (const s of sorted) {
    const slot = slotOf.get(s.personId);
    const common = { date: s.date, note: s.note, where: s.where, _id: s.id };
    if (slot === "G" && s.mode === "replace") {
      overrides.push(clean({ ...common, shiftTypeId: s.shiftTypeId, label: s.label ?? "" }) as Override);
    } else if (slot === "G" && s.shiftTypeId) {
      ot.push(clean({
        ...common, shiftTypeId: s.shiftTypeId, label: s.label ?? "", coworkers: s.coworkers,
        _overtime: s.overtime ? undefined : false,
      }) as OTShift);
    } else if (slot === "K" && s.mode === "add" && s.shiftTypeId) {
      partnerShifts.push(clean({ ...common, shiftTypeId: s.shiftTypeId, label: s.label ?? "" }) as PartnerShift);
    } else if (slot === "D" && s.mode === "add") {
      daisyShifts.push(clean({ ...common, shiftTypeId: s.shiftTypeId ?? undefined, label: s.label ?? "" }) as DependentShift);
    } else if (slot) {
      hidden.push(`shift ${s.id} (${s.mode}) has no legacy place`);
    }
  }

  const whoOf = (pid: string | undefined): EventWho => {
    if (!pid) return "family";
    const slot = slotOf.get(pid);
    if (slot === "G" || slot === "K") return slot;
    if (slot === "D") return "Daisy";
    hidden.push(`an event for ${pid} shows as a family event`);
    return "family";
  };

  const weekly = g?.weekly;
  const state = clean({
    shiftTypes: model.shiftTypes,
    // Readers that still look at the old field get the same week, custom
    // times aside (the old field only held preset ids).
    template: weekly ? weekly.days.map((slot) => (typeof slot === "string" ? slot : null)) : [null, null, null, null, null, null, null],
    templateEndDate: weekly?.endDate,
    alt: g?.altWeekend ?? { enabled: false, refSat: "", sat: null, sun: null },
    ot,
    otOpportunities: model.shiftOffers.filter((o) => o.personId === g?.id).map((o) => clean({
      date: o.date, shiftTypeId: o.shiftTypeId, coworkers: o.coworkers, _id: o.id,
    }) as OTOpportunity),
    overrides,
    range: model.settings.range ?? { from: "", to: "" },
    calName: model.settings.calName ?? "",
    calView: "schedule" as const,
    selfName: g?.name ?? "",
    partner: { name: k?.name ?? "", shifts: partnerShifts },
    caregiverBlackouts: d?.blackouts ?? [],
    ui: { calLayout: "month", viewMonth: "", viewWeekStart: "" },
    dependents: d ? { daisy: { name: d.name, shifts: daisyShifts } } : undefined,
    imports: model.imports as unknown as HouseholdState["imports"],
    events: model.events.map((e) => {
      const { personId, ...rest } = e;
      return { ...rest, who: whoOf(personId) };
    }),
    householdName: model.root.name,
    employers: clean({ G: g?.employer, K: k?.employer, D: d?.employer }),
    timeZone: model.root.timeZone,
    shareEnabled: model.settings.shareEnabled,
    shareToken: model.settings.shareToken,
    coverageRequests: model.coverageRequests as CoverageRequest[],
    caregiverRequests: model.caregiverRequests,
    childcareOff: model.caregiverOff.filter((c) => c.personId === d?.id).map((c) => clean({ date: c.date, label: c.label, _id: c.id })),
    paydays: clean({ G: g?.payday, K: k?.payday }),
    occasions: model.occasions,
    scheduleBlocks: model.scheduleBlocks.map((b) => ({ ...b, createdAt: b.createdAt, createdBy: b.createdBy })),
    weeklyTemplates: clean({ G: g?.weekly, K: k?.weekly, daisy: d?.weekly }),
    _migrations: model.settings.migrations ?? [],
  }) as HouseholdState;

  return { state, people, hidden };
}

/** Plain JSON, as a stored document would be. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * One edit of the legacy view → the record writes that make it (see
 * bridgeWrites). `base` is the view the edit started from, `next` the result;
 * `live` is the household as stored now.
 */
export function bridgeEdit(hid: string, live: HouseholdModel, meta: Omit<HouseholdMeta, "id">,
  base: HouseholdState, next: HouseholdState): WriteOp[] {
  const { people } = toLegacy(live);
  const before = fromLegacy(hid, plain(base) as HouseholdState & Record<string, unknown>, meta, { people }).model;
  const after = fromLegacy(hid, plain(next) as HouseholdState & Record<string, unknown>, meta, { people }).model;
  return bridgeWrites(hid, live, before, after);
}
