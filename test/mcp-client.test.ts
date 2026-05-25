import { describe, it, expect, vi } from "vitest";
import { QmdClient } from "../src/qmd-client";

/** Scripted MCP daemon: initialize → session header; tools/call → method result. */
function mcpFetch(getResult: unknown, statusResult: unknown) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.method === "initialize") {
      return { ok: true, status: 200, headers: new Headers({ "mcp-session-id": "sess-1" }),
        json: async () => ({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } }) } as unknown as Response;
    }
    if (body.method === "notifications/initialized") {
      return { ok: true, status: 202, headers: new Headers(), json: async () => ({}) } as unknown as Response;
    }
    if (body.method === "tools/call" && body.params.name === "get") {
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ jsonrpc: "2.0", id: body.id, result: getResult }) } as unknown as Response;
    }
    if (body.method === "tools/call" && body.params.name === "status") {
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ jsonrpc: "2.0", id: body.id, result: statusResult }) } as unknown as Response;
    }
    throw new Error("unexpected " + body.method);
  });
}

describe("QmdClient MCP", () => {
  it("get() handshakes once and returns document text + title", async () => {
    const getResult = { content: [{ type: "resource", resource: { uri: "qmd://docs/y.md", name: "docs/y.md", title: "Y", text: "# Y\nbody" } }] };
    const f = mcpFetch(getResult, {});
    const c = new QmdClient({ baseUrl: "http://localhost:8181", fetchFn: f as unknown as typeof fetch });
    const doc = await c.mcpGet("#b2");
    expect(doc.text).toContain("body");
    expect(doc.title).toBe("Y");
    // second call reuses the session (no second initialize)
    await c.mcpGet("#b2");
    const initCalls = f.mock.calls.filter((args) => JSON.parse(String((args[1] as RequestInit)?.body)).method === "initialize");
    expect(initCalls).toHaveLength(1);
  });

  it("status() returns collection list from structuredContent", async () => {
    const statusResult = { structuredContent: { totalDocuments: 2, needsEmbedding: 0, hasVectorIndex: true,
      collections: [{ name: "vault", path: "/v", pattern: "**/*.md", documents: 2, lastUpdated: "x" }] } };
    const f = mcpFetch({}, statusResult);
    const c = new QmdClient({ baseUrl: "http://localhost:8181", fetchFn: f as unknown as typeof fetch });
    const cols = await c.mcpStatus();
    expect(cols.map((x) => x.name)).toEqual(["vault"]);
  });

  it("retries the handshake after a failed initialize (no poisoned promise)", async () => {
    let initCount = 0;
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "initialize") {
        initCount++;
        const headers = initCount === 1 ? new Headers() : new Headers({ "mcp-session-id": "sess-2" });
        return { ok: true, status: 200, headers, json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }) } as unknown as Response;
      }
      if (body.method === "notifications/initialized") {
        return { ok: true, status: 202, headers: new Headers(), json: async () => ({}) } as unknown as Response;
      }
      if (body.method === "tools/call") {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ jsonrpc: "2.0", id: body.id,
          result: { structuredContent: { collections: [{ name: "vault", path: "/v", pattern: "**/*.md", documents: 1, lastUpdated: "x" }] } } }) } as unknown as Response;
      }
      throw new Error("unexpected " + body.method);
    });
    const c = new QmdClient({ baseUrl: "http://localhost:8181", fetchFn: f as unknown as typeof fetch });
    await expect(c.mcpStatus()).rejects.toThrow(/no session id/);
    const cols = await c.mcpStatus(); // must retry, not replay the cached rejection
    expect(cols.map((x) => x.name)).toEqual(["vault"]);
    expect(initCount).toBe(2);
  });
});
