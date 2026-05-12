// Renderer-side surface for the IPC bridge exposed by electron/preload.ts.
// Kept in sync by hand — preload.ts is the source of truth for the actual shape.

export interface ParseScheduleRequest {
  imageBase64: string;
  imageMediaType: string;
  scheduleHint: string;
  personLabel: string;
  shiftTypes: Array<{ id: string; name: string; start: string; end: string }>;
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
}

declare global {
  interface Window {
    sbm?: SbmApi;
  }
}

export {};
