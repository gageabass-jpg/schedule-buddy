// smart-phone-02 — the phone mark for "Kaylene is on call". Stroke is
// currentColor, so the wrapper's `color` sets it.
import type { SVGProps } from "react";

export function SmartPhone02Icon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <path d="M13.5 2h-3c-2.357 0-3.536 0-4.268.732S5.5 4.643 5.5 7v10c0 2.357 0 3.535.732 4.268S8.143 22 10.5 22h3c2.357 0 3.535 0 4.268-.732c.732-.733.732-1.911.732-4.268V7c0-2.357 0-3.536-.732-4.268C17.035 2 15.857 2 13.5 2" />
        <path d="M14 2h-4l.5 1h3z" />
      </g>
    </svg>
  );
}
