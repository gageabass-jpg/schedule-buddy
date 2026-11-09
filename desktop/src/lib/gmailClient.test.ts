import { describe, expect, it, vi } from "vitest";
import { createGmailClient, GmailError } from "./emailEvents";

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fake Gmail: answers by URL, records what was asked. */
function fakeGmail(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return json({ error: { message: `unexpected ${url}` } }, 404);
    return routes[key]();
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

const meta = (id: string, subject: string) => json({
  id, snippet: `snippet for ${subject}`,
  payload: { headers: [{ name: "From", value: "Dr Lee <lee@x.com>" }, { name: "Subject", value: subject }, { name: "Date", value: "Mon, 9 Nov 2026" }] },
});

describe("createGmailClient", () => {
  it("searches, then fetches each hit's headers, sending the token as a bearer", async () => {
    const { fetchFn, calls } = fakeGmail({
      "messages?maxResults": () => json({ messages: [{ id: "aaaaaa111111" }, { id: "bbbbbb222222" }] }),
      "messages/aaaaaa111111": () => meta("aaaaaa111111", "Dental reminder"),
      "messages/bbbbbb222222": () => meta("bbbbbb222222", "School closing"),
    });
    const found = await createGmailClient("tok123", fetchFn).search("newer_than:30d appointment", 5);
    expect(found.map((m) => m.subject)).toEqual(["Dental reminder", "School closing"]);
    expect(found[0]).toMatchObject({ id: "aaaaaa111111", from: "Dr Lee <lee@x.com>", date: "Mon, 9 Nov 2026", snippet: "snippet for Dental reminder" });
    expect(calls.every((c) => c.auth === "Bearer tok123")).toBe(true);
    expect(calls[0].url).toContain("q=newer_than%3A30d%20appointment");
    expect(calls[0].url).toContain("maxResults=5");
  });

  it("returns nothing for a search with no hits, and caps how many it asks for", async () => {
    const { fetchFn, calls } = fakeGmail({ "messages?maxResults": () => json({}) });
    expect(await createGmailClient("t", fetchFn).search("nothing", 500)).toEqual([]);
    expect(calls[0].url).toContain("maxResults=15");
  });

  it("reads a message with its text", async () => {
    const { fetchFn } = fakeGmail({
      "messages/cccccc333333?format=full": () => json({
        id: "cccccc333333", snippet: "s",
        payload: { mimeType: "text/plain", headers: [{ name: "Subject", value: "Visit" }], body: { data: b64url("Tuesday at 2:30") } },
      }),
    });
    const m = await createGmailClient("t", fetchFn).read("cccccc333333");
    expect(m).toMatchObject({ id: "cccccc333333", subject: "Visit", body: "Tuesday at 2:30" });
  });

  it("refuses an id that isn't a message id, without calling Gmail", async () => {
    const { fetchFn, calls } = fakeGmail({});
    await expect(createGmailClient("t", fetchFn).read("../../drafts")).rejects.toBeInstanceOf(GmailError);
    expect(calls).toHaveLength(0);
  });

  it("raises Gmail's refusal with its status, and Google's enable link when the API is off", async () => {
    const off = fakeGmail({
      "messages?maxResults": () => json({ error: { message: "Gmail API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123 then retry." } }, 403),
    });
    const err = await createGmailClient("t", off.fetchFn).search("x").catch((e) => e);
    expect(err).toBeInstanceOf(GmailError);
    expect(err.status).toBe(403);
    expect(err.enableUrl).toBe("https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123");

    const expired = fakeGmail({ "messages?maxResults": () => json({ error: { message: "Invalid Credentials" } }, 401) });
    const err2 = await createGmailClient("old", expired.fetchFn).search("x").catch((e) => e);
    expect(err2).toMatchObject({ status: 401, message: "Invalid Credentials" });
    expect(err2.enableUrl).toBeUndefined();
  });
});
