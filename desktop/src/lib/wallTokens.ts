// Wall display tokens — used by the Raspberry Pi wall.html dashboard.
//
// Each token doc lives at `wallTokens/{token}` (top-level so the
// getWallState HTTPS function can resolve a token → householdId without
// knowing the household). Token doc shape:
//
//     { householdId, createdAt, createdBy, label?, revoked? }
//
// The token IS the document id — a long random base62 string. So a leaked
// URL only exposes the targeted household's read-only dashboard and can
// be revoked instantly.
//
// Firestore rules limit create/read/update/delete to members of the
// referenced household.

import {
  collection, query, where, getDocs, doc, setDoc, updateDoc, deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../firebase";

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const TOKEN_LEN = 32;

export interface WallToken {
  token: string;          // doc id; same string the wall page passes back
  label: string;          // human-readable, e.g. "Kitchen monitor"
  createdAt: number;
  createdBy: string;
  revoked: boolean;
}

class WallTokenError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WallTokenError";
  }
}

function genToken(): string {
  // crypto.getRandomValues for unguessable tokens.
  const buf = new Uint32Array(TOKEN_LEN);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < TOKEN_LEN; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}

/** Create a new wall token for the household. Returns the full token string. */
export async function createWallToken(
  householdId: string,
  label: string,
): Promise<string> {
  if (!auth.currentUser) throw new WallTokenError("Not signed in.");
  if (!householdId) throw new WallTokenError("No household linked.");

  for (let attempt = 0; attempt < 4; attempt++) {
    const tok = genToken();
    try {
      await setDoc(doc(db, "wallTokens", tok), {
        householdId,
        createdAt: Date.now(),
        createdBy: auth.currentUser.uid,
        label: label.trim() || "Wall display",
        revoked: false,
        // Server-side audit timestamp too — useful if local clock drifts.
        serverCreatedAt: serverTimestamp(),
      });
      return tok;
    } catch (e) {
      if (attempt === 3) {
        throw new WallTokenError("Couldn't create wall token.", e);
      }
    }
  }
  throw new WallTokenError("Couldn't create wall token.");
}

/** List every (non-deleted) wall token for this household. */
export async function listWallTokens(householdId: string): Promise<WallToken[]> {
  if (!householdId) return [];
  const q = query(
    collection(db, "wallTokens"),
    where("householdId", "==", householdId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      token: d.id,
      label: String(data.label ?? "Wall display"),
      createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
      createdBy: String(data.createdBy ?? ""),
      revoked: !!data.revoked,
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
}

/** Revoke (but keep) a token. The endpoint returns 403 if revoked. */
export async function revokeWallToken(token: string): Promise<void> {
  await updateDoc(doc(db, "wallTokens", token), { revoked: true });
}

/** Permanently delete a token. */
export async function deleteWallToken(token: string): Promise<void> {
  await deleteDoc(doc(db, "wallTokens", token));
}

/** Compose the full Pi-ready URL for a token. */
export function wallUrlFor(token: string): string {
  return `https://schedule-buddy-dd2cf.web.app/wall?t=${token}`;
}
