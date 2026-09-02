// piCommand — remote control bridge for the wall / Pi kiosk.
//
//   sendPiCommand?t=<token>   (POST from remote.html)
//     body: { command, args? }
//     → writes households/{hid}/meta/piCommand with a fresh nonce
//
//   getPiCommand?t=<token>    (GET, polled by both wall.html and the
//                              Pi listener every ~3s)
//     → { ok, nonce, command, args }
//     Consumers dedup via `nonce` so each command runs exactly once
//     per consumer (the wall runs page-side commands, the Pi runs
//     OS-side; both ignore commands that aren't theirs).
//
// Token auth mirrors getWallState — same wallTokens/{token} lookup, no
// new secrets. The wall token gates read access to household data, so
// letting it also send control commands doesn't widen the trust model.

import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";

interface WallTokenDoc { householdId: string; revoked?: boolean }

// Whitelist of commands the remote can send. Anything else is rejected
// so a leaked token can't run arbitrary code on the Pi.
const ALLOWED = new Set([
  // page-side (wall.html handles)
  "scene", "refresh",
  // OS-side (Pi watcher handles)
  "play_pause", "next", "prev", "vol_up", "vol_down",
  "shuffle", "mute", "open_playlist",   // audio nook: playerctl shuffle / pactl mute / navigate YT Music tab (args:{url,profile})
  "open_music", "close_music",
  "hide_cursor",
  "reboot", "restart_kiosk", "toggle_kiosk",
]);

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

export const sendPiCommand = onRequest(
  { region: "us-central1", cors: true, maxInstances: 5 },
  async (req, res) => {
    const token = (req.query.t as string | undefined) ?? (req.body?.token as string | undefined);
    const resolved = await resolveHousehold(token);
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const command = String(req.body?.command ?? req.query.command ?? "").slice(0, 40);
    if (!ALLOWED.has(command)) {
      res.status(400).json({ error: `unknown command: ${command}` });
      return;
    }
    // args is an optional small object — currently only `scene` uses it.
    const args = (req.body?.args && typeof req.body.args === "object") ? req.body.args : {};

    const db = getFirestore();
    const ref = db.collection("households").doc(resolved.householdId)
      .collection("meta").doc("piCommand");

    // Monotonic nonce = current epoch ms. Consumers store the last nonce
    // they acted on and only run the command when a strictly-greater
    // nonce arrives.
    const nonce = Date.now();
    await ref.set({
      command,
      args,
      nonce,
      requestedAt: FieldValue.serverTimestamp(),
    });

    logger.info("piCommand sent", { householdId: resolved.householdId, command, nonce });
    res.set("Cache-Control", "no-store");
    res.status(200).json({ ok: true, nonce });
  },
);

export const getPiCommand = onRequest(
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
      .collection("meta").doc("piCommand").get();

    res.set("Cache-Control", "no-store");
    if (!snap.exists) {
      res.status(200).json({ ok: true, nonce: 0 });
      return;
    }
    const d = snap.data() ?? {};
    res.status(200).json({
      ok: true,
      nonce: typeof d.nonce === "number" ? d.nonce : 0,
      command: d.command ?? "",
      args: d.args ?? {},
    });
  },
);
