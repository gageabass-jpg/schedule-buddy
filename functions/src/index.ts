export { askClaude } from "./askClaude";
export { getWallState } from "./wallState";
export { cleanSchedule } from "./cleanSchedule";
export { setNowPlaying, getNowPlaying } from "./nowPlaying";

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
  /** Manager-proposed change awaiting the caregiver's approval. Resolving it
   *  leaves `status` untouched, so the diff below watches this field
   *  separately — a status-only diff would miss it entirely. */
  proposedChange?: {
    startTime: string;
    endTime: string;
    endsNextDay?: boolean;
    note?: string;
  };
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

/**
 * How many things actually need this person, for the app-icon badge.
 *
 * Previously every push sent a hardcoded `badge: 1`, which meant nothing and
 * — since nothing ever cleared it — stuck to the icon permanently.
 *
 *   caregiver      → requests awaiting her reply (unanswered + proposed changes)
 *   admin/partner  → caregiver responses needing review + caregiver-raised requests
 *   everyone       → unread chat messages
 *
 * Best-effort: any failure returns 0 rather than blocking the notification.
 */
async function badgeCountFor(householdId: string, uid: string): Promise<number> {
  try {
    const db = getFirestore();
    const hh = await db.collection("households").doc(householdId).get();
    const role = (hh.data()?.roles ?? {})[uid] ?? "partner";

    const stateSnap = await db.collection("households").doc(householdId)
      .collection("state").doc("main").get();
    const st = stateSnap.data() ?? {};
    const coverage = (st.coverageRequests ?? []) as CoverageRequest[];

    let count = 0;
    if (role === "supporting") {
      count += coverage.filter((r) =>
        r && (r.status === "pending" || r.proposedChange)).length;
    } else {
      count += coverage.filter((r) =>
        r && (r.status === "declined" || r.status === "issue") &&
        !(r as { managerReviewed?: boolean }).managerReviewed).length;
      count += ((st.caregiverRequests ?? []) as { status?: string }[])
        .filter((c) => c && c.status === "new").length;
    }

    // Unread chat — chatRead/{uid}.lastReadAt is written when the pane opens.
    const readSnap = await db.collection("households").doc(householdId)
      .collection("chatRead").doc(uid).get();
    const lastRead = readSnap.data()?.lastReadAt;
    const lastReadMs = lastRead && typeof lastRead.toMillis === "function" ? lastRead.toMillis() : 0;
    const chatSnap = await db.collection("households").doc(householdId)
      .collection("chat").orderBy("createdAt", "desc").limit(50).get();
    chatSnap.forEach((doc) => {
      const m = doc.data() as { senderId?: string; createdAt?: { toMillis?: () => number } };
      if (m.senderId === uid) return;
      const ms = m.createdAt && typeof m.createdAt.toMillis === "function" ? m.createdAt.toMillis() : 0;
      if (ms > lastReadMs) count++;
    });
    return count;
  } catch (e) {
    logger.warn("badgeCountFor failed", { householdId, uid, error: String(e) });
    return 0;
  }
}

async function sendToTokens(
  tokens: { token: string; uid: string }[],
  notification: { title: string; body: string },
  data: Record<string, string>,
  householdId: string,
): Promise<void> {
  if (tokens.length === 0) return;
  const messaging = getMessaging();
  // Badge is per-recipient, so resolve each uid's count once (several tokens
  // can belong to the same person).
  const uids = Array.from(new Set(tokens.map((t) => t.uid)));
  const badges = new Map<string, number>();
  await Promise.all(uids.map(async (uid) => {
    badges.set(uid, await badgeCountFor(householdId, uid));
  }));
  const messages: Message[] = tokens.map(({ token, uid }) => ({
    token,
    notification,
    data,
    apns: {
      payload: {
        aps: {
          alert: { title: notification.title, body: notification.body },
          sound: "default",
          badge: badges.get(uid) ?? 0,
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

    // --- Caregiver inbox (caregiverRequests): deliberately does NOT push.
    //
    // These used to notify managers whenever Daisy raised something. They now
    // arrive silently: the Inbox tray shows them live, and badgeCountFor()
    // still counts "new" entries, so they surface on the app icon at the next
    // push or app open — just without interrupting.
    //
    // Push is reserved for Daisy answering us (status_change, change_resolved)
    // and In-Basket Messages.
    const cgBefore = byId<CaregiverRequest>((beforeDoc.caregiverRequests ?? []) as CaregiverRequest[]);
    const cgAfter  = (afterDoc.caregiverRequests ?? []) as CaregiverRequest[];
    const newCaregiverEntries = cgAfter.filter(
      (r) => r && r.id && !cgBefore.has(r.id) && r.status === "new");
    if (newCaregiverEntries.length > 0) {
      logger.info("New caregiver requests (no push by design)", {
        householdId, count: newCaregiverEntries.length,
      });
    }

    // --- Coverage requests (caregivers receive new pending; managers
    // receive status transitions). Same path as before.
    const before = (beforeDoc.coverageRequests ?? []) as CoverageRequest[];
    const after  = (afterDoc.coverageRequests  ?? []) as CoverageRequest[];

    const beforeMap = byId(before);
    const afterMap  = byId(after);

    const newPending: CoverageRequest[] = [];
    const statusChanges: { req: CoverageRequest; from: CoverageStatus; to: CoverageStatus }[] = [];
    // Change proposals move no status, so they need their own diff.
    const newProposals: CoverageRequest[] = [];
    const resolvedProposals: { req: CoverageRequest; approved: boolean }[] = [];

    for (const [id, req] of afterMap) {
      const prev = beforeMap.get(id);
      if (!prev) {
        if (req.status === "pending") newPending.push(req);
        continue;
      }
      if (prev.status !== req.status) {
        statusChanges.push({ req, from: prev.status, to: req.status });
      }
      // Proposal appeared → tell the caregiver.
      if (!prev.proposedChange && req.proposedChange) {
        newProposals.push(req);
      }
      // Proposal cleared → tell the managers whether she took it. If the
      // request now sits on the proposed window, she approved it.
      if (prev.proposedChange && !req.proposedChange) {
        const approved = req.startTime === prev.proposedChange.startTime
          && req.endTime === prev.proposedChange.endTime;
        resolvedProposals.push({ req, approved });
      }
    }

    if (newPending.length === 0 && statusChanges.length === 0
      && newProposals.length === 0 && resolvedProposals.length === 0) {
      logger.info("No coverage diff to push", { householdId });
      return;
    }

    logger.info("Coverage diff detected", {
      householdId,
      newPending: newPending.length,
      statusChanges: statusChanges.length,
      newProposals: newProposals.length,
      resolvedProposals: resolvedProposals.length,
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

    // 3. New change proposals → caregivers. She already agreed to this day,
    //    so this is a "can we move it?" not a new assignment.
    if (newProposals.length > 0) {
      const tokens = await tokensForRoles(householdId, ["supporting"]);
      if (tokens.length > 0) {
        for (const req of newProposals) {
          const pc = req.proposedChange!;
          await sendToTokens(tokens, {
            title: "Coverage time change requested",
            body: `${friendlyDate(req.date)} · now ${pc.startTime} → ${pc.endTime}`
              + ` (was ${req.startTime} → ${req.endTime})`,
          }, {
            kind: "change_proposed",
            householdId,
            requestId: req.id,
          }, householdId);
        }
      }
    }

    // 4. Resolved proposals → managers.
    if (resolvedProposals.length > 0) {
      const tokens = await tokensForRoles(householdId, ["admin", "partner"]);
      if (tokens.length > 0) {
        for (const rp of resolvedProposals) {
          await sendToTokens(tokens, {
            title: rp.approved
              ? "Caregiver approved the new time"
              : "Caregiver kept the original time",
            body: `${friendlyDate(rp.req.date)} · ${fmtWindow(rp.req)}`,
          }, {
            kind: "change_resolved",
            householdId,
            requestId: rp.req.id,
            approved: rp.approved ? "1" : "0",
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

// ──────────────────── Family chat: push on new message ───────────────────
// Push to every member's tokens except the sender's. iOS / Mac receivers
// only show the notification when the app isn't already focused on chat —
// that's handled client-side; the function just fans out.

interface ChatMessageDoc {
  senderId?: string;
  senderName?: string;
  text?: string;
}

export const onChatMessageCreate = onDocumentCreated(
  "households/{householdId}/chat/{messageId}",
  async (event) => {
    const householdId = event.params.householdId;
    const data = event.data?.data() as ChatMessageDoc | undefined;
    if (!data || !data.senderId || !data.text) return;

    // Pull every push token for this household and filter out the sender.
    const db = getFirestore();
    const tokSnap = await db
      .collection("households").doc(householdId)
      .collection("pushTokens")
      .get();
    const tokens: { token: string; uid: string }[] = [];
    tokSnap.forEach((d) => {
      const tdata = d.data() as { token?: string; uid?: string } | undefined;
      const uid = tdata?.uid || d.id;
      if (!tdata?.token || uid === data.senderId) return;
      tokens.push({ token: tdata.token, uid });
    });
    logger.info("Chat push targets", { householdId, recipients: tokens.length });
    if (tokens.length === 0) return;

    const senderName = (data.senderName && data.senderName.trim()) || "Family member";
    // Generic body — message contents never appear on lock screens. The sender
    // name is the title (who, not what); tapping routes to In-Basket Messages.
    await sendToTokens(tokens, {
      title: senderName,
      body: "You have a new In-Basket Message. Tap to View",
    }, {
      kind: "chat_message",
      householdId,
      messageId: event.params.messageId,
    }, householdId);
  },
);
