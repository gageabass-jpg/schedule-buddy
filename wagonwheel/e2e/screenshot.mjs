// Screenshot regression: compare a PNG with a committed baseline, pixel by pixel.
//
// Text is anti-aliased slightly differently from one machine to the next, so a small
// share of pixels may differ. Anything past that fails and writes the actual image and a
// diff to e2e/artifacts/. To accept a deliberate change: UPDATE_SNAPSHOTS=1 npm run test:e2e
//
// The baseline is made on Linux (Xvfb), the same as CI. Do not commit one made on a Mac.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_DIR = path.join(here, "baseline");
// Not a dot-folder: actions/upload-artifact skips hidden folders unless told otherwise.
export const ARTIFACT_DIR = path.join(here, "artifacts");

/** Per-pixel colour tolerance (0 strict, 1 loose) and the share of pixels allowed to differ. */
export const PIXEL_THRESHOLD = 0.05;
export const MAX_DIFF_SHARE = 0.0015;   // 0.15% = 1,944 pixels of a 1440x900 screen: smaller than the "New project" button

export function compareImages(actualBuf, baselineBuf) {
  const a = PNG.sync.read(actualBuf);
  const b = PNG.sync.read(baselineBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { same: false, reason: `size differs: actual ${a.width}x${a.height}, baseline ${b.width}x${b.height}`, share: 1, diffPng: null };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: PIXEL_THRESHOLD, includeAA: false });
  const share = n / (a.width * a.height);
  return { same: share <= MAX_DIFF_SHARE, reason: `${n} pixels differ (${(share * 100).toFixed(3)}%, limit ${(MAX_DIFF_SHARE * 100).toFixed(2)}%)`, share, diffPng: PNG.sync.write(diff) };
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
