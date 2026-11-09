// Thin client wrapper around the askClaude Cloud Function.
// Auth happens automatically via Firebase Auth's persisted user token.

import { getFunctions, httpsCallable } from "firebase/functions";
import { app as firebaseApp } from "../firebase";

export interface AskMessage {
  role: "user" | "assistant";
  /** String for plain text turns, structured blocks when the assistant
   *  returned tool_use content (passed back verbatim on the next turn). */
  content: unknown;
}

export type AskMode = "read" | "write";

export interface AskResponse {
  reply: string;
  messages: AskMessage[];
  /** Which model answered — shown in the panel beside the mode control. */
  model?: string;
  mode?: AskMode;
  /** Present when the reply changed the schedule; pass `id` to undoChange. */
  change?: { id: string; tools: string[] };
}

const fns = getFunctions(firebaseApp, "us-central1");
const callAsk = httpsCallable<
  { message: string; history?: AskMessage[]; mode?: AskMode },
  AskResponse
>(fns, "askClaude");

/**
 * `mode: "read"` asks the function to withhold every write tool, so the
 * assistant can answer but cannot change the schedule.
 */
export async function askClaude(
  message: string,
  history: AskMessage[] = [],
  mode: AskMode = "write",
): Promise<AskResponse> {
  const result = await callAsk({ message, history, mode });
  return result.data;
}

export interface EmailScanResponse {
  reply: string;
  model: string;
  /** Emails the scan looked at. */
  scanned: number;
  added: Array<{ id: string; date: string; title: string; who: "G" | "K" | "Daisy" | "family"; startTime?: string }>;
  /** Proposals dropped because the calendar already had them. */
  skipped: number;
  /** Present when events were added; pass `id` to undoChange to take them all back. */
  change?: { id: string; tools: string[] };
}

// A scan reads mail and calls the model several times, so it outlasts the
// default 70-second callable timeout.
const callScan = httpsCallable<{ instruction?: string; gmailToken: string }, EmailScanResponse>(
  fns, "scanEmailForEvents", { timeout: 180_000 },
);

/**
 * Look through the user's Gmail for appointments and events and add them to the
 * calendar. `gmailToken` is the short-lived read token from getGmailAccessToken;
 * the function uses it for this request only.
 */
export async function scanEmail(instruction: string, gmailToken: string): Promise<EmailScanResponse> {
  const result = await callScan({ instruction, gmailToken });
  return result.data;
}

const callUndo = httpsCallable<{ changeId: string }, { ok: true; restored: string[] }>(
  fns, "undoNucleusChange",
);

/**
 * Put back what one nucleusAI reply changed. The function refuses, with a
 * message saying what moved, if that part of the schedule has been edited
 * since, rather than erase the newer edit.
 */
export async function undoChange(changeId: string): Promise<string[]> {
  const result = await callUndo({ changeId });
  return result.data.restored;
}
