import type { Palette, ThemeTokens } from "../theme";
import { rgba } from "../theme";
import {
  TIMELINE_START_MIN,
  TIMELINE_SPAN_MIN,
} from "../lib/computeOverlap";

export interface Range { startMin: number; endMin: number; }

interface Props {
  /** "YYYY-MM-DD" of the day being shown. */
  date: string;
  /** Each parent's unavailable ranges on the axis (from parentDayRanges). */
  selfRanges: Range[];
  partnerRanges: Range[];
  /** The coverage window for this day (request or candidate). */
  coverage: Range | null;
  selfName: string;
  partnerName: string;
  /** Assigned-shifts heading omits the weekday; the batch one includes it. */
  includeWeekday?: boolean;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
}

const TICKS = ["6a", "9a", "12p", "3p", "6p", "9p", "12a"];

/** Minutes-past-midnight → "5pm" / "11:30pm" style label. */
function label(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h < 12 ? "am" : "pm";
  h = h % 12 || 12;
  return mm === 0 ? `${h}${ap}` : `${h}:${String(mm).padStart(2, "0")}${ap}`;
}

function rangeLabel(ranges: Range[]): string {
  if (ranges.length === 0) return "—";
  const start = Math.min(...ranges.map((r) => r.startMin));
  const end = Math.max(...ranges.map((r) => r.endMin));
  return `${label(start)}–${label(end)}`;
}

/** Absolute left/width as % of the 6am–midnight axis. */
function pos(r: Range): { left: string; width: string } {
  const left = ((r.startMin - TIMELINE_START_MIN) / TIMELINE_SPAN_MIN) * 100;
  const width = ((r.endMin - r.startMin) / TIMELINE_SPAN_MIN) * 100;
  return { left: `${Math.max(0, left)}%`, width: `${Math.max(0, Math.min(100 - Math.max(0, left), width))}%` };
}

export function DayTimeline({
  date, selfRanges, partnerRanges, coverage, selfName, partnerName,
  includeWeekday, palette, t, dark,
}: Props) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const heading = includeWeekday
    ? `${dt.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · DAY TIMELINE`
    : `${dt.toLocaleDateString(undefined, { month: "long", day: "numeric" })} · DAY TIMELINE`;

  const coverageColor = "#159c43";

  const lanes: { key: string; name: string; color: string; ranges: Range[]; glow?: boolean }[] = [
    { key: "g", name: selfName,    color: palette.G, ranges: selfRanges },
    { key: "k", name: partnerName, color: palette.K, ranges: partnerRanges },
    { key: "c", name: "Coverage",  color: coverageColor, ranges: coverage ? [coverage] : [], glow: true },
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

      {lanes.map((lane) => (
        <div key={lane.key} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 11 }}>
          <div style={{ width: 92, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: lane.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: t.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {lane.name}
            </span>
          </div>
          <div style={{ position: "relative", flex: 1, height: 20, background: dark ? "rgba(255,255,255,0.06)" : "#ececef", borderRadius: 7 }}>
            {lane.ranges.map((r, i) => {
              const p = pos(r);
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    top: 2,
                    bottom: 2,
                    left: p.left,
                    width: p.width,
                    borderRadius: 6,
                    background: lane.glow
                      ? `linear-gradient(90deg, #2fbe5a, ${lane.color})`
                      : lane.color,
                    boxShadow: lane.glow ? `0 0 10px ${rgba(coverageColor, 0.5)}` : "none",
                  }}
                />
              );
            })}
          </div>
          <div style={{ width: 92, fontSize: 12, color: t.text3, textAlign: "right", flexShrink: 0 }}>
            {rangeLabel(lane.ranges)}
          </div>
        </div>
      ))}

      {/* Tick labels aligned to the track area (offset by the 92px + 12px gap
          label column on each side). */}
      <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 104px 0" }}>
        {TICKS.map((tk) => (
          <span key={tk} style={{ fontSize: 10, fontWeight: 600, color: t.text3 }}>{tk}</span>
        ))}
      </div>
    </div>
  );
}
