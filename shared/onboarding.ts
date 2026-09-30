// Setting up a new household — what the setup wizard (phone and Mac) collects,
// turned into a household on the any-household model. No starter data: the
// household holds exactly what its admin entered. Firebase-free; the apps
// write the result with createHousehold (tests/onboarding.test.mjs).

import { SCHEMA_VERSION, type HouseholdModel, type HouseholdRoot, type Person } from "./model";
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

export interface AdultAnswer {
  name: string;
  employer?: string;
  payday?: PaydaySchedule;
  /** Absent = their schedule changes week to week; they add shifts as they come. */
  week?: WeekAnswer;
}

export interface SetupAnswers {
  householdName: string;
  /** IANA id, e.g. "America/New_York". */
  timeZone: string;
  me: AdultAnswer;
  partner?: AdultAnswer;
  caregiver?: { name: string };
  kids: string[];
  shiftTypes: ShiftType[];
  integrations: {
    /** Home address for "leave by" times and traffic alerts. */
    commuteHome?: { placeId: string; label: string };
  };
}

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
  const adult = (x: AdultAnswer, what: string): AdultAnswer => {
    const n = name(x.name, what);
    return { name: n, employer: optionalText(x.employer), payday: payday(x.payday, n), week: week(x.week, n) };
  };

  const kids = (a.kids ?? []).map((k) => name(k, "Each child's name"));
  if (kids.length > 12) throw new SetupError("That's a lot of kids — add the rest later.");

  const home = a.integrations?.commuteHome;
  if (home && (!optionalText(home.placeId, 300) || !optionalText(home.label, 300))) {
    throw new SetupError("Pick your home address from the list.");
  }

  return {
    householdName,
    timeZone: a.timeZone,
    me: adult(a.me, "Your name"),
    partner: a.partner ? adult(a.partner, "Your partner's name") : undefined,
    caregiver: a.caregiver ? { name: name(a.caregiver.name, "Your caregiver's name") } : undefined,
    kids,
    shiftTypes: types.map((t) => ({ ...t, name: t.name.trim(), crossesMidnight: t.end <= t.start })),
    integrations: { commuteHome: home },
  };
}

// ── Building the household ─────────────────────────────────────────────────

export interface NewHousehold {
  root: HouseholdRoot;
  model: HouseholdModel;
  /** The partner's invite code (the household's own) and, when there's a
   *  caregiver, theirs. */
  codes: { partner: string; caregiver?: string };
  /** For private/commute. */
  commuteHome?: { placeId: string; label: string };
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

export function buildHousehold(answers: SetupAnswers, ctx: SetupContext): NewHousehold {
  const a = checkAnswers(answers);
  let n = 0;
  const people: Person[] = [];
  const clean = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

  const adult = (x: AdultAnswer, color: string, uid?: string): Person => clean({
    id: ctx.personId(n), name: x.name, role: "adult" as const, uid, color, order: n++,
    employer: x.employer, payday: x.payday,
    weekly: x.week ? { days: x.week.days as TemplateSlot[] } : undefined,
    altWeekend: x.week?.altWeekend ? { enabled: true, ...x.week.altWeekend } : undefined,
  });
  people.push(adult(a.me, "teal", ctx.uid));
  if (a.partner) people.push(adult(a.partner, "clay"));
  if (a.caregiver) people.push({ id: ctx.personId(n), name: a.caregiver.name, role: "caregiver", color: "ink", order: n++ });
  for (const kid of a.kids) people.push({ id: ctx.personId(n), name: kid, role: "child", order: n++ });

  const partnerCode = ctx.inviteCode();
  let caregiverCode = a.caregiver ? ctx.inviteCode() : undefined;
  while (caregiverCode === partnerCode) caregiverCode = ctx.inviteCode();

  const root: HouseholdRoot = {
    name: a.householdName,
    timeZone: a.timeZone,
    schemaVersion: SCHEMA_VERSION,
    childcare: a.kids.length > 0,
    memberUids: [ctx.uid],
    memberNames: { [ctx.uid]: name(ctx.accountName || a.me.name, "Your name") },
    roles: { [ctx.uid]: "admin" },
    inviteCode: partnerCode,
    createdBy: ctx.uid,
    // WVU game days were built for one family; a new household doesn't get them.
    wvuFootball: false,
  };

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
    commuteHome: a.integrations.commuteHome,
  };
}

/**
 * Create the household: the household record first (which makes the caller
 * its admin, so the rules allow the rest), then its invite codes, records
 * and commute home.
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
  if (h.commuteHome) {
    await store.write([{ op: "merge", path: `${hh}/private/commute`, data: { home: h.commuteHome } }]);
  }
}
