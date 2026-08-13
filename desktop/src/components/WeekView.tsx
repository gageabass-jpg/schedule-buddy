import { fmtDate, dayKindFromShifts, WEEKDAYS_3, type Shift, type ShiftMap } from "../data";
import type { EventMap } from "../App";
import type { Event as SbEvent, HouseholdState } from "../state";
import { dayColors, eventColor, personColor, rgba, MANAGER_ORANGE, type Palette, type ThemeTokens } from "../theme";
import { eventInitial } from "./EventAvatar";
import { parentDaySegments } from "../lib/computeOverlap";

const COVERAGE_COLOR = "#159c43";

/** Diagonal-hatch fill for resting hours — matches the day timeline. */
function hatch(color: string): string {
  return `repeating-linear-gradient(45deg, ${rgba(color, 0.5)} 0, ${rgba(color, 0.5)} 2px, ${rgba(color, 0.1)} 2px, ${rgba(color, 0.1)} 7px)`;
}

interface Props {
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  shifts: ShiftMap;
  state: HouseholdState | null;
  selected: string;
  today: string;
  onSelectDate: (key: string) => void;
  eventsByDate: EventMap;
  onEditEvent: (ev: SbEvent) => void;
}

const HOUR_START = 6;        // 6am
const HOUR_END = 27;         // 3am next day — covers shifts that cross midnight
const PX_PER_HOUR = 36;

interface PlacedBlock {
  startMin: number;          // minutes from HOUR_START * 60 within the visible range
  endMin: number;
}

function parseHM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function blockForShift(shift: Shift, state: HouseholdState | null): PlacedBlock | null {
  if (!state || !shift.shiftTypeId) return null;
  const typ = state.shiftTypes.find((s) => s.id === shift.shiftTypeId);
  if (!typ) return null;
  let startMin = parseHM(typ.start);
  let endMin = parseHM(typ.end);
  if (typ.crossesMidnight || endMin <= startMin) endMin += 24 * 60;
  const winStart = HOUR_START * 60;
  const winEnd = HOUR_END * 60;
  if (endMin <= winStart || startMin >= winEnd) return null;
  return {
    startMin: Math.max(startMin, winStart) - winStart,
    endMin: Math.min(endMin, winEnd) - winStart,
  };
}

export function WeekView({
  palette, t, dark, shifts, state, selected, today, onSelectDate,
  eventsByDate, onEditEvent,
}: Props) {
  const [sy, sm, sd] = selected.split("-").map(Number);
  const sel = new Date(sy, sm - 1, sd);
  const weekStart = new Date(sel);
  weekStart.setDate(sel.getDate() - sel.getDay());
  const days: Array<{ key: string; date: Date }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    days.push({ key: fmtDate(d.getFullYear(), d.getMonth(), d.getDate()), date: d });
  }

  const totalHeight = (HOUR_END - HOUR_START) * PX_PER_HOUR;

  return (
    <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      {/* Day header strip */}
      <div style={{ display: "grid", gridTemplateColumns: `48px repeat(7, 1fr)`, gap: 4, marginBottom: 8 }}>
        <div />
        {days.map(({ key, date }) => {
          const list = shifts[key];
          const kind = dayKindFromShifts(list);
          const colors = dayColors(kind, palette, dark);
          const isToday = key === today;
          const isSel = key === selected;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(key)}
              style={{
                border: 0,
                padding: "6px 8px",
                background: isSel ? rgba(colors.accent, 0.18) : "transparent",
                borderRadius: 6,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                fontFamily: "inherit",
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700, color: t.text3, letterSpacing: "0.06em" }}>
                {WEEKDAYS_3[date.getDay()].toUpperCase()}
              </span>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: isToday ? "#fff" : t.text,
                  background: isToday ? MANAGER_ORANGE : "transparent",
                  borderRadius: 999,
                  padding: isToday ? "1px 7px" : "1px 0",
                  letterSpacing: "-0.02em",
                }}
              >
                {date.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", padding: "0 0 8px 52px", flexWrap: "wrap" }}>
        <LegendChip swatch={rgba(palette.G, 0.5)} label="Working" t={t} />
        <LegendChip swatch={hatch(t.text2)} label="Resting" t={t} />
        <LegendChip swatch={`linear-gradient(180deg, #2fbe5a, ${COVERAGE_COLOR})`} label="Coverage" t={t} />
      </div>

      {/* Hour rail + 7 day columns */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <div
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: `48px repeat(7, 1fr)`,
            gap: 4,
            height: totalHeight,
          }}
        >
          {/* Hour labels along the left rail */}
          <div style={{ position: "relative" }}>
            {Array.from({ length: HOUR_END - HOUR_START + 1 }).map((_, i) => {
              const hour = HOUR_START + i;
              const dispHour = hour >= 24 ? hour - 24 : hour;
              const ampm = dispHour < 12 ? "a" : "p";
              const h12 = dispHour === 0 ? 12 : dispHour > 12 ? dispHour - 12 : dispHour;
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    top: i * PX_PER_HOUR - 6,
                    right: 4,
                    fontSize: 10,
                    color: t.text3,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {h12}{ampm}
                </div>
              );
            })}
          </div>

          {/* Day columns */}
          {days.map(({ key }) => {
            const isSel = key === selected;
            return (
              <div
                key={key}
                onClick={() => onSelectDate(key)}
                style={{
                  position: "relative",
                  background: isSel ? rgba(palette.G, 0.04) : dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                  border: `0.5px solid ${isSel ? rgba(palette.G, 0.3) : t.sep}`,
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                {/* Hour gridlines */}
                {Array.from({ length: HOUR_END - HOUR_START }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      top: i * PX_PER_HOUR,
                      left: 0,
                      right: 0,
                      borderTop: `0.5px solid ${t.sep}`,
                      pointerEvents: "none",
                    }}
                  />
                ))}
                {/* Resting hours — hatched, under the solid work blocks. Same
                    per-parent sleep windows the day timeline draws. */}
                {state && (["G", "K"] as const).flatMap((who) => {
                  const color = personColor(who, palette);
                  return parentDaySegments(key, who, shifts, state).sleep.map((r, i) => {
                    const top = ((r.startMin - HOUR_START * 60) / 60) * PX_PER_HOUR;
                    const height = ((r.endMin - r.startMin) / 60) * PX_PER_HOUR;
                    if (height <= 0) return null;
                    return (
                      <div
                        key={`rest-${who}-${i}`}
                        style={{
                          position: "absolute", left: 4, right: 4, top, height,
                          borderRadius: 4, background: hatch(color), opacity: 0.75,
                          pointerEvents: "none",
                        }}
                        title={`${who} resting`}
                      />
                    );
                  });
                })}

                {/* Coverage window — green stripe on the right edge. */}
                {(state?.coverageRequests ?? [])
                  .filter((r) => r.date === key && (r.status === "pending" || r.status === "confirmed"))
                  .map((r, i) => {
                    const startMin = parseHM(r.startTime);
                    let endMin = parseHM(r.endTime);
                    if (r.endsNextDay || endMin <= startMin) endMin += 24 * 60;
                    const winStart = HOUR_START * 60;
                    const winEnd = HOUR_END * 60;
                    if (endMin <= winStart || startMin >= winEnd) return null;
                    const top = (Math.max(startMin, winStart) - winStart) / 60 * PX_PER_HOUR;
                    const height = (Math.min(endMin, winEnd) - Math.max(startMin, winStart)) / 60 * PX_PER_HOUR;
                    return (
                      <div
                        key={`cov-${i}`}
                        style={{
                          position: "absolute", right: 3, top, width: 6, height: Math.max(height, 6),
                          borderRadius: 3, background: `linear-gradient(180deg, #2fbe5a, ${COVERAGE_COLOR})`,
                          boxShadow: `0 0 8px ${rgba(COVERAGE_COLOR, 0.5)}`, pointerEvents: "none",
                        }}
                        title={`Coverage ${r.startTime}–${r.endTime}`}
                      />
                    );
                  })}

                {/* Shift blocks */}
                {(shifts[key] ?? []).map((s, i) => {
                  const block = blockForShift(s, state);
                  if (!block) return null;
                  const color = personColor(s.who, palette);
                  const top = (block.startMin / 60) * PX_PER_HOUR;
                  const height = ((block.endMin - block.startMin) / 60) * PX_PER_HOUR;
                  return (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: 4,
                        right: 4,
                        top,
                        height: Math.max(height, 18),
                        background: rgba(color, 0.28),
                        borderLeft: `3px solid ${color}`,
                        borderRadius: 4,
                        padding: "2px 6px",
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: dark ? "#fff" : t.text,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        letterSpacing: "-0.01em",
                      }}
                      title={`${s.who} · ${s.label}`}
                    >
                      <span style={{ opacity: 0.85, marginRight: 4 }}>{s.who}</span>
                      {s.label}
                    </div>
                  );
                })}
                {/* Event blocks (outlined, distinct from shifts) */}
                {(eventsByDate[key] ?? []).map((ev) => {
                  const block = blockForEvent(ev);
                  if (!block) return null;
                  const color = eventColor(ev.who, palette);
                  const top = (block.startMin / 60) * PX_PER_HOUR;
                  const height = ((block.endMin - block.startMin) / 60) * PX_PER_HOUR;
                  return (
                    <div
                      key={ev.id}
                      onClick={(e) => { e.stopPropagation(); onEditEvent(ev); }}
                      style={{
                        position: "absolute",
                        left: 4,
                        right: 4,
                        top,
                        height: Math.max(height, 18),
                        background: "transparent",
                        border: `1px dashed ${rgba(color, 0.7)}`,
                        borderRadius: 4,
                        padding: "2px 6px",
                        fontSize: 10.5,
                        fontWeight: 500,
                        color: dark ? "#fff" : t.text,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        letterSpacing: "-0.01em",
                        cursor: "pointer",
                      }}
                      title={ev.title}
                    >
                      <span style={{ marginRight: 4, fontSize: 9.5, fontWeight: 700, color }}>
                        {eventInitial(ev.who)}
                      </span>
                      {ev.title}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LegendChip({ swatch, label, t }: { swatch: string; label: string; t: ThemeTokens }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: t.text3 }}>
      <span style={{ width: 16, height: 10, borderRadius: 3, background: swatch }} />
      {label}
    </span>
  );
}

function blockForEvent(ev: SbEvent): { startMin: number; endMin: number } | null {
  if (!ev.startTime) return null;       // all-day events not on the timeline (could add a separate strip later)
  const [sh, sm] = ev.startTime.split(":").map(Number);
  const startAbs = (sh || 0) * 60 + (sm || 0);
  let endAbs = startAbs + 60;           // default 1-hour block if no end time
  if (ev.endTime) {
    const [eh, em] = ev.endTime.split(":").map(Number);
    endAbs = (eh || 0) * 60 + (em || 0);
    if (endAbs <= startAbs) endAbs = startAbs + 30;  // fall back if user typed nonsense
  }
  const winStart = HOUR_START * 60;
  const winEnd = HOUR_END * 60;
  if (endAbs <= winStart || startAbs >= winEnd) return null;
  return {
    startMin: Math.max(startAbs, winStart) - winStart,
    endMin: Math.min(endAbs, winEnd) - winStart,
  };
}
