// Renderer-side surface for the IPC bridge exposed by electron/preload.ts.
// Kept in sync by hand — preload.ts is the source of truth for the actual shape.

export interface ParseScheduleRequest {
  imageBase64: string;
  imageMediaType: string;
  scheduleHint: string;
  personLabel: string;
  shiftTypes: Array<{ id: string; name: string; start: string; end: string }>;
  today: string;             // YYYY-MM-DD
  contextMonth: string;      // YYYY-MM
}

export interface ParsedShiftRow {
  date: string;
  shiftTypeId: string | null;
  label: string;
  confidence: number;
}

export interface ParseScheduleResult {
  ok: boolean;
  rows?: ParsedShiftRow[];
  monthCovered?: string;
  error?: string;
}

export interface SbmApi {
  hasApiKey: () => Promise<boolean>;
  setApiKey: (key: string) => Promise<{ ok: boolean; error?: string }>;
  clearApiKey: () => Promise<void>;
  parseSchedule: (req: ParseScheduleRequest) => Promise<ParseScheduleResult>;
  addImprovement: (text: string) => Promise<{ ok: boolean; count?: number; path?: string; error?: string }>;
  listImprovements: () => Promise<Array<{ id: string; text: string; createdAt: number; status: string }>>;
  onMenuOpenApiKey: (cb: () => void) => () => void;
  onMenuNewEvent: (cb: () => void) => () => void;
  onMenuNewShift: (cb: () => void) => () => void;
  onMenuEditShiftTypes: (cb: () => void) => () => void;
  onMenuEditTemplate: (cb: () => void) => () => void;
  onMenuOpenCoverageRequests: (cb: () => void) => () => void;
  onMenuOpenScheduleBlock: (cb: () => void) => () => void;
  onMenuOpenCleaner: (cb: () => void) => () => void;
}

declare global {
  interface Window {
    sbm?: SbmApi;
  }
}

export {};
