// "Axis Blend" gradient, from 21st.dev (community/gradients).
// A straight linear gradient, Sea glass (#1D9657) at 0% to Mauve (#D1D1D1) at
// 100%, starting at 90°, with a fractal-noise grain laid over it (overlay).
//
// Motion, as specified: a requestAnimationFrame clock t (seconds),
// ph = t * 1.00, amt = 0.50, dir = 1, spin = ph * dir, and the angle is
// 90 + spin * 40 * amt degrees, so it turns 20° a second and is exactly 90°
// at t = 0 (no snap when it starts). The angle is written straight to the
// element's style each frame, unrounded, without a React render.
// With reduced motion on it holds still at 90°.

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

const FROM = "#1D9657";
const TO = "#D1D1D1";
const ANGLE = 90;
const SPEED = 1.0;   // speed 100
const AMT = 0.5;     // motionAmount 50
const DIR = 1;       // motionReverse false

const GRAIN =
  `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>` +
  `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter>` +
  `<rect width='100%' height='100%' filter='url(%23n)' opacity='0.300'/></svg>")`;

function background(angle: number): string {
  return `${GRAIN}, linear-gradient(${angle}deg, ${FROM} 0%, ${TO} 100%)`;
}

export function AxisBlendGradient({ children, style, className }: { children?: ReactNode; style?: CSSProperties; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let start: number | null = null;
    const frame = (now: number) => {
      start ??= now;
      const t = (now - start) / 1000;
      const ph = t * SPEED;
      const spin = ph * DIR;
      el.style.backgroundImage = background(ANGLE + spin * 40 * AMT);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        backgroundColor: FROM,
        backgroundImage: background(ANGLE),
        backgroundSize: "120px 120px, auto",
        backgroundBlendMode: "overlay, normal",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
