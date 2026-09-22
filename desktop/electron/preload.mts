import { contextBridge, ipcRenderer } from "electron";

export interface ParseScheduleRequest {
  imageBase64: string;       // raw base64, no data: prefix
  imageMediaType: string;    // e.g. "image/jpeg"
  scheduleHint: string;      // parser hint from SCHEDULE_IMPORTS
  personLabel: string;       // "Gage", "Kaylene", "Daisy"
  shiftTypes: Array<{ id: string; name: string; start: string; end: string }>;
  /** Today's local ISO date. Helps Claude disambiguate year when the image only shows month + day. */
  today: string;             // YYYY-MM-DD
  /** The month the user currently has open in the calendar. Strong hint for which year/month the schedule covers. */
  contextMonth: string;      // YYYY-MM
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
  /** Append an improvement idea to the on-disk log (userData/improvements.json). */
  addImprovement: (text: string): Promise<{ ok: boolean; count?: number; path?: string; error?: string }> =>
    ipcRenderer.invoke("improvements:add", text),
  /** Read all logged improvement ideas. */
  listImprovements: (): Promise<Array<{ id: string; text: string; createdAt: number; status: string }>> =>
    ipcRenderer.invoke("improvements:list"),
  /** Fires when the user picks "Settings…" from the macOS App menu (Cmd+,). */
  onMenuOpenApiKey: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on("menu:open-api-key", handler);
    return () => ipcRenderer.removeListener("menu:open-api-key", handler);
  },
  /** Fires when the user picks "New Event…" from the File menu (Cmd+E). */
  onMenuNewEvent: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on("menu:new-event", handler);
    return () => ipcRenderer.removeListener("menu:new-event", handler);
  },
  /** Fires when the user picks "New Shift…" from the File menu (Cmd+N). */
  onMenuNewShift: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on("menu:new-shift", handler);
    return () => ipcRenderer.removeListener("menu:new-shift", handler);
  },
  /** Fires when the user picks "Edit Shift Types…" from the File menu. */
  onMenuEditShiftTypes: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on("menu:edit-shift-types", handler);
    return () => ipcRenderer.removeListener("menu:edit-shift-types", handler);
  },
  /** Fires when the user picks "Edit Weekly Template…" from the File menu. */
  onMenuEditTemplate: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on("menu:edit-template", handler);
    return () => ipcRenderer.removeListener("menu:edit-template", handler);
  },
  /** Fires when the user picks "Coverage Requests" from the View menu. */
  onMenuOpenCoverageRequests: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on("menu:open-coverage-requests", handler);
    return () => ipcRenderer.removeListener("menu:open-coverage-requests", handler);
  },
  /** Fires when the user picks "Schedule Block…" from the Tools menu. */
  onMenuOpenScheduleBlock: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on("menu:open-schedule-block", handler);
    return () => ipcRenderer.removeListener("menu:open-schedule-block", handler);
  },
  /** Fires when the user picks "Cleaner…" from the Tools menu. */
  onMenuOpenCleaner: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on("menu:open-cleaner", handler);
    return () => ipcRenderer.removeListener("menu:open-cleaner", handler);
  },
};

contextBridge.exposeInMainWorld("sbm", api);

export type SbmApi = typeof api;
