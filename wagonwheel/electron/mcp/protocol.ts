// A minimal Model Context Protocol server over stdio: JSON-RPC 2.0, one message per line.
// It speaks only what a tool-only server needs (initialize, ping, tools/list, tools/call), so
// there is no SDK to bundle and nothing here touches the disk or Electron: it is a pure
// request-to-response function, which is what the tests drive.
// https://modelcontextprotocol.io/specification

import type { Readable, Writable } from "node:stream";

/** Newest first. A client that asks for another version is answered with the newest we speak. */
export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  /** Returns the result (shown to the model as JSON text), or throws an Error whose message the model can act on. */
  run(args: Record<string, unknown>): unknown | Promise<unknown>;
}

export interface McpServerOptions {
  name: string;
  version: string;
  /** Read by the model when it connects: what this server is for and how to use it. */
  instructions?: string;
  tools: McpTool[];
  /** Where unexpected failures are logged. Never stdout: that is the protocol's channel. */
  log?: (line: string) => void;
}

type Id = string | number | null;
export interface RpcResponse { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string } }

const err = (id: Id, code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** An error that is the person's to act on (bad arguments, a task that is gone). Anything else is logged. */
export class ToolError extends Error {}

export function createMcpServer(opts: McpServerOptions) {
  const tools = new Map(opts.tools.map((t) => [t.name, t]));
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  /** One incoming message to its response, or null when none is owed (a notification). */
  async function handle(message: unknown): Promise<RpcResponse | null> {
    if (!isObject(message)) return err(null, -32600, "Invalid Request");   // not a message at all (a batch, a bare value)
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
      return "id" in message ? err(id, -32600, "Invalid Request") : null;
    }
    const { method } = message;
    const params = message.params;
    const hasId = typeof message.id === "string" || typeof message.id === "number";
    const id: Id = hasId ? (message.id as string | number) : null;
    if (!hasId) return null;   // a notification (notifications/initialized, notifications/cancelled…): no reply

    switch (method) {
      case "initialize": {
        const asked = isObject(params) ? params.protocolVersion : undefined;
        const version = typeof asked === "string" && (SUPPORTED_VERSIONS as readonly string[]).includes(asked) ? asked : SUPPORTED_VERSIONS[0];
        return ok(id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: opts.name, version: opts.version },
          ...(opts.instructions ? { instructions: opts.instructions } : {}),
        });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: opts.tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, ...(annotations ? { annotations } : {}) })) });
      case "tools/call": {
        if (!isObject(params) || typeof params.name !== "string") return err(id, -32602, "tools/call needs a tool name.");
        const tool = tools.get(params.name);
        if (!tool) return err(id, -32602, `Unknown tool: ${params.name}`);
        const args = params.arguments === undefined ? {} : params.arguments;
        if (!isObject(args)) return err(id, -32602, "A tool's arguments must be an object.");
        try {
          const result = await tool.run(args);
          const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          return ok(id, { content: [{ type: "text", text }], isError: false });
        } catch (e) {
          // A failure inside a tool is reported as the tool's result, so the model reads it and can correct itself.
          const message = e instanceof Error ? e.message : String(e);
          if (!(e instanceof ToolError) && !(e instanceof Error && e.name === "AppError")) log(`[${tool.name}] ${e instanceof Error ? e.stack ?? message : message}`);
          return ok(id, { content: [{ type: "text", text: message }], isError: true });
        }
      }
      default:
        return err(id, -32601, `Method not found: ${method}`);
    }
  }

  return { handle };
}

/** Serve one client on a pair of streams until its input ends. Messages are handled in order. */
export function serveStdio(server: ReturnType<typeof createMcpServer>, input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
  return new Promise((resolve) => {
    let buffer = "";
    let queue: Promise<void> = Promise.resolve();
    const send = (response: RpcResponse): void => { output.write(`${JSON.stringify(response)}\n`); };

    const line = (text: string): void => {
      if (!text.trim()) return;
      queue = queue.then(async () => {
        let message: unknown;
        try { message = JSON.parse(text); } catch { send(err(null, -32700, "Parse error")); return; }
        const response = await server.handle(message);
        if (response) send(response);
      });
    };

    input.setEncoding("utf8");
    input.on("data", (chunk: string) => {
      buffer += chunk;
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
    });
    input.on("end", () => { line(buffer); buffer = ""; void queue.then(() => resolve()); });
  });
}
