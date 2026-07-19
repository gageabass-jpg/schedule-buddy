import { useEffect, useMemo, useRef, useState } from "react";
import { MANAGER_ORANGE, type Palette, type ThemeTokens } from "../theme";
import type { CoverageRequest, CoverageStatus, HouseholdState } from "../state";
import { deleteCoverageRequest, markCoverageReviewed, statusLabel } from "../lib/writeCoverageRequest";
import { auth } from "../firebase";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
  onSendBatch: () => void;
  onSendSingle: () => void;
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
  open, onClose, palette, t, dark, householdId, state, onSendBatch, onSendSingle,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  // Land on the current month by default; toggle off to see all history.
  const [monthOnly, setMonthOnly] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside to close the dropdown.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const requests = state?.coverageRequests ?? [];

  // "YYYY-MM" for today. Coverage dates are ISO, so a prefix match scopes to
  // the current calendar month. Recomputed each time the panel opens so a
  // long-running app doesn't get stuck on last month.
  const monthPrefix = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, [open]);

  // Narrow to the current month before the status filter, so the pill counts
  // always describe what's actually in the list.
  const scoped = useMemo(
    () => (monthOnly ? requests.filter((r) => r.date.startsWith(monthPrefix)) : requests),
    [requests, monthOnly, monthPrefix],
  );

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: scoped.length, pending: 0, confirmed: 0, declined: 0, issue: 0 };
    for (const r of scoped) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [scoped]);

  const filtered = useMemo(() => {
    const list = filter === "all" ? scoped : scoped.filter((r) => r.status === filter);
    return [...list].sort((a, b) => a.date.localeCompare(b.date));
  }, [scoped, filter]);

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
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div ref={menuRef} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                style={primaryBtn(palette.G, false)}
              >
                + New Request
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: 6,
                    minWidth: 220,
                    background: t.bgElev,
                    color: t.text,
                    border: `0.5px solid ${t.sep}`,
                    borderRadius: 10,
                    boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
                    padding: 4,
                    zIndex: 10,
                  }}
                >
                  <MenuItem
                    label="Single request"
                    hint="One date — date night, an appointment"
                    t={t}
                    onClick={() => { setMenuOpen(false); onClose(); onSendSingle(); }}
                  />
                  <MenuItem
                    label="Batch request"
                    hint="Every shift-overlap day in the window"
                    t={t}
                    onClick={() => { setMenuOpen(false); onClose(); onSendBatch(); }}
                  />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{ background: "transparent", border: 0, color: t.text2, fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1, fontFamily: "inherit" }}
              aria-label="Close"
            >✕</button>
          </div>
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
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

          {/* Separate axis from the status pills — narrows everything above to
              the current month. */}
          <span style={{ width: 1, alignSelf: "stretch", background: t.sep, margin: "0 3px" }} />
          <button
            type="button"
            onClick={() => setMonthOnly((v) => !v)}
            aria-pressed={monthOnly}
            title={monthOnly
              ? "Showing only this month — click to include every request"
              : "Show only this month's requests"}
            style={{
              padding: "5px 10px",
              borderRadius: 999,
              border: `0.5px solid ${monthOnly ? "transparent" : t.sep}`,
              background: monthOnly ? MANAGER_ORANGE : "transparent",
              color: monthOnly ? "#fff" : t.text2,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "-0.01em",
            }}
          >
            This month
          </button>
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
                ? (monthOnly
                    ? "No coverage requests this month. Turn off “This month” to see everything."
                    : "No coverage requests yet. Right-click Overlap in the sidebar to send a batch.")
                : `No ${filter} requests${monthOnly ? " this month" : ""}.`}
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
                    {r.proposedChange && (
                      <span
                        title={`Waiting on the caregiver to approve ${r.proposedChange.startTime} → ${r.proposedChange.endTime}`}
                        style={{
                          fontSize: 10, fontWeight: 700,
                          padding: "2px 7px", borderRadius: 999,
                          background: "rgba(94,92,230,0.18)", color: "#5E5CE6",
                          letterSpacing: "0.04em", textTransform: "uppercase",
                        }}
                      >
                        change sent · {r.proposedChange.startTime}–{r.proposedChange.endTime}
                      </span>
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

                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  {(r.status === "declined" || r.status === "issue") && !r.managerReviewed && (
                    <button
                      type="button"
                      title="Mark this response as reviewed — drops it off the caregiver's schedule."
                      disabled={busyId === r.id}
                      onClick={async () => {
                        if (!householdId) return;
                        setBusyId(r.id);
                        try { await markCoverageReviewed(householdId, r.id, auth.currentUser?.uid ?? null); }
                        catch (e) { window.alert(e instanceof Error ? e.message : "Couldn't mark reviewed."); }
                        finally { setBusyId(null); }
                      }}
                      style={{
                        background: "transparent",
                        border: `0.5px solid ${t.sep}`,
                        borderRadius: 6,
                        color: t.text2,
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: busyId === r.id ? "wait" : "pointer",
                        padding: "3px 8px",
                        fontFamily: "inherit",
                        letterSpacing: "-0.01em",
                      }}
                    >Clear</button>
                  )}
                  {(r.status === "declined" || r.status === "issue") && r.managerReviewed && (
                    <span style={{ fontSize: 10.5, color: t.text3, fontWeight: 500 }}>Reviewed</span>
                  )}
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
                    }}
                    aria-label="Delete"
                  >✕</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function MenuItem({
  label, hint, t, onClick,
}: { label: string; hint?: string; t: ThemeTokens; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        borderRadius: 6,
        border: 0,
        background: "transparent",
        color: t.text,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(127,127,127,0.12)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{hint}</div>}
    </button>
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
    whiteSpace: "nowrap",
  };
}
