import { BRAND_TEAL, BRAND_TEAL_DEEP } from "./BrandMark";

// macOS window-drag region. Cast because it isn't in React's CSS types.
const DRAG = { WebkitAppRegion: "drag" } as React.CSSProperties;

/**
 * Thin teal titlebar strip. It holds nothing but the macOS traffic lights,
 * which sit inset on the left (see `trafficLightPosition` in electron/main.ts).
 * The whole strip is draggable; the three columns start directly below it.
 */
export function TopBar() {
  return (
    <div
      style={{
        height: 28,
        flexShrink: 0,
        background: BRAND_TEAL,
        borderBottom: `1px solid ${BRAND_TEAL_DEEP}`,
        ...DRAG,
      }}
    />
  );
}
