import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { ChildcareOffDay, HouseholdState } from "../state";

export class WriteChildcareError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WriteChildcareError";
  }
}

/** Default label for a no-childcare day when none is supplied. */
export const DEFAULT_CHILDCARE_OFF_LABEL = "Daisy – Scheduled Off";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function readState(householdId: string): Promise<HouseholdState> {
  const ref = doc(db, "households", householdId, "state", "main");
  let snap;
  try { snap = await getDoc(ref); }
  catch (e) { throw new WriteChildcareError("Couldn't read the household.", e); }
  if (!snap.exists()) throw new WriteChildcareError("Schedule document doesn't exist yet.");
  return snap.data() as HouseholdState;
}

async function writeState(householdId: string, next: HouseholdState): Promise<void> {
  const ref = doc(db, "households", householdId, "state", "main");
  try { await setDoc(ref, next); }
  catch (e) { throw new WriteChildcareError("Couldn't save childcare days.", e); }
}

/**
 * Mark a set of dates as "no childcare available" (caregiver off). Idempotent:
 * dates already marked are left untouched (existing label preserved).
 */
export async function setChildcareOff(
  householdId: string,
  dates: string[],
  label?: string,
): Promise<void> {
  const current = await readState(householdId);
  const list: ChildcareOffDay[] = [...(current.childcareOff ?? [])];
  const have = new Set(list.map((c) => c.date));
  const text = label?.trim() || DEFAULT_CHILDCARE_OFF_LABEL;
  for (const date of dates) {
    if (!ISO.test(date) || have.has(date)) continue;
    list.push({ date, label: text });
    have.add(date);
  }
  await writeState(householdId, { ...current, childcareOff: list });
}

/** Remove the no-childcare mark from a set of dates. */
export async function clearChildcareOff(
  householdId: string,
  dates: string[],
): Promise<void> {
  const current = await readState(householdId);
  const drop = new Set(dates);
  const list = (current.childcareOff ?? []).filter((c) => !drop.has(c.date));
  await writeState(householdId, { ...current, childcareOff: list });
}

/** Toggle a single date's no-childcare mark on or off. */
export async function toggleChildcareOff(
  householdId: string,
  date: string,
  off: boolean,
  label?: string,
): Promise<void> {
  return off
    ? setChildcareOff(householdId, [date], label)
    : clearChildcareOff(householdId, [date]);
}
