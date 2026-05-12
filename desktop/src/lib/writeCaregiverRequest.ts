import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import type {
  CaregiverRequest,
  CaregiverRequestStatus,
  CaregiverRequestType,
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
  await writeState(householdId, { ...current, caregiverRequests: list });
}

export function caregiverRequestTypeLabel(t: CaregiverRequestType): string {
  switch (t) {
    case "schedule-block": return "Schedule block";
    case "shift-conflict": return "Shift conflict";
    case "other":          return "Other";
  }
}

export function caregiverRequestStatusLabel(s: CaregiverRequestStatus): string {
  switch (s) {
    case "new":          return "New";
    case "acknowledged": return "Acknowledged";
    case "dismissed":    return "Dismissed";
  }
}
