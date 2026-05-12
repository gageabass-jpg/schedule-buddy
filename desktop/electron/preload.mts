import { contextBridge, ipcRenderer } from "electron";

export interface ParseScheduleRequest {
  imageBase64: string;       // raw base64, no data: prefix
  imageMediaType: string;    // e.g. "image/jpeg"
  scheduleHint: string;      // parser hint from SCHEDULE_IMPORTS
  personLabel: string;       // "Gage", "Kaylene", "Daisy"
  shiftTypes: Array<{ id: string; name: string; start: string; end: string }>;
}

export interface ParsedShiftRow {
  date: string;              // YYYY-MM-DD
  shiftTypeId: string | null; // null = no match in catalog (user maps in review)
  label: string;
  confidence: number;        // 0..1
}

export interface ParseScheduleResult {
  ok: boolean;
  rows?: ParsedShiftRow[];
  monthCovered?: string;     // YYYY-MM if model returned one
  error?: string;
}

const api = {
  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke("key:has"),
  setApiKey: (key: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("key:set", key),
  clearApiKey: (): Promise<void> => ipcRenderer.invoke("key:clear"),
  parseSchedule: (req: ParseScheduleRequest): Promise<ParseScheduleResult> =>
    ipcRenderer.invoke("vision:parse", req),
  /** Fires when the user picks "Settings…" from the macOS App menu (Cmd+,). */
  onMenuOpenApiKey: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on("menu:open-api-key", handler);
    return () => ipcRenderer.removeListener("menu:open-api-key", handler);
  },
};

contextBridge.exposeInMainWorld("sbm", api);

export type SbmApi = typeof api;
