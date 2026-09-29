// Reading and writing the any-household model (shared/model.ts,
// docs/data-model.md).
//
// Firebase-free like the rest of shared/: the data layer talks to a DocStore,
// and two small adapters make a DocStore out of whichever SDK a client has —
//   namespacedStore(db)      the phone (compat SDK) and the functions (Admin)
//   modularStore(db, fns)    the Mac (modular SDK, functions passed in)
// so every client reads and writes the model the same way.
//
// Every write is to single documents. Nothing rewrites a whole household.

import type {
  CaregiverOffDay, CoverageRequestDoc, DatedShift, HouseholdModel, HouseholdRoot,
  HouseholdSettings, ImportDoc, LifeEvent, Person, ScheduleBlockDoc, ShiftOffer,
} from "./model";
import type { CaregiverRequest, OccasionEntry, ShiftType } from "./state";

// ── The store interface ────────────────────────────────────────────────────

export type Data = Record<string, unknown>;
export interface DocSnap { id: string; data: Data }
export type Where = readonly [field: string, op: "==", value: unknown];
export type WriteOp =
  | { op: "set"; path: string; data: Data }
  | { op: "merge"; path: string; data: Data }
  | { op: "delete"; path: string };
export type Unsubscribe = () => void;

export interface DocStore {
  get(path: string): Promise<Data | undefined>;
  list(path: string, where?: Where): Promise<DocSnap[]>;
  /** Applied atomically. At most MAX_BATCH ops. */
  write(ops: WriteOp[]): Promise<void>;
  watchDoc(path: string, onData: (data: Data | undefined) => void, onError: (e: unknown) => void): Unsubscribe;
  watchList(path: string, where: Where | undefined, onDocs: (docs: DocSnap[]) => void, onError: (e: unknown) => void): Unsubscribe;
}

export const MAX_BATCH = 450;

// Firestore rejects undefined anywhere in a document.
function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndefined) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Data = {};
    for (const [k, x] of Object.entries(v as Data)) if (x !== undefined) out[k] = stripUndefined(x);
    return out as T;
  }
  return v;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The phone's compat SDK and firebase-admin share this shape. */
export function namespacedStore(db: any): DocStore {
  const query = (path: string, where?: Where) => {
    const col = db.collection(path);
    return where ? col.where(where[0], where[1], where[2]) : col;
  };
  const docs = (snap: any): DocSnap[] => snap.docs.map((d: any) => ({ id: d.id, data: d.data() }));
  return {
    async get(path) {
      const s = await db.doc(path).get();
      return s.exists ? s.data() : undefined;
    },
    async list(path, where) {
      return docs(await query(path, where).get());
    },
    async write(ops) {
      if (ops.length > MAX_BATCH) throw new Error(`write: ${ops.length} ops is over the ${MAX_BATCH} batch limit`);
      const b = db.batch();
      for (const o of ops) {
        if (o.op === "delete") b.delete(db.doc(o.path));
        else if (o.op === "merge") b.set(db.doc(o.path), stripUndefined(o.data), { merge: true });
        else b.set(db.doc(o.path), stripUndefined(o.data));
      }
      await b.commit();
    },
    watchDoc(path, onData, onError) {
      return db.doc(path).onSnapshot((s: any) => onData(s.exists ? s.data() : undefined), onError);
    },
    watchList(path, where, onDocs, onError) {
      return query(path, where).onSnapshot((s: any) => onDocs(docs(s)), onError);
    },
  };
}

/** The functions a modular SDK store needs, passed in from "firebase/firestore". */
export interface ModularFns {
  doc: any; getDoc: any; collection: any; query: any; where: any;
  getDocs: any; writeBatch: any; onSnapshot: any;
}

export function modularStore(db: any, f: ModularFns): DocStore {
  const q = (path: string, where?: Where) => {
    const col = f.collection(db, path);
    return where ? f.query(col, f.where(where[0], where[1], where[2])) : col;
  };
  const docs = (snap: any): DocSnap[] => snap.docs.map((d: any) => ({ id: d.id, data: d.data() }));
  return {
    async get(path) {
      const s = await f.getDoc(f.doc(db, path));
      return s.exists() ? s.data() : undefined;
    },
    async list(path, where) {
      return docs(await f.getDocs(q(path, where)));
    },
    async write(ops) {
      if (ops.length > MAX_BATCH) throw new Error(`write: ${ops.length} ops is over the ${MAX_BATCH} batch limit`);
      const b = f.writeBatch(db);
      for (const o of ops) {
        if (o.op === "delete") b.delete(f.doc(db, o.path));
        else if (o.op === "merge") b.set(f.doc(db, o.path), stripUndefined(o.data), { merge: true });
        else b.set(f.doc(db, o.path), stripUndefined(o.data));
      }
      await b.commit();
    },
    watchDoc(path, onData, onError) {
      return f.onSnapshot(f.doc(db, path), (s: any) => onData(s.exists() ? s.data() : undefined), onError);
    },
    watchList(path, where, onDocs, onError) {
      return f.onSnapshot(q(path, where), (s: any) => onDocs(docs(s)), onError);
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Layout ─────────────────────────────────────────────────────────────────

/** The collections that hold one record per document, by model key. */
export const COLLECTIONS = [
  "shiftTypes", "shifts", "events", "coverageRequests", "caregiverRequests",
  "scheduleBlocks", "caregiverOff", "occasions", "shiftOffers", "imports",
] as const;
export type CollectionKey = typeof COLLECTIONS[number];

export interface CollectionDoc {
  shiftTypes: ShiftType;
  shifts: DatedShift;
  events: LifeEvent;
  coverageRequests: CoverageRequestDoc;
  caregiverRequests: CaregiverRequest;
  scheduleBlocks: ScheduleBlockDoc;
  caregiverOff: CaregiverOffDay;
  occasions: OccasionEntry;
  shiftOffers: ShiftOffer;
  imports: ImportDoc;
}

export const householdPath = (hid: string) => `households/${hid}`;
export const settingsPath = (hid: string) => `households/${hid}/settings/main`;
export const collectionPath = (hid: string, key: CollectionKey | "people" | "personDetails") => `households/${hid}/${key}`;

/**
 * A person is stored in two documents: who they are (people/{pid}), which
 * every member may read, and their details (personDetails/{pid}) — pay,
 * employer, their week — which only admin/partner and the person themself may.
 */
const IDENTITY = ["name", "role", "uid", "color", "photoPath", "order"] as const;

export function splitPerson(p: Person): { identity: Data; details: Data } {
  const identity: Data = {};
  const details: Data = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === "id" || v === undefined) continue;
    if ((IDENTITY as readonly string[]).includes(k)) identity[k] = v;
    else details[k] = v;
  }
  return { identity, details };
}

export function joinPerson(id: string, identity: Data, details: Data | undefined): Person {
  return { ...(details ?? {}), ...identity, id } as Person;
}

/** A replace shift's id is its person and date, so there can only be one. */
export const replaceShiftId = (personId: string, date: string) => `${date}_${personId}_replace`;

// ── Checks ─────────────────────────────────────────────────────────────────

export class ModelInputError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[A-Za-z0-9_-]{1,120}$/;

function need(ok: unknown, msg: string): asserts ok {
  if (!ok) throw new ModelInputError(msg);
}

/** What a record must hold before it's written. Firestore rules check who
 *  may write it; these catch a malformed one before it's sent. */
const CHECKS: { [K in CollectionKey]?: (d: CollectionDoc[K]) => void } = {
  shiftTypes(t) {
    need(typeof t.name === "string" && t.name.trim(), "A shift type needs a name.");
    need(TIME.test(t.start) && TIME.test(t.end), "Shift times are HH:MM.");
  },
  shifts(s) {
    need(ID.test(s.personId ?? ""), "A shift needs a person.");
    need(DATE.test(s.date ?? ""), "A shift needs a date.");
    need(s.mode === "replace" || s.mode === "add", "A shift is replace or add.");
    need(s.shiftTypeId === null || typeof s.shiftTypeId === "string", "A shift's type is an id or null.");
    need(s.mode === "replace" || s.shiftTypeId !== null || !!s.label, "An extra shift needs a type or a label.");
  },
  events(e) {
    need(DATE.test(e.date ?? ""), "An event needs a date.");
    need(typeof e.title === "string" && e.title.trim(), "An event needs a title.");
    need(!e.startTime || TIME.test(e.startTime), "Event times are HH:MM.");
    need(!e.endTime || TIME.test(e.endTime), "Event times are HH:MM.");
  },
  coverageRequests(r) {
    need(DATE.test(r.date ?? ""), "A request needs a date.");
    need(TIME.test(r.startTime ?? "") && TIME.test(r.endTime ?? ""), "Request times are HH:MM.");
  },
  scheduleBlocks(b) {
    need(DATE.test(b.startDate ?? "") && DATE.test(b.endDate ?? "") && b.startDate <= b.endDate, "A block needs a start and end date.");
  },
  caregiverOff(d) {
    need(DATE.test(d.date ?? "") && ID.test(d.personId ?? ""), "A day off needs a date and a caregiver.");
  },
};

function checkPerson(p: Person): void {
  need(ID.test(p.id ?? ""), "A person needs an id.");
  need(typeof p.name === "string" && p.name.trim(), "A person needs a name.");
  need(p.role === "adult" || p.role === "caregiver" || p.role === "child", "A person is an adult, caregiver or child.");
  need(Number.isFinite(p.order), "A person needs an order.");
  need(p.role !== "child" || (!p.weekly && !p.color), "A child has no schedule or colour.");
}

// ── Reading ────────────────────────────────────────────────────────────────

function emptyModel(root: HouseholdRoot): HouseholdModel {
  return {
    root, settings: {}, people: [], shiftTypes: [], shifts: [], events: [], coverageRequests: [],
    caregiverRequests: [], scheduleBlocks: [], caregiverOff: [], occasions: [], shiftOffers: [], imports: [],
  };
}

const withIds = <T>(docs: DocSnap[]): T[] => docs.map((d) => ({ ...d.data, id: d.id }) as T);

function assemble(root: Data, settings: Data | undefined, people: DocSnap[], details: DocSnap[],
  cols: Partial<Record<CollectionKey, DocSnap[]>>): HouseholdModel {
  const m = emptyModel(root as unknown as HouseholdRoot);
  m.settings = (settings ?? {}) as HouseholdSettings;
  const byId = new Map(details.map((d) => [d.id, d.data]));
  m.people = people.map((p) => joinPerson(p.id, p.data, byId.get(p.id)));
  for (const key of COLLECTIONS) (m as unknown as Record<string, unknown>)[key] = withIds(cols[key] ?? []);
  return m;
}

/** A whole household, for an admin or partner. */
export async function loadHousehold(store: DocStore, hid: string): Promise<HouseholdModel | undefined> {
  const root = await store.get(householdPath(hid));
  if (!root) return undefined;
  const [settings, people, details, ...lists] = await Promise.all([
    store.get(settingsPath(hid)),
    store.list(collectionPath(hid, "people")),
    store.list(collectionPath(hid, "personDetails")),
    ...COLLECTIONS.map((k) => store.list(collectionPath(hid, k))),
  ]);
  return assemble(root, settings, people, details,
    Object.fromEntries(COLLECTIONS.map((k, i) => [k, lists[i]])));
}

/**
 * A household kept live, for an admin or partner: `onModel` is called once
 * everything has loaded, then after every change. Changes that land together
 * are delivered together.
 */
export function watchHousehold(store: DocStore, hid: string,
  onModel: (m: HouseholdModel | undefined) => void, onError: (e: unknown) => void): Unsubscribe {
  const LISTS = ["people", "personDetails", ...COLLECTIONS] as const;
  let root: Data | undefined | null = null; // null = not loaded yet
  let settings: Data | undefined | null = null;
  const lists = new Map<string, DocSnap[]>();
  let pending = false;
  let stopped = false;

  const emit = () => {
    if (pending || stopped) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      if (stopped || root === null || settings === null || lists.size < LISTS.length) return;
      if (!root) return onModel(undefined);
      onModel(assemble(root, settings ?? undefined, lists.get("people")!, lists.get("personDetails")!,
        Object.fromEntries(COLLECTIONS.map((k) => [k, lists.get(k)!]))));
    }, 0);
  };

  const unsubs: Unsubscribe[] = [
    store.watchDoc(householdPath(hid), (d) => { root = d; emit(); }, onError),
    store.watchDoc(settingsPath(hid), (d) => { settings = d; emit(); }, onError),
    ...LISTS.map((k) =>
      store.watchList(collectionPath(hid, k), undefined, (docs) => { lists.set(k, docs); emit(); }, onError)),
  ];
  return () => { stopped = true; unsubs.forEach((u) => u()); };
}

/** What a caregiver's screen shows: who's who, the requests addressed to
 *  them, and their own schedule. */
export interface CaregiverModel {
  root: HouseholdRoot;
  me: Person | undefined;
  people: Person[];
  shiftTypes: ShiftType[];
  coverageRequests: CoverageRequestDoc[];
  shifts: DatedShift[];
  caregiverOff: CaregiverOffDay[];
}

/** A caregiver's view, kept live. Reads only what the rules let them see. */
export function watchCaregiver(store: DocStore, hid: string, personId: string,
  onModel: (m: CaregiverModel | undefined) => void, onError: (e: unknown) => void): Unsubscribe {
  const mine: Where = ["personId", "==", personId];
  const parts: Record<string, unknown> = {};
  const keys = ["root", "details", "people", "shiftTypes", "coverageRequests", "shifts", "caregiverOff"];
  let pending = false;
  let stopped = false;
  const set = (k: string) => (v: unknown) => {
    parts[k] = v;
    if (pending || stopped) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      if (stopped || !keys.every((x) => x in parts)) return;
      const root = parts.root as Data | undefined;
      if (!root) return onModel(undefined);
      const people = (parts.people as DocSnap[]).map((p) => joinPerson(p.id, p.data, undefined));
      const meIdentity = (parts.people as DocSnap[]).find((p) => p.id === personId);
      onModel({
        root: root as unknown as HouseholdRoot,
        me: meIdentity ? joinPerson(personId, meIdentity.data, parts.details as Data | undefined) : undefined,
        people,
        shiftTypes: withIds(parts.shiftTypes as DocSnap[]),
        coverageRequests: withIds(parts.coverageRequests as DocSnap[]),
        shifts: withIds(parts.shifts as DocSnap[]),
        caregiverOff: withIds(parts.caregiverOff as DocSnap[]),
      });
    }, 0);
  };
  const unsubs = [
    store.watchDoc(householdPath(hid), set("root"), onError),
    store.watchDoc(`${collectionPath(hid, "personDetails")}/${personId}`, set("details"), onError),
    store.watchList(collectionPath(hid, "people"), undefined, set("people"), onError),
    store.watchList(collectionPath(hid, "shiftTypes"), undefined, set("shiftTypes"), onError),
    store.watchList(collectionPath(hid, "coverageRequests"), ["caregiverId", "==", personId], set("coverageRequests"), onError),
    store.watchList(collectionPath(hid, "shifts"), mine, set("shifts"), onError),
    store.watchList(collectionPath(hid, "caregiverOff"), mine, set("caregiverOff"), onError),
  ];
  return () => { stopped = true; unsubs.forEach((u) => u()); };
}

// ── Writing ────────────────────────────────────────────────────────────────

export async function savePerson(store: DocStore, hid: string, person: Person): Promise<void> {
  checkPerson(person);
  const { identity, details } = splitPerson(person);
  await store.write([
    { op: "set", path: `${collectionPath(hid, "people")}/${person.id}`, data: identity },
    { op: "set", path: `${collectionPath(hid, "personDetails")}/${person.id}`, data: details },
  ]);
}

/** Remove a person and their dated shifts. */
export async function removePerson(store: DocStore, hid: string, personId: string): Promise<void> {
  const shifts = await store.list(collectionPath(hid, "shifts"), ["personId", "==", personId]);
  const ops: WriteOp[] = [
    { op: "delete", path: `${collectionPath(hid, "people")}/${personId}` },
    { op: "delete", path: `${collectionPath(hid, "personDetails")}/${personId}` },
    ...shifts.map((s): WriteOp => ({ op: "delete", path: `${collectionPath(hid, "shifts")}/${s.id}` })),
  ];
  for (let i = 0; i < ops.length; i += MAX_BATCH) await store.write(ops.slice(i, i + MAX_BATCH));
}

/** Create or replace one record. A replace shift gets its canonical id. */
export async function putRecord<K extends CollectionKey>(store: DocStore, hid: string, key: K,
  record: CollectionDoc[K]): Promise<CollectionDoc[K]> {
  let rec = record;
  if (key === "shifts") {
    const s = rec as DatedShift;
    if (s.mode === "replace") rec = { ...s, id: replaceShiftId(s.personId, s.date) } as CollectionDoc[K];
  }
  const id = (rec as { id?: string }).id;
  need(typeof id === "string" && ID.test(id), "A record needs an id.");
  CHECKS[key]?.(rec as never);
  const { id: _id, ...data } = rec as Data;
  await store.write([{ op: "set", path: `${collectionPath(hid, key)}/${id}`, data }]);
  return rec;
}

export async function removeRecord(store: DocStore, hid: string, key: CollectionKey, id: string): Promise<void> {
  await store.write([{ op: "delete", path: `${collectionPath(hid, key)}/${id}` }]);
}

export async function saveSettings(store: DocStore, hid: string, patch: Partial<HouseholdSettings>): Promise<void> {
  await store.write([{ op: "merge", path: settingsPath(hid), data: patch as Data }]);
}

/** The household facts every member sees. Membership is changed elsewhere
 *  (join, leave, remove), never here. */
export async function saveHouseholdInfo(store: DocStore, hid: string,
  patch: Partial<Pick<HouseholdRoot, "name" | "timeZone" | "childcare">>): Promise<void> {
  const allowed: Data = {};
  for (const k of ["name", "timeZone", "childcare"] as const) if (k in patch) allowed[k] = patch[k];
  await store.write([{ op: "merge", path: householdPath(hid), data: allowed }]);
}

/**
 * Write a whole model — for seeding a test household and for the migration.
 * The household root's own fields (name, time zone, childcare) are merged in;
 * membership and schemaVersion are left alone, so the migration can flip the
 * version only after it has checked the result.
 */
export async function writeModel(store: DocStore, hid: string, model: HouseholdModel): Promise<number> {
  const ops: WriteOp[] = [];
  const { name, timeZone, childcare } = model.root;
  ops.push({ op: "merge", path: householdPath(hid), data: { name, timeZone, childcare } });
  ops.push({ op: "set", path: settingsPath(hid), data: model.settings as Data });
  for (const p of model.people) {
    checkPerson(p);
    const { identity, details } = splitPerson(p);
    ops.push({ op: "set", path: `${collectionPath(hid, "people")}/${p.id}`, data: identity });
    ops.push({ op: "set", path: `${collectionPath(hid, "personDetails")}/${p.id}`, data: details });
  }
  for (const key of COLLECTIONS) {
    for (const rec of model[key] as Array<{ id: string }>) {
      need(typeof rec.id === "string" && ID.test(rec.id), `A ${key} record has a bad id: ${rec.id}`);
      const { id, ...data } = rec as unknown as Data & { id: string };
      ops.push({ op: "set", path: `${collectionPath(hid, key)}/${id}`, data });
    }
  }
  for (let i = 0; i < ops.length; i += MAX_BATCH) await store.write(ops.slice(i, i + MAX_BATCH));
  return ops.length;
}

export async function setSchemaVersion(store: DocStore, hid: string, version: number): Promise<void> {
  await store.write([{ op: "merge", path: householdPath(hid), data: { schemaVersion: version } }]);
}

// ── The legacy bridge ──────────────────────────────────────────────────────
// Screens written for state/main edit a legacy-shaped copy of the household
// (toLegacy). bridgeWrites turns one such edit into record writes: convert the
// copy before and after the edit (fromLegacy), and write only the records that
// differ — each merged onto the stored record, so fields the legacy view never
// showed, and anything someone else changed meanwhile, survive.

/** The person fields a legacy edit can change. The rest (role, colour, account,
 *  photo, order) the bridge never touches. */
const PERSON_LEGACY_KEYS = ["name", "employer", "payday", "weekly", "altWeekend", "blackouts"];

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter((k) => (v as Data)[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Data)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "undefined";
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b);

/** `live` with every key the edit changed (before → after) applied. */
function applyEdit(live: Data | undefined, before: Data | undefined, after: Data, keys?: string[]): Data {
  const out: Data = { ...(live ?? after) };
  for (const k of keys ?? [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])]) {
    if (same(before?.[k], after[k])) continue;
    if (after[k] === undefined) delete out[k];
    else out[k] = after[k];
  }
  return out;
}

export function bridgeWrites(hid: string, live: HouseholdModel, before: HouseholdModel, after: HouseholdModel): WriteOp[] {
  const ops: WriteOp[] = [];
  const index = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

  const livePeople = index(live.people);
  const beforePeople = index(before.people);
  for (const p of after.people) {
    const b = beforePeople.get(p.id) as Data | undefined;
    if (b && PERSON_LEGACY_KEYS.every((k) => same(b[k], (p as unknown as Data)[k]))) continue;
    const merged = applyEdit(livePeople.get(p.id) as Data | undefined, b, p as unknown as Data,
      livePeople.has(p.id) ? PERSON_LEGACY_KEYS : undefined) as unknown as Person;
    const { identity, details } = splitPerson({ ...merged, id: p.id });
    ops.push({ op: "set", path: `${collectionPath(hid, "people")}/${p.id}`, data: identity });
    ops.push({ op: "set", path: `${collectionPath(hid, "personDetails")}/${p.id}`, data: details });
  }
  // A legacy edit has no way to remove a person, so none is removed here.

  for (const key of COLLECTIONS) {
    const liveRecs = index(live[key] as Array<{ id: string }>);
    const beforeRecs = index(before[key] as Array<{ id: string }>);
    const afterRecs = index(after[key] as Array<{ id: string }>);
    for (const [id, a] of afterRecs) {
      const b = beforeRecs.get(id);
      if (b && same(b, a)) continue;
      const { id: _id, ...data } = applyEdit(liveRecs.get(id) as Data | undefined, b as Data | undefined, a as Data);
      ops.push({ op: "set", path: `${collectionPath(hid, key)}/${id}`, data });
    }
    for (const id of beforeRecs.keys()) {
      if (!afterRecs.has(id)) ops.push({ op: "delete", path: `${collectionPath(hid, key)}/${id}` });
    }
  }

  if (!same(before.settings, after.settings)) {
    ops.push({ op: "set", path: settingsPath(hid), data: applyEdit(live.settings as Data, before.settings as Data, after.settings as Data) });
  }
  const rootPatch: Data = {};
  for (const k of ["name", "timeZone"] as const) {
    if (!same(before.root[k], after.root[k])) rootPatch[k] = after.root[k] ?? null;
  }
  if (Object.keys(rootPatch).length) ops.push({ op: "merge", path: householdPath(hid), data: rootPatch });
  return ops;
}
