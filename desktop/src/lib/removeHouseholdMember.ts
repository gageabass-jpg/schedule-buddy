import { doc, updateDoc, arrayRemove, deleteField } from "firebase/firestore";
import { db } from "../firebase";

export class RemoveMemberError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "RemoveMemberError";
  }
}

/**
 * Remove a member from the household doc: drop them from memberUids and
 * clear their entries in memberNames + roles. Does NOT delete their Firebase
 * Auth account — that has to be done by the user themselves from iOS
 * ("Delete my account") or via a Cloud Function with the Admin SDK.
 *
 * The user's historical shifts (in `state/main.shifts`) are intentionally
 * left in place — they're indexed by `who` ("G"/"K"), not by uid, and removing
 * a member should not retroactively erase the schedule they helped author.
 */
export async function removeHouseholdMember(
  householdId: string,
  uid: string,
): Promise<void> {
  if (!householdId) throw new RemoveMemberError("No household linked.");
  if (!uid) throw new RemoveMemberError("Missing member uid.");

  try {
    const ref = doc(db, "households", householdId);
    await updateDoc(ref, {
      memberUids: arrayRemove(uid),
      [`memberNames.${uid}`]: deleteField(),
      [`roles.${uid}`]: deleteField(),
    });
  } catch (e) {
    throw new RemoveMemberError("Couldn't remove that member from the household.", e);
  }
}
