// Convert the legacy state/main record into the any-household model
// (shared/model.ts, docs/data-model.md).
//
// Pure: no Firebase. The migration reads state/main and the household root,
// calls this, and writes what it returns. tests/model.test.mjs proves the
// result draws the same calendar and the same coverage gaps as the record it
// came from.
//
// Nothing is dropped silently. Every top-level field is either mapped,
// listed in PER_DEVICE (screen state that was never household data), or
// reported in `notes` so the migration log shows it.

import type {
  CoverageRequestDoc, DatedShift, HouseholdModel, ImportDoc, LifeEvent, Person,
  ScheduleBlockDoc,
} from "./model";
import { SCHEMA_VERSION } from "./model";
import type { EventWho, HouseholdMeta, HouseholdState } from "./state";

/** Where each legacy slot went, so callers can translate old references. */
export interface LegacyPeople { G: string; K?: string; D?: string }

export interface ConvertResult {
  model: HouseholdModel;
  people: LegacyPeople;
  /** Import photos held inline as data URLs; the migration uploads each to
   *  Storage and sets the import's photoPath. */
  photos: Array<{ importId: string; dataUrl: string }>;
  /** Anything worth reading in the migration log. */
  notes: string[];
}

/** Screen state that lived in state/main but belongs to one device. */
export const PER_DEVICE = ["calView", "ui", "activeTab"] as const;

const MAPPED = new Set([
  "shiftTypes", "template", "alt", "ot", "otOpportunities", "overrides", "range",
  "calName", "selfName", "partner", "caregiverBlackouts", "dependents", "imports",
  "events", "householdName", "employers", "timeZone", "shareEnabled", "shareToken",
  "coverageRequests", "caregiverRequests", "childcareOff", "paydays", "occasions",
  "scheduleBlocks", "templateEndDate", "weeklyTemplates", "_migrations",
  ...PER_DEVICE,
]);

/** Short stable hash, so re-running the conversion gives the same ids. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const list = <T>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);
const trimmed = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Drop undefined fields: Firestore rejects them. */
function clean<T extends object>(o: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

export function fromLegacy(
  householdId: string,
  state: HouseholdState & Record<string, unknown>,
  meta: Omit<HouseholdMeta, "id">,
): ConvertResult {
  const notes: string[] = [];
  const pid = (slot: string) => `p_${hash(`${householdId}:${slot}`)}`;

  for (const key of Object.keys(state)) {
    if (!MAPPED.has(key)) notes.push(`state/main field "${key}" has no place in the new model and was not copied`);
  }

  // ── People ────────────────────────────────────────────────────────────────
  // The legacy record has three fixed slots. Each account is matched to one by
  // its household role, then by name when a role is shared.
  const uidFor = (role: "admin" | "partner" | "supporting", name?: string): string | undefined => {
    const uids = meta.memberUids.filter((u) => meta.roles[u] === role);
    if (uids.length <= 1) return uids[0];
    const first = name?.trim().split(/\s+/)[0]?.toLowerCase();
    return uids.find((u) => first && (meta.memberNames[u] ?? "").toLowerCase().startsWith(first)) ?? uids[0];
  };

  const people: Person[] = [];
  const legacy: LegacyPeople = { G: pid("G") };
  const wt = state.weeklyTemplates ?? {};

  const selfWeekly = wt.G ?? (Array.isArray(state.template)
    ? clean({ days: state.template, endDate: state.templateEndDate })
    : undefined);
  if (wt.G && Array.isArray(state.template)) {
    notes.push("legacy template/templateEndDate superseded by weeklyTemplates.G and not copied");
  }
  const selfName = trimmed(state.selfName) ?? "Me";
  people.push(clean({
    id: legacy.G,
    name: selfName,
    role: "adult" as const,
    uid: uidFor("admin", selfName) ?? meta.createdBy,
    color: "teal",
    order: 0,
    employer: trimmed(state.employers?.G),
    payday: state.paydays?.G,
    weekly: selfWeekly,
    altWeekend: state.alt ? clean({
      enabled: !!state.alt.enabled, refSat: state.alt.refSat, sat: state.alt.sat ?? null, sun: state.alt.sun ?? null,
    }) : undefined,
  }));

  const partnerName = trimmed(state.partner?.name);
  if (partnerName || wt.K || list(state.partner?.shifts).length || state.paydays?.K || state.employers?.K) {
    legacy.K = pid("K");
    people.push(clean({
      id: legacy.K,
      name: partnerName ?? "Partner",
      role: "adult" as const,
      uid: uidFor("partner", partnerName),
      color: "clay",
      order: 1,
      employer: trimmed(state.employers?.K),
      payday: state.paydays?.K,
      weekly: wt.K,
    }));
  }

  const daisy = state.dependents?.daisy;
  const caregiverName = trimmed(daisy?.name);
  const hasCaregiverData = caregiverName || wt.daisy || list(daisy?.shifts).length || state.employers?.D
    || list(state.caregiverBlackouts).length || list(state.childcareOff).length
    || list(state.coverageRequests).length || meta.memberUids.some((u) => meta.roles[u] === "supporting");
  if (hasCaregiverData) {
    legacy.D = pid("D");
    people.push(clean({
      id: legacy.D,
      name: caregiverName ?? "Caregiver",
      role: "caregiver" as const,
      uid: uidFor("supporting", caregiverName),
      color: "ink",
      order: 2,
      employer: trimmed(state.employers?.D),
      weekly: wt.daisy,
      blackouts: list(state.caregiverBlackouts).length ? state.caregiverBlackouts : undefined,
    }));
  }

  // ── Dated shifts ──────────────────────────────────────────────────────────
  // Ids are the person, date and position, so a re-run overwrites rather than
  // duplicates, and sorting by id keeps each day's original order.
  const shifts: DatedShift[] = [];
  const seq = new Map<string, number>();
  const shiftId = (person: string, date: string, mode: string) => {
    const k = `${person}_${date}_${mode}`;
    const n = seq.get(k) ?? 0;
    seq.set(k, n + 1);
    return `${date}_${person}_${mode}_${String(n).padStart(3, "0")}`;
  };
  const where = (e: unknown) => trimmed((e as { where?: unknown })?.where);

  const replaced = new Set<string>();
  for (const o of list(state.overrides)) {
    if (!o?.date) continue;
    if (replaced.has(o.date)) {
      notes.push(`duplicate override for ${o.date} ignored (the first one always won)`);
      continue;
    }
    replaced.add(o.date);
    shifts.push(clean({
      id: shiftId(legacy.G, o.date, "replace"), personId: legacy.G, date: o.date, mode: "replace" as const,
      shiftTypeId: o.shiftTypeId ?? null, label: o.label || undefined, note: o.note || undefined, where: where(o),
    }));
  }
  for (const o of list(state.ot)) {
    if (!o?.date) continue;
    shifts.push(clean({
      id: shiftId(legacy.G, o.date, "add"), personId: legacy.G, date: o.date, mode: "add" as const,
      shiftTypeId: o.shiftTypeId ?? null, label: o.label || undefined, note: o.note || undefined,
      where: where(o), overtime: true, coworkers: o.coworkers || undefined,
    }));
  }
  for (const p of list(state.partner?.shifts)) {
    if (!p?.date || !legacy.K) continue;
    shifts.push(clean({
      id: shiftId(legacy.K, p.date, "add"), personId: legacy.K, date: p.date, mode: "add" as const,
      shiftTypeId: p.shiftTypeId ?? null, label: p.label || undefined, note: p.note || undefined, where: where(p),
    }));
  }
  for (const s of list(daisy?.shifts)) {
    if (!s?.date || !legacy.D) continue;
    shifts.push(clean({
      id: shiftId(legacy.D, s.date, "add"), personId: legacy.D, date: s.date, mode: "add" as const,
      shiftTypeId: s.shiftTypeId ?? null, label: s.label || undefined, note: s.note || undefined, where: where(s),
    }));
  }

  // ── Everything else ───────────────────────────────────────────────────────
  const whoToPerson: Record<EventWho, string | undefined> = {
    G: legacy.G, K: legacy.K, Daisy: legacy.D, family: undefined,
  };
  const events: LifeEvent[] = list(state.events).map((e) => {
    const { who, ...rest } = e;
    if (who && who !== "family" && !whoToPerson[who]) notes.push(`event ${e.id} was for "${who}", who isn't in the household; now a family event`);
    return clean({ ...rest, personId: whoToPerson[who] });
  });

  const caregiverByUid = new Map(people.filter((p) => p.uid).map((p) => [p.uid!, p.id]));
  const coverageRequests: CoverageRequestDoc[] = list(state.coverageRequests).map((r) => clean({
    ...r,
    caregiverId: (r.caregiverUid && caregiverByUid.get(r.caregiverUid)) || legacy.D,
  }));

  const scheduleBlocks: ScheduleBlockDoc[] = list(state.scheduleBlocks).map((b, i) => {
    const id = trimmed(b.id) ?? `blk_${hash(`${b.startDate}:${b.endDate}:${b.label ?? ""}:${i}`)}`;
    if (!b.id) notes.push(`schedule block ${b.startDate}–${b.endDate} had no id; given ${id}`);
    return clean({ ...b, id, createdAt: b.createdAt ?? 0, createdBy: b.createdBy ?? "" });
  });

  const caregiverOff = list(state.childcareOff).filter((d) => d?.date).map((d) => clean({
    id: `${d.date}_${legacy.D}`, personId: legacy.D!, date: d.date, label: d.label,
  }));

  const shiftOffers = list(state.otOpportunities).filter((o) => o?.date).map((o, i) => ({
    id: `${o.date}_${legacy.G}_${String(i).padStart(3, "0")}`, personId: legacy.G,
    date: o.date, shiftTypeId: o.shiftTypeId, coworkers: o.coworkers ?? "",
  }));

  const photos: ConvertResult["photos"] = [];
  const imports: ImportDoc[] = list(state.imports as unknown as Array<Record<string, unknown>>).map((rec, i) => {
    const id = trimmed(rec.id) ?? `imp_${i}`;
    const { photo, ...rest } = rec;
    if (typeof photo === "string" && photo.startsWith("data:")) photos.push({ importId: id, dataUrl: photo });
    return { ...rest, id };
  });

  const root = clean({
    name: trimmed(state.householdName),
    timeZone: trimmed(state.timeZone),
    schemaVersion: SCHEMA_VERSION,
    childcare: !!legacy.D,
    memberUids: meta.memberUids,
    memberNames: meta.memberNames,
    roles: meta.roles,
    inviteCode: meta.inviteCode,
    createdBy: meta.createdBy,
  });

  const settings = clean({
    calName: state.calName,
    range: state.range,
    shareEnabled: state.shareEnabled,
    shareToken: state.shareToken,
    migrations: list(state._migrations).length ? state._migrations : undefined,
  });

  return {
    model: {
      root,
      settings,
      people,
      shiftTypes: list(state.shiftTypes).filter((t) => !t.id.startsWith("__cst_")),
      shifts,
      events,
      coverageRequests,
      caregiverRequests: list(state.caregiverRequests),
      scheduleBlocks,
      caregiverOff,
      occasions: list(state.occasions),
      shiftOffers,
      imports,
    },
    people: legacy,
    photos,
    notes,
  };
}
