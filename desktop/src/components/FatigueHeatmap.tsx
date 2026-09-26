import { useMemo } from "react";
import type { ShiftMap } from "../data";
import type { HouseholdState } from "../state";
import type { ThemeTokens } from "../theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChartTooltipCard } from "@/components/ui/chart-tooltip";

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

/** One working parent's side of a day's score. `gapMin` is the time between
 *  their last shift ending and this one starting; null when they had no
 *  shift in the three days before. */
interface PersonFatigue {
  who: "G" | "K";
  shiftName: string;
  score: number;
  gapMin: number | null;
}

function fatigueDetail(date: string, shifts: ShiftMap, state: HouseholdState): PersonFatigue[] {
  const dayShifts = shifts[date] ?? [];
  const todayDt = parseIsoDate(date);
  const out: PersonFatigue[] = [];

  for (const s of dayShifts) {
    if (s.who !== "G" && s.who !== "K") continue;
    const stype = state.shiftTypes.find((t) => t.id === s.shiftTypeId);
    if (!stype) continue;
    const todayStart = parseHM(stype.start);

    let foundRest: number | null = null;
    let gapMin: number | null = null;
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
      gapMin = totalGap;
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
    out.push({ who: s.who, shiftName: stype.name, score, gapMin });
  }
  return out;
}

/** The day's score is the more tired of the two. */
function fatigueForDay(date: string, shifts: ShiftMap, state: HouseholdState): number {
  return fatigueDetail(date, shifts, state).reduce((worst, p) => Math.max(worst, p.score), 0);
}

/** 690 → "11.5h", 720 → "12h" — to the half hour. */
function fmtHours(min: number): string {
  const h = Math.round(min / 30) / 2;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/** Say the level, not the number. */
function fatigueWord(score: number, gapMin: number | null): string {
  if (gapMin == null) return "Fresh";
  if (score >= 1) return "Exhausted";
  if (score >= 0.7) return "Short on sleep";
  if (score >= 0.4) return "Tired";
  if (score >= 0.15) return "Fine";
  return "Rested";
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
  const selfName = state?.selfName || "Gage";
  const partnerName = state?.partner?.name || "Kaylene";
  const { days, todayScore } = useMemo(() => {
    if (!state) return { days: [], todayScore: 0 };
    const sel = parseIsoDate(anchorDate);
    const sun = new Date(sel);
    sun.setDate(sel.getDate() - sel.getDay());
    const todayIso = isoFromDate(new Date());
    const out: { iso: string; score: number; people: PersonFatigue[]; isToday: boolean; isSelected: boolean; hasShift: boolean }[] = [];
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(sun);
      d.setDate(sun.getDate() + i);
      const iso = isoFromDate(d);
      const people = fatigueDetail(iso, shifts, state);
      out.push({
        iso,
        score: people.reduce((worst, p) => Math.max(worst, p.score), 0),
        people,
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
            fontSize: 13,
            fontWeight: 600,
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
          const [yy, mm, dd] = d.iso.split("-").map(Number);
          const label = new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
          const payload = d.people.length > 0
            ? d.people.map((p) => ({
                name: `${p.who === "G" ? selfName : partnerName} · ${fatigueWord(p.score, p.gapMin)}`,
                value: p.gapMin == null ? "—" : `${fmtHours(p.gapMin)} off`,
                fill: colorForScore(p.score, true, t.bgElev2),
              }))
            : [{ name: "Neither of you works", value: "Off", fill: t.sep }];
          return (
            <Tooltip key={d.iso} delayDuration={120}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onSelectDate?.(d.iso)}
                  aria-label={`${label}: ${payload.map((r) => `${r.name}, ${r.value}`).join("; ")}`}
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
              </TooltipTrigger>
              {/* The chart card is the whole tooltip, so the tooltip's own
                  chrome is stripped and it only positions and animates. */}
              <TooltipContent side="top" className="overflow-visible border-0 bg-transparent p-0 shadow-none">
                <ChartTooltipCard label={label} payload={payload} indicator="dot" className="min-w-[11rem]" />
              </TooltipContent>
            </Tooltip>
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
