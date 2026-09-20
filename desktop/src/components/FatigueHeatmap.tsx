import { useMemo, useState } from "react";
import type { ShiftMap } from "../data";
import type { HouseholdState } from "../state";
import type { ThemeTokens } from "../theme";

const WEEKDAY_3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabelFromIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y || 1970, (m || 1) - 1, d || 1);
  return `${WEEKDAY_3[dt.getDay()]} · ${MONTH_3[(m || 1) - 1]} ${d}`;
}

interface Props {
  shifts: ShiftMap;
  state: HouseholdState | null;
  /** Anchor — the grid starts on the Sunday of the week containing this date. */
  anchorDate: string;
  t: ThemeTokens;
  onSelectDate?: (iso: string) => void;
}

// 4 weeks × 7 days = 28-cell quilt. Matches the wall display's style
// exactly: no gaps, no per-cell borders, solid colored squares for
// shift days, neutral warm dark for off days. Today gets an inset cream
// outline.
const WEEKS = 4;
const FATIGUE_OFF_FILL = "#2A201A";

// ───────────────── Fatigue scoring ──────────────────────────────────────
// Per-day score in [0, 1]. 0 = well rested, 1 = sleep deficit. The score
// looks at each working partner's REST WINDOW since their most recent
// shift, subtracting their post-shift sleep requirement.

function parseHM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function fatigueForDay(date: string, shifts: ShiftMap, state: HouseholdState): number {
  const dayShifts = shifts[date] ?? [];
  if (dayShifts.length === 0) return 0;
  const todayDt = parseIsoDate(date);

  let worstScore = 0;
  for (const s of dayShifts) {
    if (s.who !== "G" && s.who !== "K") continue;
    const stype = state.shiftTypes.find((t) => t.id === s.shiftTypeId);
    if (!stype) continue;
    const todayStart = parseHM(stype.start);

    let foundRest: number | null = null;
    for (let i = 1; i <= 3; i++) {
      const prevDt = new Date(todayDt);
      prevDt.setDate(todayDt.getDate() - i);
      const prevIso = isoFromDate(prevDt);
      const prev = (shifts[prevIso] ?? []).find((p) => p.who === s.who);
      if (!prev) continue;
      const ptype = state.shiftTypes.find((t) => t.id === prev.shiftTypeId);
      if (!ptype) continue;
      const prevStart = parseHM(ptype.start);
      let prevEnd = parseHM(ptype.end);
      if (ptype.crossesMidnight || prevEnd <= prevStart) prevEnd += 24 * 60;
      const totalGap = todayStart + i * 24 * 60 - prevEnd;
      const sleepNeed = (ptype.sleepHours ?? 0) * 60;
      foundRest = totalGap - sleepNeed;
      break;
    }

    let score = 0;
    if (foundRest != null) {
      if (foundRest < 4 * 60)       score = 1;
      else if (foundRest < 8 * 60)  score = 0.7;
      else if (foundRest < 12 * 60) score = 0.4;
      else if (foundRest < 16 * 60) score = 0.15;
      else                          score = 0;
    }
    if (score > worstScore) worstScore = score;
  }
  return worstScore;
}

// Sage (#88BB6E) → Amber (#F0B544) → Tomato (#DA6E50). Punchier than the
// theme accents so they read clearly on a near-black canvas, matching
// the wall display's palette exactly.
function colorForScore(score: number, hasShift: boolean): string {
  if (!hasShift) return FATIGUE_OFF_FILL;
  if (score <= 0.5) {
    const u = score / 0.5;
    const r = Math.round(136 + (240 - 136) * u);
    const g = Math.round(187 + (181 - 187) * u);
    const b = Math.round(110 + (68  - 110) * u);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const u = (score - 0.5) / 0.5;
  const r = Math.round(240 + (218 - 240) * u);
  const g = Math.round(181 + (110 - 181) * u);
  const b = Math.round(68  + (80  - 68)  * u);
  return `rgb(${r}, ${g}, ${b})`;
}

// Turn either a "#rrggbb" or an "rgb(r, g, b)" string into "rgba(r,g,b,a)".
function rgbaFromCss(color: string, alpha: number): string {
  const m = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
  const hex = color.replace("#", "");
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

export function FatigueHeatmap({ shifts, state, anchorDate, t, onSelectDate }: Props) {
  const { days, todayScore } = useMemo(() => {
    if (!state) return { days: [], todayScore: 0 };
    const sel = parseIsoDate(anchorDate);
    const sun = new Date(sel);
    sun.setDate(sel.getDate() - sel.getDay());
    const todayIso = isoFromDate(new Date());
    const out: { iso: string; score: number; isToday: boolean; isSelected: boolean; hasShift: boolean }[] = [];
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(sun);
      d.setDate(sun.getDate() + i);
      const iso = isoFromDate(d);
      out.push({
        iso,
        score: fatigueForDay(iso, shifts, state),
        isToday: iso === todayIso,
        isSelected: iso === anchorDate,
        hasShift: (shifts[iso] ?? []).length > 0,
      });
    }
    return { days: out, todayScore: fatigueForDay(todayIso, shifts, state) };
  }, [shifts, state, anchorDate]);

  const [hover, setHover] = useState<number | null>(null);

  if (!state) return null;
  const rested = todayScore <= 0.15;
  const hovered = hover != null ? days[hover] : null;

  return (
    <div style={{ background: t.bgElev, border: `0.5px solid ${t.sep}`, borderRadius: 16, padding: 13 }}>
      <div style={subhead(t)}>Fatigue index</div>

      {/* Fira Code status line — shows the hovered day when scrubbing the
          grid, otherwise today's rest status (matching the wall display). */}
      <div
        style={{
          fontFamily: "'Fira Code', ui-monospace, 'SF Mono', Menlo, monospace",
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: hovered
            ? t.text
            : rested ? "#88BB6E" : "#DA6E50",
          marginBottom: 4,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {hovered
          ? `${dayLabelFromIso(hovered.iso)} — ${hovered.hasShift ? `fatigue ${Math.round(hovered.score * 100)}%` : "off day"}`
          : rested ? "well rested :)" : "Get some rest."}
      </div>

      {/* Quilt — individually-rounded cells with a small gap, so the outer
          shape reads clean (no clipped/odd corners). Hovering a cell makes
          it glow and pop forward; the status line above names the day. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 5,
          width: "100%",
          marginTop: 10,
          isolation: "isolate",
        }}
      >
        {days.map((d, i) => {
          const isInteractive = !!onSelectDate;
          const bg = colorForScore(d.score, d.hasShift);
          const isHover = hover === i;
          const ring =
            d.isSelected ? `inset 0 0 0 2px ${t.text}`
            : d.isToday   ? "inset 0 0 0 2px rgba(255,245,224,0.9)"
            : null;
          const glow = isHover
            ? `0 0 0 2px ${rgbaFromCss(bg, 0.9)}, 0 4px 14px rgba(0,0,0,0.45)`
            : null;
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => onSelectDate?.(d.iso)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              aria-label={`${d.iso} — ${d.hasShift ? `fatigue ${Math.round(d.score * 100)}%` : "off day"}`}
              style={{
                background: bg,
                border: 0,
                borderRadius: 8,
                aspectRatio: "1",
                cursor: isInteractive ? "pointer" : "default",
                padding: 0,
                boxShadow: [ring, glow].filter(Boolean).join(", ") || undefined,
                transform: isHover ? "scale(1.18)" : "none",
                zIndex: isHover ? 2 : 1,
                transition: "transform .12s ease, box-shadow .12s ease",
              }}
            />
          );
        })}
      </div>

      {/* Legend gradient */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 10.5,
          fontWeight: 500,
          color: t.text3,
          marginTop: 11,
        }}
      >
        <span>Rested</span>
        <div
          style={{
            flex: 1,
            height: 7,
            borderRadius: 999,
            background: "linear-gradient(90deg, #88BB6E 0%, #F0B544 50%, #DA6E50 100%)",
          }}
        />
        <span>Deficit</span>
      </div>
    </div>
  );
}

function subhead(t: import("../theme").ThemeTokens): React.CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 700,
    color: t.text3,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    marginBottom: 6,
  };
}
