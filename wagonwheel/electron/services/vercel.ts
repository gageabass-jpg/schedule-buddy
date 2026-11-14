import { AppError } from "../db/errors.js";
import { USER_AGENT, type Fetch } from "../github/device-flow.js";

// Checks how much Vercel usage has been billed beyond the plan, from its billing-charges API (GET /v1/billing/charges).
// Read-only: it only ever sends GET.
//
// What that API holds, checked against a real account: usage, one record per service per day (700+ a day, so a month is
// tens of megabytes). `BilledCost` is usage billed BEYOND what the plan includes: pennies on a quiet Pro plan. The plan's
// own fee is not a charge there (it is spread across the cycle in `EffectiveCost`, before tax), and invoice totals, tax and
// one-off purchases are not in it at all. So this can say "usage is climbing", never "this is what the bill was".
// The answer is a stream of JSON lines (FinOps "FOCUS" format); it is totalled as it arrives, never held whole.
// https://vercel.com/docs/rest-api/billing/list-focus-billing-charges

const API = "https://api.vercel.com";

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** A cost field that may arrive as a number or as a numeric string. */
function amount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export interface UsageTotal {
  /** Usage billed beyond the plan, in dollars (it can be a fraction of a cent). */
  billedDollars: number;
  /** How many usable records were added up. */
  records: number;
  /** Lines that were not usable records, and left out. */
  skipped: number;
}

/** Add up `BilledCost` over a stream of JSON lines as it arrives. A bill in another currency is refused, not converted. */
export async function totalUsage(body: ReadableStream<Uint8Array> | null): Promise<UsageTotal> {
  const out: UsageTotal = { billedDollars: 0, records: 0, skipped: 0 };
  if (!body) return out;

  const take = (line: string): void => {
    if (line.trim() === "") return;
    let row: Record<string, unknown> | null;
    try { row = obj(JSON.parse(line)); } catch { row = null; }
    const cost = row ? amount(row.BilledCost) : null;
    if (!row || cost == null) { out.skipped++; return; }
    const currency = typeof row.BillingCurrency === "string" ? row.BillingCurrency.toUpperCase() : "USD";
    if (currency !== "USD") throw new AppError("services", `Vercel reports usage in ${currency}. Wagonwheel only reads US dollars.`);
    out.billedDollars += cost;
    out.records++;
  };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = pending.indexOf("\n")) >= 0) {
      take(pending.slice(0, at));
      pending = pending.slice(at + 1);
    }
  }
  take(pending + decoder.decode());
  return out;
}

/** The first day of the month `back` months before `now`, in UTC. */
export function monthsAgo(now: number, back: number): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
}

export class VercelClient {
  constructor(
    private readonly f: Fetch,
    private readonly token: () => string | null,
    private readonly teamId: () => string | null,
  ) {}

  /** Ask for a date range and say, in words, what went wrong if Vercel refuses. The body is left unread. */
  private async request(from: Date, to: Date, timeoutMs: number): Promise<Response> {
    const token = this.token();
    if (!token) throw new AppError("services", "Connect Vercel first: add a token from your Vercel account.");
    const team = this.teamId();
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (team) query.set("teamId", team);
    let res: Response;
    try {
      res = await this.f(`${API}/v1/billing/charges?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/jsonl, application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AppError("services", "Could not reach Vercel. Check your internet connection and try again.");
    }
    if (res.ok) return res;
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 401 || res.status === 403) {
      throw new AppError("services", "Vercel did not accept this token. Check that it is a current token and, if it is for a team, that the team id is right and the token was created for that team.");
    }
    if (res.status === 404) throw new AppError("services", "Vercel could not find that team. Check the team id, or leave it blank for your personal account.");
    if (res.status === 429) throw new AppError("services", "Vercel says too many requests were made. Try again in a minute.");
    throw new AppError("services", `Vercel's billing API answered with an error (HTTP ${res.status}).`);
  }

  /** Is the token accepted? Asks for the last hour only and does not read the answer. */
  async check(now: number): Promise<void> {
    const res = await this.request(new Date(now - 3_600_000), new Date(now), 30_000);
    await res.body?.cancel().catch(() => undefined);
  }

  /** Usage billed beyond the plan in a date range, totalled as the records arrive. A month is tens of megabytes, so the wait is long. */
  async usage(from: Date, to: Date): Promise<UsageTotal> {
    const res = await this.request(from, to, 180_000);
    try {
      return await totalUsage(res.body);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("services", "The connection to Vercel dropped while its usage was being read. Try again.");
    }
  }
}
