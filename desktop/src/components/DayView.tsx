import { DAYS_LONG, MONTHS_LONG, fmtDate, type Shift, type ShiftMap } from "../data";
import { eventColor, personColor, rgba, MANAGER_ORANGE, type Palette, type ThemeTokens } from "../theme";
import type { Event as SbEvent, HouseholdState } from "../state";
import { compactTime } from "../state";
import { parentDaySegments } from "../lib/computeOverlap";
import { PhotoAv } from "./PhotoAv";
import { EventAvatar } from "./EventAvatar";
import { wvuGameLabel, type WvuGame } from "../lib/wvuSchedule";

const COVERAGE_COLOR = "#0F6E64";

/** Diagonal-hatch fill for resting hours — matches the day timeline. */
function hatch(color: string): string {
  return `repeating-linear-gradient(45deg, ${rgba(color, 0.5)} 0, ${rgba(color, 0.5)} 2px, ${rgba(color, 0.1)} 2px, ${rgba(color, 0.1)} 7px)`;
}

/** ISO "YYYY-MM-DD" one day earlier. */
function prevDayKey(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) - 1);
  return fmtDate(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

/** Short end-time label for a carried-over shift, e.g. "7:30a". */
function endLabel(typ: { end: string }): string {
  const [h, mm] = typ.end.split(":").map(Number);
  const ap = (h || 0) < 12 ? "a" : "p";
  const h12 = (h || 0) % 12 || 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}

interface Props {
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  shifts: ShiftMap;
  state: HouseholdState | null;
  selected: string;
  today: string;
  selfName: string;
  partnerName: string;
  events: SbEvent[];
  onEditEvent: (ev: SbEvent) => void;
  wvuGames: Map<string, WvuGame>;
}

const HOUR_START = 0;
const HOUR_END = 24;
const PX_PER_HOUR = 56;

function parseHM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function LegendChip({ swatch, label, t }: { swatch: string; label: string; t: ThemeTokens }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: t.text3 }}>
      <span style={{ width: 16, height: 10, borderRadius: 3, background: swatch }} />
      {label}
    </span>
  );
}

interface PlacedBlock {
  startMin: number;          // relative to HOUR_START * 60
  endMin: number;
}

/** `offsetMin` of -1440 renders the tail of the PREVIOUS day's overnight shift
 *  at the top of this day's column. */
function blockForShift(shift: Shift, state: HouseholdState | null, offsetMin = 0): PlacedBlock | null {
  if (!state || !shift.shiftTypeId) return null;
  const typ = state.shiftTypes.find((s) => s.id === shift.shiftTypeId);
  if (!typ) return null;
  const startMin = parseHM(typ.start) + offsetMin;
  let endMin = parseHM(typ.end);
  if (typ.crossesMidnight || endMin <= parseHM(typ.start)) endMin += 24 * 60;
  endMin += offsetMin;
  const winStart = HOUR_START * 60;
  const winEnd = HOUR_END * 60;
  if (endMin <= winStart || startMin >= winEnd) return null;
  return {
    startMin: Math.max(startMin, winStart) - winStart,
    endMin: Math.min(endMin, winEnd) - winStart,
  };
}

export function DayView({
  palette, t, dark, shifts, state, selected, today, selfName, partnerName,
  events, onEditEvent, wvuGames,
}: Props) {
  const [y, m, d] = selected.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const isToday = selected === today;
  const list = shifts[selected] ?? [];
  const wvuGame = wvuGames.get(selected);
  const daisyName = state?.dependents?.daisy?.name || "Daisy";
  const whoName = (who: string) => who === "G" ? selfName : who === "K" ? partnerName : daisyName;
  const totalHeight = (HOUR_END - HOUR_START) * PX_PER_HOUR;

  return (
    <div style={{ flex: 1, padding: 18, display: "flex", flexDirection: "column", gap: 14, overflow: "hidden", minHeight: 0 }}>
      {/* Day header card */}
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 10,
          background: t.bgElev,
          border: `0.5px solid ${t.sep}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 8,
            background: isToday ? MANAGER_ORANGE : t.bgElev2,
            color: isToday ? "#fff" : t.text,
            border: isToday ? `1.5px solid ${MANAGER_ORANGE}` : `0.5px solid ${t.sep}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", opacity: isToday ? 0.9 : 0.6 }}>
            {MONTHS_LONG[date.getMonth()].slice(0, 3).toUpperCase()}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>
            {date.getDate()}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: t.text, letterSpacing: "-0.02em" }}>
            {DAYS_LONG[date.getDay()]}
          </div>
          <div style={{ fontSize: 12, color: t.text2 }}>
            {list.length === 0 ? "Both off — free day." : `${list.length} shift${list.length === 1 ? "" : "s"}`}
          </div>
          {wvuGame && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <img
                src="assets/wvu.png"
                alt=""
                aria-hidden="true"
                draggable={false}
                style={{ width: 20, height: 19, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.4))" }}
              />
              <span style={{ fontSize: 12, fontWeight: 600, color: t.text2 }}>
                {wvuGameLabel(wvuGame)}
                {wvuGame.tv ? ` · ${wvuGame.tv}` : ""}
              </span>
            </div>
          )}
        </div>
        {list.length > 0 && (
          <div style={{ display: "flex", gap: 6 }}>
            {list.some((s) => s.who === "G") && <PhotoAv who="G" size={28} palette={palette} dark={dark} />}
            {list.some((s) => s.who === "K") && <PhotoAv who="K" size={28} palette={palette} dark={dark} />}
            {list.some((s) => s.who === "D") && <PhotoAv who="D" size={28} palette={palette} dark={dark} />}
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginTop: -4 }}>
        <LegendChip swatch={rgba(palette.G, 0.5)} label="Working" t={t} />
        <LegendChip swatch={hatch(t.text2)} label="Resting" t={t} />
        <LegendChip swatch={`linear-gradient(180deg, #56B7A9, ${COVERAGE_COLOR})`} label="Coverage" t={t} />
      </div>

      {/* Timeline */}
      <div style={{ flex: 1, overflow: "auto", borderRadius: 10, border: `0.5px solid ${t.sep}` }}>
        <div
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: "60px 1fr",
            height: totalHeight,
          }}
        >
          {/* Hour rail */}
          <div style={{ position: "relative", borderRight: `0.5px solid ${t.sep}` }}>
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
                    top: i * PX_PER_HOUR - 7,
                    right: 8,
                    fontSize: 11,
                    color: t.text3,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {h12}{ampm}
                </div>
              );
            })}
          </div>

          {/* Track */}
          <div style={{ position: "relative", background: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
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
            {/* Current-time indicator if today */}
            {isToday && (() => {
              const now = new Date();
              const minutesFromStart = now.getHours() * 60 + now.getMinutes() - HOUR_START * 60;
              const top = (minutesFromStart / 60) * PX_PER_HOUR;
              if (top < 0 || top > totalHeight) return null;
              return (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top,
                    height: 2,
                    background: MANAGER_ORANGE,
                    zIndex: 2,
                    pointerEvents: "none",
                  }}
                />
              );
            })()}
            {/* Resting hours — hatched, under the solid work blocks. Same
                per-parent sleep the day timeline and week view draw. */}
            {state && (["G", "K"] as const).flatMap((who) => {
              const color = personColor(who, palette);
              return parentDaySegments(selected, who, shifts, state).sleep.map((r, i) => {
                const top = ((r.startMin - HOUR_START * 60) / 60) * PX_PER_HOUR;
                const height = ((r.endMin - r.startMin) / 60) * PX_PER_HOUR;
                if (height <= 0) return null;
                return (
                  <div
                    key={`rest-${who}-${i}`}
                    style={{ position: "absolute", left: 8, right: 8, top, height, borderRadius: 6, background: hatch(color), opacity: 0.75, pointerEvents: "none" }}
                    title={`${who} resting`}
                  />
                );
              });
            })}

            {/* Coverage window — green stripe on the right edge. */}
            {(state?.coverageRequests ?? [])
              .filter((r) => r.date === selected && (r.status === "pending" || r.status === "confirmed"))
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
                      // Right-side block, half the width of a shift block.
                      position: "absolute", right: 8, width: "calc(50% - 10px)", top, height: Math.max(height, 22),
                      borderRadius: 6, background: `linear-gradient(180deg, ${rgba("#56B7A9", 0.9)}, ${rgba(COVERAGE_COLOR, 0.9)})`,
                      boxShadow: `0 0 8px ${rgba(COVERAGE_COLOR, 0.4)}`, padding: "4px 8px", overflow: "hidden",
                      color: "#fff", fontSize: 10.5, fontWeight: 700, letterSpacing: "-0.01em", pointerEvents: "none",
                    }}
                    title={`Coverage ${r.startTime}–${r.endTime}`}
                  >
                    Coverage
                  </div>
                );
              })}

            {/* Overnight carry-over: tail of the previous day's cross-midnight shift. */}
            {(shifts[prevDayKey(selected)] ?? []).map((s, i) => {
              const block = blockForShift(s, state, -24 * 60);
              if (!block) return null;
              const typ = state?.shiftTypes.find((x) => x.id === s.shiftTypeId);
              const color = personColor(s.who, palette);
              const top = (block.startMin / 60) * PX_PER_HOUR;
              const height = ((block.endMin - block.startMin) / 60) * PX_PER_HOUR;
              if (height <= 1) return null;
              return (
                <div
                  key={`tail-${i}`}
                  style={{ position: "absolute", left: 8, right: 8, top, height: Math.max(height, 22), background: rgba(color, 0.22), borderLeft: `3px solid ${color}`, borderRadius: 6, padding: "6px 10px", color: dark ? "#fff" : t.text, overflow: "hidden" }}
                  title={`${s.who} · ${s.label} — overnight, ends ${typ ? endLabel(typ) : ""}`}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "-0.01em" }}>
                    {whoName(s.who)} · until {typ ? endLabel(typ) : ""}
                  </div>
                </div>
              );
            })}

            {/* Event blocks (outlined; click to edit) */}
            {events.map((ev) => {
              if (!ev.startTime) return null;
              const [sh, sm] = ev.startTime.split(":").map(Number);
              const startAbs = (sh || 0) * 60 + (sm || 0);
              let endAbs = startAbs + 60;
              if (ev.endTime) {
                const [eh, em] = ev.endTime.split(":").map(Number);
                endAbs = (eh || 0) * 60 + (em || 0);
                if (endAbs <= startAbs) endAbs = startAbs + 30;
              }
              const top = (startAbs / 60) * PX_PER_HOUR;
              const height = ((endAbs - startAbs) / 60) * PX_PER_HOUR;
              const color = ev.pending ? "#8A4B38" : eventColor(ev.who, palette);
              return (
                <div
                  key={ev.id}
                  onClick={(e) => { e.stopPropagation(); onEditEvent(ev); }}
                  style={{
                    position: "absolute",
                    left: 8,
                    right: 8,
                    top,
                    height: Math.max(height, 28),
                    background: "transparent",
                    border: `1px dashed ${rgba(color, 0.7)}`,
                    borderRadius: 6,
                    padding: "6px 10px",
                    color: dark ? "#fff" : t.text,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    overflow: "hidden",
                    cursor: "pointer",
                    zIndex: 1,
                  }}
                  title={ev.title}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <EventAvatar who={ev.who} size={18} palette={palette} dark={dark} />
                    <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em" }}>
                      {ev.title}
                    </div>
                  </div>
                  {ev.notes && (
                    <div style={{ fontSize: 10.5, color: dark ? "rgba(255,255,255,0.65)" : t.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ev.notes}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Shift blocks */}
            {list.map((s, i) => {
              const block = blockForShift(s, state);
              if (!block) return null;
              const color = personColor(s.who, palette);
              const top = (block.startMin / 60) * PX_PER_HOUR;
              const height = ((block.endMin - block.startMin) / 60) * PX_PER_HOUR;
              const typ = state?.shiftTypes.find((typ) => typ.id === s.shiftTypeId);
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: 8,
                    right: 8,
                    top,
                    height: Math.max(height, 28),
                    background: rgba(color, 0.22),
                    borderLeft: `3px solid ${color}`,
                    borderRadius: 6,
                    padding: "6px 10px",
                    color: dark ? "#fff" : t.text,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    overflow: "hidden",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "-0.01em" }}>
                    {whoName(s.who)} · {s.label}
                  </div>
                  {typ && (
                    <div style={{ fontSize: 10.5, color: dark ? "rgba(255,255,255,0.65)" : t.text2 }}>
                      {typ.name} ({compactTime(typ.start)} → {compactTime(typ.end)}{typ.crossesMidnight ? ", next day" : ""})
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
