import { buildMonthGrid, fmtDate, SHIFTS, dayKindFromShifts, MONTHS_LONG, WEEKDAYS_3 } from "../data";
import { dayColors, type Palette, type ThemeTokens } from "../theme";

interface Props {
  y: number;
  mo: number;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  selected?: string;
  onSelect?: (key: string) => void;
}

export function MiniMonth({ y, mo, palette, t, dark, selected, onSelect }: Props) {
  const weeks = buildMonthGrid(y, mo);
  return (
    <div style={{ fontSize: 11 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 4px 6px" }}>
        <span style={{ fontWeight: 600, color: t.text, fontSize: 12 }}>
          {MONTHS_LONG[mo]} {y}
        </span>
        <div style={{ display: "flex", gap: 2 }}>
          <button style={miniBtn(t)} type="button">‹</button>
          <button style={miniBtn(t)} type="button">›</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {WEEKDAYS_3.map((w) => (
          <div key={w} style={{ textAlign: "center", fontSize: 9.5, color: t.text3, fontWeight: 600, letterSpacing: "0.04em", padding: "2px 0" }}>
            {w[0]}
          </div>
        ))}
        {weeks.flat().map((c, i) => {
          const key = fmtDate(c.y, c.mo, c.d);
          const shifts = SHIFTS[key];
          const kind = dayKindFromShifts(shifts);
          const colors = dayColors(kind, palette, dark);
          const isSel = selected === key;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect && onSelect(key)}
              style={{
                aspectRatio: "1",
                border: 0,
                padding: 0,
                cursor: "pointer",
                background: isSel ? colors.accent : kind === "off" ? "transparent" : colors.tint,
                borderRadius: 5,
                color: isSel ? "#fff" : c.other ? t.text3 : t.text,
                fontSize: 10.5,
                fontWeight: isSel ? 700 : 500,
                fontVariantNumeric: "tabular-nums",
                opacity: c.other ? 0.5 : 1,
                position: "relative",
              }}
            >
              {c.d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function miniBtn(t: ThemeTokens): React.CSSProperties {
  return {
    border: 0,
    background: "transparent",
    color: t.text2,
    width: 18,
    height: 18,
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 13,
    padding: 0,
  };
}
