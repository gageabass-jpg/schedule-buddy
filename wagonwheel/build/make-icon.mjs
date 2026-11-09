// Renders build/icon.svg to build/icon.png (1024x1024, transparent corners) with headless Chromium.
// Usage: node build/make-icon.mjs      (needs Playwright's Chromium: npx playwright-core install chromium)
import { chromium } from "playwright-core";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(path.join(here, "icon.svg"), "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`);
await page.screenshot({ path: path.join(here, "icon.png"), omitBackground: true });
await browser.close();
console.log("wrote build/icon.png");
