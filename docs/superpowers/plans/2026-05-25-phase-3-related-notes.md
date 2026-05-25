# Related Notes Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-sidebar "Related notes" panel that ambiently shows the top-k semantically related documents for the active note, refreshing (debounced, visibility-gated) as the user navigates.

**Architecture:** A new `RelatedNotesView` (`ItemView`) listens to `active-leaf-change`, debounces, and — via a pure `shouldRefresh` decision function — calls the existing `deriveNeighbors` on the active note, then renders rows through a `renderResultList` helper extracted from `SearchView` so both views share one row renderer.

**Tech Stack:** TypeScript, Obsidian Plugin API 1.7.2, esbuild, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-25-phase-3-related-notes-design.md`

**Conventions:**
- Commands: `npm test` (vitest run), `npm run build` (`tsc --noEmit` + esbuild), `npm run typecheck` (`tsc --noEmit`).
- Every commit message ends with the trailer line: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` (omitted from the snippets below for brevity — add it to each commit).
- Pure logic modules MUST NOT import `obsidian` (vitest aliases `obsidian` to a minimal mock; pure tests run mock-free).

---

## File Structure

**Create:**
- `src/related-refresh.ts` — pure `shouldRefresh(activeFile, lastPath, visible)` decision function. No obsidian import. Unit-tested.
- `test/related-refresh.test.ts` — truth-table tests for `shouldRefresh`.
- `src/result-list.ts` — shared `renderResultList(opts)` row renderer + internal `openTarget` (vault → `openLinkText`, external → `DocPreviewModal`). Imports obsidian; not unit-tested (DOM-heavy, consistent with existing views).
- `src/views/related-notes-view.ts` — `RelatedNotesView extends ItemView` + `VIEW_TYPE_QMD_RELATED`.

**Modify:**
- `src/settings.ts` — add `relatedTopK` field + default.
- `src/settings-tab.ts` — add a "Related notes count" control.
- `src/views/search-view.ts` — replace private `renderResults`/`openTarget` with a `renderResultList` call; trim now-unused imports.
- `src/main.ts` — register the view, ribbon icon, command, `activateRelatedView()`.
- `test/settings.test.ts` — assert the new default.

**No CSS changes:** the row classes (`.qmd-result`, `.qmd-result-title`, `.qmd-result-meta`, `.qmd-badge`, `.qmd-score`, `.qmd-graph-link`, `.qmd-snippet`, `.qmd-status`) in `styles.css` are global/unprefixed and already styled. The view reuses them.

---

## Task 1: `relatedTopK` setting

**Files:**
- Modify: `test/settings.test.ts`
- Modify: `src/settings.ts:1-25`
- Modify: `src/settings-tab.ts:30` (insert after the "Reindex debounce (ms)" setting)

- [ ] **Step 1: Write the failing test**

Add this `it` block inside the `describe("settings", …)` in `test/settings.test.ts` (after the existing first test):

```ts
  it("defaults relatedTopK to 8", () => {
    expect(DEFAULT_SETTINGS.relatedTopK).toBe(8);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- related` 
(or `npx vitest run test/settings.test.ts`)
Expected: FAIL — `expected undefined to be 8`.

- [ ] **Step 3: Add the field + default**

In `src/settings.ts`, add the field to the `QmdSettings` interface after `graphMinScore`:

```ts
  graphMinScore: number;          // focus-graph min similarity
  relatedTopK: number;            // related-notes panel neighbor count
  autoReindex: boolean;           // reindex vault on save
```

And add the default in `DEFAULT_SETTINGS` after `graphMinScore: 0.3,`:

```ts
  graphMinScore: 0.3,
  relatedTopK: 8,
  autoReindex: true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/settings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the settings-tab control**

In `src/settings-tab.ts`, insert this block immediately after the "Reindex debounce (ms)" `new Setting(...)` (currently ending at line 30), before the "Detect collections" setting:

```ts
    new Setting(containerEl).setName("Related notes count").setDesc("How many related notes to show in the Related notes panel.")
      .addText((t) => t.setValue(String(this.plugin.settings.relatedTopK)).onChange(async (v) => { const n = parseInt(v, 10); if (!Number.isNaN(n)) { this.plugin.settings.relatedTopK = n; await this.plugin.saveSettings(); } }));
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/settings.ts src/settings-tab.ts test/settings.test.ts
git commit -m "feat: add relatedTopK setting for the Related notes panel"
```

---

## Task 2: `shouldRefresh` decision function

**Files:**
- Create: `src/related-refresh.ts`
- Test: `test/related-refresh.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/related-refresh.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldRefresh } from "../src/related-refresh";

describe("shouldRefresh", () => {
  const md = (path: string) => ({ path, extension: "md" });

  it("clears when there is no active file", () => {
    expect(shouldRefresh(null, "notes/a.md", true)).toEqual({ action: "clear" });
  });

  it("skips non-markdown active files (keeps current)", () => {
    expect(shouldRefresh({ path: "x.pdf", extension: "pdf" }, "notes/a.md", true)).toEqual({ action: "skip" });
  });

  it("skips when the active note is already shown", () => {
    expect(shouldRefresh(md("notes/a.md"), "notes/a.md", true)).toEqual({ action: "skip" });
  });

  it("defers when the panel is hidden", () => {
    expect(shouldRefresh(md("notes/b.md"), "notes/a.md", false)).toEqual({ action: "defer" });
  });

  it("renders a new markdown note when visible", () => {
    expect(shouldRefresh(md("notes/b.md"), "notes/a.md", true)).toEqual({ action: "render", path: "notes/b.md" });
  });

  it("renders when nothing has been shown yet", () => {
    expect(shouldRefresh(md("notes/a.md"), null, true)).toEqual({ action: "render", path: "notes/a.md" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/related-refresh.test.ts`
Expected: FAIL — cannot find module `../src/related-refresh`.

- [ ] **Step 3: Write the implementation**

Create `src/related-refresh.ts`:

```ts
/** Minimal view of the active file — deliberately NOT Obsidian's TFile, to keep this module obsidian-free + unit-testable. */
export type ActiveFileInfo = { path: string; extension: string } | null;

export type RefreshDecision =
  | { action: "skip" }                 // same note, or non-markdown → keep current
  | { action: "clear" }                // no active file → empty state
  | { action: "defer" }                // panel hidden → re-evaluated on reveal
  | { action: "render"; path: string };

/** Decide whether the Related notes panel should refresh for the current active file. */
export function shouldRefresh(activeFile: ActiveFileInfo, lastPath: string | null, visible: boolean): RefreshDecision {
  if (!activeFile) return { action: "clear" };
  if (activeFile.extension !== "md") return { action: "skip" };
  if (activeFile.path === lastPath) return { action: "skip" };
  if (!visible) return { action: "defer" };
  return { action: "render", path: activeFile.path };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/related-refresh.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/related-refresh.ts test/related-refresh.test.ts
git commit -m "feat: add shouldRefresh decision logic for the Related notes panel"
```

---

## Task 3: Extract shared `renderResultList`

This is a behavior-preserving refactor: move `SearchView`'s private row rendering + open logic into a shared module, then point `SearchView` at it. No `search-view` unit tests exist; verify via build + the search smoke test in Task 6.

**Files:**
- Create: `src/result-list.ts`
- Modify: `src/views/search-view.ts:1-4` (imports), `:45-62` (runSearch call), `:66-95` (delete the two private methods)

- [ ] **Step 1: Create the shared renderer**

Create `src/result-list.ts` (this is `SearchView.renderResults` + `openTarget` lifted verbatim, parameterized by `container`/`app`/`client`/`emptyText`):

```ts
import { App, TFile } from "obsidian";
import type { QmdClient, QmdSearchResult } from "./qmd-client";
import { resolveOpenTarget } from "./open-target";

export interface RenderResultListOptions {
  container: HTMLElement;
  results: QmdSearchResult[];
  app: App;
  client: QmdClient;
  emptyText: string;
}

/** Render a list of qmd results. Shared by SearchView and RelatedNotesView. */
export function renderResultList(opts: RenderResultListOptions): void {
  const { container, results, app, client, emptyText } = opts;
  container.empty();
  if (results.length === 0) {
    container.createDiv({ cls: "qmd-status", text: emptyText });
    return;
  }
  const isVaultFile = (p: string): boolean => app.vault.getAbstractFileByPath(p) instanceof TFile;
  for (const r of results) {
    const row = container.createDiv({ cls: "qmd-result" });
    const target = resolveOpenTarget(r.file, r.docid, isVaultFile);
    row.createDiv({ cls: "qmd-result-title", text: r.title || r.file });
    const meta = row.createDiv({ cls: "qmd-result-meta" });
    meta.createSpan({ cls: `qmd-badge ${target.kind}`, text: target.kind === "vault" ? "vault" : "external" });
    meta.createSpan({ cls: "qmd-score", text: `${Math.round(r.score * 100)}%` });
    const graphBtn = meta.createSpan({ cls: "qmd-graph-link", text: "graph" });
    graphBtn.onclick = (ev): void => {
      ev.stopPropagation();
      app.workspace.trigger("qmd:center-graph", r.file, r.title || r.file);
    };
    row.createDiv({ cls: "qmd-snippet", text: r.snippet });
    row.onclick = (): void => { void openTarget(app, client, r); };
  }
}

async function openTarget(app: App, client: QmdClient, r: QmdSearchResult): Promise<void> {
  const target = resolveOpenTarget(r.file, r.docid, (p) => app.vault.getAbstractFileByPath(p) instanceof TFile);
  if (target.kind === "vault") {
    await app.workspace.openLinkText(target.path, "", false);
  } else {
    const { DocPreviewModal } = await import("./views/doc-preview");
    new DocPreviewModal(app, client, target.docid).open();
  }
}
```

- [ ] **Step 2: Repoint SearchView at the shared renderer**

In `src/views/search-view.ts`, replace the import block (lines 1-4):

```ts
import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type { QmdClient, QmdSearchResult } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { resolveOpenTarget } from "../open-target";
```

with (drops `TFile`, `QmdSearchResult`, `resolveOpenTarget`; adds `renderResultList`):

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { QmdClient } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { renderResultList } from "../result-list";
```

- [ ] **Step 3: Replace the render call**

In `runSearch`, replace this line:

```ts
        this.renderResults(list, results);
```

with:

```ts
        renderResultList({ container: list, results, app: this.app, client: this.client, emptyText: "No results." });
```

- [ ] **Step 4: Delete the now-shared private methods**

Delete the entire `renderResults` method and the entire `openTarget` method from `src/views/search-view.ts` (the two methods spanning the old lines 66-95). Leave `onClose()` intact.

After this, the class body is: constructor, `getViewType`/`getDisplayText`/`getIcon`, `onOpen`, `onClose`.

- [ ] **Step 5: Typecheck + build**

Run: `npm run build`
Expected: `tsc --noEmit` passes (no unused-import or missing-symbol errors), esbuild writes `main.js`.

- [ ] **Step 6: Run the full test suite (no regressions)**

Run: `npm test`
Expected: all existing tests PASS (search has no unit tests; this confirms nothing else broke).

- [ ] **Step 7: Commit**

```bash
git add src/result-list.ts src/views/search-view.ts
git commit -m "refactor: extract shared renderResultList from SearchView"
```

---

## Task 4: `RelatedNotesView`

**Files:**
- Create: `src/views/related-notes-view.ts`

No unit test (DOM/Obsidian-heavy ItemView, consistent with existing untested views). Verified by build + manual smoke (Task 6).

- [ ] **Step 1: Create the view**

Create `src/views/related-notes-view.ts`:

```ts
import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type { QmdClient } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { deriveNeighbors } from "../neighbors";
import { renderResultList } from "../result-list";
import { shouldRefresh } from "../related-refresh";

export const VIEW_TYPE_QMD_RELATED = "qmd-related-notes";

const DEBOUNCE_MS = 300;

export class RelatedNotesView extends ItemView {
  private listEl!: HTMLElement;
  private lastPath: string | null = null;
  private visible = true;
  private renderToken = 0;
  private debounceTimer: number | null = null;
  private observer: IntersectionObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private client: QmdClient, private settings: QmdSettings) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_QMD_RELATED; }
  getDisplayText(): string { return "Related notes"; }
  getIcon(): string { return "list"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("qmd-related-view");
    this.listEl = this.contentEl.createDiv({ cls: "qmd-results" });

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()));

    this.observer = new IntersectionObserver((entries) => {
      const wasVisible = this.visible;
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible && !wasVisible) this.scheduleRefresh();
    });
    this.observer.observe(this.contentEl);

    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => { this.debounceTimer = null; void this.refresh(); }, DEBOUNCE_MS);
  }

  private async refresh(): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    const info = active ? { path: active.path, extension: active.extension } : null;
    const decision = shouldRefresh(info, this.lastPath, this.visible);

    if (decision.action === "skip" || decision.action === "defer") return;
    if (decision.action === "clear") {
      this.lastPath = null;
      renderResultList({ container: this.listEl, results: [], app: this.app, client: this.client, emptyText: "Open a note to see related notes." });
      return;
    }

    // decision.action === "render"
    const path = decision.path;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;

    const token = ++this.renderToken;
    this.listEl.empty();
    this.listEl.createDiv({ cls: "qmd-status", text: "Finding related notes…" });
    try {
      const content = await this.app.vault.cachedRead(file);
      const neighbors = await deriveNeighbors(this.client, {
        content,
        collections: [this.settings.vaultCollectionName, ...this.settings.externalCollections],
        selfFile: path,
        limit: this.settings.relatedTopK,
        minScore: this.settings.graphMinScore,
      });
      if (token !== this.renderToken) return; // superseded by a newer refresh
      renderResultList({ container: this.listEl, results: neighbors, app: this.app, client: this.client, emptyText: "No related notes found." });
      this.lastPath = path;
    } catch {
      if (token !== this.renderToken) return;
      this.listEl.empty();
      this.listEl.createDiv({ cls: "qmd-status", text: "qmd daemon not reachable — related notes unavailable." });
      // lastPath left unchanged → retry on the next note switch
    }
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.observer?.disconnect();
    this.contentEl.empty();
  }
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run build`
Expected: `tsc --noEmit` passes, esbuild writes `main.js`. (The view is not yet registered — that is Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/views/related-notes-view.ts
git commit -m "feat: RelatedNotesView — auto related-notes sidebar panel"
```

---

## Task 5: Register the view in main.ts

**Files:**
- Modify: `src/main.ts:9` (import), `:36-37` (registration block), `:78-84` (add activate method)

- [ ] **Step 1: Add the import**

In `src/main.ts`, after the focus-graph import (line 9):

```ts
import { FocusGraphView, VIEW_TYPE_QMD_GRAPH } from "./views/focus-graph-view";
import { RelatedNotesView, VIEW_TYPE_QMD_RELATED } from "./views/related-notes-view";
```

- [ ] **Step 2: Register view + ribbon + command**

In `onload`, immediately after the focus-graph command registration (the `this.addCommand({ id: "open-qmd-focus-graph", … })` line at line 37), insert:

```ts
    this.registerView(VIEW_TYPE_QMD_RELATED, (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this.client, this.settings));
    this.addRibbonIcon("list", "qmd Related notes", () => this.activateRelatedView());
    this.addCommand({ id: "open-qmd-related", name: "Open related notes panel", callback: () => this.activateRelatedView() });
```

- [ ] **Step 3: Add the activate method**

In the `QmdPlugin` class, after `activateSearchView()` (ends line 76) — mirrors it (right sidebar):

```ts
  private async activateRelatedView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_QMD_RELATED)[0];
    if (!leaf) { leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true); await leaf.setViewState({ type: VIEW_TYPE_QMD_RELATED, active: true }); }
    await workspace.revealLeaf(leaf);
  }
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run build`
Expected: `tsc --noEmit` passes, esbuild writes `main.js`.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat: register Related notes view (ribbon + command)"
```

---

## Task 6: Manual smoke verification

No code; verifies end-to-end against a real daemon. Requires a scratch vault with the qmd daemon running (`qmd mcp --http --daemon`) and the plugin built (`npm run build`) + loaded.

- [ ] **Step 1:** Reload Obsidian (or re-enable the plugin) so the new view registers. Click the "qmd Related notes" ribbon icon (list icon) — a "Related notes" panel opens in the right sidebar.
- [ ] **Step 2:** With a note open, the panel lists related docs (title · badge · score% · `graph` · snippet). Switch to another note → list updates (after ~300 ms).
- [ ] **Step 3:** Click a **vault** row → the note opens AND the panel re-centers on it (its neighbors now shown).
- [ ] **Step 4:** Click an **external** row → `DocPreviewModal` opens with the rendered doc.
- [ ] **Step 5:** Click a row's `graph` link → the focus graph opens/centers on that doc.
- [ ] **Step 6:** Open a non-markdown file (PDF/image) → the panel keeps the last note's list (no error). Close all notes → panel shows "Open a note to see related notes."
- [ ] **Step 7:** Collapse the right sidebar, navigate through several notes, re-expand → the panel shows the **current** note's neighbors (refresh on reveal), not a stale one.
- [ ] **Step 8:** Stop the daemon (`qmd mcp stop`), switch notes → panel shows "qmd daemon not reachable — related notes unavailable." (no Notice popups). Restart the daemon, switch notes → recovers.
- [ ] **Step 9:** Confirm the existing **search** panel still works unchanged (query → results → open vault/external → graph link) — proves the `renderResultList` extraction is behavior-preserving.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Surface = dedicated right-sidebar ItemView → Task 4 + Task 5. ✓
- Auto-refresh, debounced, visibility-gated → Task 4 (`scheduleRefresh` + `IntersectionObserver` + `shouldRefresh`). ✓
- Corpus = `[vault, ...externalCollections]` → Task 4 `refresh()`. ✓
- Shared `renderResultList` extracted (Approach A) → Task 3. ✓
- `relatedTopK` (8) + reuse `graphMinScore` → Task 1 + Task 4. ✓
- `shouldRefresh` truth table → Task 2 tests. ✓
- Error handling (inline, no Notice; empty; no-file; non-md; unindexed) → Task 4 `refresh()` + Task 6 smoke. ✓
- Reuse `deriveNeighbors`/`resolveOpenTarget`/`DocPreviewModal`/`qmd:center-graph` → Tasks 3-4. ✓
- Acceptance criteria (tests green, build clean, panel behavior, search unchanged) → Tasks covered + Task 6. ✓

**Placeholder scan:** none — every code/command step is concrete.

**Type consistency:** `shouldRefresh(ActiveFileInfo, string|null, boolean): RefreshDecision` defined in Task 2, consumed identically in Task 4. `renderResultList(RenderResultListOptions)` defined in Task 3, called with the same shape in Tasks 3 + 4. `VIEW_TYPE_QMD_RELATED` defined in Task 4, imported in Task 5. `relatedTopK` added in Task 1, read in Task 4. Consistent.
