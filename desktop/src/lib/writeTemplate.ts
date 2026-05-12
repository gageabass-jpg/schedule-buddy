import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { HouseholdState } from "../state";

export class WriteTemplateError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WriteTemplateError";
  }
}

/**
 * Replace self's weekly template (state.template) with the given 7-entry
 * array. Index 0 = Sunday, 6 = Saturday. Each entry is either a
 * shiftTypeId or null (= off).
 *
 * Uses the whole-document overwrite pattern from BRIDGE.md §5.1 so the iOS
 * app's strict allowlist round-trip stays intact.
 */
export async function writeTemplate(
  householdId: string,
  template: Array<string | null>,
): Promise<void> {
  if (template.length !== 7) {
    throw new WriteTemplateError("Template must have exactly 7 entries (Sun..Sat).");
  }

  const ref = doc(db, "households", householdId, "state", "main");
  let current: HouseholdState | null;
  try {
    const snap = await getDoc(ref);
    current = snap.exists() ? (snap.data() as HouseholdState) : null;
  } catch (e) {
    throw new WriteTemplateError("Couldn't read the household schedule.", e);
  }
  if (!current) {
    throw new WriteTemplateError("Schedule document doesn't exist yet — open the iOS app once to initialize it.");
  }

  const next: HouseholdState = { ...current, template: [...template] };

  try {
    await setDoc(ref, next);
  } catch (e) {
    throw new WriteTemplateError("Couldn't save the template. Check your connection and try again.", e);
  }
}
