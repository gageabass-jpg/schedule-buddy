import { useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState } from "../state";
import type { ShiftMap } from "../data";
import { computeOverlapCandidates, type OverlapCandidate } from "../lib/computeOverlap";
import { addCoverageRequests, type CoverageRequestInput } from "../lib/writeCoverageRequest";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
  shifts: ShiftMap;
}

interface DraftRow extends OverlapCandidate {
  notes: string;
  skipped: boolean;
}

const ARRIVE_BY_OFFSET_MIN = 120;   // caregiver arrives 2 hours before coverage starts

/** "19:00" - 2h → "17:00". Wraps within a 24h clock; the stored HH:MM is
 *  intentionally context-free (no date) — both iOS and the caregiver UI
 *  interpret it relative to the request's date. */
function arriveByFromStart(startTime: string, offsetMin = ARRIVE_BY_OFFSET_MIN): string {
  const [h, m] = startTime.split(":").map(Number);
  const total = ((h || 0) * 60 + (m || 0) - offsetMin + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function CoverageRequestModal({
  open, onClose, palette, t, dark, householdId, state, shifts,
}: Props) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-seed the draft each time the modal opens with the current overlap days.
  useEffect(() => {
    if (!open) return;
    if (!state) { setRows([]); return; }
    const candidates = computeOverlapCandidates(shifts, state);
    setRows(candidates.map((c) => ({ ...c, notes: "", skipped: false })));
    setErr(null);
  }, [open, state, shifts]);

  if (!open) return null;

  const keep = rows.filter((r) => !r.skipped);

  const update = (date: string, patch: Partial<DraftRow>) =>
    setRows((arr) => arr.map((r) => (r.date === date ? { ...r, ...patch } : r)));

  const onSend = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    if (keep.length === 0) { setErr("Every day is skipped."); return; }
    setErr(null);
    setBusy(true);
    try {
      const inputs: CoverageRequestInput[] = keep.map((r) => ({
        date: r.date,
        startTime: r.startTime,
        endTime: r.endTime,
        endsNextDay: r.endsNextDay,
        arriveBy: arriveByFromStart(r.startTime),
        notes: r.notes || undefined,
      }));
      await addCoverageRequests(householdId, inputs);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send the requests.");
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
        aria-label="Send coverage to caregiver"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(720px, calc(100vw - 32px))",
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
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>Send to caregiver</div>
            <div style={{ fontSize: 12, color: t.text2, marginTop: 4, lineHeight: 1.45 }}>
              Every day where both of you are working at the same time. Review windows, add an arrive-early time or notes, then send the batch.
            </div>
          </div>
          <div style={{ fontSize: 11, color: t.text3, fontWeight: 600 }}>
            {keep.length} of {rows.length} ready
          </div>
        </div>

        <div
          style={{
            marginTop: 12,
            flex: 1,
            overflow: "auto",
            border: `0.5px solid ${t.sep}`,
            borderRadius: 8,
            minHeight: 200,
          }}
        >
          {rows.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: t.text3, fontSize: 13 }}>
              No overlap days in the current window. Add some shifts or expand the visible range.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)" }}>
                  <Th>Date</Th>
                  <Th>Coverage window</Th>
                  <Th>Notes</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const [y, m, d] = r.date.split("-").map(Number);
                  const dt = new Date(y, m - 1, d);
                  const dayLabel = dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                  return (
                    <tr key={r.date} style={{ opacity: r.skipped ? 0.4 : 1 }}>
                      <Td t={t}>
                        <div style={{ fontWeight: 600 }}>{dayLabel}</div>
                        <div style={{ fontSize: 10.5, color: t.text3 }}>{r.date}</div>
                      </Td>
                      <Td t={t}>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <input
                            type="time"
                            value={r.startTime}
                            onChange={(e) => update(r.date, { startTime: e.target.value })}
                            style={tdInput(t)}
                          />
                          <span style={{ color: t.text3 }}>→</span>
                          <input
                            type="time"
                            value={r.endTime}
                            onChange={(e) => update(r.date, { endTime: e.target.value })}
                            style={tdInput(t)}
                          />
                          {r.endsNextDay && (
                            <span style={{ fontSize: 10, color: t.text3, fontWeight: 600 }}>+1d</span>
                          )}
                        </div>
                        <div style={{ fontSize: 10.5, color: t.text3, marginTop: 2 }}>
                          {r.label}<span style={{ marginLeft: 8 }}>· arrives by {arriveByFromStart(r.startTime)}</span>
                        </div>
                      </Td>
                      <Td t={t}>
                        <input
                          type="text"
                          value={r.notes}
                          onChange={(e) => update(r.date, { notes: e.target.value })}
                          placeholder="e.g. dinner ready in fridge"
                          style={{ ...tdInput(t), width: "100%" }}
                        />
                      </Td>
                      <Td t={t}>
                        <button
                          type="button"
                          onClick={() => update(r.date, { skipped: !r.skipped })}
                          style={{
                            border: 0,
                            background: "transparent",
                            color: t.text3,
                            cursor: "pointer",
                            fontSize: 12,
                            fontFamily: "inherit",
                          }}
                        >
                          {r.skipped ? "Include" : "Skip"}
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {err && <div style={{ fontSize: 12, color: "#FF453A", marginTop: 8 }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" onClick={onClose} disabled={busy} style={secondaryBtn(t)}>Cancel</button>
          <button
            type="button"
            onClick={onSend}
            disabled={busy || keep.length === 0}
            style={primaryBtn(palette.G, busy || keep.length === 0)}
          >
            {busy ? "Sending…" : `Send ${keep.length} request${keep.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th style={{
      textAlign: "left",
      padding: "8px 10px",
      fontSize: 10.5,
      fontWeight: 700,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "rgba(235,235,245,0.5)",
    }}>{children}</th>
  );
}

function Td({ children, t }: { children: React.ReactNode; t: ThemeTokens }) {
  return <td style={{ padding: "6px 10px", borderTop: `0.5px solid ${t.sep}`, verticalAlign: "top" }}>{children}</td>;
}

function tdInput(t: ThemeTokens): React.CSSProperties {
  return {
    padding: "4px 6px",
    background: t.bg,
    border: `0.5px solid ${t.sep}`,
    borderRadius: 5,
    color: t.text,
    fontSize: 12,
    fontFamily: "inherit",
    outline: "none",
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
