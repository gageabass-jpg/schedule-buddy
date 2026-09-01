// wallState — read-only dashboard endpoint for the wall-mounted Pi display.
//
// Architecture:
//   - Plain HTTPS endpoint (not callable). The wall page is a vanilla
//     HTML file on a Raspberry Pi running Chromium kiosk; it has no
//     Firebase SDK, no auth — just `fetch()`.
//   - Auth is by long random token. Token doc lives at
//     `wallTokens/{token}` and maps to a householdId. Members create
//     tokens from the Mac Settings UI; revoking flips `revoked: true`.
//   - Returns a trimmed snapshot of household state — only what the
//     wall renders. Cuts payload size and prevents accidental leakage
//     of stale fields if we add new private data later.
//   - Rate-limited via in-memory cache: 1 fresh read per token per 15s.
//     Multiple wall page loads (or Pi flaky refresh) cost ~zero.

import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";

interface WallTokenDoc {
  householdId: string;
  createdAt: number;
  createdBy: string;
  label?: string;
  revoked?: boolean;
}

// ───────────────── Trimmed payload shape sent to wall.html ──────────────

interface WallPayload {
  generatedAt: number;            // ms epoch — wall uses this to detect stale loads
  household: {
    name: string;
    selfName: string;             // "Gage"
    partnerName: string;          // "Kaylene"
  };
  today: string;                  // YYYY-MM-DD (Pi sets its own clock; this is server's view)
  shiftTypes: Array<{
    id: string; name: string; start: string; end: string;
    crossesMidnight?: boolean;
    sleepHours?: number;            // needed client-side for the fatigue heatmap
  }>;
  // Expanded shifts: today − 3 weeks (so the fatigue heatmap has lookback)
  // through today + 7 days. Keyed by ISO date.
  shifts: Record<string, Array<{
    who: "G" | "K";
    shiftTypeId: string;
    label: string;
  }>>;
  // Confirmed/pending coverage requests in the forward window.
  coverage: Array<{
    date: string;
    startTime: string;
    endTime: string;
    status: "pending" | "confirmed" | "declined" | "issue";
    arriveBy?: string;
  }>;
  // Events in the forward window.
  events: Array<{
    id: string;
    date: string;
    startTime?: string;
    endTime?: string;
    title: string;
    who: "G" | "K" | "Daisy" | "family";
  }>;
  // Family photo URLs for the wall's scene rotation. Stored in Firebase
  // Storage; URLs are persistent download URLs written into the
  // households/{hid}/wallPhotos/{id} subcollection by the Mac upload UI.
  photos: string[];
  // Special occasions today that drive the hero line's friendly flair —
  // paydays (auto-computed from state.paydays), plus birthdays /
  // anniversaries / holidays (user-populated via state.occasions). The
  // wall page reads these in priority order; the first match drives the
  // visual flair (color shift, optional confetti animation, etc.)
  occasions: Array<{
    date: string;
    label: string;
    type: "payday" | "birthday" | "anniversary" | "holiday";
  }>;
  // Wall message board — the single most recent unexpired note posted from
  // the iOS app by any household member. Null when nothing is current, which
  // is how the wall knows to fall back to its resting state.
  message: {
    text: string;
    senderName: string;
    createdAt: number;          // ms epoch
    expiresAt: number | null;   // ms epoch; null = stays until replaced
  } | null;
  // Next self (Gage) payday, for the wall's countdown card. Null when no
  // payday rule is configured.
  nextPayday: { date: string } | null;
  // Latest WV MetroNews headline for the wall's news card. Null on fetch
  // failure — the card hides itself.
  news: { title: string; image: string; source: string; time: string } | null;
}

// ───────────────── WV MetroNews headline (cached ~5 min) ─────────────────
let NEWS_CACHE: { at: number; val: WallPayload["news"] } | null = null;
async function fetchTopNews(): Promise<WallPayload["news"]> {
  if (NEWS_CACHE && Date.now() - NEWS_CACHE.at < 5 * 60_000) return NEWS_CACHE.val;
  // Keep the previous headline if this fetch fails, so a blip doesn't blank
  // the card. Bump the timestamp regardless so a slow feed isn't retried on
  // every 30s poll.
  let val: WallPayload["news"] = NEWS_CACHE ? NEWS_CACHE.val : null;
  try {
    // Hard 4s cap — the wall polls getWallState every 30s and its fetch has no
    // timeout, so a hanging RSS request would stall the whole response and show
    // "Network error — Failed to fetch" on the display.
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 4000);
    let resp: Response;
    try { resp = await fetch("https://wvmetronews.com/feed/", { redirect: "follow", signal: ac.signal }); }
    finally { clearTimeout(to); }
    if (resp.ok) {
      const xml = await resp.text();
      const item = xml.split(/<item[ >]/i)[1] || "";
      const pick = (re: RegExp) => { const m = re.exec(item); return m ? m[1] : ""; };
      const decode = (s: string) => s
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&#8217;|&#039;|&#39;|&apos;/g, "’").replace(/&#8216;/g, "‘")
        .replace(/&#8220;/g, "“").replace(/&#8221;/g, "”")
        .replace(/&#8211;/g, "–").replace(/&#8212;/g, "—")
        .replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/<[^>]+>/g, "").trim();
      const title = decode(pick(/<title>([\s\S]*?)<\/title>/i));
      let image = "";
      const mm = /<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i.exec(item) || /<enclosure[^>]*url="([^"]+)"/i.exec(item);
      if (mm) image = mm[1]!;
      else { const ce = /<content:encoded>([\s\S]*?)<\/content:encoded>/i.exec(item); if (ce) { const im = /<img[^>]*src="([^"]+)"/i.exec(ce[1]!); if (im) image = im[1]!; } }
      let time = "";
      const pd = pick(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      if (pd) { const dt = new Date(pd.trim()); if (!isNaN(dt.getTime())) time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(dt).toLowerCase(); }
      if (title) val = { title: title.slice(0, 140), image, source: "WV MetroNews", time };
    }
  } catch (e) { logger.warn("news fetch failed", { error: String(e) }); }
  NEWS_CACHE = { at: Date.now(), val };
  return val;
}

// ───────────────── Helpers ──────────────────────────────────────────────

function todayIso(): string {
  // Cloud Functions run in UTC; format the wall clock's local date
  // (Charleston, WV = Eastern). en-CA formats as YYYY-MM-DD natively.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, (m! - 1), d!);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

interface AltWeekend {
  enabled?: boolean;
  refSat?: string;          // a Saturday self IS scheduled to work
  sat?: string | null;
  sun?: string | null;
}

// Resolve the self template shift for a date, honoring the alternating
// weekend rule when enabled. Mirrors desktop/src/state.ts::selfShiftId
// (sans override handling, which is done at the caller). Without this,
// weekend shifts on alt-weekends never make it to the wall.
function templateShiftFor(
  dateIso: string,
  template: Array<string | null> | undefined,
  alt?: AltWeekend,
): string | null {
  if (!template || template.length !== 7) return null;
  const [y, m, d] = dateIso.split("-").map(Number);
  const dow = new Date(y!, m! - 1, d!).getDay();

  if (alt?.enabled && alt.refSat && (dow === 0 || dow === 6)) {
    const [ry, rm, rd] = alt.refSat.split("-").map(Number);
    const refMs = Date.UTC(ry!, rm! - 1, rd!);
    const dayMs = Date.UTC(y!, m! - 1, d!);
    const weeksFromRef = Math.round((dayMs - refMs) / (7 * 86_400_000));
    const onWorkingWeekend = weeksFromRef % 2 === 0;
    if (dow === 6) return onWorkingWeekend ? (alt.sat ?? null) : null;
    return onWorkingWeekend ? (alt.sun ?? null) : null;
  }

  return template[dow] ?? null;
}

// Detect whether a payday falls on a specific date, given an anchor and
// frequency. Walk from anchor in `step` increments and check exact match.
function isPaydayOn(anchor: string | undefined, freq: "weekly" | "biweekly" | undefined, target: string): boolean {
  if (!anchor || !freq) return false;
  const step = freq === "weekly" ? 7 : 14;
  // Compute day delta from anchor to target.
  const [ay, am, ad] = anchor.split("-").map(Number);
  const [ty, tm, td] = target.split("-").map(Number);
  const aDt = new Date(ay!, am! - 1, ad!);
  const tDt = new Date(ty!, tm! - 1, td!);
  const diff = Math.round((tDt.getTime() - aDt.getTime()) / 86400000);
  if (diff < 0) return false;
  return diff % step === 0;
}

// ───────────────── Rate-limit cache ─────────────────────────────────────
// Keyed by token. Survives across warm invocations of the same instance.
// Cold start drops the cache, which is fine — Pi will just get a fresh
// read once and re-cache.

interface CacheEntry { payload: WallPayload; expiresAt: number; }
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15_000;

// ───────────────── Endpoint ─────────────────────────────────────────────

export const getWallState = onRequest(
  { cors: true, maxInstances: 3 },
  async (req, res) => {
    const token = (req.query.t as string | undefined) ?? (req.body?.token as string | undefined);
    if (!token || typeof token !== "string" || token.length < 16) {
      res.status(400).json({ error: "missing or malformed token" });
      return;
    }

    // Serve from cache if fresh.
    const cached = CACHE.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      res.set("Cache-Control", "no-store");
      res.status(200).json(cached.payload);
      return;
    }

    const db = getFirestore();

    // Resolve token → householdId.
    const tokenSnap = await db.collection("wallTokens").doc(token).get();
    if (!tokenSnap.exists) {
      res.status(404).json({ error: "unknown token" });
      return;
    }
    const tokenData = tokenSnap.data() as WallTokenDoc;
    if (tokenData.revoked) {
      res.status(403).json({ error: "token revoked" });
      return;
    }
    const householdId = tokenData.householdId;

    // Load household doc for names.
    const hhSnap = await db.collection("households").doc(householdId).get();
    if (!hhSnap.exists) {
      res.status(404).json({ error: "household not found" });
      return;
    }
    const hhData = hhSnap.data() ?? {};
    const memberNames: Record<string, string> = hhData.memberNames ?? {};

    // Load state.
    const stateSnap = await db.collection("households").doc(householdId)
      .collection("state").doc("main").get();
    if (!stateSnap.exists) {
      res.status(404).json({ error: "state not initialized" });
      return;
    }
    const state = stateSnap.data() as Record<string, unknown>;

    // ── Build trimmed payload ─────────────────────────────────────────
    const today = todayIso();
    // Dynamic Dashboard scene shows a 14-day grid (2 weeks × 7), so we
    // need shifts/events out 13 days from today (inclusive).
    const windowEnd = addDays(today, 13);
    // The wall page renders a 6-week fatigue heatmap, which needs shifts
    // back 5 weeks plus a couple extra days of lookback for the per-day
    // "previous shift" scan. 6 weeks = 42 days; we go back ~45 days.
    const fatigueLookbackDays = 45;
    const windowStart = addDays(today, -fatigueLookbackDays);

    const shiftTypes: WallPayload["shiftTypes"] = (state.shiftTypes as WallPayload["shiftTypes"] ?? []).map((s) => ({
      id: s.id, name: s.name, start: s.start, end: s.end,
      crossesMidnight: s.crossesMidnight,
      sleepHours: s.sleepHours,
    }));
    const stypeById = new Map(shiftTypes.map((s) => [s.id, s]));

    // Build shifts map for the 8-day window. Sources:
    //   - state.template (self) — recurring weekly
    //   - state.alt — alternating Sat/Sun pairs (skipped here; rare)
    //   - state.overrides — per-date overrides (replace template)
    //   - state.ot — per-date OT shifts (self, additional)
    //   - state.partner.shifts — per-date partner shifts
    // Coverage gets a separate field, not stuffed into shifts.
    const shifts: WallPayload["shifts"] = {};
    const template = state.template as Array<string | null> | undefined;
    const alt = state.alt as AltWeekend | undefined;
    // Optional last day the recurring template applies (inclusive). Past
    // this date the template/alt-weekend stop; overrides + OT still show.
    const templateEndDate = state.templateEndDate as string | undefined;
    const templateActiveOn = (date: string) => !templateEndDate || date <= templateEndDate;
    const overrides = (state.overrides as Array<{ date: string; shiftTypeId: string | null; label: string }> | undefined) ?? [];
    const ot       = (state.ot as Array<{ date: string; shiftTypeId: string; label: string }> | undefined) ?? [];
    const partner  = state.partner as { name?: string; shifts?: Array<{ date: string; shiftTypeId: string; label: string }> } | undefined;

    // Walk every day from windowStart through today + 13, building each
    // day's shift list. The fatigue heatmap consumes the backwards slice
    // and the dashboard's 2-week grid consumes the forward slice.
    for (let i = -fatigueLookbackDays; i <= 13; i++) {
      const date = addDays(today, i);
      const day: WallPayload["shifts"][string] = [];

      // Self template / override.
      const override = overrides.find((o) => o.date === date);
      if (override) {
        if (override.shiftTypeId) {
          day.push({ who: "G", shiftTypeId: override.shiftTypeId, label: override.label });
        }
        // override with null = off, skip
      } else if (templateActiveOn(date)) {
        const tplId = templateShiftFor(date, template, alt);
        if (tplId) {
          const st = stypeById.get(tplId);
          if (st) day.push({ who: "G", shiftTypeId: tplId, label: st.name });
        }
      }
      // Self OT.
      for (const o of ot.filter((x) => x.date === date)) {
        day.push({ who: "G", shiftTypeId: o.shiftTypeId, label: o.label });
      }
      // Partner.
      for (const p of (partner?.shifts ?? []).filter((x) => x.date === date)) {
        day.push({ who: "K", shiftTypeId: p.shiftTypeId, label: p.label });
      }

      // NOTE: no cross-midnight carry. A shift is attributed to the
      // calendar date it's scheduled on — exactly like the Mac Manager's
      // buildShiftMap (desktop/src/state.ts). We deliberately do NOT pull
      // yesterday's still-running overnight shift into today: doing so made
      // the wall read "both working today" (and fire the caregiver-gap
      // alarm) on mornings when one person is actually home recovering from
      // a night shift, disagreeing with the Manager. The "recovering
      // until…" hero state (findRecoveryFor in wall.html) already conveys
      // the post-shift overnight context without inflating today's roster.

      if (day.length > 0) shifts[date] = day;
    }

    // Coverage window.
    const coverageAll = (state.coverageRequests as Array<{
      date: string; startTime: string; endTime: string;
      status: WallPayload["coverage"][number]["status"];
      arriveBy?: string;
    }> | undefined) ?? [];
    const coverage = coverageAll
      .filter((c) => c.date >= today && c.date <= windowEnd)
      .map((c) => ({
        date: c.date, startTime: c.startTime, endTime: c.endTime,
        status: c.status, arriveBy: c.arriveBy,
      }));

    // Events window.
    const eventsAll = (state.events as Array<WallPayload["events"][number]> | undefined) ?? [];
    const events = eventsAll
      .filter((e) => e.date >= today && e.date <= windowEnd)
      .map((e) => ({
        id: e.id, date: e.date, startTime: e.startTime, endTime: e.endTime,
        title: e.title, who: e.who,
      }));

    // Occasions for today + the next 7 days. Two sources merged:
    //   1. Paydays computed from state.paydays (per-person anchor + freq)
    //   2. state.occasions — user-populated array of { date, label, type }
    // The wall page reads occasions for the visible week to drive flair;
    // it specifically highlights ones whose date === today.
    const paydaysCfg = state.paydays as {
      G?: { anchor: string; freq: "weekly" | "biweekly" };
      K?: { anchor: string; freq: "weekly" | "biweekly" };
    } | undefined;
    const userOccasions = (state.occasions as Array<{ date: string; label: string; type?: WallPayload["occasions"][number]["type"]; annual?: boolean }> | undefined) ?? [];
    const occasions: WallPayload["occasions"] = [];
    for (let i = 0; i <= 7; i++) {
      const date = addDays(today, i);
      // Paydays
      if (isPaydayOn(paydaysCfg?.G?.anchor, paydaysCfg?.G?.freq, date)) {
        occasions.push({ date, label: `${selfNamePreview()}'s payday`, type: "payday" });
      }
      if (isPaydayOn(paydaysCfg?.K?.anchor, paydaysCfg?.K?.freq, date)) {
        occasions.push({ date, label: `${partnerNamePreview()}'s payday`, type: "payday" });
      }
      // User-defined birthdays / holidays / anniversaries.
      // Annual occasions ignore the year — match on MM-DD only.
      const mmDd = date.slice(5);              // "12-25"
      for (const o of userOccasions) {
        const isMatch = o.annual
          ? o.date.slice(5) === mmDd
          : o.date === date;
        if (isMatch) {
          occasions.push({
            date,
            label: o.label,
            type: o.type ?? "holiday",
          });
        }
      }
    }
    // Light helper closures so we have names available before the
    // self/partner resolution block below. Defined as local function refs
    // bound at call-time via a tiny wrapper.
    function selfNamePreview(): string {
      if (typeof state.selfName === "string") return state.selfName;
      const ns = Object.values(memberNames);
      return ns[0] ?? "Gage";
    }
    function partnerNamePreview(): string {
      if (typeof partner?.name === "string") return partner.name;
      const ns = Object.values(memberNames);
      return ns[1] ?? "Kaylene";
    }

    // Family photos for the scene-rotation slideshow.
    // Photos are uploaded to Firebase Storage by the Mac UI; a Firestore
    // doc at households/{hid}/wallPhotos/{photoId} stores { url, order? }.
    // We pull all of them here and pass the URLs straight through.
    const photoSnap = await db.collection("households").doc(householdId)
      .collection("wallPhotos").orderBy("createdAt", "desc").limit(50).get();
    const photos: string[] = photoSnap.docs
      .map((d) => String(d.data().url ?? ""))
      .filter((u) => u.length > 0);

    // Wall message board — most recent unexpired note.
    // We pull a small window rather than just the newest doc: the newest may
    // have expired, in which case the board should fall back to the most
    // recent note that is still current instead of going blank.
    //
    // Note the interaction with CACHE_TTL_MS — a message can linger on the
    // wall for up to 15s past its expiry before the next uncached read drops
    // it. Not worth invalidating the cache over for a family notice board.
    const nowMs = Date.now();
    const msgSnap = await db.collection("households").doc(householdId)
      .collection("wallMessages").orderBy("createdAt", "desc").limit(10).get();
    let message: WallPayload["message"] = null;
    for (const d of msgSnap.docs) {
      const m = d.data() ?? {};
      const text = String(m.text ?? "").trim();
      if (!text) continue;
      const expiresAt = typeof m.expiresAt === "number" ? m.expiresAt : null;
      if (expiresAt !== null && expiresAt <= nowMs) continue;
      // createdAt is a server Timestamp; tolerate a raw number too in case a
      // client ever writes one directly.
      const createdAt = typeof m.createdAt?.toMillis === "function"
        ? m.createdAt.toMillis()
        : (typeof m.createdAt === "number" ? m.createdAt : 0);
      message = {
        text: text.slice(0, 280),
        senderName: String(m.senderName ?? "").slice(0, 40),
        createdAt,
        expiresAt,
      };
      break;
    }

    // Resolve self/partner names from members.
    // Convention: self = household admin, partner = the other adult.
    let selfName = "Gage";
    let partnerName = "Kaylene";
    if (Object.keys(memberNames).length >= 2) {
      const names = Object.values(memberNames);
      selfName = names[0] ?? selfName;
      partnerName = names[1] ?? partnerName;
    }
    // Prefer state.selfName / state.partner.name if present.
    if (typeof state.selfName === "string") selfName = state.selfName;
    if (typeof partner?.name === "string") partnerName = partner.name;

    // Next self (Gage) payday for the countdown card.
    let nextPayday: WallPayload["nextPayday"] = null;
    const pdRule: { anchor?: string; freq?: "weekly" | "biweekly" } | null =
      ((state.paydays as Record<string, { anchor?: string; freq?: "weekly" | "biweekly" }> | undefined)?.G) ?? null;
    if (pdRule && typeof pdRule.anchor === "string") {
      for (let i = 0; i <= 45; i++) {
        const d = addDays(today, i);
        if (isPaydayOn(pdRule.anchor, pdRule.freq, d)) { nextPayday = { date: d }; break; }
      }
    }
    const news = await fetchTopNews();

    const payload: WallPayload = {
      generatedAt: Date.now(),
      household: { name: hhData.name ?? "Home", selfName, partnerName },
      today,
      shiftTypes,
      shifts,
      coverage,
      events,
      photos,
      occasions,
      message,
      nextPayday,
      news,
    };

    CACHE.set(token, { payload, expiresAt: Date.now() + CACHE_TTL_MS });

    res.set("Cache-Control", "no-store");
    res.status(200).json(payload);
    logger.info("wallState served", { householdId, token: token.slice(0, 6) + "…" });
  },
);
