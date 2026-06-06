// Thin client wrapper around the cleanSchedule Cloud Function.
// Uploads an image (base64), receives parsed shifts back, and exposes
// a diffing helper that turns those parsed shifts into add/remove/change
// rows against the current household state.

import { getFunctions, httpsCallable } from "firebase/functions";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { app as firebaseApp, db } from "../firebase";
import type { HouseholdState } from "../state";

export interface ParsedShift {
  date: string;
  who: "G" | "K";
  shiftTypeId: string;
  label: string;
}

export interface CleanScheduleResult {
  shifts: ParsedShift[];
  dateRange?: { from: string; to: string };
  note?: string;
}

const fns = getFunctions(firebaseApp, "us-central1");
const callClean = httpsCallable<
  { imageBase64: string; imageMediaType: string; who: "G" | "K" },
  CleanScheduleResult
>(fns, "cleanSchedule");

export async function cleanSchedule(
  imageBase64: string,
  imageMediaType: "image/jpeg" | "image/png" | "image/webp",
  who: "G" | "K",
): Promise<CleanScheduleResult> {
  const r = await callClean({ imageBase64, imageMediaType, who });
  return r.data;
}

// ─────────────────── diff ───────────────────

export type DiffKind = "add" | "remove" | "change";

export interface DiffEntry {
  kind: DiffKind;
  date: string;
  who: "G" | "K";
  /** For "add" / "change": the new shift. For "remove": null. */
  next: ParsedShift | null;
  /** For "remove" / "change": the existing shift summary. For "add": null. */
  prev: { shiftTypeId: string; label: string; source: "template" | "override" | "ot" | "partner" } | null;
}

/**
 * Walk the parsed shifts (from a cleaner upload) against current state
 * and emit a diff. Scope is the date range covered by `parsed` — we
 * only consider existing shifts whose date falls inside that range.
 *
 * For "G" uploads we compare against template + overrides + ot.
 * For "K" uploads we compare against partner.shifts.
 *
 * One parsed shift per (date) is assumed — the cleaner's source of
 * truth is a single schedule type per day. OT shifts (a 2nd shift on
 * the same day for "G") are deliberately not produced by the cleaner.
 */
export function diffParsedAgainstState(
  parsed: ParsedShift[],
  state: HouseholdState,
): DiffEntry[] {
  if (parsed.length === 0) return [];

  // Determine the cover window.
  const dates = parsed.map((p) => p.date).sort();
  const from = dates[0];
  const to   = dates[dates.length - 1];
  const who  = parsed[0].who;

  const byDate = new Map<string, ParsedShift>();
  for (const p of parsed) byDate.set(p.date, p);

  // Build the existing map: date → { shiftTypeId, label, source } for this `who`.
  const existing = new Map<string, DiffEntry["prev"]>();

  if (who === "G") {
    // Template recurrence (day-of-week → shiftTypeId)
    const template = state.template ?? [];
    const overrides = state.overrides ?? [];
    const ot = state.ot ?? [];

    // Walk every date in [from, to] and resolve the effective G shift.
    let cursor = from;
    let safety = 0;
    while (cursor <= to && safety < 400) {
      const override = overrides.find((o) => o.date === cursor);
      if (override) {
        if (override.shiftTypeId) {
          existing.set(cursor, {
            shiftTypeId: override.shiftTypeId,
            label: override.label,
            source: "override",
          });
        }
        // override with null = explicitly off; treat as "no existing"
      } else {
        const [y, m, d] = cursor.split("-").map(Number);
        const dow = new Date(y!, m! - 1, d!).getDay();
        const id = template[dow];
        if (id) {
          const stype = (state.shiftTypes ?? []).find((s) => s.id === id);
          existing.set(cursor, {
            shiftTypeId: id,
            label: stype?.name ?? "",
            source: "template",
          });
        }
      }
      // OT can add an *additional* shift — we don't surface those as
      // candidates for change, they pass through untouched.
      const nx = new Date(Date.UTC(
        Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)) - 1, Number(cursor.slice(8, 10)) + 1,
      ));
      cursor = `${nx.getUTCFullYear()}-${String(nx.getUTCMonth() + 1).padStart(2, "0")}-${String(nx.getUTCDate()).padStart(2, "0")}`;
      safety++;
      // (ot is intentionally unread — see comment above)
      void ot;
    }
  } else {
    // Partner shifts are an explicit per-date list, no recurrence.
    for (const s of state.partner?.shifts ?? []) {
      if (s.date >= from && s.date <= to) {
        existing.set(s.date, {
          shiftTypeId: s.shiftTypeId,
          label: s.label,
          source: "partner",
        });
      }
    }
  }

  // Now diff.
  const out: DiffEntry[] = [];

  // Adds + Changes (walk parsed)
  for (const [date, p] of byDate.entries()) {
    const ex = existing.get(date);
    if (!ex) {
      out.push({ kind: "add", date, who, next: p, prev: null });
    } else if (ex.shiftTypeId !== p.shiftTypeId) {
      out.push({ kind: "change", date, who, next: p, prev: ex });
    }
    // identical → no entry
  }

  // Removes (walk existing for dates parsed didn't include — only if
  // the parsed schedule explicitly covers that date and shows it as
  // off. Since we filter "off" out at parse time, "absence" in parsed
  // means "removed".)
  for (const [date, ex] of existing.entries()) {
    if (!byDate.has(date)) {
      out.push({ kind: "remove", date, who, next: null, prev: ex });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ─────────────────── apply ───────────────────

/**
 * Apply a set of approved diff entries to state in a single Firestore
 * write (one read-modify-write round-trip). Avoids the listener storm
 * that per-diff writes would cause.
 *
 * For G:
 *   add    → push to overrides (replacing any existing on that date)
 *   change → replace existing override / write a new one
 *   remove → push an override with shiftTypeId=null (= explicit off)
 *
 * For K (partner.shifts):
 *   add    → push to partner.shifts
 *   change → replace the matching entry by date
 *   remove → splice the matching entry by date
 */
export async function applyCleanerDiffs(
  householdId: string,
  approved: DiffEntry[],
): Promise<void> {
  if (approved.length === 0) return;
  const ref = doc(db, "households", householdId, "state", "main");
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("State document doesn't exist yet.");
  const current = snap.data() as HouseholdState;

  // Deep copy the arrays we'll mutate so we don't accidentally
  // poison the cached state object via reference sharing.
  const next: HouseholdState = {
    ...current,
    overrides:       [...(current.overrides ?? [])],
    partner:         { ...current.partner, shifts: [...(current.partner?.shifts ?? [])] },
  };

  for (const d of approved) {
    if (d.who === "G") {
      const idx = next.overrides.findIndex((o) => o.date === d.date);
      if (d.kind === "add" || d.kind === "change") {
        if (!d.next) continue;
        const entry = { date: d.date, shiftTypeId: d.next.shiftTypeId, label: d.next.label };
        if (idx >= 0) next.overrides[idx] = entry;
        else next.overrides.push(entry);
      } else {
        // remove → explicit off
        const offEntry = { date: d.date, shiftTypeId: null, label: "off" };
        if (idx >= 0) next.overrides[idx] = offEntry;
        else next.overrides.push(offEntry);
      }
    } else {
      const idx = next.partner.shifts.findIndex((s) => s.date === d.date);
      if (d.kind === "add" || d.kind === "change") {
        if (!d.next) continue;
        const entry = { date: d.date, shiftTypeId: d.next.shiftTypeId, label: d.next.label };
        if (idx >= 0) next.partner.shifts[idx] = entry;
        else next.partner.shifts.push(entry);
      } else if (d.kind === "remove" && idx >= 0) {
        next.partner.shifts.splice(idx, 1);
      }
    }
  }

  await setDoc(ref, next);
}
