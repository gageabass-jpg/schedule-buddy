// icsFeed — read-only .ics calendar feed for a household's shared schedule.
//
// URL: /ics/<token>.ics  (Firebase Hosting rewrite → this function), or with
// a ?t=<token> query param. Reads the sanitized `publicShares/{token}` snapshot
// via the Admin SDK (bypasses rules) and emits an RFC-5545 VCALENDAR of shifts
// (as timed events) and life-event titles (as all-day events). Floating local
// times so "11a" shows as 11a in whatever calendar subscribes.

import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";

interface ShareShift {
  who: string;
  type?: string;
  label?: string;
  start?: string;
  end?: string;
  endsNextDay?: boolean;
}
interface ShareDay { date: string; shifts?: ShareShift[]; events?: string[]; }
interface ShareDoc {
  householdName?: string;
  people?: Record<string, { name?: string }>;
  days?: ShareDay[];
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

function extractToken(req: { query?: Record<string, unknown>; path?: string }): string {
  const q = req.query && (req.query.t || req.query.token);
  if (q) return String(q);
  const m = String(req.path || "").match(/([A-Za-z0-9_-]+?)(?:\.ics)?$/);
  return m ? m[1] : "";
}

function esc(s: string): string {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// RFC-5545 line folding at ~75 octets.
function fold(line: string): string {
  if (line.length <= 73) return line;
  let out = line.slice(0, 73);
  let rest = line.slice(73);
  while (rest.length) { out += "\r\n " + rest.slice(0, 72); rest = rest.slice(72); }
  return out;
}

function dtLocal(dateISO: string, hhmm: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;   // floating local
}
function addDayISO(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export const icsFeed = onRequest({ cors: true, region: "us-central1" }, async (req, res) => {
  try {
    const token = extractToken(req);
    if (!token) { res.status(400).send("Missing token"); return; }

    const snap = await getFirestore().collection("publicShares").doc(token).get();
    if (!snap.exists) { res.status(404).send("Not found"); return; }
    const data = snap.data() as ShareDoc;
    const nameOf = (w: string): string => (data.people && data.people[w] && data.people[w].name) || w;

    const now = new Date();
    const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Nucleus//Share//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${esc(data.householdName || "Nucleus")}`,
      "X-PUBLISHED-TTL:PT1H",
    ];

    let n = 0;
    for (const day of (data.days || [])) {
      for (const s of (day.shifts || [])) {
        n++;
        lines.push("BEGIN:VEVENT");
        lines.push(`UID:${token}-${day.date}-${s.who}-${n}@schedule-buddy`);
        lines.push(`DTSTAMP:${dtstamp}`);
        if (s.start && s.end) {
          const endDate = s.endsNextDay ? addDayISO(day.date) : day.date;
          lines.push(`DTSTART:${dtLocal(day.date, s.start)}`);
          lines.push(`DTEND:${dtLocal(endDate, s.end)}`);
        } else {
          lines.push(`DTSTART;VALUE=DATE:${day.date.replace(/-/g, "")}`);
        }
        lines.push(`SUMMARY:${esc(`${nameOf(s.who)} — ${s.type || s.label || "Shift"}`)}`);
        lines.push("END:VEVENT");
      }
      for (const title of (day.events || [])) {
        n++;
        lines.push("BEGIN:VEVENT");
        lines.push(`UID:${token}-${day.date}-ev-${n}@schedule-buddy`);
        lines.push(`DTSTAMP:${dtstamp}`);
        lines.push(`DTSTART;VALUE=DATE:${day.date.replace(/-/g, "")}`);
        lines.push(`SUMMARY:${esc(title)}`);
        lines.push("END:VEVENT");
      }
    }
    lines.push("END:VCALENDAR");

    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Cache-Control", "public, max-age=900");
    res.status(200).send(lines.map(fold).join("\r\n") + "\r\n");
  } catch (e) {
    logger.error("icsFeed error", e);
    res.status(500).send("Error");
  }
});
