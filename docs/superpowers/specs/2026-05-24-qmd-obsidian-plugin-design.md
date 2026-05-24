# qmd × Obsidian — Search Engine Plugin + Relational Graph

- **Date:** 2026-05-24
- **Status:** Approved design — ready for implementation planning
- **Project:** `/home/igi21/experiements/obsidian/obsidian_qmd_plugin` (greenfield)

## Goal

An Obsidian plugin that uses **qmd** (on-device hybrid search: BM25 + vector + LLM rerank) as the search engine for the vault and selected external qmd collections, plus a **relational graph** that surfaces semantic relationships qmd knows but Obsidian's `[[wikilink]]` graph cannot.

## Locked decisions

| Decision | Choice |
|---|---|
| **Corpus** | Vault (primary) **+ selectable** external qmd collections (opt-in per search / graph). |
| **Vault freshness** | **On-save, debounced** incremental reindex. Only changed notes re-embed. |
| **Search surface** | **Right side panel** (primary). Modal hotkey deferred to Phase 3. |
| **Graph concept** | **Focus / ego graph** centered on current note or a search hit; expand on click. Global-map + link-overlay deferred. |
| **qmd integration** | **HTTP daemon** for reads (search/get/neighbors) + **`qmd index` CLI** for index-on-save. Embed-library and CLI-only rejected. |
| **Daemon lifecycle** | **Auto-detect + offer to start**: probe `/health`; connect if up, one-click start (configured binary path) if down. |

## qmd facts this design relies on

- qmd `@tobilu/qmd` v2.5.2 — SQLite + sqlite-vec store, `node-llama-cpp` embeddings/rerank.
- HTTP daemon: `qmd mcp --http --daemon` → `POST http://localhost:8181/mcp` (MCP Streamable HTTP, stateless JSON) + `GET /health`. Models stay warm in VRAM across requests.
- MCP tool surface: `query` (sub-queries: `lex` BM25 / `vec` semantic / `hyde`), `get` (by path or `#docid`, line offsets), `multi_get` (glob / list), `status` (collections).
- `qmd index` is **incremental** — hash-based; re-running skips unchanged files, re-embeds only changed ones. No built-in file watcher (the plugin supplies the trigger).
- Native deps (`better-sqlite3`, `node-llama-cpp`) make embedding qmd inside the plugin impractical → daemon + CLI instead.

## Architecture

Standard Obsidian plugin: TypeScript + esbuild, `manifest.json`, `main.ts`. Seven components:

| Component | Responsibility | Depends on |
|---|---|---|
| **QmdClient** | HTTP client to daemon `/mcp`. Plain `fetch` POST with hand-rolled JSON-RPC envelope (no MCP SDK in bundle). Wraps `query` / `get` / `multi_get` / `status` + `/health`. | daemon |
| **DaemonController** | On load probe `/health`. Up → connect. Down → status indicator + "Start qmd daemon" button (spawns via configured binary path). | QmdClient, `child_process` |
| **Indexer** | Listen to vault `modify`/`create`/`delete`/`rename` → debounce → spawn `qmd index` (incremental). Register vault as a qmd collection on first run. | `child_process` |
| **SearchView** | Right-panel `ItemView`: query box, collection chips (vault always-on + selectable external), result rows (title · collection badge · score · snippet), row actions. | QmdClient |
| **FocusGraphView** | Ego graph centered on current note / a hit; ring = top-k similar docs across selected collections; click re-centers / expands. d3-force + canvas. | QmdClient |
| **DocPreview** | Read-only markdown render for **external** docs (live outside the vault) via `get`. Vault notes open normally in Obsidian. | QmdClient |
| **Settings** | Binary path, daemon URL/port, included collections, rerank toggle, debounce ms, graph top-k + similarity threshold. | — |

## Data flows

- **Search**: panel input (on **Enter**) → `QmdClient.query({ query, collections:[vault, …selected], rerank:<setting> })` → daemon (warm models) → ranked results → render. Search on Enter, not per-keystroke — qmd does LLM query-expansion + optional rerank, too slow for live typing. (Optional BM25-only as-you-type preview is a later nicety.)
- **Index-on-save**: vault change event → debounce (default ~1.5 s) → spawn `qmd index` (incremental) → DB current → next search fresh. Daemon (reader) + CLI (writer) share the SQLite DB via **WAL** (one writer + N readers).
- **Focus graph**: open on active note → fetch top-k semantically similar docs scoped to selected collections → render ego graph → click node re-centers (fetch *its* neighbors) → expand outward.
- **Open result**: vault note → `workspace.openLinkText` (normal Obsidian). External doc → DocPreview read-only pane (+ "open in system" / "copy path").

## UX

**Search panel** (top→bottom): query box → collection chips (`vault ✓` always-on + click to add external) → results. Result row: title · collection badge (purple vault / teal external) · score % · 1–2 line snippet. Hover → preview tooltip. Click → open. Row actions: open in new pane · insert `[[link]]` (vault hits) · **center graph here**.

**Focus graph**: node = doc (color by collection, size by relevance), edge = similarity (thicker = stronger). Hover → title+snippet. Click → re-center. Cmd/double-click → open (note or DocPreview). Controls: top-k slider, similarity threshold, pan/zoom.

**External docs**: DocPreview read-only render; cannot edit (not in the vault); actions "copy path" / "open in system".

## Technical risk — doc→doc similarity

The focus graph needs **neighbors of a document** ("related to this note"). qmd's HTTP/MCP surface exposes `query` (text→docs), not an obvious "neighbors-of-docid" call.

- **Fallback (works with current tools):** derive neighbors by running a **`vec` query using the source note's own text/excerpt**, scoped to selected collections; take top-k (excluding self).
- **Preferred (if available):** a direct doc-neighbors / by-docid similarity endpoint on the daemon — use it if qmd exposes one, or add one to qmd.
- **Action:** validate during planning before committing the graph approach.

## Settings

`qmd` binary path · daemon URL/port · included external collections · rerank on/off · index debounce ms · graph top-k · graph similarity threshold.

## Testing (TDD)

- **Unit:** QmdClient JSON-RPC envelope; Indexer debounce/event coalescing; neighbor-derivation logic. Obsidian API mocked.
- **Integration:** against a real local qmd daemon using a **throwaway test collection** (`test_qmdobsidian_<timestamp>`) — never touch the live index.
- **Manual smoke:** scratch vault.
- **Error paths:** daemon down (banner + start button), index spawn failure (notice), query error (inline), missing external doc.

## Phasing

Spec covers the full vision; the **first implementation plan = Phases 1–2**.

- **Phase 1 — Search works:** scaffold · Settings · QmdClient · DaemonController · Indexer · SearchView. → semantic search over vault + selected collections, fresh on save. External hits open via "open in system" / "copy path" (in-app DocPreview lands in Phase 2).
- **Phase 2 — Focus graph:** FocusGraphView · neighbor derivation · DocPreview (in-app read-only render of external docs). → ego graph + external-doc preview.
- **Phase 3 — Deferred:** modal command-palette search (surface A); global-similarity-map expansion (graph concept A); augmented `[[link]]`+semantic overlay (graph concept C); auto "related to current note" list; BM25-only as-you-type preview.

## Out of scope

- Editing external (non-vault) documents.
- Managing/indexing external collections (those keep the user's existing qmd workflow; the plugin only registers + reindexes the **vault** collection).
- Bundling/embedding the qmd engine inside the plugin.

## To validate during planning

1. Doc→doc neighbors endpoint vs text-vector fallback (see risk above).
2. SQLite **WAL** concurrency: daemon reader + CLI writer on the same DB — confirm qmd opens WAL mode.
3. MCP Streamable-HTTP JSON-RPC envelope shape for `query`/`get` (capture a real request/response against the running daemon).
4. Registering the vault as a qmd collection programmatically (CLI/config) on first run.
