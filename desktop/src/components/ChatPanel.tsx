import { useEffect, useMemo, useRef, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdMeta } from "../state";
import { auth } from "../firebase";
import {
  ChatError,
  type ChatMessage,
  deleteChatMessage,
  markChatRead,
  sendChatMessage,
  subscribeChat,
} from "../lib/chat";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  household: HouseholdMeta | null;
}

function friendlyTimestamp(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function colorForSender(uid: string, household: HouseholdMeta | null, palette: Palette): string {
  if (!household) return palette.G;
  const name = (household.memberNames?.[uid] ?? "").toLowerCase();
  if (name.includes("gage")) return palette.G;
  if (name.includes("kaylene") || name.includes("kayl")) return palette.K;
  // Anyone else (caregivers, future members) gets neutral green.
  return "#30D158";
}

export function ChatPanel({ open, onClose, palette, t, dark, householdId, household }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const myUid = auth.currentUser?.uid ?? "";
  const myName = useMemo(() => {
    if (!household) return auth.currentUser?.displayName || auth.currentUser?.email || "Me";
    return household.memberNames?.[myUid]
      || auth.currentUser?.displayName
      || auth.currentUser?.email
      || "Me";
  }, [household, myUid]);

  // Subscribe whenever the panel is open and we have a household.
  useEffect(() => {
    if (!open || !householdId) return;
    const unsub = subscribeChat(
      householdId,
      (msgs) => { setMessages(msgs); },
      (e) => { setErr(e instanceof Error ? e.message : "Couldn't load chat."); },
    );
    // Mark read on open + 5s after (covers the case where new messages
    // arrive while the panel is open).
    markChatRead(householdId).catch(() => {});
    const tickId = window.setInterval(() => markChatRead(householdId).catch(() => {}), 30_000);
    return () => { unsub(); window.clearInterval(tickId); };
  }, [open, householdId]);

  // Auto-scroll to bottom when a new message arrives.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, open]);

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  if (!open) return null;

  const onSend = async () => {
    if (!householdId || !draft.trim()) return;
    setErr(null);
    setSending(true);
    try {
      await sendChatMessage(householdId, draft, myName);
      setDraft("");
    } catch (e) {
      setErr(e instanceof ChatError ? e.message : "Couldn't send.");
    } finally {
      setSending(false);
    }
  };

  // Group messages by day for separators.
  const grouped: { dayLabel: string; rows: ChatMessage[] }[] = [];
  for (const m of messages) {
    const ms = m.createdAt?.toMillis?.() ?? 0;
    const d = ms ? new Date(ms) : new Date();
    const dayKey = d.toDateString();
    const last = grouped[grouped.length - 1];
    const dayLabel = (() => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const cmp = new Date(d); cmp.setHours(0, 0, 0, 0);
      const diffDays = Math.round((today.getTime() - cmp.getTime()) / 86_400_000);
      if (diffDays === 0) return "Today";
      if (diffDays === 1) return "Yesterday";
      return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    })();
    if (!last || last.dayLabel !== dayLabel) grouped.push({ dayLabel, rows: [m] });
    else last.rows.push(m);
    void dayKey;
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1100 }} />
      <div
        role="dialog"
        aria-label="Family chat"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(420px, calc(100vw - 32px))",
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
            padding: "14px 16px",
            borderBottom: `0.5px solid ${t.sep}`,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>Family chat</div>
            <div style={{ fontSize: 11.5, color: t.text3, marginTop: 2 }}>
              {(household?.memberUids?.length ?? 0)} member{(household?.memberUids?.length ?? 0) === 1 ? "" : "s"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: 0, color: t.text2, fontSize: 18, cursor: "pointer", padding: 4, fontFamily: "inherit" }}
            aria-label="Close chat"
          >✕</button>
        </header>

        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            background: dark ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.02)",
          }}
        >
          {messages.length === 0 ? (
            <div style={{ margin: "auto", fontSize: 13, color: t.text3, textAlign: "center", padding: 24 }}>
              No messages yet. Be the first to say hi.
            </div>
          ) : grouped.map((group, gi) => (
            <div key={gi} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{
                alignSelf: "center",
                fontSize: 10.5,
                fontWeight: 600,
                color: t.text3,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                margin: "8px 0 2px",
              }}>{group.dayLabel}</div>
              {group.rows.map((m, mi) => {
                const mine = m.senderId === myUid;
                const prev = mi > 0 ? group.rows[mi - 1] : null;
                const sameSenderAsPrev = prev && prev.senderId === m.senderId;
                const color = colorForSender(m.senderId, household, palette);
                return (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: mine ? "flex-end" : "flex-start",
                      gap: 2,
                      marginTop: sameSenderAsPrev ? 0 : 6,
                    }}
                  >
                    {!sameSenderAsPrev && !mine && (
                      <div style={{ fontSize: 10.5, fontWeight: 600, color, letterSpacing: "-0.01em", padding: "0 8px" }}>
                        {m.senderName}
                      </div>
                    )}
                    <div
                      onClick={() => {
                        if (mine && householdId && window.confirm("Delete this message?")) {
                          deleteChatMessage(householdId, m.id).catch(() => {});
                        }
                      }}
                      title={m.createdAt ? friendlyTimestamp(m.createdAt.toMillis()) : ""}
                      style={{
                        maxWidth: "78%",
                        padding: "7px 11px",
                        borderRadius: 14,
                        borderTopRightRadius: mine ? 4 : 14,
                        borderTopLeftRadius: mine ? 14 : 4,
                        background: mine ? color : (dark ? "rgba(255,255,255,0.08)" : "#fff"),
                        color: mine ? "#fff" : t.text,
                        fontSize: 13.5,
                        lineHeight: 1.4,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        cursor: mine ? "pointer" : "default",
                        border: mine ? "0" : `0.5px solid ${t.sep}`,
                      }}
                    >
                      {m.text}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
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
            background: t.bgElev,
            alignItems: "flex-end",
          }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Message…"
            rows={1}
            style={{
              flex: 1,
              minHeight: 34,
              maxHeight: 120,
              padding: "8px 10px",
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
            onClick={onSend}
            disabled={sending || !draft.trim()}
            style={{
              padding: "0 14px",
              height: 34,
              borderRadius: 18,
              border: 0,
              background: palette.G,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: (sending || !draft.trim()) ? "not-allowed" : "pointer",
              opacity: (sending || !draft.trim()) ? 0.5 : 1,
              fontFamily: "inherit",
              letterSpacing: "-0.01em",
            }}
          >Send</button>
        </div>
      </div>
    </>
  );
}
