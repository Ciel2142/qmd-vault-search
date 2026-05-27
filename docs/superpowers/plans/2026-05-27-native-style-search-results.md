# Native-style grouped search results — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the qmd SearchView to render results like Obsidian's native search — grouped by file under collapsible headers, line + context per match, keyword-mode highlight, click-to-open-at-line, plus hover-preview and a collapse-all toggle.

**Architecture:** Two new pure, unit-tested modules (`group-results.ts` shapes ranked results into file groups; `highlight.ts` segments context against query terms). A new renderer `grouped-result-list.ts` (build-verified) draws the tree and wires open/hover/collapse. `open-action.ts` gains an optional line argument. `search-view.ts` swaps its renderer. `styles.css` gets native-tree styling. The flat `result-list.ts` is untouched — RelatedNotesView keeps it.

**Tech Stack:** TypeScript, Obsidian 1.7.2 API, vitest, esbuild.

**Spec:** `docs/superpowers/specs/2026-05-27-native-style-search-results-design.md` · **Issue:** `obsidian_qmd_plugin-m39` · **Branch:** `native-search-results`

Run one test file: `npx vitest run test/<file>.test.ts`. Full suite: `npm test`. Build (tsc + esbuild): `npm run build`.

---

## Task 1: `highlight.ts` — query-term highlighting (TDD, pure)

**Files:**
- Create: `src/highlight.ts`
- Test: `test/highlight.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `test/highlight.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { queryTerms, highlightTerms } from "../src/highlight";

describe("queryTerms", () => {
  it("splits on whitespace, drops empties, lowercases, de-dupes", () => {
    expect(queryTerms("  Foo  bar foo ")).toEqual(["foo", "bar"]);
  });
  it("returns [] for blank input", () => {
    expect(queryTerms("   ")).toEqual([]);
  });
});

describe("highlightTerms", () => {
  it("returns one non-hit segment when there are no terms", () => {
    expect(highlightTerms("hello world", [])).toEqual([{ text: "hello world", hit: false }]);
  });
  it("marks case-insensitive hits and rejoins to the original text", () => {
    const segs = highlightTerms("Embedding models are fast", ["embedding"]);
    expect(segs.map((s) => s.text).join("")).toBe("Embedding models are fast");
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["Embedding"]);
  });
  it("highlights multiple terms", () => {
    const segs = highlightTerms("embedding models", ["embedding", "models"]);
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["embedding", "models"]);
  });
  it("escapes regex-special characters in terms", () => {
    const segs = highlightTerms("value a.b and axb", ["a.b"]);
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["a.b"]);
  });
  it("returns one non-hit segment when nothing matches", () => {
    expect(highlightTerms("nothing here", ["zzz"])).toEqual([{ text: "nothing here", hit: false }]);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/highlight.test.ts` — expected FAIL: "queryTerms is not a function".

- [ ] **Step 3: Implement.** Create `src/highlight.ts`:
```ts
export interface Segment {
  text: string;
  hit: boolean;
}

/** Split a query into lowercased highlight terms: whitespace-split, drop empties, de-duplicate. */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of query.toLowerCase().split(/\s+/)) {
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Segment `text` into hit / non-hit runs against `terms` (case-insensitive).
 * Empty `terms` → a single non-hit segment. Regex-special chars in terms are escaped.
 * Segments always rejoin to the original text (no gaps, no overlaps).
 */
export function highlightTerms(text: string, terms: string[]): Segment[] {
  if (terms.length === 0) return [{ text, hit: false }];
  const re = new RegExp("(" + terms.map(escapeRegExp).join("|") + ")", "gi");
  const segments: Segment[] = [];
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), hit: false });
    segments.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // guard: never loop on a zero-length match
  }
  if (last < text.length) segments.push({ text: text.slice(last), hit: false });
  return segments;
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/highlight.test.ts` — all green.

- [ ] **Step 5: Commit.**
```bash
git add src/highlight.ts test/highlight.test.ts
git commit -m "feat: add query-term highlight segmentation (pure)"
```

---

## Task 2: `group-results.ts` — group ranked results by file (TDD, pure)

**Files:**
- Create: `src/group-results.ts`
- Test: `test/group-results.test.ts`
- Reads (do not modify): `src/qmd-client.ts` (`QmdSearchResult`), `src/open-target.ts` (`resolveOpenTarget`, `OpenTarget`), `src/clean-snippet.ts` (`cleanSnippet`).

- [ ] **Step 1: Write the failing tests.** Create `test/group-results.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { groupResults } from "../src/group-results";
import type { QmdSearchResult } from "../src/qmd-client";

function r(over: Partial<QmdSearchResult>): QmdSearchResult {
  return { docid: "#d", file: "vault/a.md", title: "A", score: 1, context: null, line: 1, snippet: "1: text", ...over };
}
// qmd strips the "vault/" prefix before calling the resolver (see resolveOpenTarget).
const vaultResolver = (p: string): string | null => (p === "notes/a.md" ? "notes/a.md" : null);

describe("groupResults", () => {
  it("groups multiple matches from one file into one group, in order, cleaning snippets", () => {
    const results = [
      r({ file: "vault/notes/a.md", docid: "#1", line: 12, snippet: "12: first hit" }),
      r({ file: "vault/notes/a.md", docid: "#2", line: 47, snippet: "47: second hit" }),
    ];
    const groups = groupResults(results, vaultResolver, "vault");
    expect(groups).toHaveLength(1);
    expect(groups[0].matches.map((m) => m.line)).toEqual([12, 47]);
    expect(groups[0].matches[0].context).toBe("first hit");
  });

  it("orders groups by first appearance (A, B, A -> [A, B])", () => {
    const results = [
      r({ file: "vault/a.md", docid: "#1" }),
      r({ file: "vault/b.md", docid: "#2" }),
      r({ file: "vault/a.md", docid: "#3" }),
    ];
    const groups = groupResults(results, () => null, "vault");
    expect(groups.map((g) => g.key)).toEqual(["vault/a.md", "vault/b.md"]);
    expect(groups[0].matches).toHaveLength(2);
  });

  it("splits vault vs external by the resolver and tags accordingly", () => {
    const results = [
      r({ file: "vault/notes/a.md", docid: "#1" }),
      r({ file: "crawl4ai-docs/embeddings.md", docid: "#2", title: "Embeddings" }),
    ];
    const groups = groupResults(results, vaultResolver, "vault");
    expect(groups[0].target.kind).toBe("vault");
    expect(groups[0].tag).toBe("vault");
    expect(groups[1].target.kind).toBe("external");
    expect(groups[1].tag).toBe("crawl4ai-docs");
  });

  it("falls back to the filename when title is empty", () => {
    const groups = groupResults([r({ file: "vault/notes/a.md", title: "" })], vaultResolver, "vault");
    expect(groups[0].title).toBe("a.md");
  });

  it("returns [] for no results", () => {
    expect(groupResults([], vaultResolver, "vault")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/group-results.test.ts` — expected FAIL: "groupResults is not a function".

- [ ] **Step 3: Implement.** Create `src/group-results.ts`:
```ts
import type { QmdSearchResult } from "./qmd-client";
import { resolveOpenTarget, type OpenTarget } from "./open-target";
import { cleanSnippet } from "./clean-snippet";

export interface ResultMatch {
  line: number;
  docid: string;
  context: string;
}

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
): FileGroup[] {
  const byFile = new Map<string, FileGroup>();
  for (const result of results) {
    let group = byFile.get(result.file);
    if (!group) {
      const target = resolveOpenTarget(result.file, result.docid, resolveVaultPath, vaultCollectionName);
      group = {
        key: result.file,
        target,
        title: result.title || (result.file.split("/").pop() ?? result.file),
        tag: target.kind === "vault" ? "vault" : (result.file.split("/")[0] ?? result.file),
        matches: [],
      };
      byFile.set(result.file, group);
    }
    group.matches.push({ line: result.line, docid: result.docid, context: cleanSnippet(result.snippet) });
  }
  return [...byFile.values()];
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/group-results.test.ts` — all green.

- [ ] **Step 5: Commit.**
```bash
git add src/group-results.ts test/group-results.test.ts
git commit -m "feat: group ranked qmd results by file (pure)"
```

---

## Task 3: `open-action.ts` — open at a line (TDD pure helper + build-verified branch)

**Files:**
- Modify: `src/open-action.ts`
- Modify: `test/__mocks__/obsidian.ts` (add `MarkdownView` stub so the new value import resolves under vitest)
- Modify: `test/open-action.test.ts` (add `toEditorLine` tests; existing tests stay)

- [ ] **Step 1: Write the failing tests.** Edit `test/open-action.test.ts`. Change the import line 14:
```ts
import { openResolvedTarget } from "../src/open-action";
```
to:
```ts
import { openResolvedTarget, toEditorLine } from "../src/open-action";
```
Then append, after the closing `});` of the existing `describe("openResolvedTarget", …)` block:
```ts
describe("toEditorLine", () => {
  it("converts 1-indexed qmd lines to 0-indexed editor lines", () => {
    expect(toEditorLine(1)).toBe(0);
    expect(toEditorLine(50)).toBe(49);
  });
  it("clamps non-positive lines to 0", () => {
    expect(toEditorLine(0)).toBe(0);
    expect(toEditorLine(-3)).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/open-action.test.ts` — expected FAIL: "toEditorLine is not a function" (and a possible resolve warning for the missing import — fixed next).

- [ ] **Step 3: Add the mock stub.** Edit `test/__mocks__/obsidian.ts` — add this line alongside the other stub classes (e.g. after `export class WorkspaceLeaf {}`):
```ts
export class MarkdownView {}
```

- [ ] **Step 4: Implement.** Replace the entire contents of `src/open-action.ts` with:
```ts
import { MarkdownView, type App } from "obsidian";
import type { QmdClient } from "./qmd-client";
import type { OpenTarget } from "./open-target";

/** qmd's 1-indexed source line → Obsidian's 0-indexed editor line. Pure, exported for test. */
export function toEditorLine(qmdLine: number): number {
  return Math.max(0, qmdLine - 1);
}

/**
 * Open a resolved qmd target: vault notes in the workspace (optionally scrolled to a
 * line), external docs in a read-only preview modal. Shared by the result list,
 * grouped result list, and the search modal.
 */
export async function openResolvedTarget(app: App, client: QmdClient, target: OpenTarget, line?: number): Promise<void> {
  if (target.kind === "vault") {
    await app.workspace.openLinkText(target.path, "", false);
    if (line != null) app.workspace.getActiveViewOfType(MarkdownView)?.setEphemeralState({ line: toEditorLine(line) });
  } else {
    const { DocPreviewModal } = await import("./views/doc-preview");
    new DocPreviewModal(app, client, target.docid).open();
  }
}
```
(The `line` param is optional, so the existing callers in `result-list.ts` and `doc-preview` are unaffected. The two existing `openResolvedTarget` tests call the vault branch with no line, so `getActiveViewOfType` is never reached.)

- [ ] **Step 5: Run → PASS.** `npx vitest run test/open-action.test.ts` — all green (existing 2 + new 2).

- [ ] **Step 6: Commit.**
```bash
git add src/open-action.ts test/open-action.test.ts test/__mocks__/obsidian.ts
git commit -m "feat: openResolvedTarget can scroll a vault note to a line"
```

---

## Task 4: `grouped-result-list.ts` — the native-style renderer (build-verified)

**Files:**
- Create: `src/grouped-result-list.ts`
- Reads (do not modify): `src/group-results.ts` (`FileGroup`), `src/highlight.ts` (`highlightTerms`), `src/open-action.ts` (`openResolvedTarget`).

No unit test — the renderer needs the Obsidian DOM helpers (`createDiv`/`createSpan`/`toggleClass`) and `workspace.trigger`. It is covered by `npm run build` (tsc) and the Task 7 smoke. Follow the DOM-helper style of `src/result-list.ts`.

- [ ] **Step 1: Create the renderer.** Create `src/grouped-result-list.ts`:
```ts
import type { App, Component } from "obsidian";
import type { QmdClient } from "./qmd-client";
import type { FileGroup } from "./group-results";
import { openResolvedTarget } from "./open-action";
import { highlightTerms } from "./highlight";

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
  sourcePath: string;        // hover-link `sourcePath`
}

interface FileItem {
  fileEl: HTMLElement;
  key: string;
  chevron: HTMLElement;
}

/** Render qmd results grouped by file, native-search style. Used only by SearchView. */
export function renderGroupedResults(opts: RenderGroupedOptions): void {
  const { container, groups, terms, app, client, collapsed, emptyText, viewType, hoverParent, sourcePath } = opts;
  container.empty();
  if (groups.length === 0) {
    container.createDiv({ cls: "qmd-status", text: emptyText });
    return;
  }

  const matchCount = groups.reduce((n, g) => n + g.matches.length, 0);
  const head = container.createDiv({ cls: "qmd-results-head" });
  head.createSpan({
    cls: "qmd-results-count",
    text: `${groups.length} ${groups.length === 1 ? "file" : "files"} · ${matchCount} ${matchCount === 1 ? "match" : "matches"}`,
  });
  const collapseAll = head.createSpan({ cls: "qmd-collapse-all" });

  const items: FileItem[] = [];
  const apply = (it: FileItem, isCollapsed: boolean): void => {
    it.fileEl.toggleClass("is-collapsed", isCollapsed);
    it.chevron.setText(isCollapsed ? "▶" : "▼");
    if (isCollapsed) collapsed.add(it.key);
    else collapsed.delete(it.key);
  };

  for (const group of groups) {
    const fileEl = container.createDiv({ cls: "qmd-file" });
    const header = fileEl.createDiv({ cls: "qmd-file-header" });
    const chevron = header.createSpan({ cls: "qmd-chevron" });
    header.createSpan({ cls: "qmd-file-title", text: group.title });
    header.createSpan({ cls: "qmd-file-tag", text: group.tag });

    const matchesEl = fileEl.createDiv({ cls: "qmd-matches" });
    for (const m of group.matches) {
      const row = matchesEl.createDiv({ cls: "qmd-match" });
      row.createSpan({ cls: "qmd-match-line", text: String(m.line) });
      const textEl = row.createSpan({ cls: "qmd-match-text" });
      for (const seg of highlightTerms(m.context, terms)) {
        const span = textEl.createSpan({ text: seg.text });
        if (seg.hit) span.addClass("qmd-hl");
      }
      row.onclick = (): void => { void openResolvedTarget(app, client, group.target, m.line); };
      if (group.target.kind === "vault") {
        const linktext = group.target.path;
        row.addEventListener("mouseover", (event) => {
          app.workspace.trigger("hover-link", { event, source: viewType, hoverParent, targetEl: row, linktext, sourcePath });
        });
      }
    }

    const item: FileItem = { fileEl, key: group.key, chevron };
    items.push(item);
    apply(item, collapsed.has(group.key));
    header.onclick = (): void => { apply(item, !item.fileEl.hasClass("is-collapsed")); };
  }

  const syncCollapseAllLabel = (): void => {
    const anyExpanded = items.some((it) => !it.fileEl.hasClass("is-collapsed"));
    collapseAll.setText(anyExpanded ? "Collapse all" : "Expand all");
  };
  syncCollapseAllLabel();
  collapseAll.onclick = (): void => {
    const anyExpanded = items.some((it) => !it.fileEl.hasClass("is-collapsed"));
    for (const it of items) apply(it, anyExpanded);
    syncCollapseAllLabel();
  };
}
```

- [ ] **Step 2: Build.** `npm run build` — tsc clean (no unused symbols; `this`-free module; `Component`/`App` are type-only imports), esbuild writes `main.js`. If tsc complains that `workspace.trigger`'s argument is untyped, that is acceptable — `trigger(name, ...data)` accepts arbitrary data; do NOT cast to `any` to silence anything else without reporting.

- [ ] **Step 3: Commit.**
```bash
git add src/grouped-result-list.ts
git commit -m "feat: native-style grouped result renderer (file groups, collapse, hover, open-at-line)"
```

---

## Task 5: wire `SearchView` to the grouped renderer (build-verified)

**Files:**
- Modify: `src/views/search-view.ts`

- [ ] **Step 1: Update imports.** Replace the current import block (lines 1–6):
```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { QmdClient } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { renderResultList } from "../result-list";
import { planQuery, type SearchMode, type SearchTrigger } from "../search-plan";
import { decideFallback } from "../search-fallback";
```
with:
```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { QmdClient, QmdSearchResult } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { groupResults } from "../group-results";
import { renderGroupedResults } from "../grouped-result-list";
import { queryTerms } from "../highlight";
import { makeVaultResolver } from "../vault-resolver";
import { planQuery, type SearchMode, type SearchTrigger } from "../search-plan";
import { decideFallback } from "../search-fallback";
```
(The `renderResultList` import is removed — SearchView no longer uses it. `result-list.ts` itself is unchanged; RelatedNotesView still imports it.)

- [ ] **Step 2: Add the collapse-state field.** After the existing field `private debounceTimer: number | null = null;` (line 13), add:
```ts
  private collapsed = new Set<string>();
```

- [ ] **Step 3: Replace the `render` closure.** Replace these lines (currently 68–70):
```ts
    const render = (results: Parameters<typeof renderResultList>[0]["results"]): void => {
      renderResultList({ container: list, results, app: this.app, client: this.client, emptyText: "No results.", vaultCollectionName: this.settings.vaultCollectionName });
    };
```
with:
```ts
    const render = (results: QmdSearchResult[], terms?: string[]): void => {
      const groups = groupResults(results, makeVaultResolver(this.app), this.settings.vaultCollectionName);
      const hl = terms ?? (this.mode === "keyword" ? queryTerms(input.value) : []);
      renderGroupedResults({
        container: list,
        groups,
        terms: hl,
        app: this.app,
        client: this.client,
        collapsed: this.collapsed,
        emptyText: "No results.",
        viewType: VIEW_TYPE_QMD_SEARCH,
        hoverParent: this,
        sourcePath: this.app.workspace.getActiveFile()?.path ?? "",
      });
    };
```

- [ ] **Step 4: Highlight fallback (keyword) results.** In `runFallback`, change the line `render(results);` (currently line 82) to:
```ts
        render(results, queryTerms(input.value));
```

- [ ] **Step 5: Reset collapse state on a new search.** In `execute`, immediately after `const id = ++this.searchId;` (currently line 97), add:
```ts
      this.collapsed.clear();
```

- [ ] **Step 6: Build.** `npm run build` — tsc clean. Confirm there is no remaining reference to `renderResultList` in this file (the removed import would otherwise be a tsc error), and that `input` is in scope inside `render` (it is — `input` is declared earlier in `onOpen`).

- [ ] **Step 7: Full test gate.** `npm test` — all suites green (no SearchView unit tests exist; this verifies nothing else regressed).

- [ ] **Step 8: Commit.**
```bash
git add src/views/search-view.ts
git commit -m "feat: SearchView renders native-style grouped results"
```

---

## Task 6: native-tree CSS (build-verified / visual)

**Files:**
- Modify: `styles.css`

`styles.css` is a static file shipped as-is (not bundled), so there is no build step — correctness is confirmed in the Task 7 smoke. Use Obsidian theme variables so it matches the active theme.

- [ ] **Step 1: Append the grouped-result styles.** Add to the end of `styles.css`:
```css
/* Native-style grouped results (SearchView) */
.qmd-results-head { display: flex; align-items: baseline; justify-content: space-between; margin: 4px 0 6px; }
.qmd-results-count { font-size: var(--font-ui-smaller); color: var(--text-muted); }
.qmd-collapse-all { font-size: var(--font-ui-smaller); color: var(--text-muted); cursor: pointer; }
.qmd-collapse-all:hover { color: var(--text-normal); text-decoration: underline; }
.qmd-file { margin-bottom: 2px; }
.qmd-file-header { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: var(--radius-s); cursor: pointer; }
.qmd-file-header:hover { background: var(--background-modifier-hover); }
.qmd-chevron { flex: 0 0 auto; width: 10px; font-size: 10px; color: var(--text-muted); }
.qmd-file-title { font-weight: var(--font-semibold); color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qmd-file-tag { flex: 0 0 auto; margin-left: auto; font-size: var(--font-ui-smaller); color: var(--text-faint); }
.qmd-matches { margin: 0 0 6px 16px; border-left: 2px solid var(--background-modifier-border); }
.qmd-file.is-collapsed .qmd-matches { display: none; }
.qmd-match { display: flex; gap: 8px; padding: 2px 8px; border-radius: var(--radius-s); cursor: pointer; }
.qmd-match:hover { background: var(--background-modifier-hover); }
.qmd-match-line { flex: 0 0 auto; min-width: 30px; text-align: right; font-family: var(--font-monospace); font-size: var(--font-ui-smaller); color: var(--text-faint); }
.qmd-match-text { font-size: var(--font-ui-smaller); color: var(--text-muted); white-space: pre-wrap; }
.qmd-hl { background: var(--text-highlight-bg); color: var(--text-normal); border-radius: 2px; }
```

- [ ] **Step 2: Commit.**
```bash
git add styles.css
git commit -m "style: native-tree CSS for grouped search results"
```

---

## Task 7: manual smoke (Windows vault) — verification only, no code

The plugin spawns `qmd` and uses the Obsidian runtime, so this runs on the user's Windows vault (not the Linux dev env). Deploy per the smoke-test procedure: copy `main.js` + `manifest.json` + `styles.css` into `<vault>/.obsidian/plugins/qmd-search/`, then reload the plugin.

- [ ] **Step 1:** Keyword search a common term → results are grouped by file with a `N files · M matches` line; query terms are highlighted (`qmd-hl`).
- [ ] **Step 2:** Click a file header → folds/unfolds its matches (chevron flips). Click **Collapse all** → all fold; click again (**Expand all**) → all unfold.
- [ ] **Step 3:** Click a match → the note opens scrolled to that line.
- [ ] **Step 4:** Hover a match (with the core **Page Preview** plugin on) → native preview popover appears.
- [ ] **Step 5:** Hybrid search → grouped, no highlight.
- [ ] **Step 6:** A result from an external collection → opens the read-only preview modal (no line jump); its tag shows the collection name.
- [ ] **Step 7:** Open the **Related notes** panel → still a flat list (unchanged).
- [ ] **Step 8:** Note any defects as bd issues; otherwise this completes the smoke for `obsidian_qmd_plugin-m39`.

---

## Done criteria
- [ ] `npm test` green (new: `highlight.test.ts`, `group-results.test.ts`, plus `toEditorLine` cases).
- [ ] `npm run build` green (tsc + esbuild writes `main.js`).
- [ ] `git log` shows 6 task commits on `native-search-results` (Tasks 1–6).
- [ ] Manual smoke (Task 7) passes on the Windows vault.
- [ ] `bd close obsidian_qmd_plugin-m39` after smoke; merge no-ff → master (user pushes master).
