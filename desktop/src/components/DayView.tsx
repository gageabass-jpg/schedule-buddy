import { DAYS_LONG, MONTHS_LONG, fmtDate, type Shift, type ShiftMap } from "../data";
import { eventColor, personColor, rgba, MANAGER_ORANGE, type Palette, type ThemeTokens } from "../theme";
import type { Event as SbEvent, HouseholdState } from "../state";
import { compactTime } from "../state";
import { parentDaySegments } from "../lib/computeOverlap";
import { PhotoAv } from "./PhotoAv";
import { EventAvatar } from "./EventAvatar";
import { BlockTip } from "./BlockTip";
import { wvuGameLabel, type WvuGame } from "../lib/wvuSchedule";
import { assignLanes, laneBox, type Span } from "../lib/lanes";
import { useHouseholdLook } from "../lib/householdLook";

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

/** Where a coverage window sits on the day (px), or null if it's outside it. */
function coverageSpan(r: { startTime: string; endTime: string; endsNextDay?: boolean }): { top: number; height: number } | null {
  const startMin = parseHM(r.startTime);
  let endMin = parseHM(r.endTime);
  if (r.endsNextDay || endMin <= startMin) endMin += 24 * 60;
  const winStart = HOUR_START * 60;
  const winEnd = HOUR_END * 60;
  if (endMin <= winStart || startMin >= winEnd) return null;
  return {
    top: (Math.max(startMin, winStart) - winStart) / 60 * PX_PER_HOUR,
    height: (Math.min(endMin, winEnd) - Math.max(startMin, winStart)) / 60 * PX_PER_HOUR,
  };
}

/** Where a timed event sits on the day (px), as the event block draws it. */
function eventSpan(ev: SbEvent): { top: number; height: number } | null {
  if (!ev.startTime) return null;
  const startAbs = parseHM(ev.startTime);
  let endAbs = startAbs + 60;
  if (ev.endTime) {
    endAbs = parseHM(ev.endTime);
    if (endAbs <= startAbs) endAbs = startAbs + 30;
  }
  return { top: (startAbs / 60) * PX_PER_HOUR, height: ((endAbs - startAbs) / 60) * PX_PER_HOUR };
}

export function DayView({
  palette, t, dark, shifts, state, selected, today, selfName, partnerName,
  events, onEditEvent, wvuGames,
}: Props) {
  const look = useHouseholdLook();
  const [y, m, d] = selected.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const isToday = selected === today;
  const list = shifts[selected] ?? [];
  const wvuGame = wvuGames.get(selected);
  const daisyName = state?.dependents?.daisy?.name || "Daisy";
  const whoName = (who: string) => who === "G" ? selfName : who === "K" ? partnerName : daisyName;
  // Hover cards: avatar, name, then the hours.
  const hours = (a: string, b: string) => `${compactTime(a)} – ${compactTime(b)}`;
  const av = (who: Shift["who"]) => <PhotoAv who={who} size={30} palette={palette} dark={dark} />;
  const eventWho = (who: string) => (who === "G" || who === "K" || who === "D" ? whoName(who) : who === "Daisy" ? daisyName : "Family");
  const totalHeight = (HOUR_END - HOUR_START) * PX_PER_HOUR;

  // Overlapping blocks (a shift, Daisy's class, the coverage window, an
  // event) share the day side by side instead of stacking, so none is hidden
  // under another. Heights include each kind's minimum, since that's what's
  // drawn.
  const covs = (state?.coverageRequests ?? [])
    .filter((r) => r.date === selected && (r.status === "pending" || r.status === "confirmed"));
  const spans: Span[] = [];
  const px = (b: PlacedBlock) => ({ top: (b.startMin / 60) * PX_PER_HOUR, h: ((b.endMin - b.startMin) / 60) * PX_PER_HOUR });
  (shifts[prevDayKey(selected)] ?? []).forEach((s, i) => {
    const b = blockForShift(s, state, -24 * 60);
    if (!b) return;
    const { top, h } = px(b);
    if (h > 1) spans.push({ id: `tail-${i}`, top, bottom: top + Math.max(h, 22) });
  });
  covs.forEach((r, i) => {
    const c = coverageSpan(r);
    if (c) spans.push({ id: `cov-${i}`, top: c.top, bottom: c.top + Math.max(c.height, 22) });
  });
  list.forEach((s, i) => {
    const b = blockForShift(s, state);
    if (!b) return;
    const { top, h } = px(b);
    spans.push({ id: `shift-${i}`, top, bottom: top + Math.max(h, 28) });
  });
  events.forEach((ev) => {
    const b = eventSpan(ev);
    if (b) spans.push({ id: `ev-${ev.id}`, top: b.top, bottom: b.top + Math.max(b.height, 28) });
  });
  const lanes = assignLanes(spans);
  const box = (id: string) => laneBox(lanes.get(id), 8);

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
            {list.length === 0 ? (look.hasPartner ? "Both off — free day." : "Day off.") : `${list.length} shift${list.length === 1 ? "" : "s"}`}
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

            {/* Coverage window — a green block in its own lane. */}
            {covs.map((r, i) => {
                const c = coverageSpan(r);
                if (!c) return null;
                const { top, height } = c;
                return (
                  <BlockTip
                    key={`cov-${i}`}
                    avatar={av("D")}
                    name={daisyName}
                    detail={`Coverage ${hours(r.startTime, r.endTime)} · ${r.status === "confirmed" ? "Confirmed" : "Pending"}`}
                  >
                  <div
                    style={{
                      position: "absolute", ...box(`cov-${i}`), top, height: Math.max(height, 22),
                      borderRadius: 6, background: `linear-gradient(180deg, ${rgba("#56B7A9", 0.9)}, ${rgba(COVERAGE_COLOR, 0.9)})`,
                      boxShadow: `0 0 8px ${rgba(COVERAGE_COLOR, 0.4)}`, padding: "4px 8px", overflow: "hidden",
                      color: "#fff", fontSize: 10.5, fontWeight: 700, letterSpacing: "-0.01em",
                    }}
                  >
                    Coverage
                  </div>
                  </BlockTip>
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
                <BlockTip key={`tail-${i}`} avatar={av(s.who)} name={whoName(s.who)} detail={`Overnight · until ${typ ? endLabel(typ) : ""}`}>
                <div
                  style={{ position: "absolute", ...box(`tail-${i}`), top, height: Math.max(height, 22), background: t.bgElev, border: `1px solid ${t.sep}`, borderLeft: `3px solid ${color}`, borderRadius: 6, padding: "6px 10px", color: t.text, opacity: 0.85, overflow: "hidden" }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "-0.01em" }}>
                    {whoName(s.who)} · until {typ ? endLabel(typ) : ""}
                  </div>
                </div>
                </BlockTip>
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
                <BlockTip
                  key={ev.id}
                  avatar={<EventAvatar who={ev.who} size={30} palette={palette} dark={dark} />}
                  name={ev.title}
                  detail={`${ev.endTime ? hours(ev.startTime, ev.endTime) : compactTime(ev.startTime)} · ${eventWho(ev.who)}`}
                >
                <div
                  onClick={(e) => { e.stopPropagation(); onEditEvent(ev); }}
                  style={{
                    position: "absolute",
                    ...box(`ev-${ev.id}`),
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
                </BlockTip>
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
                <BlockTip
                  key={i}
                  avatar={av(s.who)}
                  name={whoName(s.who)}
                  detail={typ ? `${hours(typ.start, typ.end)} · ${typ.name}` : s.label}
                >
                <div
                  style={{
                    position: "absolute",
                    ...box(`shift-${i}`),
                    top,
                    height: Math.max(height, 28),
                    background: t.bgElev,
                    border: `1px solid ${t.sep}`,
                    borderLeft: `3px solid ${color}`,
                    borderRadius: 6,
                    padding: "6px 10px",
                    color: t.text,
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
                </BlockTip>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
