import { useState } from "react";
import { signInWithGoogle, signInWithEmail } from "../hooks/useAuth";
import { themeTokens, getPalette } from "../theme";
import { BrandMark } from "./BrandMark";

export function SignIn() {
  const t = themeTokens(true);
  const palette = getPalette("modern");
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
        <BrandMark size={56} palette={palette} dark={true} />
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Schedule Buddy</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: palette.G, letterSpacing: "-0.01em", marginTop: 2 }}>Manager</div>
        </div>

        {mode === "choose" && (
          <>
            <button
              type="button"
              onClick={onGoogle}
              disabled={busy}
              style={primaryBtn(palette.G, busy)}
            >
              {busy ? "Signing in…" : "Continue with Google"}
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
            <button type="submit" disabled={busy} style={primaryBtn(palette.G, busy)}>
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
