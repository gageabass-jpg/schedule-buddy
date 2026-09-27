// Side-by-side lanes for blocks that overlap in time, the way calendar apps
// lay out a day: blocks that overlap share the column's width; a block that
// overlaps nothing gets all of it. Used by the week and day views so a
// coverage window, a class and a shift at the same hour are all visible.

export interface Span {
  id: string;
  /** Top and bottom as drawn (px), including any minimum height. */
  top: number;
  bottom: number;
}

export interface Lane {
  /** 0-based lane within its overlap group. */
  lane: number;
  /** How many lanes that group needs. */
  lanes: number;
}

export function assignLanes(spans: Span[]): Map<string, Lane> {
  const sorted = [...spans].sort((a, b) => a.top - b.top || (b.bottom - b.top) - (a.bottom - a.top));
  const out = new Map<string, Lane>();
  let group: Array<{ id: string; lane: number }> = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const flush = () => {
    for (const g of group) out.set(g.id, { lane: g.lane, lanes: laneEnds.length });
    group = [];
    laneEnds = [];
    groupEnd = -Infinity;
  };
  for (const s of sorted) {
    if (group.length && s.top >= groupEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s.top);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(s.bottom); }
    else laneEnds[lane] = s.bottom;
    group.push({ id: s.id, lane });
    groupEnd = Math.max(groupEnd, s.bottom);
  }
  flush();
  return out;
}

/**
 * left / width for a block in its lane, inside a column with `inset` px of
 * padding each side and `gap` px between lanes. No lane = the full width.
 */
export function laneBox(l: Lane | undefined, inset: number, gap = 3): { left: string; width: string } {
  const n = l?.lanes ?? 1;
  const i = l?.lane ?? 0;
  const span = `(100% - ${2 * inset}px + ${gap}px)`;
  return {
    left: `calc(${inset}px + ${span} * ${i} / ${n})`,
    width: `calc(${span} / ${n} - ${gap}px)`,
  };
}
