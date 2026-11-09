import type { CSSProperties } from "react";
import { NucleusMark } from "@nucleus/ui/brand/nucleusMark";

/** Nucleus brand tokens shared by the desktop wordmark + mark. */
export const BRAND_TEAL = "#0F6E64";        // the brand: mark, primary buttons, links
export const BRAND_TEAL_DEEP = "#0A4F48";   // pressed / hover
export const BRAND_TEAL_LIGHT = "#56B7A9";  // mark + accent text on a dark ground only
export const BRAND_INK = "#14201E";
export const BRAND_PAPER = "#F7F6F3";
export const BRAND_FONT = "\"Sora\", \"Helvetica Neue\", Arial, -apple-system, sans-serif";

/** The block-knot mark. The drawing lives in shared-ui/ (Nucleus Wagonwheel uses it
 *  too); this wrapper keeps Nucleus Manager's Teal defaults. */
export { NUCLEUS_MARK_PATH } from "@nucleus/ui/brand/nucleusMark";

interface Props {
  size?: number;
  /** Teal Light by default (the desktop app is dark). Pass BRAND_TEAL on light ground. */
  color?: string;
  style?: CSSProperties;
}

export function BrandMark({ size = 96, color = BRAND_TEAL_LIGHT, style }: Props) {
  return <NucleusMark size={size} color={color} style={style} />;
}
