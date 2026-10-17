// What a wall token may ask the Pi to do (functions/src/piCommand.ts).
// Pure: no Firebase, so tests/piCommand.test.mjs can run it from the build.

// Commands that act on the Pi's operating system, not the wall page or the
// music. A token can read the household's schedule; these it may send only
// when the household's own admin or partner minted it.
export const OS_CONTROL = new Set(["reboot", "restart_kiosk", "toggle_kiosk"]);

// functions/scripts/mintWallToken.js writes this as createdBy. It runs with
// the Admin SDK on the owner's machine; no client can write it, because the
// rules pin a client's createdBy to their own uid.
export const SCRIPT_MINTED = "mint-script";

/** May a token minted by `createdBy` send OS-control commands?
 *  `role` is that uid's role in the token's household, if it has one. */
export function mayControlPi(createdBy: unknown, role: unknown): boolean {
  if (createdBy === SCRIPT_MINTED) return true;
  return typeof createdBy === "string" && createdBy !== "" && (role === "admin" || role === "partner");
}

const MUSIC_HOST = "music.youtube.com";

/** The `args` to store for a command, or null when they are not acceptable.
 *  open_playlist hands a URL to the Pi, so it takes https on the music host
 *  and a short profile name, and nothing else. Other commands keep a small
 *  plain object (scene uses one). */
export function cleanPiArgs(command: string, raw: unknown): Record<string, unknown> | null {
  const args = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (command === "open_playlist") {
    const { url, profile } = args;
    if (typeof url !== "string" || url.length > 300) return null;
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== "https:" || u.hostname !== MUSIC_HOST || u.username || u.password) return null;
    if (profile !== undefined && !(typeof profile === "string" && /^[a-z0-9_-]{1,24}$/i.test(profile))) return null;
    return profile === undefined ? { url: u.toString() } : { url: u.toString(), profile };
  }
  if (JSON.stringify(args).length > 1000) return null;
  return args;
}
