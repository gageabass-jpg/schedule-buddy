import { useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState } from "../state";
import { writeNewShift, type ShiftTarget } from "../lib/writeShift";
import { compactTime, isCustomType } from "../state";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
  defaultDate: string;
}

export function NewShiftModal({ open, onClose, palette, t, dark, householdId, state, defaultDate }: Props) {
  const [target, setTarget] = useState<ShiftTarget>("self-ot");
  const [date, setDate] = useState<string>(defaultDate);
  const [shiftTypeId, setShiftTypeId] = useState<string>(state?.shiftTypes?.[0]?.id ?? "");
  const [customTime, setCustomTime] = useState(false);
  const [customStart, setCustomStart] = useState("09:00");
  const [customEnd, setCustomEnd] = useState("17:00");
  const [label, setLabel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset form fields when the modal opens for a new entry.
  const openKey = `${open}-${defaultDate}`;
  const [lastOpenKey, setLastOpenKey] = useState(openKey);
  if (openKey !== lastOpenKey) {
    setLastOpenKey(openKey);
    setDate(defaultDate);
    setShiftTypeId(state?.shiftTypes?.[0]?.id ?? "");
    setCustomTime(false);
    setCustomStart("09:00");
    setCustomEnd("17:00");
    setLabel("");
    setErr(null);
  }

  if (!open) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId) {
      setErr("No household linked.");
      return;
    }
    if (!customTime && !shiftTypeId) {
      setErr("Pick a shift type or add a custom time.");
      return;
    }
    if (customTime && customEnd === customStart) {
      setErr("Custom start and end can't be the same.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await writeNewShift({
        householdId, target, date, shiftTypeId, label,
        customTime: customTime ? { start: customStart, end: customEnd } : undefined,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the shift.");
    } finally {
      setBusy(false);
    }
  };

  const selfName = state?.selfName || "Me";
  const partnerName = state?.partner?.name || "Partner";

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 1100,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New shift"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(440px, calc(100vw - 32px))",
          background: t.bgElev,
          color: t.text,
          borderRadius: 16,
          padding: "20px 22px 16px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
          zIndex: 1101,
          fontFamily: "inherit",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 14 }}>New shift</div>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Person toggle */}
          <Field label="Person" t={t}>
            <div style={{ display: "flex", gap: 6, padding: 2, background: dark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.06)", borderRadius: 8 }}>
              <SegBtn active={target === "self-ot"} onClick={() => setTarget("self-ot")} color={palette.G} t={t} dark={dark}>
                {selfName}
              </SegBtn>
              <SegBtn active={target === "partner"} onClick={() => setTarget("partner")} color={palette.K} t={t} dark={dark}>
                {partnerName}
              </SegBtn>
            </div>
          </Field>

          <Field label="Date" t={t}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              style={inputStyle(t)}
            />
          </Field>

          <Field label="Shift type" t={t}>
            <select
              value={shiftTypeId}
              onChange={(e) => setShiftTypeId(e.target.value)}
              disabled={customTime}
              style={{ ...selectStyle(t), opacity: customTime ? 0.5 : 1 }}
            >
              {(state?.shiftTypes ?? []).filter((s) => !isCustomType(s.id)).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {compactTime(s.start)} to {compactTime(s.end)}
                </option>
              ))}
            </select>
          </Field>

          {/* Custom time — override the shift type's times for this one shift. */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: -4 }}>
            <input
              type="checkbox"
              checked={customTime}
              onChange={(e) => setCustomTime(e.target.checked)}
              style={{ accentColor: palette.G, width: 15, height: 15, cursor: "pointer" }}
            />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: t.text2, letterSpacing: "-0.01em" }}>
              Add custom time
            </span>
          </label>

          {customTime && (
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Start" t={t}>
                <input type="time" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={inputStyle(t)} />
              </Field>
              <Field label="End" t={t}>
                <input type="time" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={inputStyle(t)} />
              </Field>
            </div>
          )}

          <Field label="Label (optional)" t={t}>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={target === "self-ot" ? "e.g. with K" : "e.g. ICU"}
              style={inputStyle(t)}
            />
          </Field>

          {err && (
            <div style={{ fontSize: 12, color: "#8A4B38", marginTop: 2 }}>{err}</div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
            <button type="button" onClick={onClose} style={secondaryBtn(t)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" disabled={busy || (!customTime && !shiftTypeId)} style={primaryBtn(palette.G, busy || (!customTime && !shiftTypeId))}>
              {busy ? "Saving…" : "Add shift"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function Field({ label, t, children }: { label: string; t: ThemeTokens; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: t.text3, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function SegBtn({
  active, onClick, color, t, dark, children,
}: {
  active: boolean;
  onClick: () => void;
  color: string;
  t: ThemeTokens;
  dark: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "6px 10px",
        border: 0,
        borderRadius: 6,
        background: active ? (dark ? "#3A3A3C" : "#fff") : "transparent",
        color: active ? color : t.text2,
        fontSize: 12.5,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        letterSpacing: "-0.01em",
        boxShadow: active ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function inputStyle(t: ThemeTokens): React.CSSProperties {
  return {
    padding: "9px 12px",
    background: t.bg === "#000" ? "#000" : t.bg,
    border: `0.5px solid ${t.sep}`,
    borderRadius: 8,
    color: t.text,
    fontSize: 13,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
    outline: "none",
    colorScheme: t.bg === "#000" ? "dark" : "light",
  };
}

function selectStyle(t: ThemeTokens): React.CSSProperties {
  // Custom chevron inset 14px from the right edge — gives the option text
  // breathing room and lets us style consistently across OS chrome.
  const stroke = "%23" + (t.bg === "#000" ? "8E8E93" : "6E6E73");
  const chevron =
    `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='${stroke}' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>")`;
  return {
    ...inputStyle(t),
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    paddingRight: 36,
    backgroundImage: chevron,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 14px center",
    backgroundSize: "12px 12px",
  };
}

function primaryBtn(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    border: 0,
    borderRadius: 8,
    background: color,
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
  };
}

function secondaryBtn(t: ThemeTokens): React.CSSProperties {
  return {
    padding: "8px 14px",
    border: `0.5px solid ${t.sep}`,
    borderRadius: 8,
    background: "transparent",
    color: t.text,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
  };
}
