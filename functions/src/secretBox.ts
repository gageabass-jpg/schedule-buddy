// Encrypting a saved mailbox password before it is stored.
//
// An iCloud app-specific password can do more than read mail (it works for sending
// too), so it is never stored as written. It is sealed with AES-256-GCM under a key
// derived from a Firebase secret, which lives in Secret Manager and nowhere in the
// database. Someone who got hold of the Firestore document alone (a bad rule, an
// export) would have only ciphertext. Changing the secret makes saved passwords
// unreadable, and each inbox then asks to be connected again.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const SALT = "nucleus-inbox-secrets-v1";

function keyFrom(secret: string): Buffer {
  return scryptSync(secret, SALT, 32);
}

/** `plain` sealed under `secret`: "v1.<iv>.<tag>.<ciphertext>", each part base64url. */
export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** What `seal` made, opened. Throws when it isn't one, was tampered with, or `secret` is not the one it was sealed under. */
export function open(sealed: string, secret: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Not a sealed value.");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
