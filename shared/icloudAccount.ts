/**
 * What an iCloud Mail account looks like, for checking what the user typed before
 * it goes anywhere. Apple has no sign-in flow for third-party mail access, so
 * reading an iCloud inbox takes the iCloud address and an app-specific password:
 * a 16-letter code made at account.apple.com, not the Apple ID password.
 */

const ICLOUD_DOMAINS = new Set(["icloud.com", "me.com", "mac.com"]);

/** An address at one of the domains iCloud Mail uses. */
export function isIcloudAddress(email: string): boolean {
  const m = /^[^\s@]+@([^\s@]+)$/.exec(email.trim().toLowerCase());
  return !!m && ICLOUD_DOMAINS.has(m[1]);
}

/**
 * An app-specific password as Apple writes it ("abcd-efgh-ijkl-mnop"), whatever
 * spacing or case it was typed or pasted in; undefined when it isn't 16 letters.
 */
export function cleanAppPassword(raw: string): string | undefined {
  const letters = raw.replace(/[\s-]/g, "").toLowerCase();
  return /^[a-z]{16}$/.test(letters) ? letters.match(/.{4}/g)!.join("-") : undefined;
}
