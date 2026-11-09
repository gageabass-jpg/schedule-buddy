/**
 * The search the model writes, in Gmail's shorthand ("newer_than:30d appointment
 * OR reservation"), read for a mailbox that can't take it as it is (iCloud, over
 * IMAP). Only what matters survives: how far back to look, and the words to find.
 * The words are treated as alternatives, so a result may be a little broader than
 * Gmail's would be; the model reads each message before it adds anything.
 */

export interface MailQuery {
  /** Only mail from the last N days, when the query says so. */
  sinceDays?: number;
  /** Words or phrases to look for, any of which will do. */
  terms: string[];
}

const UNIT_DAYS: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };
const MAX_TERMS = 8;

export function parseMailQuery(query: string): MailQuery {
  let sinceDays: number | undefined;
  const terms: string[] = [];

  for (const m of query.matchAll(/"([^"]+)"|(\S+)/g)) {
    if (m[1] !== undefined) { terms.push(m[1].trim()); continue; }       // a quoted phrase
    const tok = m[2].replace(/^[()]+|[()]+$/g, "");
    if (!tok || /^(OR|AND)$/i.test(tok) || tok.startsWith("-")) continue; // operators, grouping, exclusions

    const recent = /^newer(?:_than)?:(\d+)([dwmy]?)$/i.exec(tok);
    if (recent) { sinceDays = Number(recent[1]) * UNIT_DAYS[(recent[2] || "d").toLowerCase()]; continue; }

    const op = /^([a-z_]+):(.*)$/i.exec(tok);
    if (op) {
      // from: and subject: name something to look for; the rest (label:, in:, is:, after:...) don't apply here.
      if (/^(from|subject)$/i.test(op[1]) && op[2].replace(/"/g, "").trim()) terms.push(op[2].replace(/"/g, "").trim());
      continue;
    }
    terms.push(tok);
  }

  const unique = [...new Set(terms.map((t) => t.toLowerCase()))].slice(0, MAX_TERMS);
  return { ...(sinceDays ? { sinceDays } : {}), terms: unique };
}
