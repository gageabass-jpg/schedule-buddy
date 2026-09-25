import { useEffect, useRef, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import { askClaude, type AskMessage, type AskMode } from "../lib/askClaude";
import { normalizeImage } from "../lib/normalizeImage";
import { BrandMark, BRAND_FONT, BRAND_TEAL } from "./BrandMark";

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

/** Read-only is the default: the panel answers until you let it write. */
const MODE_LABEL: Record<AskMode, string> = { read: "Read only", write: "Can change" };
const MODE_CAPTION: Record<AskMode, string> = {
  read: "Read only: nucleusAI answers. It changes nothing.",
  write: "Can change: nucleusAI confirms with you before it writes.",
};

/** Pretty name for the model id the function reports. */
function modelLabel(id: string | null): string {
  if (!id) return "";
  const m = /^claude-([a-z]+)-([0-9]+)(?:-([0-9]+))?/.exec(id);
  if (!m) return id;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return `Claude ${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

export function AskClaudePanel({ open, onClose, palette, t, dark }: Props) {
  const [uiMessages, setUiMessages] = useState<UIMessage[]>([]);
  // Full conversation that gets passed back to the function — includes the
  // raw tool_use/tool_result blocks the UI doesn't render.
  const [history, setHistory] = useState<AskMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<AskMode>("read");
  const [modeOpen, setModeOpen] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [listening, setListening] = useState(false);
  const [reading, setReading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  // Reset when reopened.
  useEffect(() => {
    if (!open) return;
    setUiMessages([]);
    setHistory([]);
    setDraft("");
    setErr(null);
    setMinimized(false);
    setModeOpen(false);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [uiMessages.length, busy]);

  // Stop dictation if the panel goes away mid-listen.
  useEffect(() => () => recognitionRef.current?.stop(), []);

  if (!open) return null;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setErr(null);
    setUiMessages((prev) => [...prev, { role: "user", text: message }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await askClaude(message, history, mode);
      setHistory(res.messages);
      if (res.model) setModel(res.model);
      setUiMessages((prev) => [...prev, { role: "assistant", text: res.reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setUiMessages((prev) => [...prev, { role: "assistant", text: `(Error) ${msg}` }]);
    } finally {
      setBusy(false);
    }
  };

  /**
   * A photo is read here on the Mac with the same vision call the import flow
   * uses, then handed to the assistant as text — askClaude itself takes no
   * images, and the rows are more useful to it than the picture anyway.
   */
  const onPickPhoto = async (file: File) => {
    if (!window.sbm) { setErr("Reading a photo only works inside the Nucleus Manager app."); return; }
    setErr(null);
    setReading(true);
    try {
      if (!(await window.sbm.hasApiKey())) {
        setErr("Reading a photo needs an Anthropic API key — add one in settings.");
        return;
      }
      const { bytes, mediaType } = await normalizeImage(file);
      const u8 = new Uint8Array(bytes);
      let binary = "";
      for (let i = 0; i < u8.byteLength; i++) binary += String.fromCharCode(u8[i]);
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const res = await window.sbm.parseSchedule({
        imageBase64: btoa(binary),
        imageMediaType: mediaType,
        scheduleHint: "A posted work schedule the user has photographed.",
        personLabel: "the user",
        shiftTypes: [],
        today: iso,
        contextMonth: iso.slice(0, 7),
      });
      if (!res.ok || !res.rows?.length) {
        setErr(res.error || "Couldn't read a schedule out of that photo.");
        return;
      }
      const lines = res.rows.map((r) => `${r.date} ${r.label || "shift"}`).join("\n");
      setDraft(
        `Here's a schedule photo I just read — ${res.rows.length} day${res.rows.length === 1 ? "" : "s"}:\n${lines}\n\n`,
      );
      setTimeout(() => inputRef.current?.focus(), 40);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read that photo.");
    } finally {
      setReading(false);
    }
  };

  /** Dictate into the composer using the browser's speech recognition. */
  const toggleMic = () => {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const Ctor = (window as unknown as {
      SpeechRecognition?: new () => never;
      webkitSpeechRecognition?: new () => never;
    }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
    if (!Ctor) { setErr("This build of Chromium has no speech recognition."); return; }
    const rec = new (Ctor as unknown as new () => {
      lang: string; interimResults: boolean; continuous: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onerror: (e: { error?: string }) => void;
      onend: () => void;
      start: () => void; stop: () => void;
    })();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      setDraft((prev) => (prev ? `${prev} ${said}` : said));
    };
    rec.onerror = (e) => { setErr(e.error === "not-allowed" ? "Microphone permission was denied." : "Dictation failed."); };
    rec.onend = () => { setListening(false); recognitionRef.current = null; };
    recognitionRef.current = rec;
    setListening(true);
    setErr(null);
    rec.start();
  };

  const iconBtn: React.CSSProperties = {
    width: 30, height: 30, padding: 0, border: 0, background: "transparent",
    cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
    color: t.text3, flexShrink: 0, borderRadius: 4,
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1100 }} />
      <div
        role="dialog"
        aria-label="nucleusAI"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          width: "min(420px, calc(100vw - 32px))",
          maxHeight: "min(640px, calc(100vh - 48px))",
          background: t.bgElev,
          color: t.text,
          border: `1px solid ${t.sep}`,
          borderRadius: 10,
          boxShadow: dark ? "0 24px 64px rgba(0,0,0,0.6)" : "0 24px 64px rgba(20,32,30,0.28)",
          zIndex: 1101,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "inherit",
        }}
      >
        {/* Titlebar */}
        <header
          style={{
            display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
            padding: "10px 12px",
            borderBottom: minimized ? "none" : `1px solid ${t.sep}`,
            background: dark ? "rgba(255,255,255,0.03)" : "#F7F6F3",
          }}
        >
          <button
            type="button"
            aria-label="Conversation menu"
            title="Conversation menu"
            onClick={() => setUiMessages([])}
            style={{ ...iconBtn, marginRight: 2 }}
          >
            <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 8h16M4 14h16" stroke={t.text2} strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          </button>
          <div style={{ width: 30, height: 30, borderRadius: 6, background: BRAND_TEAL, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <BrandMark size={18} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0, fontFamily: BRAND_FONT, fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em", color: t.text }}>
            nucleus<span style={{ opacity: 0.5 }}>AI</span>
          </div>
          <button type="button" aria-label={minimized ? "Expand" : "Minimise"} onClick={() => setMinimized((v) => !v)} style={iconBtn}>
            <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true">
              {minimized
                ? <path d="M6 14l6-6 6 6" stroke={t.text2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                : <path d="M6 12h12" stroke={t.text2} strokeWidth={1.8} strokeLinecap="round" />}
            </svg>
          </button>
          <button type="button" aria-label="Close" onClick={onClose} style={iconBtn}>
            <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke={t.text2} strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {!minimized && (
          <>
            {/* Conversation, or the starting suggestions. */}
            <div
              ref={scrollRef}
              style={{
                flex: "1 1 auto", minHeight: 0, overflowY: "auto",
                padding: "12px 12px 4px", display: "flex", flexDirection: "column", gap: 8,
              }}
            >
              {uiMessages.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => send(s)}
                      disabled={busy}
                      style={{
                        textAlign: "left", padding: "12px 14px",
                        border: `1px solid ${t.sep}`, borderRadius: 6,
                        background: t.bgElev, color: t.text, fontSize: 14,
                        cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", lineHeight: 1.35,
                      }}
                    >{s}</button>
                  ))}
                </div>
              ) : (
                uiMessages.map((m, i) => {
                  const mine = m.role === "user";
                  return (
                    <div
                      key={i}
                      style={{
                        alignSelf: mine ? "flex-end" : "flex-start",
                        maxWidth: "86%", padding: "9px 12px", borderRadius: 10,
                        background: mine ? palette.G : (dark ? "rgba(255,255,255,0.06)" : "#F7F6F3"),
                        color: mine ? "#fff" : t.text,
                        fontSize: 13.5, lineHeight: 1.45,
                        whiteSpace: "pre-wrap", wordBreak: "break-word",
                        border: mine ? "0" : `1px solid ${t.sep}`,
                      }}
                    >{m.text}</div>
                  );
                })
              )}
              {(busy || reading) && (
                <div style={{ alignSelf: "flex-start", fontSize: 12, color: t.text3, padding: "6px 10px" }}>
                  {reading ? "Reading the photo…" : (
                    <span style={{ display: "inline-flex", gap: 4 }}>
                      <span style={dotStyle(0)} /><span style={dotStyle(0.15)} /><span style={dotStyle(0.3)} />
                    </span>
                  )}
                </div>
              )}
            </div>

            {err && (
              <div style={{ flexShrink: 0, padding: "6px 14px", fontSize: 12, color: "#8A4B38", lineHeight: 1.4 }}>{err}</div>
            )}

            {/* Composer — one box holding the text and its controls. */}
            <div style={{ flexShrink: 0, padding: "8px 12px 10px" }}>
              <div style={{ border: `1px solid ${t.sep}`, borderRadius: 8, background: dark ? "rgba(255,255,255,0.03)" : "#F7F6F3", padding: "10px 10px 8px" }}>
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); }
                  }}
                  placeholder="Ask about the schedule, or drop a photo of it…"
                  rows={1}
                  disabled={busy}
                  style={{
                    width: "100%", boxSizing: "border-box", minHeight: 30, maxHeight: 130,
                    padding: "2px 2px 8px", border: 0, background: "transparent", color: t.text,
                    fontFamily: "inherit", fontSize: 14, outline: "none", resize: "none", lineHeight: 1.4,
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ ...iconBtn, cursor: reading ? "wait" : "pointer" }} title="Read a photo of a schedule" aria-label="Attach a photo">
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M20 11.5l-7.6 7.6a4.2 4.2 0 0 1-6-6l7.7-7.6a2.8 2.8 0 1 1 4 4l-7.7 7.6a1.4 1.4 0 0 1-2-2l7-7"
                        stroke={t.text3} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickPhoto(f); e.target.value = ""; }}
                    />
                  </label>

                  <span style={{ width: 1, height: 20, background: t.sep, flexShrink: 0 }} />

                  {/* What it is allowed to do. */}
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => setModeOpen((v) => !v)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px",
                        borderRadius: 4, border: `1px solid ${mode === "read" ? BRAND_TEAL : "#8A4B38"}`,
                        background: "transparent", color: mode === "read" ? BRAND_TEAL : "#8A4B38",
                        fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600, cursor: "pointer",
                      }}
                    >
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <rect x={5} y={11} width={14} height={9} rx={2} stroke="currentColor" strokeWidth={1.8} />
                        <path d={mode === "read" ? "M8.5 11V8a3.5 3.5 0 1 1 7 0v3" : "M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2"}
                          stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" fill="none" />
                      </svg>
                      {MODE_LABEL[mode]}
                      <svg width={11} height={11} viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {modeOpen && (
                      <div
                        style={{
                          position: "absolute", bottom: 36, left: 0, zIndex: 2, minWidth: 200,
                          background: t.bgElev, border: `1px solid ${t.sep}`, borderRadius: 6,
                          boxShadow: "0 10px 28px rgba(20,32,30,0.22)", overflow: "hidden",
                        }}
                      >
                        {(["read", "write"] as AskMode[]).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => { setMode(m); setModeOpen(false); }}
                            style={{
                              display: "block", width: "100%", textAlign: "left", padding: "9px 12px",
                              border: 0, background: m === mode ? (dark ? "rgba(255,255,255,0.06)" : "#F7F6F3") : "transparent",
                              color: t.text, fontSize: 13, fontFamily: "inherit", cursor: "pointer",
                            }}
                          >
                            <div style={{ fontWeight: 600 }}>{MODE_LABEL[m]}</div>
                            <div style={{ fontSize: 11.5, color: t.text3, marginTop: 2 }}>
                              {m === "read" ? "Answers only. Never writes." : "Can change the schedule, after confirming."}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Which model answered. */}
                  {model && (
                    <span style={{ fontSize: 11.5, color: t.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {modelLabel(model)}
                    </span>
                  )}

                  <span style={{ flex: 1 }} />

                  <button
                    type="button"
                    onClick={toggleMic}
                    aria-label={listening ? "Stop dictation" : "Dictate"}
                    title={listening ? "Stop dictation" : "Dictate"}
                    style={{ ...iconBtn, color: listening ? "#8A4B38" : t.text3 }}
                  >
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x={9} y={3} width={6} height={11} rx={3} stroke="currentColor" strokeWidth={1.7} />
                      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    onClick={() => send(draft)}
                    disabled={busy || !draft.trim()}
                    aria-label="Send"
                    style={{
                      width: 36, height: 36, borderRadius: "50%", border: 0, flexShrink: 0,
                      background: BRAND_TEAL, color: "#fff",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      cursor: (busy || !draft.trim()) ? "not-allowed" : "pointer",
                      opacity: (busy || !draft.trim()) ? 0.45 : 1,
                    }}
                  >
                    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 19V6M6 12l6-6 6 6" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: t.text3, lineHeight: 1.35 }}>
                  {MODE_CAPTION[mode]}
                </span>
                <span style={{ fontSize: 12, color: t.text3, flexShrink: 0 }}>⌘K</span>
              </div>
            </div>
          </>
        )}
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
