// WVU football schedule. Live source is ESPN's public, CORS-open schedule API
// (no key, no bot wall — unlike wvusports.com's Incapsula-guarded RSS/ICS,
// which a plain fetch can't get through). We map ESPN's events into our own
// WvuGame shape and fall back to the bundled static wvu-football.json if the
// network is down or ESPN changes shape. Any day with a game gets the Flying
// WV in the calendar and a row in the day popover.
//
// Refresh: live data updates itself on each launch. The static file is only a
// safety net; to refresh it, update the root public/wvu-football.json and
// rebuild (`prebuild:web` copies it into desktop/public/).

export interface WvuGame {
  date: string;          // ISO yyyy-mm-dd (local ET game date)
  opponent: string;
  home: boolean;
  neutral?: boolean;
  kickoff?: string;      // "12:00 PM" or "TBD"
  location?: string;
  tv?: string | null;
}

// ESPN team id for the West Virginia Mountaineers.
const WVU_ESPN_ID = "277";
const ESPN_URL = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${WVU_ESPN_ID}/schedule`;
const ET = "America/New_York";

// Shared source for all three surfaces: the wvuSchedule Cloud Function (served
// via a Hosting rewrite) does the ESPN mapping once. We hit it first, then fall
// back to ESPN directly (keeps the desktop live even if Functions are down,
// e.g. a lapsed-billing 503), then to the bundled static file.
const FUNCTION_URL = "https://schedule-buddy-dd2cf.web.app/wvu-schedule";

export async function loadWvuSchedule(): Promise<Map<string, WvuGame>> {
  const shared = await fetchGamesJson(FUNCTION_URL);
  if (shared && shared.size > 0) return shared;
  const live = await fetchEspnSchedule();
  if (live && live.size > 0) return live;
  return loadStaticSchedule();
}

/** Fetch a `{ games: WvuGame[] }` document (function or static) → Map. */
async function fetchGamesJson(url: string): Promise<Map<string, WvuGame> | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-cache", signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.games)) return null;
    const out = new Map<string, WvuGame>();
    for (const g of data.games) if (g?.date) out.set(g.date, g as WvuGame);
    return out.size > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Live schedule from ESPN, mapped to WvuGame. Returns null on any failure. */
async function fetchEspnSchedule(): Promise<Map<string, WvuGame> | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    let res: Response;
    try {
      res = await fetch(ESPN_URL, { cache: "no-cache", signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = await res.json();
    const events: unknown[] = Array.isArray(data?.events) ? data.events : [];
    const out = new Map<string, WvuGame>();
    for (const ev of events) {
      const g = mapEspnEvent(ev);
      if (g) out.set(g.date, g);
    }
    return out.size > 0 ? out : null;
  } catch {
    return null;   // offline, aborted, blocked, or shape changed — caller falls back
  }
}

/** One ESPN event → WvuGame, or null if it isn't a well-formed WVU game. */
function mapEspnEvent(ev: unknown): WvuGame | null {
  const e = ev as {
    date?: string;
    timeValid?: boolean;
    competitions?: Array<{
      timeValid?: boolean;
      neutralSite?: boolean;
      venue?: { fullName?: string; address?: { city?: string } };
      competitors?: Array<{ homeAway?: string; team?: { id?: string; location?: string; shortDisplayName?: string; displayName?: string } }>;
      broadcasts?: Array<{ media?: { shortName?: string } }>;
      geoBroadcasts?: Array<{ media?: { shortName?: string } }>;
    }>;
  };
  const iso = e.date;
  const comp = e.competitions?.[0];
  if (!iso || !comp || !Array.isArray(comp.competitors)) return null;

  const wvu = comp.competitors.find((c) => c.team?.id === WVU_ESPN_ID);
  const opp = comp.competitors.find((c) => c.team?.id !== WVU_ESPN_ID);
  if (!wvu || !opp) return null;

  const opponent = opp.team?.location || opp.team?.shortDisplayName || opp.team?.displayName || "TBD";
  const timeSet = comp.timeValid !== false && e.timeValid !== false;

  // TV: national/lead broadcast names, de-duped.
  const nets = [...(comp.broadcasts ?? []), ...(comp.geoBroadcasts ?? [])]
    .map((b) => b?.media?.shortName)
    .filter((n): n is string => !!n);
  const tv = nets.length ? Array.from(new Set(nets)).join("/") : null;

  const city = comp.venue?.address?.city;
  const location = comp.venue?.fullName
    ? city ? `${comp.venue.fullName}, ${city}` : comp.venue.fullName
    : undefined;

  return {
    date: etDate(iso),
    opponent,
    home: wvu.homeAway === "home",
    neutral: !!comp.neutralSite,
    kickoff: timeSet ? etTime(iso) : "TBD",
    location,
    tv,
  };
}

/** Bundled static schedule — the offline fallback. */
async function loadStaticSchedule(): Promise<Map<string, WvuGame>> {
  return (await fetchGamesJson("wvu-football.json")) ?? new Map();
}

/** ISO instant → Eastern-time calendar date (yyyy-mm-dd). */
function etDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** ISO instant → Eastern-time kickoff (e.g. "7:30 PM"). */
function etTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
}

/** "WVU vs Kansas · 12:00 PM" / "WVU at Utah". Home + neutral-site both read "vs". */
export function wvuGameLabel(g: WvuGame): string {
  const vs = g.neutral || g.home ? "vs" : "at";
  const kick = g.kickoff && g.kickoff !== "TBD" ? ` · ${g.kickoff}` : "";
  return `WVU ${vs} ${g.opponent}${kick}`;
}
