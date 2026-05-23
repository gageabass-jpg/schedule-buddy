// Mirrors households/{id}/state/main — see BRIDGE.md §3.2 for the contract.

import { fmtDate, type ShiftMap, type Who, type Shift, type ShiftSource } from "./data";

export interface ShiftType {
  id: string;
  name: string;
  start: string;        // "HH:MM" 24h
  end: string;          // "HH:MM" 24h
  crossesMidnight: boolean;
  /**
   * Hours of sleep needed AFTER this shift ends. Used by the coverage
   * engine so a parent counts as "unavailable to watch the kid" during
   * both their working window AND their post-shift sleep window.
   *
   * Typical night-shift values: 6–8. Day shifts: 0.
   * Optional + absent both mean 0 (legacy types).
   */
  sleepHours?: number;
}

export interface OTShift {
  date: string;         // YYYY-MM-DD
  shiftTypeId: string;
  label: string;
  coworkers?: string;
}

export interface OTOpportunity {
  date: string;
  shiftTypeId: string;
  coworkers: string;
}

export interface Override {
  date: string;
  shiftTypeId: string | null;   // null = "this day is off"
  label: string;
}

export interface PartnerShift {
  date: string;
  shiftTypeId: string;
  label: string;
}

export interface CaregiverBlackout {
  dow: number;          // 0..6 (Sun..Sat)
  start: string;
  end: string;
}

/** Dated shift for a dependent (e.g., Daisy at school). */
export interface DependentShift {
  date: string;        // YYYY-MM-DD
  shiftTypeId?: string;   // optional, if school has named blocks
  label: string;       // free text — e.g. "school", "half day", "field trip"
}

export interface DependentBlock {
  name: string;
  shifts: DependentShift[];
}

/** Audit entry written each time the desktop imports a schedule photo. */
export interface ImportRecord {
  id: string;                  // unique import id
  scheduleId: string;          // matches a SCHEDULE_IMPORTS entry id
  importedAt: number;          // epoch ms
  importedBy?: string;         // uid of the user who triggered the import
  monthCovered?: string;       // YYYY-MM if Claude detected one
  addedDates: string[];        // dates added or replaced by this import
  noteCount: number;           // total shifts written
}

export type EventWho = "G" | "K" | "Daisy" | "family";

/** A personal appointment / non-work commitment that lives alongside shifts. */
export interface Event {
  id: string;                  // ev_<random>
  date: string;                // YYYY-MM-DD
  startTime?: string;          // HH:MM, omitted = all-day
  endTime?: string;            // HH:MM
  title: string;
  who: EventWho;
  notes?: string;
  /** Shared by every Event created in a single batch (multi-day / recurring).
   *  Lets the user "Delete series" without hunting each occurrence. */
  seriesId?: string;
}

export function generateEventId(): string {
  return `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function generateSeriesId(): string {
  return `evs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export type CoverageStatus = "pending" | "confirmed" | "declined" | "issue";

/** A request authored by a Contributing member asking a Supporting caregiver
 *  to cover a specific time window on a given date. Created in bulk from
 *  the People → Overlap right-click "Send to caregiver" flow. */
export interface CoverageRequest {
  id: string;
  date: string;                 // YYYY-MM-DD
  startTime: string;            // HH:MM — when coverage begins
  endTime: string;              // HH:MM — when coverage ends (may be next-day)
  /** True if endTime is on the next calendar day (e.g. shift 7p → 7a). */
  endsNextDay?: boolean;
  /** Optional "arrive by" override — earlier than startTime. */
  arriveBy?: string;            // HH:MM
  notes?: string;
  status: CoverageStatus;
  createdAt: number;            // epoch ms
  createdBy?: string;           // uid of the contributing member who sent it
  /** Caregiver uid once we have caregiver accounts wired. */
  caregiverUid?: string;
  /** Free-text response from the caregiver when they accept / report an issue. */
  caregiverNote?: string;
  /** Why coverage is needed — populated by the overlap engine. */
  reason?: "both-working" | "work-and-sleep" | "both-sleeping";
  /**
   * True once a manager has acknowledged a declined / issue response.
   * Declined+!reviewed entries stay visible on the caregiver's Schedule
   * pane (red) so they don't worry the family missed the news; once
   * reviewed, the row falls off their schedule but stays in the
   * manager's full history.
   */
  managerReviewed?: boolean;
  managerReviewedAt?: number;
  managerReviewedBy?: string;
}

export type CaregiverRequestType = "schedule-block" | "shift-conflict" | "other";
export type CaregiverRequestStatus = "new" | "acknowledged" | "dismissed";

/**
 * A request authored by the *caregiver* and surfaced in the manager's
 * Inbox. The three types map to common reasons a caregiver pings the
 * family:
 *   - schedule-block  → "I can't be available these days/hours"
 *   - shift-conflict  → "Heads up about an existing coverage day"
 *   - other           → free-form ask
 */
export interface CaregiverRequest {
  id: string;
  type: CaregiverRequestType;
  date: string;                  // YYYY-MM-DD
  startTime?: string;            // HH:MM
  endTime?: string;              // HH:MM
  notes?: string;
  status: CaregiverRequestStatus;
  createdAt: number;
  createdBy: string;             // caregiver uid
  createdByName?: string;        // display name snapshot
  acknowledgedAt?: number;
  acknowledgedBy?: string;       // manager uid
}

export function generateCaregiverRequestId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `cr_${Date.now().toString(36)}_${rand}`;
}

export function generateCoverageId(): string {
  return `cov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Recurring payday schedule for a household member. Stored as an anchor
 * date + a cadence so we don't have to maintain a list of every payday.
 * Calendar renderers expand the rule on the fly across the visible window.
 */
export interface PaydaySchedule {
  /** Any ISO date that *is* a payday — usually the next upcoming one. */
  anchor: string;        // YYYY-MM-DD
  /** Cadence at which the payday recurs from the anchor. */
  freq: "weekly" | "biweekly";
}

/** Is the given calendar date a payday under this schedule? */
export function isPaydayOn(dateIso: string, schedule: PaydaySchedule): boolean {
  if (!schedule || !schedule.anchor || !dateIso) return false;
  const [ay, am, ad] = schedule.anchor.split("-").map(Number);
  const [dy, dm, dd] = dateIso.split("-").map(Number);
  if (!ay || !am || !ad || !dy || !dm || !dd) return false;
  // Compute calendar-day delta via UTC noon to dodge DST offsets.
  const anchor = Date.UTC(ay, am - 1, ad);
  const day    = Date.UTC(dy, dm - 1, dd);
  const diffDays = Math.round((day - anchor) / 86_400_000);
  const cycle = schedule.freq === "weekly" ? 7 : 14;
  return diffDays % cycle === 0;
}

export interface HouseholdState {
  shiftTypes: ShiftType[];
  template: Array<string | null>;  // 7 entries, Sun..Sat
  alt: {
    enabled: boolean;
    refSat: string;     // a Saturday self IS scheduled to work
    sat: string | null;
    sun: string | null;
  };
  ot: OTShift[];
  otOpportunities: OTOpportunity[];
  overrides: Override[];
  range: { from: string; to: string };
  calName: string;
  calView: "schedule" | "fatigue" | "childcare" | "couple";
  selfName: string;
  partner: { name: string; shifts: PartnerShift[] };
  caregiverBlackouts: CaregiverBlackout[];
  ui: { calLayout: string; viewMonth: string; viewWeekStart: string };
  /** Dependents (kids, pets, etc) — schedules written by the desktop manager
   *  via photo import. iOS app round-trips these without rendering them yet. */
  dependents?: { daisy?: DependentBlock };
  /** Audit trail of every photo import the manager has run. */
  imports?: ImportRecord[];
  /** Personal appointments / non-work commitments. */
  events?: Event[];
  /** Display name for the household (e.g. "Bass Household"). */
  householdName?: string;
  /** Coverage requests authored by contributing members for caregivers. */
  coverageRequests?: CoverageRequest[];
  /** Requests authored by caregivers — Schedule Block / Shift Conflict / Other.
   *  Surfaced in the manager's Inbox. */
  caregiverRequests?: CaregiverRequest[];
  /** Per-person recurring payday rules. Calendar cells render a $ icon
   *  on dates that match. */
  paydays?: {
    G?: PaydaySchedule;
    K?: PaydaySchedule;
  };
  /** Special occasions surfaced on the wall display's hero line as
   *  colored flair (birthdays, anniversaries, holidays). Paydays are
   *  computed separately from `paydays` above and not stored here. */
  occasions?: OccasionEntry[];
  /** Optional last day the recurring weekly template (and alt-weekend
   *  pattern) applies, as "YYYY-MM-DD" (inclusive). After this date the
   *  template stops producing shifts — one-off overrides and OT still
   *  show. Absent = the template recurs indefinitely. */
  templateEndDate?: string;
  _migrations: string[];
}

export type OccasionType = "birthday" | "anniversary" | "holiday";

export interface OccasionEntry {
  id: string;
  date: string;          // YYYY-MM-DD
  label: string;         // "Daisy's birthday", "Thanksgiving"
  type: OccasionType;
  /** If true, repeats every year on the same month-day (year ignored). */
  annual?: boolean;
}

export interface HouseholdMeta {
  id: string;
  memberUids: string[];
  memberNames: Record<string, string>;
  roles: Record<string, "admin" | "partner" | "supporting">;
  inviteCode: string;
  createdBy: string;
}

// Compact a "HH:MM" timestamp like the iOS app's compactTime: "07:00" → "7a"
// "15:00" → "3p" "23:00" → "11p" "00:00" → "12a" "12:00" → "12p"
export function compactTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr) || 0;
  const m = Number(mStr) || 0;
  const mSuffix = m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
  if (h === 0) return `12${mSuffix}a`;
  if (h === 12) return `12${mSuffix}p`;
  if (h < 12) return `${h}${mSuffix}a`;
  return `${h - 12}${mSuffix}p`;
}

function shiftTypeMap(state: HouseholdState): Record<string, ShiftType> {
  const out: Record<string, ShiftType> = {};
  for (const t of state.shiftTypes) out[t.id] = t;
  return out;
}

function chipLabel(types: Record<string, ShiftType>, id: string | null | undefined): string | null {
  if (!id) return null;
  const t = types[id];
  return t ? compactTime(t.start) : null;
}

interface ResolvedSelfShift {
  shiftTypeId: string | null;
  source: ShiftSource;
}

// Self's shift for a given date, applying the template + alt-weekend pattern +
// overrides. Also reports which layer the value came from so the UI can know
// whether the chip is template-derived or a one-off.
function selfShiftId(state: HouseholdState, dateISO: string): ResolvedSelfShift {
  const ov = state.overrides.find((o) => o.date === dateISO);
  if (ov !== undefined) return { shiftTypeId: ov.shiftTypeId, source: { kind: "override" } };

  // If the recurring template has an end date and this date is past it,
  // the template (and alt-weekend) no longer apply. Overrides above and OT
  // elsewhere still show — they're explicit per-date picks.
  if (state.templateEndDate && dateISO > state.templateEndDate) {
    return { shiftTypeId: null, source: { kind: "template" } };
  }

  const [y, mo, d] = dateISO.split("-").map(Number);
  const dow = new Date(y, mo - 1, d).getDay();

  if (state.alt?.enabled && state.alt.refSat) {
    const refMs = new Date(state.alt.refSat).getTime();
    const dateMs = new Date(dateISO).getTime();
    const weeksFromRef = Math.round((dateMs - refMs) / (1000 * 60 * 60 * 24 * 7));
    const onWorkingWeekend = weeksFromRef % 2 === 0;
    if (dow === 6) {
      return {
        shiftTypeId: onWorkingWeekend ? state.alt.sat : null,
        source: { kind: "alt-weekend" },
      };
    }
    if (dow === 0) {
      return {
        shiftTypeId: onWorkingWeekend ? state.alt.sun : null,
        source: { kind: "alt-weekend" },
      };
    }
  }

  return { shiftTypeId: state.template[dow] ?? null, source: { kind: "template" } };
}

/**
 * Build a date → Shift[] map for the visible window from a live HouseholdState.
 * Includes self's recurring + overrides + accepted OT, plus partner's dated
 * shifts. windowFrom/windowTo bracket the calendar view.
 */
export function buildShiftMap(
  state: HouseholdState,
  windowFrom: string,
  windowTo: string,
): ShiftMap {
  const out: ShiftMap = {};
  const types = shiftTypeMap(state);

  // Iterate every day in the window.
  const [fy, fm, fd] = windowFrom.split("-").map(Number);
  const [ty, tm, td] = windowTo.split("-").map(Number);
  const start = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);

  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const key = fmtDate(cur.getFullYear(), cur.getMonth(), cur.getDate());
    const resolved = selfShiftId(state, key);
    const label = chipLabel(types, resolved.shiftTypeId);
    if (label && resolved.shiftTypeId) {
      push(out, key, {
        who: "G",
        label,
        source: resolved.source,
        shiftTypeId: resolved.shiftTypeId,
      });
    }
  }

  // Accepted OT (self) — additive on top of template.
  state.ot.forEach((o, index) => {
    const label = chipLabel(types, o.shiftTypeId);
    if (label) push(out, o.date, {
      who: "G",
      label,
      source: { kind: "ot", index },
      shiftTypeId: o.shiftTypeId,
    });
  });

  // Partner shifts.
  (state.partner?.shifts ?? []).forEach((p, index) => {
    const label = chipLabel(types, p.shiftTypeId);
    if (label) push(out, p.date, {
      who: "K",
      label,
      source: { kind: "partner", index },
      shiftTypeId: p.shiftTypeId,
    });
  });

  return out;
}

function push(map: ShiftMap, key: string, shift: Shift): void {
  if (!map[key]) map[key] = [];
  map[key].push(shift);
}

// Map self vs partner to the G/K "who" used everywhere in the UI.
// In demo mode, self is always G and partner is K — same assumption the iOS
// app currently makes. If we ever support N-person households this gets
// reshaped (BRIDGE.md §10).
export type SelfPartnerWho = Who;
