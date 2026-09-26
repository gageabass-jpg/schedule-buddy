import { useEffect, useMemo, useRef, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdMeta } from "../state";
import { auth } from "../firebase";
import { ChatError, sendManagerMessage } from "../lib/chat";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  household: HouseholdMeta | null;
}

/**
 * "Chat Manager" — Gmail-style compose card that slides up from the bottom
 * right. Compose-only by design: the manager broadcasts as "Manager", and any
 * replies land on the phones' In-Basket Messages, not here.
 *
 * Recipient model: "Everyone" sends with no toUids (visible to the whole
 * household); picking members sends toUids so only they see it and only they
 * are notified.
 */
export function ChatManagerPanel({
  open, onClose, palette, t, dark, householdId, household,
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);   // [] = Everyone
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentFlash, setSentFlash] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const myUid = auth.currentUser?.uid ?? "";

  // Everyone in the household except me, as recipient options.
  const members = useMemo(() => {
    if (!household) return [] as { uid: string; name: string }[];
    return (household.memberUids ?? [])
      .filter((uid) => uid !== myUid)
      .map((uid) => ({ uid, name: household.memberNames?.[uid] || "Member" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [household, myUid]);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setDraft("");
    setErr(null);
    setSentFlash(false);
    setTimeout(() => inputRef.current?.focus(), 220);   // after the slide-in
  }, [open]);

  const toggleMember = (uid: string) => {
    setSelected((cur) =>
      cur.includes(uid) ? cur.filter((u) => u !== uid) : [...cur, uid]);
  };

  const onSend = async () => {
    if (!householdId || !draft.trim() || sending) return;
    setErr(null);
    setSending(true);
    try {
      // Selecting every member is the same as Everyone — send it untargeted
      // so future members see the history too.
      const toUids = selected.length > 0 && selected.length < members.length
        ? selected
        : null;
      await sendManagerMessage(householdId, draft, toUids);
      setDraft("");
      setSentFlash(true);
      setTimeout(() => { setSentFlash(false); onClose(); }, 900);
    } catch (e) {
      setErr(e instanceof ChatError ? e.message : "Couldn't send.");
    } finally {
      setSending(false);
    }
  };

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 11px",
        borderRadius: 999,
        border: `1px solid ${active ? "transparent" : t.sep}`,
        background: active ? palette.G : "transparent",
        color: active ? "#fff" : t.text2,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        letterSpacing: "-0.01em",
      }}
    >
      {label}
    </button>
  );

  const everyone = selected.length === 0;
  const recipientSummary = everyone
    ? "Everyone"
    : members.filter((m) => selected.includes(m.uid)).map((m) => m.name).join(", ");

  return (
    <div
      role="dialog"
      aria-label="Chat Manager"
      aria-hidden={!open}
      style={{
        position: "fixed",
        right: 18,
        bottom: 0,
        width: 380,
        maxWidth: "calc(100vw - 36px)",
        background: t.bgElev,
        color: t.text,
        border: `0.5px solid ${t.sep}`,
        borderBottom: 0,
        borderRadius: "12px 12px 0 0",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.35)",
        zIndex: 1200,
        display: "flex",
        flexDirection: "column",
        fontFamily: "inherit",
        transform: open ? "translateY(0)" : "translateY(110%)",
        transition: "transform 0.22s ease",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: `0.5px solid ${t.sep}`,
          background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
          borderRadius: "12px 12px 0 0",
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.01em" }}>
          New message · <span style={{ color: t.text3, fontWeight: 600 }}>Manager</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ background: "transparent", border: 0, color: t.text2, fontSize: 16, cursor: "pointer", padding: 2, lineHeight: 1, fontFamily: "inherit" }}
        >✕</button>
      </header>

      {/* Recipients */}
      <div style={{ padding: "10px 14px 4px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: t.text3, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
          To
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {chip("Everyone", everyone, () => setSelected([]))}
          {members.map((m) => chip(m.name, selected.includes(m.uid), () => toggleMember(m.uid)))}
        </div>
      </div>

      {/* Message */}
      <div style={{ padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSend(); }
          }}
          placeholder={`Message to ${recipientSummary}…`}
          rows={5}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "9px 11px",
            borderRadius: 10,
            border: `0.5px solid ${t.sep}`,
            background: t.bg,
            color: t.text,
            fontFamily: "inherit",
            fontSize: 13,
            lineHeight: 1.45,
            outline: "none",
            resize: "vertical",
            minHeight: 92,
          }}
        />
        {err && <div style={{ fontSize: 12, color: t.clayText }}>{err}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 11, color: t.text3, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sentFlash ? "Sent ✓" : `Recipients get: "You have a new In-Basket Message"`}
          </div>
          <button
            type="button"
            onClick={onSend}
            disabled={sending || !draft.trim()}
            title="Send (⌘↩)"
            style={{
              padding: "7px 18px",
              borderRadius: 8,
              border: 0,
              background: palette.G,
              color: "#fff",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: (sending || !draft.trim()) ? "not-allowed" : "pointer",
              opacity: (sending || !draft.trim()) ? 0.5 : 1,
              fontFamily: "inherit",
              letterSpacing: "-0.01em",
            }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
