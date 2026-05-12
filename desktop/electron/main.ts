import { app, BrowserWindow, ipcMain, Menu, safeStorage, shell, type MenuItemConstructorOptions } from "electron";
import * as path from "node:path";
import * as url from "node:url";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";

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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
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

  win.once("ready-to-show", () => win.show());

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
          label: "New Event…",
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

app.whenReady().then(() => {
  installAppMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
