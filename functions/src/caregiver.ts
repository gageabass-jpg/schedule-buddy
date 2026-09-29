// Caregiver access (caregiverLogic.ts has the rules of what they see and do).
//
//   mirrorCaregiverView — on every state/main write, keeps
//     households/{hid}/caregiverView/main in step (only when the slice a
//     caregiver sees actually changed; the desktop saves state/main often).
//   caregiverAction — the only way a caregiver changes anything: answer a
//     request, resolve a proposed change, add an event or a block. Checks the
//     caller is a member of the household, then applies the one change in a
//     transaction (update, not set: nothing else in state/main is touched).
//     `sync` rebuilds the view on demand, for a household whose view doesn't
//     exist yet.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { applyCaregiverAction, buildCaregiverView, CaregiverInputError } from "./caregiverLogic";

const viewRef = (householdId: string) =>
  getFirestore().collection("households").doc(householdId).collection("caregiverView").doc("main");

export const mirrorCaregiverView = onDocumentWritten(
  "households/{householdId}/state/main",
  async (event) => {
    const householdId = event.params.householdId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after) {
      await viewRef(householdId).delete().catch(() => {});
      return;
    }
    const next = buildCaregiverView(after);
    if (before && JSON.stringify(buildCaregiverView(before)) === JSON.stringify(next)) return;
    await viewRef(householdId).set(next);
  },
);

interface CaregiverActionRequest {
  householdId?: string;
  action?: string;
  [k: string]: unknown;
}

export const caregiverAction = onCall<CaregiverActionRequest, Promise<{ ok: true }>>(
  { cors: true, timeoutSeconds: 20 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to use this.");
    const householdId = request.data?.householdId;
    if (typeof householdId !== "string" || !householdId) {
      throw new HttpsError("invalid-argument", "Missing household.");
    }

    const db = getFirestore();
    const hh = await db.collection("households").doc(householdId).get();
    const members: unknown = hh.data()?.memberUids;
    if (!hh.exists || !Array.isArray(members) || !members.includes(uid)) {
      throw new HttpsError("permission-denied", "You're not in this household.");
    }

    const stateRef = db.collection("households").doc(householdId).collection("state").doc("main");

    if (request.data.action === "sync") {
      const snap = await stateRef.get();
      await viewRef(householdId).set(buildCaregiverView(snap.data()));
      return { ok: true };
    }

    const now = new Date();
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(stateRef);
        if (!snap.exists) throw new CaregiverInputError("The schedule isn't set up yet.");
        const patch = applyCaregiverAction(snap.data() ?? {}, request.data, {
          uid,
          nowIso: now.toISOString(),
          nowMs: now.getTime(),
          newId: `ev_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        });
        tx.update(stateRef, patch);
      });
    } catch (e) {
      if (e instanceof CaregiverInputError) throw new HttpsError("invalid-argument", e.message);
      logger.error("caregiverAction failed", { householdId, action: request.data.action, error: String(e) });
      throw new HttpsError("internal", "Couldn't save that. Try again.");
    }
    return { ok: true };
  },
);
