import { MONTHS_LONG, type ShiftMap } from "../data";
import type { Palette, ThemeTokens } from "../theme";
import { MiniMonth } from "./MiniMonth";

interface Props {
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  shifts: ShiftMap;
  viewYear: number;
  selected: string;
  onSelectDate: (key: string) => void;
  onDrillIntoMonth: (mo: number) => void;
}

/**
 * 12 mini-months in a 4×3 grid. Clicking a day drills into Month view on
 * that date; clicking the month label drills into Month view on that month.
 */
export function YearView({
  palette, t, dark, shifts, viewYear, selected, onSelectDate, onDrillIntoMonth,
}: Props) {
  return (
    <div
      style={{
        flex: 1,
        padding: 18,
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gridTemplateRows: "repeat(3, 1fr)",
        gap: 16,
        overflow: "auto",
      }}
    >
      {MONTHS_LONG.map((monthName, mo) => (
        <div
          key={mo}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 10,
            borderRadius: 10,
            background: t.bgElev,
            border: `0.5px solid ${t.sep}`,
            minHeight: 0,
          }}
        >
          <button
            type="button"
            onClick={() => onDrillIntoMonth(mo)}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 700,
              color: t.text,
              letterSpacing: "-0.01em",
              cursor: "pointer",
              textAlign: "left",
            }}
            title={`Open ${monthName} ${viewYear}`}
          >
            {monthName}
          </button>
          <MiniMonth
            y={viewYear}
            mo={mo}
            palette={palette}
            t={t}
            dark={dark}
            shifts={shifts}
            selected={selected}
            onSelect={onSelectDate}
          />
        </div>
      ))}
    </div>
  );
}
