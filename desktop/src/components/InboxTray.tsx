import { useEffect, useMemo, useRef, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { CaregiverRequest } from "../state";
import { caregiverRequestTypeLabel } from "../lib/writeCaregiverRequest";

interface Props {
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  requests: CaregiverRequest[];
  onOpenFullInbox: (focusId?: string) => void;
}

const LAST_VIEWED_KEY = "sbm:inboxLastViewedAt";

function readLastViewed(): number {
  const v = Number(localStorage.getItem(LAST_VIEWED_KEY));
  return Number.isFinite(v) ? v : 0;
}

function writeLastViewed(ms: number): void {
  localStorage.setItem(LAST_VIEWED_KEY, String(ms));
}

/** "just now" / "12m ago" / "3h ago" / "May 12" — switches to a fixed date
 *  once the entry crosses the 24-hour line. */
function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 24 * 60 * 60 * 1000) {
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(diff / 3_600_000);
    return `${hrs}h ago`;
  }
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A short subject line for a row. */
function subjectFor(r: CaregiverRequest): string {
  const type = caregiverRequestTypeLabel(r.type);
  const [y, m, d] = (r.date || "").split("-").map(Number);
  const dateStr = (y && m && d)
    ? new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";
  return dateStr ? `${type} · ${dateStr}` : type;
}

export function InboxTray({ palette, t, dark, requests, onOpenFullInbox }: Props) {
  const [open, setOpen] = useState(false);
  const [lastViewed, setLastViewed] = useState<number>(readLastViewed());
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Re-sync every minute so "12m ago" stays current.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // Newest first; drop dismissed unless the popover has nothing else.
  const visible = useMemo(() => {
    const live = requests.filter((r) => r.status !== "dismissed");
    const list = live.length > 0 ? live : requests;
    return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [requests]);

  const newCount = requests.filter((r) => r.status === "new").length;
  const hasUnviewed = requests.some((r) => (r.createdAt || 0) > lastViewed);

  const onToggle = () => {
    if (!open) {
      // Mark everything currently in the box as "seen" the moment the user opens it.
      const now = Date.now();
      writeLastViewed(now);
      setLastViewed(now);
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={onToggle}
        title={newCount > 0 ? `${newCount} new caregiver request${newCount === 1 ? "" : "s"}` : "Inbox"}
        aria-label="Inbox"
        aria-expanded={open}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 26,
          padding: 0,
          borderRadius: 6,
          border: `0.5px solid ${t.sep}`,
          background: open ? (dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)") : "transparent",
          color: t.text,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 13l2.6-8a2 2 0 011.9-1.4h9a2 2 0 011.9 1.4L21 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M3 13h5l1.2 2.5a1 1 0 00.9.5h3.8a1 1 0 00.9-.5L16 13h5v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
        </svg>
        {/* Numeric badge for unread count */}
        {newCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -5,
              right: -5,
              minWidth: 14,
              height: 14,
              padding: "0 3px",
              background: "#8A4B38",
              color: "#fff",
              fontSize: 9,
              fontWeight: 700,
              borderRadius: 7,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              pointerEvents: "none",
            }}
          >
            {newCount > 99 ? "99+" : newCount}
          </span>
        )}
        {/* Small upper-left dot — present whenever something is unviewed */}
        {hasUnviewed && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: -2,
              left: -2,
              width: 8,
              height: 8,
              borderRadius: 4,
              background: "#14201E",
              boxShadow: `0 0 0 1.5px ${t.bg}`,
              pointerEvents: "none",
            }}
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 8,
            minWidth: 320,
            maxWidth: 380,
            maxHeight: "60vh",
            background: t.bgElev,
            color: t.text,
            border: `0.5px solid ${t.sep}`,
            borderRadius: 12,
            boxShadow: "0 14px 36px rgba(0,0,0,0.36)",
            padding: 6,
            zIndex: 200,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 10px 4px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "-0.01em" }}>Inbox</div>
            <button
              type="button"
              onClick={() => { setOpen(false); onOpenFullInbox(); }}
              style={{
                background: "transparent",
                border: 0,
                color: palette.G,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                letterSpacing: "-0.01em",
                padding: 2,
              }}
            >View all →</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {visible.length === 0 ? (
              <div style={{ padding: "18px 12px", textAlign: "center", color: t.text3, fontSize: 12 }}>
                Nothing in your inbox.
              </div>
            ) : visible.map((r) => {
              const isNew = r.status === "new";
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { setOpen(false); onOpenFullInbox(r.id); }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 8,
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: 0,
                    background: "transparent",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                    color: t.text,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(127,127,127,0.10)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8, height: 8, borderRadius: 4,
                      background:
                        r.status === "acknowledged" ? "#0F6E64" :
                        r.status === "dismissed"    ? "#8E8E93" :
                                                      "#14201E",
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: isNew ? 700 : 600, color: t.text, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.createdByName || "Caregiver"}
                    </div>
                    <div style={{ fontSize: 11, color: t.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {subjectFor(r)}
                    </div>
                  </div>
                  <div style={{ fontSize: 10.5, color: t.text3, whiteSpace: "nowrap" }}>
                    {r.createdAt ? timeAgo(r.createdAt) : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
