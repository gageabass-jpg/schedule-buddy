// Linking a Gmail inbox for the weekly email scan.
//
// The flow is Google's own consent page, reached through a one-time link:
//   createGmailLink (callable)  → makes a single-use, 24-hour code for a household
//                                 and returns a link to gmailLinkStart
//   gmailLinkStart (HTTP)       → sends whoever opens the link to Google's consent page
//   gmailOAuthCallback (HTTP)   → Google sends the person back here with a code;
//                                 it is traded for a refresh token, which is saved
//                                 where no app can read it
//   disconnectGmailLink (callable) → revokes the grant at Google and forgets it
//
// Two documents per inbox, under the household: gmailLinks/{id} (which address,
// whose it is, when it last ran: what the app shows) and gmailSecrets/{id} (the
// refresh token). firestore.rules lets admin and partner read the first, and
// nobody read or write the second; only these functions touch it, with the
// Admin SDK. Kaylene links her own inbox by opening a link made for her.

import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { randomBytes, createHash } from "node:crypto";
import { emailFromIdToken, googleAuthUrl } from "./shared/gmailOAuth";

export const GMAIL_CLIENT_ID = defineSecret("GMAIL_CLIENT_ID");
export const GMAIL_CLIENT_SECRET = defineSecret("GMAIL_CLIENT_SECRET");

const REGION = "us-central1";
const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const NONCE = /^[a-f0-9]{48}$/;
const LINK_ID = /^[a-f0-9]{20}$/;

/** This project's id, from the environment Firebase sets for every function. */
function projectId(): string {
  const fromConfig = (() => {
    try { return (JSON.parse(process.env.FIREBASE_CONFIG ?? "{}") as { projectId?: string }).projectId; } catch { return undefined; }
  })();
  const id = process.env.GCLOUD_PROJECT || fromConfig;
  if (!id) throw new Error("Can't tell which project this is running in.");
  return id;
}

const baseUrl = () => `https://${REGION}-${projectId()}.cloudfunctions.net`;
/** Where Google sends people back. The OAuth client must list exactly this. */
export const redirectUri = () => `${baseUrl()}/gmailOAuthCallback`;

/** A stable id for an inbox, so linking the same address again replaces its access. */
export function linkIdFor(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 20);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] as string));

/** A small page for the person's browser at the end of linking (or when it fails). */
function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(title)}</title><style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;background:#F7F6F3;color:#14201E;` +
    `display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{max-width:420px;padding:32px;text-align:center}` +
    `h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#5A6663}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${body}</p></main></body></html>`;
}

export async function householdFor(uid: string) {
  const snap = await getFirestore().collection("households").where("memberUids", "array-contains", uid).limit(1).get();
  if (snap.empty) throw new HttpsError("failed-precondition", "No household found.");
  const role = snap.docs[0].data().roles?.[uid] ?? "partner";
  if (role === "supporting") throw new HttpsError("permission-denied", "Caregivers can't link inboxes.");
  return { id: snap.docs[0].id };
}

interface LinkRequest { householdId: string; ownerCode: "G" | "K"; createdByUid: string; createdAt: number; expiresAt: number; usedAt?: number }

/** The pending link request for a code, if it is real, unused and unexpired. */
async function openRequest(nonce: string): Promise<LinkRequest | null> {
  if (!NONCE.test(nonce)) return null;
  const snap = await getFirestore().collection("gmailLinkRequests").doc(nonce).get();
  const r = snap.data() as LinkRequest | undefined;
  return r && !r.usedAt && r.expiresAt > Date.now() ? r : null;
}

// ── Starting a link ─────────────────────────────────────────────────────────

/** A one-time link to link someone's inbox. Open it in a browser signed in to
 *  that person's Google account; Kaylene gets one to open on her own phone. */
export const createGmailLink = onCall<{ ownerCode?: string }, Promise<{ url: string }>>(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to use this.");
    const ownerCode = request.data.ownerCode === "K" ? "K" : request.data.ownerCode === "G" ? "G" : null;
    if (!ownerCode) throw new HttpsError("invalid-argument", "Whose inbox is it: G or K?");
    const hh = await householdFor(uid);

    const nonce = randomBytes(24).toString("hex");
    const now = Date.now();
    const doc: LinkRequest = { householdId: hh.id, ownerCode, createdByUid: uid, createdAt: now, expiresAt: now + LINK_TTL_MS };
    await getFirestore().collection("gmailLinkRequests").doc(nonce).set(doc);
    return { url: `${baseUrl()}/gmailLinkStart?n=${nonce}` };
  },
);

/** Sends whoever opens a valid link on to Google's consent page. */
export const gmailLinkStart = onRequest(
  { region: REGION, secrets: [GMAIL_CLIENT_ID] },
  async (req, res) => {
    const nonce = String(req.query.n ?? "");
    if (!(await openRequest(nonce))) {
      res.status(400).type("html").send(page("This link has expired", "Ask for a new one from Nucleus."));
      return;
    }
    res.redirect(302, googleAuthUrl({ clientId: GMAIL_CLIENT_ID.value(), redirectUri: redirectUri(), state: nonce }));
  },
);

// ── Finishing a link ────────────────────────────────────────────────────────

/** Google sends the person back here with a code, or with an error if they said no. */
export const gmailOAuthCallback = onRequest(
  { region: REGION, secrets: [GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET] },
  async (req, res) => {
    const state = String(req.query.state ?? "");
    const code = String(req.query.code ?? "");
    const reply = (status: number, title: string, body: string) => { res.status(status).type("html").send(page(title, body)); };

    if (req.query.error) {
      reply(200, "Gmail wasn't connected", "You can close this window. Try again from Nucleus whenever you like.");
      return;
    }
    const request = await openRequest(state);
    if (!request || !code) {
      reply(400, "This link has expired", "Ask for a new one from Nucleus.");
      return;
    }

    // A code works once: claim it before spending Google's code, so a replayed
    // link can't be used a second time.
    const db = getFirestore();
    const claimRef = db.collection("gmailLinkRequests").doc(state);
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(claimRef);
      if (!snap.exists || snap.data()?.usedAt) return false;
      tx.update(claimRef, { usedAt: Date.now() });
      return true;
    });
    if (!claimed) {
      reply(400, "This link has already been used", "Ask for a new one from Nucleus.");
      return;
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: GMAIL_CLIENT_ID.value(), client_secret: GMAIL_CLIENT_SECRET.value(),
        redirect_uri: redirectUri(), grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      logger.warn("gmail link: Google refused the code", { status: tokenRes.status });
      reply(502, "Couldn't connect Gmail", "Google didn't accept the sign-in. Ask for a new link from Nucleus and try again.");
      return;
    }
    const tok = (await tokenRes.json()) as { refresh_token?: string; scope?: string; id_token?: string };
    const email = emailFromIdToken(tok.id_token);
    if (!tok.refresh_token || !email || !(tok.scope ?? "").includes("gmail.readonly")) {
      reply(400, "Gmail wasn't fully connected",
        "Nucleus needs permission to read your email, and to keep it between scans. Ask for a new link and allow both when Google asks.");
      return;
    }

    const id = linkIdFor(email);
    const hh = db.collection("households").doc(request.householdId);
    const batch = db.batch();
    batch.set(hh.collection("gmailSecrets").doc(id), { refreshToken: tok.refresh_token, scope: tok.scope, updatedAt: Date.now() });
    batch.set(hh.collection("gmailLinks").doc(id), {
      email, ownerCode: request.ownerCode, status: "active", linkedAt: Date.now(), linkedByUid: request.createdByUid,
      lastError: FieldValue.delete(),
    }, { merge: true });
    await batch.commit();
    logger.info("gmail link: linked", { householdId: request.householdId, link: id, ownerCode: request.ownerCode });
    reply(200, "Gmail connected", `${escapeHtml(email)} is linked to Nucleus. You can close this window.`);
  },
);

// ── Using and removing saved access ────────────────────────────────────────

/** The saved access for an inbox is gone or no longer honoured by Google. */
export class LinkNeedsReconnect extends Error {}

/** A fresh one-hour access token for a linked inbox, from its saved refresh token. */
export async function accessTokenFor(householdId: string, linkId: string): Promise<string> {
  const secret = (await getFirestore().collection("households").doc(householdId).collection("gmailSecrets").doc(linkId).get())
    .data() as { refreshToken?: string } | undefined;
  if (!secret?.refreshToken) throw new LinkNeedsReconnect("No saved access for this inbox.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID.value(), client_secret: GMAIL_CLIENT_SECRET.value(),
      refresh_token: secret.refreshToken, grant_type: "refresh_token",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant") throw new LinkNeedsReconnect("Google no longer honours the saved access.");
    throw new Error(`Google token refresh failed (${res.status}).`);
  }
  return json.access_token;
}

/** Stop scanning an inbox: revoke the access at Google, then forget it here. */
export const disconnectGmailLink = onCall<{ linkId?: string }, Promise<{ ok: true }>>(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to use this.");
    const linkId = String(request.data.linkId ?? "");
    if (!LINK_ID.test(linkId)) throw new HttpsError("invalid-argument", "Which inbox?");
    const hh = await householdFor(uid);

    const ref = getFirestore().collection("households").doc(hh.id);
    const token = ((await ref.collection("gmailSecrets").doc(linkId).get()).data() as { refreshToken?: string } | undefined)?.refreshToken;
    if (token) {
      // Best effort: if Google can't be reached the access is still forgotten here.
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
    }
    await Promise.all([ref.collection("gmailSecrets").doc(linkId).delete(), ref.collection("gmailLinks").doc(linkId).delete()]);
    logger.info("gmail link: disconnected", { householdId: hh.id, link: linkId });
    return { ok: true };
  },
);
