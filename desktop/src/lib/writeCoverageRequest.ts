import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import type { CoverageRequest, CoverageStatus, HouseholdState } from "../state";
import { generateCoverageId } from "../state";

export class WriteCoverageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WriteCoverageError";
  }
}

export interface CoverageRequestInput {
  date: string;
  startTime: string;
  endTime: string;
  endsNextDay?: boolean;
  arriveBy?: string;
  notes?: string;
  /** Source of the coverage need — populated by the overlap engine so
   *  the Childcare panel can show why each request was generated. */
  reason?: "both-working" | "work-and-sleep" | "both-sleeping";
}

function validate(input: CoverageRequestInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Date must be YYYY-MM-DD.";
  if (!/^\d{2}:\d{2}$/.test(input.startTime)) return "Start time must be HH:MM.";
  if (!/^\d{2}:\d{2}$/.test(input.endTime)) return "End time must be HH:MM.";
  if (input.arriveBy && !/^\d{2}:\d{2}$/.test(input.arriveBy)) return "Arrive-by must be HH:MM.";
  return null;
}

async function readState(householdId: string): Promise<HouseholdState> {
  const ref = doc(db, "households", householdId, "state", "main");
  let snap;
  try { snap = await getDoc(ref); }
  catch (e) { throw new WriteCoverageError("Couldn't read the household.", e); }
  if (!snap.exists()) throw new WriteCoverageError("Schedule document doesn't exist yet.");
  return snap.data() as HouseholdState;
}

async function writeState(householdId: string, next: HouseholdState): Promise<void> {
  const ref = doc(db, "households", householdId, "state", "main");
  try { await setDoc(ref, next); }
  catch (e) { throw new WriteCoverageError("Couldn't save coverage requests.", e); }
}

function clean(input: CoverageRequestInput): Omit<CoverageRequest, "id" | "status" | "createdAt" | "createdBy"> {
  const out: Omit<CoverageRequest, "id" | "status" | "createdAt" | "createdBy"> = {
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
  };
  if (input.endsNextDay) out.endsNextDay = true;
  if (input.arriveBy) out.arriveBy = input.arriveBy;
  if (input.notes && input.notes.trim()) out.notes = input.notes.trim();
  if (input.reason) out.reason = input.reason;
  return out;
}

/**
 * Add a batch of coverage requests in a single Firestore write — used by the
 * "Send to caregiver" review modal. Every request starts in "pending"; the
 * caregiver later flips them to confirmed / declined / issue.
 */
export async function addCoverageRequests(
  householdId: string,
  inputs: CoverageRequestInput[],
): Promise<string[]> {
  if (inputs.length === 0) throw new WriteCoverageError("Nothing to send.");
  for (const input of inputs) {
    const err = validate(input);
    if (err) throw new WriteCoverageError(err);
  }
  const current = await readState(householdId);
  const list = [...(current.coverageRequests ?? [])];
  const ids: string[] = [];
  const now = Date.now();
  const byUid = auth.currentUser?.uid;
  for (const input of inputs) {
    const id = generateCoverageId();
    ids.push(id);
    const req: CoverageRequest = {
      id,
      ...clean(input),
      status: "pending",
      createdAt: now,
    };
    if (byUid) req.createdBy = byUid;
    list.push(req);
  }
  await writeState(householdId, { ...current, coverageRequests: list });
  return ids;
}

export async function updateCoverageRequest(
  householdId: string,
  id: string,
  patch: Partial<Pick<
    CoverageRequest,
    | "startTime" | "endTime" | "endsNextDay" | "arriveBy" | "notes"
    | "status" | "caregiverNote"
    | "managerReviewed" | "managerReviewedAt" | "managerReviewedBy"
  >>,
): Promise<void> {
  const current = await readState(householdId);
  const list = [...(current.coverageRequests ?? [])];
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) throw new WriteCoverageError("That coverage request no longer exists.");
  list[idx] = { ...list[idx], ...patch };
  await writeState(householdId, { ...current, coverageRequests: list });
}

/** Mark a declined / issue request as reviewed by a manager. The caregiver
 *  stops seeing it on their Schedule pane; the manager still has the full
 *  history in the Childcare panel. */
export async function markCoverageReviewed(
  householdId: string,
  id: string,
  reviewedBy: string | null,
): Promise<void> {
  await updateCoverageRequest(householdId, id, {
    managerReviewed: true,
    managerReviewedAt: Date.now(),
    ...(reviewedBy ? { managerReviewedBy: reviewedBy } : {}),
  });
}

export async function deleteCoverageRequest(householdId: string, id: string): Promise<void> {
  const current = await readState(householdId);
  const list = (current.coverageRequests ?? []).filter((r) => r.id !== id);
  await writeState(householdId, { ...current, coverageRequests: list });
}

export function statusLabel(s: CoverageStatus): string {
  switch (s) {
    case "pending":   return "Pending";
    case "confirmed": return "Confirmed";
    case "declined":  return "Declined";
    case "issue":     return "Issue";
  }
}
