// Linking an iCloud inbox for the weekly email scan.
//
// Gmail sends people to Google's consent page; iCloud has no such page, so the
// person makes an app-specific password at account.apple.com and types it into the
// Console. That password goes through connectIcloudInbox and nowhere else: it is
// tried against iCloud Mail once (so a typo is caught on the spot), then sealed
// with AES-256-GCM (secretBox.ts) and saved in the same deny-all gmailSecrets
// document Gmail's refresh tokens use, beside a gmailLinks document the app can
// read. It is never logged and never sent back. Disconnecting deletes both
// (disconnectGmailLink); the password itself can be revoked at account.apple.com.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { cleanAppPassword, isIcloudAddress } from "./shared/icloudAccount";
import { GMAIL_CLIENT_SECRET, LinkNeedsReconnect, householdFor, linkIdFor } from "./gmailLinks";
import { createIcloudClient } from "./icloudMail";
import { open, seal } from "./secretBox";

/** The iCloud app-specific password saved for an inbox, opened. */
export async function icloudPasswordFor(householdId: string, linkId: string): Promise<string> {
  const saved = (await getFirestore().collection("households").doc(householdId).collection("gmailSecrets").doc(linkId).get())
    .data() as { provider?: string; password?: string } | undefined;
  if (saved?.provider !== "icloud" || !saved.password) throw new LinkNeedsReconnect("No saved password for this inbox.");
  try {
    return open(saved.password, GMAIL_CLIENT_SECRET.value());
  } catch {
    // The key changed, or the document was altered: either way it can't be used.
    throw new LinkNeedsReconnect("The saved password can't be read.");
  }
}

export const connectIcloudInbox = onCall<
  { email?: string; appPassword?: string; ownerCode?: string },
  Promise<{ email: string }>
>(
  { region: "us-central1", cors: true, secrets: [GMAIL_CLIENT_SECRET], timeoutSeconds: 60 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to use this.");
    const ownerCode = request.data.ownerCode === "K" ? "K" : request.data.ownerCode === "G" ? "G" : null;
    if (!ownerCode) throw new HttpsError("invalid-argument", "Whose inbox is it: G or K?");
    const email = String(request.data.email ?? "").trim().toLowerCase();
    if (!isIcloudAddress(email)) throw new HttpsError("invalid-argument", "That isn't an iCloud address. It should end in @icloud.com, @me.com or @mac.com.");
    const password = cleanAppPassword(String(request.data.appPassword ?? ""));
    if (!password) {
      throw new HttpsError("invalid-argument",
        "That doesn't look like an app-specific password. It is 16 letters in four groups, like abcd-efgh-ijkl-mnop, made at account.apple.com. Your Apple ID password won't work.");
    }
    const hh = await householdFor(uid);

    // Try it now, so a wrong password is reported here rather than on Sunday.
    try {
      const mail = await createIcloudClient(email, password);
      await mail.close?.();
    } catch (e) {
      if (e instanceof LinkNeedsReconnect) {
        throw new HttpsError("invalid-argument",
          "Apple didn't accept that address and password. Make a new app-specific password at account.apple.com and try again.");
      }
      logger.warn("icloud link: couldn't reach iCloud Mail", { householdId: hh.id, error: e instanceof Error ? e.message : String(e) });
      throw new HttpsError("unavailable", "Couldn't reach iCloud Mail. Try again in a minute.");
    }

    const id = linkIdFor(email);
    const ref = getFirestore().collection("households").doc(hh.id);
    const batch = getFirestore().batch();
    batch.set(ref.collection("gmailSecrets").doc(id), {
      provider: "icloud", password: seal(password, GMAIL_CLIENT_SECRET.value()), updatedAt: Date.now(),
    });
    batch.set(ref.collection("gmailLinks").doc(id), {
      email, ownerCode, provider: "icloud", status: "active", linkedAt: Date.now(), linkedByUid: uid,
      lastError: FieldValue.delete(),
    }, { merge: true });
    await batch.commit();
    logger.info("icloud link: linked", { householdId: hh.id, link: id, ownerCode });
    return { email };
  },
);
