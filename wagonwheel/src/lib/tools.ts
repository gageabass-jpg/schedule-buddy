import { notify } from "@nucleus/ui/lib/toast";
import type { Snapshot } from "@shared/types";
import { bridge, messageOf } from "./bridge";

// Backup, export and restore: the file actions the menu and the workspace menu share.
// Each says what happened. A closed dialog says nothing.

const fail = (err: unknown): void => notify(messageOf(err), { ttl: 9000 });

export async function backupDatabase(): Promise<void> {
  try {
    const saved = await bridge().backupDatabase();
    if (saved) notify(`Backup saved to ${saved.path}`, { ttl: 9000 });
  } catch (err) { fail(err); }
}

export async function exportJson(): Promise<void> {
  try {
    const saved = await bridge().exportJson();
    if (saved) notify(`Exported to ${saved.path}`, { ttl: 9000 });
  } catch (err) { fail(err); }
}

export async function exportCsv(): Promise<void> {
  try {
    const saved = await bridge().exportCsv();
    if (saved) notify(`Four CSV files saved in ${saved.path}`, { ttl: 9000 });
  } catch (err) { fail(err); }
}

/** Returns the restored workspace, or null when nothing was restored. */
export async function restoreBackup(): Promise<Snapshot | null> {
  try {
    const snap = await bridge().restoreBackup();
    if (snap) notify("Backup restored. Your previous workspace was saved beside it, as before-restore-….db.", { ttl: 10000 });
    return snap;
  } catch (err) {
    fail(err);
    return null;
  }
}

export async function revealDataFolder(): Promise<void> {
  try { await bridge().revealDataFolder(); } catch (err) { fail(err); }
}
