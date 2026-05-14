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

export interface AskResponse {
  reply: string;
  messages: AskMessage[];
}

const fns = getFunctions(firebaseApp, "us-central1");
const callAsk = httpsCallable<{ message: string; history?: AskMessage[] }, AskResponse>(
  fns,
  "askClaude",
);

export async function askClaude(message: string, history: AskMessage[] = []): Promise<AskResponse> {
  const result = await callAsk({ message, history });
  return result.data;
}
