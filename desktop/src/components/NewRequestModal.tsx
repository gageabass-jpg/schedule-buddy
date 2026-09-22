import { useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import { addCoverageRequests } from "../lib/writeCoverageRequest";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  householdId: string | null;
  defaultDate?: string;
  /** Optional pre-fill (e.g. converting a Shift Conflict from the Inbox). */
  prefill?: {
    date?: string;
    startTime?: string;
    endTime?: string;
    notes?: string;
  } | null;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Single-day coverage request — for one-offs that aren't a scheduling
 *  overlap (e.g. date night, appointment, parent-teacher meeting). */
export function NewRequestModal({
  open, onClose, palette, t, householdId, defaultDate, prefill,
}: Props) {
  const [date, setDate] = useState<string>(defaultDate || todayIso());
  const [startTime, setStartTime] = useState<string>("18:00");
  const [endTime, setEndTime] = useState<string>("22:00");
  const [notes, setNotes] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const pStart = prefill?.startTime || "18:00";
    const pEnd   = prefill?.endTime   || "22:00";
    setDate(prefill?.date || defaultDate || todayIso());
    setStartTime(pStart);
    setEndTime(pEnd);
    setNotes(prefill?.notes || "");
    setErr(null);
  }, [open, defaultDate, prefill]);

  if (!open) return null;

  // Detect "crosses midnight" so we can mark endsNextDay.
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const endsNextDay = (eh * 60 + em) <= (sh * 60 + sm);

  const onSend = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    setBusy(true);
    try {
      await addCoverageRequests(householdId, [{
        date,
        startTime,
        endTime,
        endsNextDay,
        notes: notes.trim() || undefined,
      }]);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Single coverage request"
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
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>New coverage request</div>
          <div style={{ fontSize: 12, color: t.text2, marginTop: 4, lineHeight: 1.45 }}>
            One-off coverage — for date night, an appointment, or anything that isn't a shift overlap.
          </div>
        </div>

        <Field label="Date" t={t}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={inputStyle(t)}
          />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Arrives (start)" t={t}>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              style={inputStyle(t)}
            />
          </Field>
          <Field label="End" t={t}>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              style={inputStyle(t)}
            />
          </Field>
        </div>
        {endsNextDay && (
          <div style={{ fontSize: 11.5, color: t.text3, marginTop: -8 }}>
            End time is on the next day.
          </div>
        )}

        <Field label="Notes (optional)" t={t}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. date night, dinner ready in fridge"
            rows={3}
            style={{ ...inputStyle(t), resize: "vertical", fontFamily: "inherit" }}
          />
        </Field>

        {err && <div style={{ fontSize: 12, color: "#8A4B38" }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={busy} style={secondaryBtn(t)}>Cancel</button>
          <button type="button" onClick={onSend} disabled={busy || !householdId} style={primaryBtn(palette.G, busy || !householdId)}>
            {busy ? "Sending…" : "Send to caregiver"}
          </button>
        </div>
      </div>
    </>
  );
}

function Field({ label, t, children }: { label: React.ReactNode; t: ThemeTokens; children: React.ReactNode }) {
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
    width: "100%",
    boxSizing: "border-box",
    colorScheme: t.bg === "#000" ? "dark" : "light",
  };
}

function primaryBtn(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 14px",
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
    padding: "9px 14px",
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
