import { FireIcon } from "@/components/ui/fire";
import { FLAG_RED } from "./DayFlagPopover";
import type { StretchDay } from "../lib/stretch";

/** The stretch mark's red: the flag's, the one red Nucleus allows. */
export const STRETCH_RED = FLAG_RED;

/**
 * "🔥 2/3" beside a shift's hours in the day popover and the day card: this
 * shift is day 2 of a 3-day stretch. The flame flickers when hovered.
 * fontSize matches the hours beside it (13 in the popover, 14 in the day
 * card) and the line height is left alone, so "2/3" sits on the same line as
 * the times.
 */
export function StretchBadge({ stretch, name, size = 14, fontSize = 13 }: {
  stretch: StretchDay; name: string; size?: number; fontSize?: number;
}) {
  return (
    <span
      role="img"
      aria-label={`${name}'s stretch, day ${stretch.day} of ${stretch.of}`}
      title={`Day ${stretch.day} of a ${stretch.of}-day stretch`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0,
        color: STRETCH_RED, fontSize, fontWeight: 600, fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      <FireIcon size={size} className="flex" />
      {stretch.day}/{stretch.of}
    </span>
  );
}
