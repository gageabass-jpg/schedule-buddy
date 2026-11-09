/**
 * Which routes on the commute map get a minutes chip. Every route is drawn, but
 * two that take the same minutes would each say "21 min" side by side, so a
 * route only gets a chip when no earlier route (the fastest comes first) has
 * the same time. "Fastest" is only worth saying when a visibly different
 * time sits beside it; if every alternative ties, nothing is being compared.
 */
export function routeChips(minutes: readonly number[]): { show: number[]; fastestLabel: boolean } {
  const show = minutes.flatMap((m, i) => (minutes.indexOf(m) === i ? [i] : []));
  return { show, fastestLabel: show.length > 1 };
}
