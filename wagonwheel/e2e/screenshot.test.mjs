// Tests of the screenshot comparison itself. It must pass what another machine would draw
// (glyph edges a fraction of a pixel off) and fail what a visual regression looks like.
// Run: node --test e2e/screenshot.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { BASELINE_DIR, compareImages, MAX_DIFF_CELLS } from "./screenshot.mjs";

const baselineBuf = fs.readFileSync(path.join(BASELINE_DIR, "dashboard.png"));
const baseline = PNG.sync.read(baselineBuf);
const clone = () => { const p = new PNG({ width: baseline.width, height: baseline.height }); baseline.data.copy(p.data); return p; };
const png = (p) => PNG.sync.write(p);
const cmp = (p) => compareImages(png(p), baselineBuf);

/** The baseline with every row moved sideways by `dx` pixels (a fraction is blended): what another
 *  machine's glyph rasteriser does to every piece of text. */
function shifted(dx) {
  const out = clone();
  const w = baseline.width;
  const whole = Math.floor(dx);
  const frac = dx - whole;
  for (let y = 0; y < baseline.height; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    const at = (xx) => baseline.data[(y * w + Math.min(w - 1, Math.max(0, xx))) * 4 + c];
    out.data[(y * w + x) * 4 + c] = Math.round(at(x - whole) * (1 - frac) + at(x - whole - 1) * frac);
  }
  return out;
}
const recolour = (w, h, x0, y0, rgb) => {
  const p = clone();
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * p.width + x) * 4; [p.data[i], p.data[i + 1], p.data[i + 2]] = rgb; }
  return p;
};
const tint = (d) => {
  const p = clone();
  for (let i = 0; i < p.data.length; i += 4) for (let c = 0; c < 3; c++) p.data[i + c] = Math.max(0, Math.min(255, p.data[i + c] + d[c]));
  return p;
};

test("the baseline matches itself", () => {
  const r = cmp(clone());
  assert.equal(r.same, true);
  assert.equal(r.diffCells, 0);
});

test("what another machine draws passes: every glyph edge a fraction of a pixel off", () => {
  for (const dx of [0.25, 0.5, 0.75]) {
    const r = cmp(shifted(dx));
    assert.equal(r.same, true, `a ${dx}px sub-pixel shift: ${r.reason}`);
  }
});

test("a recoloured button, status chip or progress bar fails", () => {
  for (const [label, p] of [
    ["button 123x35", recolour(123, 35, 1273, 87, [47, 216, 79])],
    ["status chip 48x20", recolour(48, 20, 557, 182, [220, 200, 40])],
    ["progress bar 283x6", recolour(283, 6, 322, 282, [60, 200, 90])],
  ]) {
    const r = cmp(p);
    assert.equal(r.same, false, `${label} should fail`);
    assert.ok(r.diffCells > MAX_DIFF_CELLS, `${label}: ${r.reason}`);
    assert.ok(r.diffPng, "a diff picture is produced for a person to look at");
  }
});

test("a layout that moved by a few pixels fails", () => {
  assert.equal(cmp(shifted(4)).same, false);
});

test("a tint over the whole screen fails, even a subtle one that no single block shows", () => {
  const subtle = cmp(tint([6, 0, 0]));
  assert.equal(subtle.same, false);
  assert.match(subtle.reason, /mean colour moved/);
  assert.equal(cmp(tint([40, 0, 0])).same, false);
  assert.equal(cmp(tint([-12, -12, -12])).same, false);
});

test("a different size fails, and says so", () => {
  const small = new PNG({ width: 100, height: 100 });
  const r = compareImages(png(small), baselineBuf);
  assert.equal(r.same, false);
  assert.match(r.reason, /size differs/);
});
