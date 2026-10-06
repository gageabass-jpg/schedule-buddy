// Read-only public share link — surfaced inside FamilyConsole.
//
// Publishes a sanitized snapshot (shifts + life-event titles only) to
// publicShares/{token}; guests view it at share.html?t=… or subscribe to the
// webcal ICS feed. Self-contained — FamilyConsole needs one import + one tag.

import { useEffect, useRef, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState } from "../state";
import {
  enablePublicShare, disablePublicShare, rotatePublicShare,
  publishPublicShare, shareLinks,
} from "../lib/publicShare";

interface Props {
  householdId: string | null;
  state: HouseholdState | null;
  t: ThemeTokens;
  palette: Palette;
}

export function ShareLinkSection({ householdId, state, t, palette }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const on = !!state?.shareEnabled && !!state?.shareToken;
  const token = state?.shareToken || "";

  // Keep the published snapshot fresh while sharing is on and the console is
  // open (any schedule edit re-publishes, debounced). The web/iOS app also
  // republishes on its own saves.
  const pubTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!on || !householdId || !state) return;
    if (pubTimer.current) clearTimeout(pubTimer.current);
    pubTimer.current = setTimeout(() => { void publishPublicShare(householdId, state); }, 1500);
    return () => { if (pubTimer.current) clearTimeout(pubTimer.current); };
  }, [on, householdId, state]);

  const run = async (fn: () => Promise<unknown>, label: string) => {
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null); setBusy(true);
    try { await fn(); }
    catch (e) { setErr(e instanceof Error ? e.message : `Couldn't ${label}.`); }
    finally { setBusy(false); }
  };

  const onCopy = async (key: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(key); setTimeout(() => setCopied(null), 1400); }
    catch { /* swallow */ }
  };

  if (!on) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          type="button"
          onClick={() => run(() => enablePublicShare(householdId!), "enable sharing")}
          disabled={busy || !householdId}
          style={{
            alignSelf: "flex-start", padding: "8px 16px", borderRadius: 8, border: 0,
            background: palette.G, color: "#fff", fontSize: 13, fontWeight: 600,
            fontFamily: "inherit", cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1,
            letterSpacing: "-0.01em",
          }}
        >
          {busy ? "Working…" : "Create read-only link"}
        </button>
        {err && <div style={{ fontSize: 12, color: t.clayText }}>{err}</div>}
        <div style={{ fontSize: 11, color: t.text3, lineHeight: 1.5 }}>
          Anyone with the link sees a read-only calendar — shifts and event titles only.
          No chat, coverage, health, or account info. Revoke any time.
        </div>
      </div>
    );
  }

  const L = shareLinks(token);
  const linkBox = (key: string, label: string, value: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: t.text3 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        <div style={{
          flex: 1, fontSize: 11,
          fontFamily: "var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace)",
          color: t.text2, background: t.bg, padding: "6px 8px", borderRadius: 6,
          border: `0.5px solid ${t.sep}`, wordBreak: "break-all", userSelect: "all",
        }}>{value}</div>
        <button type="button" onClick={() => onCopy(key, value)} disabled={busy}
          style={btnStyle(t, copied === key ? "#0F6E64" : null)}>
          {copied === key ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: "#0F6E64" }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Sharing is on</span>
      </div>

      {linkBox("web", "Web link", L.web)}
      {linkBox("ics", "Calendar subscription (ICS)", L.ics)}

      {err && <div style={{ fontSize: 12, color: t.clayText }}>{err}</div>}

      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" disabled={busy}
          onClick={() => { if (confirm("Rotate the link? The old link and ICS feed stop working.")) run(() => rotatePublicShare(householdId!), "rotate link"); }}
          style={btnStyle(t, null)}>Rotate link</button>
        <button type="button" disabled={busy}
          onClick={() => { if (confirm("Turn off sharing and revoke the link?")) run(() => disablePublicShare(householdId!), "turn off sharing"); }}
          style={{ ...btnStyle(t, null), color: t.clayText, borderColor: "rgba(138,75,56,0.45)", marginLeft: "auto" }}>
          Turn off &amp; revoke
        </button>
      </div>

      <div style={{ fontSize: 11, color: t.text3, lineHeight: 1.5 }}>
        The link reflects your latest saved schedule (shifts + event titles only).
        Subscribe to the ICS in Apple/Google Calendar.
      </div>
    </div>
  );
}

function btnStyle(t: ThemeTokens, accent: string | null): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 7,
    border: `0.5px solid ${accent ?? t.sep}`,
    background: accent ? accent : "transparent",
    color: accent ? "#fff" : t.text,
    fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
    letterSpacing: "-0.01em", whiteSpace: "nowrap",
  };
}
