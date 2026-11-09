// The weekly email scan, and "scan now": run Claude over every linked inbox of a
// household, write what it finds in one go, and say what happened.
//
//   weeklyEmailScan (scheduled)  → Sundays 8 AM Eastern, every household with linked inboxes
//   scanLinkedInboxes (callable) → the same, on demand from the Console
//
// A run is one change for the whole household: the events from every inbox are
// written together (one push, one Undo), up to MAX_EVENTS_PER_SCAN. The Console
// reads what happened from meta/emailScan, and the bell gets one notification.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import Anthropic from "@anthropic-ai/sdk";
import type { Event as SbEvent, HouseholdState } from "./shared/state";
import { createGmailClient, type MailClient } from "./shared/gmailClient";
import { MAX_EVENTS_PER_SCAN } from "./shared/emailEvents";
import { addedSummary, lookbackDays, weeklyInstruction } from "./shared/gmailOAuth";
import { readHouseholdState } from "./householdState";
import { newChangeRecord } from "./askClaude";
import { ANTHROPIC_API_KEY, scanMailbox, writeScanEvents, type ScanAdded } from "./emailEvents";
import { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, LinkNeedsReconnect, accessTokenFor } from "./gmailLinks";
import { icloudPasswordFor } from "./icloudLinks";
import { createIcloudClient } from "./icloudMail";

const SECRETS = [ANTHROPIC_API_KEY, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET];

/** Events kept in the "found by a scan" list; older ones fall off the end. */
const MAX_FOUND = 40;

export interface HouseholdScan {
  /** Linked inboxes that were scanned. */
  inboxes: number;
  /** Emails the model looked at, across them. */
  scanned: number;
  added: ScanAdded[];
  /** Proposals dropped because the calendar already had them. */
  skipped: number;
  /** Inboxes that couldn't be scanned. */
  failed: Array<{ email: string; needsReconnect: boolean; provider?: "gmail" | "icloud" }>;
  /** Set when events were added: pass `id` to undoNucleusChange to take them all back. */
  change?: { id: string; tools: string[] };
}

interface LinkDoc { email: string; ownerCode: "G" | "K"; provider?: "gmail" | "icloud"; lastScanAt?: number }

/** Sign in to a linked inbox with the access saved for it. */
async function openMailbox(householdId: string, linkId: string, link: LinkDoc): Promise<MailClient> {
  return link.provider === "icloud"
    ? createIcloudClient(link.email, await icloudPasswordFor(householdId, linkId))
    : createGmailClient(await accessTokenFor(householdId, linkId));
}

const providerName = (p: LinkDoc["provider"]) => (p === "icloud" ? "iCloud" : "Gmail");

/** Scan every active linked inbox of a household and write what is found. */
export async function scanHousehold(householdId: string, trigger: "weekly" | "manual", actingUid?: string): Promise<HouseholdScan> {
  const db = getFirestore();
  const hhRef = db.collection("households").doc(householdId);
  const result: HouseholdScan = { inboxes: 0, scanned: 0, added: [], skipped: 0, failed: [] };

  const links = await hhRef.collection("gmailLinks").where("status", "==", "active").get();
  if (links.empty) return result;

  const hh = (await hhRef.get()).data() ?? {};
  const state = ((await readHouseholdState(householdId)) ?? {}) as HouseholdState;
  const tz = state.timeZone || "America/New_York";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const gName = state.selfName || "Gage";
  const kName = state.partner?.name || "Kaylene";
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

  const queued: SbEvent[] = [];
  const now = Date.now();
  for (const doc of links.docs) {
    const link = doc.data() as LinkDoc;
    if (queued.length >= MAX_EVENTS_PER_SCAN) break;
    let mail: MailClient | undefined;
    try {
      mail = await openMailbox(householdId, doc.id, link);
      const scan = await scanMailbox({
        client, mail, today, tz,
        // Whatever an earlier inbox queued counts as already on the calendar.
        events: [...(state.events ?? []), ...queued],
        householdName: hh.name ?? "Bass",
        userName: `${link.ownerCode === "G" ? gName : kName} (${link.email})`,
        gName, kName, ownerCode: link.ownerCode,
        instruction: weeklyInstruction(link.email, lookbackDays(link.lastScanAt, now)),
        limit: MAX_EVENTS_PER_SCAN - queued.length,
      });
      queued.push(...scan.queued);
      result.scanned += scan.seen;
      result.skipped += scan.skipped;
      result.inboxes++;
      await doc.ref.update({ lastScanAt: now, lastScanFound: scan.queued.length, lastError: FieldValue.delete() });
    } catch (e) {
      const needsReconnect = e instanceof LinkNeedsReconnect;
      result.failed.push({ email: link.email, needsReconnect, provider: link.provider ?? "gmail" });
      logger.warn("email scan: an inbox failed", { householdId, link: doc.id, needsReconnect, error: e instanceof Error ? e.message : String(e) });
      await doc.ref.update({
        ...(needsReconnect ? { status: "needs-reconnect" } : {}),
        lastError: needsReconnect
          ? `${link.provider === "icloud" ? "Apple" : "Google"} no longer honours the saved access. Connect this inbox again.`
          : "The last scan couldn't finish.",
      }).catch(() => undefined);
    } finally {
      await mail?.close?.().catch(() => undefined);
    }
  }

  // Everything found goes on the calendar at once, as one change.
  const ctx = {
    householdId, uid: actingUid ?? "system:email-scan",
    userMessage: `${trigger === "weekly" ? "Weekly" : "Manual"} email scan`,
    change: newChangeRecord(householdId),
    writeQueue: Promise.resolve() as Promise<unknown>,
  };
  result.added = await writeScanEvents(ctx, queued);
  result.skipped += queued.length - result.added.length;
  if (ctx.change.tools.length) result.change = { id: ctx.change.id, tools: ctx.change.tools };

  // What the Console shows: the last run, and (when it added anything) a last
  // change that can be undone.
  const events = result.added.slice(0, 10).map((e) => ({ title: e.title, date: e.date }));
  const scanRef = hhRef.collection("meta").doc("emailScan");
  // The running list the sidebar's "Found in email" menu shows: what every scan
  // has added, newest first. The app drops any that have since left the calendar.
  const found = result.added.length
    ? [
        ...result.added.map((e) => ({
          id: e.id, title: e.title, date: e.date, who: e.who, ...(e.startTime ? { startTime: e.startTime } : {}), at: now, trigger,
        })),
        ...(((await scanRef.get()).data()?.found as unknown[] | undefined) ?? []),
      ].slice(0, MAX_FOUND)
    : null;
  await scanRef.set({
    lastRun: { at: now, trigger, inboxes: result.inboxes, scanned: result.scanned, added: result.added.length, failed: result.failed.length },
    ...(result.change ? { lastChange: { at: now, changeId: result.change.id, count: result.added.length, events, undone: false } } : {}),
    ...(found ? { found } : {}),
  }, { merge: true });

  // The bell: one line for what was added, one per inbox that needs connecting
  // again. A manual scan answers on screen, so it adds nothing here.
  if (trigger === "weekly") {
    const notifications = hhRef.collection("notifications");
    const stamp = { roles: ["admin", "partner"], readBy: {}, createdAt: FieldValue.serverTimestamp() };
    if (result.added.length) {
      const n = result.added.length;
      await notifications.add({
        kind: "email_scan", title: `Email scan added ${n} event${n === 1 ? "" : "s"}`, body: addedSummary(result.added),
        date: result.added[0].date, ...stamp,
      });
    }
    for (const f of result.failed.filter((x) => x.needsReconnect)) {
      await notifications.add({ kind: "email_reconnect", title: `${providerName(f.provider)} needs connecting again`, body: `${f.email} - connect it again in the Console.`, ...stamp });
    }
  }

  try {
    await hhRef.collection("askClaudeLog").add({
      uid: ctx.uid, kind: "email-scan", userMessage: ctx.userMessage, finalReply: addedSummary(result.added, 5),
      scanned: result.scanned, added: result.added.length, changeId: result.change?.id ?? null,
      at: FieldValue.serverTimestamp(),
    });
  } catch { /* best-effort */ }
  logger.info("email scan", { householdId, trigger, inboxes: result.inboxes, scanned: result.scanned, added: result.added.length, skipped: result.skipped, failed: result.failed.length });
  return result;
}

/** Sundays at 8 AM Eastern: scan every household's linked inboxes. */
export const weeklyEmailScan = onSchedule(
  { schedule: "0 8 * * 0", timeZone: "America/New_York", region: "us-central1", secrets: SECRETS, timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const households = await getFirestore().collection("households").get();
    for (const hh of households.docs) {
      try {
        await scanHousehold(hh.id, "weekly");
      } catch (e) {
        logger.warn("email scan: a household failed", { householdId: hh.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  },
);

/** The same scan, on demand from the Console. */
export const scanLinkedInboxes = onCall<Record<string, never>, Promise<HouseholdScan>>(
  { region: "us-central1", cors: true, secrets: SECRETS, timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to use this.");
    const snap = await getFirestore().collection("households").where("memberUids", "array-contains", uid).limit(1).get();
    if (snap.empty) throw new HttpsError("failed-precondition", "No household found.");
    if ((snap.docs[0].data().roles?.[uid] ?? "partner") === "supporting") {
      throw new HttpsError("permission-denied", "Caregivers can't scan email.");
    }
    return scanHousehold(snap.docs[0].id, "manual", uid);
  },
);
