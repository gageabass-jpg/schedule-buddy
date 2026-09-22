// Improvements modal — the light-bulb button in the sidebar opens this.
// Asks "What can we do better?" and logs ideas to userData/improvements.json
// (via the IPC bridge) so they can be picked up later.

import { useEffect, useState } from "react";
import type { ThemeTokens } from "../theme";
import { MANAGER_ORANGE } from "../theme";

interface Props {
  open: boolean;
  onClose: () => void;
  t: ThemeTokens;
  dark: boolean;
}

interface Improvement {
  id: string;
  text: string;
  createdAt: number;
  status: string;
}

export function ImprovementsModal({ open, onClose, t, dark }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [past, setPast] = useState<Improvement[]>([]);

  useEffect(() => {
    if (!open) return;
    setText("");
    setErr(null);
    setSaved(false);
    void window.sbm?.listImprovements().then((list) => setPast(list ?? [])).catch(() => setPast([]));
  }, [open]);

  if (!open) return null;

  const onSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) { setErr("Type an idea first."); return; }
    if (!window.sbm) { setErr("Only available in the desktop app."); return; }
    setErr(null);
    setBusy(true);
    try {
      const res = await window.sbm.addImprovement(trimmed);
      if (!res.ok) { setErr(res.error ?? "Couldn't save."); return; }
      setText("");
      setSaved(true);
      const list = await window.sbm.listImprovements();
      setPast(list ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxHeight: "80vh",
          background: dark ? "#1C1C1E" : "#FFFFFF",
          color: t.text,
          border: `0.5px solid ${t.sep}`,
          borderRadius: 14,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          overflow: "auto",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LightBulb size={22} color={MANAGER_ORANGE} />
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Improvements
          </div>
          <button type="button" onClick={onClose} style={closeBtnStyle(t)} aria-label="Close">✕</button>
        </div>

        <div style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>
          What can we do better?
        </div>

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setSaved(false); }}
          rows={4}
          autoFocus
          placeholder="Anything — a bug, a missing feature, something that feels clunky…"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void onSubmit(); }
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
            color: t.text,
            border: `0.5px solid ${t.sep}`,
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 13,
            fontFamily: "inherit",
            resize: "vertical",
            minHeight: 90,
            lineHeight: 1.45,
          }}
        />

        {err && <div style={{ fontSize: 12, color: "#8A4B38" }}>{err}</div>}
        {saved && !err && (
          <div style={{ fontSize: 12, color: "#0F6E64", fontWeight: 600 }}>
            Logged. Thanks — add more or close.
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            style={{
              padding: "9px 16px",
              borderRadius: 8,
              border: 0,
              background: MANAGER_ORANGE,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
              letterSpacing: "-0.01em",
            }}
          >
            {busy ? "Saving…" : "Submit idea"}
          </button>
          <span style={{ fontSize: 11, color: t.text3 }}>⌘↵ to submit</span>
        </div>

        {/* Past ideas */}
        {past.length > 0 && (
          <>
            <div style={{ height: 1, background: t.sep, opacity: 0.5 }} />
            <div style={{
              fontSize: 10.5, fontWeight: 700, color: t.text3,
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              Logged ideas ({past.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[...past].sort((a, b) => b.createdAt - a.createdAt).map((imp) => (
                <div
                  key={imp.id}
                  style={{
                    padding: "9px 12px",
                    borderRadius: 10,
                    background: t.bgElev,
                    border: `0.5px solid ${t.sep}`,
                    borderLeft: `3px solid ${MANAGER_ORANGE}`,
                  }}
                >
                  <div style={{ fontSize: 13, color: t.text, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
                    {imp.text}
                  </div>
                  <div style={{ fontSize: 10.5, color: t.text3, marginTop: 3 }}>
                    {formatWhen(imp.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────── icon ───────────────────
export function LightBulb({ size = 18, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 18h6M10 21h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2v.3h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// ─────────────────── helpers ───────────────────
function formatWhen(ms: number): string {
  const d = new Date(ms);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const hr = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = hr >= 12 ? "PM" : "AM";
  const h12 = hr % 12 === 0 ? 12 : hr % 12;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${h12}:${min} ${ampm}`;
}

function closeBtnStyle(t: ThemeTokens): React.CSSProperties {
  return {
    marginLeft: "auto",
    width: 26, height: 26,
    borderRadius: 7,
    border: `0.5px solid ${t.sep}`,
    background: "transparent",
    color: t.text3,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    lineHeight: 1,
  };
}
