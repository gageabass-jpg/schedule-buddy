import { useEffect, useMemo, useRef, useState } from "react";
import { MANAGER_ORANGE, rgba, BRAND_FONT, type Palette, type ThemeTokens } from "../theme";
import type { CoverageRequest, CoverageStatus, HouseholdState } from "../state";
import { deleteCoverageRequest, markCoverageReviewed, statusLabel } from "../lib/writeCoverageRequest";
import { hmToMin, daisyCoverageConflict, type MinuteRange } from "../lib/computeOverlap";
import { timelineForDate } from "../lib/timelineData";
import { DayTimeline } from "./DayTimeline";
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

const STATUS_OPTIONS: { key: Filter; label: string }[] = [
  { key: "all",       label: "All statuses" },
  { key: "pending",   label: "Pending" },
  { key: "confirmed", label: "Accepted" },
  { key: "declined",  label: "Declined" },
  { key: "issue",     label: "Issue" },
];

/** Badge palette per status: [fg, tint-alpha-base]. Green/amber/red read in
 *  both themes; the tint is derived from the fg so light matches the handoff
 *  and dark just deepens it. */
function statusColor(s: CoverageStatus): string {
  if (s === "confirmed") return "#0F6E64";
  if (s === "declined")  return "#8A4B38";
  if (s === "issue")     return "#8A4B38";
  return "#8A4B38"; // pending
}
function statusBadgeLabel(s: CoverageStatus): string {
  return s === "confirmed" ? "CONFIRMED" : statusLabel(s).toUpperCase();
}

/** A Daisy school range → "8a–3p". */
function schoolLabel(r: MinuteRange): string {
  const f = (m: number) => {
    const mm = ((m % 1440) + 1440) % 1440;
    let h = Math.floor(mm / 60); const min = mm % 60;
    const ap = h < 12 ? "a" : "p"; h = h % 12 || 12;
    return min ? `${h}:${String(min).padStart(2, "0")}${ap}` : `${h}${ap}`;
  };
  return `${f(r.startMin)}–${f(r.endMin)}`;
}

function reasonLabel(r: CoverageRequest["reason"]): string {
  if (r === "both-working")   return "Both working";
  if (r === "work-and-sleep") return "Work + sleep";
  if (r === "both-sleeping")  return "Both sleeping";
  return "Coverage";
}
/** Type-tag colors: blue for both-working, amber for work+sleep. */
function reasonColor(r: CoverageRequest["reason"]): string {
  if (r === "work-and-sleep") return "#8A4B38";
  if (r === "both-sleeping")  return "#14201E";
  return "#0F6E64";
}

function durationHours(startTime: string, endTime: string, endsNextDay?: boolean): string {
  const mins = hmToMin(endTime, endsNextDay) - hmToMin(startTime);
  const h = mins / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

export function ChildcarePanel({
  open, onClose, palette, t, dark, householdId, state, onSendBatch, onSendSingle,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);   // expanded row id
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement | null>(null);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const monthMenuRef = useRef<HTMLDivElement | null>(null);

  useClickOutside(newMenuRef, newMenuOpen, () => setNewMenuOpen(false));
  useClickOutside(statusMenuRef, statusMenuOpen, () => setStatusMenuOpen(false));
  useClickOutside(monthMenuRef, monthMenuOpen, () => setMonthMenuOpen(false));

  const selfName = state?.selfName || "You";
  const partnerName = state?.partner?.name || "Kaylene";
  const daisyName = state?.dependents?.daisy?.name || "Daisy";
  const requests = state?.coverageRequests ?? [];

  const monthPrefix = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, [open]);

  const [month, setMonth] = useState<string>(monthPrefix);
  useEffect(() => { if (open) setMonth(monthPrefix); }, [open, monthPrefix]);

  const monthKeys = useMemo(() => {
    const keys = new Set(requests.map((r) => (r.date || "").slice(0, 7)).filter(Boolean));
    return [...keys].sort().reverse();
  }, [requests]);

  const effectiveMonth = (month !== "all" && monthKeys.length > 0 && !monthKeys.includes(month))
    ? "all"
    : month;

  const multiYear = useMemo(() => new Set(monthKeys.map((k) => k.slice(0, 4))).size > 1, [monthKeys]);
  const monthLabel = (k: string): string => {
    if (k === "all") return "YTD";
    const [yy, mm] = k.split("-").map(Number);
    const name = new Date(yy, (mm || 1) - 1, 1).toLocaleDateString(undefined, { month: "long" });
    return multiYear ? `${name} ${yy}` : name;
  };

  const scoped = useMemo(
    () => (effectiveMonth === "all" ? requests : requests.filter((r) => r.date.startsWith(effectiveMonth))),
    [requests, effectiveMonth],
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

  const statusTriggerLabel = STATUS_OPTIONS.find((o) => o.key === filter)?.label ?? "All statuses";

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assigned shifts"
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: "min(640px, calc(100vw - 32px))", maxHeight: "calc(100vh - 64px)",
          background: dark ? t.bgElev : "#F7F6F3", color: t.text,
          borderRadius: 22, boxShadow: "0 30px 80px rgba(0,0,0,0.4)",
          zIndex: 1101, fontFamily: "inherit", display: "flex", flexDirection: "column",
          // visible (not hidden) so the "New Request" dropdown can spill past
          // the dialog edge instead of being clipped. The list below owns its
          // own scroll clipping, so nothing else leaks.
          overflow: "visible",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "24px 24px 16px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: t.text3 }}>
              Childcare coverage
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", color: t.text, marginTop: 3, fontFamily: BRAND_FONT }}>
              Assigned shifts
            </div>
            <div style={{ fontSize: 13, color: t.text2, marginTop: 5, lineHeight: 1.45, maxWidth: 360 }}>
              Every request you've sent — pending, accepted, declined, or flagged. Caregiver notes show inline.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
            <div ref={newMenuRef} style={{ position: "relative" }}>
              <button type="button" onClick={() => setNewMenuOpen((v) => !v)} style={greenBtn}>+ New Request</button>
              {newMenuOpen && (
                <Menu t={t} dark={dark}>
                  <MenuItem label="Single request" hint="One date — date night, an appointment" t={t}
                    onClick={() => { setNewMenuOpen(false); onClose(); onSendSingle(); }} />
                  <MenuItem label="Batch request" hint="Every uncovered day, today forward" t={t}
                    onClick={() => { setNewMenuOpen(false); onClose(); onSendBatch(); }} />
                </Menu>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              style={{ width: 34, height: 34, borderRadius: "50%", border: 0, background: dark ? "rgba(255,255,255,0.08)" : "#EFEDE7", color: t.text3, fontSize: 16, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
              ✕
            </button>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, padding: "0 24px 14px" }}>
          <div ref={statusMenuRef} style={{ position: "relative" }}>
            <button type="button" onClick={() => { setStatusMenuOpen((v) => !v); setMonthMenuOpen(false); }} style={filterTrigger(t, dark)}>
              {statusTriggerLabel} <span style={{ color: t.text3, fontSize: 10 }}>▾</span>
            </button>
            {statusMenuOpen && (
              <Menu t={t} dark={dark} minWidth={190}>
                {STATUS_OPTIONS.map((o) => (
                  <FilterItem key={o.key} label={o.label} count={counts[o.key]} active={o.key === filter} t={t}
                    onClick={() => { setFilter(o.key); setStatusMenuOpen(false); }} />
                ))}
              </Menu>
            )}
          </div>
          <div ref={monthMenuRef} style={{ position: "relative" }}>
            <button type="button" onClick={() => { setMonthMenuOpen((v) => !v); setStatusMenuOpen(false); }} style={filterTrigger(t, dark)}>
              {monthLabel(effectiveMonth)} <span style={{ color: t.text3, fontSize: 10 }}>▾</span>
            </button>
            {monthMenuOpen && (
              <Menu t={t} dark={dark} minWidth={150}>
                {["all", ...monthKeys].map((k) => (
                  <FilterItem key={k} label={monthLabel(k)} active={k === effectiveMonth} t={t} accent={MANAGER_ORANGE}
                    onClick={() => { setMonth(k); setMonthMenuOpen(false); }} />
                ))}
              </Menu>
            )}
          </div>
        </div>

        {/* List */}
        <div style={{ padding: "0 20px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: t.text3, fontSize: 13 }}>
              {requests.length === 0
                ? "No coverage requests yet. Right-click Overlap in the sidebar to send a batch."
                : filter === "all"
                  ? `No coverage requests in ${monthLabel(effectiveMonth)}. Switch to YTD to see everything.`
                  : `No ${filter} requests in ${monthLabel(effectiveMonth)}.`}
            </div>
          ) : filtered.map((r) => {
            const sc = statusColor(r.status);
            const [, mm, dd] = r.date.split("-").map(Number);
            const monthAbbr = new Date(2000, (mm || 1) - 1, 1).toLocaleDateString(undefined, { month: "short" }).toUpperCase();
            const isOpen = openDay === r.id;
            return (
              <div key={r.id} style={{ opacity: busyId === r.id ? 0.5 : 1 }}>
                <div
                  onClick={() => setOpenDay(isOpen ? null : r.id)}
                  style={{
                    display: "flex", alignItems: "stretch", minHeight: 92, cursor: "pointer",
                    background: dark ? "rgba(255,255,255,0.04)" : "#fff",
                    borderRadius: 18, overflow: "hidden", boxShadow: dark ? "none" : "0 1px 3px rgba(0,0,0,0.05)",
                    border: dark ? `0.5px solid ${t.sep}` : "none",
                  }}
                >
                  <div style={{ width: 5, background: sc, flexShrink: 0 }} />
                  {/* Date block */}
                  <div style={{ width: 78, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.5px", color: "#8A4B38" }}>{monthAbbr}</div>
                    <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-1.5px", color: t.text, lineHeight: 1 }}>{dd}</div>
                  </div>
                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, padding: "10px 6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: t.text, fontVariantNumeric: "tabular-nums" }}>
                      {r.startTime} <span style={{ color: t.text3 }}>→</span> {r.endTime}{r.endsNextDay ? <span style={{ fontSize: 11, color: t.text3 }}>+1d</span> : null}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.6px", padding: "4px 9px", borderRadius: 20, background: rgba(sc, dark ? 0.22 : 0.14), color: sc }}>
                        {statusBadgeLabel(r.status)}
                      </span>
                      {r.reason && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "4px 9px", borderRadius: 20, background: rgba(reasonColor(r.reason), dark ? 0.22 : 0.12), color: reasonColor(r.reason) }}>
                          {reasonLabel(r.reason)}
                        </span>
                      )}
                      {r.arriveBy && <span style={{ fontSize: 10.5, color: t.text3 }}>· arrive by {r.arriveBy}</span>}
                      {r.proposedChange && (
                        <span title={`Waiting on the caregiver to approve ${r.proposedChange.startTime} → ${r.proposedChange.endTime}`}
                          style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: rgba("#14201E", dark ? 0.24 : 0.14), color: "#14201E", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                          change sent · {r.proposedChange.startTime}–{r.proposedChange.endTime}
                        </span>
                      )}
                    </div>
                    {(() => {
                      const clash = state ? daisyCoverageConflict(state, r.date, r.startTime, r.endTime, r.endsNextDay) : null;
                      return clash ? (
                        <div style={{ fontSize: 11.5, fontWeight: 600, color: "#8A4B38", display: "flex", alignItems: "center", gap: 5 }}>
                          ⚠ {daisyName} has class {schoolLabel(clash)} — may not be able to cover
                        </div>
                      ) : null;
                    })()}
                    {r.notes && <div style={{ fontSize: 12, color: t.text2, lineHeight: 1.4 }}>{r.notes}</div>}
                    {r.caregiverNote && (
                      <div style={{ fontSize: 12, color: t.text2, lineHeight: 1.4, background: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", padding: "6px 8px", borderRadius: 8, fontStyle: "italic" }}>
                        <b style={{ fontStyle: "normal", color: t.text }}>
                          {r.status === "declined" ? "Caregiver said:" : r.status === "issue" ? "Caregiver reported:" : "Caregiver noted:"}
                        </b>{" "}{r.caregiverNote}
                      </div>
                    )}
                    {(r.status === "declined" || r.status === "issue") && (
                      r.managerReviewed ? (
                        <span style={{ fontSize: 10.5, color: t.text3 }}>Reviewed</span>
                      ) : (
                        <button type="button" disabled={busyId === r.id}
                          title="Mark this response as reviewed — drops it off the caregiver's schedule."
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!householdId) return;
                            setBusyId(r.id);
                            try { await markCoverageReviewed(householdId, r.id, auth.currentUser?.uid ?? null); }
                            catch (err) { window.alert(err instanceof Error ? err.message : "Couldn't mark reviewed."); }
                            finally { setBusyId(null); }
                          }}
                          style={{ alignSelf: "flex-start", background: "transparent", border: `0.5px solid ${t.sep}`, borderRadius: 7, color: t.text2, fontSize: 11.5, fontWeight: 600, cursor: "pointer", padding: "3px 9px", fontFamily: "inherit" }}>
                          Clear
                        </button>
                      )
                    )}
                  </div>
                  {/* Hours */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 8px", flexShrink: 0 }}>
                    <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.8px", color: dark ? "#56B7A9" : "#0F6E64", lineHeight: 1 }}>
                      {durationHours(r.startTime, r.endTime, r.endsNextDay)}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", color: dark ? "#56B7A9" : "#0F6E64" }}>HOURS</div>
                  </div>
                  {/* Delete */}
                  <div style={{ width: 44, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <button type="button" aria-label="Delete" disabled={busyId === r.id}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!householdId) return;
                        if (!window.confirm(`Delete coverage request for ${r.date}?`)) return;
                        setBusyId(r.id);
                        try { await deleteCoverageRequest(householdId, r.id); }
                        catch (err) { window.alert(err instanceof Error ? err.message : "Couldn't delete."); }
                        finally { setBusyId(null); }
                      }}
                      style={{ background: "transparent", border: 0, cursor: "pointer", padding: 4, lineHeight: 0 }}>
                      <TrashIcon />
                    </button>
                  </div>
                </div>
                {isOpen && (() => {
                  const tl = timelineForDate(state, r.date, r);
                  return (
                    <DayTimeline date={r.date} self={tl.self} partner={tl.partner}
                      coverage={tl.coverage} daisy={tl.daisy} daisyName={daisyName}
                      selfName={selfName} partnerName={partnerName}
                      palette={palette} t={t} dark={dark} />
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────

function useClickOutside(ref: React.RefObject<HTMLElement | null>, active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return;
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [active, ref, close]);
}

const greenBtn: React.CSSProperties = {
  padding: "10px 16px", border: 0, borderRadius: 14, background: "#0F6E64", color: "#fff",
  fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  boxShadow: "0 4px 14px rgba(15,110,100,0.35)",
};

function filterTrigger(t: ThemeTokens, dark: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 14,
    border: `1px solid ${t.sep}`, background: dark ? "rgba(255,255,255,0.05)" : "#fff",
    color: t.text, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  };
}

function Menu({ children, t, dark, minWidth = 220 }: { children: React.ReactNode; t: ThemeTokens; dark: boolean; minWidth?: number }) {
  return (
    <div role="menu" style={{
      position: "absolute", top: "100%", left: 0, marginTop: 6, minWidth, maxHeight: 280, overflowY: "auto",
      background: dark ? t.bgElev : "#fff", color: t.text, border: `1px solid ${t.sep}`, borderRadius: 14,
      boxShadow: "0 12px 34px rgba(0,0,0,0.28)", padding: 4, zIndex: 20,
    }}>
      {children}
    </div>
  );
}

function MenuItem({ label, hint, t, onClick }: { label: string; hint?: string; t: ThemeTokens; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} onMouseDown={(e) => e.preventDefault()}
      style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", borderRadius: 10, border: 0, background: "transparent", color: t.text, cursor: "pointer", fontFamily: "inherit" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(127,127,127,0.12)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
      <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>{label}</div>
      {hint && <div style={{ fontSize: 11.5, color: t.text3, marginTop: 2 }}>{hint}</div>}
    </button>
  );
}

function FilterItem({ label, count, active, t, accent = "#0F6E64", onClick }: {
  label: string; count?: number; active: boolean; t: ThemeTokens; accent?: string; onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick} onMouseDown={(e) => e.preventDefault()}
      style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderRadius: 10, border: 0, background: "transparent", color: active ? t.text : t.text2, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(127,127,127,0.1)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {active && <span style={{ color: accent, fontWeight: 800 }}>✓</span>}
        {label}
      </span>
      {typeof count === "number" && <span style={{ color: t.text3, fontSize: 12.5 }}>{count}</span>}
    </button>
  );
}

function TrashIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#8A4B38" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
