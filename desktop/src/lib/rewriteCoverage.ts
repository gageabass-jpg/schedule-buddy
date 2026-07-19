// Rewrite coverage — refresh stored coverage requests so they match the
// app's latest scheduling logic (multi-window overlap engine + the 2-hour
// arrival lead folded into the start time).
//
// Two outcomes, because a request the caregiver already agreed to can't be
// edited out from under her:
//   - PENDING requests (unanswered)  → rewritten in place.
//   - CONFIRMED requests (she said yes) → a change proposal is attached for
//     her to approve or reject; her agreed times stand until she approves.
//
// Scope rules:
//   - Only requests dated today or later are considered.
//   - Declined / issue requests are left alone entirely.
//   - A confirmed day the latest logic says needs NO coverage is left alone
//     (we don't auto-cancel coverage she already committed to).
//
// Used by the Cleaner modal's "Rewrite" utility.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { buildShiftMap, generateCoverageId } from "../state";
import type { CoverageChangeProposal, CoverageRequest, HouseholdState } from "../state";
import { computeOverlapCandidates, type OverlapReason } from "./computeOverlap";

export const LEAD_TIME_MIN = 120;   // coverage starts 2 hours before the overlap begins

/** "15:00" - 2h → "13:00", clamped at midnight so an early-morning overlap
 *  can't wrap backwards onto the previous day. */
export function startWithLead(startTime: string, offsetMin = LEAD_TIME_MIN): string {
  const [h, m] = startTime.split(":").map(Number);
  const total = Math.max(0, (h || 0) * 60 + (m || 0) - offsetMin);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export interface RewriteWindow {
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  reason?: OverlapReason;
}

/**
 * "rewrite"  — unanswered pending requests on this date get replaced outright.
 * "propose"  — a confirmed request gets a change proposal the caregiver must
 *              approve; `before` holds exactly that one request.
 */
export type RewriteKind = "rewrite" | "propose";

export interface CoverageRewriteEntry {
  /** Stable key for approval toggles (a date can yield both kinds). */
  key: string;
  kind: RewriteKind;
  date: string;
  /** Requests currently stored: the pending set, or the single confirmed one. */
  before: CoverageRequest[];
  /** What the latest logic produces (lead already applied). For "propose"
   *  this is exactly one window. Empty = the day no longer needs coverage. */
  after: RewriteWindow[];
}

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function sameWindows(before: CoverageRequest[], after: RewriteWindow[]): boolean {
  if (before.length !== after.length) return false;
  for (let i = 0; i < before.length; i++) {
    const b = before[i];
    const a = after[i];
    if (b.startTime !== a.startTime) return false;
    if (b.endTime !== a.endTime) return false;
    if (!!b.endsNextDay !== !!a.endsNextDay) return false;
  }
  return true;
}

/**
 * Pure computation: which pending requests differ from what the current
 * engine would generate for their dates? Returns one entry per date that
 * needs rewriting; empty array = everything already matches.
 */
export function computeCoverageRewrite(
  state: HouseholdState,
  todayIso: string,
): CoverageRewriteEntry[] {
  const upcoming = (state.coverageRequests ?? [])
    .filter((r) => (r.status === "pending" || r.status === "confirmed") && r.date >= todayIso);
  if (upcoming.length === 0) return [];

  const dates = Array.from(new Set(upcoming.map((r) => r.date))).sort();

  // Window includes the day before the earliest request so night-shift
  // tails (work + sleep crossing midnight) land correctly.
  const from = addDays(dates[0], -1);
  const to = addDays(dates[dates.length - 1], 1);

  // Defensive normalization — buildShiftMap assumes these arrays exist.
  const st: HouseholdState = {
    ...state,
    template: state.template ?? [],
    overrides: state.overrides ?? [],
    ot: state.ot ?? [],
  };
  const shifts = buildShiftMap(st, from, to);
  const candidates = computeOverlapCandidates(shifts, st);

  const byDate = new Map<string, RewriteWindow[]>();
  for (const c of candidates) {
    const list = byDate.get(c.date) ?? [];
    list.push({
      startTime: startWithLead(c.startTime),
      endTime: c.endTime,
      endsNextDay: c.endsNextDay,
      reason: c.reason,
    });
    byDate.set(c.date, list);
  }

  const out: CoverageRewriteEntry[] = [];
  for (const date of dates) {
    const onDate = upcoming.filter((r) => r.date === date);
    const confirmed = onDate
      .filter((r) => r.status === "confirmed")
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const pending = onDate
      .filter((r) => r.status === "pending")
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const windows = (byDate.get(date) ?? [])
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    // Confirmed requests claim windows first, positionally — she's already
    // committed to a slot on this day, so the nearest equivalent window is
    // the one to propose amending.
    confirmed.forEach((req, i) => {
      const w = windows[i];
      // No matching window → the day needs less coverage than she agreed to.
      // Leave it alone rather than auto-cancelling on her.
      if (!w) return;
      if (sameWindows([req], [w])) return;                    // already correct
      if (proposalMatches(req.proposedChange, w)) return;     // already proposed
      out.push({ key: `propose:${req.id}`, kind: "propose", date, before: [req], after: [w] });
    });

    // Whatever's left over is fair game for the unanswered pending set.
    const leftover = windows.slice(confirmed.length);
    if (!sameWindows(pending, leftover)) {
      // Nothing stored and nothing to add → no entry.
      if (pending.length > 0 || leftover.length > 0) {
        out.push({ key: `rewrite:${date}`, kind: "rewrite", date, before: pending, after: leftover });
      }
    }
  }
  return out;
}

/** True when an existing proposal already says exactly this. */
function proposalMatches(p: CoverageChangeProposal | undefined, w: RewriteWindow): boolean {
  if (!p) return false;
  return p.startTime === w.startTime
    && p.endTime === w.endTime
    && !!p.endsNextDay === !!w.endsNextDay;
}

/**
 * Apply approved entries in a single Firestore write.
 *
 *   "rewrite" → pending requests on that date are replaced by the freshly
 *               computed windows (still pending; notes carried over).
 *   "propose" → the confirmed request keeps its agreed times and gains a
 *               `proposedChange` for the caregiver to approve or reject.
 *
 * Everything else passes through untouched.
 */
export async function applyCoverageRewrite(
  householdId: string,
  entries: CoverageRewriteEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const ref = doc(db, "households", householdId, "state", "main");
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("State document doesn't exist yet.");
  const current = snap.data() as HouseholdState;

  const now = Date.now();
  const uid = auth.currentUser?.uid;

  const rewrites = entries.filter((e) => e.kind === "rewrite");
  const proposals = entries.filter((e) => e.kind === "propose");

  // Drop the pending requests being rewritten; keep everything else.
  const rewriteDates = new Set(rewrites.map((e) => e.date));
  const kept = (current.coverageRequests ?? []).filter(
    (r) => !(r.status === "pending" && rewriteDates.has(r.date)),
  );

  // Attach proposals to their confirmed requests, in place.
  const proposalByReqId = new Map(proposals.map((e) => [e.before[0]?.id, e]));
  for (let i = 0; i < kept.length; i++) {
    const e = proposalByReqId.get(kept[i].id);
    const w = e?.after[0];
    if (!e || !w) continue;
    const proposal: CoverageChangeProposal = {
      startTime: w.startTime,
      endTime: w.endTime,
      proposedAt: now,
    };
    if (w.endsNextDay) proposal.endsNextDay = true;
    if (w.reason) proposal.reason = w.reason;
    if (uid) proposal.proposedBy = uid;
    kept[i] = { ...kept[i], proposedChange: proposal };
  }

  // Add the rewritten pending windows.
  for (const e of rewrites) {
    const carriedNotes = e.before.find((b) => b.notes && b.notes.trim())?.notes;
    for (const w of e.after) {
      const req: CoverageRequest = {
        id: generateCoverageId(),
        date: e.date,
        startTime: w.startTime,
        endTime: w.endTime,
        status: "pending",
        createdAt: now,
      };
      if (w.endsNextDay) req.endsNextDay = true;
      if (w.reason) req.reason = w.reason;
      if (carriedNotes) req.notes = carriedNotes;
      if (uid) req.createdBy = uid;
      kept.push(req);
    }
  }

  await setDoc(ref, { ...current, coverageRequests: kept });
}
