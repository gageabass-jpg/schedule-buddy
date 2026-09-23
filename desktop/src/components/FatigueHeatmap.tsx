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

// Nucleus diverging scale: Teal (#0F6E64, rested) → Clay (#8A4B38, deficit),
// no green/amber/red. Off days take a neutral theme fill.
function colorForScore(score: number, hasShift: boolean, offFill: string): string {
  if (!hasShift) return offFill;
  const A = [15, 110, 100];   // Teal
  const B = [138, 75, 56];    // Clay
  const r = Math.round(A[0] + (B[0] - A[0]) * score);
  const g = Math.round(A[1] + (B[1] - A[1]) * score);
  const b = Math.round(A[2] + (B[2] - A[2]) * score);
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
      {/* Header row — label left, status right (design board). */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <span style={{ ...subhead(t), marginBottom: 0 }}>Fatigue index</span>
        <span
          style={{
            fontFamily: "'Fira Code', ui-monospace, 'SF Mono', Menlo, monospace",
            fontSize: 12.5,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            color: rested ? "#0F6E64" : "#8A4B38",
          }}
        >
          {rested ? "well rested :)" : "Get some rest."}
        </span>
      </div>

      {/* Quilt — separated square tiles (design board), not a solid block.
          Gaps let the paper ground read between tiles so it reads as a
          quilt of days rather than merged vertical bars. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 4,
          width: "100%",
        }}
      >
        {days.map((d) => {
          const isInteractive = !!onSelectDate;
          const bg = colorForScore(d.score, d.hasShift, t.bgElev2);
          const ringStyle: React.CSSProperties = {};
          if (d.isSelected) {
            ringStyle.boxShadow = `inset 0 0 0 2px ${t.text}`;
          } else if (d.isToday) {
            ringStyle.boxShadow = "inset 0 0 0 2px #0F6E64";
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
                aspectRatio: "1",
                borderRadius: 3,
                ...ringStyle,
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
            background: "linear-gradient(90deg, #0F6E64 0%, #8A4B38 100%)",
          }}
        />
        <span>Deficit</span>
      </div>
    </div>
  );
}

function subhead(t: import("../theme").ThemeTokens): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 600,
    color: t.text3,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginBottom: 6,
  };
}
