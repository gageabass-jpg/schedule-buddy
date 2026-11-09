import { describe, expect, it } from "vitest";
import { addedSummary, emailFromIdToken, GMAIL_SCOPES, googleAuthUrl, lookbackDays, weeklyInstruction } from "./gmailOAuth";

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const idToken = (claims: object) => `${b64url('{"alg":"RS256"}')}.${b64url(JSON.stringify(claims))}.signature`;

describe("googleAuthUrl", () => {
  const url = new URL(googleAuthUrl({
    clientId: "cid.apps.googleusercontent.com",
    redirectUri: "https://us-central1-proj.cloudfunctions.net/gmailOAuthCallback",
    state: "abc123",
  }));
  const p = url.searchParams;

  it("goes to Google's consent page with the code flow", () => {
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe("cid.apps.googleusercontent.com");
    expect(p.get("redirect_uri")).toBe("https://us-central1-proj.cloudfunctions.net/gmailOAuthCallback");
    expect(p.get("state")).toBe("abc123");
  });

  it("asks for lasting (offline) access, always showing the consent and account chooser", () => {
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent select_account");
  });

  it("asks only to read mail and to know which address it is", () => {
    expect(p.get("scope")?.split(" ")).toEqual([...GMAIL_SCOPES]);
    expect(p.get("scope")).toContain("gmail.readonly");
    expect(p.get("scope")).not.toContain("gmail.modify");
    expect(p.get("scope")).not.toContain("gmail.send");
  });

  it("can suggest an account", () => {
    const hinted = new URL(googleAuthUrl({ clientId: "c", redirectUri: "https://x/cb", state: "s", loginHint: "a@b.com" }));
    expect(hinted.searchParams.get("login_hint")).toBe("a@b.com");
    expect(p.has("login_hint")).toBe(false);
  });
});

describe("emailFromIdToken", () => {
  it("reads the address, lower-cased", () => {
    expect(emailFromIdToken(idToken({ email: "Gage.A.Bass@Gmail.com", sub: "1" }))).toBe("gage.a.bass@gmail.com");
  });

  it("gives nothing for a token with no address, or for something that isn't one", () => {
    expect(emailFromIdToken(idToken({ sub: "1" }))).toBeUndefined();
    expect(emailFromIdToken(idToken({ email: "not-an-address" }))).toBeUndefined();
    expect(emailFromIdToken("garbage")).toBeUndefined();
    expect(emailFromIdToken("a.!!!.c")).toBeUndefined();
    expect(emailFromIdToken(undefined)).toBeUndefined();
  });
});

describe("lookbackDays", () => {
  const now = Date.UTC(2026, 10, 8, 13, 0, 0);
  const daysAgo = (n: number) => now - n * 86_400_000;

  it("looks back ten days when there has been no scan yet", () => {
    expect(lookbackDays(undefined, now)).toBe(10);
  });

  it("covers a week since the last scan with a day to spare, never less than a week", () => {
    expect(lookbackDays(daysAgo(7), now)).toBe(8);
    expect(lookbackDays(daysAgo(2), now)).toBe(7);
  });

  it("stretches over a missed week, but stops at a month", () => {
    expect(lookbackDays(daysAgo(14), now)).toBe(15);
    expect(lookbackDays(daysAgo(120), now)).toBe(30);
  });

  it("treats a last scan in the future as no scan", () => {
    expect(lookbackDays(now + 1000, now)).toBe(10);
  });
});

describe("weeklyInstruction", () => {
  it("names the inbox and the window", () => {
    const text = weeklyInstruction("gage@gmail.com", 8);
    expect(text).toContain("gage@gmail.com");
    expect(text).toContain("newer_than:8d");
  });
});

describe("addedSummary", () => {
  const ev = (title: string, date: string) => ({ title, date });

  it("lists what was added, then how many more", () => {
    expect(addedSummary([ev("Catthew's Vet Appointment", "2026-11-20")])).toBe("Catthew's Vet Appointment (Nov 20)");
    expect(addedSummary([ev("A", "2026-11-20"), ev("B", "2026-12-01"), ev("C", "2026-12-02"), ev("D", "2026-12-03")]))
      .toBe("A (Nov 20), B (Dec 1) and 2 more");
  });

  it("is empty for nothing", () => {
    expect(addedSummary([])).toBe("");
  });
});
