import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, type MenuItemConstructorOptions } from "electron";
import * as path from "node:path";
import * as url from "node:url";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";

// ───────────────── Main-process crash guard ─────────────────
// macOS periodically purges the per-user temp dir ($TMPDIR, under
// /var/folders/…). Chromium/preferences occasionally atomic-writes a throwaway
// cache file there; if the purge races that write, Node throws a transient
// ENOENT/EPERM/EACCES. No app data lives in temp (the schedule is in Firebase),
// but Electron's default handler pops a fatal "A JavaScript error occurred in
// the main process" dialog. We swallow ONLY those transient temp-dir fs errors
// and log them; every other error is still surfaced in a dialog as before.

function isTransientTempError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as NodeJS.ErrnoException;
  if (!["ENOENT", "EPERM", "EACCES", "ENOTDIR"].includes(e.code ?? "")) return false;
  const p = String(e.path ?? "");
  if (!p) return false;
  // Only inside the OS temp dir(s). "/var/folders/" also matches the
  // "/private/var/folders/" symlink-resolved form.
  return p.startsWith(os.tmpdir()) || p.includes("/var/folders/");
}

function surfaceFatal(err: unknown): void {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  try {
    dialog.showErrorBox("Nucleus Manager — unexpected error", msg);
  } catch {
    // dialog can be unavailable very early in startup — the console log stands.
  }
}

process.on("uncaughtException", (err) => {
  if (isTransientTempError(err)) {
    console.warn("[main] ignored transient temp-dir error:", (err as Error)?.message ?? err);
    return;
  }
  console.error("[main] uncaughtException:", err);
  surfaceFatal(err);
});

process.on("unhandledRejection", (reason) => {
  if (isTransientTempError(reason)) {
    console.warn("[main] ignored transient temp-dir rejection:", (reason as Error)?.message ?? reason);
    return;
  }
  console.error("[main] unhandledRejection:", reason);
});

// ───────────────── Production renderer host ─────────────────
// Packaged Electron apps load the renderer from file://, but Firebase Auth's
// OAuth flow refuses non-http(s) origins. So in production we spin up a tiny
// static server on a random localhost port and load that — localhost is
// auto-whitelisted by Firebase Auth.

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".woff2": "font/woff2",
  ".woff":  "font/woff",
};

async function startRendererServer(rootDir: string): Promise<string> {
  const server = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url ?? "/", "http://localhost");
      let rel = decodeURIComponent(reqUrl.pathname);
      if (rel === "/" || rel === "") rel = "/index.html";
      // Strip the leading slash + reject path traversal.
      const safeRel = path.normalize(rel).replace(/^[/\\]+/, "");
      const filePath = path.join(rootDir, safeRel);
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      if (!fsSync.existsSync(filePath)) {
        // SPA fallback: unknown paths get index.html (so client-side
        // routing keeps working if we ever add it).
        const indexPath = path.join(rootDir, "index.html");
        if (fsSync.existsSync(indexPath)) {
          res.writeHead(200, { "Content-Type": MIME[".html"] });
          fsSync.createReadStream(indexPath).pipe(res);
          return;
        }
        res.writeHead(404).end("not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
      fsSync.createReadStream(filePath).pipe(res);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  // Use a fixed high-numbered port so Firebase Auth's session storage (keyed
  // by origin) survives across app launches. Falls back to a random port if
  // the preferred one is busy — auth will re-prompt in that case.
  const PREFERRED_PORT = 53217;
  const port = await new Promise<number>((resolve) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Retry on an ephemeral port.
        server.listen(0, "127.0.0.1", () => {
          resolve((server.address() as AddressInfo).port);
        });
      } else {
        resolve(0);
      }
    });
    server.listen(PREFERRED_PORT, "127.0.0.1", () => resolve(PREFERRED_PORT));
  });
  return `http://localhost:${port}`;
}

// ───────────────── API key storage via safeStorage ─────────────────
// Encrypted at rest via OS keychain (macOS), DPAPI (Windows), or libsecret (Linux).
// The plaintext key never leaves the main process.

function keyFile(): string {
  return path.join(app.getPath("userData"), "anthropic-key.enc");
}

async function readStoredApiKey(): Promise<string | null> {
  try {
    const buf = await fs.readFile(keyFile());
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

ipcMain.handle("key:has", async () => {
  const key = await readStoredApiKey();
  return !!key;
});

ipcMain.handle("key:set", async (_e, raw: string) => {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Empty key." };
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: "OS encryption is not available on this machine." };
  }
  try {
    const enc = safeStorage.encryptString(raw.trim());
    await fs.writeFile(keyFile(), enc);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't store the key." };
  }
});

ipcMain.handle("key:clear", async () => {
  try { await fs.unlink(keyFile()); } catch { /* not present */ }
});

// ───────────────── Improvements log ─────────────────
// The light-bulb button in the sidebar lets the user jot "what can we do
// better?" ideas. They land in a plain JSON file under userData so they can be
// picked up later (e.g. "update the app and pull from there") — no Firestore
// round-trip and readable from disk.

interface ImprovementEntry {
  id: string;
  text: string;
  createdAt: number;   // epoch ms
  status: "new";       // reserved for future triage (e.g. "done")
}

function improvementsFile(): string {
  return path.join(app.getPath("userData"), "improvements.json");
}

async function readImprovements(): Promise<ImprovementEntry[]> {
  try {
    const raw = await fs.readFile(improvementsFile(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ImprovementEntry[]) : [];
  } catch {
    return [];
  }
}

ipcMain.handle("improvements:add", async (_e, text: string) => {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "Empty idea." };
  }
  try {
    const list = await readImprovements();
    const entry: ImprovementEntry = {
      id: `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      text: text.trim(),
      createdAt: Date.now(),
      status: "new",
    };
    list.push(entry);
    await fs.writeFile(improvementsFile(), JSON.stringify(list, null, 2), "utf8");
    return { ok: true, count: list.length, path: improvementsFile() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save the idea." };
  }
});

ipcMain.handle("improvements:list", async () => {
  return readImprovements();
});

// ───────────────── Anthropic Vision: parse a schedule photo ─────────────────

interface ParseScheduleRequest {
  imageBase64: string;
  imageMediaType: string;
  scheduleHint: string;
  personLabel: string;
  shiftTypes: Array<{ id: string; name: string; start: string; end: string }>;
  today: string;
  contextMonth: string;
}

interface ParsedShiftRow {
  date: string;
  shiftTypeId: string | null;
  label: string;
  confidence: number;
}

function buildVisionPrompt(req: ParseScheduleRequest): string {
  const typesList = req.shiftTypes.map(
    (s) => `  - { id: "${s.id}", name: "${s.name}", start: "${s.start}", end: "${s.end}" }`,
  ).join("\n");
  const validIds = req.shiftTypes.map((s) => `"${s.id}"`).join(", ") || "(empty catalog)";
  return [
    `You are extracting a schedule for ${req.personLabel} from the attached image.`,
    `Context: ${req.scheduleHint}`,
    ``,
    `Today's date is ${req.today}. The user is currently viewing ${req.contextMonth} in the calendar.`,
    `If the image shows month/day labels without an explicit year, assume the dates are in ${req.contextMonth} (or rolling forward into the next month if the calendar continues past it). NEVER default to a prior year.`,
    ``,
    `Available shift types in the user's catalog:`,
    typesList || "  (none — every shiftTypeId must be null)",
    ``,
    `Return ONLY a valid JSON object (no prose, no markdown fences) of the form:`,
    `{`,
    `  "monthCovered": "YYYY-MM" or null,`,
    `  "rows": [`,
    `    { "date": "YYYY-MM-DD", "shiftTypeId": "<one of: ${validIds}> or null", "label": "7p" or "school" or "", "confidence": 0.0..1.0 }`,
    `  ]`,
    `}`,
    ``,
    `Rules:`,
    `- One row per dated entry visible in the image.`,
    `- shiftTypeId MUST be one of the literal ids listed above, or null. NEVER invent an id, NEVER reformat one, NEVER use a name in place of an id. If no listed type matches the visible shift's start time, use null and the user will map it manually.`,
    `- "label" should be the compact time shown in the image (e.g. "3p", "7p", "11p", "8a") for hospital schedules, or "school" / "no school" / "half day" for school calendars.`,
    `- "confidence" 1.0 means the date and label are unambiguous; 0.5 means the label is partially obscured; 0.2 means you're guessing.`,
    `- Do NOT invent dates outside what the image shows.`,
    `- Output JSON only.`,
  ].join("\n");
}

ipcMain.handle("vision:parse", async (_e, req: ParseScheduleRequest) => {
  const key = await readStoredApiKey();
  if (!key) return { ok: false, error: "No Anthropic API key set. Open settings to add one." };

  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: req.imageMediaType, data: req.imageBase64 },
          },
          { type: "text", text: buildVisionPrompt(req) },
        ],
      },
    ],
  };

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error reaching Anthropic." };
  }

  if (!resp.ok) {
    let detail = "";
    try { detail = (await resp.text()).slice(0, 500); } catch { /* ignore */ }
    return { ok: false, error: `Anthropic API ${resp.status}: ${detail}` };
  }

  let payload: { content?: Array<{ type: string; text?: string }> } | null = null;
  try { payload = await resp.json(); } catch {
    return { ok: false, error: "Anthropic returned a non-JSON response." };
  }
  const textParts = (payload?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "");
  const text = textParts.join("\n").trim();
  if (!text) return { ok: false, error: "Empty response from Anthropic." };

  // Strip any markdown fencing if present.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: { rows?: unknown; monthCovered?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: "Couldn't parse the model's JSON output." };
  }

  const rows: ParsedShiftRow[] = [];
  if (Array.isArray(parsed.rows)) {
    for (const r of parsed.rows) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const date = typeof o.date === "string" ? o.date : null;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      rows.push({
        date,
        shiftTypeId: typeof o.shiftTypeId === "string" && o.shiftTypeId.length ? o.shiftTypeId : null,
        label: typeof o.label === "string" ? o.label : "",
        confidence: typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0.5,
      });
    }
  }

  return {
    ok: true,
    rows,
    monthCovered: typeof parsed.monthCovered === "string" ? parsed.monthCovered : undefined,
  };
});

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0F0F12",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Always open maximized so the header (wordmark + date bar) has room to sit
  // on one line — at the default 1440-wide size the top bar wraps on smaller
  // displays. Maximize before showing so it never flashes at the smaller size.
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  const AUTH_HOSTS = [
    "accounts.google.com",
    "appleid.apple.com",
    "schedule-buddy-dd2cf.firebaseapp.com",
  ];
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      const u = new URL(target);
      if (AUTH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h))) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 520,
            height: 720,
            webPreferences: { contextIsolation: true, nodeIntegration: false },
          },
        };
      }
    } catch {
      // fall through to external
    }
    shell.openExternal(target);
    return { action: "deny" };
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Serve dist/ over a random localhost port instead of file:// — Firebase
    // Auth refuses file:// origins for OAuth popups/redirects.
    const distDir = path.join(__dirname, "..", "dist");
    const origin = await startRendererServer(distDir);
    win.loadURL(origin + "/");
  }
}

function installAppMenu(): void {
  const focused = (): BrowserWindow | undefined =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const sendOpenApiKey = (): void => { focused()?.webContents.send("menu:open-api-key"); };
  const sendNewEvent = (): void => { focused()?.webContents.send("menu:new-event"); };
  const sendNewShift = (): void => { focused()?.webContents.send("menu:new-shift"); };
  const sendEditShiftTypes = (): void => { focused()?.webContents.send("menu:edit-shift-types"); };
  const sendEditTemplate = (): void => { focused()?.webContents.send("menu:edit-template"); };
  const sendOpenCoverageRequests = (): void => { focused()?.webContents.send("menu:open-coverage-requests"); };
  const sendOpenScheduleBlock = (): void => { focused()?.webContents.send("menu:open-schedule-block"); };
  const sendOpenCleaner = (): void => { focused()?.webContents.send("menu:open-cleaner"); };

  const isMac = process.platform === "darwin";

  const appMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      {
        label: "Settings…",
        accelerator: "CmdOrCtrl+,",
        click: sendOpenApiKey,
      },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Shift…",
          accelerator: "CmdOrCtrl+N",
          click: sendNewShift,
        },
        {
          label: "New Life Item…",
          accelerator: "CmdOrCtrl+E",
          click: sendNewEvent,
        },
        { type: "separator" },
        {
          label: "Edit Shift Types…",
          accelerator: "CmdOrCtrl+Shift+T",
          click: sendEditShiftTypes,
        },
        {
          label: "Edit Weekly Template…",
          accelerator: "CmdOrCtrl+Shift+W",
          click: sendEditTemplate,
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(isMac
          ? ([
              { role: "pasteAndMatchStyle" },
              { role: "delete" },
              { role: "selectAll" },
            ] as MenuItemConstructorOptions[])
          : ([{ role: "delete" }, { role: "selectAll" }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Coverage Requests",
          accelerator: "CmdOrCtrl+Shift+C",
          click: sendOpenCoverageRequests,
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Tools",
      submenu: [
        {
          label: "Schedule Block…",
          accelerator: "CmdOrCtrl+Shift+B",
          click: sendOpenScheduleBlock,
        },
        {
          label: "Cleaner…",
          click: sendOpenCleaner,
        },
      ],
    },
    { role: "windowMenu" },
    ...(isMac
      ? []
      : ([
          {
            label: "Help",
            submenu: [
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                click: sendOpenApiKey,
              },
            ],
          },
        ] as MenuItemConstructorOptions[])),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ───────────────── One-time userData migration ─────────────────
// The app was renamed from "Schedule Buddy Manager" to "Nucleus Manager", and
// Electron derives the userData folder from the product name. Carry the
// improvements log across so nothing the user wrote is lost. The encrypted
// Anthropic key is NOT copied: macOS ties the safeStorage keychain entry to
// the app name, so it could not be decrypted anyway — the user re-enters it.
function migrateLegacyUserData(): void {
  try {
    const legacyDir = path.join(app.getPath("appData"), "Schedule Buddy Manager");
    const currentDir = app.getPath("userData");
    if (legacyDir === currentDir || !fsSync.existsSync(legacyDir)) return;
    const from = path.join(legacyDir, "improvements.json");
    const to = path.join(currentDir, "improvements.json");
    if (fsSync.existsSync(from) && !fsSync.existsSync(to)) {
      fsSync.mkdirSync(currentDir, { recursive: true });
      fsSync.copyFileSync(from, to);
    }
  } catch (err) {
    console.warn("[nucleus] legacy userData migration skipped:", err);
  }
}

app.whenReady().then(() => {
  migrateLegacyUserData();
  installAppMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
