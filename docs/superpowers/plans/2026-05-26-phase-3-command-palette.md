# Phase 3 #1 — Command-palette modal search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a keyboard-driven `SuggestModal` search surface that queries qmd as-you-type and opens the chosen result like the side panel does.

**Architecture:** A new `QmdSearchModal extends SuggestModal<QmdSearchResult>` reuses the existing pure decision modules. A new pure helper `planModalSearch` composes `planQuery("enter", mode, …)` (forcing hybrid to emit `[lex,vec]` live) + the rerank rule + the all-collections list. The modal's open logic is the panel's open logic, extracted to a shared `openResolvedTarget`. The just-merged `SearchView` is not touched.

**Tech Stack:** TypeScript (strict), Obsidian 1.7.2 API (`SuggestModal`), Vitest. Build: `tsc --noEmit` + esbuild → `main.js`.

**Spec:** `docs/superpowers/specs/2026-05-26-phase-3-command-palette-design.md`
**Issue:** `obsidian_qmd_plugin-2mp` · **Branch:** `fix-snippet-rendering` (this feature depends on its `cleanSnippet` + `result-list.ts` state, which are not yet on `master`).

**Commit convention:** end every commit message with a blank line then `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (shown via a second `-m` below).

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/modal-query.ts` | Create | Pure `planModalSearch(mode, query, settings)` → `ModalSearchPlan`. Sole testable orchestration unit. |
| `test/modal-query.test.ts` | Create | Unit tests for `planModalSearch` (mock-free). |
| `src/open-action.ts` | Create | `openResolvedTarget(app, client, target)` — open logic lifted from `result-list.ts`. |
| `test/open-action.test.ts` | Create | Unit tests: vault branch calls `openLinkText`; external branch does not. |
| `src/result-list.ts` | Modify | Import + call `openResolvedTarget`; delete the private `openTarget`. No behavior change. |
| `src/views/search-modal.ts` | Create | `QmdSearchModal` view. No unit test (needs Obsidian runtime) — manual smoke in Task 5. |
| `src/main.ts` | Modify | Register the `open-qmd-search-modal` command. |

Task order: **1** (`planModalSearch`) and **2** (`openResolvedTarget`) are independent; **3** (view) needs both; **4** (command) needs 3; **5** verifies + manual smoke + closes the issue.

---

## Task 1: `planModalSearch` pure helper

**Files:**
- Create: `src/modal-query.ts`
- Test: `test/modal-query.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/modal-query.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planModalSearch } from "../src/modal-query";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("planModalSearch", () => {
  const settings = { ...DEFAULT_SETTINGS, vaultCollectionName: "vault", externalCollections: ["docs"], rerank: true };

  it("clears on an empty / whitespace query", () => {
    expect(planModalSearch("hybrid", "   ", settings)).toEqual({ kind: "clear" });
  });

  it("keyword mode: lex only, rerank off, across all collections", () => {
    expect(planModalSearch("keyword", "foo", settings)).toEqual({
      kind: "run",
      searches: [{ type: "lex", query: "foo" }],
      rerank: false,
      collections: ["vault", "docs"],
    });
  });

  it("hybrid mode: lex+vec live, rerank from settings, all collections", () => {
    expect(planModalSearch("hybrid", "foo", settings)).toEqual({
      kind: "run",
      searches: [{ type: "lex", query: "foo" }, { type: "vec", query: "foo" }],
      rerank: true,
      collections: ["vault", "docs"],
    });
  });

  it("hybrid mode honours rerank:false from settings", () => {
    const plan = planModalSearch("hybrid", "foo", { ...settings, rerank: false });
    expect(plan.kind === "run" && plan.rerank).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/modal-query.test.ts`
Expected: FAIL — cannot resolve `../src/modal-query` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/modal-query.ts`:

```ts
import { planQuery, type SearchMode } from "./search-plan";
import type { QmdSubQuery } from "./qmd-client";
import type { QmdSettings } from "./settings";

export type ModalSearchPlan =
  | { kind: "clear" }
  | { kind: "run"; searches: QmdSubQuery[]; rerank: boolean; collections: string[] };

/**
 * The modal's single query decision. Forces trigger "enter" so hybrid emits
 * [lex,vec] live (a SuggestModal has no free Enter — Enter chooses a result).
 * rerank mirrors the panel: only hybrid reranks, and only per settings.rerank.
 */
export function planModalSearch(mode: SearchMode, query: string, settings: QmdSettings): ModalSearchPlan {
  const plan = planQuery("enter", mode, query);
  if (plan.kind !== "run") return { kind: "clear" };
  return {
    kind: "run",
    searches: plan.searches,
    rerank: mode === "hybrid" ? settings.rerank : false,
    collections: [settings.vaultCollectionName, ...settings.externalCollections],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/modal-query.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modal-query.ts test/modal-query.test.ts
git commit -m "feat: add planModalSearch query decision for command-palette modal" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extract `openResolvedTarget` (shared open action)

**Files:**
- Create: `src/open-action.ts`
- Test: `test/open-action.test.ts`
- Modify: `src/result-list.ts` (line 1-5 imports, line 39 call, delete lines 43-50)

- [ ] **Step 1: Write the failing test**

Create `test/open-action.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

// The external branch dynamically imports doc-preview (which imports obsidian's
// Component, absent from the test mock); stub it so only branch selection is tested.
vi.mock("../src/views/doc-preview", () => ({
  DocPreviewModal: class {
    open = vi.fn();
    constructor(public app?: unknown, public client?: unknown, public docid?: string) {}
  },
}));

import { openResolvedTarget } from "../src/open-action";

type App = Parameters<typeof openResolvedTarget>[0];
type Client = Parameters<typeof openResolvedTarget>[1];

describe("openResolvedTarget", () => {
  it("opens a vault target via workspace.openLinkText", async () => {
    const openLinkText = vi.fn();
    const app = { workspace: { openLinkText } } as unknown as App;
    await openResolvedTarget(app, {} as Client, { kind: "vault", path: "notes/x.md" });
    expect(openLinkText).toHaveBeenCalledWith("notes/x.md", "", false);
  });

  it("does not open a vault link for an external target", async () => {
    const openLinkText = vi.fn();
    const app = { workspace: { openLinkText } } as unknown as App;
    await openResolvedTarget(app, {} as Client, { kind: "external", file: "docs/y.md", docid: "#b2" });
    expect(openLinkText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/open-action.test.ts`
Expected: FAIL — cannot resolve `../src/open-action` (module does not exist yet).

- [ ] **Step 3: Create the implementation**

Create `src/open-action.ts` (the body is lifted verbatim from `result-list.ts`'s private `openTarget`):

```ts
import { App } from "obsidian";
import type { QmdClient } from "./qmd-client";
import type { OpenTarget } from "./open-target";

/** Open a resolved qmd target: vault notes in the workspace, external docs in a read-only preview modal. Shared by the result list and the search modal. */
export async function openResolvedTarget(app: App, client: QmdClient, target: OpenTarget): Promise<void> {
  if (target.kind === "vault") {
    await app.workspace.openLinkText(target.path, "", false);
  } else {
    const { DocPreviewModal } = await import("./views/doc-preview");
    new DocPreviewModal(app, client, target.docid).open();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/open-action.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Point `result-list.ts` at the shared function**

In `src/result-list.ts`:

1. Change the import on line 3 from:
```ts
import { resolveOpenTarget, type OpenTarget } from "./open-target";
```
to (drop the now-unused `OpenTarget`):
```ts
import { resolveOpenTarget } from "./open-target";
```

2. Add this import after line 5 (`import { cleanSnippet } from "./clean-snippet";`):
```ts
import { openResolvedTarget } from "./open-action";
```

3. Change the row click handler (line 39) from:
```ts
    row.onclick = (): void => { void openTarget(app, client, target); };
```
to:
```ts
    row.onclick = (): void => { void openResolvedTarget(app, client, target); };
```

4. Delete the now-dead private function (current lines 43-50):
```ts
async function openTarget(app: App, client: QmdClient, target: OpenTarget): Promise<void> {
  if (target.kind === "vault") {
    await app.workspace.openLinkText(target.path, "", false);
  } else {
    const { DocPreviewModal } = await import("./views/doc-preview");
    new DocPreviewModal(app, client, target.docid).open();
  }
}
```

- [ ] **Step 6: Verify the whole suite + typecheck still pass**

Run: `npm test && npm run typecheck`
Expected: PASS — all existing tests + the 2 new ones green; `tsc --noEmit` reports no errors (`App` and `QmdClient` imports in `result-list.ts` are still used by `RenderResultListOptions`; `OpenTarget` is no longer referenced there).

- [ ] **Step 7: Commit**

```bash
git add src/open-action.ts test/open-action.test.ts src/result-list.ts
git commit -m "refactor: extract openResolvedTarget into a shared open-action module" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `QmdSearchModal` view

**Files:**
- Create: `src/views/search-modal.ts`

No unit test: `SuggestModal` requires the Obsidian runtime and is absent from the test mock (matches the repo convention — `SearchView`/`RelatedNotesView` are untested). Behavior is verified by manual smoke in Task 5. The query *decision* is already covered by Task 1.

- [ ] **Step 1: Create the view**

Create `src/views/search-modal.ts`:

```ts
import { App, SuggestModal } from "obsidian";
import type { QmdClient, QmdSearchResult } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { planModalSearch } from "../modal-query";
import { decideFallback } from "../search-fallback";
import { resolveOpenTarget } from "../open-target";
import { makeVaultResolver } from "../vault-resolver";
import { cleanSnippet } from "../clean-snippet";
import { openResolvedTarget } from "../open-action";

/** Keyboard-driven palette search. Queries qmd as-you-type (debounced, stale-guarded) and opens the chosen result like the side panel. */
export class QmdSearchModal extends SuggestModal<QmdSearchResult> {
  private searchId = 0;
  private debounceTimer: number | null = null;
  private pendingResolve: ((results: QmdSearchResult[]) => void) | null = null;

  constructor(app: App, private client: QmdClient, private settings: QmdSettings) {
    super(app);
    this.setPlaceholder("Search qmd — vault + collections…");
    this.emptyStateText = "No results.";
  }

  getSuggestions(query: string): Promise<QmdSearchResult[]> {
    // Supersede any pending debounce: clear its timer and resolve its promise empty so nothing dangles.
    if (this.debounceTimer !== null) { window.clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    if (this.pendingResolve) { this.pendingResolve([]); this.pendingResolve = null; }
    if (query.trim() === "") return Promise.resolve([]);

    return new Promise<QmdSearchResult[]>((resolve) => {
      this.pendingResolve = resolve;
      this.debounceTimer = window.setTimeout(() => {
        this.debounceTimer = null;
        this.pendingResolve = null;
        void this.run(query, resolve);
      }, this.settings.searchDebounceMs);
    });
  }

  private async run(query: string, resolve: (results: QmdSearchResult[]) => void): Promise<void> {
    const id = ++this.searchId;
    const mode = this.settings.searchMode;
    const plan = planModalSearch(mode, query, this.settings);
    if (plan.kind !== "run") { resolve([]); return; }
    try {
      const results = await this.client.query({ searches: plan.searches, collections: plan.collections, rerank: plan.rerank });
      if (id !== this.searchId) { resolve([]); return; } // superseded
      if (mode === "hybrid" && decideFallback({ errored: false, resultCount: results.length }, this.settings).fallback) {
        resolve(await this.runFallback(query, plan.collections, id));
        return;
      }
      this.emptyStateText = "No results.";
      resolve(results);
    } catch (e) {
      if (id !== this.searchId) { resolve([]); return; }
      if (mode === "hybrid" && decideFallback({ errored: true, resultCount: 0 }, this.settings).fallback) {
        resolve(await this.runFallback(query, plan.collections, id));
        return;
      }
      this.emptyStateText = `Error: ${e instanceof Error ? e.message : String(e)}`;
      resolve([]);
    }
  }

  private async runFallback(query: string, collections: string[], id: number): Promise<QmdSearchResult[]> {
    try {
      const results = await this.client.query({ searches: [{ type: "lex", query }], collections, rerank: false });
      if (id !== this.searchId) return [];
      this.emptyStateText = "No results.";
      return results;
    } catch (e) {
      if (id !== this.searchId) return [];
      this.emptyStateText = `Error: ${e instanceof Error ? e.message : String(e)}`;
      return [];
    }
  }

  renderSuggestion(result: QmdSearchResult, el: HTMLElement): void {
    const target = resolveOpenTarget(result.file, result.docid, makeVaultResolver(this.app), this.settings.vaultCollectionName);
    el.createDiv({ cls: "qmd-result-title", text: result.title || result.file });
    const meta = el.createDiv({ cls: "qmd-result-meta" });
    meta.createSpan({ cls: `qmd-badge ${target.kind}`, text: target.kind === "vault" ? "vault" : "external" });
    el.createDiv({ cls: "qmd-snippet", text: cleanSnippet(result.snippet) });
  }

  onChooseSuggestion(result: QmdSearchResult): void {
    const target = resolveOpenTarget(result.file, result.docid, makeVaultResolver(this.app), this.settings.vaultCollectionName);
    void openResolvedTarget(this.app, this.client, target);
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS — `tsc --noEmit` reports no errors. (`SuggestModal<QmdSearchResult>` is generic over the result type; `getSuggestions` returning `Promise<QmdSearchResult[]>` and the one-arg `onChooseSuggestion` override both satisfy the abstract signatures.)

- [ ] **Step 3: Commit**

```bash
git add src/views/search-modal.ts
git commit -m "feat: add QmdSearchModal command-palette search surface" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Register the command

**Files:**
- Modify: `src/main.ts` (import near lines 9-11; `addCommand` near line 37)

- [ ] **Step 1: Add the import**

In `src/main.ts`, after line 11 (`import { RelatedNotesView, VIEW_TYPE_QMD_RELATED } from "./views/related-notes-view";`), add:

```ts
import { QmdSearchModal } from "./views/search-modal";
```

- [ ] **Step 2: Register the command**

In `src/main.ts`, immediately after line 37 (`this.addCommand({ id: "open-qmd-search", name: "Open qmd search panel", callback: () => this.activateSearchView() });`), add:

```ts
    this.addCommand({ id: "open-qmd-search-modal", name: "Search qmd (modal)", callback: () => new QmdSearchModal(this.app, this.client, this.settings).open() });
```

(`this.client` is read when the command fires, so it always picks up the latest client rebuilt on settings save; `this.settings` is the live mutated reference, so the modal sees current `searchMode` / `searchDebounceMs`.) No default hotkey — the user binds it under Settings → Hotkeys.

- [ ] **Step 3: Verify typecheck + production build**

Run: `npm run build`
Expected: PASS — `tsc --noEmit` clean, esbuild writes `main.js` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: register 'Search qmd (modal)' command (no default hotkey)" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full verification + manual smoke + close issue

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck + build green**

Run: `npm test && npm run build`
Expected: PASS — all unit tests pass; `tsc --noEmit` clean; `main.js` rebuilt.

- [ ] **Step 2: Deploy the build to the smoke vault**

Copy the 3 artifacts into the vault plugin dir (Windows-native qmd daemon on `[::1]:8181`; see memory `smoke-test-deploy-procedure`):

```bash
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/qmd-search/"
```

Then reload Obsidian (or toggle the plugin off/on).

- [ ] **Step 3: Manual smoke checklist (in Obsidian)**

Bind a hotkey to **"Search qmd (modal)"** (Settings → Hotkeys), then verify each acceptance criterion:

- [ ] Command appears in the command palette and opens the modal.
- [ ] Typing shows debounced results from **vault + external** collections, each with a vault/external badge + a clean snippet (no `@@`/line-number noise).
- [ ] With `searchMode = keyword`: results are lex/BM25 (instant, no rerank).
- [ ] With `searchMode = hybrid`: results are lex+vec and reorder after a typing pause (rerank), per `settings.rerank`.
- [ ] Hybrid fallback: with the daemon returning nothing/erroring, hybrid falls back to keyword per `fallbackOnZero` / `fallbackOnFailure`.
- [ ] Choosing a **vault** result opens that note in the workspace.
- [ ] Choosing an **external** result opens the `DocPreviewModal`.
- [ ] Rapid typing never flashes an earlier query's results over a later one's.
- [ ] Stop the daemon → typing shows an `Error: …` empty-state; the modal stays usable, no crash (check the dev console for uncaught errors).

- [ ] **Step 4: Close the issue**

```bash
bd close obsidian_qmd_plugin-2mp --reason="Command-palette modal search shipped: planModalSearch + QmdSearchModal + shared openResolvedTarget; reuses planQuery/decideFallback/searchMode; all collections; manual smoke passed."
```

---

## Self-review notes (author)

- **Spec coverage:** surface (Task 3) · reuse `settings.searchMode` (Task 1/3) · hybrid live rerank via `planQuery("enter")` (Task 1) · all-collections (Task 1) · debounce + `searchId` stale-guard (Task 3) · `decideFallback` parity (Task 3) · no default hotkey (Task 4) · extracted `openResolvedTarget` (Task 2) · tests for the two pure units + manual smoke (Tasks 1/2/5) · no CSS/settings changes (none in file list). All spec sections map to a task.
- **Type consistency:** `ModalSearchPlan` / `planModalSearch` (Task 1) consumed unchanged in Task 3; `openResolvedTarget(app, client, target)` defined in Task 2, called identically in Task 2 (`result-list.ts`) and Task 3. `QmdSearchResult` is the `SuggestModal` generic throughout. `decideFallback({errored,resultCount}, settings)` matches `src/views/search-view.ts:106`.
- **No placeholders:** every code step contains full code; every run step has an exact command + expected outcome.
