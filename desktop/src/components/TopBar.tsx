import type { ThemeTokens } from "../theme";
import { BrandMark, BRAND_TEAL, BRAND_TEAL_LIGHT, BRAND_FONT } from "./BrandMark";

// macOS window-drag regions. Cast because these aren't in React's CSS types.
const DRAG = { WebkitAppRegion: "drag" } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

/**
 * Full-width titlebar strip. The macOS traffic lights sit inset on the left
 * (see `trafficLightPosition` in electron/main.ts); the 82px left pad clears
 * them. The whole bar is draggable; the wordmark opts out and re-syncs on
 * click. The three columns start directly below this bar.
 */
export function TopBar({
  t, dark, onRefresh, refreshing,
}: {
  t: ThemeTokens;
  dark: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div
      style={{
        height: 44,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 16px 0 82px",
        borderBottom: `1px solid ${t.sep}`,
        background: dark ? "rgba(28,28,30,0.6)" : "rgba(246,246,248,0.7)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        ...DRAG,
      }}
    >
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        title="Refresh — re-sync schedule data"
        aria-label="Refresh schedule data"
        style={{
          ...NO_DRAG,
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "4px 6px",
          background: "transparent",
          border: 0,
          borderRadius: 8,
          cursor: refreshing ? "default" : "pointer",
          fontFamily: "inherit",
        }}
      >
        <BrandMark
          size={22}
          color={dark ? BRAND_TEAL_LIGHT : BRAND_TEAL}
          style={{ flexShrink: 0, animation: refreshing ? "sbmSpin 0.6s linear" : undefined }}
        />
        <span style={{ fontSize: 15, lineHeight: 1, letterSpacing: "-0.02em", fontFamily: BRAND_FONT, whiteSpace: "nowrap" }}>
          <span style={{ fontWeight: 600, color: t.text }}>nucleus</span>
          <span style={{ fontWeight: 400, color: t.text2 }}> manager</span>
        </span>
      </button>
    </div>
  );
}
