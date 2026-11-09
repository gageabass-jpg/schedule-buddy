/**
 * Helpers for finding calendar events in email: reading a Gmail message's text,
 * checking what the model proposes before it reaches the calendar, and spotting
 * an event the calendar already has. Pure, in shared/ so the function that scans
 * mail and the tests run the same code.
 */

/** The slice of a Gmail message part this reads. */
export interface GmailPart {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string };
  parts?: GmailPart[];
}

/** Events one scan may add. A scan that wants more is probably misreading mail. */
export const MAX_EVENTS_PER_SCAN = 15;
/** Characters of one email's text handed to the model. */
export const MAX_BODY_CHARS = 6000;

/** Gmail sends bodies as base64url; this reads them as UTF-8 text ("" if it can't). */
export function decodeBase64Url(data: string): string {
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return new TextDecoder("utf-8").decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

/** HTML mail reduced to its words, for a message with no plain-text part. */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A header's value by name, ignoring case ("" when absent). */
export function headerOf(payload: GmailPart | undefined, name: string): string {
  const want = name.toLowerCase();
  return (payload?.headers ?? []).find((h) => h.name?.toLowerCase() === want)?.value?.trim() ?? "";
}

function collect(part: GmailPart | undefined, mime: string, out: string[]): void {
  if (!part) return;
  if (part.mimeType === mime && part.body?.data) out.push(decodeBase64Url(part.body.data));
  for (const p of part.parts ?? []) collect(p, mime, out);
}

/** A message's readable text: its plain-text part, else its HTML with the tags
 *  removed, cut to `max` characters. */
export function extractEmailText(payload: GmailPart | undefined, max = MAX_BODY_CHARS): string {
  const plain: string[] = [];
  collect(payload, "text/plain", plain);
  let text = plain.join("\n").trim();
  if (!text) {
    const html: string[] = [];
    collect(payload, "text/html", html);
    text = stripHtml(html.join("\n"));
  }
  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ── Checking what the model proposes ────────────────────────────────────────

/** A real calendar date written YYYY-MM-DD (not 2026-02-30). */
export function validIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Whether `date` falls from `pastDays` before `today` to `futureDays` after. */
export function dateInWindow(date: string, today: string, pastDays = 1, futureDays = 550): boolean {
  const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const diff = Math.round((ms(date) - ms(today)) / 86400000);
  return diff >= -pastDays && diff <= futureDays;
}

/** A 24-hour HH:MM time, or undefined when it isn't one. */
export function cleanHHMM(s: unknown): string | undefined {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.trim()) ? s.trim() : undefined;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (t: string) => new Set(norm(t).split(" ").filter((w) => w.length > 2));

/**
 * Whether the calendar already has this event: the same day with the same title,
 * one title inside the other ("Dentist" and "Dentist appointment - Dr. Lee"), or
 * the same start time and mostly the same words. When unsure it says yes:
 * skipping a near-duplicate costs less than doubling an appointment.
 */
export function isDuplicateEvent(
  existing: ReadonlyArray<{ date: string; title: string; startTime?: string }>,
  cand: { date: string; title: string; startTime?: string },
): boolean {
  const c = norm(cand.title);
  const cw = words(cand.title);
  return existing.some((e) => {
    if (e.date !== cand.date) return false;
    const n = norm(e.title);
    if (n && c && (n === c || (Math.min(n.length, c.length) >= 4 && (n.includes(c) || c.includes(n))))) return true;
    if (e.startTime && cand.startTime && e.startTime === cand.startTime) {
      const ew = words(e.title);
      let shared = 0;
      for (const w of cw) if (ew.has(w)) shared++;
      return shared / Math.max(1, Math.min(cw.size, ew.size)) >= 0.5;
    }
    return false;
  });
}

// ── Making what's added read like a calendar entry ──────────────────────────

/** An event title kept short: single-spaced, and cut at a word with an ellipsis
 *  when it runs past `max`. The details belong in the notes. */
export function cleanTitle(title: unknown, max = 60): string {
  const s = String(title ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The first letter of each word capitalised: "catthew's vet appointment" →
 * "Catthew's Vet Appointment". A word starts after a space, hyphen, slash or
 * opening bracket or quote, so "parent-teacher" and "(microchip)" are covered
 * while the "s" in "Catthew's" is not. The rest of each word is left as
 * written, so "MRI" and "WVU" stay as they are.
 */
export function titleCase(text: string): string {
  return text.replace(/(^|[\s\-/(["])(\p{L})/gu, (_m, sep: string, letter: string) => sep + letter.toUpperCase());
}

/** The model's notes as a few short lines: one per line it gave, blanks dropped,
 *  each trimmed to size. "" when there are none. */
export function cleanNotes(notes: unknown, maxLines = 3, maxLine = 120): string {
  if (typeof notes !== "string") return "";
  return notes.split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((l) => (l.length > maxLine ? `${l.slice(0, maxLine - 1).trimEnd()}…` : l))
    .join("\n");
}

/** Who an email is from, as a name: the display name when there is one (without
 *  an address tucked in brackets after it), else the sender's domain.
 *  `"Samantha Church (management@x.com)" <no-reply@app.x.com>` → "Samantha Church". */
export function senderName(from: string): string {
  const raw = from.trim();
  const m = /^"?([^"<]*?)"?\s*<([^>]*)>$/.exec(raw);
  const name = (m ? m[1] : "").replace(/\s*\([^)]*@[^)]*\)/g, "").replace(/\s+/g, " ").trim();
  if (name && !name.includes("@")) return name;
  const address = (m ? m[2] : raw).trim();
  return address.split("@")[1]?.trim() || address || "email";
}

/** An email's Date header as "Oct 30", in the household's time zone ("" if unreadable). */
export function shortDate(emailDate: string, tz = "UTC"): string {
  const ms = Date.parse(emailDate);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }).format(new Date(ms));
}

/**
 * The notes for an event found in email: the model's own lines (place, address,
 * doctor), then one short line saying where it came from, so a wrong one can be
 * traced and deleted knowingly: "From email · Samantha Church · Oct 30".
 */
export function sourceNote(from: string, emailDate: string, extra?: unknown, tz = "UTC"): string {
  const when = shortDate(emailDate, tz);
  const line = `From email · ${senderName(from).slice(0, 40)}${when ? ` · ${when}` : ""}`;
  const more = cleanNotes(extra);
  return more ? `${more}\n${line}` : line;
}
