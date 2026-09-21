import type { Palette, ThemeTokens } from "../theme";
import { rgba } from "../theme";
import {
  TIMELINE_START_MIN,
  TIMELINE_END_MIN,
  TIMELINE_SPAN_MIN,
  type DaySegments,
} from "../lib/computeOverlap";

export interface Range { startMin: number; endMin: number; }

interface Props {
  /** "YYYY-MM-DD" of the day being shown. */
  date: string;
  /** Each parent's working hours (solid) + resting hours (hatched). */
  self: DaySegments;
  partner: DaySegments;
  /** The coverage window for this day (request or candidate). */
  coverage: Range | null;
  /** Daisy's school time (when she can't cover). Lane hidden when empty. */
  daisy?: Range[];
  daisyName?: string;
  selfName: string;
  partnerName: string;
  /** Assigned-shifts heading omits the weekday; the batch one includes it. */
  includeWeekday?: boolean;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
}

const TICKS = ["6a", "9a", "12p", "3p", "6p", "9p", "12a"];
const DAISY_COLOR = "#FF9F0A";   // amber — Daisy's school time (unavailable to cover)

/** Minutes-past-midnight → "5pm" / "11:30pm" style label. */
function label(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h < 12 ? "am" : "pm";
  h = h % 12 || 12;
  return mm === 0 ? `${h}${ap}` : `${h}:${String(mm).padStart(2, "0")}${ap}`;
}

function spanLabel(ranges: Range[]): string {
  if (ranges.length === 0) return "";
  const start = Math.min(...ranges.map((r) => r.startMin));
  const end = Math.max(...ranges.map((r) => r.endMin));
  return `${label(start)}–${label(end)}`;
}

/** Absolute left/width as % of the 6am–midnight axis, clamped both ends. */
function pos(r: Range): { left: string; width: string } {
  const start = Math.max(r.startMin, TIMELINE_START_MIN);
  const end = Math.min(r.endMin, TIMELINE_END_MIN);
  const left = ((start - TIMELINE_START_MIN) / TIMELINE_SPAN_MIN) * 100;
  const width = ((end - start) / TIMELINE_SPAN_MIN) * 100;
  return { left: `${Math.max(0, left)}%`, width: `${Math.max(0, width)}%` };
}

/** Diagonal-hatch fill for resting hours. */
function hatch(color: string): string {
  return `repeating-linear-gradient(45deg, ${rgba(color, 0.55)} 0, ${rgba(color, 0.55)} 2px, ${rgba(color, 0.12)} 2px, ${rgba(color, 0.12)} 6px)`;
}

export function DayTimeline({
  date, self, partner, coverage, daisy, daisyName, selfName, partnerName,
  includeWeekday, palette, t, dark,
}: Props) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const heading = includeWeekday
    ? `${dt.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · DAY TIMELINE`
    : `${dt.toLocaleDateString(undefined, { month: "long", day: "numeric" })} · DAY TIMELINE`;

  const coverageColor = "#159c43";
  const trackBg = dark ? "rgba(255,255,255,0.06)" : "#ececef";

  const lanes: { key: string; name: string; color: string; seg: DaySegments }[] = [
    { key: "g", name: selfName, color: palette.G, seg: self },
    { key: "k", name: partnerName, color: palette.K, seg: partner },
  ];

  return (
    <div
      style={{
        margin: "8px 6px 4px",
        background: dark ? "rgba(255,255,255,0.03)" : "#f7f7fa",
        border: `0.5px solid ${t.sep}`,
        borderRadius: 14,
        padding: "16px 18px 12px",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: t.text3, marginBottom: 14 }}>
        {heading}
      </div>

      {lanes.map((lane) => {
        // Label the working hours; if a parent only rests this day, label that.
        const primary = lane.seg.work.length ? lane.seg.work : lane.seg.sleep;
        return (
          <div key={lane.key} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 11 }}>
            <div style={{ width: 92, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: lane.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: t.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {lane.name}
              </span>
            </div>
            <div style={{ position: "relative", flex: 1, height: 20, background: trackBg, borderRadius: 7 }}>
              {/* Resting first, so solid work draws over any overlap. */}
              {lane.seg.sleep.map((r, i) => {
                const p = pos(r);
                return <div key={`s${i}`} style={{ position: "absolute", top: 2, bottom: 2, left: p.left, width: p.width, borderRadius: 6, background: hatch(lane.color) }} />;
              })}
              {lane.seg.work.map((r, i) => {
                const p = pos(r);
                return <div key={`w${i}`} style={{ position: "absolute", top: 2, bottom: 2, left: p.left, width: p.width, borderRadius: 6, background: lane.color }} />;
              })}
            </div>
            <div style={{ width: 92, fontSize: 12, color: t.text3, textAlign: "right", flexShrink: 0 }}>
              {spanLabel(primary) || "—"}
            </div>
          </div>
        );
      })}

      {/* Coverage lane */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 11 }}>
        <div style={{ width: 92, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: coverageColor, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: t.text2 }}>Coverage</span>
        </div>
        <div style={{ position: "relative", flex: 1, height: 20, background: trackBg, borderRadius: 7 }}>
          {coverage && (() => {
            const p = pos(coverage);
            return <div style={{ position: "absolute", top: 2, bottom: 2, left: p.left, width: p.width, borderRadius: 6, background: `linear-gradient(90deg, #2fbe5a, ${coverageColor})`, boxShadow: `0 0 10px ${rgba(coverageColor, 0.5)}` }} />;
          })()}
        </div>
        <div style={{ width: 92, fontSize: 12, color: t.text3, textAlign: "right", flexShrink: 0 }}>
          {coverage ? spanLabel([coverage]) : "—"}
        </div>
      </div>

      {/* Daisy (caregiver) school lane — only when she has school that day. */}
      {daisy && daisy.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 11 }}>
          <div style={{ width: 92, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: DAISY_COLOR, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: t.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {daisyName || "Daisy"}
            </span>
          </div>
          <div style={{ position: "relative", flex: 1, height: 20, background: trackBg, borderRadius: 7 }}>
            {daisy.map((r, i) => {
              const p = pos(r);
              return <div key={i} style={{ position: "absolute", top: 2, bottom: 2, left: p.left, width: p.width, borderRadius: 6, background: DAISY_COLOR }} title="in class — can't cover" />;
            })}
          </div>
          <div style={{ width: 92, fontSize: 12, color: t.text3, textAlign: "right", flexShrink: 0 }}>
            {spanLabel(daisy)} · class
          </div>
        </div>
      )}

      {/* Tick labels aligned to the track area. */}
      <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 104px 0" }}>
        {TICKS.map((tk) => (
          <span key={tk} style={{ fontSize: 10, fontWeight: 600, color: t.text3 }}>{tk}</span>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 8, paddingLeft: 104 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, color: t.text3 }}>
          <span style={{ width: 14, height: 8, borderRadius: 2, background: t.text2 }} /> Working
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, color: t.text3 }}>
          <span style={{ width: 14, height: 8, borderRadius: 2, background: hatch(t.text2) }} /> Resting
        </span>
      </div>
    </div>
  );
}
