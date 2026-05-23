// Occasions — birthdays, anniversaries, holidays. Drives the wall
// display's hero-line flair ("Daisy's birthday today!").
//
// Paydays aren't managed here — they're auto-computed from each
// person's payday schedule (managed in the Paydays section).

import { useCallback, useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState, OccasionEntry, OccasionType } from "../state";
import { addOccasion, removeOccasion } from "../lib/writeOccasions";

interface Props {
  householdId: string | null;
  state: HouseholdState | null;
  t: ThemeTokens;
  palette: Palette;
}

const TYPE_LABELS: Record<OccasionType, string> = {
  birthday:    "Birthday",
  anniversary: "Anniversary",
  holiday:     "Holiday",
};
const TYPE_COLORS: Record<OccasionType, string> = {
  birthday:    "#D08B7E",
  anniversary: "#9B89C9",
  holiday:     "#7FA86A",
};

export function OccasionsSection({ householdId, state, t, palette }: Props) {
  const [date, setDate]   = useState(() => isoToday());
  const [label, setLabel] = useState("");
  const [type, setType]   = useState<OccasionType>("birthday");
  const [annual, setAnnual] = useState(true);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  const occasions: OccasionEntry[] = state?.occasions ?? [];

  const reset = useCallback(() => {
    setDate(isoToday());
    setLabel("");
    setType("birthday");
    setAnnual(true);
  }, []);

  const onAdd = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    if (!label.trim()) { setErr("Add a label."); return; }
    setErr(null);
    setBusy(true);
    try {
      await addOccasion(householdId, { date, label, type, annual });
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add.");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!householdId) return;
    setBusy(true);
    try { await removeOccasion(householdId, id); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't delete."); }
    finally { setBusy(false); }
  };

  // Sort by next upcoming occurrence — annual ones get projected onto
  // the current year (or next year if already past) so they sort sensibly.
  const sorted = [...occasions].sort((a, b) => nextOccurrence(a).localeCompare(nextOccurrence(b)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Add row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto auto",
          gap: 8,
          alignItems: "center",
        }}
      >
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={inputStyle(t)}
        />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Daisy's birthday"
          style={inputStyle(t)}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as OccasionType)}
          style={{ ...inputStyle(t), padding: "8px 10px" }}
        >
          {(Object.keys(TYPE_LABELS) as OccasionType[]).map((k) => (
            <option key={k} value={k}>{TYPE_LABELS[k]}</option>
          ))}
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: t.text2, whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={annual}
            onChange={(e) => setAnnual(e.target.checked)}
            style={{ accentColor: palette.G }}
          />
          Annual
        </label>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={busy || !householdId || !label.trim()}
        style={{
          alignSelf: "flex-start",
          padding: "8px 16px",
          borderRadius: 8,
          border: 0,
          background: palette.G,
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: busy || !label.trim() ? "default" : "pointer",
          opacity: busy || !label.trim() ? 0.5 : 1,
          letterSpacing: "-0.01em",
        }}
      >
        {busy ? "Saving…" : "Add occasion"}
      </button>

      {err && <div style={{ fontSize: 12, color: "#FF453A" }}>{err}</div>}

      {/* Existing list */}
      {sorted.length === 0 ? (
        <div style={{ fontSize: 12, color: t.text3, padding: "4px 2px" }}>
          No occasions yet. Add birthdays and anniversaries here — they'll show on the wall display's greeting line when they come up.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sorted.map((o) => {
            const color = TYPE_COLORS[o.type];
            const niceDate = formatHumanDate(o.date, o.annual);
            return (
              <div
                key={o.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 10,
                  background: t.bgElev,
                  border: `0.5px solid ${t.sep}`,
                  borderLeft: `3px solid ${color}`,
                }}
              >
                <span
                  style={{
                    fontSize: 9.5, fontWeight: 700,
                    padding: "2px 7px", borderRadius: 999,
                    background: `${color}2E`,
                    color,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  {TYPE_LABELS[o.type]}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>
                    {o.label}
                  </div>
                  <div style={{ fontSize: 11, color: t.text3 }}>
                    {niceDate}{o.annual ? " · repeats yearly" : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(o.id)}
                  disabled={busy}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 7,
                    border: `0.5px solid ${t.sep}`,
                    background: "transparent",
                    color: "#FF453A",
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    letterSpacing: "-0.01em",
                  }}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function inputStyle(t: ThemeTokens): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 8,
    border: `0.5px solid ${t.sep}`,
    background: t.bg,
    color: t.text,
    fontSize: 13,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
    outline: "none",
    minWidth: 0,
  };
}

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// For sorting: project annual events onto the current year (or next
// year if already past). Non-annual events return their literal date.
function nextOccurrence(o: OccasionEntry): string {
  if (!o.annual) return o.date;
  const today = isoToday();
  const mmDd = o.date.slice(5);
  const yyyy = today.slice(0, 4);
  const projected = `${yyyy}-${mmDd}`;
  if (projected >= today) return projected;
  return `${Number(yyyy) + 1}-${mmDd}`;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function formatHumanDate(iso: string, annual?: boolean): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (annual) return `${MONTHS[m! - 1]} ${d}`;       // "August 12"
  return `${MONTHS[m! - 1]} ${d}, ${y}`;             // "August 12, 2026"
}
