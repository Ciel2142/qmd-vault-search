# qmd × Obsidian Plugin — Phase 2: Focus Graph + Doc Preview (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Phase:** 2 of 2. **Prerequisite: the Phase 1 plan is complete and green** — `docs/superpowers/plans/2026-05-24-qmd-obsidian-plugin-phase-1-search.md`. Task numbering continues from Phase 1 (which ended at Task 7); this plan starts at **Task 8**.

**Goal:** Add a focus/ego relational graph of semantically-related documents, an in-app read-only preview for external (non-vault) docs, and a settings collection-picker — on top of the Phase 1 search plugin.

**Architecture:** Extend `QmdClient` with a minimal session-based MCP client (`POST /mcp`) for `get`-by-docid (preview) and `status` (collection listing). Doc→doc neighbors are derived by a `vec` query built from the source note's excerpt (qmd exposes no neighbors endpoint). The ego graph renders with d3-force on a canvas inside an `ItemView`.

**Tech Stack:** TypeScript, esbuild, vitest, Obsidian Plugin API (`isDesktopOnly: true`), **d3-force + canvas**. d3 deps were declared in the Phase 1 `package.json`; no new install needed.

**Source of truth for qmd behavior:** spec `docs/superpowers/specs/2026-05-24-qmd-obsidian-plugin-design.md` ("Planning findings"). qmd source at `/home/igi21/experiements/qmd` (`@tobilu/qmd` v2.5.2). MCP protocol details are in Task 8 below.

**Prerequisite for integration tests / manual smoke:** Phase 1 implemented; qmd daemon running (`qmd mcp --http --daemon`); `curl -s localhost:8181/health` → ok.

---

## File Structure (Phase 2 — creates/modifies)

```
src/
├── qmd-client.ts          # MODIFY: append MCP path (mcpGet, mcpStatus, session handshake)
├── main.ts                # MODIFY: register graph view, bootstrap via status(), event bridge
├── settings-tab.ts        # MODIFY: "Detect collections" picker
├── neighbors.ts           # CREATE: buildExcerpt(), deriveNeighbors()   [pure]
├── graph-builder.ts       # CREATE: buildEgoGraph()                      [pure]
└── views/
    ├── search-view.ts     # MODIFY: external-open → DocPreviewModal; "graph" affordance
    ├── focus-graph-view.ts# CREATE: FocusGraphView (ItemView)   [obsidian]
    └── doc-preview.ts      # CREATE: DocPreviewModal             [obsidian]
test/
├── mcp-client.test.ts     # CREATE
├── neighbors.test.ts      # CREATE
└── graph-builder.test.ts  # CREATE
```

**Boundary rule (unchanged):** `[pure]` modules (`neighbors.ts`, `graph-builder.ts`) must NOT `import ... from "obsidian"`; they are unit-tested. View/Modal files import obsidian and are verified by manual smoke.

---

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
  private async activateGraphView(): Promise<WorkspaceLeaf | null> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_QMD_GRAPH)[0];
    if (!leaf) { leaf = workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW_TYPE_QMD_GRAPH, active: true }); }
    await workspace.revealLeaf(leaf);   // await: revealLeaf returns Promise (1.7.2); guarantees the leaf is loaded, not deferred
    return leaf;
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
      const leaf = await this.activateGraphView();
      // Deferred views (1.7.2+): never cast leaf.view — guard with instanceof after the awaited revealLeaf above.
      if (leaf && leaf.view instanceof FocusGraphView) await leaf.view.centerOn(file, label);
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
