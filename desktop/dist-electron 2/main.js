import { app, BrowserWindow, shell } from "electron";
import * as path from "node:path";
import * as url from "node:url";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";
function createWindow() {
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        titleBarStyle: "hiddenInset",
        backgroundColor: "#0F0F12",
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    win.once("ready-to-show", () => win.show());
    // Open most external links in the system browser, but allow OAuth popups
    // (Google, Apple, Firebase auth handler) to open inside Electron so
    // signInWithPopup works.
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
        }
        catch {
            // fall through to external
        }
        shell.openExternal(target);
        return { action: "deny" };
    });
    if (isDev) {
        win.loadURL("http://localhost:5173");
        win.webContents.openDevTools({ mode: "detach" });
    }
    else {
        const indexPath = path.join(__dirname, "..", "dist", "index.html");
        win.loadURL(url.pathToFileURL(indexPath).toString());
    }
}
app.whenReady().then(() => {
    createWindow();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        app.quit();
});
