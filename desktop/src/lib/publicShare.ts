// Read-only public share — desktop side.
//
// Mirrors the web app (public/index.html buildPublicShareSnapshot / publish /
// enable / rotate). Publishes a SANITIZED snapshot (shifts + life-event titles
// only) to the top-level `publicShares/{token}` doc that share.html and the
// icsFeed function read. `shareToken`/`shareEnabled` live in household state so
// web + desktop stay in sync.
//
// Firestore rule: publicShares/{token} is world-readable BY TOKEN; write/delete
// gated to the authenticated owner (ownerUid == request.auth.uid).

import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { buildShiftMap, type HouseholdState, type ShiftType } from "../state";

const SHARE_BASE = "https://schedule-buddy-dd2cf.web.app";
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function genToken(): string {
  const buf = new Uint32Array(32);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < 32; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

function pad(n: number): string { return String(n).padStart(2, "0"); }
function isoOf(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const WHO_OUT: Record<string, string> = { G: "G", K: "K", D: "Daisy" };

async function readState(householdId: string): Promise<HouseholdState> {
  const snap = await getDoc(doc(db, "households", householdId, "state", "main"));
  if (!snap.exists()) throw new Error("Schedule document doesn't exist yet.");
  return snap.data() as HouseholdState;
}
async function writeState(householdId: string, next: HouseholdState): Promise<void> {
  await setDoc(doc(db, "households", householdId, "state", "main"), next);
}

/** Sanitized snapshot in the exact shape share.html + icsFeed expect. */
export function buildPublicShareSnapshot(state: HouseholdState, householdId: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const from = addDays(today, -7), to = addDays(today, 56);
  const map = buildShiftMap(state, isoOf(from), isoOf(to));

  const types: Record<string, ShiftType> = {};
  for (const st of state.shiftTypes || []) types[st.id] = st;

  const days: Array<{ date: string; shifts: Array<Record<string, unknown>>; events: string[] }> = [];
  for (let cur = new Date(from); cur <= to; cur = addDays(cur, 1)) {
    const iso = isoOf(cur);
    const shifts = (map[iso] || []).map((s) => {
      const ty = s.shiftTypeId ? types[s.shiftTypeId] : undefined;
      return {
        who: WHO_OUT[s.who] || s.who,
        type: (ty && ty.name) || s.label || "Shift",
        start: ty ? ty.start : undefined,
        end: ty ? ty.end : undefined,
        label: s.label,
        endsNextDay: ty ? !!ty.crossesMidnight : false,
      };
    });
    const events = (state.events || [])
      .filter((e) => e.date === iso && (e.title || "").trim())
      .map((e) => e.title.trim());
    if (shifts.length || events.length) days.push({ date: iso, shifts, events });
  }

  return {
    v: 1,
    ownerUid: auth.currentUser ? auth.currentUser.uid : null,
    householdId,
    householdName: state.householdName || "Our schedule",
    people: {
      G: { name: state.selfName || "Gage", hex: "#0F6E64" },
      K: { name: (state.partner && state.partner.name) || "Kaylene", hex: "#FF375F" },
      Daisy: { name: (state.dependents?.daisy?.name) || "Daisy", hex: "#0F6E64" },
    },
    days,
    from: isoOf(from), to: isoOf(to),
    updatedAt: Date.now(),
  };
}

/** Publish the current snapshot to publicShares/{token} (if sharing is on). */
export async function publishPublicShare(householdId: string, state: HouseholdState): Promise<void> {
  if (!householdId || !state.shareEnabled || !state.shareToken || !auth.currentUser) return;
  await setDoc(doc(db, "publicShares", state.shareToken), buildPublicShareSnapshot(state, householdId));
}

/** Turn sharing on: generate a token if needed, flip the flag, publish. */
export async function enablePublicShare(householdId: string): Promise<string> {
  if (!auth.currentUser) throw new Error("Not signed in.");
  const state = await readState(householdId);
  const token = state.shareToken || genToken();
  const next: HouseholdState = { ...state, shareEnabled: true, shareToken: token };
  await writeState(householdId, next);
  await publishPublicShare(householdId, next);
  return token;
}

/** Turn sharing off and delete the public doc. */
export async function disablePublicShare(householdId: string): Promise<void> {
  const state = await readState(householdId);
  const token = state.shareToken;
  await writeState(householdId, { ...state, shareEnabled: false });
  if (token) { try { await deleteDoc(doc(db, "publicShares", token)); } catch { /* already gone */ } }
}

/** New token: delete the old public doc, publish under a fresh one. */
export async function rotatePublicShare(householdId: string): Promise<string> {
  if (!auth.currentUser) throw new Error("Not signed in.");
  const state = await readState(householdId);
  const oldToken = state.shareToken;
  const token = genToken();
  const next: HouseholdState = { ...state, shareEnabled: true, shareToken: token };
  await writeState(householdId, next);
  if (oldToken && oldToken !== token) { try { await deleteDoc(doc(db, "publicShares", oldToken)); } catch { /* ignore */ } }
  await publishPublicShare(householdId, next);
  return token;
}

export function shareLinks(token: string): { web: string; ics: string } {
  return {
    web: `${SHARE_BASE}/share.html?t=${token}`,
    ics: `webcal://schedule-buddy-dd2cf.web.app/ics/${token}.ics`,
  };
}
