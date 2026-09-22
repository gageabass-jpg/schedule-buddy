import { useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { Event, EventWho, HouseholdState } from "../state";
import { addEvent, addEvents, updateEvent, deleteEvent, deleteSeries } from "../lib/writeEvent";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
  defaultDate: string;
  editing?: Event | null;
  /** Seed a NEW event's fields (e.g. from an inbox request). Ignored when
   *  `editing` is set. Does not make the modal an edit — it still creates. */
  prefill?: Partial<Event> | null;
  /** Fired after a successful save (create or update). */
  onSaved?: () => void;
}

const PEOPLE: Array<{ value: EventWho; label: string }> = [
  { value: "G", label: "Gage" },
  { value: "K", label: "Kaylene" },
  { value: "Daisy", label: "Daisy" },
  { value: "family", label: "Family" },
];

export function EventModal({
  open, onClose, palette, t, dark, householdId, state, defaultDate, editing, prefill, onSaved,
}: Props) {
  const isEdit = !!editing;
  // For a new event, `prefill` seeds the fields; `editing` always wins if present.
  const seed = editing ?? prefill ?? null;
  const [dates, setDates] = useState<string[]>([seed?.date ?? defaultDate]);
  const [startTime, setStartTime] = useState(seed?.startTime ?? "");
  const [endTime, setEndTime] = useState(seed?.endTime ?? "");
  // All-day: when checked, the event has no start/end time. Defaults
  // to true when the seed has no start time.
  const [allDay, setAllDay] = useState(!seed?.startTime);
  const [title, setTitle] = useState(seed?.title ?? "");
  const [who, setWho] = useState<EventWho>(seed?.who ?? "G");
  const [notes, setNotes] = useState(seed?.notes ?? "");
  const [recurring, setRecurring] = useState(false);
  const [untilWeekly, setUntilWeekly] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset whenever the modal reopens for a different target. Include the
  // prefill identity so opening for a new inbox item re-seeds the fields.
  const key = `${open}-${editing?.id ?? ""}-${defaultDate}-${prefill?.date ?? ""}-${prefill?.title ?? ""}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setDates([seed?.date ?? defaultDate]);
    setStartTime(seed?.startTime ?? "");
    setEndTime(seed?.endTime ?? "");
    setAllDay(!seed?.startTime);
    setTitle(seed?.title ?? "");
    setWho(seed?.who ?? "G");
    setNotes(seed?.notes ?? "");
    setRecurring(false);
    setUntilWeekly("");
    setErr(null);
  }

  if (!open) return null;
  void state;

  const setDateAt = (i: number, value: string) =>
    setDates((arr) => arr.map((d, idx) => (idx === i ? value : d)));
  const addDay = () => setDates((arr) => {
    // Default new date to one week after the last entered date.
    const last = arr[arr.length - 1];
    const d = new Date(last + "T00:00:00");
    d.setDate(d.getDate() + 7);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return [...arr, next];
  });
  const removeDateAt = (i: number) => setDates((arr) => arr.filter((_, idx) => idx !== i));

  const baseInput = {
    startTime: allDay ? undefined : (startTime || undefined),
    endTime:   allDay ? undefined : (endTime || undefined),
    title,
    who,
    notes: notes || undefined,
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    setBusy(true);
    try {
      if (isEdit && editing) {
        await updateEvent(householdId, editing.id, { ...baseInput, date: dates[0] });
      } else if (dates.length === 1 && !recurring) {
        await addEvent(householdId, { ...baseInput, date: dates[0] });
      } else {
        await addEvents(householdId, baseInput, dates, recurring ? untilWeekly : undefined);
      }
      onSaved?.();
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

  const onDeleteSeries = async () => {
    if (!isEdit || !editing?.seriesId || !householdId) return;
    if (!window.confirm(`Delete every event in this series?`)) return;
    setBusy(true);
    try {
      const n = await deleteSeries(householdId, editing.seriesId);
      window.alert(`Deleted ${n} event${n === 1 ? "" : "s"}.`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't delete the series.");
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
        aria-label={isEdit ? "Edit life item" : "New life item"}
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
          overflow: "hidden",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 14 }}>
          {isEdit ? "Edit life item" : "New life item"}
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
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

          <div>
            <Subhead t={t}>{isEdit ? "Date" : "Days"}</Subhead>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 5 }}>
              {dates.map((d, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="date"
                    value={d}
                    onChange={(e) => setDateAt(i, e.target.value)}
                    required
                    style={{ ...inputStyle(t), flex: 1 }}
                  />
                  {!isEdit && dates.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDateAt(i)}
                      style={{
                        width: 30,
                        height: 30,
                        border: `0.5px solid ${t.sep}`,
                        background: "transparent",
                        color: t.text2,
                        borderRadius: 6,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                      aria-label="Remove this date"
                    >×</button>
                  )}
                </div>
              ))}
              {!isEdit && (
                <button
                  type="button"
                  onClick={addDay}
                  style={{
                    alignSelf: "flex-start",
                    background: "transparent",
                    border: 0,
                    color: palette.G,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    padding: "2px 0",
                    letterSpacing: "-0.01em",
                  }}
                >
                  + Add Day
                </button>
              )}
            </div>
          </div>

          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              color: t.text,
              cursor: "pointer",
              userSelect: "none",
              letterSpacing: "-0.01em",
            }}
          >
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              style={{ accentColor: palette.G, width: 14, height: 14, cursor: "pointer" }}
            />
            <span style={{ fontWeight: 500 }}>All day</span>
          </label>
          {!allDay && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label="Start" t={t}>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle(t)} />
              </Field>
              <Field label="End" t={t}>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle(t)} />
              </Field>
            </div>
          )}

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

          {!isEdit && (
            <div style={{ borderTop: `0.5px solid ${t.sep}`, paddingTop: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: t.text }}>
                <input
                  type="checkbox"
                  checked={recurring}
                  onChange={(e) => setRecurring(e.target.checked)}
                />
                <span style={{ fontWeight: 600, letterSpacing: "-0.01em" }}>Recurring</span>
                <span style={{ fontSize: 11.5, color: t.text3, fontWeight: 400 }}>
                  — repeats weekly on each selected day
                </span>
              </label>
              {recurring && (
                <div style={{ marginTop: 8 }}>
                  <Field label="Repeat until" t={t}>
                    <input
                      type="date"
                      value={untilWeekly}
                      onChange={(e) => setUntilWeekly(e.target.value)}
                      required
                      style={inputStyle(t)}
                    />
                  </Field>
                </div>
              )}
            </div>
          )}

          {isEdit && editing?.seriesId && (
            <div style={{ fontSize: 11.5, color: t.text3, lineHeight: 1.45, borderTop: `0.5px solid ${t.sep}`, paddingTop: 10 }}>
              This event is part of a series. Edit affects only this occurrence — use <em>Delete series</em> below to remove every event in the group.
            </div>
          )}

          {err && <div style={{ fontSize: 12, color: "#8A4B38" }}>{err}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4, flexWrap: "wrap" }}>
            {isEdit && editing?.seriesId && (
              <button
                type="button"
                onClick={onDeleteSeries}
                disabled={busy}
                style={dangerBtn(t, true)}
              >
                Delete series
              </button>
            )}
            {isEdit && (
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                style={dangerBtn(t)}
              >
                Delete
              </button>
            )}
            <div style={{ flex: 1 }} />
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
      <Subhead t={t}>{label}</Subhead>
      {children}
    </label>
  );
}

function Subhead({ t, children }: { t: ThemeTokens; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: t.text3, letterSpacing: "0.08em", textTransform: "uppercase" }}>
      {children}
    </span>
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

function dangerBtn(t: ThemeTokens, _solid = false): React.CSSProperties {
  return {
    padding: "8px 14px",
    border: `0.5px solid ${t.sep}`,
    borderRadius: 8,
    background: "transparent",
    color: "#8A4B38",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
  };
}
