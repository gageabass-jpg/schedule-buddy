import { useState } from "react";
import { signInWithGoogle, signInWithApple, signInWithEmail } from "../hooks/useAuth";
import { themeTokens } from "../theme";
import { BrandMark, BRAND_FONT, BRAND_TEAL } from "./BrandMark";

export function SignIn({ dark = true }: { dark?: boolean }) {
  const t = themeTokens(dark);
  const [mode, setMode] = useState<"choose" | "email">("choose");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onGoogle = async () => {
    setErr(null);
    setBusy(true);
    try { await signInWithGoogle(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Sign-in failed"); }
    finally { setBusy(false); }
  };

  const onApple = async () => {
    setErr(null);
    setBusy(true);
    try { await signInWithApple(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Sign-in failed"); }
    finally { setBusy(false); }
  };

  const onEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try { await signInWithEmail(email, pw); }
    catch (e) { setErr(e instanceof Error ? e.message : "Sign-in failed"); }
    finally { setBusy(false); }
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
      <div style={{ width: 360, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <BrandMark size={56} />
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 24, lineHeight: 1, letterSpacing: "-0.02em", fontFamily: BRAND_FONT, whiteSpace: "nowrap" }}>
            <span style={{ fontWeight: 600 }}>nucleus</span>
            <span style={{ fontWeight: 400, color: t.text2 }}> manager</span>
          </div>
        </div>

        {mode === "choose" && (
          <>
            <button
              type="button"
              onClick={onApple}
              disabled={busy}
              style={appleBtn(busy)}
            >
              <AppleGlyph />
              {busy ? "Signing in…" : "Continue with Apple"}
            </button>
            <button
              type="button"
              onClick={onGoogle}
              disabled={busy}
              style={secondaryBtn(t)}
            >
              Continue with Google
            </button>
            <button
              type="button"
              onClick={() => setMode("email")}
              disabled={busy}
              style={secondaryBtn(t)}
            >
              Continue with email
            </button>
          </>
        )}

        {mode === "email" && (
          <form onSubmit={onEmail} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email"
              required
              autoFocus
              style={inputStyle(t)}
            />
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="password"
              required
              style={inputStyle(t)}
            />
            <button type="submit" disabled={busy} style={primaryBtn(BRAND_TEAL, busy)}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button type="button" onClick={() => setMode("choose")} style={linkBtn(t)}>
              ← Back
            </button>
          </form>
        )}

        {err && (
          <div style={{ fontSize: 12, color: "#FF453A", textAlign: "center", maxWidth: "100%" }}>
            {err}
          </div>
        )}
      </div>
    </div>
  );
}

function primaryBtn(color: string, busy: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 14px",
    border: 0,
    borderRadius: 8,
    background: color,
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.7 : 1,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
  };
}

function appleBtn(busy: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 14px",
    border: 0,
    borderRadius: 8,
    background: "#000000",
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: 600,
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.7 : 1,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  };
}

function AppleGlyph() {
  return (
    <svg width="14" height="17" viewBox="0 0 18 21" fill="#FFFFFF" aria-hidden="true">
      <path d="M14.5 11.2c0-2.4 2-3.5 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.7 1.1 8.9.7 1.1 1.6 2.3 2.8 2.2 1.1 0 1.5-.7 2.9-.7 1.3 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.5-.7.9-1.5 1.2-2.4-1-.4-2-1.5-2-3.6zm-2.4-6.3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .1 1.9-.5 2.5-1.2z"/>
    </svg>
  );
}

function secondaryBtn(t: ReturnType<typeof themeTokens>): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 14px",
    border: `0.5px solid ${t.sep}`,
    borderRadius: 8,
    background: t.bgElev,
    color: t.text,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
  };
}

function linkBtn(t: ReturnType<typeof themeTokens>): React.CSSProperties {
  return {
    background: "transparent",
    border: 0,
    color: t.text2,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 4,
  };
}

function inputStyle(t: ReturnType<typeof themeTokens>): React.CSSProperties {
  return {
    padding: "9px 12px",
    background: t.bgElev,
    border: `0.5px solid ${t.sep}`,
    borderRadius: 8,
    color: t.text,
    fontSize: 14,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
    outline: "none",
  };
}
