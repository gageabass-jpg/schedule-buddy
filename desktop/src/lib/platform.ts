// Which OS the app is running on, and shortcut labels to match it.
// The preload reports process.platform; outside Electron (a browser preview)
// the user agent stands in.

const platform: string =
  (typeof window !== "undefined" && window.sbm?.platform) ||
  (typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent) ? "darwin" : "win32");

export const IS_MAC = platform === "darwin";
export const IS_WINDOWS = platform === "win32";

/**
 * A keyboard shortcut as the OS writes it: shortcut("K") is "⌘K" on a Mac and
 * "Ctrl+K" on Windows; shortcut("C", { shift: true }) is "⇧⌘C" / "Ctrl+Shift+C".
 * "↵" / "↩" stand for Return (Enter on Windows).
 */
export function shortcut(key: string, opts: { shift?: boolean } = {}): string {
  if (IS_MAC) return `${opts.shift ? "⇧" : ""}⌘${key}`;
  const k = key === "↵" || key === "↩" ? "Enter" : key;
  return `Ctrl+${opts.shift ? "Shift+" : ""}${k}`;
}
