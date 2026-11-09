// Screenshot regression: compare a PNG with a committed baseline.
//
// WHY NOT PIXEL BY PIXEL. The same build draws its text with slightly different edge softness
// on different machines (sub-pixel glyph rasterisation). Measured: a GitHub runner differs from
// the machine that made the baseline in 12,100 pixels, every one of them a glyph edge. That is
// MORE than a recoloured button (3,700 pixels), so no pixel limit can tell the two apart.
//
// So the picture is averaged into 6x6 blocks first. Glyph-edge softness averages away; a changed
// colour, a moved or missing element, a different layout does not. Two checks:
//   1. blocks: how many 6x6 blocks differ visibly (colour distance above CELL_THRESHOLD). Measured:
//      runner 1, other renderings 0-2; a recoloured status chip 23, a progress bar 44, a button 147.
//      Limit: MAX_DIFF_CELLS.
//   2. tint: the mean colour of the whole picture, per channel. Measured: runner -0.04; a +6 tint 6.0.
//      Limit: MAX_MEAN_SHIFT. This catches a change that touches every pixel a little.
// What it does NOT see: a few changed letters in small text. Test text content with the e2e
// assertions, not with this picture.
//
// To accept a deliberate change: UPDATE_SNAPSHOTS=1 npm run test:e2e, then LOOK at the new picture.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_DIR = path.join(here, "baseline");
// Not a dot-folder: actions/upload-artifact skips hidden folders unless told otherwise.
export const ARTIFACT_DIR = path.join(here, "artifacts");

export const BLOCK = 6;               // pixels per side of an averaged block
export const CELL_THRESHOLD = 0.1;    // pixelmatch colour distance (0 strict, 1 loose) between two blocks
export const MAX_DIFF_CELLS = 10;     // blocks allowed to differ: about 360 pixels of area at 1440x900
export const MAX_MEAN_SHIFT = 1.0;    // levels (0-255) the mean of any colour channel may move

/** Mean colour of each k x k block. */
function blockAverage(png, k) {
  const w = Math.floor(png.width / k);
  const h = Math.floor(png.height / k);
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let sum = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) sum += png.data[((y * k + j) * png.width + x * k + i) * 4 + c];
    out.data[(y * w + x) * 4 + c] = Math.round(sum / (k * k));
  }
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  return out;
}

const channelMeans = (png) => {
  const m = [0, 0, 0];
  const n = png.width * png.height;
  for (let i = 0; i < png.data.length; i += 4) { m[0] += png.data[i]; m[1] += png.data[i + 1]; m[2] += png.data[i + 2]; }
  return m.map((v) => v / n);
};

export function compareImages(actualBuf, baselineBuf) {
  const a = PNG.sync.read(actualBuf);
  const b = PNG.sync.read(baselineBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { same: false, reason: `size differs: actual ${a.width}x${a.height}, baseline ${b.width}x${b.height}`, diffCells: null, meanShift: null, diffPng: null };
  }
  const A = blockAverage(a, BLOCK);
  const B = blockAverage(b, BLOCK);
  const diffCells = pixelmatch(A.data, B.data, null, A.width, A.height, { threshold: CELL_THRESHOLD, includeAA: false });
  const ma = channelMeans(a);
  const mb = channelMeans(b);
  const meanShift = Math.max(...ma.map((v, i) => Math.abs(v - mb[i])));

  const problems = [];
  if (diffCells > MAX_DIFF_CELLS) problems.push(`${diffCells} blocks of ${BLOCK}x${BLOCK} pixels differ (limit ${MAX_DIFF_CELLS})`);
  if (meanShift > MAX_MEAN_SHIFT) problems.push(`the mean colour moved by ${meanShift.toFixed(2)} levels (limit ${MAX_MEAN_SHIFT})`);

  // For a person to look at: the full-resolution difference. It is not what decides pass or fail.
  const diff = new PNG({ width: a.width, height: a.height });
  pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.05, includeAA: false });
  return {
    same: problems.length === 0,
    reason: problems.length ? problems.join("; ") : `${diffCells} blocks differ, mean colour moved ${meanShift.toFixed(2)}`,
    diffCells, meanShift, diffPng: PNG.sync.write(diff),
  };
}

/** Throws if `buffer` does not match baseline/<name>.png. Creates the baseline when asked to. */
export function expectScreenshot(buffer, name) {
  const baselinePath = path.join(BASELINE_DIR, `${name}.png`);
  if (process.env.UPDATE_SNAPSHOTS === "1") {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(baselinePath, buffer);
    return { updated: true };
  }
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`No baseline for "${name}" at ${path.relative(process.cwd(), baselinePath)}. Make it with UPDATE_SNAPSHOTS=1 npm run test:e2e, and check the picture before you commit it.`);
  }
  const result = compareImages(buffer, fs.readFileSync(baselinePath));
  if (!result.same) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACT_DIR, `${name}.actual.png`), buffer);
    if (result.diffPng) fs.writeFileSync(path.join(ARTIFACT_DIR, `${name}.diff.png`), result.diffPng);
    throw new Error(`Screenshot "${name}" changed: ${result.reason}. See e2e/artifacts/${name}.actual.png and ${name}.diff.png`);
  }
  return { updated: false };
}
