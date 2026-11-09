// Unit tests of the screenshot comparison itself: it must pass equal images, tolerate a
// little noise, and fail a real change. Run: node --test e2e/screenshot.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { compareImages } from "./screenshot.mjs";

const image = (w, h, paint) => {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = paint(x, y);
    const i = (y * w + x) * 4;
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
};
const base = (x, y) => [30 + (x % 7), 15 + (y % 5), 25];

test("identical images match", () => {
  assert.equal(compareImages(image(200, 100, base), image(200, 100, base)).same, true);
});

test("a little noise passes: a few pixels changed", () => {
  const noisy = (x, y) => (x < 5 && y < 5 ? [255, 255, 255] : base(x, y));   // 25 of 20,000 px = 0.125%
  assert.equal(compareImages(image(200, 100, noisy), image(200, 100, base)).same, true);
});

test("a real change fails: a button-sized block changed colour", () => {
  const changed = (x, y) => (x > 20 && x < 80 && y > 20 && y < 50 ? [198, 40, 69] : base(x, y));   // 1,800 px = 9%
  const r = compareImages(image(200, 100, changed), image(200, 100, base));
  assert.equal(r.same, false);
  assert.ok(r.diffPng, "a diff image is produced");
});

test("a colour shift of the whole picture fails", () => {
  const shifted = (x, y) => { const [r, g, b] = base(x, y); return [r + 40, g, b]; };
  assert.equal(compareImages(image(200, 100, shifted), image(200, 100, base)).same, false);
});

test("a different size fails, and says so", () => {
  const r = compareImages(image(200, 100, base), image(200, 101, base));
  assert.equal(r.same, false);
  assert.match(r.reason, /size differs/);
});
