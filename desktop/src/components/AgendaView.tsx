// Agenda / List layout for the desktop calendar — a tidy chronological list of
// the next ~2 weeks, grouped This week / Next week / Later. Mirrors the web
// app's agenda: work days show one line per shift (dot · name · range · hours),
// off days are slim + quiet, life events show as pills.

import { useMemo } from "react";
import type { Shift, ShiftMap } from "../data";
import { WEEKDAYS_3 } from "../data";
import { compactTime, type HouseholdState, type ShiftType, type Event as SbEvent } from "../state";
import { rgba, type Palette, type ThemeTokens } from "../theme";
import type { EventMap } from "../App";

interface Props {
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  shifts: ShiftMap;
  state: HouseholdState | null;
  today: string;                       // YYYY-MM-DD
  selfName: string;
  partnerName: string;
  eventsByDate: EventMap;
  onSelectDate: (date: string) => void;
  onEditEvent: (ev: SbEvent) => void;
}

const MONTHS_3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function weekStart(d: Date): string { return iso(addDays(d, -d.getDay())); }

export function AgendaView({ palette, t, dark: _dark, shifts, state, today, selfName, partnerName, eventsByDate, onSelectDate, onEditEvent }: Props) {
  const types = useMemo(() => {
    const m: Record<string, ShiftType> = {};
    for (const st of state?.shiftTypes || []) m[st.id] = st;
    return m;
  }, [state?.shiftTypes]);

  const daisyName = state?.dependents?.daisy?.name || "Daisy";
  const nameFor: Record<string, string> = { G: selfName, K: partnerName, D: daisyName };
  const colorFor: Record<string, string> = { G: palette.G, K: palette.K, D: "#0F6E64" };

  const toMin = (s: string) => { const [h, m] = (s || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const shiftMeta = (s: Shift): { range: string; hrs: string | null } => {
    const ty = s.shiftTypeId ? types[s.shiftTypeId] : undefined;
    if (!ty) return { range: s.label || "", hrs: null };
    let d = toMin(ty.end) - toMin(ty.start);
    if (ty.crossesMidnight || d <= 0) d += 1440;
    const h = d / 60;
    return { range: `${compactTime(ty.start)}–${compactTime(ty.end)}`, hrs: (Number.isInteger(h) ? String(h) : h.toFixed(1)) + "h" };
  };

  const start = parseISO(today);
  const thisWk = weekStart(start);
  const nextWk = iso(addDays(parseISO(thisWk), 7));
  const sectionFor = (d: Date): string => {
    const w = weekStart(d);
    return w === thisWk ? "This week" : w === nextWk ? "Next week" : "Later";
  };

  const rows: React.ReactNode[] = [];
  let curSection: string | null = null;
  for (let i = 0; i < 14; i++) {
    const d = addDays(start, i);
    const key = iso(d);
    const sec = sectionFor(d);
    if (sec !== curSection) {
      curSection = sec;
      rows.push(
        <div key={`s-${sec}`} style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: t.text3, padding: i === 0 ? "0 4px 4px" : "14px 4px 4px" }}>{sec}</div>,
      );
    }

    const dayShifts = shifts[key] || [];
    const whos = new Set(dayShifts.map((s) => s.who));
    const gW = whos.has("G"), kW = whos.has("K");
    const kind = gW && kW ? "both" : gW ? "g" : kW ? "k" : whos.has("D") ? "d" : "off";
    const railColor = kind === "both" ? "#14201E" : kind === "g" ? palette.G : kind === "k" ? palette.K : kind === "d" ? "#0F6E64" : t.text3;
    const isToday = key === today;
    const isOff = dayShifts.length === 0;
    const title = isOff
      ? "Both off"
      : gW && kW ? "Both working"
        : [...whos].map((w) => nameFor[w] || w).join(" & ") + " working";
    const events = eventsByDate[key] || [];

    rows.push(
      <div
        key={key}
        onClick={() => onSelectDate(key)}
        style={{
          display: "flex", gap: 12, alignItems: "stretch",
          padding: isOff ? "8px 12px" : "11px 12px",
          background: t.bgElev,
          borderRadius: 12,
          border: `1px solid ${isToday ? railColor : t.sep}`,
          opacity: isOff ? 0.6 : 1,
          cursor: "pointer",
          marginBottom: 6,
        }}
      >
        {/* Date block */}
        <div style={{ width: 42, textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", color: isToday ? railColor : t.text3 }}>{WEEKDAYS_3[d.getDay()]}</div>
          <div style={{ fontSize: isOff ? 18 : 22, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.05, color: isToday ? railColor : t.text }}>{d.getDate()}</div>
          <div style={{ fontSize: 9.5, color: t.text3 }}>{MONTHS_3[d.getMonth()]}</div>
        </div>
        {/* Rail */}
        <div style={{ width: 3, borderRadius: 2, background: railColor, flexShrink: 0 }} />
        {/* Body */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5, justifyContent: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: isOff ? t.text2 : t.text }}>{title}</div>
          {dayShifts.map((s, si) => {
            const meta = shiftMeta(s);
            return (
              <div key={si} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: colorFor[s.who] || t.text3, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, color: t.text }}>{nameFor[s.who] || s.who}</span>
                <span style={{ color: t.text2 }}>{meta.range}</span>
                {meta.hrs && <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 600, color: t.text3 }}>{meta.hrs}</span>}
              </div>
            );
          })}
          {events.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: dayShifts.length ? 2 : 0 }}>
              {events.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEditEvent(ev); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "2px 9px", borderRadius: 999,
                    border: `0.5px solid ${rgba(palette.G, 0.4)}`,
                    background: rgba(palette.G, 0.14),
                    color: t.text, fontSize: 11, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {ev.startTime ? `${compactTime(ev.startTime)} · ` : ""}{ev.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>,
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 14, minHeight: 0 }}>
      {rows}
    </div>
  );
}
