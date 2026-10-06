// Caregiver access (caregiverLogic.ts has the rules of what they see and do).
//
//   mirrorCaregiverView — on every state/main write, keeps
//     households/{hid}/caregiverView/main in step (only when the slice a
//     caregiver sees actually changed; the desktop saves state/main often).
//   caregiverAction — the only way a caregiver changes anything: answer a
//     request, resolve a proposed change, add an event or a block. Checks the
//     caller is a member of the household and, to answer or resolve a request,
//     that it is addressed to them (caregiverLogic.ts), then applies the one change in a
//     transaction (update, not set: nothing else in state/main is touched).
//     `sync` rebuilds the view on demand, for a household whose view doesn't
//     exist yet.
//
// A household on the any-household model has no state/main to trigger on:
// onHouseholdEdit (index.ts) calls refreshCaregiverView after each save, and
// caregiverAction's change goes through editLegacyState like any other edit.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { applyCaregiverAction, buildCaregiverView, CaregiverForbiddenError, CaregiverInputError } from "./caregiverLogic";
import { editLegacyState, isMigrated, readLegacyState } from "./householdState";
import { collectionPath } from "./shared/store";
import { modelStore } from "./modelStore";

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

/** Rewrite the caregiver's view from `state` if what it shows has changed. */
export async function refreshCaregiverView(householdId: string, state: Record<string, unknown> | null): Promise<void> {
  const ref = viewRef(householdId);
  const next = buildCaregiverView(state ?? undefined);
  const cur = (await ref.get()).data();
  if (cur && JSON.stringify(cur) === JSON.stringify(next)) return;
  await ref.set(next);
}

/** The people records that are this account, on a household on the any-household
 *  model; undefined on one still on state/main (see ActionContext). */
export async function callerPersonIds(householdId: string, uid: string, root: Record<string, unknown> | undefined): Promise<string[] | undefined> {
  if (!isMigrated(root)) return undefined;
  const people = await modelStore().list(collectionPath(householdId, "people"));
  return people.filter((p) => p.data.uid === uid).map((p) => p.id);
}

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

    if (request.data.action === "sync") {
      const state = await readLegacyState(householdId);
      await viewRef(householdId).set(buildCaregiverView((state ?? undefined) as Record<string, unknown> | undefined));
      return { ok: true };
    }

    const now = new Date();
    const personIds = await callerPersonIds(householdId, uid, hh.data());
    try {
      if (!(await readLegacyState(householdId))) throw new CaregiverInputError("The schedule isn't set up yet.");
      await editLegacyState(householdId, uid, (fresh) => {
        const patch = applyCaregiverAction(fresh as unknown as Record<string, unknown>, request.data, {
          uid,
          nowIso: now.toISOString(),
          nowMs: now.getTime(),
          newId: `ev_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          callerPersonIds: personIds,
        });
        return { result: null, next: { ...fresh, ...patch } };
      });
    } catch (e) {
      if (e instanceof CaregiverForbiddenError) throw new HttpsError("permission-denied", e.message);
      if (e instanceof CaregiverInputError) throw new HttpsError("invalid-argument", e.message);
      logger.error("caregiverAction failed", { householdId, action: request.data.action, error: String(e) });
      throw new HttpsError("internal", "Couldn't save that. Try again.");
    }
    return { ok: true };
  },
);
