import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";

export type InviteRole = "contributing" | "supporting";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // matches BRIDGE.md §8 (no I, O, 0, 1)

export class InviteCodeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "InviteCodeError";
  }
}

function genCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

/**
 * Create a fresh invite code in the global inviteCodes collection that pins
 * the redeemer to a specific role on the household. Returns the 6-char code
 * to display + copy.
 *
 *   role: "contributing" → caller joins as partner (full schedule access)
 *   role: "supporting"   → caller joins as supporting (caregiver, coverage
 *                           requests only)
 *
 * Per BRIDGE.md §3.5, inviteCodes is read+create only; we never overwrite.
 * On the rare 6-char collision we retry up to 5x.
 */
export async function createInviteCode(
  householdId: string,
  role: InviteRole,
): Promise<string> {
  if (!auth.currentUser) throw new InviteCodeError("Not signed in.");

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();
    const ref = doc(db, "inviteCodes", code);
    try {
      await setDoc(ref, {
        householdId,
        role,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser.uid,
      });
      return code;
    } catch (e) {
      // Likely a collision or permissions issue. Retry on the next loop;
      // surface the error if we exhaust attempts.
      if (attempt === 4) {
        throw new InviteCodeError("Couldn't generate a unique code. Try again.", e);
      }
    }
  }
  throw new InviteCodeError("Couldn't generate a unique code. Try again.");
}
