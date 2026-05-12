import { useEffect, useMemo, useRef, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { CaregiverRequest, CaregiverRequestStatus, HouseholdState } from "../state";
import {
  acknowledgeCaregiverRequest,
  caregiverRequestStatusLabel,
  caregiverRequestTypeLabel,
  deleteCaregiverRequest,
  dismissCaregiverRequest,
} from "../lib/writeCaregiverRequest";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
  /** When set, scroll the row into view + highlight it briefly. */
  focusId?: string | null;
  /** Open the single-day New Coverage Request modal pre-filled from this row. */
  onConvertToCoverage?: (req: CaregiverRequest) => void;
}

type Filter = "new" | "all";

function statusColor(s: CaregiverRequestStatus): string {
  if (s === "acknowledged") return "#30D158";
  if (s === "dismissed")    return "#8E8E93";
  return "#5E5CE6";           // new
}

function friendlyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

function friendlyTimestamp(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function InboxPanel({
  open, onClose, palette, t, dark, householdId, state, focusId, onConvertToCoverage,
}: Props) {
  const [filter, setFilter] = useState<Filter>("new");
  const [busyId, setBusyId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const requests: CaregiverRequest[] = state?.caregiverRequests ?? [];

  // If we're focusing a specific row but its status doesn't match the
  // current filter, widen to "all" so it's reachable.
  useEffect(() => {
    if (!open || !focusId) return;
    const target = requests.find((r) => r.id === focusId);
    if (target && target.status !== "new" && filter === "new") setFilter("all");
  }, [open, focusId, requests, filter]);

  // Scroll focused row into view + brief highlight.
  useEffect(() => {
    if (!open || !focusId) return;
    const el = rowRefs.current[focusId];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.transition = "box-shadow 0.4s ease";
    el.style.boxShadow = `0 0 0 2px ${palette.G}`;
    const timer = window.setTimeout(() => {
      if (el) el.style.boxShadow = "";
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [open, focusId, filter, palette.G]);

  const filtered = useMemo(() => {
    const list = filter === "new" ? requests.filter((r) => r.status === "new") : requests;
    // Newest first by createdAt — fall back to date if missing.
    return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [requests, filter]);

  const newCount = requests.filter((r) => r.status === "new").length;

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Inbox"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(640px, calc(100vw - 32px))",
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
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>Inbox</div>
            <div style={{ fontSize: 12, color: t.text2, marginTop: 4, lineHeight: 1.45 }}>
              Caregiver-authored requests routed here for your review.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: 0, color: t.text2, fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1, fontFamily: "inherit" }}
            aria-label="Close"
          >✕</button>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          {(["new", "all"] as const).map((key) => {
            const active = filter === key;
            const count = key === "new" ? newCount : requests.length;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                style={{
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: `0.5px solid ${active ? "transparent" : t.sep}`,
                  background: active ? t.text2 : "transparent",
                  color: active ? "#fff" : t.text2,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "-0.01em",
                  textTransform: "capitalize",
                }}
              >
                {key === "new" ? "New" : "All"} <span style={{ opacity: 0.7, marginLeft: 4 }}>{count}</span>
              </button>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 12,
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
              {filter === "new" ? "Nothing new. You're all caught up." : "No caregiver requests yet."}
            </div>
          ) : (
            filtered.map((r) => (
              <div
                key={r.id}
                ref={(el) => { rowRefs.current[r.id] = el; }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                  border: `0.5px solid ${t.sep}`,
                  borderLeft: `3px solid ${statusColor(r.status)}`,
                  opacity: busyId === r.id ? 0.5 : 1,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
                      {caregiverRequestStatusLabel(r.status)}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: t.text, letterSpacing: "-0.01em" }}>
                      {caregiverRequestTypeLabel(r.type)}
                    </span>
                    <span style={{ fontSize: 11, color: t.text3 }}>
                      from <b style={{ color: t.text2, fontWeight: 600 }}>{r.createdByName || "Caregiver"}</b>
                      {r.createdAt ? ` · ${friendlyTimestamp(r.createdAt)}` : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: t.text, marginTop: 6 }}>
                    <b style={{ fontWeight: 600 }}>{friendlyDate(r.date)}</b>
                    {(r.startTime || r.endTime) && (
                      <span style={{ color: t.text2 }}>
                        {" · "}{r.startTime ?? "—"} → {r.endTime ?? "—"}
                      </span>
                    )}
                  </div>
                  {r.notes && (
                    <div
                      style={{
                        fontSize: 12.5, color: t.text, marginTop: 6,
                        background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                        padding: "6px 8px", borderRadius: 6, lineHeight: 1.4,
                      }}
                    >
                      {r.notes}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                  {r.type === "shift-conflict" && onConvertToCoverage && (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => onConvertToCoverage(r)}
                      title="Open a new coverage request pre-filled from this conflict."
                      style={{
                        padding: "5px 10px",
                        border: `0.5px solid ${palette.G}`,
                        borderRadius: 6,
                        background: "transparent",
                        color: palette.G,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      Convert to coverage
                    </button>
                  )}
                  {r.status === "new" && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={async () => {
                          if (!householdId) return;
                          setBusyId(r.id);
                          try { await acknowledgeCaregiverRequest(householdId, r.id); }
                          catch (e) { window.alert(e instanceof Error ? e.message : "Couldn't acknowledge."); }
                          finally { setBusyId(null); }
                        }}
                        style={{
                          padding: "5px 10px",
                          border: 0,
                          borderRadius: 6,
                          background: palette.G,
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: busyId === r.id ? "wait" : "pointer",
                          fontFamily: "inherit",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        Acknowledge
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={async () => {
                          if (!householdId) return;
                          setBusyId(r.id);
                          try { await dismissCaregiverRequest(householdId, r.id); }
                          catch (e) { window.alert(e instanceof Error ? e.message : "Couldn't dismiss."); }
                          finally { setBusyId(null); }
                        }}
                        style={{
                          padding: "4px 10px",
                          border: `0.5px solid ${t.sep}`,
                          borderRadius: 6,
                          background: "transparent",
                          color: t.text2,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: busyId === r.id ? "wait" : "pointer",
                          fontFamily: "inherit",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    title="Delete this request"
                    disabled={busyId === r.id}
                    onClick={async () => {
                      if (!householdId) return;
                      if (!window.confirm("Delete this request?")) return;
                      setBusyId(r.id);
                      try { await deleteCaregiverRequest(householdId, r.id); }
                      catch (e) { window.alert(e instanceof Error ? e.message : "Couldn't delete."); }
                      finally { setBusyId(null); }
                    }}
                    style={{
                      background: "transparent",
                      border: 0,
                      color: t.text3,
                      fontSize: 14,
                      cursor: busyId === r.id ? "wait" : "pointer",
                      padding: 2,
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
