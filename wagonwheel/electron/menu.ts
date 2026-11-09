import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import type { MenuCommand } from "../shared/types.js";

/** The application menu. Items that act on the workspace send a command to the window,
 *  which owns the views and dialogs. */
export function installMenu(): void {
  const isMac = process.platform === "darwin";
  const send = (command: MenuCommand) => (): void => {
    (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send("ww:command", command);
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" }, { type: "separator" },
            { role: "services" }, { type: "separator" },
            { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" },
            { role: "quit" },
          ],
        } as MenuItemConstructorOptions]
      : []),
    {
      label: "File",
      submenu: [
        { label: "New Task…", accelerator: "CmdOrCtrl+N", click: send("new-task") },
        { label: "New Project…", accelerator: "CmdOrCtrl+Shift+N", click: send("new-project") },
        { label: "Capture to Inbox", accelerator: "CmdOrCtrl+L", click: send("focus-capture") },
        { type: "separator" },
        { label: "Back Up Database…", click: send("backup") },
        { label: "Export as JSON…", click: send("export-json") },
        { label: "Export as CSV…", click: send("export-csv") },
        { label: "Restore From Backup…", click: send("restore") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" },
        ...(isMac ? [{ role: "pasteAndMatchStyle" } as MenuItemConstructorOptions] : []),
        { role: "delete" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Dashboard", accelerator: "CmdOrCtrl+1", click: send("go-dashboard") },
        { label: "All Projects", accelerator: "CmdOrCtrl+2", click: send("go-projects") },
        { label: "All Tasks", accelerator: "CmdOrCtrl+3", click: send("go-tasks") },
        { label: "Timeline", accelerator: "CmdOrCtrl+4", click: send("go-timeline") },
        { label: "Inbox", accelerator: "CmdOrCtrl+5", click: send("go-inbox") },
        { type: "separator" },
        { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
