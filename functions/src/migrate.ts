// Moving a household to the any-household model and back (shared/migrate.ts,
// docs/data-model.md step 4). Only the household's admin may run either.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import {
  migrateHousehold as migrate, unmigrateHousehold as unmigrate, type MigrationReport,
} from "./shared/migrate";
import { modelStore } from "./modelStore";
import { dropCaregiverView } from "./caregiver";

interface Request { householdId?: string }

async function requireAdmin(uid: string | undefined, householdId: unknown): Promise<string> {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to use this.");
  if (typeof householdId !== "string" || !householdId) throw new HttpsError("invalid-argument", "Which household?");
  const hh = await getFirestore().collection("households").doc(householdId).get();
  if (hh.data()?.roles?.[uid] !== "admin") {
    throw new HttpsError("permission-denied", "Only the household's admin can do this.");
  }
  return householdId;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const migrateHousehold = onCall<Request, Promise<MigrationReport>>(
  { cors: true, timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    const householdId = await requireAdmin(request.auth?.uid, request.data?.householdId);
    const now = Date.now();
    // Check the drawing over the last three months and the coming year.
    const report = await migrate(modelStore(), householdId, request.auth!.uid, {
      now, from: iso(now - 90 * 86_400_000), to: iso(now + 365 * 86_400_000),
    });
    logger.info("migrateHousehold", { householdId, outcome: report.outcome, problems: report.problems.length, notes: report.notes });
    // Caregivers now read their own records; the view held every request.
    if (report.outcome === "migrated") await dropCaregiverView(householdId);
    return report;
  },
);

export const unmigrateHousehold = onCall<Request, Promise<MigrationReport>>(
  { cors: true, timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    const householdId = await requireAdmin(request.auth?.uid, request.data?.householdId);
    const report = await unmigrate(modelStore(), householdId, request.auth!.uid, Date.now());
    logger.info("unmigrateHousehold", { householdId, outcome: report.outcome });
    return report;
  },
);
