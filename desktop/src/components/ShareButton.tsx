// Bottom-of-sidebar "Share" control. Click the square to pop a little grid of
// icons — a link and an .ics calendar feed — and clicking either copies that
// URL to the clipboard. If read-only sharing isn't on yet, the first copy
// auto-enables it (generates a token + publishes the sanitized snapshot).
//
// Adapted from the requested shadcn IconGridButton pattern — the desktop app
// uses inline styles rather than Tailwind/shadcn, so the same behavior is
// implemented directly here.

import { useEffect, useRef, useState } from "react";
import type { HouseholdState } from "../state";
import type { Palette, ThemeTokens } from "../theme";
import { enablePublicShare, shareLinks } from "../lib/publicShare";

interface Props {
  householdId: string | null;
  state: HouseholdState | null;
  t: ThemeTokens;
  dark: boolean;
  palette: Palette;
  /** Render as a full-width sidebar row (icon + "Share" label) instead of a
   *  compact square. */
  fullWidth?: boolean;
}

type CopyKind = "web" | "ics";

export function ShareButton({ householdId, state, t, dark, palette, fullWidth = false }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<CopyKind | null>(null);
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => { setCopied(null); setOpen(false); }, 1100);
    return () => clearTimeout(id);
  }, [copied]);

  async function copy(kind: CopyKind) {
    if (!householdId || busy) return;
    setError(null);
    setBusy(kind);
    try {
      // Reuse the live token if sharing is already on; otherwise turn it on.
      const token = state?.shareEnabled && state?.shareToken
        ? state.shareToken
        : await enablePublicShare(householdId);
      const links = shareLinks(token);
      await navigator.clipboard.writeText(kind === "web" ? links.web : links.ics);
      setCopied(kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't copy the link.");
    } finally {
      setBusy(null);
    }
  }

  const disabled = !householdId;
  const iconTile: React.CSSProperties = {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 5, width: 72, height: 62, borderRadius: 10, border: `0.5px solid ${t.sep}`,
    background: t.bg, color: t.text, cursor: "pointer", fontFamily: "inherit",
    fontSize: 10.5, fontWeight: 600,
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", flexShrink: 0, width: fullWidth ? "100%" : undefined }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title={disabled ? "Sign in to share" : "Share a read-only link"}
        aria-label="Share read-only link"
        style={fullWidth ? {
          width: "100%",
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 8px",
          borderRadius: 8, background: open ? t.bg : t.bgElev,
          border: `0.5px solid ${t.sep}`, cursor: disabled ? "default" : "pointer",
          color: t.text, opacity: disabled ? 0.4 : 1,
          fontFamily: "inherit", textAlign: "left",
        } : {
          width: 34, height: "100%", minHeight: 34,
          display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: 8, background: open ? t.bg : t.bgElev,
          border: `0.5px solid ${t.sep}`, cursor: disabled ? "default" : "pointer",
          color: open ? palette.G : t.text2, opacity: disabled ? 0.4 : 1,
          fontFamily: "inherit",
        }}
      >
        {fullWidth ? (
          <>
            <span style={{ width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", color: open ? palette.G : t.text2, flexShrink: 0 }}>
              <ShareIcon size={16} />
            </span>
            <span style={{ flex: 1, fontSize: 11.5, fontWeight: 600, color: t.text }}>Share</span>
            <span style={{ fontSize: 10, color: t.text3 }}>{state?.shareEnabled ? "link on" : "read-only"}</span>
            <span style={{ color: t.text3, fontSize: 14 }}>›</span>
          </>
        ) : (
          <ShareIcon size={16} />
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            right: 0,
            background: t.bgElev,
            border: `0.5px solid ${t.sep}`,
            borderRadius: 14,
            padding: 10,
            boxShadow: dark ? "0 12px 34px rgba(0,0,0,0.5)" : "0 12px 34px rgba(16,24,40,0.18)",
            zIndex: 50,
          }}
        >
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: t.text3, padding: "0 2px 8px" }}>
            {state?.shareEnabled ? "Copy share link" : "Share read-only"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={iconTile} onClick={() => copy("web")} disabled={!!busy}>
              {copied === "web" ? <CheckIcon size={19} color={palette.G} /> : <LinkIcon size={19} />}
              <span>{copied === "web" ? "Copied" : busy === "web" ? "…" : "Link"}</span>
            </button>
            <button type="button" style={iconTile} onClick={() => copy("ics")} disabled={!!busy}>
              {copied === "ics" ? <CheckIcon size={19} color={palette.G} /> : <CalendarIcon size={19} />}
              <span>{copied === "ics" ? "Copied" : busy === "ics" ? "…" : "Calendar"}</span>
            </button>
          </div>
          {error && <div style={{ fontSize: 10, color: "#FF453A", marginTop: 8, maxWidth: 152, lineHeight: 1.35 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

// ─────────────────── icons ───────────────────
function ShareIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
    </svg>
  );
}
function LinkIcon({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function CalendarIcon({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function CheckIcon({ size = 19, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
