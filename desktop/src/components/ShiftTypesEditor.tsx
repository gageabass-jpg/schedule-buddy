import { useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState, ShiftType } from "../state";
import { compactTime, isCustomType } from "../state";
import {
  addShiftType,
  updateShiftType,
  deleteShiftType,
  shiftTypeUsage,
  crossesMidnight,
} from "../lib/writeShiftTypes";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
}

type Mode =
  | { kind: "list" }
  | { kind: "add" }
  | { kind: "edit"; id: string; initial: { name: string; start: string; end: string; sleepHours?: number; preSleepHours?: number } };

export function ShiftTypesEditor({ open, onClose, palette, t, dark, householdId, state }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  // Reset to list view each time the modal opens.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    setMode({ kind: "list" });
  }

  if (!open) return null;

  // Hide synthetic "Custom …" types minted from inline template slots.
  const types = (state?.shiftTypes ?? []).filter((s) => !isCustomType(s.id));

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Shift types"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(520px, calc(100vw - 32px))",
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
        {mode.kind === "list" ? (
          <ListView
            t={t}
            dark={dark}
            palette={palette}
            types={types}
            state={state}
            householdId={householdId}
            onAdd={() => setMode({ kind: "add" })}
            onEdit={(typ) =>
              setMode({
                kind: "edit",
                id: typ.id,
                initial: { name: typ.name, start: typ.start, end: typ.end, sleepHours: typ.sleepHours ?? 0, preSleepHours: typ.preSleepHours ?? 0 },
              })
            }
            onClose={onClose}
          />
        ) : (
          <FormView
            t={t}
            palette={palette}
            mode={mode}
            householdId={householdId}
            onBack={() => setMode({ kind: "list" })}
          />
        )}
      </div>
    </>
  );
}

function ListView({
  t,
  dark,
  palette,
  types,
  state,
  householdId,
  onAdd,
  onEdit,
  onClose,
}: {
  t: ThemeTokens;
  dark: boolean;
  palette: Palette;
  types: ShiftType[];
  state: HouseholdState | null;
  householdId: string | null;
  onAdd: () => void;
  onEdit: (t: ShiftType) => void;
  onClose: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onDelete = async (typ: ShiftType) => {
    if (!householdId) return;
    const ok = window.confirm(`Delete "${typ.name}"?`);
    if (!ok) return;
    setErr(null);
    setBusyId(typ.id);
    try {
      await deleteShiftType(householdId, typ.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't delete the shift type.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>Shift types</div>
          <div style={{ fontSize: 12, color: t.text2, marginTop: 4 }}>
            Catalog of shifts you can assign anywhere — template, partner shifts, OT, overrides.
          </div>
        </div>
        <button type="button" onClick={onAdd} style={primaryBtn(palette.G, false)}>+ Add</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, overflow: "auto", padding: "2px 0", flex: 1 }}>
        {types.length === 0 && (
          <div style={{ fontSize: 12, color: t.text3, padding: 12, textAlign: "center" }}>
            No shift types yet. Click + Add to create one.
          </div>
        )}
        {types.map((typ) => {
          const usage = state ? shiftTypeUsage(state, typ.id) : null;
          return (
            <div
              key={typ.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                borderRadius: 8,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>
                  {typ.name}
                </div>
                <div style={{ fontSize: 11.5, color: t.text3, marginTop: 2 }}>
                  {compactTime(typ.start)} → {compactTime(typ.end)}
                  {typ.crossesMidnight && " (next day)"}
                  {typ.sleepHours && typ.sleepHours > 0 ? (
                    <>{" · "}<span style={{ color: "#14201E" }}>+{typ.sleepHours}h sleep</span></>
                  ) : null}
                  {usage && usage.total > 0 && (
                    <>
                      {" · "}
                      <span style={{ color: t.text2 }}>{usage.total} use{usage.total === 1 ? "" : "s"}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onEdit(typ)}
                style={iconBtn(t)}
                aria-label="Edit shift type"
                title="Edit"
              >
                ✎
              </button>
              <button
                type="button"
                onClick={() => onDelete(typ)}
                style={{ ...iconBtn(t), opacity: busyId === typ.id ? 0.5 : 1 }}
                disabled={busyId === typ.id}
                aria-label="Delete shift type"
                title="Delete"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {err && <div style={{ fontSize: 12, color: t.clayText }}>{err}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} style={secondaryBtn(t)}>Done</button>
      </div>
    </>
  );
}

function FormView({
  t,
  palette,
  mode,
  householdId,
  onBack,
}: {
  t: ThemeTokens;
  palette: Palette;
  mode: Extract<Mode, { kind: "add" | "edit" }>;
  householdId: string | null;
  onBack: () => void;
}) {
  const initial = mode.kind === "edit"
    ? mode.initial
    : { name: "", start: "07:00", end: "19:30", sleepHours: 0, preSleepHours: 0 };
  const [name, setName] = useState(initial.name);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [sleepHours, setSleepHours] = useState<number>(initial.sleepHours ?? 0);
  const [preSleepHours, setPreSleepHours] = useState<number>(initial.preSleepHours ?? 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId) {
      setErr("No household linked.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const sleepN = Number.isFinite(sleepHours) ? Math.max(0, sleepHours) : 0;
      const preSleepN = Number.isFinite(preSleepHours) ? Math.max(0, preSleepHours) : 0;
      if (mode.kind === "add") {
        await addShiftType(householdId, { name, start, end, sleepHours: sleepN, preSleepHours: preSleepN });
      } else {
        await updateShiftType(householdId, mode.id, { name, start, end, sleepHours: sleepN, preSleepHours: preSleepN });
      }
      onBack();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the shift type.");
    } finally {
      setBusy(false);
    }
  };

  const crosses = crossesMidnight(start, end);

  return (
    <>
      <div>
        <button type="button" onClick={onBack} style={linkBtn(t)}>← All shift types</button>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 6 }}>
          {mode.kind === "add" ? "New shift type" : "Edit shift type"}
        </div>
      </div>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Name" t={t}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="e.g. Day (12hr)"
            style={inputStyle(t)}
          />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Start" t={t}>
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
              style={inputStyle(t)}
            />
          </Field>
          <Field label="End" t={t}>
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
              style={inputStyle(t)}
            />
          </Field>
        </div>
        <div style={{ fontSize: 11.5, color: t.text3 }}>
          {crosses ? "End time is on the next day (crosses midnight)." : "Same-day shift."}
        </div>
        <Field label="Sleep after (hours)" t={t}>
          <input
            type="number"
            min={0}
            max={24}
            step={0.5}
            value={sleepHours}
            onChange={(e) => setSleepHours(Number(e.target.value))}
            style={inputStyle(t)}
          />
          <div style={{ fontSize: 11.5, color: t.text3, marginTop: 4, lineHeight: 1.4 }}>
            Hours of post-shift sleep. The coverage engine treats this window
            the same as a working shift, so requests get generated when one
            parent is sleeping while the other is working or sleeping too.
            Typical: 0 for day shifts, 6–8 for night shifts.
          </div>
        </Field>
        <Field label="Sleep before (hours)" t={t}>
          <input
            type="number"
            min={0}
            max={24}
            step={0.5}
            value={preSleepHours}
            onChange={(e) => setPreSleepHours(Number(e.target.value))}
            style={inputStyle(t)}
          />
          <div style={{ fontSize: 11.5, color: t.text3, marginTop: 4, lineHeight: 1.4 }}>
            Hours of sleep needed <em>before</em> this shift — a night worker
            sleeps through the day to be up all night. Counted back from when
            they start getting ready, so it covers the first night of a stretch
            (there's no previous shift to recover from). Typical: 0 for day
            shifts, 6–8 for night shifts.
          </div>
        </Field>
        {err && <div style={{ fontSize: 12, color: t.clayText }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" onClick={onBack} style={secondaryBtn(t)} disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy} style={primaryBtn(palette.G, busy)}>
            {busy ? "Saving…" : mode.kind === "add" ? "Add shift type" : "Save"}
          </button>
        </div>
      </form>
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
    background: t.bg,
    border: `0.5px solid ${t.sep}`,
    borderRadius: 8,
    color: t.text,
    fontSize: 13,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
    outline: "none",
    colorScheme: t.scheme === "dark" ? "dark" : "light",
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

function iconBtn(t: ThemeTokens): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    border: `0.5px solid ${t.sep}`,
    background: "transparent",
    color: t.text2,
    borderRadius: 6,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function linkBtn(t: ThemeTokens): React.CSSProperties {
  return {
    background: "transparent",
    border: 0,
    color: t.text2,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
    letterSpacing: "-0.01em",
  };
}
