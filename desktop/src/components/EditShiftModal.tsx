import { useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState } from "../state";
import { compactTime } from "../state";
import type { ShiftSource } from "../data";
import { editShift } from "../lib/writeShift";
import { BRAND_FONT } from "./BrandMark";

export interface EditShiftTarget {
  date: string;
  source: ShiftSource;
  initialShiftTypeId: string;
  /** The shift's current note, so the field opens showing it. */
  initialNote: string;
  /** "self" or "partner" — for display only. */
  who: "G" | "K";
}

interface Props {
  target: EditShiftTarget | null;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
}

export function EditShiftModal({ target, onClose, palette, t, dark, householdId, state }: Props) {
  const open = !!target;
  const [shiftTypeId, setShiftTypeId] = useState<string>(target?.initialShiftTypeId ?? "");
  const [note, setNote] = useState<string>(target?.initialNote ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const key = target ? `${target.date}-${target.source.kind}-${target.initialShiftTypeId}` : "";
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setShiftTypeId(target?.initialShiftTypeId ?? "");
    setNote(target?.initialNote ?? "");
    setErr(null);
  }

  if (!open || !target) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId) {
      setErr("No household linked.");
      return;
    }
    if (!shiftTypeId) {
      setErr("Pick a shift type.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await editShift(householdId, target.date, target.source, { shiftTypeId, note });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the change.");
    } finally {
      setBusy(false);
    }
  };

  const personName = target.who === "G" ? state?.selfName || "Me" : state?.partner?.name || "Partner";
  const sourceLabel = target.source.kind === "template" || target.source.kind === "alt-weekend"
    ? "Editing recurring shift for this date will create a one-off override (template stays untouched)."
    : "";

  void palette;
  void dark;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit shift"
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
        <div style={{ fontFamily: BRAND_FONT, fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 4 }}>Edit shift</div>
        <div style={{ fontSize: 12, color: t.text2, marginBottom: 14 }}>
          {personName} · {target.date}
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Shift type" t={t}>
            <select
              value={shiftTypeId}
              onChange={(e) => setShiftTypeId(e.target.value)}
              required
              style={selectStyle(t)}
            >
              {(state?.shiftTypes ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {compactTime(s.start)} to {compactTime(s.end)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Note (optional)" t={t}>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the household should know"
              style={inputStyle(t)}
            />
          </Field>

          {sourceLabel && (
            <div style={{ fontSize: 11.5, color: t.text3, lineHeight: 1.45 }}>{sourceLabel}</div>
          )}
          {err && <div style={{ fontSize: 12, color: "#8A4B38" }}>{err}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} style={secondaryBtn(t)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !shiftTypeId} style={primaryBtn(palette.G, busy || !shiftTypeId)}>
              {busy ? "Saving…" : "Save"}
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
