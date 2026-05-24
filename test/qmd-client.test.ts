import { describe, it, expect, vi } from "vitest";
import { QmdClient } from "../src/qmd-client";

function fakeFetch(handler: (url: string, init?: RequestInit) => { status: number; json: unknown }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const { status, json } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => json } as unknown as Response;
  });
}

describe("QmdClient.health", () => {
  it("returns ok:true with uptime on 200", async () => {
    const f = fakeFetch(() => ({ status: 200, json: { status: "ok", uptime: 42 } }));
    const c = new QmdClient({ baseUrl: "http://localhost:8181", fetchFn: f as unknown as typeof fetch });
    expect(await c.health()).toEqual({ ok: true, uptime: 42 });
    expect(f).toHaveBeenCalledWith("http://localhost:8181/health", expect.objectContaining({ method: "GET" }));
  });
  it("returns ok:false when fetch throws (daemon down)", async () => {
    const f = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const c = new QmdClient({ baseUrl: "http://localhost:8181", fetchFn: f as unknown as typeof fetch });
    expect(await c.health()).toEqual({ ok: false });
  });
  it("returns ok:false on non-200 (daemon replied with error status)", async () => {
    const f = fakeFetch(() => ({ status: 503, json: {} }));
    const c = new QmdClient({ baseUrl: "http://localhost:8181", fetchFn: f as unknown as typeof fetch });
    expect(await c.health()).toEqual({ ok: false });
  });
});

describe("QmdClient.query", () => {
  it("posts searches+collections and returns results array", async () => {
    const sample = { results: [{ docid: "#a1", file: "notes/x.md", title: "X", score: 0.9, context: null, line: 3, snippet: "hi" }] };
    const f = fakeFetch((url, init) => {
      expect(url).toBe("http://localhost:8181/query");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        searches: [{ type: "vec", query: "auth" }],
        collections: ["vault", "docs"],
        rerank: true,
      });
      return { status: 200, json: sample };
    });
    const c = new QmdClient({ baseUrl: "http://localhost:8181", fetchFn: f as unknown as typeof fetch });
    const res = await c.query({ searches: [{ type: "vec", query: "auth" }], collections: ["vault", "docs"], rerank: true });
    expect(res).toHaveLength(1);
    expect(res[0].docid).toBe("#a1");
  });
  it("throws on non-200", async () => {
    const f = fakeFetch(() => ({ status: 400, json: { error: "bad" } }));
    const c = new QmdClient({ baseUrl: "http://localhost:8181", fetchFn: f as unknown as typeof fetch });
    await expect(c.query({ searches: [{ type: "lex", query: "x" }] })).rejects.toThrow(/HTTP 400/);
  });
});
