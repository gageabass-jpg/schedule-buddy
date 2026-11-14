import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createMcpServer, serveStdio, SUPPORTED_VERSIONS, ToolError, type McpTool } from "./protocol.js";

const echo: McpTool = {
  name: "echo", description: "Say it back.", inputSchema: { type: "object", properties: { text: { type: "string" } } },
  annotations: { readOnlyHint: true },
  run: (a) => ({ said: a.text ?? null }),
};
const plain: McpTool = { name: "plain", description: "Returns text.", inputSchema: { type: "object" }, run: () => "just words" };
const refuses: McpTool = { name: "refuses", description: "Always says no.", inputSchema: { type: "object" }, run: () => { throw new ToolError("That is not allowed."); } };
const breaks: McpTool = { name: "breaks", description: "Falls over.", inputSchema: { type: "object" }, run: () => { throw new Error("kaboom"); } };

const make = (log: string[] = []) => createMcpServer({ name: "test", version: "1.2.3", instructions: "Be kind.", tools: [echo, plain, refuses, breaks], log: (l) => log.push(l) });
const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });

describe("initialize", () => {
  it("answers with what it is, what it can do, and its instructions", async () => {
    const r = await make().handle(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } }));
    expect(r).toEqual({
      jsonrpc: "2.0", id: 1,
      result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "test", version: "1.2.3" }, instructions: "Be kind." },
    });
  });

  it("speaks the version the client asks for when it knows it, and the newest otherwise", async () => {
    for (const v of SUPPORTED_VERSIONS) {
      expect(((await make().handle(rpc("initialize", { protocolVersion: v }))) as { result: { protocolVersion: string } }).result.protocolVersion).toBe(v);
    }
    const odd = (await make().handle(rpc("initialize", { protocolVersion: "1999-01-01" }))) as { result: { protocolVersion: string } };
    expect(odd.result.protocolVersion).toBe(SUPPORTED_VERSIONS[0]);
    const none = (await make().handle(rpc("initialize"))) as { result: { protocolVersion: string } };
    expect(none.result.protocolVersion).toBe(SUPPORTED_VERSIONS[0]);
  });

  it("leaves instructions out when there are none", async () => {
    const s = createMcpServer({ name: "t", version: "1", tools: [] });
    const r = (await s.handle(rpc("initialize", { protocolVersion: "2025-06-18" }))) as { result: Record<string, unknown> };
    expect("instructions" in r.result).toBe(false);
  });
});

describe("messages that need no answer, and ones that get one", () => {
  it("does not reply to a notification, known or not", async () => {
    const s = make();
    expect(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await s.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 3 } })).toBeNull();
    expect(await s.handle({ jsonrpc: "2.0", method: "who/knows" })).toBeNull();
  });

  it("answers a ping", async () => {
    expect(await make().handle(rpc("ping", undefined, "p-1"))).toEqual({ jsonrpc: "2.0", id: "p-1", result: {} });
  });

  it("says a method does not exist, with the id it was asked under", async () => {
    expect(await make().handle(rpc("resources/list", undefined, 9))).toEqual({ jsonrpc: "2.0", id: 9, error: { code: -32601, message: "Method not found: resources/list" } });
  });

  it("refuses what is not a JSON-RPC request", async () => {
    const s = make();
    expect(await s.handle([rpc("ping")])).toMatchObject({ id: null, error: { code: -32600 } });
    expect(await s.handle("hello")).toMatchObject({ error: { code: -32600 } });
    expect(await s.handle({ jsonrpc: "1.0", id: 4, method: "ping" })).toMatchObject({ id: 4, error: { code: -32600 } });
    expect(await s.handle({ jsonrpc: "2.0", id: 5 })).toMatchObject({ id: 5, error: { code: -32600 } });
  });
});

describe("tools/list", () => {
  it("lists every tool with its schema and hints, and nothing that runs", async () => {
    const r = (await make().handle(rpc("tools/list"))) as { result: { tools: Record<string, unknown>[] } };
    expect(r.result.tools.map((t) => t.name)).toEqual(["echo", "plain", "refuses", "breaks"]);
    expect(r.result.tools[0]).toEqual({ name: "echo", description: "Say it back.", inputSchema: echo.inputSchema, annotations: { readOnlyHint: true } });
    expect("run" in r.result.tools[0]).toBe(false);
    expect("annotations" in r.result.tools[1]).toBe(false);
  });
});

describe("tools/call", () => {
  const call = (s: ReturnType<typeof make>, name: string, args?: unknown) => s.handle(rpc("tools/call", { name, ...(args === undefined ? {} : { arguments: args }) })) as Promise<{ result?: { content: { type: string; text: string }[]; isError: boolean }; error?: { code: number; message: string } }>;

  it("returns a result as JSON text", async () => {
    const r = await call(make(), "echo", { text: "hi" });
    expect(r.result?.isError).toBe(false);
    expect(JSON.parse(r.result?.content[0].text ?? "")).toEqual({ said: "hi" });
  });

  it("returns text as it is, and treats missing arguments as none", async () => {
    expect((await call(make(), "plain"))?.result?.content[0].text).toBe("just words");
    expect(JSON.parse((await call(make(), "echo"))?.result?.content[0].text ?? "")).toEqual({ said: null });
  });

  it("reports a refusal as the tool's result, so the model can read it, and does not log it", async () => {
    const log: string[] = [];
    const r = await call(make(log), "refuses", {});
    expect(r.result).toEqual({ content: [{ type: "text", text: "That is not allowed." }], isError: true });
    expect(log).toEqual([]);
  });

  it("reports an unexpected failure the same way, and logs it for whoever runs the server", async () => {
    const log: string[] = [];
    const r = await call(make(log), "breaks", {});
    expect(r.result).toEqual({ content: [{ type: "text", text: "kaboom" }], isError: true });
    expect(log.join("\n")).toContain("[breaks]");
    expect(log.join("\n")).toContain("kaboom");
  });

  it("rejects an unknown tool, a missing name and arguments that are not an object", async () => {
    const s = make();
    expect((await call(s, "nope", {})).error).toEqual({ code: -32602, message: "Unknown tool: nope" });
    expect((await s.handle(rpc("tools/call", {})) as { error: { code: number } }).error.code).toBe(-32602);
    expect((await call(s, "echo", ["a"])).error?.code).toBe(-32602);
    expect((await call(s, "echo", "a")).error?.code).toBe(-32602);
  });
});

describe("serveStdio", () => {
  /** Feed the server some text and collect every line it writes back. */
  async function exchange(chunks: string[], server = make()): Promise<unknown[]> {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on("data", (d: Buffer) => lines.push(...d.toString().split("\n").filter(Boolean)));
    const done = serveStdio(server, input, output);
    for (const c of chunks) input.write(c);
    input.end();
    await done;
    return lines.map((l) => JSON.parse(l));
  }

  it("answers each line, in order, one JSON message per line", async () => {
    const out = await exchange([JSON.stringify(rpc("ping", undefined, 1)) + "\n" + JSON.stringify(rpc("ping", undefined, 2)) + "\n"]);
    expect(out).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }, { jsonrpc: "2.0", id: 2, result: {} }]);
  });

  it("copes with a message split across chunks, and with a last line that has no newline", async () => {
    const text = JSON.stringify(rpc("ping", undefined, 7));
    const out = await exchange([text.slice(0, 10), text.slice(10), "\n", JSON.stringify(rpc("ping", undefined, 8))]);
    expect(out.map((o) => (o as { id: number }).id)).toEqual([7, 8]);
  });

  it("says so, with a null id, when a line is not JSON, and carries on", async () => {
    const out = await exchange(["not json\n", JSON.stringify(rpc("ping", undefined, 3)) + "\n", "\n   \n"]);
    expect(out).toEqual([{ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { jsonrpc: "2.0", id: 3, result: {} }]);
  });

  it("keeps replies in the order of the requests even when an earlier tool is slow", async () => {
    const slow: McpTool = { name: "slow", description: "", inputSchema: { type: "object" }, run: () => new Promise((r) => setTimeout(() => r("slow"), 30)) };
    const quick: McpTool = { name: "quick", description: "", inputSchema: { type: "object" }, run: () => "quick" };
    const s = createMcpServer({ name: "t", version: "1", tools: [slow, quick] });
    const out = await exchange([
      JSON.stringify(rpc("tools/call", { name: "slow" }, 1)) + "\n" + JSON.stringify(rpc("tools/call", { name: "quick" }, 2)) + "\n",
    ], s as never);
    expect(out.map((o) => (o as { id: number }).id)).toEqual([1, 2]);
  });

  it("writes nothing for a notification", async () => {
    expect(await exchange([JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"])).toEqual([]);
  });
});
