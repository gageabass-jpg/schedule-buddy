/**
 * Pure helpers for linking a Gmail inbox for the weekly scan and for running
 * that scan: the Google consent link, reading which address was linked, how far
 * back a scan should look, and how its result reads. In shared/ so the functions
 * and the tests run the same code.
 */

/** The permissions asked for: read mail, and learn which address this is. */
export const GMAIL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"] as const;

/**
 * Google's consent link for an offline (lasting) grant. `state` is the one-time
 * code that ties the answer back to the household that asked; `prompt=consent`
 * makes Google issue a refresh token even to someone who allowed Nucleus before.
 */
export function googleAuthUrl(opts: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "false",
    state: opts.state,
  });
  if (opts.loginHint) q.set("login_hint", opts.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

/**
 * The email address in a Google ID token. The token comes straight from Google's
 * token endpoint over TLS in exchange for the code, so it is read, not verified.
 * Undefined when it isn't a token or carries no address.
 */
export function emailFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== "string") return undefined;
  const part = idToken.split(".")[1];
  if (!part) return undefined;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder("utf-8").decode(Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)));
    const email = (JSON.parse(json) as { email?: unknown }).email;
    return typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

const DAY_MS = 86_400_000;

/**
 * How many days of mail a scan should look at: back to just before the last scan,
 * so nothing falls in the gap, but never less than a week or more than a month.
 * A first scan, with no last one, looks at ten days.
 */
export function lookbackDays(lastScanMs: number | undefined, nowMs: number): number {
  if (!lastScanMs || lastScanMs > nowMs) return 10;
  return Math.min(30, Math.max(7, Math.ceil((nowMs - lastScanMs) / DAY_MS) + 1));
}

/** What to tell the model to do on the weekly, automatic scan. */
export function weeklyInstruction(email: string, days: number): string {
  return `This is the automatic weekly scan of ${email}. Look only at mail from the last ${days} days ` +
    `(search with newer_than:${days}d) for appointments and events with a date still to come.`;
}

/** A line for the notification: "Catthew's Vet Appointment (Nov 20)", then "and 2 more". */
export function addedSummary(events: ReadonlyArray<{ title: string; date: string }>, max = 2): string {
  const when = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  const shown = events.slice(0, max).map((e) => `${e.title} (${when(e.date)})`);
  const rest = events.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}
