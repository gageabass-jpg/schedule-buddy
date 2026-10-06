import type { ThemeTokens } from "../theme";

/**
 * "Holiday pay" beside a shift's hours in the day popover and the day card,
 * on a Gage or Kaylene shift worked on a federal holiday (both get holiday
 * pay). Teal, the house "good".
 */
export function HolidayPayTag({ t, fontSize = 11 }: { t: ThemeTokens; fontSize?: number }) {
  return (
    <span
      style={{
        flexShrink: 0, padding: "2px 6px", borderRadius: 3,
        background: t.tealTint, color: t.tealText,
        fontSize, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap",
      }}
    >
      Holiday pay
    </span>
  );
}
