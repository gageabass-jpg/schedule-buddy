import type { CSSProperties } from "react";

/** Nucleus brand tokens shared by the desktop wordmark + mark. */
export const BRAND_TEAL = "#0F6E64";        // the brand: mark, primary buttons, links
export const BRAND_TEAL_DEEP = "#0A4F48";   // pressed / hover
export const BRAND_TEAL_LIGHT = "#56B7A9";  // mark + accent text on a dark ground only
export const BRAND_INK = "#14201E";
export const BRAND_PAPER = "#F7F6F3";
export const BRAND_FONT = "\"Sora\", \"Helvetica Neue\", Arial, -apple-system, sans-serif";

/** The block-knot mark: four square loops read as four shift blocks. 100×100 box. */
export const NUCLEUS_MARK_PATH =
  "M40 25 L40 75 L40 90 L10 90 L10 60 L75 60 L90 60 L90 90 L60 90 L60 25 L60 10 L90 10 L90 40 L25 40 L10 40 L10 10 L40 10 Z";

/** Stroke thickens as the mark shrinks so the corner blocks stay open. */
function strokeFor(size: number): number {
  if (size >= 48) return 9;
  if (size >= 32) return 10;
  if (size >= 24) return 11;
  return 13;
}

interface Props {
  size?: number;
  /** Teal Light by default (the desktop app is dark). Pass BRAND_TEAL on light ground. */
  color?: string;
  style?: CSSProperties;
}

export function BrandMark({ size = 96, color = BRAND_TEAL_LIGHT, style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      style={{ display: "block", ...style }}
    >
      <path
        d={NUCLEUS_MARK_PATH}
        stroke={color}
        strokeWidth={strokeFor(size)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
