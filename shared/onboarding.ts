// Setting up a new household — what the setup wizard (phone and Mac) collects,
// turned into a household on the any-household model. No starter data: the
// household holds exactly what its admin entered. Firebase-free; the apps
// write the result with createHousehold (tests/onboarding.test.mjs).

import {
  SCHEMA_VERSION, type Describes, type HouseholdModel, type HouseholdRoot, type Person, type Relation,
} from "./model";
import { writeModel, type DocStore } from "./store";
import type { PaydaySchedule, ShiftType, TemplateSlot } from "./state";

// ── What the wizard collects ───────────────────────────────────────────────

export interface WeekAnswer {
  /** Sun..Sat: a shift type id, or null for off. */
  days: Array<string | null>;
  /** Works every other weekend: `refSat` is a Saturday they work, and on
   *  those weekends they work `sat` / `sun` (null = off that day). */
  altWeekend?: { refSat: string; sat: string | null; sun: string | null };
}

/** A place picked from the address search. */
export interface PlaceAnswer { placeId: string; label: string }

export interface WorkAnswer {
  employer?: string;
  /** Where they work, from the address search — for leave-by times. */
  workplace?: PlaceAnswer;
  payday?: PaydaySchedule;
  /** Absent = their schedule changes week to week; they add shifts as they come. */
  week?: WeekAnswer;
}

/** Someone else in the household. Partners get the work questions. */
export type OtherKind = Exclude<Relation, "self">;
export interface OtherAnswer extends WorkAnswer {
  kind: OtherKind;
  name: string;
}

export interface SetupAnswers {
  householdName: string;
  /** IANA id, e.g. "America/New_York". */
  timeZone: string;
  me: WorkAnswer & { name: string; describes: Describes };
  others: OtherAnswer[];
  /** How many kids live there. Only the number is asked. */
  kids: number;
  shiftTypes: ShiftType[];
  integrations: {
    /** Home address for "leave by" times and traffic alerts. */
    commuteHome?: PlaceAnswer;
  };
}

export const DESCRIBES: Array<{ value: Describes; label: string }> = [
  { value: "head", label: "Head of household" },
  { value: "manager", label: "I manage the household's schedule" },
  { value: "parent", label: "Parent or guardian" },
  { value: "caregiver", label: "Caregiver" },
  { value: "roommate", label: "Roommate" },
  { value: "other", label: "Something else" },
];

export const OTHER_KINDS: Array<{ value: OtherKind; label: string }> = [
  { value: "partner", label: "Partner" },
  { value: "roommate", label: "Roommate" },
  { value: "family", label: "Family member" },
  { value: "caregiver", label: "Caregiver" },
  { value: "other", label: "Someone else" },
];

// ── Shift type presets ─────────────────────────────────────────────────────

/** The common shapes, offered as one-tap choices. Nights assume about seven
 *  hours' sleep after the shift, which the coverage planning counts as time
 *  that adult can't watch the kids. */
export const SHIFT_PRESETS: ShiftType[] = [
  { id: "day12", name: "Day 12h", start: "07:00", end: "19:30", crossesMidnight: false },
  { id: "night12", name: "Night 12h", start: "19:00", end: "07:30", crossesMidnight: true, sleepHours: 7 },
  { id: "day8", name: "Day 8h", start: "07:00", end: "15:30", crossesMidnight: false },
  { id: "evening8", name: "Evening 8h", start: "15:00", end: "23:30", crossesMidnight: false },
  { id: "night8", name: "Night 8h", start: "23:00", end: "07:30", crossesMidnight: true, sleepHours: 7 },
  { id: "office", name: "9 to 5", start: "09:00", end: "17:00", crossesMidnight: false },
];

// ── Time zones, readably ───────────────────────────────────────────────────

/** "New York · Eastern Time" for "America/New_York". */
export function timeZoneLabel(tz: string): string {
  const city = (tz.split("/").pop() ?? tz).replace(/_/g, " ");
  let zone = "";
  try {
    zone = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" })
      .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch { /* an engine without longGeneric: the city alone */ }
  return zone && zone !== city ? `${city} · ${zone}` : city;
}

const US_ZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
];

/** The choices for the time zone picker: the detected zone and the US zones
 *  first, then the rest of the world by name. */
export function timeZoneChoices(detected: string): Array<{ value: string; label: string }> {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch { /* older engines: the short list */ }
  const first = [...new Set([detected, ...US_ZONES])].filter((z) => isValidTimeZone(z));
  const rest = all.filter((z) => !first.includes(z))
    .map((z) => ({ value: z, label: timeZoneLabel(z) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...first.map((z) => ({ value: z, label: timeZoneLabel(z) })), ...rest];
}

// ── Checks ─────────────────────────────────────────────────────────────────

export class SetupError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[A-Za-z0-9_-]{1,60}$/;

function name(v: unknown, what: string): string {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!s) throw new SetupError(`${what} is needed.`);
  if (s.length > 60) throw new SetupError(`${what} is too long.`);
  return s;
}

function optionalText(v: unknown, max = 120): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : undefined;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return /\//.test(tz) || tz === "UTC";
  } catch {
    return false;
  }
}

function isSaturday(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay() === 6;
}

function place(p: PlaceAnswer | undefined, what: string): PlaceAnswer | undefined {
  if (!p) return undefined;
  if (!optionalText(p.placeId, 300) || !optionalText(p.label, 300)) throw new SetupError(`Pick ${what} from the list.`);
  return { placeId: p.placeId, label: p.label };
}

/** The answers, checked and tidied. Throws SetupError with what to fix. */
export function checkAnswers(a: SetupAnswers): SetupAnswers {
  const householdName = name(a.householdName, "A household name");
  if (!isValidTimeZone(a.timeZone)) throw new SetupError("Pick your time zone.");

  const types = a.shiftTypes ?? [];
  const typeIds = new Set<string>();
  for (const t of types) {
    if (!ID.test(t.id ?? "") || typeIds.has(t.id)) throw new SetupError("Each shift type needs its own id.");
    typeIds.add(t.id);
    name(t.name, "A shift type's name");
    if (!TIME.test(t.start) || !TIME.test(t.end)) throw new SetupError(`Give "${t.name}" a start and end time.`);
    if (t.start === t.end) throw new SetupError(`"${t.name}" starts and ends at the same time.`);
  }

  const week = (w: WeekAnswer | undefined, who: string): WeekAnswer | undefined => {
    if (!w) return undefined;
    if (!Array.isArray(w.days) || w.days.length !== 7) throw new SetupError(`${who}'s week needs all seven days.`);
    for (const d of w.days) {
      if (d !== null && !typeIds.has(d)) throw new SetupError(`${who}'s week uses a shift type that isn't in the list.`);
    }
    if (w.altWeekend) {
      const { refSat, sat, sun } = w.altWeekend;
      if (!DATE.test(refSat) || !isSaturday(refSat)) throw new SetupError(`Pick a Saturday ${who} works.`);
      for (const d of [sat, sun]) {
        if (d !== null && !typeIds.has(d)) throw new SetupError(`${who}'s weekend uses a shift type that isn't in the list.`);
      }
    }
    return w;
  };
  const payday = (p: PaydaySchedule | undefined, who: string): PaydaySchedule | undefined => {
    if (!p) return undefined;
    if (!DATE.test(p.anchor) || (p.freq !== "weekly" && p.freq !== "biweekly")) {
      throw new SetupError(`${who}'s payday needs a date and how often.`);
    }
    return { anchor: p.anchor, freq: p.freq };
  };
  const work = (x: WorkAnswer, who: string): WorkAnswer => ({
    employer: optionalText(x.employer),
    workplace: place(x.workplace, `${who}'s workplace`),
    payday: payday(x.payday, who),
    week: week(x.week, who),
  });

  const meName = name(a.me?.name, "Your name");
  if (!DESCRIBES.some((d) => d.value === a.me?.describes)) throw new SetupError("Pick what best describes you.");
  const kinds = new Set(OTHER_KINDS.map((k) => k.value));
  const others = (a.others ?? []).map((o): OtherAnswer => {
    if (!kinds.has(o.kind)) throw new SetupError("Pick who each person is.");
    const n = name(o.name, "Each person's name");
    // Only partners are asked about work (for now); anything else is dropped.
    return o.kind === "partner" ? { kind: o.kind, name: n, ...work(o, n) } : { kind: o.kind, name: n };
  });
  if (others.length > 20) throw new SetupError("That's a lot of people — add the rest later.");

  const kids = Number(a.kids ?? 0);
  if (!Number.isInteger(kids) || kids < 0 || kids > 20) throw new SetupError("How many kids live there?");

  return {
    householdName,
    timeZone: a.timeZone,
    me: { name: meName, describes: a.me.describes, ...work(a.me, meName) },
    others,
    kids,
    shiftTypes: types.map((t) => ({ ...t, name: t.name.trim(), crossesMidnight: t.end <= t.start })),
    integrations: { commuteHome: place(a.integrations?.commuteHome, "your home address") },
  };
}

// ── Building the household ─────────────────────────────────────────────────

export interface NewHousehold {
  root: HouseholdRoot;
  model: HouseholdModel;
  /** The household's code (for a partner, roommate or family member) and,
   *  when there's a caregiver, theirs. */
  codes: { partner: string; caregiver?: string };
  /** For private/commute: home, and each adult's workplace by legacy slot
   *  (G = you, K = your partner), which is how the leave-by times key them. */
  commute?: { home?: PlaceAnswer; work?: { G?: PlaceAnswer; K?: PlaceAnswer } };
}

export interface SetupContext {
  householdId: string;
  uid: string;
  /** What the account is called (for the membership list). */
  accountName: string;
  now: number;
  /** A fresh id for each person, in order. */
  personId: (index: number) => string;
  /** Six-character invite codes. */
  inviteCode: () => string;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

export function randomInviteCode(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}

/**
 * Who counts toward childcare coverage, until the household says otherwise:
 * partners and family members do, roommates and anyone else don't.
 */
const WATCHES_KIDS: Record<OtherKind, boolean> = {
  partner: true, family: true, roommate: false, other: false, caregiver: true,
};

export function buildHousehold(answers: SetupAnswers, ctx: SetupContext): NewHousehold {
  const a = checkAnswers(answers);
  let n = 0;
  const people: Person[] = [];
  const clean = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  const workFields = (x: WorkAnswer) => ({
    employer: x.employer, payday: x.payday,
    weekly: x.week ? { days: x.week.days as TemplateSlot[] } : undefined,
    altWeekend: x.week?.altWeekend ? { enabled: true, ...x.week.altWeekend } : undefined,
  });

  people.push(clean({
    id: ctx.personId(n), name: a.me.name, role: "adult" as const, relation: "self" as const,
    describes: a.me.describes, uid: ctx.uid, color: "teal", order: n++, ...workFields(a.me),
  }));
  let partnerSeen = false;
  let caregiverSeen = false;
  for (const o of a.others) {
    if (o.kind === "caregiver") {
      people.push(clean({
        id: ctx.personId(n), name: o.name, role: "caregiver" as const, relation: "caregiver" as const,
        color: caregiverSeen ? undefined : "ink", order: n++,
      }));
      caregiverSeen = true;
      continue;
    }
    // The first partner gets Clay; anyone else has no colour of their own yet.
    const color = o.kind === "partner" && !partnerSeen ? "clay" : undefined;
    if (o.kind === "partner") partnerSeen = true;
    people.push(clean({
      id: ctx.personId(n), name: o.name, role: "adult" as const, relation: o.kind,
      watchesKids: WATCHES_KIDS[o.kind] ? undefined : false, color, order: n++,
      ...(o.kind === "partner" ? workFields(o) : {}),
    }));
  }

  const partnerCode = ctx.inviteCode();
  let caregiverCode = caregiverSeen ? ctx.inviteCode() : undefined;
  while (caregiverCode === partnerCode) caregiverCode = ctx.inviteCode();

  const root: HouseholdRoot = {
    name: a.householdName,
    timeZone: a.timeZone,
    schemaVersion: SCHEMA_VERSION,
    childcare: a.kids > 0,
    childCount: a.kids,
    memberUids: [ctx.uid],
    memberNames: { [ctx.uid]: name(ctx.accountName || a.me.name, "Your name") },
    roles: { [ctx.uid]: "admin" },
    inviteCode: partnerCode,
    createdBy: ctx.uid,
    // WVU game days and the bundled photos were built for one family; a new
    // household doesn't get them.
    wvuFootball: false,
    familyPhotos: false,
  };

  const firstPartner = a.others.find((o) => o.kind === "partner");
  const work = clean({ G: a.me.workplace, K: firstPartner?.workplace });
  const commute = clean({ home: a.integrations.commuteHome, work: Object.keys(work).length ? work : undefined });

  return {
    root,
    model: {
      root,
      settings: {},
      people,
      shiftTypes: a.shiftTypes,
      shifts: [], events: [], coverageRequests: [], caregiverRequests: [], scheduleBlocks: [],
      caregiverOff: [], occasions: [], shiftOffers: [], imports: [],
    },
    codes: clean({ partner: partnerCode, caregiver: caregiverCode }),
    commute: Object.keys(commute).length ? commute : undefined,
  };
}

/**
 * Create the household: the household record first (which makes the caller
 * its admin, so the rules allow the rest), then its invite codes, records
 * and commute settings.
 */
export async function createHousehold(store: DocStore, householdId: string, h: NewHousehold,
  now: number): Promise<void> {
  const hh = `households/${householdId}`;
  await store.write([{ op: "set", path: hh, data: { ...h.root, createdAt: now } as unknown as Record<string, unknown> }]);
  const codes = [
    { op: "set" as const, path: `inviteCodes/${h.codes.partner}`, data: { householdId } },
    ...(h.codes.caregiver
      ? [{ op: "set" as const, path: `inviteCodes/${h.codes.caregiver}`, data: { householdId, role: "supporting" } }]
      : []),
  ];
  await store.write(codes);
  await writeModel(store, householdId, h.model);
  if (h.commute) {
    await store.write([{ op: "merge", path: `${hh}/private/commute`, data: h.commute as unknown as Record<string, unknown> }]);
  }
}
