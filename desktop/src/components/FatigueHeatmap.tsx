import { useMemo } from "react";
import type { ShiftMap } from "../data";
import type { HouseholdState } from "../state";
import type { ThemeTokens } from "../theme";

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

  if (!state) return null;
  const rested = todayScore <= 0.15;

  return (
    <div>
      <div style={subhead(t)}>Fatigue index</div>

      {/* Fira Code status line, matching the wall display */}
      <div
        style={{
          fontFamily: "'Fira Code', ui-monospace, 'SF Mono', Menlo, monospace",
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: rested ? "#88BB6E" : "#DA6E50",
          marginBottom: 8,
        }}
      >
        {rested ? "well rested :)" : "Get some rest."}
      </div>

      {/* Quilt — solid block, no gaps, square cells via 7/4 aspect ratio. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridTemplateRows: `repeat(${WEEKS}, 1fr)`,
          gap: 0,
          width: "100%",
          aspectRatio: `7 / ${WEEKS}`,
          borderRadius: 8,
          overflow: "hidden",
          background: "#0B0907",
        }}
      >
        {days.map((d) => {
          const isInteractive = !!onSelectDate;
          const bg = colorForScore(d.score, d.hasShift);
          const ringStyle: React.CSSProperties = {};
          if (d.isSelected) {
            ringStyle.boxShadow = `inset 0 0 0 2px ${t.text}`;
          } else if (d.isToday) {
            ringStyle.boxShadow = "inset 0 0 0 2px rgba(255,245,224,0.85)";
          }
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => onSelectDate?.(d.iso)}
              title={`${d.iso} — ${d.hasShift ? `fatigue ${Math.round(d.score * 100)}%` : "off day"}`}
              style={{
                background: bg,
                border: 0,
                cursor: isInteractive ? "pointer" : "default",
                padding: 0,
                ...ringStyle,
                // No rounded corners on cells — the parent grid's
                // border-radius + overflow:hidden clip the outer shape.
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
          gap: 6,
          fontSize: 9.5,
          color: t.text3,
          marginTop: 6,
        }}
      >
        <span>Rested</span>
        <div
          style={{
            flex: 1,
            height: 5,
            borderRadius: 3,
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
