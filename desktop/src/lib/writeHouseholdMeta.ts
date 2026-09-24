import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { HouseholdState } from "../state";

export class WriteHouseholdMetaError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WriteHouseholdMetaError";
  }
}

/**
 * Set the household's display name (rendered in the sidebar pill + Family
 * Console title). Empty string clears the override and falls back to the
 * default in the renderer.
 */
export async function setHouseholdName(householdId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  const ref = doc(db, "households", householdId, "state", "main");
  let snap;
  try { snap = await getDoc(ref); }
  catch (e) { throw new WriteHouseholdMetaError("Couldn't read the household.", e); }
  if (!snap.exists()) throw new WriteHouseholdMetaError("Schedule document doesn't exist yet.");
  const current = snap.data() as HouseholdState;
  const next: HouseholdState = { ...current };
  if (trimmed) next.householdName = trimmed;
  else delete next.householdName;
  try { await setDoc(ref, next); }
  catch (e) { throw new WriteHouseholdMetaError("Couldn't save the household name.", e); }
}

/**
 * Set who a person works for. Shown as a shift's "where" whenever the shift
 * doesn't name its own location, so one edit updates every shift rather than
 * stamping the employer onto each saved entry.
 */
export async function setEmployer(
  householdId: string,
  who: "G" | "K" | "D",
  employer: string,
): Promise<void> {
  const trimmed = employer.trim();
  const ref = doc(db, "households", householdId, "state", "main");
  let snap;
  try { snap = await getDoc(ref); }
  catch (e) { throw new WriteHouseholdMetaError("Couldn't read the household.", e); }
  if (!snap.exists()) throw new WriteHouseholdMetaError("Schedule document doesn't exist yet.");
  const current = snap.data() as HouseholdState;
  const employers = { ...(current.employers ?? {}) };
  if (trimmed) employers[who] = trimmed;
  else delete employers[who];
  const next: HouseholdState = { ...current, employers };
  if (Object.keys(employers).length === 0) delete next.employers;
  try { await setDoc(ref, next); }
  catch (e) { throw new WriteHouseholdMetaError("Couldn't save the employer.", e); }
}
