// Email inboxes — surfaced inside FamilyConsole.
//
// Link a Gmail or iCloud inbox and Nucleus looks through it every Sunday at 8 AM
// for appointments and events, adding what it finds to the calendar. Gmail goes
// through Google's own consent page (Kaylene links hers from a one-time link made
// here); iCloud takes the address and an app-specific password, typed in below.
// Self-contained: FamilyConsole needs one import and one tag.

import { useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import { useHouseholdLook } from "../lib/householdLook";
import { undoChange } from "../lib/askClaude";
import {
  connectIcloud, createInboxLink, disconnectInbox, markScanUndone, scanInboxesNow, subscribeEmailScan, subscribeInboxLinks,
  type EmailScanMeta, type InboxLink,
} from "../lib/emailInboxes";

interface Props {
  householdId: string | null;
  t: ThemeTokens;
  palette: Palette;
}

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function EmailInboxesSection({ householdId, t, palette }: Props) {
  const look = useHouseholdLook();
  const [links, setLinks] = useState<InboxLink[]>([]);
  const [meta, setMeta] = useState<EmailScanMeta>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // A link made for Kaylene, kept on screen so it can be copied again.
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The iCloud form while it's open. The password lives only here, until it's sent.
  const [icloud, setIcloud] = useState<{ email: string; password: string; owner: "G" | "K" } | null>(null);

  useEffect(() => {
    if (!householdId) return;
    const offLinks = subscribeInboxLinks(householdId, setLinks);
    const offMeta = subscribeEmailScan(householdId, setMeta);
    return () => { offLinks(); offMeta(); };
  }, [householdId]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setErr(null); setNote(null); setBusy(key);
    try { await fn(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(null); }
  };

  const owner = (code: "G" | "K") => (code === "G" ? look.names.G : look.names.K);

  /** Link an inbox. Yours opens in the browser; Kaylene's is a link to send her. */
  const connect = (code: "G" | "K") => run(`connect-${code}`, async () => {
    const url = await createInboxLink(code);
    if (code === "G") {
      window.open(url, "_blank");
      setNote("Google's window opened in your browser. Pick the Gmail account and allow Nucleus to read it; this list updates when you're done.");
      return;
    }
    setInvite(url);
    setCopied(false);
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* the box below still shows it */ }
  });

  const openIcloud = (owner: "G" | "K", email = "") => { setErr(null); setNote(null); setInvite(null); setIcloud({ email, password: "", owner }); };

  const saveIcloud = () => run("icloud", async () => {
    if (!icloud) return;
    const address = await connectIcloud(icloud.email, icloud.password, icloud.owner);
    setIcloud(null);
    setNote(`${address} is connected. Nucleus will look through it on Sunday, or press Scan now to try it.`);
  });

  const scanNow = () => run("scan", async () => {
    const r = await scanInboxesNow();
    if (r.inboxes === 0 && r.failed.length === 0) { setNote("No inboxes are linked yet."); return; }
    const bits = [
      `Scanned ${plural(r.inboxes, "inbox", "inboxes")}`,
      r.added.length ? `added ${plural(r.added.length, "event")}` : "found nothing new",
      ...(r.skipped ? [`${r.skipped} already on the calendar`] : []),
      ...(r.failed.length ? [`${plural(r.failed.length, "inbox", "inboxes")} couldn't be scanned`] : []),
    ];
    setNote(`${bits.join("; ")}.`);
  });

  const disconnect = (link: InboxLink) => {
    const what = link.provider === "icloud"
      ? "Nucleus stops scanning it and forgets the password. To be sure the password can't be used again, also delete it under App-Specific Passwords at account.apple.com."
      : "Nucleus stops scanning it, and its access is revoked at Google.";
    if (!window.confirm(`Disconnect ${link.email}?\n\n${what} Events already added stay on the calendar.`)) return;
    void run(`off-${link.id}`, async () => { await disconnectInbox(link.id); });
  };

  const undo = () => run("undo", async () => {
    if (!meta.lastChange || !householdId) return;
    await undoChange(meta.lastChange.changeId);
    await markScanUndone(householdId);
    setNote("Undone. Those events are off the calendar.");
  });

  const btn = (accent?: boolean, danger?: boolean): React.CSSProperties => ({
    padding: "6px 12px", borderRadius: 7, fontFamily: "inherit", fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em",
    whiteSpace: "nowrap", cursor: busy ? "default" : "pointer", opacity: busy ? 0.55 : 1,
    border: `0.5px solid ${accent ? palette.G : danger ? "rgba(138,75,56,0.45)" : t.sep}`,
    background: accent ? palette.G : "transparent",
    color: accent ? "#fff" : danger ? t.clayText : t.text,
  });
  const small = { fontSize: 11, color: t.text3, lineHeight: 1.5 } as const;
  const field: React.CSSProperties = {
    padding: "6px 8px", borderRadius: 6, border: `0.5px solid ${t.sep}`, background: t.bg, color: t.text,
    fontFamily: "inherit", fontSize: 12, minWidth: 0,
  };
  const change =meta.lastChange && !meta.lastChange.undone ? meta.lastChange : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {links.length === 0 ? (
        <div style={{ fontSize: 13, color: t.text2, lineHeight: 1.5 }}>
          No inboxes linked yet. Link a Gmail or iCloud account and Nucleus looks through it every Sunday at 8 AM for
          appointments and events, and adds what it finds to the calendar.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {links.map((l) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: `0.5px solid ${t.sep}`, background: t.bg }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: l.status === "active" ? "#0F6E64" : "#8A4B38" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.email}</div>
                <div style={{ ...small, color: l.status === "active" ? t.text3 : t.clayText }}>
                  {owner(l.ownerCode)}'s {l.provider === "icloud" ? "iCloud" : "Gmail"} inbox
                  {l.status === "needs-reconnect"
                    ? ` · ${l.lastError ?? "Connect it again to keep scanning."}`
                    : l.lastScanAt ? ` · last scanned ${when(l.lastScanAt)}` : " · not scanned yet"}
                </div>
              </div>
              {l.status === "needs-reconnect" && (
                <button type="button" disabled={!!busy} style={btn(true)}
                  onClick={() => (l.provider === "icloud" ? openIcloud(l.ownerCode, l.email) : void connect(l.ownerCode))}>
                  Connect again
                </button>
              )}
              <button type="button" disabled={!!busy} onClick={() => disconnect(l)} style={btn(false, true)}>Disconnect</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button type="button" disabled={!!busy} onClick={() => connect("G")} style={btn(links.length === 0)}>
          {busy === "connect-G" ? "Working…" : "Connect my Gmail"}
        </button>
        {look.hasPartner && (
          <button type="button" disabled={!!busy} onClick={() => connect("K")} style={btn()}>
            {busy === "connect-K" ? "Working…" : `Invite ${look.names.K}`}
          </button>
        )}
        <button type="button" disabled={!!busy} onClick={() => openIcloud("G")} style={btn()}>Connect iCloud</button>
        {links.length > 0 && (
          <button type="button" disabled={!!busy} onClick={scanNow} style={{ ...btn(), marginLeft: "auto" }}>
            {busy === "scan" ? "Scanning… this can take a few minutes" : "Scan now"}
          </button>
        )}
      </div>

      {icloud && (
        <form
          onSubmit={(e) => { e.preventDefault(); void saveIcloud(); }}
          style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 8, border: `0.5px solid ${t.sep}`, background: t.bg }}
        >
          <div style={{ fontSize: 12, color: t.text2, lineHeight: 1.5 }}>
            Apple doesn't let apps sign in to iCloud Mail with the Apple ID password, so make a separate one for Nucleus:
            sign in at{" "}
            <a href="https://account.apple.com" target="_blank" rel="noreferrer" style={{ color: palette.G }}>account.apple.com</a>,
            open Sign-In and Security, then App-Specific Passwords, add one called Nucleus, and paste the 16 letters it
            shows below. It is encrypted before it's saved, and it only lets Nucleus into mail.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <input
              type="email" required autoFocus placeholder="you@icloud.com" aria-label="iCloud address"
              value={icloud.email} onChange={(e) => setIcloud({ ...icloud, email: e.target.value })}
              autoComplete="off" spellCheck={false} style={{ ...field, flex: "1 1 190px" }}
            />
            <input
              type="password" required placeholder="abcd-efgh-ijkl-mnop" aria-label="App-specific password"
              value={icloud.password} onChange={(e) => setIcloud({ ...icloud, password: e.target.value })}
              autoComplete="off" spellCheck={false} style={{ ...field, flex: "1 1 170px" }}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            {look.hasPartner && (["G", "K"] as const).map((code) => (
              <button
                key={code} type="button" disabled={!!busy} onClick={() => setIcloud({ ...icloud, owner: code })}
                aria-pressed={icloud.owner === code}
                style={{ ...btn(icloud.owner === code), opacity: busy ? 0.55 : 1 }}
              >
                {owner(code)}'s inbox
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button type="button" disabled={!!busy} onClick={() => setIcloud(null)} style={btn()}>Cancel</button>
            <button type="submit" disabled={!!busy} style={btn(true)}>{busy === "icloud" ? "Checking with Apple…" : "Connect"}</button>
          </div>
        </form>
      )}

      {invite && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12, color: t.text2, lineHeight: 1.5 }}>
            {copied ? "Link copied. " : ""}Send this to {look.names.K}. She opens it, picks her Google account and allows Nucleus
            to read her email. It works once and expires in 24 hours.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{
              flex: 1, fontSize: 11, fontFamily: "var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace)", color: t.text2,
              background: t.bg, padding: "6px 8px", borderRadius: 6, border: `0.5px solid ${t.sep}`, wordBreak: "break-all", userSelect: "all",
            }}>{invite}</div>
            <button type="button" style={btn()} onClick={async () => {
              try { await navigator.clipboard.writeText(invite); setCopied(true); } catch { /* selectable above */ }
            }}>Copy</button>
          </div>
        </div>
      )}

      {(note || err) && (
        <div style={{ fontSize: 12, color: err ? t.clayText : t.text2, lineHeight: 1.5 }}>{err ?? note}</div>
      )}

      {meta.lastRun && (
        <div style={{ ...small, color: t.text2 }}>
          Last scan {when(meta.lastRun.at)} ({meta.lastRun.trigger === "weekly" ? "Sunday scan" : "run by hand"}):{" "}
          {meta.lastRun.added ? `added ${plural(meta.lastRun.added, "event")}` : "nothing new"}
          {meta.lastRun.failed ? `, ${plural(meta.lastRun.failed, "inbox", "inboxes")} couldn't be scanned` : ""}.
        </div>
      )}
      {change && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: `0.5px solid ${t.sep}`, background: t.bg }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: t.text2, lineHeight: 1.45 }}>
            {change.events.slice(0, 3).map((e) => `${e.title} (${day(e.date)})`).join(", ")}
            {change.count > 3 ? ` and ${change.count - 3} more` : ""}
          </div>
          <button type="button" disabled={!!busy} onClick={undo} style={btn()}>{busy === "undo" ? "Undoing…" : "Undo"}</button>
        </div>
      )}

      <div style={small}>
        Nucleus only reads mail. The saved access sits in your Firebase project where no app can read it, only the scan
        (an iCloud password is encrypted there as well). Disconnecting a Gmail inbox revokes it at Google; for iCloud, also
        delete the app-specific password at account.apple.com. Outlook and other inboxes aren't supported yet.
      </div>
    </div>
  );
}
