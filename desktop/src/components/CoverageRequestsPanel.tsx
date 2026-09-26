// Coverage with Daisy — opened from the View menu (⌘⇧C) or by right-clicking
// Coverage in the sidebar.
// One month of what's been asked of the caregiver, sorted by the question it
// answers: which days nobody holds, which are still waiting on her, and which
// she has. Days she has are grouped by the window they share. Opening a row
// edits that day's hours or cancels it. Previously lived inside the Family
// Console.

import { useState, type ReactNode } from "react";
import type { Palette, ThemeTokens } from "../theme";
import { BRAND_FONT, rgba } from "../theme";
import type { HouseholdState } from "../state";
import { deleteCoverageRequest, updateCoverageRequest } from "../lib/writeCoverageRequest";

type Req = NonNullable<HouseholdState["coverageRequests"]>[number];

const TEAL = "#0F6E64";
const TEAL_LIGHT = "#9ACFC6";
const CLAY = "#8A4B38";
const CLAY_TINT = "#EFDFDB";
const INK_MUTED = "#5A6663";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Opens the send-to-caregiver modal for a new batch. */
  onAskForMore: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
}

export function CoverageRequestsPanel({
  open, onClose, onAskForMore, t, dark, householdId, state,
}: Props) {
  const [month, setMonth] = useState(() => ymOf(new Date()));
  /** Which row or group is open for editing. */
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (!open) return null;

  const daisy = state?.dependents?.daisy?.name || "Daisy";
  const all = (state?.coverageRequests ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const reqs = all.filter((r) => r.date.startsWith(month));

  const nobody = reqs.filter((r) => r.status === "declined" || r.status === "issue");
  const waiting = reqs.filter((r) => r.status === "pending");
  const has = reqs.filter((r) => r.status === "confirmed");
  const sum = (rs: Req[]) => rs.reduce((s, r) => s + hoursOf(r), 0);

  // Days she has, one line per shared window, biggest first.
  const groups = Object.values(
    has.reduce<Record<string, Req[]>>((acc, r) => {
      (acc[`${r.startTime}-${r.endTime}-${r.endsNextDay ? 1 : 0}`] ??= []).push(r);
      return acc;
    }, {}),
  ).sort((a, b) => b.length - a.length || a[0].date.localeCompare(b[0].date));

  const axis = axisFor(reqs);
  const lastAsked = waiting.reduce((m, r) => Math.max(m, r.createdAt || 0), 0);
  const days = new Set(reqs.map((r) => r.date)).size;

  const surface = dark ? "rgba(255,255,255,0.04)" : "#FFFFFF";
  const paper = dark ? "#161618" : "#F7F6F3";
  const rowProps = { t, dark, surface, axis, householdId, daisy };

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
        role="dialog"
        aria-modal="true"
        aria-label={`Coverage with ${daisy}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(600px, calc(100vw - 32px))",
          maxHeight: "88vh",
          background: dark ? "#1C1C1E" : "#FFFFFF",
          color: t.text,
          border: `1px solid ${t.sep}`,
          borderRadius: 6,
          boxShadow: "0 30px 80px rgba(0,0,0,0.3)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {/* Header, the month's totals, and the month itself. */}
        <div style={{ padding: "20px 22px 16px", borderBottom: `1px solid ${t.sep}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: BRAND_FONT, fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em" }}>
                Coverage with {daisy}
              </div>
              <div style={{ fontSize: 13, color: t.text2, marginTop: 4 }}>
                {days} day{days === 1 ? "" : "s"} · {fmtNum(sum(reqs))} hour{sum(reqs) === 1 ? "" : "s"} asked for
              </div>
            </div>
            <IconButton label="Close" onClick={onClose} t={t} surface={surface}><XIcon /></IconButton>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", marginTop: 14, border: `1px solid ${t.sep}`, borderRadius: 4, overflow: "hidden" }}>
            <Stat value={sum(has)} label={`${daisy} has said yes`} color={dark ? TEAL_LIGHT : TEAL} t={t} />
            <Stat value={sum(waiting)} label="Waiting on her" color={t.text} t={t} divider />
            <Stat
              value={sum(nobody)} label="Nobody holds" t={t} divider
              color={sum(nobody) > 0 ? (dark ? "#D9A08E" : CLAY) : t.text}
              fill={sum(nobody) > 0 ? (dark ? rgba(CLAY, 0.22) : CLAY_TINT) : undefined}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
            <IconButton label="Previous month" onClick={() => { setMonth(shiftYm(month, -1)); setOpenKey(null); }} t={t} surface={surface}>
              <Chevron dir="left" />
            </IconButton>
            <MonthStrip ym={month} reqs={reqs} t={t} dark={dark} />
            <IconButton label="Next month" onClick={() => { setMonth(shiftYm(month, 1)); setOpenKey(null); }} t={t} surface={surface}>
              <Chevron dir="right" />
            </IconButton>
          </div>
        </div>

        {/* The month, by what each day means for the kids. */}
        <div style={{ flex: 1, minHeight: 120, overflowY: "auto", background: paper, padding: "16px 22px 18px" }}>
          {reqs.length === 0 && (
            <div style={{ fontSize: 13, color: t.text2, padding: "28px 12px", textAlign: "center", border: `1px dashed ${t.sep}`, borderRadius: 4 }}>
              Nothing asked of {daisy} in {monthLabel(month)}.
            </div>
          )}

          {nobody.length > 0 && (
            <Section label="Nobody holds this" count={nobody.length} note="the kids are not covered" color={dark ? "#D9A08E" : CLAY} t={t}>
              {nobody.map((r) => (
                <Row
                  key={r.id} {...rowProps} kind="nobody" rows={[r]}
                  open={openKey === r.id} onToggle={() => setOpenKey(openKey === r.id ? null : r.id)}
                  aside={r.status === "issue" ? `${daisy} flagged a problem` : `${daisy} said no`}
                  action={{
                    label: "Ask again",
                    run: () => householdId && updateCoverageRequest(householdId, r.id, { status: "pending", caregiverNote: "" }),
                  }}
                />
              ))}
            </Section>
          )}

          {waiting.length > 0 && (
            <Section label={`Waiting on ${daisy}`} count={waiting.length} note={lastAsked ? `sent ${agoLabel(lastAsked)}` : ""} t={t}>
              {waiting.map((r) => (
                <Row
                  key={r.id} {...rowProps} kind="waiting" rows={[r]}
                  open={openKey === r.id} onToggle={() => setOpenKey(openKey === r.id ? null : r.id)}
                  aside={r.createdAt ? `Asked ${askedLabel(r.createdAt)}` : "Asked"}
                />
              ))}
            </Section>
          )}

          {groups.length > 0 && (
            <Section label="She has these" count={has.length} unit={has.length === 1 ? "day" : "days"} note="grouped by the window they share" t={t}>
              {groups.map((g) => {
                const key = `g:${g[0].startTime}-${g[0].endTime}-${g[0].endsNextDay ? 1 : 0}`;
                return (
                  <Row
                    key={key} {...rowProps} kind="has" rows={g}
                    open={openKey === key} onToggle={() => setOpenKey(openKey === key ? null : key)}
                    aside={datesLabel(g)}
                  />
                );
              })}
            </Section>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 22px", borderTop: `1px solid ${t.sep}`, flexShrink: 0 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: t.text2, lineHeight: 1.4 }}>
            Open a day to change its hours. {daisy} sees each change.
          </span>
          <button
            type="button"
            onClick={onAskForMore}
            style={{
              height: 38, padding: "0 14px", borderRadius: 4, border: 0,
              background: TEAL, color: "#fff",
              fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600,
              cursor: "pointer", flexShrink: 0,
            }}
          >Ask for more days</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────── pieces ───────────────────

function Stat({ value, label, color, fill, divider, t }: {
  value: number; label: string; color: string; fill?: string; divider?: boolean; t: ThemeTokens;
}) {
  return (
    <div style={{ padding: "9px 12px", background: fill, borderLeft: divider ? `1px solid ${t.sep}` : undefined, minWidth: 0 }}>
      <div style={{ fontFamily: BRAND_FONT, fontSize: 17, fontWeight: 600, color, lineHeight: 1.15 }}>
        {fmtNum(value)} h
      </div>
      <div style={{ fontSize: 12, color: t.text2, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
    </div>
  );
}

/**
 * The whole month on one line. Each asked-for day is a mark in the same shape
 * vocabulary as the rows: solid = she has it, hollow = waiting, dashed Clay =
 * nobody holds it.
 */
function MonthStrip({ ym, reqs, t, dark }: { ym: string; reqs: Req[]; t: ThemeTokens; dark: boolean }) {
  const [y, m] = ym.split("-").map(Number);
  const n = new Date(y, m, 0).getDate();
  const at = (d: number) => `${((d - 0.5) / n) * 100}%`;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ textAlign: "center", fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600, color: t.text }}>
        {monthLabel(ym)}
      </div>
      <div style={{ position: "relative", height: 16, marginTop: 3 }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 7, height: 2, background: dark ? "rgba(255,255,255,0.1)" : "#EFEDE7" }} />
        {reqs.map((r) => {
          const d = Number(r.date.slice(8, 10));
          const s = markStyle(r.status, dark);
          return (
            <div
              key={r.id}
              title={`${fmtDate(r.date)} · ${fmtWindow(r)}`}
              style={{ position: "absolute", left: at(d), top: 1, width: 5, height: 14, marginLeft: -2.5, borderRadius: 2, boxSizing: "border-box", ...s }}
            />
          );
        })}
      </div>
      <div style={{ position: "relative", height: 13, fontSize: 10.5, color: t.text2 }}>
        {[1, 8, 15, 22, 29].filter((d) => d <= n).map((d) => (
          <span key={d} style={{ position: "absolute", left: at(d), transform: "translateX(-50%)" }}>{d}</span>
        ))}
      </div>
    </div>
  );
}

function markStyle(status: Req["status"], dark: boolean) {
  if (status === "confirmed") return { background: dark ? TEAL_LIGHT : TEAL };
  if (status === "pending") return { border: `1.5px solid ${dark ? TEAL_LIGHT : TEAL}`, background: "transparent" };
  return { border: `1.5px dashed ${CLAY}`, background: dark ? rgba(CLAY, 0.25) : CLAY_TINT };
}

function Section({ label, count, unit, note, color, t, children }: {
  label: string; count: number; unit?: string; note: string; color?: string; t: ThemeTokens; children: ReactNode;
}) {
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: color ?? t.text }}>
          {label}<span style={{ marginLeft: 10 }}>{count}{unit ? ` ${unit}` : ""}</span>
        </div>
        <div style={{ marginLeft: "auto", fontSize: 12, color: t.text2 }}>{note}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </section>
  );
}

type Kind = "nobody" | "waiting" | "has";

function Row({
  kind, rows, open, onToggle, aside, action, t, dark, surface, axis, householdId, daisy,
}: {
  kind: Kind; rows: Req[]; open: boolean; onToggle: () => void; aside: string;
  action?: { label: string; run: () => unknown };
  t: ThemeTokens; dark: boolean; surface: string; axis: Axis; householdId: string | null; daisy: string;
}) {
  const [busy, setBusy] = useState(false);
  const first = rows[0];
  const hours = rows.reduce((s, r) => s + hoursOf(r), 0);
  const clay = dark ? "#D9A08E" : CLAY;
  const teal = dark ? TEAL_LIGHT : TEAL;

  const border =
    kind === "nobody" ? `1px dashed ${clay}` :
    kind === "waiting" ? `1px solid ${dark ? rgba(TEAL_LIGHT, 0.5) : TEAL_LIGHT}` :
    `1px solid ${t.sep}`;

  const big = kind === "has" ? String(rows.length) : String(Number(first.date.slice(8, 10)));
  const small = kind === "has" ? (rows.length === 1 ? "day" : "days") : weekdayOf(first.date);

  return (
    <div style={{ borderRadius: 4, border, background: kind === "nobody" ? "transparent" : surface }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 8px 12px" }}>
        <StateMark kind={kind} clay={clay} teal={teal} />
        <div style={{ width: 34, flexShrink: 0 }}>
          <div style={{ fontFamily: BRAND_FONT, fontSize: 19, fontWeight: 600, lineHeight: 1 }}>{big}</div>
          <div style={{ fontSize: 11.5, color: t.text2, marginTop: 2 }}>{small}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: BRAND_FONT, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>{fmtWindow(first)}</span>
            <span style={{ fontSize: 12, color: t.text2, whiteSpace: "nowrap" }}>{fmtNum(hours)} hr{hours === 1 ? "" : "s"}</span>
            <span title={aside} style={{
              marginLeft: "auto", paddingLeft: 4, fontSize: 12, whiteSpace: "nowrap", minWidth: 0,
              overflow: "hidden", textOverflow: "ellipsis",
              color: kind === "nobody" ? clay : kind === "waiting" ? teal : t.text2,
            }}>{aside}</span>
          </div>
          <DayBar req={first} kind={kind} axis={axis} t={t} dark={dark} />
        </div>
        {action && (
          <button
            type="button"
            disabled={busy || !householdId}
            onClick={async () => {
              setBusy(true);
              try { await action.run(); }
              catch (e) { window.alert(e instanceof Error ? e.message : "Couldn't update."); }
              finally { setBusy(false); }
            }}
            style={{
              height: 30, padding: "0 10px", borderRadius: 4, flexShrink: 0,
              border: `1px solid ${clay}`, background: surface, color: clay,
              fontFamily: BRAND_FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >{action.label}</button>
        )}
        <IconButton label={open ? "Close day" : "Open day"} onClick={onToggle} t={t} surface={surface} expanded={open}>
          <Chevron dir={open ? "up" : "down"} />
        </IconButton>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${t.sep}`, padding: "4px 10px 6px 12px" }}>
          {rows.map((r) => <DayEditor key={r.id} req={r} t={t} dark={dark} surface={surface} householdId={householdId} daisy={daisy} />)}
        </div>
      )}
    </div>
  );
}

function StateMark({ kind, clay, teal }: { kind: Kind; clay: string; teal: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0 }}>
      {kind === "has" && <circle cx="9" cy="9" r="8" fill={teal} />}
      {kind === "waiting" && <circle cx="9" cy="9" r="7" fill="none" stroke={teal} strokeWidth="2.2" />}
      {kind === "nobody" && <rect x="1" y="7" width="16" height="4" rx="2" fill={clay} />}
    </svg>
  );
}

/** Where the window sits in the day, on the same axis for every row. */
function DayBar({ req, kind, axis, t, dark }: { req: Req; kind: Kind; axis: Axis; t: ThemeTokens; dark: boolean }) {
  const span = axis.to - axis.from;
  const a = startMin(req), b = endMin(req);
  const pct = (x: number) => `${((x - axis.from) / span) * 100}%`;
  const fill =
    kind === "has" ? { background: dark ? "#8A9591" : INK_MUTED } :
    kind === "waiting" ? { border: `1.5px dashed ${dark ? TEAL_LIGHT : TEAL}` } :
    { border: `1.5px dashed ${CLAY}`, background: dark ? rgba(CLAY, 0.25) : CLAY_TINT };
  return (
    <div style={{ position: "relative", height: 12, marginTop: 6 }} aria-hidden="true">
      <div style={{ position: "absolute", left: 0, right: 0, top: 5, height: 2, background: dark ? "rgba(255,255,255,0.1)" : "#EFEDE7" }} />
      {axis.ticks.map((x) => (
        <div key={x} style={{ position: "absolute", left: pct(x), top: 0, width: 1, height: 12, background: t.sep }} />
      ))}
      <div style={{ position: "absolute", left: pct(a), width: `${((b - a) / span) * 100}%`, top: 1, height: 10, borderRadius: 2, boxSizing: "border-box", ...fill }} />
    </div>
  );
}

/** One day's hours, editable, and a way to cancel it. */
function DayEditor({ req, t, dark, surface, householdId, daisy }: {
  req: Req; t: ThemeTokens; dark: boolean; surface: string; householdId: string | null; daisy: string;
}) {
  const [start, setStart] = useState(req.startTime);
  const [end, setEnd] = useState(req.endTime);
  const [busy, setBusy] = useState(false);
  const dirty = start !== req.startTime || end !== req.endTime;

  const save = async () => {
    if (!householdId) return;
    setBusy(true);
    try {
      await updateCoverageRequest(householdId, req.id, { startTime: start, endTime: end, endsNextDay: end <= start });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Couldn't save.");
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!householdId) return;
    if (!window.confirm(`Cancel ${fmtDate(req.date)}? ${daisy} will see it's no longer needed.`)) return;
    try { await deleteCoverageRequest(householdId, req.id); }
    catch (e) { window.alert(e instanceof Error ? e.message : "Couldn't cancel."); }
  };

  const extra = [
    req.arriveBy ? `Arrive by ${req.arriveBy}` : "",
    req.notes ?? "",
    req.caregiverNote ? `${daisy}: “${req.caregiverNote}”` : "",
  ].filter(Boolean).join(" · ");

  const input = {
    height: 36, padding: "0 8px", borderRadius: 4, border: `1px solid ${t.sep}`,
    background: surface, color: t.text, fontSize: 13, fontFamily: "inherit",
    colorScheme: dark ? "dark" : "light",
  } as const;

  return (
    <div style={{ padding: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 92, fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{fmtDate(req.date)}</span>
        <input type="time" aria-label={`Start on ${fmtDate(req.date)}`} value={start} onChange={(e) => setStart(e.target.value)} style={input} />
        <span style={{ color: t.text3 }}>–</span>
        <input type="time" aria-label={`End on ${fmtDate(req.date)}`} value={end} onChange={(e) => setEnd(e.target.value)} style={input} />
        {dirty && (
          <button
            type="button" onClick={save} disabled={busy}
            style={{ height: 36, padding: "0 12px", borderRadius: 4, border: 0, background: TEAL, color: "#fff", fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.5 : 1 }}
          >Save</button>
        )}
        <button
          type="button" onClick={cancel} aria-label={`Cancel ${fmtDate(req.date)}`} title="Cancel this day"
          style={{ marginLeft: "auto", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", border: 0, borderRadius: 4, background: "transparent", color: t.text2, cursor: "pointer" }}
        ><XIcon /></button>
      </div>
      {extra && <div style={{ fontSize: 12, color: t.text2, marginLeft: 100, marginTop: 2 }}>{extra}</div>}
    </div>
  );
}

function IconButton({ label, onClick, t, surface, expanded, children }: {
  label: string; onClick: () => void; t: ThemeTokens; surface: string; expanded?: boolean; children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      style={{
        width: 30, height: 30, flexShrink: 0, padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 4, border: `1px solid ${t.sep}`, background: surface,
        color: t.text2, cursor: "pointer",
      }}
    >{children}</button>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function Chevron({ dir }: { dir: "left" | "right" | "up" | "down" }) {
  const d = {
    left: "M8 2.5 L4.5 6 L8 9.5",
    right: "M4 2.5 L7.5 6 L4 9.5",
    up: "M2.5 8 L6 4.5 L9.5 8",
    down: "M2.5 4.5 L6 8 L9.5 4.5",
  }[dir];
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─────────────────── helpers ───────────────────

interface Axis { from: number; to: number; ticks: number[] }

function hm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function startMin(r: Req): number { return hm(r.startTime); }
function endMin(r: Req): number {
  const e = hm(r.endTime);
  return r.endsNextDay || e <= hm(r.startTime) ? e + 1440 : e;
}
function hoursOf(r: Req): number { return (endMin(r) - startMin(r)) / 60; }

/** 6a to midnight, stretched to fit early starts and overnight windows. */
function axisFor(reqs: Req[]): Axis {
  let from = 6 * 60, to = 24 * 60;
  for (const r of reqs) {
    from = Math.min(from, Math.floor(startMin(r) / 60) * 60);
    to = Math.max(to, Math.ceil(endMin(r) / 60) * 60);
  }
  const ticks: number[] = [];
  for (let x = Math.ceil((from + 1) / 360) * 360; x < to; x += 360) ticks.push(x);
  return { from, to, ticks };
}

/** 540 → "9:00a", 1170 → "7:30p". */
function clock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")}${h < 12 ? "a" : "p"}`;
}
function fmtWindow(r: Req): string { return `${clock(startMin(r))} – ${clock(endMin(r))}`; }

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function dateOf(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function weekdayOf(iso: string): string { return dateOf(iso).toLocaleDateString(undefined, { weekday: "short" }); }
/** "Tue 6" */
function shortDay(iso: string): string { return `${weekdayOf(iso)} ${Number(iso.slice(8, 10))}`; }
/** "Tue, Oct 6" */
function fmtDate(iso: string): string {
  return dateOf(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
/** "Tue 6 · Thu 8", or "Tue 6 · Thu 8 +3" when there are more. */
function datesLabel(rows: Req[]): string {
  const head = rows.slice(0, 2).map((r) => shortDay(r.date)).join(" · ");
  return rows.length > 2 ? `${head} +${rows.length - 2}` : head;
}

function ymOf(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function shiftYm(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  return ymOf(new Date(y, m - 1 + by, 1));
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** "today", "yesterday", "3 days ago". */
function agoLabel(ms: number): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(new Date(ms))) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}
/** Weekday inside the last week, otherwise the date. */
function askedLabel(ms: number): string {
  const d = new Date(ms);
  return Date.now() - ms < 6 * 86_400_000
    ? d.toLocaleDateString(undefined, { weekday: "short" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
