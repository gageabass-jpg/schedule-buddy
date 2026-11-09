import type { ErrorCode, WagonwheelError } from "../../shared/types.js";

/** An error the person can be told about. `message` is written for them, not for a log. */
export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export const invalid = (message: string): AppError => new AppError("validation", message);
export const notFound = (what: string): AppError => new AppError("not_found", `${what} no longer exists.`);

/** Turn anything thrown into the shape that crosses the IPC boundary. */
export function toWagonwheelError(err: unknown): WagonwheelError {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  const raw = err instanceof Error ? err.message : String(err);
  // node:sqlite errors carry the SQLite reason. Keep it: it is the useful part.
  return { code: "database", message: `The database could not finish that: ${raw}` };
}
