import { doc, getDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { auth, db } from "../firebase";

export class JoinHouseholdError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "JoinHouseholdError";
  }
}

/**
 * Resolve an invite code to a household and add the current user as a member.
 *
 * Steps (mirrors BRIDGE.md §3.1 and §3.5):
 *   1. read inviteCodes/{code} → { householdId }
 *   2. on the household doc, arrayUnion(uid) into memberUids AND set
 *      memberNames.{uid} + roles.{uid} (must be one atomic update or the
 *      security rules will reject — they require uid in resource.data.memberUids
 *      OR uid in request.resource.data.memberUids).
 *
 * Returns the householdId so callers can confirm.
 */
export async function joinHousehold(rawCode: string, role: "admin" | "partner" = "partner"): Promise<string> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) {
    throw new JoinHouseholdError("Invite codes are 6 characters: A–Z (no I/O) and 2–9 (no 0/1).");
  }

  const user = auth.currentUser;
  if (!user) {
    throw new JoinHouseholdError("Not signed in.");
  }

  // 1. Resolve code → householdId
  const codeRef = doc(db, "inviteCodes", code);
  let codeSnap;
  try {
    codeSnap = await getDoc(codeRef);
  } catch (e) {
    throw new JoinHouseholdError("Couldn't reach Firebase. Check your connection.", e);
  }
  if (!codeSnap.exists()) {
    throw new JoinHouseholdError("Invite code not found.");
  }
  const data = codeSnap.data() as { householdId?: string } | undefined;
  const householdId = data?.householdId;
  if (!householdId) {
    throw new JoinHouseholdError("Invite code is missing a household reference.");
  }

  // 2. Add self to the household
  const displayName = user.displayName || user.email || "Member";
  const householdRef = doc(db, "households", householdId);
  try {
    await updateDoc(householdRef, {
      memberUids: arrayUnion(user.uid),
      [`memberNames.${user.uid}`]: displayName,
      [`roles.${user.uid}`]: role,
    });
  } catch (e) {
    throw new JoinHouseholdError("Couldn't join the household. The code may be valid but the household no longer exists.", e);
  }

  return householdId;
}
