import type { Snapshot } from "@shared/types";

/**
 * Should the window show this snapshot, given the newest revision it has already shown?
 *
 * Replies come from several places at once (a change the person made, the refresh that follows Claude Code
 * writing to the file, a restore), and any of them can land after a newer one. A snapshot with a lower
 * revision was read earlier than one already on screen, so showing it would put an old workspace back
 * until the next change. A snapshot with no revision is always shown.
 */
export function isStale(next: Snapshot, newestShown: number): boolean {
  return next.revision !== undefined && next.revision < newestShown;
}
