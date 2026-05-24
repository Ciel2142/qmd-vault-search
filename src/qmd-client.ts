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

export interface QmdClientConfig {
  baseUrl: string;
  fetchFn?: typeof fetch;
}

export class QmdClient {
  constructor(private cfg: QmdClientConfig) {}
  private get f(): typeof fetch {
    return this.cfg.fetchFn ?? fetch;
  }

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
