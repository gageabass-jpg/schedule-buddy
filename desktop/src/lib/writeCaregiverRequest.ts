import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import type {
  CaregiverRequest,
  CaregiverRequestStatus,
  CaregiverRequestType,
  Event,
  HouseholdState,
} from "../state";

export class CaregiverRequestError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "CaregiverRequestError";
  }
}

async function readState(householdId: string): Promise<HouseholdState> {
  const ref = doc(db, "households", householdId, "state", "main");
  let snap;
  try { snap = await getDoc(ref); }
  catch (e) { throw new CaregiverRequestError("Couldn't read the household.", e); }
  if (!snap.exists()) throw new CaregiverRequestError("Schedule document doesn't exist yet.");
  return snap.data() as HouseholdState;
}

async function writeState(householdId: string, next: HouseholdState): Promise<void> {
  const ref = doc(db, "households", householdId, "state", "main");
  try { await setDoc(ref, next); }
  catch (e) { throw new CaregiverRequestError("Couldn't save caregiver request.", e); }
}

export async function updateCaregiverRequest(
  householdId: string,
  id: string,
  patch: Partial<Pick<CaregiverRequest, "status" | "acknowledgedAt" | "acknowledgedBy">>,
): Promise<void> {
  const current = await readState(householdId);
  const list = [...(current.caregiverRequests ?? [])];
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) throw new CaregiverRequestError("That request no longer exists.");
  list[idx] = { ...list[idx], ...patch };
  await writeState(householdId, { ...current, caregiverRequests: list });
}

export async function acknowledgeCaregiverRequest(
  householdId: string,
  id: string,
): Promise<void> {
  await updateCaregiverRequest(householdId, id, {
    status: "acknowledged",
    acknowledgedAt: Date.now(),
    ...(auth.currentUser?.uid ? { acknowledgedBy: auth.currentUser.uid } : {}),
  });
}

/** Acknowledge many rows in a single state-doc write. Skips rows that
 *  aren't currently "new" so we don't accidentally re-stamp earlier
 *  acknowledgments. */
export async function bulkAcknowledgeCaregiverRequests(
  householdId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const targets = new Set(ids);
  const current = await readState(householdId);
  const list = [...(current.caregiverRequests ?? [])];
  const now = Date.now();
  const byUid = auth.currentUser?.uid;
  let updated = 0;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r || !targets.has(r.id) || r.status !== "new") continue;
    list[i] = {
      ...r,
      status: "acknowledged",
      acknowledgedAt: now,
      ...(byUid ? { acknowledgedBy: byUid } : {}),
    };
    updated++;
  }
  if (updated > 0) {
    await writeState(householdId, { ...current, caregiverRequests: list });
  }
  return updated;
}

export async function dismissCaregiverRequest(
  householdId: string,
  id: string,
): Promise<void> {
  await updateCaregiverRequest(householdId, id, {
    status: "dismissed",
    acknowledgedAt: Date.now(),
    ...(auth.currentUser?.uid ? { acknowledgedBy: auth.currentUser.uid } : {}),
  });
}

export async function deleteCaregiverRequest(
  householdId: string,
  id: string,
): Promise<void> {
  const current = await readState(householdId);
  const list = (current.caregiverRequests ?? []).filter((r) => r.id !== id);
  // Also drop any still-pending event this request auto-posted (a confirmed
  // event has already lost its sourceRequestId, so it survives).
  const events = (current.events ?? []).filter((e) => !(e.pending && e.sourceRequestId === id));
  await writeState(householdId, { ...current, caregiverRequests: list, events });
}

/** True if a "Life" request still has an unconfirmed event on the calendar. */
export function hasPendingLifeEvent(state: HouseholdState | null, requestId: string): boolean {
  return (state?.events ?? []).some((e) => e.pending && e.sourceRequestId === requestId);
}

/** Confirm a caregiver "Life" request: clear the pending flag on its
 *  auto-posted event (so it becomes a normal calendar item) and mark the
 *  request acknowledged — one atomic state write. */
export async function confirmLifeRequest(householdId: string, id: string): Promise<void> {
  const current = await readState(householdId);
  const requests = [...(current.caregiverRequests ?? [])];
  const idx = requests.findIndex((r) => r.id === id);
  if (idx < 0) throw new CaregiverRequestError("That request no longer exists.");
  requests[idx] = {
    ...requests[idx],
    status: "acknowledged",
    acknowledgedAt: Date.now(),
    ...(auth.currentUser?.uid ? { acknowledgedBy: auth.currentUser.uid } : {}),
  };
  const events = (current.events ?? []).map((e) => {
    if (e.sourceRequestId !== id) return e;
    const { pending: _p, sourceRequestId: _s, ...rest } = e;
    void _p; void _s;
    return rest as Event;
  });
  await writeState(householdId, { ...current, caregiverRequests: requests, events });
}

/** Reject a caregiver "Life" request: delete its auto-posted event and mark
 *  the request dismissed — one atomic state write. */
export async function rejectLifeRequest(householdId: string, id: string): Promise<void> {
  const current = await readState(householdId);
  const requests = [...(current.caregiverRequests ?? [])];
  const idx = requests.findIndex((r) => r.id === id);
  if (idx < 0) throw new CaregiverRequestError("That request no longer exists.");
  requests[idx] = {
    ...requests[idx],
    status: "dismissed",
    acknowledgedAt: Date.now(),
    ...(auth.currentUser?.uid ? { acknowledgedBy: auth.currentUser.uid } : {}),
  };
  const events = (current.events ?? []).filter((e) => e.sourceRequestId !== id);
  await writeState(householdId, { ...current, caregiverRequests: requests, events });
}

export function caregiverRequestTypeLabel(t: CaregiverRequestType): string {
  switch (t) {
    case "schedule-block": return "Schedule block";
    case "shift-conflict": return "Shift conflict";
    // The caregiver-facing app labels this type "Life" (a life event to add to
    // the calendar); keep the manager side consistent.
    case "other":          return "Life";
  }
}

export function caregiverRequestStatusLabel(s: CaregiverRequestStatus): string {
  switch (s) {
    case "new":          return "New";
    case "acknowledged": return "Acknowledged";
    case "dismissed":    return "Dismissed";
  }
}
