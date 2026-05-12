import { useMemo, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { CoverageRequest, CoverageStatus, HouseholdState } from "../state";
import { deleteCoverageRequest, statusLabel } from "../lib/writeCoverageRequest";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
  onSendCoverage: () => void;
}

type Filter = "all" | CoverageStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "pending",   label: "Pending" },
  { key: "confirmed", label: "Accepted" },
  { key: "declined",  label: "Declined" },
  { key: "issue",     label: "Issue" },
];

function statusColor(s: CoverageStatus): string {
  if (s === "confirmed") return "#30D158";
  if (s === "declined")  return "#FF453A";
  if (s === "issue")     return "#FF9F0A";
  return "#5E5CE6";  // pending
}

function reasonLabel(r: CoverageRequest["reason"]): string {
  if (r === "both-working")   return "Both working";
  if (r === "work-and-sleep") return "Work + sleep";
  if (r === "both-sleeping")  return "Both sleeping";
  return "Coverage";
}

function reasonColor(r: CoverageRequest["reason"], palette: Palette): string {
  if (r === "both-working")   return palette.G;
  if (r === "work-and-sleep") return "#FF9F0A";
  if (r === "both-sleeping")  return "#5E5CE6";
  return palette.G;
}

function friendlyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

export function ChildcarePanel({
  open, onClose, palette, t, dark, householdId, state, onSendCoverage,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const requests = state?.coverageRequests ?? [];

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: requests.length, pending: 0, confirmed: 0, declined: 0, issue: 0 };
    for (const r of requests) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [requests]);

  const filtered = useMemo(() => {
    const list = filter === "all" ? requests : requests.filter((r) => r.status === filter);
    return [...list].sort((a, b) => a.date.localeCompare(b.date));
  }, [requests, filter]);

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Childcare coverage"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(760px, calc(100vw - 32px))",
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>Childcare coverage</div>
            <div style={{ fontSize: 12, color: t.text2, marginTop: 4, lineHeight: 1.45 }}>
              Every request you've sent — pending, accepted, declined, or flagged. Caregiver notes show inline.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => { onClose(); onSendCoverage(); }}
              style={primaryBtn(palette.G, false)}
            >
              + New batch
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{ background: "transparent", border: 0, color: t.text2, fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1, fontFamily: "inherit" }}
              aria-label="Close"
            >✕</button>
          </div>
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                style={{
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: `0.5px solid ${active ? "transparent" : t.sep}`,
                  background: active ? (f.key === "all" ? t.text2 : statusColor(f.key as CoverageStatus)) : "transparent",
                  color: active ? "#fff" : t.text2,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "-0.01em",
                }}
              >
                {f.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{counts[f.key] ?? 0}</span>
              </button>
            );
          })}
        </div>

        {/* List */}
        <div
          style={{
            marginTop: 14,
            flex: 1,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 240,
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: t.text3, fontSize: 13 }}>
              {filter === "all"
                ? "No coverage requests yet. Right-click Overlap in the sidebar to send a batch."
                : `No ${filter} requests.`}
            </div>
          ) : (
            filtered.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                  border: `0.5px solid ${t.sep}`,
                  borderLeft: `3px solid ${statusColor(r.status)}`,
                  opacity: busyId === r.id ? 0.5 : 1,
                }}
              >
                <div style={{ minWidth: 120 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text, letterSpacing: "-0.01em" }}>
                    {friendlyDate(r.date)}
                  </div>
                  <div style={{ fontSize: 11, color: t.text3, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                    {r.startTime} → {r.endTime}{r.endsNextDay ? " +1d" : ""}
                  </div>
                </div>

                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: `${statusColor(r.status)}22`,
                        color: statusColor(r.status),
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                      }}
                    >
                      {statusLabel(r.status)}
                    </span>
                    {r.reason && (
                      <span style={{ fontSize: 10.5, color: reasonColor(r.reason, palette), fontWeight: 600 }}>
                        · {reasonLabel(r.reason)}
                      </span>
                    )}
                    {r.arriveBy && (
                      <span style={{ fontSize: 10.5, color: t.text3 }}>· arrive by {r.arriveBy}</span>
                    )}
                  </div>
                  {r.notes && (
                    <div style={{ fontSize: 12, color: t.text2, lineHeight: 1.4 }}>{r.notes}</div>
                  )}
                  {r.caregiverNote && (
                    <div
                      style={{
                        fontSize: 12,
                        color: t.text2,
                        lineHeight: 1.4,
                        background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                        padding: "6px 8px",
                        borderRadius: 6,
                        fontStyle: "italic",
                      }}
                    >
                      <b style={{ fontStyle: "normal", color: t.text }}>
                        {r.status === "declined" ? "Caregiver said:" :
                         r.status === "issue"    ? "Caregiver reported:" :
                                                    "Caregiver noted:"}
                      </b>{" "}
                      {r.caregiverNote}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  title="Delete this request"
                  disabled={busyId === r.id}
                  onClick={async () => {
                    if (!householdId) return;
                    if (!window.confirm(`Delete coverage request for ${friendlyDate(r.date)}?`)) return;
                    setBusyId(r.id);
                    try { await deleteCoverageRequest(householdId, r.id); }
                    catch (e) { window.alert(e instanceof Error ? e.message : "Couldn't delete."); }
                    finally { setBusyId(null); }
                  }}
                  style={{
                    background: "transparent",
                    border: 0,
                    color: t.text3,
                    fontSize: 16,
                    cursor: busyId === r.id ? "wait" : "pointer",
                    padding: 4,
                    lineHeight: 1,
                    fontFamily: "inherit",
                    alignSelf: "center",
                  }}
                  aria-label="Delete"
                >✕</button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function primaryBtn(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 12px",
    border: 0,
    borderRadius: 8,
    background: color,
    color: "#fff",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
  };
}
