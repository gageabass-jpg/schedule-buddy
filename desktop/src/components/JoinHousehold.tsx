import { useState } from "react";
import { joinHousehold } from "../lib/joinHousehold";
import { doSignOut } from "../hooks/useAuth";
import { themeTokens, getPalette } from "../theme";
import { BrandMark } from "./BrandMark";

export function JoinHousehold({ dark = true }: { dark?: boolean }) {
  const t = themeTokens(dark);
  const palette = getPalette("modern");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await joinHousehold(code);
      // No need to navigate — useHousehold subscription will pick up the new
      // membership and App.tsx will re-render into the ManagerApp view.
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't join household.");
    } finally {
      setBusy(false);
    }
  };

  // Auto-uppercase + restrict to the 6-char invite alphabet (A-Z minus I/O, 2-9)
  const onCodeChange = (raw: string) => {
    const cleaned = raw
      .toUpperCase()
      .replace(/[^A-HJ-NP-Z2-9]/g, "")
      .slice(0, 6);
    setCode(cleaned);
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: t.bg,
        color: t.text,
        padding: 24,
      }}
    >
      <div style={{ width: 380, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <BrandMark size={52} />
        <div style={{ textAlign: "center", marginBottom: 2 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>Join your household</div>
          <div style={{ fontSize: 13, color: t.text2, marginTop: 6, lineHeight: 1.45, maxWidth: 340 }}>
            Enter the 6-character invite code from the Nucleus iOS app to link this Mac to your existing household.
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder="ABC234"
            autoFocus
            maxLength={6}
            spellCheck={false}
            autoCapitalize="characters"
            style={{
              padding: "14px 16px",
              background: t.bgElev,
              border: `0.5px solid ${t.sep}`,
              borderRadius: 10,
              color: t.text,
              fontSize: 22,
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              fontWeight: 700,
              letterSpacing: "0.18em",
              textAlign: "center",
              outline: "none",
              textTransform: "uppercase",
            }}
          />
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            style={{
              width: "100%",
              padding: "10px 14px",
              border: 0,
              borderRadius: 8,
              background: palette.G,
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: busy || code.length !== 6 ? "not-allowed" : "pointer",
              opacity: busy || code.length !== 6 ? 0.5 : 1,
              fontFamily: "inherit",
              letterSpacing: "-0.01em",
            }}
          >
            {busy ? "Joining…" : "Join household"}
          </button>
        </form>

        {err && (
          <div style={{ fontSize: 12, color: t.clayText, textAlign: "center", maxWidth: "100%" }}>
            {err}
          </div>
        )}

        <div style={{ fontSize: 11, color: t.text3, textAlign: "center", marginTop: 6, lineHeight: 1.5, maxWidth: 320 }}>
          Don't have a code yet? Open Nucleus on iOS — the invite code is in your household settings.
        </div>

        <button
          type="button"
          onClick={() => { void doSignOut(); }}
          style={{
            marginTop: 4,
            padding: "6px 12px",
            background: "transparent",
            border: 0,
            color: t.text3,
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            letterSpacing: "-0.01em",
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
