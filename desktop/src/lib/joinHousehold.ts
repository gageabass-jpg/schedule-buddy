import { doc, getDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { auth, db } from "../firebase";

export class JoinHouseholdError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "JoinHouseholdError";
  }
}

export type HouseholdRole = "admin" | "partner" | "supporting";

/**
 * Resolve an invite code to a household and add the current user as a member,
 * applying the role baked into the invite code (Phase 2: "supporting" codes
 * land caregivers like Daisy directly in that role; existing
 * "contributing"-flavored or legacy codes default to "partner").
 *
 * Steps (mirrors BRIDGE.md §3.1 and §3.5):
 *   1. read inviteCodes/{code} → { householdId, role? }
 *   2. on the household doc, arrayUnion(uid) into memberUids AND set
 *      memberNames.{uid} + roles.{uid}.
 *
 * Returns { householdId, role } so callers can confirm.
 */
export async function joinHousehold(
  rawCode: string,
  fallbackRole: HouseholdRole = "partner",
): Promise<{ householdId: string; role: HouseholdRole }> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) {
    throw new JoinHouseholdError("Invite codes are 6 characters: A–Z (no I/O) and 2–9 (no 0/1).");
  }

  const user = auth.currentUser;
  if (!user) {
    throw new JoinHouseholdError("Not signed in.");
  }

  // 1. Resolve code → householdId + role
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
  const data = codeSnap.data() as { householdId?: string; role?: string } | undefined;
  const householdId = data?.householdId;
  if (!householdId) {
    throw new JoinHouseholdError("Invite code is missing a household reference.");
  }
  const codeRole = data?.role;
  const role: HouseholdRole =
    codeRole === "supporting" ? "supporting" :
    codeRole === "contributing" ? "partner" :
    fallbackRole;

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

  return { householdId, role };
}
