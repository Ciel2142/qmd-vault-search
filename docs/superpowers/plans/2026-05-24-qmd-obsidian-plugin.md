# qmd × Obsidian Plugin — Implementation Plan (Phases 1–2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Obsidian plugin that searches the vault + selected qmd collections via a running qmd daemon (REST `/query`), keeps the vault index fresh on save, and renders a focus/ego relational graph of semantically-related documents.

**Architecture:** Plugin talks to a qmd HTTP daemon over plain REST for reads (`GET /health`, `POST /query`) and spawns the `qmd` CLI for index writes (`collection add`, `update`, `embed`). Phase 2 adds a minimal MCP client (`POST /mcp`) for `get`-by-docid (document preview) and `status` (collection listing). All non-trivial logic lives in obsidian-free modules so it is unit-testable with injected `fetch`/spawn; Obsidian view/tab classes are thin shells verified by manual smoke.

**Tech Stack:** TypeScript, esbuild (bundle to `main.js`), vitest (unit tests), Obsidian Plugin API (`isDesktopOnly: true`), d3-force + canvas (graph). No MCP SDK, no heavy deps.

**Source of truth for qmd behavior:** spec `docs/superpowers/specs/2026-05-24-qmd-obsidian-plugin-design.md` ("Planning findings"). qmd source at `/home/igi21/experiements/qmd` (`@tobilu/qmd` v2.5.2).

**Prerequisite for integration tests / manual smoke:** a qmd install on PATH and a running daemon (`qmd mcp --http --daemon`). Verify once before starting: `qmd --version` and `curl -s localhost:8181/health` → `{"status":"ok",...}`.

---

## File Structure

```
obsidian_qmd_plugin/
├── manifest.json              # Obsidian plugin manifest (isDesktopOnly: true)
├── versions.json              # minAppVersion map
├── package.json               # deps + scripts (build/test/typecheck)
├── tsconfig.json
├── esbuild.config.mjs         # bundle src/main.ts → main.js
├── vitest.config.ts           # aliases 'obsidian' → test mock
├── src/
│   ├── main.ts                # QmdPlugin: lifecycle, wiring (obsidian)
│   ├── settings.ts            # QmdSettings, DEFAULT_SETTINGS, baseUrl()  [pure]
│   ├── settings-tab.ts        # QmdSettingTab (obsidian)
│   ├── qmd-client.ts          # QmdClient: health/query [P1]; mcp* [P2]  [pure]
│   ├── daemon-controller.ts   # DaemonController: probe/start/ensure     [pure]
│   ├── cli.ts                 # makeRunQmd(): thin spawn wrapper          [io]
│   ├── indexer.ts             # Indexer: first-run add, debounced reindex [pure]
│   ├── open-target.ts         # resolveOpenTarget()                       [pure, P1]
│   ├── neighbors.ts           # buildExcerpt(), deriveNeighbors()         [pure, P2]
│   ├── graph-builder.ts       # buildEgoGraph()                           [pure, P2]
│   └── views/
│       ├── search-view.ts     # SearchView (ItemView)        [obsidian, P1]
│       ├── focus-graph-view.ts# FocusGraphView (ItemView)    [obsidian, P2]
│       └── doc-preview.ts     # DocPreviewModal              [obsidian, P2]
└── test/
    ├── __mocks__/obsidian.ts  # minimal Obsidian stub for vitest
    ├── qmd-client.test.ts
    ├── daemon-controller.test.ts
    ├── indexer.test.ts
    ├── open-target.test.ts
    ├── neighbors.test.ts
    ├── graph-builder.test.ts
    └── mcp-client.test.ts
```

**Boundary rule:** modules tagged `[pure]`/`[io]` must NOT `import ... from "obsidian"`. Tests import only those. View/tab files import obsidian and are not unit-tested.

---

# PHASE 1 — Search works

## Task 1: Project scaffold

**Files:**
- Create: `manifest.json`, `versions.json`, `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `vitest.config.ts`, `src/main.ts`, `test/__mocks__/obsidian.ts`, `test/scaffold.test.ts`

- [ ] **Step 1: Write `manifest.json`**

```json
{
  "id": "qmd-search",
  "name": "qmd Search",
  "version": "0.1.0",
  "minAppVersion": "1.4.0",
  "description": "Search your vault and qmd collections with hybrid (BM25 + vector) search, plus a relational focus graph.",
  "author": "igi2131",
  "isDesktopOnly": true
}
```

- [ ] **Step 2: Write `versions.json`**

```json
{ "0.1.0": "1.4.0" }
```

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "obsidian-qmd-plugin",
  "version": "0.1.0",
  "description": "qmd search engine + relational graph for Obsidian",
  "type": "module",
  "scripts": {
    "build": "tsc --noEmit && node esbuild.config.mjs production",
    "dev": "node esbuild.config.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "22.10.0",
    "builtin-modules": "5.0.0",
    "esbuild": "0.25.0",
    "obsidian": "1.7.2",
    "typescript": "5.9.3",
    "vitest": "3.2.4"
  },
  "dependencies": {
    "d3-force": "3.0.0",
    "d3-selection": "3.0.0",
    "d3-zoom": "3.0.0",
    "d3-drag": "3.0.0"
  }
}
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 5: Write `esbuild.config.mjs`**

```js
import esbuild from "esbuild";
import builtins from "builtin-modules";

const production = process.argv[2] === "production";

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2022",
  platform: "node",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  logLevel: "info",
});

if (production) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
```

- [ ] **Step 6: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
  resolve: { alias: { obsidian: resolve(__dirname, "test/__mocks__/obsidian.ts") } },
});
```

- [ ] **Step 7: Write `test/__mocks__/obsidian.ts` (minimal stub)**

```ts
// Minimal stand-ins so any accidental "obsidian" import resolves under vitest.
// Pure logic modules must NOT import obsidian; this exists as a safety net.
export class Plugin {}
export class PluginSettingTab {}
export class ItemView {}
export class Modal {}
export class Setting {}
export class Notice { constructor(_msg: string) {} }
export class TFile {}
export class WorkspaceLeaf {}
export const MarkdownRenderer = { render: async () => {} };
```

- [ ] **Step 8: Write `src/main.ts` (loadable skeleton)**

```ts
import { Plugin } from "obsidian";

export default class QmdPlugin extends Plugin {
  async onload(): Promise<void> {
    console.log("qmd-search: loaded");
  }
  async onunload(): Promise<void> {
    console.log("qmd-search: unloaded");
  }
}
```

- [ ] **Step 9: Write `test/scaffold.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 10: Install + verify build and tests**

Run: `npm install`
Then: `npm run build`
Expected: esbuild prints a success line and `main.js` exists (`ls main.js`).
Then: `npm test`
Expected: `Test Files  1 passed (1)` / `Tests  1 passed (1)`.

- [ ] **Step 11: Commit**

```bash
git add manifest.json versions.json package.json tsconfig.json esbuild.config.mjs vitest.config.ts src/main.ts test/
git commit -m "chore: scaffold Obsidian plugin (build + test harness)"
```

---

## Task 2: Settings (pure data)

**Files:**
- Create: `src/settings.ts`
- Test: `test/settings.test.ts`

- [ ] **Step 1: Write the failing test `test/settings.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, baseUrl } from "../src/settings";

describe("settings", () => {
  it("defaults vault collection to 'vault' and port 8181", () => {
    expect(DEFAULT_SETTINGS.vaultCollectionName).toBe("vault");
    expect(DEFAULT_SETTINGS.daemonPort).toBe(8181);
    expect(DEFAULT_SETTINGS.rerank).toBe(true);
  });
  it("builds base URL from port", () => {
    expect(baseUrl({ ...DEFAULT_SETTINGS, daemonPort: 9000 })).toBe("http://localhost:9000");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/settings.test.ts`
Expected: FAIL — cannot find module `../src/settings`.

- [ ] **Step 3: Write `src/settings.ts`**

```ts
export interface QmdSettings {
  binaryPath: string;             // command or absolute path to `qmd`
  daemonPort: number;             // HTTP daemon port
  vaultCollectionName: string;    // qmd collection name for this vault
  mask: string;                   // glob for vault indexing
  externalCollections: string[];  // extra collections to include in search/graph
  rerank: boolean;                // LLM rerank on explicit search
  debounceMs: number;             // on-save reindex debounce
  graphTopK: number;              // focus-graph neighbor count
  graphMinScore: number;          // focus-graph min similarity
  autoReindex: boolean;           // reindex vault on save
}

export const DEFAULT_SETTINGS: QmdSettings = {
  binaryPath: "qmd",
  daemonPort: 8181,
  vaultCollectionName: "vault",
  mask: "**/*.md",
  externalCollections: [],
  rerank: true,
  debounceMs: 1500,
  graphTopK: 12,
  graphMinScore: 0.3,
  autoReindex: true,
};

export function baseUrl(s: Pick<QmdSettings, "daemonPort">): string {
  return `http://localhost:${s.daemonPort}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/settings.test.ts`
Expected: `Tests  2 passed (2)`.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts test/settings.test.ts
git commit -m "feat: settings data model + defaults"
```

---

## Task 3: QmdClient — REST health + query

**Files:**
- Create: `src/qmd-client.ts`
- Test: `test/qmd-client.test.ts`

- [ ] **Step 1: Write the failing test `test/qmd-client.test.ts`**

```ts
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
    await expect(c.query({ searches: [{ type: "lex", query: "x" }] })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/qmd-client.test.ts`
Expected: FAIL — cannot find module `../src/qmd-client`.

- [ ] **Step 3: Write `src/qmd-client.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/qmd-client.test.ts`
Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Commit**

```bash
git add src/qmd-client.ts test/qmd-client.test.ts
git commit -m "feat: QmdClient REST health + query"
```

---

## Task 4: DaemonController — probe + start

**Files:**
- Create: `src/daemon-controller.ts`
- Test: `test/daemon-controller.test.ts`

- [ ] **Step 1: Write the failing test `test/daemon-controller.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { DaemonController } from "../src/daemon-controller";

function makeClient(ok: boolean) {
  return { health: vi.fn(async () => ({ ok })) };
}

describe("DaemonController", () => {
  it("isRunning reflects client health", async () => {
    const dc = new DaemonController({ client: makeClient(true), spawnFn: vi.fn(), binaryPath: "qmd", port: 8181 });
    expect(await dc.isRunning()).toBe(true);
  });

  it("start spawns detached daemon with correct args and unrefs", () => {
    const unref = vi.fn();
    const spawnFn = vi.fn(() => ({ unref }));
    const dc = new DaemonController({ client: makeClient(false), spawnFn, binaryPath: "/usr/bin/qmd", port: 9000 });
    dc.start();
    expect(spawnFn).toHaveBeenCalledWith(
      "/usr/bin/qmd",
      ["mcp", "--http", "--daemon", "--port", "9000"],
      expect.objectContaining({ detached: true, stdio: "ignore" }),
    );
    expect(unref).toHaveBeenCalled();
  });

  it("ensureRunning returns 'already' when healthy and does not spawn", async () => {
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }));
    const dc = new DaemonController({ client: makeClient(true), spawnFn, binaryPath: "qmd", port: 8181 });
    expect(await dc.ensureRunning()).toBe("already");
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daemon-controller.test.ts`
Expected: FAIL — cannot find module `../src/daemon-controller`.

- [ ] **Step 3: Write `src/daemon-controller.ts`**

```ts
export interface SpawnedChild {
  unref(): void;
}
export type SpawnFn = (cmd: string, args: string[], opts: Record<string, unknown>) => SpawnedChild;

export interface DaemonControllerDeps {
  client: { health(): Promise<{ ok: boolean }> };
  spawnFn: SpawnFn;
  binaryPath: string;
  port: number;
}

export class DaemonController {
  constructor(private deps: DaemonControllerDeps) {}

  async isRunning(): Promise<boolean> {
    return (await this.deps.client.health()).ok;
  }

  start(): void {
    const child = this.deps.spawnFn(
      this.deps.binaryPath,
      ["mcp", "--http", "--daemon", "--port", String(this.deps.port)],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
  }

  /** Probe once; if down, start and report. Caller re-probes before use. */
  async ensureRunning(): Promise<"already" | "started"> {
    if (await this.isRunning()) return "already";
    this.start();
    return "started";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daemon-controller.test.ts`
Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Commit**

```bash
git add src/daemon-controller.ts test/daemon-controller.test.ts
git commit -m "feat: DaemonController probe + start"
```

---

## Task 5: Indexer — first-run add + debounced reindex queue

**Files:**
- Create: `src/indexer.ts`, `src/cli.ts`
- Test: `test/indexer.test.ts`

- [ ] **Step 1: Write the failing test `test/indexer.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Indexer } from "../src/indexer";

type Call = string[];
function makeRunner() {
  const calls: Call[] = [];
  const run = vi.fn(async (args: string[]) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; });
  return { run, calls };
}
const base = { vaultPath: "/v", collectionName: "vault", mask: "**/*.md", debounceMs: 1000 };

describe("Indexer.ensureCollection", () => {
  it("adds + embeds vault when collection missing", async () => {
    const { run, calls } = makeRunner();
    const ix = new Indexer({ ...base, runQmd: run });
    await ix.ensureCollection(["docs", "beads"]);
    expect(calls[0]).toEqual(["collection", "add", "/v", "--name", "vault", "--mask", "**/*.md"]);
    expect(calls[1]).toEqual(["embed", "-c", "vault"]);
  });
  it("does nothing when collection already present", async () => {
    const { run, calls } = makeRunner();
    const ix = new Indexer({ ...base, runQmd: run });
    await ix.ensureCollection(["vault", "docs"]);
    expect(calls).toEqual([]);
  });
});

describe("Indexer.notifyChange debounce + serialize", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces multiple changes into one reindex (update + embed)", async () => {
    const { run, calls } = makeRunner();
    const ix = new Indexer({ ...base, runQmd: run });
    ix.notifyChange(); ix.notifyChange(); ix.notifyChange();
    expect(calls).toEqual([]);                 // nothing before debounce elapses
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([["update"], ["embed", "-c", "vault"]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/indexer.test.ts`
Expected: FAIL — cannot find module `../src/indexer`.

- [ ] **Step 3: Write `src/indexer.ts`**

```ts
export type RunQmd = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface IndexerDeps {
  runQmd: RunQmd;
  vaultPath: string;       // absolute vault root
  collectionName: string;  // "vault"
  mask: string;            // "**/*.md"
  debounceMs: number;
}

export class Indexer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private dirty = false;

  constructor(private deps: IndexerDeps) {}

  /** Register + index the vault as a qmd collection if not already present. */
  async ensureCollection(existingCollections: string[]): Promise<void> {
    if (existingCollections.includes(this.deps.collectionName)) return;
    await this.deps.runQmd(["collection", "add", this.deps.vaultPath, "--name", this.deps.collectionName, "--mask", this.deps.mask]);
    await this.deps.runQmd(["embed", "-c", this.deps.collectionName]);
  }

  /** Debounced trigger; call on every vault modify/create/delete/rename. */
  notifyChange(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.reindex(); }, this.deps.debounceMs);
  }

  /** Serialized reindex: no overlap; a change during a run schedules one re-run. */
  private async reindex(): Promise<void> {
    if (this.running) { this.dirty = true; return; }
    this.running = true;
    try {
      await this.deps.runQmd(["update"]);
      await this.deps.runQmd(["embed", "-c", this.deps.collectionName]);
    } finally {
      this.running = false;
      if (this.dirty) { this.dirty = false; await this.reindex(); }
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
```

- [ ] **Step 4: Write `src/cli.ts` (thin spawn wrapper — not unit-tested)**

```ts
import { spawn } from "node:child_process";
import type { RunQmd } from "./indexer";

/** Build a serialized-by-caller qmd CLI runner. Captures stdout/stderr, never throws. */
export function makeRunQmd(binaryPath: string): RunQmd {
  return (args) =>
    new Promise((resolve) => {
      const child = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => resolve({ code: -1, stdout, stderr: String(e) }));
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/indexer.test.ts`
Expected: `Tests  3 passed (3)`.

- [ ] **Step 6: Commit**

```bash
git add src/indexer.ts src/cli.ts test/indexer.test.ts
git commit -m "feat: Indexer first-run add + debounced serialized reindex"
```

---

## Task 6: open-target + SearchView

**Files:**
- Create: `src/open-target.ts`, `src/views/search-view.ts`
- Test: `test/open-target.test.ts`

- [ ] **Step 1: Write the failing test `test/open-target.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveOpenTarget } from "../src/open-target";

describe("resolveOpenTarget", () => {
  const isVault = (p: string) => p.startsWith("notes/");
  it("routes vault-resident paths to 'vault'", () => {
    expect(resolveOpenTarget("notes/x.md", "#a1", isVault)).toEqual({ kind: "vault", path: "notes/x.md" });
  });
  it("routes non-vault paths to 'external' with docid", () => {
    expect(resolveOpenTarget("docs/y.md", "#b2", isVault)).toEqual({ kind: "external", file: "docs/y.md", docid: "#b2" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/open-target.test.ts`
Expected: FAIL — cannot find module `../src/open-target`.

- [ ] **Step 3: Write `src/open-target.ts`**

```ts
export type OpenTarget =
  | { kind: "vault"; path: string }
  | { kind: "external"; file: string; docid: string };

/** A result is openable in Obsidian iff its collection-relative path exists in the vault. */
export function resolveOpenTarget(
  file: string,
  docid: string,
  isVaultFile: (path: string) => boolean,
): OpenTarget {
  return isVaultFile(file) ? { kind: "vault", path: file } : { kind: "external", file, docid };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/open-target.test.ts`
Expected: `Tests  2 passed (2)`.

- [ ] **Step 5: Write `src/views/search-view.ts` (ItemView shell — manual smoke)**

```ts
import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type { QmdClient, QmdSearchResult } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { resolveOpenTarget } from "../open-target";

export const VIEW_TYPE_QMD_SEARCH = "qmd-search-view";

export class SearchView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private client: QmdClient,
    private settings: QmdSettings,
  ) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_QMD_SEARCH; }
  getDisplayText(): string { return "qmd Search"; }
  getIcon(): string { return "search"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("qmd-search-view");

    const input = root.createEl("input", { type: "text", placeholder: "Search vault + collections…" });
    input.addClass("qmd-search-input");

    const chips = root.createDiv({ cls: "qmd-chips" });
    const selected = new Set<string>([this.settings.vaultCollectionName]);
    const renderChips = () => {
      chips.empty();
      const all = [this.settings.vaultCollectionName, ...this.settings.externalCollections];
      for (const name of all) {
        const chip = chips.createSpan({ cls: "qmd-chip", text: name });
        if (selected.has(name)) chip.addClass("is-active");
        if (name === this.settings.vaultCollectionName) { chip.addClass("is-locked"); }
        else chip.onclick = () => { selected.has(name) ? selected.delete(name) : selected.add(name); renderChips(); };
      }
    };
    renderChips();

    const list = root.createDiv({ cls: "qmd-results" });

    const runSearch = async () => {
      const q = input.value.trim();
      if (!q) return;
      list.empty();
      list.createDiv({ cls: "qmd-status", text: "Searching…" });
      try {
        const results = await this.client.query({
          searches: [{ type: "lex", query: q }, { type: "vec", query: q }],
          collections: [...selected],
          rerank: this.settings.rerank,
        });
        this.renderResults(list, results);
      } catch (e) {
        list.empty();
        list.createDiv({ cls: "qmd-status", text: `Error: ${(e as Error).message}` });
      }
    };
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void runSearch(); });
  }

  private renderResults(list: HTMLElement, results: QmdSearchResult[]): void {
    list.empty();
    if (results.length === 0) { list.createDiv({ cls: "qmd-status", text: "No results." }); return; }
    for (const r of results) {
      const row = list.createDiv({ cls: "qmd-result" });
      const target = resolveOpenTarget(r.file, r.docid, (p) => this.app.vault.getAbstractFileByPath(p) instanceof TFile);
      row.createDiv({ cls: "qmd-result-title", text: r.title || r.file });
      const meta = row.createDiv({ cls: "qmd-result-meta" });
      meta.createSpan({ cls: `qmd-badge ${target.kind}`, text: target.kind === "vault" ? "vault" : "external" });
      meta.createSpan({ cls: "qmd-score", text: `${Math.round(r.score * 100)}%` });
      row.createDiv({ cls: "qmd-snippet", text: r.snippet });
      row.onclick = () => this.openTarget(r);
    }
  }

  private async openTarget(r: QmdSearchResult): Promise<void> {
    const target = resolveOpenTarget(r.file, r.docid, (p) => this.app.vault.getAbstractFileByPath(p) instanceof TFile);
    if (target.kind === "vault") {
      await this.app.workspace.openLinkText(target.path, "", false);
    } else {
      // Phase 1: no in-app preview yet. Surface the path; full preview lands in Phase 2.
      await navigator.clipboard.writeText(target.file);
      new Notice(`External doc (${target.file}) — path copied. In-app preview arrives in Phase 2.`);
    }
  }

  async onClose(): Promise<void> { this.contentEl.empty(); }
}
```

- [ ] **Step 6: Verify typecheck + build**

Run: `npm run build`
Expected: `tsc --noEmit` passes (no type errors) and esbuild rewrites `main.js`. (Wiring into the plugin happens in Task 7; this confirms the view compiles.)

- [ ] **Step 7: Commit**

```bash
git add src/open-target.ts src/views/search-view.ts test/open-target.test.ts
git commit -m "feat: SearchView + vault/external open routing"
```

---

## Task 7: Wire Phase 1 into the plugin

**Files:**
- Modify: `src/main.ts`
- Create: `src/settings-tab.ts`, `styles.css`

- [ ] **Step 1: Write `src/settings-tab.ts`**

```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import type QmdPlugin from "./main";

export class QmdSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: QmdPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("qmd binary path").setDesc("Command or absolute path to the qmd CLI.")
      .addText((t) => t.setValue(this.plugin.settings.binaryPath).onChange(async (v) => { this.plugin.settings.binaryPath = v || "qmd"; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Daemon port").setDesc("Port of the qmd HTTP daemon.")
      .addText((t) => t.setValue(String(this.plugin.settings.daemonPort)).onChange(async (v) => { const n = parseInt(v, 10); if (!Number.isNaN(n)) { this.plugin.settings.daemonPort = n; await this.plugin.saveSettings(); } }));

    new Setting(containerEl).setName("Vault collection name").setDesc("qmd collection name for this vault.")
      .addText((t) => t.setValue(this.plugin.settings.vaultCollectionName).onChange(async (v) => { this.plugin.settings.vaultCollectionName = v || "vault"; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("External collections").setDesc("Comma-separated qmd collection names to include (Phase 2 replaces with a picker).")
      .addText((t) => t.setValue(this.plugin.settings.externalCollections.join(", ")).onChange(async (v) => { this.plugin.settings.externalCollections = v.split(",").map((s) => s.trim()).filter(Boolean); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Rerank").setDesc("LLM rerank on explicit search (slower, better quality).")
      .addToggle((t) => t.setValue(this.plugin.settings.rerank).onChange(async (v) => { this.plugin.settings.rerank = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Reindex on save").setDesc("Incrementally reindex the vault after edits.")
      .addToggle((t) => t.setValue(this.plugin.settings.autoReindex).onChange(async (v) => { this.plugin.settings.autoReindex = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Reindex debounce (ms)").setDesc("Idle delay before reindexing after edits.")
      .addText((t) => t.setValue(String(this.plugin.settings.debounceMs)).onChange(async (v) => { const n = parseInt(v, 10); if (!Number.isNaN(n)) { this.plugin.settings.debounceMs = n; await this.plugin.saveSettings(); } }));
  }
}
```

- [ ] **Step 2: Write `styles.css`**

```css
.qmd-search-view .qmd-search-input { width: 100%; margin-bottom: 8px; }
.qmd-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.qmd-chip { font-size: 11px; padding: 1px 8px; border-radius: 10px; border: 1px solid var(--background-modifier-border); cursor: pointer; opacity: 0.5; }
.qmd-chip.is-active { opacity: 1; border-color: var(--interactive-accent); }
.qmd-chip.is-locked { cursor: default; }
.qmd-result { padding: 6px 4px; border-bottom: 1px solid var(--background-modifier-border); cursor: pointer; }
.qmd-result:hover { background: var(--background-modifier-hover); }
.qmd-result-title { font-weight: 600; }
.qmd-result-meta { display: flex; gap: 8px; font-size: 11px; opacity: 0.7; }
.qmd-badge.vault { color: var(--interactive-accent); }
.qmd-badge.external { color: var(--text-accent); }
.qmd-snippet { font-size: 12px; opacity: 0.8; white-space: pre-wrap; }
.qmd-status { padding: 8px 4px; opacity: 0.7; }
```

- [ ] **Step 3: Rewrite `src/main.ts` with full Phase 1 wiring**

```ts
import { Plugin, Notice, FileSystemAdapter, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, QmdSettings, baseUrl } from "./settings";
import { QmdSettingTab } from "./settings-tab";
import { QmdClient } from "./qmd-client";
import { DaemonController, SpawnFn } from "./daemon-controller";
import { Indexer } from "./indexer";
import { makeRunQmd } from "./cli";
import { SearchView, VIEW_TYPE_QMD_SEARCH } from "./views/search-view";
import { spawn } from "node:child_process";

export default class QmdPlugin extends Plugin {
  settings!: QmdSettings;
  client!: QmdClient;
  daemon!: DaemonController;
  indexer!: Indexer;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.client = new QmdClient({ baseUrl: baseUrl(this.settings) });

    const spawnFn: SpawnFn = (cmd, args, opts) => spawn(cmd, args, opts as object);
    this.daemon = new DaemonController({ client: this.client, spawnFn, binaryPath: this.settings.binaryPath, port: this.settings.daemonPort });

    const vaultPath = this.app.vault.adapter instanceof FileSystemAdapter ? this.app.vault.adapter.getBasePath() : "";
    this.indexer = new Indexer({ runQmd: makeRunQmd(this.settings.binaryPath), vaultPath, collectionName: this.settings.vaultCollectionName, mask: this.settings.mask, debounceMs: this.settings.debounceMs });

    this.registerView(VIEW_TYPE_QMD_SEARCH, (leaf: WorkspaceLeaf) => new SearchView(leaf, this.client, this.settings));
    this.addRibbonIcon("search", "qmd Search", () => this.activateSearchView());
    this.addCommand({ id: "open-qmd-search", name: "Open qmd search panel", callback: () => this.activateSearchView() });
    this.addSettingTab(new QmdSettingTab(this.app, this));

    // Daemon: probe, offer to start.
    const status = await this.daemon.ensureRunning();
    if (status === "started") new Notice("qmd daemon not running — starting it. Give it a few seconds to load models.");

    // Vault freshness: register on first run, reindex on save.
    if (this.settings.autoReindex && vaultPath) {
      void this.bootstrapIndexing();
      this.registerEvent(this.app.vault.on("modify", () => this.indexer.notifyChange()));
      this.registerEvent(this.app.vault.on("create", () => this.indexer.notifyChange()));
      this.registerEvent(this.app.vault.on("delete", () => this.indexer.notifyChange()));
      this.registerEvent(this.app.vault.on("rename", () => this.indexer.notifyChange()));
    }
  }

  private async bootstrapIndexing(): Promise<void> {
    // Phase 1 cannot list collections programmatically (status is MCP-only, added in Phase 2).
    // ensureCollection is idempotent: `qmd collection add` errors harmlessly if the
    // collection already exists, so pass [] and let the CLI no-op on re-add.
    try { await this.indexer.ensureCollection([]); }
    catch (e) { console.warn("qmd-search: vault collection bootstrap:", e); }
  }

  private async activateSearchView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_QMD_SEARCH)[0];
    if (!leaf) { leaf = workspace.getRightLeaf(false)!; await leaf.setViewState({ type: VIEW_TYPE_QMD_SEARCH, active: true }); }
    workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.client = new QmdClient({ baseUrl: baseUrl(this.settings) });
  }
  async onunload(): Promise<void> { this.indexer?.dispose(); }
}
```

> Note on `ensureCollection([])`: in Phase 1 we pass `[]` so the guard never short-circuits; the underlying `qmd collection add` prints "already exists" and exits non-zero on subsequent runs, which `bootstrapIndexing` swallows. Phase 2 (Task 9) replaces this with a real `status()` collection list so the add only runs when genuinely missing.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: typecheck passes; `main.js` written.

- [ ] **Step 5: Manual smoke test**

1. Symlink/copy `main.js`, `manifest.json`, `styles.css` into a scratch vault: `<scratch-vault>/.obsidian/plugins/qmd-search/`.
2. Ensure a qmd daemon is reachable (`curl -s localhost:8181/health`).
3. Enable the plugin in Obsidian (Settings → Community plugins). Set the vault collection name and any external collections.
4. Click the search ribbon icon → right panel opens. Type a query, press Enter → results render. Click a vault result → note opens. Click an external result → Notice + path copied.

Verify (record evidence in the commit/PR): panel opens, search returns results, vault note opens.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/settings-tab.ts styles.css
git commit -m "feat: wire Phase 1 — search panel, daemon probe/start, on-save reindex"
```

**END OF PHASE 1 — semantic search over vault + selected collections, fresh on save.**

---

# PHASE 2 — Focus graph + document preview

## Task 8: QmdClient MCP path — status + get

**Files:**
- Modify: `src/qmd-client.ts`
- Test: `test/mcp-client.test.ts`

**Protocol (from `src/mcp/server.ts`):** `POST /mcp` is session-based with `enableJsonResponse: true` (JSON, not SSE). Sequence: (1) `initialize` → response carries an `mcp-session-id` header; (2) `notifications/initialized` (with that header); (3) `tools/call`. `get` returns `result.content[0].resource.text`; `status` returns `result.structuredContent`.

- [ ] **Step 1: Write the failing test `test/mcp-client.test.ts`**

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp-client.test.ts`
Expected: FAIL — `c.mcpGet is not a function`.

- [ ] **Step 3: Extend `src/qmd-client.ts` (append types + methods)**

```ts
// --- append to src/qmd-client.ts ---

export interface QmdCollection {
  name: string;
  path: string | null;
  pattern: string | null;
  documents: number;
  lastUpdated: string;
}
export interface QmdDocument { path: string; title: string; text: string; }

// Add inside the QmdClient class:

  private sessionId: string | null = null;
  private nextId = 1;

  private async mcpInit(): Promise<void> {
    if (this.sessionId) return;
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
    const result = await this.mcpCall<{ content: { type: string; resource?: { name: string; title?: string; text: string } }[] }>("get", { file: fileOrDocid });
    const res = result.content.find((c) => c.type === "resource")?.resource;
    if (!res) throw new Error(`qmd get: no document for ${fileOrDocid}`);
    return { path: res.name, title: res.title ?? res.name, text: res.text };
  }

  async mcpStatus(): Promise<QmdCollection[]> {
    const result = await this.mcpCall<{ structuredContent: { collections: QmdCollection[] } }>("status", {});
    return result.structuredContent.collections;
  }

  /** Reset the cached MCP session (call after settings change). */
  resetSession(): void { this.sessionId = null; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mcp-client.test.ts`
Expected: `Tests  2 passed (2)`.

- [ ] **Step 5: Integration check against a real daemon (throwaway collection)**

```bash
# Create an isolated throwaway collection so we never touch the live index.
TMP=$(mktemp -d)/test_qmdobsidian_$(date +%s); mkdir -p "$TMP"; echo "# Hello\nalpha bravo" > "$TMP/a.md"
qmd collection add "$TMP" --name test_qmdobsidian --mask "**/*.md"
qmd embed -c test_qmdobsidian
# Confirm REST query works:
curl -s -X POST localhost:8181/query -H 'content-type: application/json' \
  -d '{"searches":[{"type":"lex","query":"alpha"}],"collections":["test_qmdobsidian"]}' | head -c 400
# Cleanup:
qmd collection remove test_qmdobsidian
```
Expected: JSON with a `results` array containing `a.md`. (This validates the exact REST contract end-to-end.)

- [ ] **Step 6: Commit**

```bash
git add src/qmd-client.ts test/mcp-client.test.ts
git commit -m "feat: QmdClient MCP path — session handshake, get, status"
```

---

## Task 9: Collection picker in settings (uses status())

**Files:**
- Modify: `src/settings-tab.ts`, `src/main.ts`

- [ ] **Step 1: Modify `bootstrapIndexing()` in `src/main.ts` to use the real collection list**

Replace the Phase-1 `ensureCollection([])` body:

```ts
  private async bootstrapIndexing(): Promise<void> {
    try {
      const cols = await this.client.mcpStatus().then((c) => c.map((x) => x.name)).catch(() => [] as string[]);
      await this.indexer.ensureCollection(cols);
    } catch (e) {
      console.warn("qmd-search: vault collection bootstrap:", e);
    }
  }
```

- [ ] **Step 2: Add a "detect collections" control to `src/settings-tab.ts`**

Append inside `display()`:

```ts
    new Setting(containerEl).setName("Detect collections").setDesc("List collections from the running daemon and pick which to include.")
      .addButton((b) => b.setButtonText("Detect").onClick(async () => {
        try {
          const cols = await this.plugin.client.mcpStatus();
          const names = cols.map((c) => c.name).filter((n) => n !== this.plugin.settings.vaultCollectionName);
          this.plugin.settings.externalCollections = this.plugin.settings.externalCollections.filter((n) => names.includes(n));
          // Render checkboxes for each available external collection:
          const box = containerEl.createDiv({ cls: "qmd-collection-box" });
          box.empty();
          for (const name of names) {
            new Setting(box).setName(name)
              .addToggle((t) => t.setValue(this.plugin.settings.externalCollections.includes(name)).onChange(async (v) => {
                const set = new Set(this.plugin.settings.externalCollections);
                v ? set.add(name) : set.delete(name);
                this.plugin.settings.externalCollections = [...set];
                await this.plugin.saveSettings();
              }));
          }
        } catch (e) {
          new Notice(`Could not reach qmd daemon: ${(e as Error).message}`);
        }
      }));
```

Add `import { Notice } from "obsidian";` to the settings-tab imports if not present.

- [ ] **Step 3: Build + manual smoke**

Run: `npm run build`
Expected: typecheck passes.
Manual: in settings, click "Detect" with the daemon running → external collections appear as toggles; toggling persists.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/settings-tab.ts
git commit -m "feat: collection detection via status() + settings picker"
```

---

## Task 10: neighbors — excerpt + derivation

**Files:**
- Create: `src/neighbors.ts`
- Test: `test/neighbors.test.ts`

- [ ] **Step 1: Write the failing test `test/neighbors.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildExcerpt, deriveNeighbors } from "../src/neighbors";

describe("buildExcerpt", () => {
  it("strips YAML frontmatter and truncates", () => {
    const md = "---\ntags: a\n---\n# Title\n" + "x".repeat(5000);
    const ex = buildExcerpt(md, 100);
    expect(ex.startsWith("# Title")).toBe(true);
    expect(ex.length).toBeLessThanOrEqual(100);
  });
});

describe("deriveNeighbors", () => {
  it("queries by excerpt and excludes self by file", async () => {
    const client = { query: vi.fn(async () => [
      { docid: "#self", file: "notes/me.md", title: "Me", score: 1, context: null, line: 1, snippet: "" },
      { docid: "#a", file: "docs/a.md", title: "A", score: 0.8, context: null, line: 1, snippet: "" },
    ]) };
    const out = await deriveNeighbors(client as never, { content: "hello body", collections: ["vault", "docs"], selfFile: "notes/me.md", limit: 5, minScore: 0.3 });
    expect(out.map((r) => r.file)).toEqual(["docs/a.md"]);
    expect(client.query).toHaveBeenCalledWith(expect.objectContaining({
      searches: [{ type: "vec", query: "hello body" }], collections: ["vault", "docs"], rerank: false, minScore: 0.3, limit: 6,
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/neighbors.test.ts`
Expected: FAIL — cannot find module `../src/neighbors`.

- [ ] **Step 3: Write `src/neighbors.ts`**

```ts
import type { QmdClient, QmdSearchResult } from "./qmd-client";

/** Drop YAML frontmatter, collapse whitespace, truncate to maxChars. */
export function buildExcerpt(content: string, maxChars = 1500): string {
  let body = content;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(end + 4);
  }
  body = body.replace(/\s+/g, " ").trim();
  return body.slice(0, maxChars);
}

export interface DeriveNeighborsOptions {
  content: string;
  collections: string[];
  selfFile?: string;
  limit: number;
  minScore: number;
}

/** Doc→doc neighbors via a vec query built from the source note's excerpt. */
export async function deriveNeighbors(client: QmdClient, opts: DeriveNeighborsOptions): Promise<QmdSearchResult[]> {
  const excerpt = buildExcerpt(opts.content);
  const results = await client.query({
    searches: [{ type: "vec", query: excerpt }],
    collections: opts.collections,
    rerank: false,
    minScore: opts.minScore,
    limit: opts.limit + 1, // headroom to drop self
  });
  return results.filter((r) => r.file !== opts.selfFile).slice(0, opts.limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/neighbors.test.ts`
Expected: `Tests  2 passed (2)`.

- [ ] **Step 5: Commit**

```bash
git add src/neighbors.ts test/neighbors.test.ts
git commit -m "feat: neighbor derivation via vec query from note excerpt"
```

---

## Task 11: graph-builder + FocusGraphView

**Files:**
- Create: `src/graph-builder.ts`, `src/views/focus-graph-view.ts`
- Test: `test/graph-builder.test.ts`

- [ ] **Step 1: Write the failing test `test/graph-builder.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildEgoGraph } from "../src/graph-builder";

describe("buildEgoGraph", () => {
  it("makes a center node + one edge per neighbor, tagged by collection kind", () => {
    const neighbors = [
      { docid: "#a", file: "notes/a.md", title: "A", score: 0.9, context: null, line: 1, snippet: "" },
      { docid: "#b", file: "docs/b.md", title: "B", score: 0.7, context: null, line: 1, snippet: "" },
    ];
    const g = buildEgoGraph({ id: "center", label: "Me", file: "notes/me.md" }, neighbors, (p) => p.startsWith("notes/"));
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes[0]).toMatchObject({ id: "center", collectionKind: "vault" });
    expect(g.nodes.find((n) => n.id === "#b")).toMatchObject({ collectionKind: "external" });
    expect(g.edges).toEqual([
      { source: "center", target: "#a", weight: 0.9 },
      { source: "center", target: "#b", weight: 0.7 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph-builder.test.ts`
Expected: FAIL — cannot find module `../src/graph-builder`.

- [ ] **Step 3: Write `src/graph-builder.ts`**

```ts
import type { QmdSearchResult } from "./qmd-client";

export type CollectionKind = "vault" | "external";
export interface GraphNode { id: string; label: string; file: string; collectionKind: CollectionKind; score: number; }
export interface GraphEdge { source: string; target: string; weight: number; }
export interface EgoGraph { nodes: GraphNode[]; edges: GraphEdge[]; }

export interface CenterSpec { id: string; label: string; file: string; }

export function buildEgoGraph(
  center: CenterSpec,
  neighbors: QmdSearchResult[],
  isVaultFile: (path: string) => boolean,
): EgoGraph {
  const nodes: GraphNode[] = [
    { id: center.id, label: center.label, file: center.file, collectionKind: isVaultFile(center.file) ? "vault" : "external", score: 1 },
  ];
  const edges: GraphEdge[] = [];
  for (const n of neighbors) {
    nodes.push({ id: n.docid, label: n.title || n.file, file: n.file, collectionKind: isVaultFile(n.file) ? "vault" : "external", score: n.score });
    edges.push({ source: center.id, target: n.docid, weight: n.score });
  }
  return { nodes, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph-builder.test.ts`
Expected: `Tests  1 passed (1)`.

- [ ] **Step 5: Write `src/views/focus-graph-view.ts` (d3-force canvas — manual smoke)**

```ts
import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { forceSimulation, forceLink, forceManyBody, forceCenter, type Simulation } from "d3-force";
import type { QmdClient } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { deriveNeighbors } from "../neighbors";
import { buildEgoGraph, type EgoGraph, type GraphNode } from "../graph-builder";

export const VIEW_TYPE_QMD_GRAPH = "qmd-focus-graph";

type SimNode = GraphNode & { x?: number; y?: number; fx?: number | null; fy?: number | null };

export class FocusGraphView extends ItemView {
  private canvas!: HTMLCanvasElement;
  private sim: Simulation<SimNode, undefined> | null = null;

  constructor(leaf: WorkspaceLeaf, private client: QmdClient, private settings: QmdSettings) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_QMD_GRAPH; }
  getDisplayText(): string { return "qmd Focus Graph"; }
  getIcon(): string { return "git-fork"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.canvas = this.contentEl.createEl("canvas");
    this.canvas.width = this.contentEl.clientWidth || 600;
    this.canvas.height = this.contentEl.clientHeight || 400;
    const active = this.app.workspace.getActiveFile();
    if (active) await this.centerOn(active.path, active.basename);
  }

  /** Build the ego graph for a vault path and render it. */
  async centerOn(path: string, label: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    const content = file instanceof TFile ? await this.app.vault.cachedRead(file) : "";
    const neighbors = await deriveNeighbors(this.client, {
      content,
      collections: [this.settings.vaultCollectionName, ...this.settings.externalCollections],
      selfFile: path,
      limit: this.settings.graphTopK,
      minScore: this.settings.graphMinScore,
    });
    const graph = buildEgoGraph({ id: "center", label, file: path }, neighbors, (p) => this.app.vault.getAbstractFileByPath(p) instanceof TFile);
    this.render(graph);
  }

  private render(graph: EgoGraph): void {
    const ctx = this.canvas.getContext("2d")!;
    const w = this.canvas.width, h = this.canvas.height;
    const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
    const links = graph.edges.map((e) => ({ ...e }));
    this.sim?.stop();
    this.sim = forceSimulation(nodes)
      .force("link", forceLink(links).id((d: { id: string }) => d.id).distance(90))
      .force("charge", forceManyBody().strength(-220))
      .force("center", forceCenter(w / 2, h / 2))
      .on("tick", () => {
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = "rgba(168,130,255,0.5)";
        for (const l of links as { source: SimNode; target: SimNode; weight: number }[]) {
          ctx.lineWidth = 0.5 + l.weight * 2;
          ctx.beginPath(); ctx.moveTo(l.source.x!, l.source.y!); ctx.lineTo(l.target.x!, l.target.y!); ctx.stroke();
        }
        for (const n of nodes) {
          ctx.fillStyle = n.collectionKind === "vault" ? "#a882ff" : "#4fd1c5";
          ctx.beginPath(); ctx.arc(n.x!, n.y!, n.id === "center" ? 9 : 6, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "var(--text-normal)"; ctx.font = "10px sans-serif";
          ctx.fillText(n.label.slice(0, 24), n.x! + 8, n.y! + 3);
        }
      });

    // Click → re-center on the clicked node (vault opens; external re-centers via its file path).
    this.canvas.onclick = (ev) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      const hit = nodes.find((n) => Math.hypot((n.x ?? 0) - mx, (n.y ?? 0) - my) < 10);
      if (hit && hit.id !== "center") void this.centerOn(hit.file, hit.label);
    };
  }

  async onClose(): Promise<void> { this.sim?.stop(); this.contentEl.empty(); }
}
```

- [ ] **Step 6: Build + manual smoke**

Run: `npm run build`
Expected: typecheck passes; `main.js` written. (Wired into commands in Task 13.)

- [ ] **Step 7: Commit**

```bash
git add src/graph-builder.ts src/views/focus-graph-view.ts test/graph-builder.test.ts
git commit -m "feat: ego graph builder + d3-force FocusGraphView"
```

---

## Task 12: DocPreviewModal (external doc render)

**Files:**
- Create: `src/views/doc-preview.ts`

- [ ] **Step 1: Write `src/views/doc-preview.ts`**

```ts
import { App, Modal, MarkdownRenderer, Notice, Component } from "obsidian";
import type { QmdClient } from "../qmd-client";

/** Read-only preview of an external (non-vault) document fetched by docid via MCP get. */
export class DocPreviewModal extends Modal {
  private renderComponent = new Component();
  constructor(app: App, private client: QmdClient, private docid: string) { super(app); }

  async onOpen(): Promise<void> {
    this.titleEl.setText("Loading…");
    const body = this.contentEl.createDiv({ cls: "qmd-doc-preview markdown-rendered" });
    try {
      const doc = await this.client.mcpGet(this.docid);
      this.titleEl.setText(doc.title);
      await MarkdownRenderer.render(this.app, doc.text, body, doc.path, this.renderComponent);
    } catch (e) {
      new Notice(`Preview failed: ${(e as Error).message}`);
      this.close();
    }
  }
  onClose(): void { this.renderComponent.unload(); this.contentEl.empty(); }
}
```

- [ ] **Step 2: Build (typecheck)**

Run: `npm run build`
Expected: typecheck passes.

- [ ] **Step 3: Commit**

```bash
git add src/views/doc-preview.ts
git commit -m "feat: DocPreviewModal — render external docs via MCP get"
```

---

## Task 13: Wire graph + preview into the plugin

**Files:**
- Modify: `src/main.ts`, `src/views/search-view.ts`

- [ ] **Step 1: Register the graph view + command, and upgrade external-open in `src/main.ts`**

Add imports:

```ts
import { FocusGraphView, VIEW_TYPE_QMD_GRAPH } from "./views/focus-graph-view";
```

In `onload()`, after registering the search view:

```ts
    this.registerView(VIEW_TYPE_QMD_GRAPH, (leaf: WorkspaceLeaf) => new FocusGraphView(leaf, this.client, this.settings));
    this.addCommand({ id: "open-qmd-focus-graph", name: "Open focus graph for current note", callback: () => this.activateGraphView() });
```

Add the activation method:

```ts
  private async activateGraphView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_QMD_GRAPH)[0];
    if (!leaf) { leaf = workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW_TYPE_QMD_GRAPH, active: true }); }
    workspace.revealLeaf(leaf);
  }
```

In `saveSettings()`, reset the MCP session so a port change reconnects cleanly:

```ts
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.client = new QmdClient({ baseUrl: baseUrl(this.settings) });
  }
```
(The new `QmdClient` already starts with a fresh session — no extra call needed.)

- [ ] **Step 2: Upgrade external-open in `src/views/search-view.ts`**

Replace the `else` branch of `openTarget()` (the Phase-1 clipboard Notice) with an in-app preview:

```ts
    } else {
      const { DocPreviewModal } = await import("../views/doc-preview");
      new DocPreviewModal(this.app, this.client, target.docid).open();
    }
```

Add a "focus graph" affordance: in `renderResults`, after creating `row`, add a button:

```ts
      const graphBtn = meta.createSpan({ cls: "qmd-graph-link", text: "graph" });
      graphBtn.onclick = (ev) => {
        ev.stopPropagation();
        // Center the graph on this hit (vault note path, or external file path).
        this.app.workspace.trigger("qmd:center-graph", r.file, r.title || r.file);
      };
```

And in `main.ts` `onload()`, bridge that event to the graph view:

```ts
    this.registerEvent(this.app.workspace.on("qmd:center-graph" as never, async (file: string, label: string) => {
      await this.activateGraphView();
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_QMD_GRAPH)[0];
      const view = leaf?.view as FocusGraphView | undefined;
      await view?.centerOn(file, label);
    }));
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: typecheck passes; `main.js` written.

- [ ] **Step 4: Full manual smoke test**

1. Rebuild into the scratch vault plugin dir; reload Obsidian.
2. Open a note → run command "Open focus graph for current note" → canvas shows a center node ringed by similar docs (purple = vault, teal = external). Click a neighbor → graph re-centers on it.
3. In the search panel, run a query → click "graph" on a result → graph centers on that result.
4. Click an external result row → DocPreviewModal opens and renders the external doc's markdown.

Record evidence (screenshot or description) of: graph renders, re-centers on click, external preview renders.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/views/search-view.ts
git commit -m "feat: wire focus graph + external doc preview"
```

**END OF PHASE 2 — focus graph + external-doc preview.**

---

## Final verification

- [ ] Run the whole suite: `npm test` → all test files pass.
- [ ] Typecheck + production build: `npm run build` → no errors, `main.js` emitted.
- [ ] Manual end-to-end in the scratch vault: daemon auto-start, search, on-save reindex (edit a note, search again, see updated content), focus graph, external preview.

## Deferred (Phase 3 — not in this plan)

**From the original concept set:** modal command-palette search; global-similarity-map expansion; augmented `[[link]]`+semantic overlay; auto "related to current note" list; BM25-only as-you-type preview; a `qmd`-side per-collection/per-file reindex to replace the whole-corpus `qmd update` on save.

**Minor UX refinements deferred from the spec's Phase 1–2 UX (kept out to keep the core plan focused; add as small follow-ups):**
- Search results: hover preview tooltip; "open in new pane"; "insert `[[link]]`" action for vault hits.
- Focus graph: hover tooltip (title + snippet); Cmd/double-click to open a node (currently single-click re-centers only).
- Reconnect on settings change: re-create `DaemonController` in `saveSettings()` so a daemon-port change is picked up without a plugin reload (currently the controller keeps its original `QmdClient` reference; port changes effectively need a reload).
