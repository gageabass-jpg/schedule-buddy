/**
 * The exit to get off on, read from Google Routes' turn-by-turn steps for the
 * fastest route. The commute check saves it beside the route; the Manager shows
 * it under the destination on the commute map. Defined in shared/ so the
 * function that writes it and the app that reads it agree on the shape.
 */

export interface DriveExit {
  /** The exit's number as signed, e.g. "56" or "58A". */
  number: string;
  /** Where it leads, from the step's own words ("toward Dunbar"), when it says. */
  toward?: string;
}

/** The part of a Routes API step this reads. */
export interface DriveStep {
  navigationInstruction?: { instructions?: string };
}

// "Take exit 56 for WV-61 toward Dunbar", "Keep right to take exit 58A".
// Only a numbered exit counts: "take the ramp" doesn't say which one to get off on.
const EXIT_NUMBER = /\bexit\s+(\d{1,3}[A-Za-z]?)\b/i;

/** Keep the first sentence, trimmed and single-spaced; undefined when nothing is left. */
function tidy(text: string): string | undefined {
  const first = text.split(/[.\n]/)[0].replace(/\s+/g, " ").trim();
  return first || undefined;
}

/**
 * The last numbered exit on the route, which is the one that gets you off for
 * the destination (an earlier one may only be an interchange between highways).
 * Null when the route never takes a numbered exit, as on surface streets.
 */
export function exitFromSteps(steps: ReadonlyArray<DriveStep | null | undefined>): DriveExit | null {
  let found: DriveExit | null = null;
  for (const step of steps) {
    const text = step?.navigationInstruction?.instructions;
    if (typeof text !== "string") continue;
    const m = EXIT_NUMBER.exec(text);
    if (!m) continue;
    const rest = text.slice(m.index + m[0].length);
    // "toward X" says where the exit leads; failing that, "for X" names the road.
    const to = /\btowards?\s+(.+)$/i.exec(rest) ?? /\bfor\s+(.+)$/i.exec(rest);
    const toward = to ? tidy(to[1]) : undefined;
    found = { number: m[1].toUpperCase(), ...(toward ? { toward } : {}) };
  }
  return found;
}
