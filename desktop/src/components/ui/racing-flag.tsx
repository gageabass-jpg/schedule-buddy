// RacingFlagIcon, from 21st.dev, as supplied. Marks the end of a schedule period
// on the month grid (see lib/scheduleEnds). It draws in currentColor.
import type { SVGProps } from "react"

export function RacingFlagIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}><g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"><path d="M5.672 13.91C10 15.932 14 7.842 21 11.887l-3-9.102C13.424-.3 8.563 6.856 3 4.625L8 22"/><path d="M19 7C13.5 3 9 12 4.5 9M8 4.905L10.823 13m2.354-10L16 10.619"/></g></svg>
  )
}
