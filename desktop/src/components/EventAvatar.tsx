import type { EventWho } from "../state";
import { eventColor, rgba, type Palette } from "../theme";
import { PhotoAv } from "./PhotoAv";

interface Props {
  who: EventWho;
  size?: number;
  palette: Palette;
  dark?: boolean;
}

/**
 * One-stop avatar for events: PhotoAv for G/K (real headshots), a letter
 * disc for Daisy (D, green) and family (F, purple).
 */
export function EventAvatar({ who, size = 22, palette, dark = true }: Props) {
  if (who === "G" || who === "K") {
    return <PhotoAv who={who} size={size} palette={palette} dark={dark} />;
  }
  const color = eventColor(who, palette);
  const letter = who === "Daisy" ? "D" : "F";
  return (
    <div
      title={who === "Daisy" ? "Daisy" : "Family"}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: rgba(color, 0.22),
        color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(10, Math.round(size * 0.46)),
        fontWeight: 700,
        letterSpacing: "-0.02em",
        flexShrink: 0,
        boxShadow: `0 0 0 1px ${rgba(color, 0.5)}`,
      }}
    >
      {letter}
    </div>
  );
}

/** Single capital letter for compact chip prefixes ("G"/"K"/"D"/"F"). */
export function eventInitial(who: EventWho): string {
  if (who === "G") return "G";
  if (who === "K") return "K";
  if (who === "Daisy") return "D";
  return "F";
}
