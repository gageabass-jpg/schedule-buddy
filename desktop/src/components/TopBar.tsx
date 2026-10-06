import { BRAND_FONT, BRAND_TEAL, BRAND_TEAL_DEEP, BRAND_TEAL_LIGHT } from "./BrandMark";
import { IS_MAC } from "../lib/platform";

// Window-drag region. Cast because it isn't in React's CSS types.
const DRAG = { WebkitAppRegion: "drag" } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

/**
 * Thin teal titlebar strip carrying the wordmark and the macOS traffic lights,
 * which sit inset on the left (see `trafficLightPosition` in electron/main.ts).
 * The whole strip is draggable; the three columns start directly below it.
 *
 * The strip runs Teal Light on the left through Teal to Teal Deep on the
 * right. The traffic lights sit on the light end, so they keep their own
 * colour against a paler ground and the strip settles as it crosses.
 *
 * On Windows the window buttons are drawn over the right end instead (the
 * titleBarOverlay in electron/main.ts, Teal Deep to match), and there is no
 * menu bar, so a menu button on the left opens File, Edit, View, Tools.
 */
export function TopBar() {
  return (
    <div
      style={{
        height: 28,
        flexShrink: 0,
        background: `linear-gradient(90deg, ${BRAND_TEAL_LIGHT} 0%, ${BRAND_TEAL} 45%, ${BRAND_TEAL_DEEP} 100%)`,
        borderBottom: `1px solid ${BRAND_TEAL_DEEP}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        ...DRAG,
      }}
    >
      {!IS_MAC && (
        <button
          type="button"
          aria-label="Menu"
          title="Menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            window.sbm?.showAppMenu?.(r.left, r.bottom);
          }}
          style={{
            ...NO_DRAG,
            position: "absolute", left: 0, top: 0, width: 40, height: 27,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: 0, padding: 0, background: "transparent", color: BRAND_TEAL_DEEP, cursor: "default",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {/* The wordmark is lowercase Sora 600 with the qualifier in 400, the
          way it is set everywhere else. pointer-events stay off so the whole
          strip keeps dragging the window. */}
      <span
        style={{
          fontFamily: BRAND_FONT,
          fontSize: 12.5,
          letterSpacing: "-0.02em",
          color: "#FFFFFF",
          fontWeight: 600,
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        nucleus<span style={{ fontWeight: 400, color: "rgba(255,255,255,0.72)" }}> workspace</span>
      </span>
    </div>
  );
}
