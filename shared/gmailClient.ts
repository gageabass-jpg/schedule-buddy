/**
 * A small read-only Gmail client: search a mailbox and read a message. It takes
 * the access token and the fetch to use as arguments, so the function passes the
 * user's short-lived token and the tests pass a fake. Nothing here writes to
 * Gmail, and the token is never stored or logged.
 */
import { extractEmailText, headerOf, type GmailPart } from "./emailEvents";

export interface EmailSummary { id: string; from: string; subject: string; date: string; snippet: string }
export interface EmailFull extends EmailSummary { body: string }

/** What a scan needs from a mailbox, whichever provider it is: Gmail's client
 *  below, or the iCloud one (functions/src/icloudMail.ts). */
export interface MailClient {
  /** Messages matching a search in Gmail's shorthand ("newer_than:30d appointment"), newest first. */
  search(query: string, maxResults?: number): Promise<EmailSummary[]>;
  /** One message with its readable text. */
  read(id: string): Promise<EmailFull>;
  /** Let go of the connection, for providers that hold one open. */
  close?(): Promise<void>;
}

/** Gmail said no. `enableUrl` is Google's link for switching the Gmail API on, when that's the reason. */
export class GmailError extends Error {
  constructor(message: string, readonly status: number, readonly enableUrl?: string) {
    super(message);
    this.name = "GmailError";
  }
}

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
// Gmail ids are short hex strings; anything else never reaches a URL.
const MESSAGE_ID = /^[A-Za-z0-9_-]{6,64}$/;

interface RawMessage { id?: string; snippet?: string; payload?: GmailPart }

async function toGmailError(res: Response): Promise<GmailError> {
  let message = `Gmail returned ${res.status}`;
  let enableUrl: string | undefined;
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    if (json.error?.message) message = json.error.message;
    enableUrl = /https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"')]+/.exec(message)?.[0];
  } catch { /* keep the status line */ }
  return new GmailError(message, res.status, enableUrl);
}

export function createGmailClient(token: string, fetchFn: typeof fetch = fetch) {
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetchFn(`${API}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw await toGmailError(res);
    return (await res.json()) as T;
  };
  const summary = (m: RawMessage): EmailSummary => ({
    id: m.id ?? "",
    from: headerOf(m.payload, "From"),
    subject: headerOf(m.payload, "Subject"),
    date: headerOf(m.payload, "Date"),
    snippet: (m.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
  });

  return {
    /** Messages matching a Gmail search ("newer_than:30d appointment"), newest first. */
    async search(query: string, maxResults = 10): Promise<EmailSummary[]> {
      const n = Math.min(15, Math.max(1, Math.floor(maxResults) || 10));
      const list = await get<{ messages?: Array<{ id: string }> }>(`messages?maxResults=${n}&q=${encodeURIComponent(query)}`);
      const ids = (list.messages ?? []).map((m) => m.id).filter((id) => MESSAGE_ID.test(id));
      const metas = await Promise.all(ids.map((id) =>
        get<RawMessage>(`messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)));
      return metas.map(summary);
    },
    /** One message with its readable text. */
    async read(id: string): Promise<EmailFull> {
      if (!MESSAGE_ID.test(id)) throw new GmailError("That isn't a message id.", 400);
      const m = await get<RawMessage>(`messages/${id}?format=full`);
      return { ...summary(m), body: extractEmailText(m.payload) };
    },
  };
}
