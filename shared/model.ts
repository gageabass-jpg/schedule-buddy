// The household data model for any household (docs/data-model.md).
//
// Replaces the single households/{id}/state/main record, which is built for
// exactly Gage, Kaylene and Daisy (fixed G/K/D keys) and rewritten whole on
// every edit. Here each thing a household holds is its own document, keyed by
// id, and every person is a record rather than a hard-coded slot:
//
//   households/{hid}                   HouseholdRoot — name, time zone, members
//   households/{hid}/people/{pid}      Person — adults, caregivers, children
//   households/{hid}/shiftTypes/{id}   ShiftType (unchanged shape)
//   households/{hid}/shifts/{id}       DatedShift — one person, one date
//   households/{hid}/events/{id}       LifeEvent
//   households/{hid}/coverageRequests/{id}, caregiverRequests/{id},
//     scheduleBlocks/{id}, caregiverOff/{id}, occasions/{id},
//     shiftOffers/{id}, imports/{id}
//   households/{hid}/settings/main     HouseholdSettings (admin/partner only)
//
// Pure types and ids — no Firebase — so the phone, the Mac app and the
// functions share one definition.

import type {
  CaregiverBlackout, CaregiverRequest, CoverageRequest, OccasionEntry,
  PaydaySchedule, PersonWeeklyTemplate, ShiftType,
} from "./state";

export const SCHEMA_VERSION = 2;

/**
 * What a person is to the household, which decides what the schedule does
 * with them:
 *   adult     — works shifts; the kids are covered while any adult is free
 *   caregiver — covers the kids when no adult can; their own shifts (classes,
 *               work) are time they can't cover
 *   child     — needs covering; owns no shifts and no colour
 */
export type PersonRole = "adult" | "caregiver" | "child";

/**
 * A person's colour, as a token from the design palette rather than a hex, so
 * a theme can change what it looks like. Children never get one.
 */
export type PersonColor = "teal" | "clay" | "ink" | string;

export interface Person {
  /** Stable id (p_…). Never a name: names change and aren't unique. */
  id: string;
  name: string;
  role: PersonRole;
  /** The signed-in account this person is, if they have one. */
  uid?: string;
  color?: PersonColor;
  /** Cloud Storage path of their photo. Absent = initials. */
  photoPath?: string;
  /** Display order, lowest first. */
  order: number;
  /** Where they work; a shift's "where" when the shift doesn't name one. */
  employer?: string;
  payday?: PaydaySchedule;
  /** Their recurring week. */
  weekly?: PersonWeeklyTemplate;
  /** Every-other-weekend pattern, which overrides Saturday and Sunday of the
   *  weekly template: on weekends an even number of weeks from `refSat` they
   *  work `sat`/`sun`, on the others they're off. */
  altWeekend?: { enabled: boolean; refSat: string; sat: string | null; sun: string | null };
  /** Weekly times a caregiver can't cover. */
  blackouts?: CaregiverBlackout[];
}

/**
 * One person's shift on one date, outside (or instead of) their weekly
 * pattern.
 *   replace — this date's shift instead of the pattern (shiftTypeId null =
 *             off that day). At most one per person per date.
 *   add     — an extra shift on top of whatever the pattern gives (overtime,
 *             a one-off, a class).
 */
export interface DatedShift {
  id: string;
  personId: string;
  date: string;                   // YYYY-MM-DD
  mode: "replace" | "add";
  shiftTypeId: string | null;
  /** Free text; for a shift with no type (a class) it is the chip label. */
  label?: string;
  note?: string;
  where?: string;
  /** Picked up beyond the regular schedule. */
  overtime?: boolean;
  /** Who else is on (overtime). */
  coworkers?: string;
  createdAt?: number;
}

export interface LifeEvent {
  id: string;
  date: string;
  startTime?: string;
  endTime?: string;
  title: string;
  /** Who it's for. Absent = the whole family. */
  personId?: string;
  notes?: string;
  seriesId?: string;
  pending?: boolean;
  sourceRequestId?: string;
  healthId?: string;
}

/** A coverage request, now naming which caregiver it asks. */
export interface CoverageRequestDoc extends CoverageRequest {
  caregiverId?: string;
}

export interface ScheduleBlockDoc {
  id: string;
  /** Whose time it is. Absent = the whole household. */
  personId?: string;
  startDate: string;
  endDate: string;
  label?: string;
  notes?: string;
  createdAt: number;
  createdBy: string;
}

/** A date a caregiver is off, so nobody is available for the kids. */
export interface CaregiverOffDay {
  id: string;
  personId: string;
  date: string;
  label?: string;
}

/** An extra shift someone has been offered and hasn't taken yet. */
export interface ShiftOffer {
  id: string;
  personId: string;
  date: string;
  shiftTypeId: string;
  coworkers: string;
}

/** A schedule-photo import. Its photo lives in Storage, not the record. */
export interface ImportDoc {
  id: string;
  photoPath?: string;
  [field: string]: unknown;
}

/** households/{hid}: who's in it and the facts every member may see. */
export interface HouseholdRoot {
  name?: string;
  timeZone?: string;
  schemaVersion: number;
  /** The household needs childcare planning (it has kids). */
  childcare: boolean;
  memberUids: string[];
  memberNames: Record<string, string>;
  roles: Record<string, "admin" | "partner" | "supporting">;
  inviteCode?: string;
  createdBy: string;
}

/** households/{hid}/settings/main — admin/partner only. */
export interface HouseholdSettings {
  calName?: string;
  range?: { from: string; to: string };
  shareEnabled?: boolean;
  shareToken?: string;
  /** Legacy one-shot data fixes already applied. */
  migrations?: string[];
}

/** A whole household in the new model, as the converter and tests see it. */
export interface HouseholdModel {
  root: HouseholdRoot;
  settings: HouseholdSettings;
  people: Person[];
  shiftTypes: ShiftType[];
  shifts: DatedShift[];
  events: LifeEvent[];
  coverageRequests: CoverageRequestDoc[];
  caregiverRequests: CaregiverRequest[];
  scheduleBlocks: ScheduleBlockDoc[];
  caregiverOff: CaregiverOffDay[];
  occasions: OccasionEntry[];
  shiftOffers: ShiftOffer[];
  imports: ImportDoc[];
}

export function newPersonId(): string {
  return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function newShiftId(): string {
  return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
