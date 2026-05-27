# qmd × Obsidian — Native-style grouped search results

- **Date:** 2026-05-27
- **Status:** Approved design — ready for implementation
- **Project:** `/home/igi21/experiements/obsidian/obsidian_qmd_plugin`
- **Issue:** `obsidian_qmd_plugin-m39`
- **Builds on:** `src/views/search-view.ts`, `src/result-list.ts` (flat — stays for RelatedNotes), `src/qmd-client.ts` (`QmdSearchResult`), `src/open-target.ts`, `src/open-action.ts`, `src/clean-snippet.ts`.

## Goal

Restyle the qmd SearchView results to mirror Obsidian's native search panel: results **grouped by file** under **collapsible headers** with a **match count**, each match showing its **line number + context line**, **term highlight** in keyword mode, and **click → open the note at that line**. v1 also ships **hover-preview** (native page-preview popover) and a **collapse-all** toggle. The RelatedNotes flat list is untouched.

This is "direction A" of the native-search question: similar-to-default is supported (Obsidian publishes Search-plugin CSS vars); part-of-core is not (no provider/inject API).

## Locked decisions

| Decision | Choice | Source |
|---|---|---|
| Rendering | Group by `file` under a collapsible header (▼/▶); a count line `N files · M matches` at top. | Q (visual mockup approved) |
| Group + match order | Group order = **first appearance** in qmd's ranked results (best match wins the slot); matches within a group in encounter (rank) order. Preserves qmd relevance ordering. | Derived |
| Highlight | **Keyword mode only**: split the query into terms, case-insensitive, rendered as `createSpan` segments (no `innerHTML`). Hybrid/semantic → plain context (no matched-terms exist to bold). | qmd constraint |
| Open action | Click a match → vault note opens **at `result.line`** (`setEphemeralState`); external-collection match opens in the existing `DocPreviewModal` (no line jump). | Derived |
| Line indexing | qmd `line` is **1-indexed**; Obsidian editor lines are **0-indexed** → open at `max(0, line - 1)`. | qmd/Obsidian |
| Hover-preview | Vault matches only: `mouseover` → `app.workspace.trigger("hover-link", …)` → core Page Preview popover. External matches skip (no vault file). | Q (add-ons) |
| Collapse | Groups default **expanded**. A **collapse-all / expand-all** toggle in the header. Collapsed file keys held in a `Set` on the view → remembered while viewing one result set; a new search resets it. | Q (add-ons) |
| Rank number | The per-result `#N` badge is **dropped** (grouping reorders; native search shows no rank). | Q |
| Sidebar | Right sidebar, **unchanged** (`getRightLeaf`). Left-sidebar move not selected. | Q (add-ons) |
| Operators | `path:` / `-exclude` / `"phrase"` **deferred** to a separate later feature. | Q (add-ons) |
| Code sharing | New pure modules + new renderer used **only** by SearchView. `renderResultList` (flat) keeps its current behavior for RelatedNotesView. | Derived |

## Facts this relies on

- `QmdSearchResult = { docid, file, title, score, context, line, snippet }` (`src/qmd-client.ts:3`). One result = one match/chunk; multiple results can share a `file`. `file` is collection-relative and collection-prefixed (`crawl4ai-docs/embeddings.md`, `vault/notes/x.md`).
- `renderResultList` is **shared** by SearchView (`search-view.ts:69`) and RelatedNotesView (`related-notes-view.ts:58,80`). Behavior must not change.
- `resolveOpenTarget(file, docid, resolveVaultPath, vaultCollectionName)` → `{kind:"vault", path}` | `{kind:"external", file, docid}` (`src/open-target.ts:17`). `makeVaultResolver(app)` builds `resolveVaultPath` (`src/vault-resolver.ts`).
- `cleanSnippet(raw)` strips qmd's `NN:` line prefixes, the `@@ … @@` hunk header, and blank lines (`src/clean-snippet.ts`).
- `openResolvedTarget(app, client, target)` opens vault via `openLinkText`, external via `DocPreviewModal` (`src/open-action.ts`).
- SearchView is an `ItemView` (a `Component` / valid `hoverParent`); the view opens in the right sidebar via `getRightLeaf` (`main.ts:106`).
- Pure logic lives in tested modules (the repo's pattern: `clean-snippet`, `search-plan`, `search-fallback`, `qmd-context`, `settings` all have vitest tests).

## Components

### `src/group-results.ts` (new — pure, tested)

```ts
import type { QmdSearchResult } from "./qmd-client";
import { resolveOpenTarget, type OpenTarget } from "./open-target";
import { cleanSnippet } from "./clean-snippet";

export interface ResultMatch { line: number; docid: string; context: string; }
export interface FileGroup {
  key: string;        // group identity for collapse state — the collection-relative `file`
  target: OpenTarget; // resolved once per file
  title: string;      // r.title || filename(file)
  tag: string;        // "vault" for vault files; else the collection prefix (first path segment)
  matches: ResultMatch[];
}

/** Group ranked qmd results by file, preserving first-appearance order. Pure. */
export function groupResults(
  results: QmdSearchResult[],
  resolveVaultPath: (collectionRelativePath: string) => string | null,
  vaultCollectionName: string,
): FileGroup[];
```

Behavior: iterate `results` once into a `Map<string, FileGroup>` keyed by `r.file` (insertion order = first-appearance). For a new key, resolve `target = resolveOpenTarget(r.file, r.docid, resolveVaultPath, vaultCollectionName)`; `tag = target.kind === "vault" ? "vault" : r.file.split("/")[0]`; `title = r.title || (r.file.split("/").pop() ?? r.file)`. Append `{ line: r.line, docid: r.docid, context: cleanSnippet(r.snippet) }` to the group's `matches`. Return `[...map.values()]`.

### `src/highlight.ts` (new — pure, tested)

```ts
export interface Segment { text: string; hit: boolean; }

/** Split a query into highlight terms: whitespace-split, drop empties, de-duplicate (case-insensitive). */
export function queryTerms(query: string): string[];

/** Segment `text` into hit / non-hit runs against `terms` (case-insensitive). Empty `terms` → one non-hit segment spanning the whole text. Regex-special chars in terms are escaped. */
export function highlightTerms(text: string, terms: string[]): Segment[];
```

`highlightTerms`: if `terms` is empty return `[{ text, hit: false }]`. Else build `new RegExp("(" + terms.map(escapeRegExp).join("|") + ")", "gi")`, walk matches, emit alternating non-hit/hit `Segment`s covering the full string (no gaps, no overlaps). The renderer turns each segment into a `span` (hit → class `qmd-hl`) — never `innerHTML`.

### `src/grouped-result-list.ts` (new — renderer, build-verified)

```ts
import type { App, Component } from "obsidian";
import type { QmdClient } from "./qmd-client";
import type { FileGroup } from "./group-results";

export interface RenderGroupedOptions {
  container: HTMLElement;
  groups: FileGroup[];
  terms: string[];          // highlight terms; [] in hybrid mode
  app: App;
  client: QmdClient;
  collapsed: Set<string>;    // group keys currently collapsed (mutated as the user folds)
  emptyText: string;
  viewType: string;          // hover-link `source`
  hoverParent: Component;    // hover-link `hoverParent` (the SearchView)
  sourcePath: string;        // hover-link `sourcePath` (active file path or "")
}

export function renderGroupedResults(opts: RenderGroupedOptions): void;
```

Renders: empties container; if `groups` empty → `emptyText` status div and return. Else a header row = count line (`N files · M matches`, singular-aware) + a collapse-all/expand-all toggle. Per group: a `file` element carrying `data-key`, a clickable header (chevron + title + `tag`), and a `matches` element. Each match → a row with a line label (`result.line`) and the context built from `highlightTerms(match.context, terms)` segments (`createSpan`). Row `click` → `openResolvedTarget(app, client, group.target, match.line)`. Row `mouseover` → if `group.target.kind === "vault"`, `app.workspace.trigger("hover-link", { event, source: viewType, hoverParent, targetEl: row, linktext: group.target.path, sourcePath })`.

Fold mechanics (no full re-render): header click toggles the `is-collapsed` class on its `file` element + flips the chevron + adds/removes `group.key` in `collapsed`. Collapse-all: if any group is expanded, collapse all (add every key + class); else expand all (clear). On initial render, apply `is-collapsed` to groups whose key is already in `collapsed`.

### `src/open-action.ts` (modify — add optional line)

```ts
import { MarkdownView } from "obsidian"; // add to imports

export async function openResolvedTarget(app: App, client: QmdClient, target: OpenTarget, line?: number): Promise<void> {
  if (target.kind === "vault") {
    await app.workspace.openLinkText(target.path, "", false);
    if (line != null) app.workspace.getActiveViewOfType(MarkdownView)?.setEphemeralState({ line: toEditorLine(line) });
  } else {
    const { DocPreviewModal } = await import("./views/doc-preview");
    new DocPreviewModal(app, client, target.docid).open();
  }
}

/** qmd's 1-indexed source line → Obsidian's 0-indexed editor line. Pure, exported for test. */
export function toEditorLine(qmdLine: number): number { return Math.max(0, qmdLine - 1); }
```

The `line` param is optional → existing callers (`result-list.ts`, `doc-preview`) are unaffected.

### `src/views/search-view.ts` (modify — wire grouped rendering)

- Add field `private collapsed = new Set<string>();`.
- Import `groupResults`, `renderGroupedResults`, `queryTerms`, `makeVaultResolver`.
- `render(results, terms?)` becomes: `const resolve = makeVaultResolver(this.app); const groups = groupResults(results, resolve, this.settings.vaultCollectionName); const hl = terms ?? (this.mode === "keyword" ? queryTerms(input.value) : []); renderGroupedResults({ container: list, groups, terms: hl, app: this.app, client: this.client, collapsed: this.collapsed, emptyText: "No results.", viewType: VIEW_TYPE_QMD_SEARCH, hoverParent: this, sourcePath: this.app.workspace.getActiveFile()?.path ?? "" });`
- At the start of `execute` (new query), `this.collapsed.clear()` so a fresh result set starts expanded.
- `runFallback` calls `render(results, queryTerms(input.value))` (fallback is a keyword re-run → highlight its terms even though `this.mode` is hybrid).
- Error/status/mode-toggle/debounce logic unchanged.

### `styles.css` (append — native tree look)

Classes (`qmd-results-head`, `qmd-results-count`, `qmd-collapse-all`, `qmd-file`, `qmd-file-header`, `qmd-chevron`, `qmd-file-title`, `qmd-file-tag`, `qmd-matches`, `qmd-match`, `qmd-match-line`, `qmd-match-text`, `qmd-hl`, `is-collapsed`) using Obsidian vars: `--text-normal`, `--text-muted`, `--background-modifier-hover`, `--text-highlight-bg` (for `qmd-hl`), `--size-4-*`. `.is-collapsed .qmd-matches { display: none; }`.

## Behavior

| Action | Result |
|---|---|
| Keyword search | Grouped results; query terms bolded (`qmd-hl`) in context. |
| Hybrid search | Grouped results; plain context (no highlight). |
| Click a file header | Folds/unfolds that file's matches; chevron flips; key tracked in `collapsed`. |
| Click collapse-all (any expanded) | All groups collapse. Click again (all collapsed) | All groups expand. |
| Click a match (vault) | Opens the note and scrolls to `result.line`. |
| Click a match (external) | Opens the read-only `DocPreviewModal`. |
| Hover a match (vault) | Native page-preview popover (if Page Preview enabled). |
| New search | `collapsed` cleared → fresh result set renders expanded. |
| RelatedNotes panel | Unchanged flat list. |

## Testing (vitest — pure logic)

`test/group-results.test.ts`:
- single file, two results → one group, two matches in order; `context` is `cleanSnippet`-cleaned.
- three results across two files (A, B, A) → two groups, order [A, B], A has two matches.
- vault file (resolver returns a path) → `kind:"vault"`, `tag:"vault"`; external (resolver returns null) → `kind:"external"`, `tag` = first path segment.
- empty `title` → `title` falls back to filename.
- `[]` results → `[]`.

`test/highlight.test.ts`:
- `queryTerms("  Foo  bar foo ")` → `["foo","bar"]` (trim, drop empties, de-dupe case-insensitively).
- `highlightTerms("x", [])` → `[{text:"x",hit:false}]`.
- single term, case-insensitive → correct hit/non-hit segmentation; segments rejoin to the original text.
- two terms in one string → both hit.
- regex-special term (`"a.b"`, `"c++"`) is escaped (matches literally, no regex blow-up).
- no occurrence → one non-hit segment.

`test/open-action.test.ts` (or fold into existing): `toEditorLine(1) === 0`, `toEditorLine(0) === 0`, `toEditorLine(50) === 49`.

`renderGroupedResults`, hover-preview, and the SearchView wiring need the Obsidian runtime → covered by `npm run build` (tsc + esbuild) and manual smoke.

## Manual smoke (Windows vault)

1. Keyword search a common term → results grouped by file with a count line; query terms highlighted.
2. Fold/unfold a file header; toggle collapse-all both ways.
3. Click a match → note opens scrolled to the right line.
4. Hover a match → native page-preview popover appears (Page Preview core plugin on).
5. Hybrid search → grouped, no highlight.
6. A result from an external collection → opens the preview modal (no line jump); tag shows the collection name.
7. Open the Related notes panel → still a flat list (unchanged).

## Out of scope

Search operators (`path:`/`tag:`/`-exclude`/`"phrase"`); moving the panel to the left sidebar; showing a numeric score/rank; expandable multi-line context controls; persisting collapse state across sessions/reloads; changing RelatedNotes rendering.
