// checkCommutes — "leave by" times and bad-traffic alerts for work shifts.
//
// Architecture:
//   - Scheduled every 10 minutes. For each household with a commute set up
//     (households/{hid}/private/commute: home + each person's workplace, both
//     Google place ids picked in the Manager), it finds Gage's and Kaylene's
//     next shift today or tomorrow with the same buildShiftMap the calendar
//     uses.
//   - More than LIVE_WINDOW_MIN before a shift: one predicted drive time
//     (Google Routes, traffic model best guess) every few hours.
//   - Inside the window: the live drive time every run, until they should
//     have left.
//   - Each result is written to households/{hid}/commute/{date}_{who}, which
//     the Manager and the phone read to show "Leave by 2:22p · 28 min".
//   - When the drive is much longer than usual (Routes' staticDuration: the
//     same route with no traffic), that person — only that person — gets a
//     push. Again only if it gets another 10 minutes worse.
//   - The Google key is the same secret as placesAutocomplete; it's
//     restricted to Places (New) and Routes.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { buildShiftMap, expandCustomTemplateTypes, type HouseholdState } from "./shared/state";

const GOOGLE_API_KEY = defineSecret("GOOGLE_PLACES_API_KEY");

/** Start watching live traffic this long before a shift starts. */
const LIVE_WINDOW_MIN = 90;
/** Minutes of slack added to the drive when working out "leave by". */
const BUFFER_MIN = 10;
/** Look this far ahead for the next shift. */
const LOOKAHEAD_MIN = 16 * 60;
/** Re-predict a far-off shift at most this often. */
const PREDICT_EVERY_MS = 3 * 60 * 60 * 1000;
/** Keep checking a little past "leave by", in case someone's running late. */
const AFTER_LEAVE_BY_MIN = 15;

type Who = "G" | "K";

interface Place { placeId: string; label: string }
interface CommuteConfig {
  home?: Place | null;
  work?: Partial<Record<Who, Place | null>>;
}

export interface CommuteDoc {
  date: string;              // YYYY-MM-DD the shift is on
  who: Who;
  shiftStart: string;        // "HH:MM" local
  shiftStartMs: number;
  placeLabel: string;        // "Thomas Memorial Hospital"
  durationMin: number;       // drive time for this departure, with traffic
  typicalMin: number;        // the same drive with no traffic
  leaveBy: string;           // "HH:MM" local
  leaveByMs: number;
  heavy: boolean;            // much worse than typical
  live: boolean;             // measured now (true) or predicted ahead (false)
  checkedAt: number;
  alertedAt?: number;
  alertedMin?: number;
}

// ── Time zones: a wall-clock time in the household's zone → epoch ms ───────

function offsetMs(tz: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(atMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(atMs / 1000) * 1000;
}

function zonedMs(dateIso: string, hhmm: string, tz: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMs(tz, guess);
  return guess - offsetMs(tz, first);      // second pass settles DST edges
}

function localIso(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(ms));
}

function localHhmm(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

function clock12(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })
    .format(new Date(ms)).replace(" AM", "a").replace(" PM", "p").replace(":00", "");
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// ── Google Routes ───────────────────────────────────────────────────────────

async function driveMinutes(
  key: string, from: Place, to: Place, departMs: number | null,
): Promise<{ durationMin: number; typicalMin: number } | null> {
  const body: Record<string, unknown> = {
    origin: { placeId: from.placeId },
    destination: { placeId: to.placeId },
    travelMode: "DRIVE",
    routingPreference: departMs ? "TRAFFIC_AWARE_OPTIMAL" : "TRAFFIC_AWARE",
  };
  if (departMs) {
    body.departureTime = new Date(departMs).toISOString();
    body.trafficModel = "BEST_GUESS";
  }
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.duration,routes.staticDuration",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    logger.warn("commute: Routes returned", res.status, await res.text().catch(() => ""));
    return null;
  }
  const json = (await res.json()) as { routes?: Array<{ duration?: string; staticDuration?: string }> };
  const r = json.routes?.[0];
  const secs = (s?: string) => (s ? Number(s.replace(/s$/, "")) : NaN);
  const d = secs(r?.duration), st = secs(r?.staticDuration);
  if (!Number.isFinite(d)) return null;
  return { durationMin: Math.round(d / 60), typicalMin: Math.round((Number.isFinite(st) ? st : d) / 60) };
}

/** Much worse than usual: at least 10 minutes and 30% over the no-traffic time. */
function isHeavy(durationMin: number, typicalMin: number): boolean {
  const extra = durationMin - typicalMin;
  return extra >= 10 && extra >= typicalMin * 0.3;
}

// ── Who is who ──────────────────────────────────────────────────────────────

/** The member account behind Gage (G) or Kaylene (K): by name, then by role. */
function uidFor(who: Who, hh: FirebaseFirestore.DocumentData, state: HouseholdState): string | null {
  const names: Record<string, string> = hh.memberNames ?? {};
  const roles: Record<string, string> = hh.roles ?? {};
  const want = (who === "G" ? state.selfName || "Gage" : state.partner?.name || "Kaylene").toLowerCase();
  for (const [uid, name] of Object.entries(names)) {
    if (String(name).toLowerCase().includes(want) || want.includes(String(name).toLowerCase())) return uid;
  }
  const role = who === "G" ? "admin" : "partner";
  return Object.keys(roles).find((uid) => roles[uid] === role) ?? null;
}

async function pushTo(householdId: string, uid: string, title: string, body: string, data: Record<string, string>) {
  const db = getFirestore();
  const tokRef = db.collection("households").doc(householdId).collection("pushTokens").doc(uid);
  const tok = (await tokRef.get()).data();
  if (!tok || typeof tok.token !== "string" || !tok.token) return false;
  try {
    await getMessaging().send({
      token: tok.token,
      notification: { title, body },
      data,
      apns: { payload: { aps: { alert: { title, body }, sound: "default" } } },
    });
    return true;
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    logger.warn("commute: push failed", { uid, code });
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
      await tokRef.delete().catch(() => {});
    }
    return false;
  }
}

// ── The job ─────────────────────────────────────────────────────────────────

export const checkCommutes = onSchedule(
  { schedule: "every 10 minutes", timeZone: "America/New_York", region: "us-central1", secrets: [GOOGLE_API_KEY], timeoutSeconds: 120 },
  async () => {
    const db = getFirestore();
    const key = GOOGLE_API_KEY.value();
    const now = Date.now();
    const households = await db.collection("households").get();

    for (const hhDoc of households.docs) {
      const householdId = hhDoc.id;
      try {
        const cfg = (await hhDoc.ref.collection("private").doc("commute").get()).data() as CommuteConfig | undefined;
        if (!cfg?.home?.placeId) continue;
        const stateSnap = await hhDoc.ref.collection("state").doc("main").get();
        if (!stateSnap.exists) continue;
        const state = stateSnap.data() as HouseholdState;
        const tz = state.timeZone || "America/New_York";
        const view = expandCustomTemplateTypes(state);
        const types = new Map(view.shiftTypes.map((t) => [t.id, t]));

        const today = localIso(now, tz);
        const shifts = buildShiftMap(view, today, addDays(today, 1));

        for (const who of ["G", "K"] as Who[]) {
          const work = cfg.work?.[who];
          if (!work?.placeId) continue;

          // The next shift that hasn't started, within the lookahead.
          let next: { date: string; start: string; startMs: number } | null = null;
          for (const date of [today, addDays(today, 1)]) {
            for (const s of shifts[date] ?? []) {
              if (s.who !== who || !s.shiftTypeId) continue;
              const st = types.get(s.shiftTypeId);
              if (!st?.start) continue;
              const startMs = zonedMs(date, st.start, tz);
              if (startMs <= now || startMs - now > LOOKAHEAD_MIN * 60000) continue;
              if (!next || startMs < next.startMs) next = { date, start: st.start, startMs };
            }
          }
          if (!next) continue;

          const ref = hhDoc.ref.collection("commute").doc(`${next.date}_${who}`);
          const prev = (await ref.get()).data() as CommuteDoc | undefined;
          const minutesAway = (next.startMs - now) / 60000;
          const live = minutesAway <= LIVE_WINDOW_MIN;

          if (!live && prev && now - prev.checkedAt < PREDICT_EVERY_MS) continue;
          if (live && prev?.live && now > prev.leaveByMs + AFTER_LEAVE_BY_MIN * 60000) continue;

          // Predicted: depart at the usual time. Live: depart now.
          const guessMin = prev?.typicalMin ?? 30;
          const departMs = live ? null : next.startMs - (guessMin + BUFFER_MIN) * 60000;
          if (departMs !== null && departMs <= now) continue;
          const drive = await driveMinutes(key, cfg.home, work, departMs);
          if (!drive) continue;

          const leaveByMs = next.startMs - (drive.durationMin + BUFFER_MIN) * 60000;
          const heavy = isHeavy(drive.durationMin, drive.typicalMin);
          const out: CommuteDoc = {
            date: next.date, who, shiftStart: next.start, shiftStartMs: next.startMs,
            placeLabel: work.label,
            durationMin: drive.durationMin, typicalMin: drive.typicalMin,
            leaveBy: localHhmm(leaveByMs, tz), leaveByMs,
            heavy, live, checkedAt: now,
            ...(prev?.alertedAt ? { alertedAt: prev.alertedAt, alertedMin: prev.alertedMin } : {}),
          };

          // Alert that person, once, and again only if it gets 10+ min worse.
          if (live && heavy && now < leaveByMs + AFTER_LEAVE_BY_MIN * 60000 &&
              (!prev?.alertedAt || drive.durationMin >= (prev.alertedMin ?? 0) + 10)) {
            const uid = uidFor(who, hhDoc.data(), state);
            const extra = drive.durationMin - drive.typicalMin;
            const title = `Heavy traffic to ${work.label}`;
            const body = now >= leaveByMs
              ? `${drive.durationMin} min right now, ${extra} more than usual. Leave now.`
              : `${drive.durationMin} min right now, ${extra} more than usual. Leave by ${clock12(leaveByMs, tz)}.`;
            if (uid && await pushTo(householdId, uid, title, body, { kind: "traffic", householdId, date: next.date })) {
              out.alertedAt = now;
              out.alertedMin = drive.durationMin;
            }
          }
          await ref.set(out);
          logger.info("commute: checked", { householdId, who, date: next.date, live, durationMin: drive.durationMin, typicalMin: drive.typicalMin, heavy });
        }
      } catch (e) {
        logger.warn("commute: household failed", { householdId, error: String(e) });
      }
    }
  },
);
