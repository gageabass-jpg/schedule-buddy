import { useEffect, useState } from "react";

// A pixel-grid loader for work that takes a while: a 3x3 grid with a wavefront moving through it,
// a shimmering label, and a live elapsed timer. The cells and the label animate with the
// `pixel-on` and `shimmer-text` keyframes in styles/glass.css. Under reduced motion the global rule
// in styles/index.css stops them, which leaves the grid dim and the label still; the timer still ticks.
//
//   Drive: square cells, a chevron wavefront driving right. The 650ms cycle is shorter than the
//          sweep, so two fronts are always in flight.
//   Dots:  the same wavefront, round cells.
//   Orbit: a comet lapping the grid's edge.

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

export type LoadingVariant = "Drive" | "Dots" | "Orbit";

const PATTERNS: Record<LoadingVariant, { delays: (number | null)[]; dur: number; round: boolean }> = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

function useElapsed(): string {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setDs((d) => d + 1), 100);
    return () => window.clearInterval(t);
  }, []);
  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export function LoadingState({ label = "Working", variant = "Drive" }: { label?: string; variant?: LoadingVariant }) {
  const elapsed = useElapsed();
  const { delays, dur, round } = PATTERNS[variant];

  return (
    // A screen reader hears the label once. The grid is decoration and the timer changes ten times a second.
    <div role="status" className="flex w-fit max-w-full items-center gap-2.5">
      <span aria-hidden="true" className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {delays.map((d, i) => (
          <span
            key={i}
            className={`size-[4px] bg-foreground ${round ? "rounded-full" : "rounded-[1px]"}`}
            style={{
              opacity: d === null ? 0.07 : 0.15,
              animation: d === null ? "none" : `pixel-on ${dur}ms ease-in-out ${d}ms infinite`,
            }}
          />
        ))}
      </span>
      <span
        className="min-w-0 truncate bg-clip-text text-[13px] font-medium text-transparent"
        style={{
          backgroundImage: "linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {label}
      </span>
      <span aria-hidden="true" className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">{elapsed}</span>
    </div>
  );
}
