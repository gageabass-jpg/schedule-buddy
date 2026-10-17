// What a wall token may ask the Pi to do (functions/src/piCommandLogic.ts).
// Runs against the built functions: `npm --prefix functions run build` first
// (npm run test:rules does both).

import assert from "node:assert/strict";
import { test } from "node:test";
import logic from "../functions/lib/piCommandLogic.js";

const { OS_CONTROL, mayControlPi, cleanPiArgs } = logic;

test("the OS-level commands are exactly reboot, restart_kiosk and toggle_kiosk", () => {
  assert.deepEqual([...OS_CONTROL].sort(), ["reboot", "restart_kiosk", "toggle_kiosk"]);
});

test("a token minted by an admin or partner may control the Pi", () => {
  assert.equal(mayControlPi("gage", "admin"), true);
  assert.equal(mayControlPi("kaylene", "partner"), true);
});

test("a token minted by a caregiver, a former member, or an unknown uid may not", () => {
  assert.equal(mayControlPi("daisy", "supporting"), false);
  assert.equal(mayControlPi("gone", undefined), false);
  assert.equal(mayControlPi("someone", "contributing"), false);
  assert.equal(mayControlPi(undefined, "admin"), false);
  assert.equal(mayControlPi("", "admin"), false);
  assert.equal(mayControlPi(null, "admin"), false);
});

test("a token from the mint script may, with or without a role", () => {
  assert.equal(mayControlPi("mint-script", undefined), true);
});

test("open_playlist takes an https music.youtube.com URL and a short profile", () => {
  const url = "https://music.youtube.com/playlist?list=PL123";
  assert.deepEqual(cleanPiArgs("open_playlist", { url, profile: "gage" }), { url, profile: "gage" });
  assert.deepEqual(cleanPiArgs("open_playlist", { url }), { url });
});

test("open_playlist drops extra keys", () => {
  const url = "https://music.youtube.com/playlist?list=PL123";
  assert.deepEqual(cleanPiArgs("open_playlist", { url, profile: "k", cmd: "rm -rf /" }), { url, profile: "k" });
});

test("open_playlist refuses any other URL or a bad profile", () => {
  const ok = "https://music.youtube.com/playlist?list=PL123";
  for (const url of [
    "http://music.youtube.com/playlist?list=PL123",
    "https://evil.example/x",
    "https://music.youtube.com.evil.example/x",
    "https://user:pw@music.youtube.com/x",
    "https://www.youtube.com/watch?v=x",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "not a url",
    "https://music.youtube.com/" + "a".repeat(300),
    42, null, undefined, ["https://music.youtube.com/x"],
  ]) assert.equal(cleanPiArgs("open_playlist", { url, profile: "gage" }), null, String(url));
  for (const profile of ["a b", "x;reboot", "$(id)", "a".repeat(25), "", 5, {}, null])
    assert.equal(cleanPiArgs("open_playlist", { url: ok, profile }), null, String(profile));
  assert.equal(cleanPiArgs("open_playlist", undefined), null);
  assert.equal(cleanPiArgs("open_playlist", "https://music.youtube.com/x"), null);
});

test("other commands keep a small plain object, or {}", () => {
  assert.deepEqual(cleanPiArgs("scene", { scene: 2 }), { scene: 2 });
  assert.deepEqual(cleanPiArgs("refresh", undefined), {});
  assert.deepEqual(cleanPiArgs("refresh", "x"), {});
  assert.deepEqual(cleanPiArgs("refresh", [1, 2]), {});
  assert.equal(cleanPiArgs("scene", { scene: "x".repeat(2000) }), null);
});
