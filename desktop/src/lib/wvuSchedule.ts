// WVU football schedule — the same static feed the iOS app uses
// (public/wvu-football.json), copied into the Mac app's public/ dir and
// fetched same-origin (no CORS). Any day with a game gets the Flying WV in the
// calendar. Refresh: update the root public/wvu-football.json and rebuild —
// the `prebuild:web` npm step copies it (and the logo) into desktop/public/.

export interface WvuGame {
  date: string;          // ISO yyyy-mm-dd (local game date)
  opponent: string;
  home: boolean;
  neutral?: boolean;
  kickoff?: string;      // "12:00 PM" or "TBD"
  location?: string;
  tv?: string | null;
}

export async function loadWvuSchedule(): Promise<Map<string, WvuGame>> {
  try {
    const res = await fetch("wvu-football.json", { cache: "no-cache" });
    if (!res.ok) return new Map();
    const data = await res.json();
    const out = new Map<string, WvuGame>();
    if (Array.isArray(data?.games)) {
      for (const g of data.games) if (g?.date) out.set(g.date, g as WvuGame);
    }
    return out;
  } catch {
    return new Map();   // offline / missing file — calendar just renders without the mark
  }
}

/** "WVU vs Kansas · 12:00 PM" / "WVU at Utah". Home + neutral-site both read "vs". */
export function wvuGameLabel(g: WvuGame): string {
  const vs = g.neutral || g.home ? "vs" : "at";
  const kick = g.kickoff && g.kickoff !== "TBD" ? ` · ${g.kickoff}` : "";
  return `WVU ${vs} ${g.opponent}${kick}`;
}
