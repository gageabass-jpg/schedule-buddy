import { useEffect, useState } from "react";
import { BRAND_INK, BRAND_PAPER, BRAND_TEAL, BRAND_TEAL_LIGHT } from "./BrandMark";

// The Manager's loading screen (Claude Design "Loading Screen"): a field of
// faint "nucleus manager" lockups behind a soft glow, and three dots that
// split into a triangle, turn, and melt back into one. The melt is an SVG
// "goo" filter over the dots; the keyframes (nm-*) live in index.css.

const LOCKUP = "assets/nucleus-manager-lockup.png";
const LOCKUP_H = 36;                        // px; the design's default
const LOCKUP_W = (LOCKUP_H * 1496) / 156;   // the PNG's aspect
const COL_GAP = LOCKUP_H * 1.2;
const ROW_GAP = LOCKUP_H * 0.9;
const ROWS = 28;
const PER_ROW = 10;
const FADE_MS = 420;

// Every other row slides half a step, and alternates 0.6 / 0.35 opacity.
const rows = Array.from({ length: ROWS }, (_, r) => ({
  offset: -((r * 0.5) % 1) * (LOCKUP_W + COL_GAP),
  opacity: r % 2 ? 0.35 : 0.6,
}));

interface Props {
  /** While true the screen is up; when it turns false it fades out, then unmounts. */
  visible: boolean;
  dark: boolean;
}

export function LoadingScreen({ visible, dark }: Props) {
  const [mounted, setMounted] = useState(visible);
  // Shown again: remount straight away (state adjusted during render).
  if (visible && !mounted) setMounted(true);
  // Hidden: unmount once the fade has run.
  useEffect(() => {
    if (visible) return;
    const id = window.setTimeout(() => setMounted(false), FADE_MS);
    return () => window.clearTimeout(id);
  }, [visible]);
  if (!mounted) return null;

  // The design is light-only. On the dark ground the lockups are inverted
  // (their ink text would vanish) and the dots swap Ink for Paper.
  const ground = dark ? "#0E1715" : "#FFFFFF";
  const glow = dark ? "14,23,21" : "255,255,255";
  const dots: [string, string][] = [
    [dark ? BRAND_TEAL_LIGHT : BRAND_TEAL, "nm-d1 2s ease infinite, nm-z 6s -2s ease infinite"],
    [dark ? BRAND_PAPER : BRAND_INK, "nm-d2 2s ease infinite, nm-z 6s -4s ease infinite"],
    [dark ? "#A9B3B0" : "#5A6663", "nm-d3 2s ease infinite, nm-z 6s ease infinite"],
  ];

  return (
    <div
      role="status"
      aria-label="Loading Nucleus Manager"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        overflow: "hidden",
        background: ground,
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: "-60px -400px",
          display: "flex",
          flexDirection: "column",
          gap: ROW_GAP,
          opacity: dark ? 0.5 : 1,
        }}
      >
        {rows.map((row, r) => (
          <div
            key={r}
            style={{
              display: "flex",
              gap: COL_GAP,
              flexShrink: 0,
              transform: `translateX(${row.offset}px)`,
              opacity: row.opacity,
            }}
          >
            {Array.from({ length: PER_ROW }, (_, i) => (
              <img
                key={i}
                src={LOCKUP}
                alt=""
                draggable={false}
                style={{
                  flexShrink: 0, height: LOCKUP_H, width: "auto", display: "block",
                  // Per image, not on the whole field: one filter over the
                  // oversized field layer only partly paints in Chromium.
                  filter: dark ? "invert(1) hue-rotate(180deg)" : undefined,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(60% 50% at 50% 50%, rgb(${glow}) 20%, rgba(${glow},0) 100%)`,
          opacity: 0.92,
        }}
      />
      <div
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <div style={{ position: "relative", width: 120, height: 120 }}>
          <svg width="0" height="0" style={{ position: "absolute" }}>
            <defs>
              <filter id="nm-goo">
                <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
                <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 21 -7" />
              </filter>
            </defs>
          </svg>
          <div className="nm-spin" style={{ position: "absolute", inset: 0, filter: "url(#nm-goo)" }}>
            {dots.map(([bg, animation], i) => (
              <div
                key={i}
                className="nm-dot"
                style={{
                  position: "absolute",
                  inset: 0,
                  margin: "auto",
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: bg,
                  animation,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
