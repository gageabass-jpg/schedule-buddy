// Coverage Requests panel — opened from the View menu (⌘⇧C).
// Lists every coverage request sent to the caregiver, with the shift length
// in hours. Previously lived inside the Family Console.

import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState } from "../state";
import { deleteCoverageRequest, statusLabel } from "../lib/writeCoverageRequest";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
}

export function CoverageRequestsPanel({
  open, onClose, palette, t, dark, householdId, state,
}: Props) {
  if (!open) return null;

  const requests = (state?.coverageRequests ?? [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

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
          width: 520,
          maxHeight: "82vh",
          background: dark ? "#1C1C1E" : "#FFFFFF",
          color: t.text,
          border: `0.5px solid ${t.sep}`,
          borderRadius: 14,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Coverage Requests
          </div>
          <span style={{ fontSize: 13, color: t.text3 }}>({requests.length})</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              marginLeft: "auto",
              width: 26, height: 26,
              borderRadius: 7,
              border: `0.5px solid ${t.sep}`,
              background: "transparent",
              color: t.text3,
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
              lineHeight: 1,
            }}
            aria-label="Close"
          >✕</button>
        </div>

        <div style={{ fontSize: 12, color: t.text3 }}>
          Right-click <em>Overlap</em> in the sidebar to send a new batch to the caregiver.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, overflow: "auto" }}>
          {requests.length === 0 && (
            <div style={{ fontSize: 13, color: t.text3, padding: "20px 2px", textAlign: "center" }}>
              No coverage requests yet.
            </div>
          )}
          {requests.map((req) => {
            const [y, m, d] = req.date.split("-").map(Number);
            const dt = new Date(y, m - 1, d);
            const day = dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
            const time = `${req.startTime} – ${req.endTime}${req.endsNextDay ? " +1d" : ""}`;
            const hours = shiftHours(req.startTime, req.endTime, req.endsNextDay);
            const statusColor =
              req.status === "confirmed" ? "#0F6E64" :
              req.status === "declined"  ? "#8A4B38" :
              req.status === "issue"     ? "#8A4B38" :
              palette.G;
            return (
              <div
                key={req.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 10,
                  background: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                  border: `0.5px solid ${t.sep}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>
                    {day} · {time}
                    <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 600, color: t.text3 }}>
                      {fmtHours(hours)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>
                    {req.arriveBy ? `Arrive by ${req.arriveBy}` : "No arrive-by"}
                    {req.notes ? ` · ${req.notes}` : ""}
                    {req.caregiverNote ? ` · "${req.caregiverNote}"` : ""}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: `${statusColor}22`,
                    color: statusColor,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  {statusLabel(req.status)}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    if (!householdId) return;
                    if (!window.confirm(`Cancel coverage request for ${day}?`)) return;
                    try { await deleteCoverageRequest(householdId, req.id); }
                    catch (e) { window.alert(e instanceof Error ? e.message : "Couldn't cancel."); }
                  }}
                  title="Cancel this request"
                  style={{
                    background: "transparent",
                    border: 0,
                    color: t.text3,
                    fontSize: 14,
                    cursor: "pointer",
                    padding: 4,
                    lineHeight: 1,
                    fontFamily: "inherit",
                  }}
                  aria-label="Cancel request"
                >✕</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────── helpers ───────────────────
/** Length of the coverage window in hours (handles shifts crossing midnight). */
function shiftHours(start: string, end: string, endsNextDay?: boolean): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (endsNextDay || mins < 0) mins += 24 * 60;
  return mins / 60;
}

function fmtHours(h: number): string {
  if (h <= 0) return "—";
  // Trim a trailing .0 but keep .5 etc.
  const rounded = Math.round(h * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label} hr${rounded === 1 ? "" : "s"}`;
}
