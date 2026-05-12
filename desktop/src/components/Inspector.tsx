import { SHIFTS, dayKindFromShifts, MONTHS_LONG, WEEKDAYS_3 } from "../data";
import { dayColors, personColor, rgba, type Palette, type ThemeTokens } from "../theme";
import { PhotoAv } from "./PhotoAv";

interface Props {
  selected: string;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
}

export function Inspector({ selected, palette, t, dark }: Props) {
  const [y, m, d] = selected.split("-").map(Number);
  const shifts = SHIFTS[selected];
  const kind = dayKindFromShifts(shifts);
  const colors = dayColors(kind, palette, dark);
  const accent = colors.accent;
  const dayLabel = `${WEEKDAYS_3[new Date(y, m - 1, d).getDay()]} · ${MONTHS_LONG[m - 1]} ${d}`;

  return (
    <div
      style={{
        background: dark ? "rgba(20,20,22,0.5)" : "rgba(255,255,255,0.6)",
        borderLeft: `0.5px solid ${t.sep}`,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        overflow: "hidden",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* Quick add */}
      <div>
        <div style={subhead(t)}>Add shift</div>
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            background: t.bgElev,
            border: `0.5px solid ${t.sep}`,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontSize: 13, color: t.text, fontWeight: 500, letterSpacing: "-0.01em" }}>
            Kaylene 7p Thursday
          </div>
          <div style={{ fontSize: 11, color: t.text3 }}>
            Parsed: <span style={{ color: accent, fontWeight: 600 }}>K · 7p · Apr 9</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
          {["next 4 weeks", "weekly", "weekends"].map((s) => (
            <span
              key={s}
              style={{
                fontSize: 10.5,
                padding: "2px 7px",
                borderRadius: 999,
                background: t.bgElev,
                color: t.text2,
                border: `0.5px solid ${t.sep}`,
              }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Selected day card */}
      <div
        style={{
          borderRadius: 12,
          padding: 14,
          background: kind === "off" ? t.bgElev : rgba(accent, dark ? 0.18 : 0.10),
          border: `0.5px solid ${kind === "off" ? t.sep : rgba(accent, 0.35)}`,
        }}
      >
        <div style={subhead(t)}>{dayLabel}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: t.text, letterSpacing: "-0.02em", marginTop: 2 }}>
          {kind === "off"
            ? "Both off"
            : kind === "both"
              ? "Both working"
              : kind === "g"
                ? "Gage works"
                : "Kaylene works"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {(shifts ?? []).map((s, i) => {
            const c = personColor(s.who, palette);
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 8px",
                  borderRadius: 8,
                  background: t.bgElev,
                }}
              >
                <PhotoAv who={s.who} size={26} palette={palette} dark={dark} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>
                    {s.who === "G" ? "Gage" : "Kaylene"}
                  </div>
                  <div style={{ fontSize: 10.5, color: t.text3 }}>{s.label} – next morning</div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: rgba(c, 0.18),
                    color: c,
                    fontWeight: 600,
                  }}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
          {(!shifts || shifts.length === 0) && (
            <div style={{ fontSize: 12, color: t.text3, padding: 8 }}>Free day. Plan something together.</div>
          )}
        </div>
      </div>

      {/* This week stats */}
      <div>
        <div style={{ ...subhead(t), marginBottom: 6 }}>This week</div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: t.bgElev,
            border: `0.5px solid ${t.sep}`,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
          }}
        >
          <Stat label="Together" value="3" sub="evenings" color={palette.BOTH} t={t} />
          <Stat label="G shifts" value="4" sub="hours: 36" color={palette.G} t={t} />
          <Stat label="K shifts" value="2" sub="hours: 24" color={palette.K} t={t} />
        </div>
      </div>
    </div>
  );
}

function subhead(t: ThemeTokens): React.CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 700,
    color: t.text3,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: 4,
  };
}

function Stat({ label, value, sub, color, t }: { label: string; value: string; sub: string; color?: string; t: ThemeTokens }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: t.text3, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: color ?? t.text,
          letterSpacing: "-0.03em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10, color: t.text3 }}>{sub}</div>
    </div>
  );
}
