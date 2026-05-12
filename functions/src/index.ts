import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging, type Message } from "firebase-admin/messaging";
import { onDocumentUpdated, onDocumentCreated } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { logger } from "firebase-functions";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// ---- types --------------------------------------------------------------

type CoverageStatus = "pending" | "confirmed" | "declined" | "issue";

interface CoverageRequest {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  endsNextDay?: boolean;
  arriveBy?: string;
  notes?: string;
  status: CoverageStatus;
  caregiverNote?: string;
}

type CaregiverRequestType = "schedule-block" | "shift-conflict" | "other";
type CaregiverRequestStatus = "new" | "acknowledged" | "dismissed";

interface CaregiverRequest {
  id: string;
  type: CaregiverRequestType;
  date: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  status: CaregiverRequestStatus;
  createdAt: number;
  createdBy: string;
  createdByName?: string;
}

function caregiverTypeLabel(t: CaregiverRequestType): string {
  if (t === "schedule-block") return "Schedule block";
  if (t === "shift-conflict") return "Shift conflict";
  return "Note";
}

interface PushTokenDoc {
  token: string;
  uid: string;
  role: "admin" | "partner" | "supporting";
  platform: "ios" | "android" | "web";
}

// ---- helpers ------------------------------------------------------------

function byId<T extends { id?: string }>(list: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of list || []) if (r && r.id) m.set(r.id, r);
  return m;
}

function friendlyDate(iso: string): string {
  // "2026-05-12" → "Tue, May 12"
  const [y, mo, d] = (iso || "").split("-").map(Number);
  if (!y || !mo || !d) return iso || "";
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function fmtWindow(r: CoverageRequest): string {
  return `${r.startTime}–${r.endTime}${r.endsNextDay ? " (+1d)" : ""}`;
}

async function tokensForRoles(
  householdId: string,
  roles: PushTokenDoc["role"][],
): Promise<{ token: string; uid: string }[]> {
  const db = getFirestore();
  const snap = await db
    .collection("households").doc(householdId)
    .collection("pushTokens")
    .where("role", "in", roles)
    .get();
  const out: { token: string; uid: string }[] = [];
  snap.forEach((doc) => {
    const data = doc.data() as Partial<PushTokenDoc> | undefined;
    if (data && typeof data.token === "string" && data.token.length > 0) {
      out.push({ token: data.token, uid: data.uid || doc.id });
    }
  });
  return out;
}

async function sendToTokens(
  tokens: { token: string; uid: string }[],
  notification: { title: string; body: string },
  data: Record<string, string>,
  householdId: string,
): Promise<void> {
  if (tokens.length === 0) return;
  const messaging = getMessaging();
  const messages: Message[] = tokens.map(({ token }) => ({
    token,
    notification,
    data,
    apns: {
      payload: {
        aps: {
          alert: { title: notification.title, body: notification.body },
          sound: "default",
          badge: 1,
        },
      },
    },
  }));
  const responses = await Promise.allSettled(messages.map((m) => messaging.send(m)));
  // Best-effort cleanup of dead tokens
  const db = getFirestore();
  await Promise.all(responses.map(async (res, i) => {
    if (res.status === "rejected") {
      const err = res.reason as { code?: string; message?: string };
      const code = err?.code || "";
      logger.warn("FCM send failed", { code, message: err?.message, uid: tokens[i].uid });
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        try {
          await db
            .collection("households").doc(householdId)
            .collection("pushTokens").doc(tokens[i].uid)
            .delete();
        } catch (e) {
          logger.warn("Failed to delete stale token", { uid: tokens[i].uid, e });
        }
      }
    }
  }));
}

// ---- main trigger -------------------------------------------------------
//
// state/main is written as whole-doc overwrites every ~300ms while the
// desktop is open, so we MUST diff before/after to avoid spamming. We key
// on coverageRequests[].id and compare status transitions.

export const onCoverageRequestsChange = onDocumentUpdated(
  "households/{householdId}/state/main",
  async (event) => {
    const householdId = event.params.householdId;
    const beforeDoc = event.data?.before.data() ?? {};
    const afterDoc  = event.data?.after.data()  ?? {};

    // --- Caregiver inbox (caregiverRequests): notify managers when a
    // brand-new "new"-status row appears. Acks/dismissals are ignored.
    const cgBefore = byId<CaregiverRequest>((beforeDoc.caregiverRequests ?? []) as CaregiverRequest[]);
    const cgAfter  = (afterDoc.caregiverRequests ?? []) as CaregiverRequest[];
    const newCaregiverEntries: CaregiverRequest[] = [];
    for (const r of cgAfter) {
      if (!r || !r.id) continue;
      if (cgBefore.has(r.id)) continue;
      if (r.status === "new") newCaregiverEntries.push(r);
    }
    if (newCaregiverEntries.length > 0) {
      const tokens = await tokensForRoles(householdId, ["admin", "partner"]);
      logger.info("Inbox push tokens resolved", { householdId, count: tokens.length, newEntries: newCaregiverEntries.length });
      if (tokens.length > 0) {
        for (const cr of newCaregiverEntries) {
          const who = cr.createdByName || "Caregiver";
          const title = `${who}: ${caregiverTypeLabel(cr.type)}`;
          const dateStr = (() => {
            const [y, m, d] = (cr.date || "").split("-").map(Number);
            if (!y || !m || !d) return cr.date || "";
            return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
          })();
          const bodyParts: string[] = [dateStr];
          if (cr.startTime && cr.endTime) bodyParts.push(`${cr.startTime}–${cr.endTime}`);
          if (cr.notes) bodyParts.push(cr.notes.slice(0, 80));
          await sendToTokens(tokens, {
            title,
            body: bodyParts.filter(Boolean).join(" · "),
          }, {
            kind: "caregiver_request",
            householdId,
            requestId: cr.id,
            type: cr.type,
          }, householdId);
        }
      }
    }

    // --- Coverage requests (caregivers receive new pending; managers
    // receive status transitions). Same path as before.
    const before = (beforeDoc.coverageRequests ?? []) as CoverageRequest[];
    const after  = (afterDoc.coverageRequests  ?? []) as CoverageRequest[];

    const beforeMap = byId(before);
    const afterMap  = byId(after);

    const newPending: CoverageRequest[] = [];
    const statusChanges: { req: CoverageRequest; from: CoverageStatus; to: CoverageStatus }[] = [];

    for (const [id, req] of afterMap) {
      const prev = beforeMap.get(id);
      if (!prev) {
        if (req.status === "pending") newPending.push(req);
        continue;
      }
      if (prev.status !== req.status) {
        statusChanges.push({ req, from: prev.status, to: req.status });
      }
    }

    if (newPending.length === 0 && statusChanges.length === 0) {
      logger.info("No coverage diff to push", { householdId });
      return;
    }

    logger.info("Coverage diff detected", {
      householdId,
      newPending: newPending.length,
      statusChanges: statusChanges.length,
      statusChangeSummary: statusChanges.map((c) => `${c.req.id}:${c.from}->${c.to}`),
    });

    // 1. New pending requests → caregivers
    if (newPending.length > 0) {
      const tokens = await tokensForRoles(householdId, ["supporting"]);
      logger.info("Caregiver tokens resolved", { householdId, tokens: tokens.length });
      if (tokens.length > 0) {
        const single = newPending[0];
        const body = newPending.length === 1
          ? `${friendlyDate(single.date)} · ${fmtWindow(single)}${single.arriveBy ? ` · arrive ${single.arriveBy}` : ""}`
          : `${newPending.length} new coverage requests`;
        await sendToTokens(tokens, {
          title: newPending.length === 1 ? "New coverage request" : "New coverage requests",
          body,
        }, {
          kind: "new_pending",
          householdId,
          requestId: newPending.length === 1 ? single.id : "",
        }, householdId);
      }
    }

    // 2. Status changes → managers (admin + partner)
    if (statusChanges.length > 0) {
      const tokens = await tokensForRoles(householdId, ["admin", "partner"]);
      logger.info("Manager tokens resolved", { householdId, tokens: tokens.length });
      if (tokens.length > 0) {
        for (const ch of statusChanges) {
          const verb =
            ch.to === "confirmed" ? "accepted" :
            ch.to === "declined"  ? "declined" :
            ch.to === "issue"     ? "reported an issue with" :
                                    "updated";
          const title = `Caregiver ${verb} coverage`;
          const body = `${friendlyDate(ch.req.date)} · ${fmtWindow(ch.req)}` +
            (ch.to === "issue" && ch.req.caregiverNote ? ` — “${ch.req.caregiverNote}”` : "");
          await sendToTokens(tokens, { title, body }, {
            kind: "status_change",
            householdId,
            requestId: ch.req.id,
            status: ch.to,
          }, householdId);
        }
      }
    }
  },
);

// Convenience: when a household is first created (initial state doc
// creation) there's no `before` snapshot, so onDocumentUpdated misses the
// very first batch of requests. Mirror the trigger on create.
export const onCoverageRequestsCreate = onDocumentCreated(
  "households/{householdId}/state/main",
  async (event) => {
    const householdId = event.params.householdId;
    const list = (event.data?.data()?.coverageRequests ?? []) as CoverageRequest[];
    const pending = list.filter((r) => r && r.status === "pending");
    if (pending.length === 0) return;
    const tokens = await tokensForRoles(householdId, ["supporting"]);
    if (tokens.length === 0) return;
    const single = pending[0];
    const body = pending.length === 1
      ? `${friendlyDate(single.date)} · ${fmtWindow(single)}${single.arriveBy ? ` · arrive ${single.arriveBy}` : ""}`
      : `${pending.length} new coverage requests`;
    await sendToTokens(tokens, {
      title: pending.length === 1 ? "New coverage request" : "New coverage requests",
      body,
    }, {
      kind: "new_pending",
      householdId,
      requestId: pending.length === 1 ? single.id : "",
    }, householdId);
  },
);
