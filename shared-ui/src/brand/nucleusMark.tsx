import type { CSSProperties } from "react";

/** The Nucleus block-knot mark: four square loops read as four blocks. 100×100 box.
 *  The one drawing every Nucleus app uses; each app picks its own colour. */
export const NUCLEUS_MARK_PATH =
  "M40 25 L40 75 L40 90 L10 90 L10 60 L75 60 L90 60 L90 90 L60 90 L60 25 L60 10 L90 10 L90 40 L25 40 L10 40 L10 10 L40 10 Z";

/** Stroke thickens as the mark shrinks so the corner blocks stay open. */
export function markStrokeFor(size: number): number {
  if (size >= 48) return 9;
  if (size >= 32) return 10;
  if (size >= 24) return 11;
  return 13;
}

interface Props {
  size?: number;
  color: string;
  style?: CSSProperties;
}

export function NucleusMark({ size = 96, color, style }: Props) {
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
        strokeWidth={markStrokeFor(size)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
