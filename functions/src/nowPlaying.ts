// nowPlaying — tiny now-playing bridge for the wall display.
//
//   setNowPlaying?t=<token>   (POST, from the Pi's playerctl watcher)
//     body/query: title, artist, status ("Playing"|"Paused"|"Stopped")
//     → writes households/{hid}/meta/nowPlaying
//
//   getNowPlaying?t=<token>   (GET, polled by wall.html every ~5s)
//     → { ok, live, status, title, artist }
//     `live` is false when the last update is stale (watcher stopped) so
//     the wall reverts to the Parks & Rec quote.
//
// Token auth mirrors getWallState (wallTokens/{token} → householdId). No
// album art here — the wall page looks that up from the iTunes Search API
// using title + artist, so this stays a trivial text bridge.

import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";

interface WallTokenDoc { householdId: string; revoked?: boolean }

// A now-playing update older than this is treated as "not live" — the
// watcher pings on every track/status change and at least every 15s, so
// 40s of silence means music (or the Pi) stopped.
const STALE_MS = 40_000;

async function resolveHousehold(token: string | undefined): Promise<
  { ok: true; householdId: string } | { ok: false; status: number; error: string }
> {
  if (!token || typeof token !== "string" || token.length < 16) {
    return { ok: false, status: 400, error: "missing or malformed token" };
  }
  const db = getFirestore();
  const snap = await db.collection("wallTokens").doc(token).get();
  if (!snap.exists) return { ok: false, status: 404, error: "unknown token" };
  const data = snap.data() as WallTokenDoc;
  if (data.revoked) return { ok: false, status: 403, error: "token revoked" };
  return { ok: true, householdId: data.householdId };
}

// Look up album art from the iTunes Search API (no key, no CORS needed
// server-side). Returns a 600×600 cover URL or "" if nothing matches.
async function lookupAlbumArt(title: string, artist: string): Promise<string> {
  if (!title) return "";
  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`);
    if (!r.ok) return "";
    const d = await r.json() as { results?: Array<{ artworkUrl100?: string }> };
    const url = d.results?.[0]?.artworkUrl100 ?? "";
    return url ? url.replace("100x100bb", "600x600bb") : "";
  } catch (e) {
    logger.warn("iTunes art lookup failed", { e: String(e) });
    return "";
  }
}

export const setNowPlaying = onRequest(
  { region: "us-central1", cors: true, maxInstances: 5 },
  async (req, res) => {
    const token = (req.query.t as string | undefined) ?? (req.body?.token as string | undefined);
    const resolved = await resolveHousehold(token);
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const pick = (k: string): string =>
      String((req.body?.[k] as string | undefined) ?? (req.query[k] as string | undefined) ?? "").slice(0, 300);

    const title  = pick("title");
    const artist = pick("artist");
    const status = pick("status") || "Stopped";

    const db = getFirestore();
    const ref = db.collection("households").doc(resolved.householdId)
      .collection("meta").doc("nowPlaying");

    // Only hit iTunes when the track actually changes — the watcher also
    // pings periodically as a heartbeat, and we don't want to re-query art
    // every time.
    const prev = (await ref.get()).data() ?? {};
    const changed = prev.title !== title || prev.artist !== artist;
    const art = changed ? await lookupAlbumArt(title, artist) : (prev.art ?? "");

    await ref.set({ title, artist, status, art, updatedAt: Date.now() });

    res.set("Cache-Control", "no-store");
    res.status(200).json({ ok: true });
  },
);

export const getNowPlaying = onRequest(
  { region: "us-central1", cors: true, maxInstances: 10 },
  async (req, res) => {
    const token = req.query.t as string | undefined;
    const resolved = await resolveHousehold(token);
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const db = getFirestore();
    const snap = await db.collection("households").doc(resolved.householdId)
      .collection("meta").doc("nowPlaying").get();

    res.set("Cache-Control", "no-store");
    if (!snap.exists) {
      res.status(200).json({ ok: true, live: false });
      return;
    }
    const d = snap.data() ?? {};
    const updatedAt = typeof d.updatedAt === "number" ? d.updatedAt : 0;
    const fresh = Date.now() - updatedAt < STALE_MS;
    const playing = fresh && d.status === "Playing";

    res.status(200).json({
      ok: true,
      live: playing,
      status: d.status ?? "Stopped",
      title: d.title ?? "",
      artist: d.artist ?? "",
      art: d.art ?? "",
    });
    logger.debug("getNowPlaying", { householdId: resolved.householdId, playing });
  },
);
