// Schedule Block modal — block a single day or extended range.
// Renders red diagonal stripes on calendar cells inside the range.

import { useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState, ScheduleBlock } from "../state";
import {
  addScheduleBlock, removeScheduleBlock,
} from "../lib/writeScheduleBlock";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
  defaultDate?: string;       // YYYY-MM-DD — pre-fills the start/end fields
}

const STOP_RED = "#FF453A";

export function ScheduleBlockModal({
  open, onClose, palette, t, dark, householdId, state, defaultDate,
}: Props) {
  const [startDate, setStartDate] = useState(defaultDate ?? isoToday());
  const [endDate, setEndDate]     = useState(defaultDate ?? isoToday());
  const [label, setLabel]         = useState("");
  const [notes, setNotes]         = useState("");
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStartDate(defaultDate ?? isoToday());
    setEndDate(defaultDate ?? isoToday());
    setLabel("");
    setNotes("");
    setErr(null);
  }, [open, defaultDate]);

  if (!open) return null;

  const blocks: ScheduleBlock[] = state?.scheduleBlocks ?? [];

  const onAdd = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    setBusy(true);
    try {
      await addScheduleBlock(householdId, { startDate, endDate, label, notes });
      setLabel(""); setNotes("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!householdId) return;
    setBusy(true);
    try { await removeScheduleBlock(householdId, id); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't delete."); }
    finally { setBusy(false); }
  };

  // Sort by start date desc (most recent / upcoming first)
  const sorted = [...blocks].sort((a, b) => b.startDate.localeCompare(a.startDate));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxHeight: "80vh",
          background: dark ? "#1C1C1E" : "#FFFFFF",
          color: t.text,
          border: `0.5px solid ${t.sep}`,
          borderRadius: 14,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          overflow: "auto",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StopOctagon size={22} />
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Schedule Block
          </div>
          <button
            type="button"
            onClick={onClose}
            style={closeBtnStyle(t)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Add row */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={fieldLabel(t)}>Start date</div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={input(t)}
              />
            </div>
            <div>
              <div style={fieldLabel(t)}>End date</div>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={input(t)}
              />
            </div>
          </div>
          <div>
            <div style={fieldLabel(t)}>Label (optional)</div>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Vacation, Out of town, etc."
              style={input(t)}
            />
          </div>
          <div>
            <div style={fieldLabel(t)}>Notes (optional)</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ ...input(t), resize: "vertical", minHeight: 50, fontFamily: "inherit" }}
            />
          </div>

          {err && <div style={{ fontSize: 12, color: "#FF453A" }}>{err}</div>}

          <button
            type="button"
            onClick={onAdd}
            disabled={busy || !householdId}
            style={{
              alignSelf: "flex-start",
              padding: "9px 16px",
              borderRadius: 8,
              border: 0,
              background: STOP_RED,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
              letterSpacing: "-0.01em",
            }}
          >
            {busy ? "Saving…" : "Add block"}
          </button>
        </div>

        {/* Existing list */}
        {sorted.length > 0 && (
          <>
            <div style={{ height: 1, background: t.sep, opacity: 0.5 }} />
            <div style={fieldLabel(t)}>Existing blocks</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sorted.map((b) => {
                const range = (b.startDate === b.endDate)
                  ? formatHumanDate(b.startDate)
                  : `${formatHumanDate(b.startDate)} → ${formatHumanDate(b.endDate)}`;
                return (
                  <div
                    key={b.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 12px",
                      borderRadius: 10,
                      background: t.bgElev,
                      border: `0.5px solid ${t.sep}`,
                      borderLeft: `3px solid ${STOP_RED}`,
                    }}
                  >
                    <StopOctagon size={14} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>
                        {b.label || "Schedule block"}
                      </div>
                      <div style={{ fontSize: 11, color: t.text3 }}>{range}</div>
                      {b.notes && (
                        <div style={{ fontSize: 11, color: t.text2, marginTop: 2 }}>{b.notes}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onDelete(b.id)}
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
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────── icon ───────────────────
export function StopOctagon({ size = 14, color = STOP_RED }: { size?: number; color?: string }) {
  // Eight-sided polygon, like a US stop sign.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 2 H16 L22 8 V16 L16 22 H8 L2 16 V8 Z"
        fill={color}
      />
    </svg>
  );
}

// ─────────────────── helpers ───────────────────
function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatHumanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m! - 1]} ${d}, ${y}`;
}

function fieldLabel(t: ThemeTokens): React.CSSProperties {
  return {
    fontSize: 10.5, fontWeight: 700,
    color: t.text3,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    marginBottom: 4,
  };
}

function input(t: ThemeTokens): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    border: `0.5px solid ${t.sep}`,
    background: t.bg,
    color: t.text,
    fontSize: 13,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
    outline: "none",
  };
}

function closeBtnStyle(t: ThemeTokens): React.CSSProperties {
  return {
    marginLeft: "auto",
    width: 26, height: 26,
    border: `0.5px solid ${t.sep}`,
    background: "transparent",
    color: t.text2,
    borderRadius: 7,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
