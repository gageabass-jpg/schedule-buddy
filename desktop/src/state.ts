// Mirrors households/{id}/state/main — see BRIDGE.md §3.2 for the contract.

import { fmtDate, type ShiftMap, type Who, type Shift, type ShiftSource } from "./data";

export interface ShiftType {
  id: string;
  name: string;
  start: string;        // "HH:MM" 24h
  end: string;          // "HH:MM" 24h
  crossesMidnight: boolean;
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
  _migrations: string[];
}

export interface HouseholdMeta {
  id: string;
  memberUids: string[];
  memberNames: Record<string, string>;
  roles: Record<string, "admin" | "partner">;
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
