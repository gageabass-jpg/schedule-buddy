import { buildMonthGrid, fmtDate, dayKindFromShifts, WEEKDAYS_3, type ShiftMap } from "../data";
import type { ViewFilter } from "../App";
import { dayColors, personColor, rgba, MANAGER_ORANGE, type Palette, type ThemeTokens } from "../theme";

interface Props {
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  flat: boolean;
  shifts: ShiftMap;
  viewYear: number;
  viewMonth: number;
  selected: string;
  today: string;
  onSelectDate: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNewShift: () => void;
  onEditTemplate: () => void;
  onEditShiftTypes: () => void;
  viewFilter: ViewFilter;
}

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function MonthGrid({
  palette, t, dark, flat, shifts, viewYear, viewMonth, selected, today,
  onSelectDate, onPrev, onNext, onToday, onNewShift, onEditTemplate, onEditShiftTypes,
  viewFilter,
}: Props) {
  const weeks = buildMonthGrid(viewYear, viewMonth);

  // Sun..Sat range that contains "today", as ISO strings for cheap comparison.
  const [ty, tm, td] = today.split("-").map(Number);
  const todayDate = new Date(ty, tm - 1, td);
  const weekStartDate = new Date(todayDate);
  weekStartDate.setDate(todayDate.getDate() - todayDate.getDay());
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekStartDate.getDate() + 6);
  const weekStartKey = fmtDate(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate());
  const weekEndKey = fmtDate(weekEndDate.getFullYear(), weekEndDate.getMonth(), weekEndDate.getDate());

  return (
    <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 18px",
          borderBottom: `0.5px solid ${t.sep}`,
          background: t.bg,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: t.text, letterSpacing: "-0.02em" }}>
            {MONTH_LABELS[viewMonth]}
          </span>
          <span style={{ fontSize: 22, fontWeight: 400, color: t.text2, letterSpacing: "-0.02em" }}>
            {viewYear}
          </span>
        </div>
        <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
          <button style={navBtn(t)} type="button" onClick={onPrev}>‹</button>
          <button
            style={{ ...navBtn(t), padding: "0 10px", width: "auto", fontSize: 12, fontWeight: 600 }}
            type="button"
            onClick={onToday}
          >Today</button>
          <button style={navBtn(t)} type="button" onClick={onNext}>›</button>
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            padding: 2,
            borderRadius: 6,
            background: dark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.06)",
          }}
        >
          {["Day", "Week", "Month", "Year"].map((v) => (
            <button
              key={v}
              type="button"
              style={{
                padding: "3px 10px",
                border: 0,
                borderRadius: 4,
                background: v === "Month" ? (dark ? "#3A3A3C" : "#fff") : "transparent",
                color: t.text,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: v === "Month" ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onEditShiftTypes}
          style={secondaryToolbarBtn(t)}
        >
          Shift types
        </button>
        <button
          type="button"
          onClick={onEditTemplate}
          style={secondaryToolbarBtn(t)}
        >
          Template
        </button>
        <button
          type="button"
          onClick={onNewShift}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 11px",
            borderRadius: 6,
            border: 0,
            background: palette.G,
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + New shift
        </button>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, padding: 14, display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {WEEKDAYS_3.map((w, i) => (
            <div
              key={w}
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: i === 0 || i === 6 ? rgba(palette.G, 0.85) : t.text3,
                padding: "4px 6px",
              }}
            >
              {w}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateRows: `repeat(${weeks.length}, 1fr)`, gap: 4, minHeight: 0 }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
              {week.map((c, ci) => {
                const key = fmtDate(c.y, c.mo, c.d);
                const dayShifts = shifts[key];
                const kind = dayKindFromShifts(dayShifts);
                const colors = dayColors(kind, palette, dark);
                const isToday = key === today;
                const isSel = key === selected;
                const matchesFilter =
                  viewFilter === "all" ||
                  (viewFilter === "both" && kind === "both") ||
                  (viewFilter === "couple" && kind === "off") ||
                  (viewFilter === "this-week" && key >= weekStartKey && key <= weekEndKey);
                const cellOpacity = c.other ? 0.4 : matchesFilter ? 1 : 0.3;
                return (
                  <button
                    key={ci}
                    type="button"
                    onClick={() => onSelectDate(key)}
                    style={{
                      border: 0,
                      padding: 6,
                      cursor: "pointer",
                      textAlign: "left",
                      background: kind === "off" ? t.bgElev : colors.tint,
                      borderRadius: 8,
                      opacity: cellOpacity,
                      transition: "opacity 0.15s",
                      boxShadow: isSel
                        ? `inset 0 0 0 2px ${colors.accent}`
                        : isToday
                          ? `inset 0 0 0 1.5px ${MANAGER_ORANGE}`
                          : "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                      overflow: "hidden",
                      minHeight: 0,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: isToday ? 700 : 600,
                          color: isToday ? "#fff" : t.text,
                          background: isToday ? MANAGER_ORANGE : "transparent",
                          borderRadius: 999,
                          padding: isToday ? "1px 6px" : "1px 0",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {c.d}
                      </span>
                      {dayShifts && dayShifts.length > 1 && (
                        <span style={{ fontSize: 9, color: t.text3, fontWeight: 600 }}>{dayShifts.length}</span>
                      )}
                    </div>
                    {dayShifts && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {dayShifts.slice(0, 3).map((s, i) => {
                          const color = personColor(s.who, palette);
                          return (
                            <div
                              key={i}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 10.5,
                                fontWeight: 600,
                                letterSpacing: "-0.01em",
                                padding: "1px 5px",
                                borderRadius: 4,
                                background: flat ? color : rgba(color, 0.28),
                                color: flat ? "#fff" : t.text,
                                borderLeft: flat ? "none" : `2px solid ${color}`,
                              }}
                            >
                              <span style={{ opacity: 0.85 }}>{s.who}</span>
                              <span>{s.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function navBtn(t: ThemeTokens): React.CSSProperties {
  return {
    width: 26,
    height: 26,
    borderRadius: 5,
    border: 0,
    background: "transparent",
    color: t.text2,
    fontSize: 14,
    cursor: "pointer",
  };
}

function secondaryToolbarBtn(t: ThemeTokens): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 11px",
    borderRadius: 6,
    border: `0.5px solid ${t.sep}`,
    background: "transparent",
    color: t.text,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}
