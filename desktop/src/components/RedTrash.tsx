import { TrashIcon } from "@/components/ui/trash";
import { FLAG_RED } from "./DayFlagPopover";

/**
 * The delete glyph for every remove / delete button: the animated trash in
 * the flag red. It fills its button, so hovering anywhere on the button (not
 * just the glyph) lifts the lid. `disabledColor` greys it out and keeps the
 * lid still, for a remove that isn't allowed (your own row).
 */
export function RedTrash({ size = 18, disabledColor }: { size?: number; disabledColor?: string }) {
  return (
    <TrashIcon
      size={size}
      aria-hidden="true"
      style={{
        color: disabledColor ?? FLAG_RED,
        width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        pointerEvents: disabledColor ? "none" : undefined,
      }}
    />
  );
}
