import { useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { Event, EventWho, HouseholdState } from "../state";
import { addEvent, updateEvent, deleteEvent } from "../lib/writeEvent";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
  /** Date pre-fill when opening for "new". */
  defaultDate: string;
  /** When set, the modal opens in edit mode. */
  editing?: Event | null;
}

const PEOPLE: Array<{ value: EventWho; label: string }> = [
  { value: "G", label: "Gage" },
  { value: "K", label: "Kaylene" },
  { value: "Daisy", label: "Daisy" },
  { value: "family", label: "Family" },
];

export function EventModal({
  open, onClose, palette, t, dark, householdId, state, defaultDate, editing,
}: Props) {
  const isEdit = !!editing;
  const [date, setDate] = useState(editing?.date ?? defaultDate);
  const [startTime, setStartTime] = useState(editing?.startTime ?? "");
  const [endTime, setEndTime] = useState(editing?.endTime ?? "");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [who, setWho] = useState<EventWho>(editing?.who ?? "G");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset form whenever the modal is reopened for a different target.
  const key = `${open}-${editing?.id ?? ""}-${defaultDate}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setDate(editing?.date ?? defaultDate);
    setStartTime(editing?.startTime ?? "");
    setEndTime(editing?.endTime ?? "");
    setTitle(editing?.title ?? "");
    setWho(editing?.who ?? "G");
    setNotes(editing?.notes ?? "");
    setErr(null);
  }

  if (!open) return null;
  void state;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    setBusy(true);
    try {
      const input = {
        date,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        title,
        who,
        notes: notes || undefined,
      };
      if (isEdit && editing) {
        await updateEvent(householdId, editing.id, input);
      } else {
        await addEvent(householdId, input);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the event.");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!isEdit || !editing || !householdId) return;
    if (!window.confirm(`Delete "${editing.title}"?`)) return;
    setBusy(true);
    try {
      await deleteEvent(householdId, editing.id);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't delete the event.");
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
        aria-label={isEdit ? "Edit event" : "New event"}
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
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 14 }}>
          {isEdit ? "Edit event" : "New event"}
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Title" t={t}>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
              placeholder="e.g. Cardio rehab"
              style={inputStyle(t)}
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <Field label="Date" t={t}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={inputStyle(t)} />
            </Field>
            <Field label="Start" t={t}>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle(t)} />
            </Field>
            <Field label="End" t={t}>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle(t)} />
            </Field>
          </div>

          <Field label="For" t={t}>
            <div style={{ display: "flex", gap: 4, padding: 2, background: dark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.06)", borderRadius: 8 }}>
              {PEOPLE.map((p) => {
                const active = who === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setWho(p.value)}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      border: 0,
                      borderRadius: 6,
                      background: active ? (dark ? "#3A3A3C" : "#fff") : "transparent",
                      color: t.text,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      boxShadow: active ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Notes (optional)" t={t}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ ...inputStyle(t), resize: "vertical", fontFamily: "inherit" }}
            />
          </Field>

          {err && <div style={{ fontSize: 12, color: "#FF453A" }}>{err}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            {isEdit && (
              <button
                type="button"
                onClick={onDelete}
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
                  marginRight: "auto",
                }}
              >
                Delete
              </button>
            )}
            <button type="button" onClick={onClose} disabled={busy} style={secondaryBtn(t)}>Cancel</button>
            <button type="submit" disabled={busy} style={primaryBtn(palette.G, busy)}>
              {busy ? "Saving…" : isEdit ? "Save changes" : "Add event"}
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
    width: "100%",
    colorScheme: t.bg === "#000" ? "dark" : "light",
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
