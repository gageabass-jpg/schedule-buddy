// wvuSchedule — live WVU football schedule for all three surfaces (web PWA,
// iOS, Mac desktop). Served at /wvu-schedule via a Hosting rewrite.
//
// wvusports.com's own RSS/ICS is behind Incapsula, so a server fetch can't
// reach it. We read ESPN's public, key-free college-football API (team 277)
// and map it into the same JSON the app's baked public/wvu-football.json uses,
// so clients can treat this endpoint and the static file interchangeably. The
// clients keep the bundled file as an offline fallback.

import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

const WVU_ESPN_ID = "277";
const ESPN_URL = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${WVU_ESPN_ID}/schedule`;
const ET = "America/New_York";

interface WvuGame {
  date: string;
  opponent: string;
  home: boolean;
  neutral: boolean;
  kickoff: string;      // "12:00 PM" or "TBD"
  location?: string;
  tv: string | null;
}

interface EspnEvent {
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
}

function etDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function etTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
}

function mapEvent(ev: EspnEvent): WvuGame | null {
  const iso = ev.date;
  const comp = ev.competitions?.[0];
  if (!iso || !comp || !Array.isArray(comp.competitors)) return null;

  const wvu = comp.competitors.find((c) => c.team?.id === WVU_ESPN_ID);
  const opp = comp.competitors.find((c) => c.team?.id !== WVU_ESPN_ID);
  if (!wvu || !opp) return null;

  const timeSet = comp.timeValid !== false && ev.timeValid !== false;
  const nets = [...(comp.broadcasts ?? []), ...(comp.geoBroadcasts ?? [])]
    .map((b) => b?.media?.shortName)
    .filter((n): n is string => !!n);
  const city = comp.venue?.address?.city;
  const location = comp.venue?.fullName
    ? city ? `${comp.venue.fullName}, ${city}` : comp.venue.fullName
    : undefined;

  return {
    date: etDate(iso),
    opponent: opp.team?.location || opp.team?.shortDisplayName || opp.team?.displayName || "TBD",
    home: wvu.homeAway === "home",
    neutral: !!comp.neutralSite,
    kickoff: timeSet ? etTime(iso) : "TBD",
    location,
    tv: nets.length ? Array.from(new Set(nets)).join("/") : null,
  };
}

export const wvuSchedule = onRequest({ cors: true, region: "us-central1" }, async (_req, res) => {
  try {
    const espn = await fetch(ESPN_URL, { headers: { accept: "application/json" } });
    if (!espn.ok) { res.status(502).json({ error: "upstream", status: espn.status }); return; }
    const data = await espn.json() as { season?: { year?: number }; events?: EspnEvent[] };

    const games: WvuGame[] = [];
    for (const ev of data.events ?? []) {
      const g = mapEvent(ev);
      if (g) games.push(g);
    }
    if (games.length === 0) { res.status(502).json({ error: "empty" }); return; }
    games.sort((a, b) => a.date.localeCompare(b.date));

    // 30-min CDN cache keeps ESPN hits low while staying fresh enough for a
    // schedule that changes on the order of days.
    res.set("Cache-Control", "public, max-age=1800, s-maxage=1800");
    res.status(200).json({
      team: "WVU Football",
      season: String(data.season?.year ?? new Date().getFullYear()),
      source: ESPN_URL,
      updated: new Date().toISOString().slice(0, 10),
      games,
    });
  } catch (e) {
    logger.error("wvuSchedule failed", e);
    res.status(502).json({ error: "fetch-failed" });
  }
});
