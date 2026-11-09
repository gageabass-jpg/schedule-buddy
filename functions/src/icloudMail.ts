// Reading an iCloud inbox, for the email scan.
//
// Apple has no sign-in flow for apps that read someone's mail, so this goes in by
// IMAP (imap.mail.me.com) with the iCloud address and an app-specific password the
// person made at account.apple.com. It is a MailClient like Gmail's, so a scan
// can't tell the two apart. It only reads: the inbox is opened read-only, nothing
// is flagged, moved or deleted, and the password is never logged.

import { ImapFlow, type SearchObject } from "imapflow";
import { simpleParser } from "mailparser";
import { MAX_BODY_CHARS, stripHtml } from "./shared/emailEvents";
import type { EmailFull, EmailSummary, MailClient } from "./shared/gmailClient";
import { parseMailQuery, type MailQuery } from "./shared/mailQuery";
import { LinkNeedsReconnect } from "./gmailLinks";

const HOST = "imap.mail.me.com";
const PORT = 993;
const UID = /^\d{1,10}$/;
/** Bytes of one message read for its summary, and for reading it whole. */
const PEEK_BYTES = 24 * 1024;
const READ_BYTES = 1024 * 1024;
const MAX_RESULTS = 15;

/** What to ask the server for: the date floor and the words, as IMAP search keys. */
export function imapSearch(q: MailQuery, now = new Date()): SearchObject {
  const search: SearchObject = {};
  if (q.sinceDays) search.since = new Date(now.getTime() - q.sinceDays * 86_400_000);
  const terms = q.terms.map((text) => ({ text }));
  // `all` keeps a query of only operators ("newer_than:7d") from being an empty search.
  if (terms.length === 1) search.text = terms[0].text;
  else if (terms.length > 1) search.or = terms;
  else if (!search.since) search.all = true;
  return search;
}

function dateHeader(d: Date | string | undefined): string {
  const date = d ? new Date(d) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date.toUTCString() : "";
}

function fromHeader(from: Array<{ name?: string; address?: string }> | undefined): string {
  const a = from?.[0];
  if (!a) return "";
  return a.name && a.address ? `${a.name} <${a.address}>` : a.address ?? a.name ?? "";
}

/** A message's readable text from its source: plain text, else the HTML reduced to its words. */
async function textOf(source: Buffer): Promise<string> {
  try {
    const mail = await simpleParser(source);
    const text = mail.text?.trim() || (typeof mail.html === "string" ? stripHtml(mail.html) : "");
    return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return "";
  }
}

/** Sign in to iCloud Mail. Throws LinkNeedsReconnect when Apple refuses the password. */
export async function createIcloudClient(email: string, appPassword: string): Promise<MailClient> {
  const imap = new ImapFlow({
    host: HOST, port: PORT, secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000,
  });
  // A dropped connection is reported by whatever call was waiting on it.
  imap.on("error", () => undefined);
  try {
    await imap.connect();
  } catch (e) {
    imap.close();
    if ((e as { authenticationFailed?: boolean }).authenticationFailed) {
      throw new LinkNeedsReconnect("Apple no longer accepts the saved password.");
    }
    throw e;
  }

  const inbox = async <T>(fn: () => Promise<T>): Promise<T> => {
    const lock = await imap.getMailboxLock("INBOX", { readOnly: true });
    try { return await fn(); } finally { lock.release(); }
  };

  return {
    async search(query: string, maxResults = 10): Promise<EmailSummary[]> {
      const n = Math.min(MAX_RESULTS, Math.max(1, Math.floor(maxResults) || 10));
      return inbox(async () => {
        const uids = (await imap.search(imapSearch(parseMailQuery(query)), { uid: true })) || [];
        const newest = uids.sort((a, b) => b - a).slice(0, n);
        const out: EmailSummary[] = [];
        for (const uid of newest) {
          const m = await imap.fetchOne(String(uid), { uid: true, envelope: true, source: { maxLength: PEEK_BYTES } }, { uid: true });
          if (!m) continue;
          const text = m.source ? await textOf(m.source) : "";
          out.push({
            id: String(uid),
            from: fromHeader(m.envelope?.from),
            subject: m.envelope?.subject ?? "",
            date: dateHeader(m.envelope?.date),
            snippet: text.replace(/\s+/g, " ").slice(0, 300),
          });
        }
        return out;
      });
    },

    async read(id: string): Promise<EmailFull> {
      if (!UID.test(id)) throw new Error("That isn't a message id.");
      return inbox(async () => {
        const m = await imap.fetchOne(id, { uid: true, envelope: true, source: { maxLength: READ_BYTES } }, { uid: true });
        if (!m) throw new Error("That message isn't in the inbox.");
        const body = (m.source ? await textOf(m.source) : "").slice(0, MAX_BODY_CHARS);
        return {
          id,
          from: fromHeader(m.envelope?.from),
          subject: m.envelope?.subject ?? "",
          date: dateHeader(m.envelope?.date),
          snippet: body.replace(/\s+/g, " ").slice(0, 300),
          body,
        };
      });
    },

    async close(): Promise<void> {
      try { await imap.logout(); } catch { imap.close(); }
    },
  };
}
