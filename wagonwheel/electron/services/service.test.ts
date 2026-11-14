import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { Workspace } from "../db/repo.js";
import type { Fetch } from "../github/device-flow.js";
import type { SecretBox } from "../github/credentials.js";
import { ServiceTokenStore } from "./credentials.js";
import { ServicesService } from "./service.js";

// The Services feature against a stand-in for Vercel: a real database in memory, no network, no Electron.

const box = (available = true): SecretBox => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(`enc:${[...plain].reverse().join("")}`),
  decrypt: (data) => [...data.toString().replace(/^enc:/, "")].reverse().join(""),
});

const TOKEN = "vcp_abcdefghijklmnopqrstuvwxyz0123";
const NOW = Date.UTC(2026, 10, 9, 12);   // 9 Nov 2026

interface Seen { url: URL; auth: string | undefined }
type Answer = { status?: number; body?: string };

/** A fake Vercel that answers by the start of the window asked for, and records every request. */
function fakeVercel(answer: (url: URL) => Answer) {
  const seen: Seen[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
    const a = answer(url);
    return new Response(a.body ?? "", { status: a.status ?? 200 });
  }) as Fetch;
  return { fetch: fetchFn, seen };
}

/** Daily usage records totalling `dollars` of usage billed beyond the plan, plus the plan fee spread across the cycle. */
const usageBody = (dollars: number): string => [
  JSON.stringify({ BillingCurrency: "USD", ChargeCategory: "Usage", ServiceName: "Additional Team Seats", BilledCost: 0, EffectiveCost: 0.6667 }),
  JSON.stringify({ BillingCurrency: "USD", ChargeCategory: "Usage", ServiceName: "Deployment Storage", BilledCost: dollars / 2, EffectiveCost: dollars / 2 }),
  JSON.stringify({ BillingCurrency: "USD", ChargeCategory: "Usage", ServiceName: "ISR Reads", BilledCost: dollars / 2, EffectiveCost: dollars / 2 }),
].join("\n");

/** November so far and October, the two windows a usage check asks for, by the window's start. */
const months = (nov: number, oct: number) => (url: URL): Answer => {
  const from = url.searchParams.get("from") ?? "";
  if (from === "2026-11-01T00:00:00.000Z") return { body: usageBody(nov) };
  if (from === "2026-10-01T00:00:00.000Z") return { body: usageBody(oct) };
  return { body: "" };   // the one-hour check
};

let dir: string;
let file: string;
let ws: Workspace;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-services-"));
  file = path.join(dir, "service-tokens.json");
  ws = new Workspace(openDatabase(":memory:"), () => NOW, (() => { let n = 0; return () => `id-${++n}`; })());
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const make = (f: Fetch, available = true) => {
  const store = new ServiceTokenStore(file, box(available));
  return { store, service: new ServicesService({ fetch: f, store, workspace: () => ws, now: () => NOW }) };
};

describe("ServiceTokenStore", () => {
  it("keeps the token encrypted, apart from the database, readable only by the owner", () => {
    const { store } = make(fakeVercel(() => ({})).fetch);
    store.save("vercel", TOKEN, "team_1");
    const onDisk = fs.readFileSync(file, "utf8");
    expect(onDisk).not.toContain(TOKEN);
    expect(onDisk).toContain("team_1");
    expect(fs.statSync(file).mode & 0o077).toBe(0);
    expect(store.token("vercel")).toBe(TOKEN);
    expect(store.teamId("vercel")).toBe("team_1");
    expect(new ServiceTokenStore(file, box()).token("vercel")).toBe(TOKEN);   // survives a restart
  });

  it("holds the token in memory only when the keychain cannot keep it", () => {
    const { store } = make(fakeVercel(() => ({})).fetch, false);
    store.save("vercel", TOKEN, null);
    expect(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "").not.toContain(TOKEN);
    expect(store.token("vercel")).toBe(TOKEN);
    expect(new ServiceTokenStore(file, box(false)).token("vercel")).toBeNull();   // gone after a restart
  });

  it("forgets a token, and removes the file when nothing is left", () => {
    const { store } = make(fakeVercel(() => ({})).fetch);
    store.save("vercel", TOKEN, null);
    store.clear("vercel");
    expect(store.has("vercel")).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("ServicesService", () => {
  it("is not connected until a token is saved", () => {
    const { service } = make(fakeVercel(() => ({})).fetch);
    expect(service.status()).toEqual({ providers: [{ provider: "vercel", connected: false, teamId: null }], canKeepToken: true });
  });

  it("saves a token only after Vercel accepts it, trying it on the last hour only", async () => {
    const v = fakeVercel(() => ({}));
    const { service } = make(v.fetch);
    const status = await service.setToken("vercel", `  ${TOKEN} `, "team_9");
    expect(status.providers[0]).toEqual({ provider: "vercel", connected: true, teamId: "team_9" });
    expect(v.seen).toHaveLength(1);
    expect(v.seen[0].auth).toBe(`Bearer ${TOKEN}`);
    expect(v.seen[0].url.searchParams.get("from")).toBe("2026-11-09T11:00:00.000Z");   // an hour, not a month of daily records
    expect(v.seen[0].url.searchParams.get("teamId")).toBe("team_9");
  });

  it("saves nothing when Vercel refuses the token", async () => {
    const { service, store } = make(fakeVercel(() => ({ status: 401 })).fetch);
    await expect(service.setToken("vercel", TOKEN, "")).rejects.toThrow(/did not accept this token/);
    expect(store.has("vercel")).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("checks what the window sends before using it", async () => {
    const v = fakeVercel(() => ({}));
    const { service } = make(v.fetch);
    await expect(service.setToken("stripe", TOKEN, "")).rejects.toThrow(/not a service Wagonwheel can check usage on/);
    await expect(service.setToken("vercel", "short", "")).rejects.toThrow(/does not look like a Vercel token/);
    await expect(service.setToken("vercel", `${TOKEN} extra`, "")).rejects.toThrow(/does not look like a Vercel token/);
    await expect(service.setToken("vercel", TOKEN, "team id!")).rejects.toThrow(/team id may only have/);
    expect(v.seen).toHaveLength(0);   // nothing was sent anywhere
  });

  it("forgets a token on request", async () => {
    const { service } = make(fakeVercel(() => ({})).fetch);
    await service.setToken("vercel", TOKEN, "");
    expect(service.clearToken("vercel").providers[0].connected).toBe(false);
  });
});

describe("checking usage", () => {
  const connect = async (nov: number, oct: number, fee = 2120) => {
    const v = fakeVercel(months(nov, oct));
    const { service } = make(v.fetch);
    await service.setToken("vercel", TOKEN, "");
    const id = ws.createService({ name: "Vercel", provider: "vercel", amountCents: fee }).id;
    v.seen.length = 0;
    return { v, service, id };
  };

  it("reports the usage billed beyond the plan, this month so far and last month, in words", async () => {
    const { service, id } = await connect(0.003, 0.03);
    const out = await service.checkUsage(id);
    expect(out.summary).toBe("Vercel usage billed beyond your plan: less than a cent so far in November 2026 ($0.03 in October 2026). Nothing unusual. Your own bill figures were not changed.");
    expect(out.usage).toEqual({ month: "2026-11", billedUsd: 0.003, previousMonth: "2026-10", previousBilledUsd: 0.03, high: false });
  });

  it("asks for November so far and then October, one after the other", async () => {
    const { v, service, id } = await connect(0, 0);
    await service.checkUsage(id);
    expect(v.seen.map((s) => [s.url.searchParams.get("from"), s.url.searchParams.get("to")])).toEqual([
      ["2026-11-01T00:00:00.000Z", "2026-11-09T12:00:00.000Z"],
      ["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"],
    ]);
  });

  it("writes no bill and changes no figure; only 'last checked' moves", async () => {
    // The very thing that went wrong before: typed figures from the invoices, and Vercel's usage data reading as pennies.
    const { service, id } = await connect(0.003, 0.03);
    ws.setCharge({ serviceId: id, month: "2026-09", amountCents: 2120 });
    ws.setCharge({ serviceId: id, month: "2026-10", amountCents: 2120 });
    ws.setCharge({ serviceId: id, month: "2026-11", amountCents: 2120, paid: false });
    const before = ws.snapshot().serviceCharges;

    const out = await service.checkUsage(id);
    expect(out.snapshot.serviceCharges).toEqual(before);
    expect(ws.snapshot().serviceCharges).toEqual(before);
    expect(out.snapshot.services[0].lastSyncedAt).toBe(NOW);
  });

  it("calls it out when usage climbs, by a floor of $2 or a tenth of the plan fee", async () => {
    const high = await connect(7.4, 0.03);
    const out = await high.service.checkUsage(high.id);
    expect(out.usage.high).toBe(true);
    expect(out.summary).toBe("Vercel usage billed beyond your plan: $7.40 so far in November 2026 ($0.03 in October 2026). That is more than a quiet month: check Vercel's usage page.");
  });

  it("has a threshold that scales with the plan fee, and a $2 floor when none is set", async () => {
    // plan $21.20 -> a tenth is $2.12: $2.00 is quiet, $2.20 is not
    const pro = await connect(2, 0, 2120);
    expect((await pro.service.checkUsage(pro.id)).usage.high).toBe(false);
  });

  it("uses the floor of $2 when no usual fee is set", async () => {
    const none = await connect(2.5, 0, 0);
    expect((await none.service.checkUsage(none.id)).usage.high).toBe(true);
  });

  it("says so when a service has nothing to check, or Vercel is not connected, or the service is gone", async () => {
    const { service } = make(fakeVercel(() => ({})).fetch);
    const by_hand = ws.createService({ name: "GitHub" }).id;
    const linked = ws.createService({ name: "Vercel", provider: "vercel" }).id;
    await expect(service.checkUsage(by_hand)).rejects.toThrow(/GitHub has no usage to check/);
    await expect(service.checkUsage(linked)).rejects.toThrow(/Connect Vercel first/);
    await expect(service.checkUsage("nope")).rejects.toThrow(/no longer exists/);
  });

  it("changes nothing when a check fails part way", async () => {
    const good = make(fakeVercel(months(1, 1)).fetch);
    await good.service.setToken("vercel", TOKEN, "");
    const id = ws.createService({ name: "Vercel", provider: "vercel" }).id;
    ws.setCharge({ serviceId: id, month: "2026-10", amountCents: 2120 });
    const before = ws.snapshot();
    // November answers, October fails
    const flaky = make(fakeVercel((url) => (url.searchParams.get("from") === "2026-10-01T00:00:00.000Z" ? { status: 500 } : { body: usageBody(1) })).fetch);
    flaky.store.save("vercel", TOKEN, null);
    await expect(flaky.service.checkUsage(id)).rejects.toThrow(/HTTP 500/);
    expect(ws.snapshot()).toEqual(before);   // not even "last checked"
  });
});
