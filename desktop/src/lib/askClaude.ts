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
