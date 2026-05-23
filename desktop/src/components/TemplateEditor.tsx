import { useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState } from "../state";
import { writeTemplate } from "../lib/writeTemplate";
import { compactTime } from "../state";
import { DAYS_LONG } from "../data";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
}

export function TemplateEditor({ open, onClose, palette, t, dark, householdId, state }: Props) {
  const initialTemplate: Array<string | null> = state?.template ?? [null, null, null, null, null, null, null];
  const initialEndDate = state?.templateEndDate ?? "";
  const [draft, setDraft] = useState<Array<string | null>>(initialTemplate);
  const [endEnabled, setEndEnabled] = useState<boolean>(!!initialEndDate);
  const [endDate, setEndDate] = useState<string>(initialEndDate);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset draft each time the modal opens or the underlying template changes.
  const key = `${open}-${JSON.stringify(initialTemplate)}-${initialEndDate}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setDraft(initialTemplate);
    setEndEnabled(!!initialEndDate);
    setEndDate(initialEndDate);
    setErr(null);
  }

  if (!open) return null;

  const onChangeDay = (dow: number, value: string) => {
    setDraft((d) => {
      const next = [...d];
      next[dow] = value === "" ? null : value;
      return next;
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId) {
      setErr("No household linked.");
      return;
    }
    if (endEnabled && !endDate) {
      setErr("Pick an end date, or uncheck the box.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await writeTemplate(householdId, draft, endEnabled ? endDate : null);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the template.");
    } finally {
      setBusy(false);
    }
  };

  const types = state?.shiftTypes ?? [];

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Weekly template"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(480px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 64px)",
          background: t.bgElev,
          color: t.text,
          borderRadius: 16,
          padding: "20px 22px 16px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
          zIndex: 1101,
          fontFamily: "inherit",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "hidden",
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>Weekly template</div>
          <div style={{ fontSize: 12, color: t.text2, marginTop: 4, lineHeight: 1.45 }}>
            Set {state?.selfName || "your"} recurring shift for each day of the week. Pick <em>Off</em> for days you don't work.
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, overflow: "hidden", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, overflow: "auto", padding: "2px 0" }}>
            {DAYS_LONG.map((dayName, dow) => {
              const value = draft[dow] ?? "";
              return (
                <div
                  key={dow}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>
                    {dayName}
                  </span>
                  <select
                    value={value}
                    onChange={(e) => onChangeDay(dow, e.target.value)}
                    style={selectStyle(t)}
                  >
                    <option value="">Off</option>
                    {types.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — {compactTime(s.start)} to {compactTime(s.end)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          {/* End-date control — keeps recurring schedules from running forever. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "10px 12px",
              background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
              borderRadius: 8,
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", userSelect: "none" }}>
              <input
                type="checkbox"
                checked={endEnabled}
                onChange={(e) => {
                  const on = e.target.checked;
                  setEndEnabled(on);
                  if (!on) setEndDate("");
                }}
                style={{ width: 15, height: 15, accentColor: palette.G, cursor: "pointer" }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>
                Set an end date for this schedule
              </span>
            </label>
            {endEnabled && (
              <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10, paddingLeft: 24 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: t.text2, letterSpacing: "-0.01em" }}>
                  Stops after
                </span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={inputStyle(t)}
                />
              </div>
            )}
            <div style={{ fontSize: 11, color: t.text2, lineHeight: 1.45, paddingLeft: endEnabled ? 0 : 24 }}>
              {endEnabled
                ? "The recurring template stops after this date. One-off shifts and overtime you've already added still show."
                : "Leave unchecked to repeat the weekly template indefinitely."}
            </div>
          </div>

          {err && <div style={{ fontSize: 12, color: "#FF453A" }}>{err}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} style={secondaryBtn(t)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" disabled={busy} style={primaryBtn(palette.G, busy)}>
              {busy ? "Saving…" : "Save template"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function inputStyle(t: ThemeTokens): React.CSSProperties {
  return {
    padding: "7px 10px",
    background: t.bg === "#000" ? "#000" : t.bg,
    border: `0.5px solid ${t.sep}`,
    borderRadius: 7,
    color: t.text,
    fontSize: 13,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
    outline: "none",
    width: "100%",
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
    paddingRight: 32,
    backgroundImage: chevron,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 12px center",
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
