import { PROJECT_KEY_MAX, PROJECT_KEY_MIN, PROJECT_KEY_PATTERN } from "./types.js";

// How a project gets its key: the short front of its tasks' identifiers (RXM in RXM-4). Pure, so it is
// tested on its own and the same rule is used when a project is made, when old projects are given keys on upgrade,
// and after a restore from a backup that had none.

/** The words of a name: runs of letters and digits. ("RxManager" is one word; a name is not taken apart by its capitals.) */
function words(name: string): string[] {
  return name.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 0);
}

/** A key as typed: capitals and digits only, cut to the longest allowed. */
export function normalizeKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, PROJECT_KEY_MAX);
}

export const isValidKey = (key: string): boolean => PROJECT_KEY_PATTERN.test(key);

/**
 * A key for a project of this name that no other project has. First choice is the initials of its words ("Nucleus
 * Manager" is NM, "piper-locke" is PL); a name of one word gives its first three letters ("RxManager" is RXM, "Atlas"
 * is ATL). If that is taken, the first letters of the name are tried at other lengths, then a number is added.
 * `taken` holds the keys already in use, in capitals; it is not changed.
 */
export function suggestProjectKey(name: string, taken: ReadonlySet<string>): string {
  const w = words(name);
  const letters = w.join("").toUpperCase();
  const candidates: string[] = [];
  if (w.length >= 2) candidates.push(w.slice(0, PROJECT_KEY_MAX).map((x) => x[0]).join("").toUpperCase());
  candidates.push(letters.slice(0, 3), letters.slice(0, 4), letters.slice(0, 2), letters.slice(0, PROJECT_KEY_MAX));
  for (const c of candidates) {
    const key = normalizeKey(c);
    if (key.length >= PROJECT_KEY_MIN && !taken.has(key)) return key;
  }
  // Nothing readable is left (a name with no letters, or every spelling taken): the first letters and a number.
  const base = normalizeKey(letters.slice(0, 3)) || "PRJ";
  for (let n = 2; n < 100_000; n++) {
    const suffix = String(n);
    const key = base.slice(0, PROJECT_KEY_MAX - suffix.length) + suffix;
    if (isValidKey(key) && !taken.has(key)) return key;
  }
  throw new Error("No free project key");
}
