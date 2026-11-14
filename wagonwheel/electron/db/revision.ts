/**
 * Numbers each read of the database, for as long as this process lives. It sits outside the Workspace
 * because the Workspace is made again whenever the file is swapped (a restore, starting fresh), and the
 * count must keep rising across that: the window compares numbers, and a count that started over would
 * make it ignore every reply after a restore.
 */
let last = 0;

export function nextRevision(): number {
  return ++last;
}
