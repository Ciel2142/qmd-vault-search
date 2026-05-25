import { describe, it, expect, vi } from "vitest";
import { makeRequestUrlFetch } from "../src/request-url-fetch";

describe("makeRequestUrlFetch", () => {
  it("maps a requestUrl response to the fetch-like surface QmdClient uses", async () => {
    const req = vi.fn(async () => ({ status: 200, headers: { "Mcp-Session-Id": "s1" }, text: '{"a":1}', json: { a: 1 } }));
    const f = makeRequestUrlFetch(req);
    const res = await f("http://x/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBe("s1"); // case-insensitive lookup
    expect(res.headers.get("absent")).toBeNull();
    expect(await res.json()).toEqual({ a: 1 });
    // requestUrl must be called with throw:false so QmdClient can inspect res.ok itself
    expect(req).toHaveBeenCalledWith(expect.objectContaining({ url: "http://x/query", method: "POST", body: "{}", throw: false }));
  });

  it("reports ok:false for non-2xx (so daemon errors don't crash the transport)", async () => {
    const req = vi.fn(async () => ({ status: 406, headers: {}, text: "", json: {} }));
    const res = await makeRequestUrlFetch(req)("http://x/mcp");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(406);
  });

  it("defaults the method to GET", async () => {
    const req = vi.fn(async () => ({ status: 200, headers: {}, text: "ok", json: null }));
    await makeRequestUrlFetch(req)("http://x/health");
    expect(req).toHaveBeenCalledWith(expect.objectContaining({ url: "http://x/health", method: "GET" }));
  });
});
