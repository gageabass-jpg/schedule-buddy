import { app, BrowserWindow, shell } from "electron";
import * as path from "node:path";
import * as url from "node:url";
import { DataService } from "./data-service.js";
import { registerIpc } from "./ipc.js";
import { installMenu } from "./menu.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";

// The name sets the data folder: ~/Library/Application Support/Nucleus Wagonwheel.
// It is set before anything asks for a path, so a dev run and a built app share data.
app.setName("Nucleus Wagonwheel");

// The tests point the app at a throwaway folder.
if (process.env.WAGONWHEEL_DATA_DIR) app.setPath("userData", process.env.WAGONWHEEL_DATA_DIR);

let mainWindow: BrowserWindow | null = null;
let data: DataService | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1020,
    minHeight: 680,
    // The title bar is hidden; the app draws its own 28px strip (TitleBar.tsx).
    // On a Mac the traffic lights sit inset on its left, centred in it.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 19, y: 7 } }
      : { titleBarStyle: "hidden" as const, titleBarOverlay: { color: "#4B1426", symbolColor: "#F5F0F1", height: 28 } }),
    backgroundColor: "#130F13",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,   // an ES-module preload needs it; the page itself has no Node
    },
  });
  mainWindow = win;
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });
  win.once("ready-to-show", () => win.show());

  // Nothing in the app opens another window or leaves the page. A link goes to the browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (target !== win.webContents.getURL()) event.preventDefault();
  });

  if (isDev) {
    void win.loadURL("http://localhost:5273");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }
}

// One window, one database connection. A second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    data = new DataService(path.join(app.getPath("userData"), "wagonwheel.db"), () => mainWindow);
    registerIpc(data);
    installMenu();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => data?.close());
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
