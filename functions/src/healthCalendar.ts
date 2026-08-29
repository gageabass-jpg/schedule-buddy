// Sync a published (webcal/https) iCalendar feed — e.g. a MyChart "Health"
// calendar the user published from Apple Calendar — into the household's shared
// events. Runs server-side because browsers can't fetch iCloud feeds (no CORS).
//
// The feed URL is a bearer token, so it lives in a Firebase secret
// (HEALTH_CAL_URL), never in the repo or the public web app. Imported events
// are tagged `healthId` (the VEVENT UID) so a re-sync updates in place, drops
// cancelled future appointments, and never duplicates. `who: "G"` — only Gage
// and Kaylene see the family calendar (the caregiver is on a separate screen).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";

const HEALTH_CAL_URL = defineSecret("HEALTH_CAL_URL");

interface IcsEvent { uid: string; summary: string; start: string; end: string | null; location: string; }

function unescapeIcs(s: string): string {
  return s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

// Feed text arrives ALL CAPS; render it Title Case (first letter of each word),
// but keep short acronyms (TTE, APRN, CNP, MRI, …) in caps. Common short words
// are title-cased, not treated as acronyms.
const TITLE_STOP = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "from",
  "with", "per", "via", "up", "out", "new", "old", "pre", "post", "non", "by",
]);
function titleCase(s: string): string {
  return s.split(/(\s+)/).map((w) => {
    if (!/\S/.test(w)) return w;                       // whitespace run
    const letters = w.replace(/[^A-Za-z]/g, "");
    if (letters.length >= 2 && letters.length <= 4 &&
        letters === letters.toUpperCase() && !TITLE_STOP.has(letters.toLowerCase())) {
      return w;                                        // keep acronym as-is
    }
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join("");
}

// MyChart summaries read "APPT TYPE with Provider Name, CREDENTIALS". Split the
// provider off into its own subtitle row; the "with …" clause is only treated
// as a provider when it carries a comma (so "MRI with contrast" stays a title).
function splitAppt(summary: string): { title: string; provider: string } {
  const m = /^(.*?)\s+with\s+(.+)$/i.exec(summary);
  if (m && m[1].trim() && /,/.test(m[2])) {
    return { title: titleCase(m[1].trim()), provider: titleCase(m[2].trim()) };
  }
  return { title: titleCase(summary), provider: "" };
}

/** Unfold continuation lines, then pull each VEVENT's UID/SUMMARY/DTSTART/DTEND. */
function parseVevents(ics: string): IcsEvent[] {
  const unfolded = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const out: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  for (const line of unfolded.split(/\r\n|\n|\r/)) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.uid && cur.start) {
        out.push({ uid: cur.uid, summary: cur.summary || "Appointment", start: cur.start, end: cur.end ?? null, location: cur.location ?? "" });
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).split(";")[0];   // strip params (TZID, VALUE, …)
    const val = line.slice(idx + 1);
    if (key === "UID") cur.uid = val.trim();
    else if (key === "SUMMARY") cur.summary = unescapeIcs(val);
    else if (key === "DTSTART") cur.start = val.trim();
    else if (key === "DTEND") cur.end = val.trim();
    else if (key === "LOCATION") cur.location = unescapeIcs(val);
  }
  return out;
}

/** iCal datetime → { date, time } in the family's timezone.
 *  Handles VALUE=DATE (all-day), UTC "…Z", and floating/TZID wall-clock. */
function toLocal(val: string, tz: string): { date: string; time: string | null } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(val);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (hh === undefined) return { date: `${y}-${mo}-${d}`, time: null };
  if (z) {
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss || 0)));
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(dt);
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    let hr = g("hour"); if (hr === "24") hr = "00";
    return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${hr}:${g("minute")}` };
  }
  return { date: `${y}-${mo}-${d}`, time: `${hh}:${mi}` };   // floating / TZID → wall clock
}

function localDateStr(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

interface EventRec {
  id: string; date: string; title: string; who: string;
  healthId?: string; startTime?: string; endTime?: string; notes?: string;
}

export const syncHealthCalendar = onCall(
  { secrets: [HEALTH_CAL_URL] },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const householdId = String((req.data as { householdId?: string } | undefined)?.householdId || "");
    const tz = String((req.data as { tz?: string } | undefined)?.tz || "America/New_York");
    if (!householdId) throw new HttpsError("invalid-argument", "householdId required.");

    let url = HEALTH_CAL_URL.value();
    if (!url) throw new HttpsError("failed-precondition", "Health calendar URL not configured.");
    url = url.replace(/^webcal:\/\//i, "https://");

    let ics: string;
    try {
      const resp = await fetch(url, { redirect: "follow" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      ics = await resp.text();
    } catch (e) {
      logger.warn("health .ics fetch failed", { error: String(e) });
      throw new HttpsError("unavailable", "Couldn't fetch the calendar.");
    }

    const parsed = parseVevents(ics);
    const now = new Date();
    const todayLocal = localDateStr(now, tz);
    const horizonLocal = localDateStr(new Date(now.getTime() + 180 * 86400000), tz);

    const db = getFirestore();
    const ref = db.collection("households").doc(householdId).collection("state").doc("main");
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "No schedule doc.");
    const data = snap.data() || {};
    const existing: EventRec[] = Array.isArray(data.events) ? (data.events as EventRec[]) : [];

    const idByHealthId = new Map<string, string>();
    for (const e of existing) if (e && e.healthId) idByHealthId.set(e.healthId, e.id);

    // Keep non-health events, and PAST health events (history the feed may drop);
    // rebuild only today-forward health events from the feed.
    const next: EventRec[] = existing.filter(
      (e) => !e || !e.healthId || (e.date && e.date < todayLocal));

    let added = 0, updated = 0;
    for (const ev of parsed) {
      const s = toLocal(ev.start, tz);
      if (!s) continue;
      if (s.date < todayLocal || s.date > horizonLocal) continue;
      const e = ev.end ? toLocal(ev.end, tz) : null;
      const { title, provider } = splitAppt(ev.summary || "Appointment");
      const rec: EventRec = {
        id: idByHealthId.get(ev.uid) || `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        date: s.date,
        title: title || "Appointment",
        who: "G",
        healthId: ev.uid,
      };
      if (s.time) rec.startTime = s.time;
      if (e && e.time && e.date === s.date) rec.endTime = e.time;
      // Provider (from the summary's "with …" clause) → subtitle. The feed's
      // LOCATION is the clinic address, which the day card deliberately omits.
      if (provider) rec.notes = provider;
      if (idByHealthId.has(ev.uid)) updated++; else added++;
      next.push(rec);
    }

    await ref.update({ events: next });
    logger.info("health calendar synced", { householdId, parsed: parsed.length, added, updated });
    return { ok: true, added, updated, total: parsed.length };
  },
);
