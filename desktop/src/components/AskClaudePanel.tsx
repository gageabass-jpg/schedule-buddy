import { useEffect, useRef, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import { askClaude, type AskMessage } from "../lib/askClaude";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
}

interface UIMessage {
  role: "user" | "assistant";
  text: string;
}

const SUGGESTIONS = [
  "What does my next 2 weeks look like?",
  "I picked up an OT shift this Friday night",
  "Move my Monday shift next week to Wednesday",
  "Kaylene is off the rest of this week",
];

export function AskClaudePanel({ open, onClose, palette, t, dark }: Props) {
  const [uiMessages, setUiMessages] = useState<UIMessage[]>([]);
  // Full conversation that gets passed back to the function — includes the
  // raw tool_use/tool_result blocks the UI doesn't render.
  const [history, setHistory] = useState<AskMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset when reopened.
  useEffect(() => {
    if (!open) return;
    setUiMessages([]);
    setHistory([]);
    setDraft("");
    setErr(null);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [uiMessages.length, busy]);

  if (!open) return null;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setErr(null);
    setUiMessages((prev) => [...prev, { role: "user", text: message }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await askClaude(message, history);
      setHistory(res.messages);
      setUiMessages((prev) => [...prev, { role: "assistant", text: res.reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setUiMessages((prev) => [...prev, { role: "assistant", text: `(Error) ${msg}` }]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1100 }} />
      <div
        role="dialog"
        aria-label="Ask Claude"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(460px, calc(100vw - 32px))",
          background: t.bgElev,
          color: t.text,
          boxShadow: "-10px 0 30px rgba(0,0,0,0.35)",
          zIndex: 1101,
          display: "flex",
          flexDirection: "column",
          fontFamily: "inherit",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: `0.5px solid ${t.sep}`,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>
              ✨ Ask Claude
            </div>
            <div style={{ fontSize: 11.5, color: t.text3, marginTop: 2 }}>
              Schedule changes in plain English. Confirms before writing.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: 0, color: t.text2, fontSize: 18, cursor: "pointer", padding: 4, fontFamily: "inherit" }}
            aria-label="Close"
          >✕</button>
        </header>

        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "14px 14px 6px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            background: dark ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.02)",
          }}
        >
          {uiMessages.length === 0 ? (
            <div style={{ margin: "auto", textAlign: "center", padding: "8px 4px" }}>
              <div style={{ fontSize: 13, color: t.text3, marginBottom: 14, lineHeight: 1.5 }}>
                Try one of these or type your own:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 320, margin: "0 auto" }}>
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => send(s)}
                    disabled={busy}
                    style={{
                      textAlign: "left",
                      padding: "9px 12px",
                      border: `0.5px solid ${t.sep}`,
                      borderRadius: 10,
                      background: t.bgElev,
                      color: t.text,
                      fontSize: 12.5,
                      cursor: busy ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      lineHeight: 1.4,
                    }}
                  >{s}</button>
                ))}
              </div>
            </div>
          ) : (
            uiMessages.map((m, i) => {
              const mine = m.role === "user";
              return (
                <div
                  key={i}
                  style={{
                    alignSelf: mine ? "flex-end" : "flex-start",
                    maxWidth: "82%",
                    padding: "8px 12px",
                    borderRadius: 14,
                    borderTopRightRadius: mine ? 4 : 14,
                    borderTopLeftRadius: mine ? 14 : 4,
                    background: mine ? palette.G : (dark ? "rgba(255,255,255,0.08)" : "#fff"),
                    color: mine ? "#fff" : t.text,
                    fontSize: 13.5,
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    border: mine ? "0" : `0.5px solid ${t.sep}`,
                  }}
                >
                  {m.text}
                </div>
              );
            })
          )}
          {busy && (
            <div style={{ alignSelf: "flex-start", fontSize: 12, color: t.text3, padding: "6px 10px" }}>
              <span style={{ display: "inline-flex", gap: 4 }}>
                <span style={dotStyle(0)} />
                <span style={dotStyle(0.15)} />
                <span style={dotStyle(0.3)} />
              </span>
            </div>
          )}
        </div>

        {err && (
          <div style={{ padding: "6px 14px", fontSize: 12, color: "#FF453A", borderTop: `0.5px solid ${t.sep}` }}>
            {err}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 12px",
            borderTop: `0.5px solid ${t.sep}`,
            alignItems: "flex-end",
            background: t.bgElev,
          }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder="Tell Claude what to change…"
            rows={1}
            disabled={busy}
            style={{
              flex: 1,
              minHeight: 34,
              maxHeight: 140,
              padding: "8px 12px",
              borderRadius: 18,
              border: `0.5px solid ${t.sep}`,
              background: t.bg,
              color: t.text,
              fontFamily: "inherit",
              fontSize: 13.5,
              outline: "none",
              resize: "none",
              lineHeight: 1.35,
            }}
          />
          <button
            type="button"
            onClick={() => send(draft)}
            disabled={busy || !draft.trim()}
            style={{
              padding: "0 16px",
              height: 34,
              borderRadius: 18,
              border: 0,
              background: palette.G,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: (busy || !draft.trim()) ? "not-allowed" : "pointer",
              opacity: (busy || !draft.trim()) ? 0.5 : 1,
              fontFamily: "inherit",
              letterSpacing: "-0.01em",
            }}
          >Send</button>
        </div>
      </div>
    </>
  );
}

function dotStyle(delay: number): React.CSSProperties {
  return {
    display: "inline-block",
    width: 6, height: 6, borderRadius: "50%",
    background: "currentColor",
    opacity: 0.4,
    animation: `askClaudeDot 1s ease-in-out ${delay}s infinite`,
  };
}

// Inject the keyframes once.
if (typeof document !== "undefined" && !document.getElementById("ask-claude-keyframes")) {
  const style = document.createElement("style");
  style.id = "ask-claude-keyframes";
  style.textContent = `@keyframes askClaudeDot { 0%,80%,100% { opacity:0.2 } 40% { opacity:1 } }`;
  document.head.appendChild(style);
}
