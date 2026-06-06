#!/usr/bin/env node
/**
 * refresh-packages.mjs — enrich tracking numbers via the USPS Tracking API
 * (or EasyPost) and write public/post-buddy-data.json (the feed for
 * public/post-buddy.html, the wall package tracker).
 *
 * The tracking API gives real status, ETA, and each scan's city/state, so the
 * wall shows accurate status + a real start→finish route.
 *
 * Provider is auto-selected: USPS if creds are present, else EasyPost.
 *   USPS:     .usps.key  ("ConsumerKey:ConsumerSecret")  or env USPS_CONSUMER_KEY/USPS_CONSUMER_SECRET
 *   EasyPost: .easypost.key                              or env EASYPOST_API_KEY
 *
 * Usage:
 *   node scripts/refresh-packages.mjs                 # reads scripts/packages.input.json
 *   node scripts/refresh-packages.mjs path/to.json    # custom input file
 *   node scripts/refresh-packages.mjs 9400... 9300... # quick: bare tracking numbers
 *
 * Input file = array of { tracking, carrier?, title?, sender?, id? }.
 * Full tracking numbers stay local (input file + key files are git-ignored);
 * the public JSON only ever carries a MASKED number ("USPS •••• 7945").
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public/post-buddy-data.json");
const HOME = "Charleston, WV";

// ── input ──
const args = process.argv.slice(2);
let input;
const fileArg = args.find((a) => a.endsWith(".json"));
if (fileArg) input = JSON.parse(readFileSync(fileArg, "utf8"));
else if (args.length) input = args.map((t) => ({ tracking: t }));
else input = JSON.parse(readFileSync(join(ROOT, "scripts/packages.input.json"), "utf8"));

// ── credentials ──
function readKeyFile(name) { const p = join(ROOT, name); return existsSync(p) ? readFileSync(p, "utf8").trim() : ""; }
function uspsCreds() {
  let key = process.env.USPS_CONSUMER_KEY, secret = process.env.USPS_CONSUMER_SECRET;
  if (!key || !secret) {
    const raw = readKeyFile(".usps.key");
    if (raw) { const parts = raw.includes(":") ? raw.split(":") : raw.split(/\s+/); key = (parts[0] || "").trim(); secret = (parts[1] || "").trim(); }
  }
  return key && secret ? { key, secret } : null;
}
function easypostKey() { return (process.env.EASYPOST_API_KEY || readKeyFile(".easypost.key")).trim() || null; }

// ── geo: project a city/state onto the stylized map's 0–1000 × 0–600 space ──
function project(lon, lat) {
  let x = 120 + ((lon + 125) / 58) * 800; // lon -125..-67 → x 120..920
  let y = 150 + ((49 - lat) / 24) * 390;  // lat  49..25  → y 150..540
  return { x: Math.round(Math.max(95, Math.min(935, x))), y: Math.round(Math.max(150, Math.min(545, y))) };
}
const STATE = { AL:[-86.8,32.8],AK:[-150,61],AZ:[-111.7,34.3],AR:[-92.4,34.9],CA:[-119.7,37.2],CO:[-105.5,39],CT:[-72.7,41.6],DE:[-75.5,39],DC:[-77,38.9],FL:[-81.7,28.6],GA:[-83.4,32.6],HI:[-157,20.8],IA:[-93.5,42],ID:[-114.5,44.4],IL:[-89.2,40],IN:[-86.3,39.9],KS:[-98.4,38.5],KY:[-85.3,37.5],LA:[-92,31],MA:[-71.8,42.3],MD:[-76.8,39],ME:[-69.2,45.4],MI:[-85,44.3],MN:[-94.3,46.3],MO:[-92.5,38.4],MS:[-89.7,32.7],MT:[-109.6,47],NC:[-79.4,35.5],ND:[-100.3,47.5],NE:[-99.8,41.5],NH:[-71.6,43.7],NJ:[-74.5,40.1],NM:[-106,34.4],NV:[-116.6,39.3],NY:[-75.5,42.9],OH:[-82.8,40.3],OK:[-97.5,35.6],OR:[-120.5,44],PA:[-77.8,40.9],RI:[-71.5,41.7],SC:[-80.9,33.9],SD:[-100.2,44.4],TN:[-86.3,35.9],TX:[-99.3,31.5],UT:[-111.7,39.3],VT:[-72.7,44.1],VA:[-78.8,37.5],WA:[-120.4,47.4],WV:[-80.6,38.6],WI:[-89.9,44.6],WY:[-107.5,43] };
const CITY = { "NEW YORK,NY":[-74,40.7],"LOS ANGELES,CA":[-118.2,34.1],"CHICAGO,IL":[-87.6,41.8],"HOUSTON,TX":[-95.4,29.8],"PHOENIX,AZ":[-112.1,33.4],"PHILADELPHIA,PA":[-75.2,40],"DALLAS,TX":[-96.8,32.8],"ATLANTA,GA":[-84.4,33.7],"MEMPHIS,TN":[-90,35.1],"INDIANAPOLIS,IN":[-86.2,39.8],"COLUMBUS,OH":[-83,40],"CHARLESTON,WV":[-81.6,38.3],"LAS VEGAS,NV":[-115.1,36.2],"HENDERSON,NV":[-115,36],"DENVER,CO":[-105,39.7],"SEATTLE,WA":[-122.3,47.6],"MIAMI,FL":[-80.2,25.8],"KNOXVILLE,TN":[-83.9,36],"NASHVILLE,TN":[-86.8,36.2],"PITTSBURGH,PA":[-80,40.4],"KANSAS CITY,MO":[-94.6,39.1],"SAINT LOUIS,MO":[-90.2,38.6],"ST LOUIS,MO":[-90.2,38.6],"SALT LAKE CITY,UT":[-111.9,40.8],"PORTLAND,OR":[-122.7,45.5],"MINNEAPOLIS,MN":[-93.3,45],"DETROIT,MI":[-83,42.3],"BOSTON,MA":[-71.1,42.4],"GREENSBORO,NC":[-79.8,36.1],"CHARLOTTE,NC":[-80.8,35.2],"CINCINNATI,OH":[-84.5,39.1] };
function cityToMap(city, state) {
  const c = (city || "").trim().toUpperCase();
  const s = (state || "").trim().toUpperCase();
  const ll = CITY[c + "," + s] || STATE[s] || null;
  if (!ll) return { x: 620, y: 340 };
  const p = project(ll[0], ll[1]);
  let hsh = 0; for (const ch of c + s) hsh = (hsh * 31 + ch.charCodeAt(0)) % 97;
  return { x: p.x + ((hsh % 7) - 3), y: p.y + (((hsh >> 1) % 7) - 3) };
}

// ── formatting ──
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const titleCase = (s) => (s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
function fmtDateTime(iso) { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return ""; let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, "0"); const ap = h < 12 ? "AM" : "PM"; h = h % 12 || 12; return `${MON[d.getMonth()]} ${d.getDate()} · ${h}:${m} ${ap}`; }
function fmtETA(s) { if (!s) return "—"; let d = new Date(s); if (isNaN(d)) d = new Date(s + "T12:00:00"); if (isNaN(d)) return String(s); return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`; }
const placeStr = (city, state) => city ? titleCase(city) + (state ? ", " + state : "") : "";

// ── normalized internal shape ──
// { state:'out'|'transit'|'delivered', statusLine, statusSub, eta, carrier,
//   events:[{city,state,datetime,label}] (ascending) }
function classify(text) {
  const s = (text || "").toLowerCase();
  if (/deliver/.test(s) && !/out for|expected|estimat/.test(s)) return "delivered";
  if (/out for delivery/.test(s)) return "out";
  return "transit";
}

// ── USPS Tracking API (apis.usps.com, OAuth2 client_credentials) ──
async function uspsAuth({ key, secret }) {
  const res = await fetch("https://apis.usps.com/oauth2/v3/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: key, client_secret: secret }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`USPS OAuth ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).access_token;
}
async function uspsFetch(token, num) {
  const res = await fetch(`https://apis.usps.com/tracking/v3/tracking/${encodeURIComponent(num)}?expand=DETAIL`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`USPS tracking ${res.status}: ${text.slice(0, 300)}`);
  const j = JSON.parse(text);
  const events = (j.trackingEvents || []).map((e) => ({
    city: e.eventCity, state: e.eventState, datetime: e.eventTimestamp || e.GMTTimestamp, label: titleCase(e.eventType || ""),
  })).filter((e) => e.datetime || e.label).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const summary = j.statusSummary || j.status || (events.length ? events[events.length - 1].label : "");
  const state = classify(j.statusCategory || summary);
  return {
    state, carrier: "USPS", eta: j.expectedDeliveryDate || j.expectedDeliveryTimeStamp || null,
    statusLine: state === "delivered" ? "Delivered" : state === "out" ? "Out for Delivery" : (events.length ? events[events.length - 1].label : "In Transit"),
    statusSub: (summary || "").slice(0, 70), events,
  };
}

// ── EasyPost (fallback) ──
async function easypostFetch(KEY, code, carrier) {
  const auth = "Basic " + Buffer.from(KEY + ":").toString("base64");
  const res = await fetch("https://api.easypost.com/v2/trackers", {
    method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ tracker: { tracking_code: code, carrier: carrier || undefined } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`EasyPost ${res.status}: ${text.slice(0, 300)}`);
  const tk = JSON.parse(text);
  const events = (tk.tracking_details || []).map((d) => ({
    city: d.tracking_location?.city, state: d.tracking_location?.state, datetime: d.datetime, label: titleCase(d.message || d.status || ""),
  })).filter((e) => e.datetime || e.label).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const cName = ({ USPS:"USPS", UPS:"UPS", FedEx:"FedEx", FedExSmartPost:"FedEx", DHLExpress:"DHL", UPSMailInnovations:"UPS" }[tk.carrier] || tk.carrier || "USPS");
  const state = tk.status === "delivered" ? "delivered" : tk.status === "out_for_delivery" ? "out" : "transit";
  const latest = events[events.length - 1];
  return { state, carrier: cName, eta: tk.est_delivery_date || null,
    statusLine: state === "delivered" ? "Delivered" : state === "out" ? "Out for Delivery" : (latest ? latest.label : "In Transit"),
    statusSub: latest ? (latest.label + (placeStr(latest.city, latest.state) ? " · " + placeStr(latest.city, latest.state) : "")).slice(0, 70) : "", events };
}

// ── shape builders (operate on normalized events) ──
function buildWaypoints(events, state) {
  const located = [];
  const seen = new Set();
  for (const e of events) {
    if (!e.city) continue;
    const key = (e.city + "," + (e.state || "")).toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    located.push({ ...cityToMap(e.city, e.state), label: placeStr(e.city, e.state) });
  }
  if (located.length <= 1) {
    const cur = located[0] || { ...cityToMap("Charleston", "WV"), label: HOME };
    return [{ x: cur.x - 120, y: cur.y - 40, label: "In transit", kind: "origin" }, { ...cur, kind: state === "delivered" ? "delivered" : "current" }];
  }
  const origin = { ...located[0], kind: "origin" };
  const last = { ...located[located.length - 1], kind: state === "delivered" ? "delivered" : "current" };
  let mids = located.slice(1, -1);
  if (mids.length > 2) mids = [mids[0], mids[Math.floor(mids.length / 2)]];
  return [origin, ...mids.map((m) => ({ ...m, kind: "mid" })), last];
}
function buildEvents(events) {
  return [...events].reverse().slice(0, 8).map((e, i) => ({
    label: e.label || "Update", place: placeStr(e.city, e.state), date: fmtDateTime(e.datetime), ...(i === 0 ? { current: true } : {}),
  }));
}

// ── run ──
const usps = uspsCreds();
const ezKey = usps ? null : easypostKey();
if (!usps && !ezKey) { console.error("No tracking creds. Add .usps.key (ConsumerKey:ConsumerSecret) or .easypost.key, or set env vars."); process.exit(1); }
const provider = usps ? "USPS" : "EasyPost";
console.log(`Provider: ${provider}`);
let token = null;
if (usps) token = await uspsAuth(usps);

const entries = [];
for (let i = 0; i < input.length; i++) {
  const it = input[i];
  if (!it.tracking) continue;
  let norm;
  try { norm = usps ? await uspsFetch(token, it.tracking) : await easypostFetch(ezKey, it.tracking, it.carrier); }
  catch (e) { console.error(`! ${it.tracking}: ${e.message}`); continue; }
  const last4 = String(it.tracking).replace(/\s/g, "").slice(-4);
  entries.push({
    id: it.id || (norm.carrier.toLowerCase() + i),
    title: it.title || it.sender || `${norm.carrier} Package`,
    carrier: norm.carrier,
    tracking: `${norm.carrier} •••• ${last4}`,
    state: norm.state,
    statusLine: norm.statusLine,
    statusSub: norm.statusSub,
    eta: fmtETA(norm.eta), etaLong: fmtETA(norm.eta),
    fromCity: it.sender || (norm.events[0] && placeStr(norm.events[0].city, norm.events[0].state)) || "—",
    toCity: HOME,
    progress: norm.state === "delivered" ? 1 : norm.state === "out" ? 0.95 : 0.6,
    waypoints: buildWaypoints(norm.events, norm.state),
    events: buildEvents(norm.events),
  });
  const last = entries[entries.length - 1];
  console.log(`✓ ${last.title} — ${last.statusLine} (${norm.events.length} scans)`);
}

writeFileSync(OUT, JSON.stringify(entries, null, 2) + "\n");
console.log(`\nWrote ${entries.length} package(s) → public/post-buddy-data.json`);
