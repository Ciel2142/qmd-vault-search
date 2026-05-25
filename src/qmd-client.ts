export type QmdSubQuery = { type: "lex" | "vec" | "hyde"; query: string };

export interface QmdSearchResult {
  docid: string;        // "#abc123"
  file: string;         // collection-relative displayPath
  title: string;
  score: number;
  context: string | null;
  line: number;
  snippet: string;
}

export interface QmdQueryOptions {
  searches: QmdSubQuery[];
  limit?: number;
  minScore?: number;
  candidateLimit?: number;
  collections?: string[];
  intent?: string;
  rerank?: boolean;
}

/** Minimal HTTP init the client emits. */
export interface FetchLikeInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** The subset of a fetch Response the client reads. Lets us swap in Obsidian's requestUrl (no CORS / no Window binding). */
export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: FetchLikeInit) => Promise<FetchLikeResponse>;

/** Default transport: global fetch called as a free function so `this` binds to the realm global, not the QmdClient (else "Illegal invocation"). Prod injects a requestUrl-backed fetchFn instead. */
const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export interface QmdClientConfig {
  baseUrl: string;
  fetchFn?: FetchLike;
}

export interface QmdCollection {
  name: string;
  path: string | null;
  pattern: string | null;
  documents: number;
  lastUpdated: string;
}

export interface QmdDocument {
  path: string;
  title: string;
  text: string;
}

export class QmdClient {
  constructor(private cfg: QmdClientConfig) {}
  private get f(): FetchLike {
    return this.cfg.fetchFn ?? defaultFetch;
  }

  private sessionId: string | null = null;
  private initPromise: Promise<void> | null = null;
  private nextId = 1;

  private mcpInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this._doInit().catch((e) => {
        this.initPromise = null;
        throw e;
      });
    }
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    const initRes = await this.f(`${this.cfg.baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "obsidian-qmd", version: "0.1.0" } } }),
    });
    const sid = initRes.headers.get("mcp-session-id");
    if (!sid) throw new Error("qmd MCP: no session id from initialize");
    this.sessionId = sid;
    await this.f(`${this.cfg.baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "mcp-session-id": sid, Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
  }

  private async mcpCall<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.mcpInit();
    const res = await this.f(`${this.cfg.baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "mcp-session-id": this.sessionId!, Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method: "tools/call", params: { name, arguments: args } }),
    });
    if (!res.ok) throw new Error(`qmd MCP ${name} failed: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`qmd MCP ${name}: ${body.error.message}`);
    return body.result as T;
  }

  async mcpGet(fileOrDocid: string): Promise<QmdDocument> {
    const result = await this.mcpCall<{ content: { type: string; resource?: { uri?: string; name?: string; title?: string; text?: string } }[] }>("get", { file: fileOrDocid });
    const res = result.content.find((c) => c.type === "resource")?.resource;
    if (!res) throw new Error(`qmd get: no document for ${fileOrDocid}`);
    // MCP `get` returns a standard resource { uri, mimeType, text } — no name/title — so derive them from the uri.
    const path = res.name ?? (res.uri ?? "").replace(/^qmd:\/\//, "");
    const title = res.title || path.split("/").pop()?.replace(/\.md$/i, "") || path || fileOrDocid;
    return { path, title, text: res.text ?? "" };
  }

  async mcpStatus(): Promise<QmdCollection[]> {
    const result = await this.mcpCall<{ structuredContent: { collections: QmdCollection[] } }>("status", {});
    return result.structuredContent.collections;
  }

  /** Reset the cached MCP session (call after settings change). */
  resetSession(): void { this.sessionId = null; this.initPromise = null; }

  async health(): Promise<{ ok: boolean; uptime?: number }> {
    try {
      const res = await this.f(`${this.cfg.baseUrl}/health`, { method: "GET" });
      if (!res.ok) return { ok: false };
      const body = (await res.json()) as { status?: string; uptime?: number };
      return { ok: body.status === "ok", uptime: body.uptime };
    } catch {
      return { ok: false };
    }
  }

  async query(opts: QmdQueryOptions): Promise<QmdSearchResult[]> {
    const res = await this.f(`${this.cfg.baseUrl}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(`qmd /query failed: HTTP ${res.status}`);
    const body = (await res.json()) as { results?: QmdSearchResult[] };
    return body.results ?? [];
  }
}
