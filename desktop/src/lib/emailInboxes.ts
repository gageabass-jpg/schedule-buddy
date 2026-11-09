// The inboxes linked for the weekly email scan, and what the last scan did.
//
// households/{hid}/gmailLinks/{id}   one per linked inbox, Gmail or iCloud (which
//                                    address, whose, when it last ran). Read-only
//                                    here: the link functions write it, and the
//                                    saved access (a Google refresh token, or an
//                                    encrypted iCloud password) lives elsewhere,
//                                    where no app can read it.
// households/{hid}/meta/emailScan    the last run and the last change that can be
//                                    undone, written by the scan functions.

import { collection, doc, onSnapshot, updateDoc, type Unsubscribe } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app, db } from "../firebase";
import type { FoundEntry } from "./foundEvents";
import { cleanAppPassword, isIcloudAddress } from "./icloudAccount";

export interface InboxLink {
  id: string;
  email: string;
  ownerCode: "G" | "K";
  /** Gmail unless the link says it's iCloud (older links have no provider). */
  provider?: "gmail" | "icloud";
  status: "active" | "needs-reconnect";
  linkedAt?: number;
  lastScanAt?: number;
  lastError?: string;
}

export interface EmailScanMeta {
  /** Every event a scan has added, newest first (the scan functions keep the latest 40). */
  found?: FoundEntry[];
  lastRun?: { at: number; trigger: "weekly" | "manual"; inboxes: number; scanned: number; added: number; failed: number };
  lastChange?: { at: number; changeId: string; count: number; events: Array<{ title: string; date: string }>; undone: boolean };
}

/** What a scan-now run reports. */
export interface ScanNowResult {
  inboxes: number;
  scanned: number;
  added: Array<{ id: string; date: string; title: string }>;
  skipped: number;
  failed: Array<{ email: string; needsReconnect: boolean; provider?: "gmail" | "icloud" }>;
  change?: { id: string; tools: string[] };
}

/** The household's linked inboxes, live. */
export function subscribeInboxLinks(householdId: string, onChange: (links: InboxLink[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, "households", householdId, "gmailLinks"),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InboxLink, "id">) }))
      .sort((a, b) => (a.linkedAt ?? 0) - (b.linkedAt ?? 0))),
    () => onChange([]),
  );
}

/** What the last scan did, live. */
export function subscribeEmailScan(householdId: string, onChange: (meta: EmailScanMeta) => void): Unsubscribe {
  return onSnapshot(
    doc(db, "households", householdId, "meta", "emailScan"),
    (snap) => onChange((snap.data() as EmailScanMeta | undefined) ?? {}),
    () => onChange({}),
  );
}

const fns = getFunctions(app, "us-central1");
const callCreateLink = httpsCallable<{ ownerCode: "G" | "K" }, { url: string }>(fns, "createGmailLink");
const callDisconnect = httpsCallable<{ linkId: string }, { ok: true }>(fns, "disconnectGmailLink");
// A scan reads mail and calls the model for each inbox, so it outlasts the 70-second default.
const callScanNow = httpsCallable<Record<string, never>, ScanNowResult>(fns, "scanLinkedInboxes", { timeout: 300_000 });

/** A one-time link that links an inbox. Open it in a browser signed in to that
 *  person's Google account; it works once and expires in a day. */
export async function createInboxLink(ownerCode: "G" | "K"): Promise<string> {
  return (await callCreateLink({ ownerCode })).data.url;
}

const callConnectIcloud = httpsCallable<{ email: string; appPassword: string; ownerCode: "G" | "K" }, { email: string }>(
  fns, "connectIcloudInbox", { timeout: 90_000 });

/** Link an iCloud inbox. The server tries the address and app-specific password
 *  against iCloud Mail first, so a wrong one fails here with Apple's answer in words. */
export async function connectIcloud(email: string, appPassword: string, ownerCode: "G" | "K"): Promise<string> {
  const address = email.trim().toLowerCase();
  if (!isIcloudAddress(address)) throw new Error("That isn't an iCloud address. It should end in @icloud.com, @me.com or @mac.com.");
  const password = cleanAppPassword(appPassword);
  if (!password) {
    throw new Error("That doesn't look like an app-specific password. It is 16 letters, like abcd-efgh-ijkl-mnop, made at account.apple.com. Your Apple ID password won't work.");
  }
  return (await callConnectIcloud({ email: address, appPassword: password, ownerCode })).data.email;
}

/** Stop scanning an inbox, and revoke its access at Google. */
export async function disconnectInbox(linkId: string): Promise<void> {
  await callDisconnect({ linkId });
}

/** Scan every linked inbox now, the same as the Sunday scan does. */
export async function scanInboxesNow(): Promise<ScanNowResult> {
  return (await callScanNow({})).data;
}

/** After the last scan's events are taken back, so the Undo doesn't show again. */
export async function markScanUndone(householdId: string): Promise<void> {
  await updateDoc(doc(db, "households", householdId, "meta", "emailScan"), { "lastChange.undone": true });
}
