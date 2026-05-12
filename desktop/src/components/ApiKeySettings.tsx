import { useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
}

export function ApiKeySettings({ open, onClose, palette, t }: Props) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setValue("");
    window.sbm?.hasApiKey().then(setHasKey).catch(() => setHasKey(false));
  }, [open]);

  if (!open) return null;

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.sbm) {
      setErr("This feature only works inside the Schedule Buddy Manager app.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const res = await window.sbm.setApiKey(value);
      if (!res.ok) {
        setErr(res.error || "Couldn't save the key.");
        return;
      }
      setHasKey(true);
      setValue("");
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    if (!window.sbm) return;
    setBusy(true);
    try {
      await window.sbm.clearApiKey();
      setHasKey(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Anthropic API key"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(460px, calc(100vw - 32px))",
          background: t.bgElev,
          color: t.text,
          borderRadius: 16,
          padding: "20px 22px 16px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
          zIndex: 1101,
          fontFamily: "inherit",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>Anthropic API key</div>
        <div style={{ fontSize: 12, color: t.text2, marginTop: 6, lineHeight: 1.5 }}>
          Used to parse schedule photos with Claude Vision. Get one at{" "}
          <span style={{ color: palette.G }}>console.anthropic.com</span>. The key is encrypted
          locally (macOS Keychain) and never leaves your Mac except in calls to Anthropic.
        </div>

        <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: t.bg, border: `0.5px solid ${t.sep}` }}>
          <div style={{ fontSize: 11, color: t.text3, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
            Status
          </div>
          <div style={{ fontSize: 13, color: t.text, fontWeight: 600, marginTop: 2 }}>
            {hasKey === null ? "Checking…" : hasKey ? "Key configured" : "No key set"}
          </div>
        </div>

        <form onSubmit={onSave} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={hasKey ? "Paste a new key to replace" : "sk-ant-…"}
            autoFocus
            spellCheck={false}
            style={{
              padding: "9px 12px",
              background: t.bg,
              border: `0.5px solid ${t.sep}`,
              borderRadius: 8,
              color: t.text,
              fontSize: 13,
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              outline: "none",
            }}
          />
          {err && <div style={{ fontSize: 12, color: "#FF453A" }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            {hasKey && (
              <button
                type="button"
                onClick={onClear}
                disabled={busy}
                style={{
                  padding: "8px 14px",
                  border: `0.5px solid ${t.sep}`,
                  borderRadius: 8,
                  background: "transparent",
                  color: "#FF453A",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Clear key
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{
                padding: "8px 14px",
                border: `0.5px solid ${t.sep}`,
                borderRadius: 8,
                background: "transparent",
                color: t.text,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Done
            </button>
            <button
              type="submit"
              disabled={busy || !value.trim()}
              style={{
                padding: "8px 14px",
                border: 0,
                borderRadius: 8,
                background: palette.G,
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy || !value.trim() ? "not-allowed" : "pointer",
                opacity: busy || !value.trim() ? 0.5 : 1,
                fontFamily: "inherit",
              }}
            >
              {busy ? "Saving…" : "Save key"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
