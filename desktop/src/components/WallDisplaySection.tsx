// Wall display token management — surfaced inside FamilyConsole.
//
// Lets a household member create a long-lived read-only URL that the
// Raspberry Pi (or any browser) can open in kiosk mode to show today's
// schedule, paydays, and chat preview.
//
// Self-contained so FamilyConsole only needs one import + one tag.

import { useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import {
  createWallToken, deleteWallToken, listWallTokens, revokeWallToken,
  wallUrlFor, type WallToken,
} from "../lib/wallTokens";

interface Props {
  householdId: string | null;
  t: ThemeTokens;
  palette: Palette;
}

export function WallDisplaySection({ householdId, t, palette }: Props) {
  const [tokens, setTokens] = useState<WallToken[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftLabel, setDraftLabel] = useState("Kitchen monitor");
  const [err, setErr] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const refresh = async () => {
    if (!householdId) { setTokens([]); return; }
    try {
      const list = await listWallTokens(householdId);
      setTokens(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load wall tokens.");
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [householdId]);

  const onCreate = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    setBusy(true);
    try {
      await createWallToken(householdId, draftLabel || "Wall display");
      setDraftLabel("Kitchen monitor");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create token.");
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async (tok: string) => {
    try {
      await navigator.clipboard.writeText(wallUrlFor(tok));
      setCopiedToken(tok);
      setTimeout(() => setCopiedToken(null), 1400);
    } catch { /* swallow */ }
  };

  const onRevoke = async (tok: string) => {
    setBusy(true);
    try { await revokeWallToken(tok); await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't revoke."); }
    finally { setBusy(false); }
  };

  const onDelete = async (tok: string) => {
    if (!confirm("Permanently delete this wall token? The display will stop updating.")) return;
    setBusy(true);
    try { await deleteWallToken(tok); await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't delete."); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Create row */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          placeholder="Label (e.g. Kitchen monitor)"
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 8,
            border: `0.5px solid ${t.sep}`,
            background: t.bg,
            color: t.text,
            fontSize: 13,
            fontFamily: "inherit",
            letterSpacing: "-0.01em",
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={onCreate}
          disabled={busy || !householdId}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: 0,
            background: palette.G,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.5 : 1,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
          }}
        >
          {busy ? "Working…" : "Create token"}
        </button>
      </div>

      {err && <div style={{ fontSize: 12, color: t.clayText }}>{err}</div>}

      {/* Token list */}
      {tokens === null && (
        <div style={{ fontSize: 12, color: t.text3, padding: "4px 2px" }}>Loading…</div>
      )}
      {tokens !== null && tokens.length === 0 && (
        <div style={{ fontSize: 12, color: t.text3, padding: "4px 2px" }}>
          No wall tokens yet. Create one and paste the URL into your Pi&apos;s kiosk config.
        </div>
      )}
      {tokens?.map((tok) => {
        const url = wallUrlFor(tok.token);
        const created = new Date(tok.createdAt);
        return (
          <div
            key={tok.token}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: t.bgElev,
              border: `0.5px solid ${t.sep}`,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              opacity: tok.revoked ? 0.5 : 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>
                {tok.label}
              </div>
              {tok.revoked && (
                <span
                  style={{
                    fontSize: 9.5, fontWeight: 700,
                    padding: "1px 6px", borderRadius: 999,
                    background: "rgba(138,75,56,0.18)",
                    color: t.clayText,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Revoked
                </span>
              )}
              <div style={{ marginLeft: "auto", fontSize: 10.5, color: t.text3 }}>
                {created.toLocaleDateString()} {created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>

            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace)",
                color: t.text2,
                background: t.bg,
                padding: "6px 8px",
                borderRadius: 6,
                border: `0.5px solid ${t.sep}`,
                wordBreak: "break-all",
                userSelect: "all",
              }}
            >
              {url}
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => onCopy(tok.token)}
                disabled={busy}
                style={btnStyle(t, copiedToken === tok.token ? "#0F6E64" : null)}
              >
                {copiedToken === tok.token ? "Copied" : "Copy URL"}
              </button>
              {!tok.revoked && (
                <button
                  type="button"
                  onClick={() => onRevoke(tok.token)}
                  disabled={busy}
                  style={btnStyle(t, null)}
                >
                  Revoke
                </button>
              )}
              <button
                type="button"
                onClick={() => onDelete(tok.token)}
                disabled={busy}
                style={{ ...btnStyle(t, null), color: t.clayText, borderColor: "rgba(138,75,56,0.45)", marginLeft: "auto" }}
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}

      <div style={{ fontSize: 11, color: t.text3, lineHeight: 1.5, marginTop: 4 }}>
        On your Raspberry Pi, open Chromium in kiosk mode pointed at the URL above.
        The dashboard auto-refreshes every 30 seconds. Revoke any time to instantly cut off access.
      </div>
    </div>
  );
}

function btnStyle(t: ThemeTokens, accent: string | null): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 7,
    border: `0.5px solid ${accent ?? t.sep}`,
    background: accent ? accent : "transparent",
    color: accent ? "#fff" : t.text,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    letterSpacing: "-0.01em",
  };
}
