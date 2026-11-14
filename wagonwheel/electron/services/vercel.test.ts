import { describe, expect, it } from "vitest";
import { AppError } from "../db/errors.js";
import type { Fetch } from "../github/device-flow.js";
import { monthsAgo, totalUsage, VercelClient } from "./vercel.js";

// Vercel's billing API, as it really answers (checked against a real account): one JSON line per service per day,
// `BilledCost` the usage billed beyond the plan (fractions of a cent), the plan's own fee spread across the cycle in
// `EffectiveCost`, which is not what this adds up.
const line = (o: Record<string, unknown>): string => JSON.stringify({ BillingCurrency: "USD", ChargeCategory: "Usage", ...o });

/** A body that arrives in the given pieces, the way a big streamed answer does. */
const streamOf = (...chunks: string[]): ReadableStream<Uint8Array> => {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } });
};

describe("totalUsage", () => {
  it("adds up the usage billed beyond the plan, and counts the records", async () => {
    const body = streamOf([
      line({ ServiceName: "Deployment Storage", BilledCost: 0.0016971223752732, EffectiveCost: 0.0016971223752732 }),
      line({ ServiceName: "Function Storage", BilledCost: 0.00017661593048970002 }),
      line({ ServiceName: "Additional Team Seats", BilledCost: 0, EffectiveCost: 0.6666666666 }),
      line({ ServiceName: "ISR Reads", BilledCost: "0.0001212" }),
    ].join("\n"));
    const t = await totalUsage(body);
    expect(t.records).toBe(4);
    expect(t.skipped).toBe(0);
    expect(t.billedDollars).toBeCloseTo(0.0016971223752732 + 0.00017661593048970002 + 0.0001212, 12);
  });

  it("does not count the plan fee spread across the cycle (EffectiveCost), only what is billed", async () => {
    const t = await totalUsage(streamOf(line({ ServiceName: "Additional Team Seats", BilledCost: 0, EffectiveCost: 0.6666666666 })));
    expect(t.billedDollars).toBe(0);
    expect(t.records).toBe(1);
  });

  it("reads a line that is split across two pieces of the stream", async () => {
    const whole = line({ BilledCost: 1.25 });
    const t = await totalUsage(streamOf(whole.slice(0, 20), whole.slice(20) + "\n" + line({ BilledCost: 2 }).slice(0, 9), line({ BilledCost: 2 }).slice(9)));
    expect(t.billedDollars).toBe(3.25);
    expect(t.records).toBe(2);
  });

  it("skips what is not a usable record, and says how many", async () => {
    const t = await totalUsage(streamOf(["not json", "", "[1,2]", line({ BilledCost: "abc" }), line({ ServiceName: "no cost" }), line({ BilledCost: 5 })].join("\n")));
    expect(t).toEqual({ billedDollars: 5, records: 1, skipped: 4 });
  });

  it("is zero for an empty or missing answer", async () => {
    expect(await totalUsage(streamOf(""))).toEqual({ billedDollars: 0, records: 0, skipped: 0 });
    expect(await totalUsage(null)).toEqual({ billedDollars: 0, records: 0, skipped: 0 });
  });

  it("refuses usage in another currency rather than show a wrong number", async () => {
    await expect(totalUsage(streamOf(line({ BilledCost: 1, BillingCurrency: "EUR" })))).rejects.toThrow(AppError);
    await expect(totalUsage(streamOf(line({ BilledCost: 1, BillingCurrency: "EUR" })))).rejects.toThrow(/EUR/);
  });
});

describe("monthsAgo", () => {
  it("is the first day of the month, in UTC", () => {
    const now = Date.UTC(2026, 10, 9, 15, 30);
    expect(monthsAgo(now, 0).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(monthsAgo(now, 1).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(monthsAgo(Date.UTC(2026, 0, 31), 1).toISOString()).toBe("2025-12-01T00:00:00.000Z");
  });
});

describe("VercelClient", () => {
  interface Seen { url?: string; auth?: string; method?: string }
  const ask = (status: number, body: string | ReadableStream<Uint8Array> = "", seen: Seen = {}): Fetch =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      seen.url = String(input);
      seen.method = init?.method ?? "GET";
      seen.auth = (init?.headers as Record<string, string>)?.Authorization;
      return new Response(body, { status });
    }) as Fetch;
  const from = new Date(Date.UTC(2026, 10, 1));
  const to = new Date(Date.UTC(2026, 10, 9));

  it("asks for the range with the token, as a GET, and passes the team", async () => {
    const seen: Seen = {};
    const total = await new VercelClient(ask(200, line({ BilledCost: 0.5 }), seen), () => "tok_abc", () => "team_123").usage(from, to);
    expect(total.billedDollars).toBe(0.5);
    expect(seen.method).toBe("GET");
    expect(seen.auth).toBe("Bearer tok_abc");
    const url = new URL(seen.url ?? "");
    expect(url.origin + url.pathname).toBe("https://api.vercel.com/v1/billing/charges");
    expect(url.searchParams.get("from")).toBe("2026-11-01T00:00:00.000Z");
    expect(url.searchParams.get("to")).toBe("2026-11-09T00:00:00.000Z");
    expect(url.searchParams.get("teamId")).toBe("team_123");
  });

  it("leaves the team out for a personal account", async () => {
    const seen: Seen = {};
    await new VercelClient(ask(200, "", seen), () => "tok", () => null).usage(from, to);
    expect(new URL(seen.url ?? "").searchParams.has("teamId")).toBe(false);
  });

  it("checks a token with the last hour only", async () => {
    const seen: Seen = {};
    const now = Date.UTC(2026, 10, 9, 12);
    await new VercelClient(ask(200, "x", seen), () => "tok", () => null).check(now);
    const url = new URL(seen.url ?? "");
    expect(url.searchParams.get("from")).toBe("2026-11-09T11:00:00.000Z");
    expect(url.searchParams.get("to")).toBe("2026-11-09T12:00:00.000Z");
  });

  it("says what went wrong, in words", async () => {
    const run = (status: number) => new VercelClient(ask(status), () => "tok", () => null).usage(from, to);
    await expect(run(401)).rejects.toThrow(/did not accept this token/);
    await expect(run(403)).rejects.toThrow(/did not accept this token/);
    await expect(run(404)).rejects.toThrow(/could not find that team/);
    await expect(run(429)).rejects.toThrow(/too many requests/);
    await expect(run(500)).rejects.toThrow(/HTTP 500/);
    await expect(new VercelClient(ask(401), () => "tok", () => null).check(Date.now())).rejects.toThrow(/did not accept this token/);
  });

  it("says so when there is no token, when Vercel cannot be reached, and when the answer drops part way", async () => {
    await expect(new VercelClient(ask(200), () => null, () => null).usage(from, to)).rejects.toThrow(/Connect Vercel first/);
    const down = (async () => { throw new Error("offline"); }) as unknown as Fetch;
    await expect(new VercelClient(down, () => "tok", () => null).usage(from, to)).rejects.toThrow(/Could not reach Vercel/);
    const broken = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(line({ BilledCost: 1 }) + "\n")); c.error(new Error("reset")); } });
    await expect(new VercelClient(ask(200, broken), () => "tok", () => null).usage(from, to)).rejects.toThrow(/connection to Vercel dropped/);
  });
});
