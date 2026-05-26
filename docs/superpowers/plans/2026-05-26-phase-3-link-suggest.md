# Phase 3 #3 — Semantic `[[?` link suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing `[[?<text>` opens an `EditorSuggest` of semantically related **vault** notes (vec query over the vault collection); choosing one inserts a normal `[[wikilink]]`. Complements Obsidian's built-in `[[` filename suggester, which is left untouched.

**Architecture:** One new pure module `src/link-suggest.ts` holds both testable decisions — `parseLinkTrigger` (regex-detect the `[[?` sentinel) and `planLinkQuery` (vec-only, vault-collection-only query plan). One new view `src/views/link-suggest-view.ts` (`QmdLinkSuggest extends EditorSuggest<LinkSuggestion>`) wires those decisions to `QmdClient.query`, mirroring the search modal's debounce + `searchId` stale-guard, resolves each hit to a real vault `TFile` (dropping non-resolvers), and inserts via `app.fileManager.generateMarkdownLink`. `main.ts` registers the suggester once. No settings, CSS, or shared-module changes.

**Tech Stack:** TypeScript (strict, `isolatedModules`), Obsidian 1.7.2 API (`EditorSuggest`, `FileManager.generateMarkdownLink`), Vitest. Build: `tsc --noEmit` + esbuild → `main.js`.

**Spec:** `docs/superpowers/specs/2026-05-26-phase-3-link-suggest-design.md`
**Issue:** `obsidian_qmd_plugin-8yk` · **Branch:** `phase-3-link-suggest` (off `master`; already checked out).

**Commit convention:** end every commit message with a blank line then `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (shown via a second `-m` below).

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/link-suggest.ts` | Create | Pure `parseLinkTrigger(textBeforeCursor)` → `LinkTrigger \| null` + `planLinkQuery(query, settings)` → `LinkQueryPlan`. The only testable units (mock-free; MUST NOT import `obsidian`). |
| `test/link-suggest.test.ts` | Create | Unit tests for both functions (mock-free). |
| `src/views/link-suggest-view.ts` | Create | `QmdLinkSuggest extends EditorSuggest<LinkSuggestion>`. No unit test (needs the Obsidian runtime, absent from the test mock) — manual smoke in Task 4. Verified by the `tsc --noEmit` build gate. |
| `src/main.ts` | Modify | `this.registerEditorSuggest(new QmdLinkSuggest(this.app, this.client, this.settings));` + the import. |

**Task order:** **1** (pure module + tests) → **2** (view, needs Task 1's exports) → **3** (register, needs Task 2's export) → **4** (full verify + manual smoke + close issue). No `settings.ts` / `styles.css` changes (reuses `searchDebounceMs`, `vaultCollectionName`, and the `qmd-result-title` / `qmd-snippet` CSS classes).

---

## Task 1: `parseLinkTrigger` + `planLinkQuery` pure module

**Files:**
- Create: `src/link-suggest.ts`
- Test: `test/link-suggest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/link-suggest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseLinkTrigger, planLinkQuery } from "../src/link-suggest";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("parseLinkTrigger", () => {
  it("matches a fresh [[? at the line start", () => {
    expect(parseLinkTrigger("[[?neural")).toEqual({ query: "neural", startCh: 0 });
  });

  it("matches mid-line and reports the column of the opening [", () => {
    expect(parseLinkTrigger("foo [[?net")).toEqual({ query: "net", startCh: 4 });
  });

  it("matches an empty query right after [[?", () => {
    expect(parseLinkTrigger("[[?")).toEqual({ query: "", startCh: 0 });
  });

  it("does not match plain [[ (the built-in suggester owns it)", () => {
    expect(parseLinkTrigger("[[foo")).toBeNull();
  });

  it("does not match a closed [[?x]] with the cursor past the ]]", () => {
    expect(parseLinkTrigger("[[?x]]")).toBeNull();
  });

  it("does not match when the partial contains a bracket", () => {
    // The `[` is excluded from the partial, so `$` is never reached → no trigger.
    expect(parseLinkTrigger("[[?a[b")).toBeNull();
  });
});

describe("planLinkQuery", () => {
  const settings = { ...DEFAULT_SETTINGS, vaultCollectionName: "vault" };

  it("clears on an empty query", () => {
    expect(planLinkQuery("", settings)).toEqual({ kind: "clear" });
  });

  it("clears on a whitespace-only query", () => {
    expect(planLinkQuery("   ", settings)).toEqual({ kind: "clear" });
  });

  it("runs a vec-only query over the vault collection, rerank off", () => {
    expect(planLinkQuery("foo", settings)).toEqual({
      kind: "run",
      searches: [{ type: "vec", query: "foo" }],
      collections: ["vault"],
      rerank: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/link-suggest.test.ts`
Expected: FAIL — `Failed to resolve import "../src/link-suggest"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/link-suggest.ts`:

```ts
import type { QmdSubQuery } from "./qmd-client";
import type { QmdSettings } from "./settings";

export interface LinkTrigger {
  query: string;
  startCh: number;
}

/**
 * Detect the `[[?<partial>` semantic-link sentinel ending at the cursor.
 * Returns the partial query + the column of the opening `[`, or null when the
 * text before the cursor is not an open `[[?...`. Plain `[[` never matches, so
 * Obsidian's built-in link suggester is left untouched. The partial excludes
 * `[`/`]`, so a closed `[[?x]]` (cursor past the `]]`) also yields null.
 */
export function parseLinkTrigger(textBeforeCursor: string): LinkTrigger | null {
  const m = /\[\[\?([^\[\]]*)$/.exec(textBeforeCursor);
  if (!m) return null;
  return { query: m[1], startCh: m.index };
}

export type LinkQueryPlan =
  | { kind: "clear" }
  | { kind: "run"; searches: QmdSubQuery[]; collections: string[]; rerank: boolean };

/** Semantic link suggestions are always a vec query over the vault collection only. */
export function planLinkQuery(query: string, settings: QmdSettings): LinkQueryPlan {
  if (query.trim() === "") return { kind: "clear" };
  return {
    kind: "run",
    searches: [{ type: "vec", query }],
    collections: [settings.vaultCollectionName],
    rerank: false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/link-suggest.test.ts`
Expected: PASS — all 9 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/link-suggest.ts test/link-suggest.test.ts
git commit -m "feat: add parseLinkTrigger + planLinkQuery for [[? semantic links" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `QmdLinkSuggest` editor-suggest view

**Files:**
- Create: `src/views/link-suggest-view.ts`

No unit test — `EditorSuggest` needs the Obsidian runtime (absent from `test/__mocks__/obsidian.ts`), so this view is manual-smoke only (repo convention; same as `QmdSearchModal`). It is verified here by the `tsc --noEmit` build gate.

- [ ] **Step 1: Write the view**

Create `src/views/link-suggest-view.ts`:

```ts
import { App, EditorSuggest, TFile } from "obsidian";
import type { Editor, EditorPosition, EditorSuggestContext, EditorSuggestTriggerInfo } from "obsidian";
import type { QmdClient, QmdSearchResult, QmdSubQuery } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { parseLinkTrigger, planLinkQuery } from "../link-suggest";
import { makeVaultResolver } from "../vault-resolver";
import { cleanSnippet } from "../clean-snippet";

/** A qmd vault-collection hit plus the real vault TFile it resolved to. */
export interface LinkSuggestion {
  result: QmdSearchResult;
  file: TFile;
}

/**
 * Semantic `[[?` link suggester. Typing `[[?<text>` opens a vec-only suggester
 * over the vault collection; choosing a hit inserts a normal `[[wikilink]]`.
 * Complements Obsidian's built-in `[[` filename suggester (plain `[[` is untouched).
 * Long-lived (registered once); mirrors the search modal's debounce + searchId stale-guard.
 */
export class QmdLinkSuggest extends EditorSuggest<LinkSuggestion> {
  private searchId = 0;
  private debounceTimer: number | null = null;
  private pendingResolve: ((results: LinkSuggestion[]) => void) | null = null;

  constructor(app: App, private client: QmdClient, private settings: QmdSettings) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const t = parseLinkTrigger(before);
    if (!t) return null;
    return { start: { line: cursor.line, ch: t.startCh }, end: cursor, query: t.query };
  }

  getSuggestions(context: EditorSuggestContext): Promise<LinkSuggestion[]> {
    // Supersede any pending debounce: clear its timer and resolve its promise empty so nothing dangles.
    if (this.debounceTimer !== null) { window.clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    if (this.pendingResolve) { this.pendingResolve([]); this.pendingResolve = null; }
    const plan = planLinkQuery(context.query, this.settings);
    if (plan.kind !== "run") return Promise.resolve([]);
    const { searches, collections, rerank } = plan;
    return new Promise<LinkSuggestion[]>((resolve) => {
      this.pendingResolve = resolve;
      this.debounceTimer = window.setTimeout(() => {
        this.debounceTimer = null;
        this.pendingResolve = null;
        void this.run(searches, collections, rerank, resolve);
      }, this.settings.searchDebounceMs);
    });
  }

  private async run(searches: QmdSubQuery[], collections: string[], rerank: boolean, resolve: (results: LinkSuggestion[]) => void): Promise<void> {
    const id = ++this.searchId;
    // Fresh resolver per settled query: the suggester is long-lived and the vault mutates while editing.
    const resolveVaultPath = makeVaultResolver(this.app);
    try {
      const results = await this.client.query({ searches, collections, rerank });
      if (id !== this.searchId) { resolve([]); return; } // superseded
      const out: LinkSuggestion[] = [];
      for (const result of results) {
        const vaultPath = resolveVaultPath(result.file);
        if (!vaultPath) continue; // hit is not a vault file → not [[-linkable, drop it
        const file = this.app.vault.getAbstractFileByPath(vaultPath);
        if (file instanceof TFile) out.push({ result, file });
      }
      resolve(out);
    } catch {
      // Superseded, daemon down, or query error → no popup, no crash.
      resolve([]);
    }
  }

  renderSuggestion(s: LinkSuggestion, el: HTMLElement): void {
    el.createDiv({ cls: "qmd-result-title", text: s.result.title || s.file.basename });
    el.createDiv({ cls: "qmd-snippet", text: cleanSnippet(s.result.snippet) });
  }

  selectSuggestion(s: LinkSuggestion, _evt: MouseEvent | KeyboardEvent): void {
    const ctx = this.context;
    if (!ctx) return;
    const link = this.app.fileManager.generateMarkdownLink(s.file, ctx.file?.path ?? "");
    ctx.editor.replaceRange(link, ctx.start, ctx.end);
  }
}
```

Notes for the implementer:
- The obsidian import is split (value imports `App, EditorSuggest, TFile`; `import type` for the interfaces `Editor, EditorPosition, EditorSuggestContext, EditorSuggestTriggerInfo`) to keep `isolatedModules` happy — same convention as `src/views/search-modal.ts`.
- `getSuggestions` returns a `Promise`, satisfying the abstract `getSuggestions(context): T[] | Promise<T[]>`.
- The single `catch` resolving `[]` is intentional and covers both supersession and a down daemon (unlike the modal there is no empty-state text to set on an `EditorSuggest`).

- [ ] **Step 2: Verify it compiles + bundles (and existing tests stay green)**

Run: `npm test && npm run build`
Expected: PASS — all unit tests green (Task 1's added; nothing else changed), `tsc --noEmit` clean (the view type-checks against the real Obsidian API), `main.js` rebuilt.

- [ ] **Step 3: Commit**

```bash
git add src/views/link-suggest-view.ts
git commit -m "feat: add QmdLinkSuggest EditorSuggest for [[? semantic links" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Register the suggester in `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add the import**

In `src/main.ts`, immediately after the existing line:

```ts
import { QmdSearchModal } from "./views/search-modal";
```

add:

```ts
import { QmdLinkSuggest } from "./views/link-suggest-view";
```

- [ ] **Step 2: Register the suggester**

In `onload()`, immediately after the existing modal-command registration line:

```ts
    this.addCommand({ id: "open-qmd-search-modal", name: "Search qmd (modal)", callback: () => new QmdSearchModal(this.app, this.client, this.settings).open() });
```

add:

```ts
    // Semantic [[? link suggester. Passes current client/settings, same as the search surfaces;
    // the daemon URL is only re-read on a settings change after a reload (matches the views' behavior).
    this.registerEditorSuggest(new QmdLinkSuggest(this.app, this.client, this.settings));
```

- [ ] **Step 3: Verify build green**

Run: `npm run build`
Expected: PASS — `tsc --noEmit` clean; `main.js` rebuilt with the registration.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: register QmdLinkSuggest editor suggester" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full verification + manual smoke + close issue

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck + build green**

Run: `npm test && npm run build`
Expected: PASS — every unit suite green, `tsc --noEmit` clean, `main.js` rebuilt.

- [ ] **Step 2: Deploy the build to the smoke vault**

Copy the 3 artifacts into the vault plugin dir (Windows-native qmd daemon on `[::1]:8181`; see memory `smoke-test-deploy-procedure`):

```bash
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/qmd-search/"
```

Then reload Obsidian (or toggle the plugin off/on). Open any markdown note in editing (Live Preview or Source) mode.

- [ ] **Step 3: Manual smoke checklist (in Obsidian)**

Verify each acceptance criterion. **The first check is the known risk — do it first:**

- [ ] **Trigger contention (KNOWN RISK):** typing `[[?` + text shows the **qmd** suggester (vault notes with clean snippets), *not* Obsidian's built-in filename suggester. If the built-in suggester wins or fights ours, STOP — record it and see "If the built-in suggester wins" below.
- [ ] **Plain `[[` untouched:** typing plain `[[` (no `?`) still shows Obsidian's built-in filename suggester.
- [ ] **Semantic results:** suggestions are vec/semantic hits from the **vault collection only**, debounced (~`searchDebounceMs`), each rendered with a title + clean snippet (no `@@` / line-number noise), no vault/external badge.
- [ ] **Insertion:** choosing a suggestion replaces the whole `[[?partial` span with a proper link via `generateMarkdownLink` — no stray `?`, no doubled brackets, respecting the user's link settings (wikilink vs markdown / shortest / relative).
- [ ] **Daemon down:** stop the qmd daemon → typing `[[?text` shows no popup and does not crash the editor (check the dev console for uncaught errors).
- [ ] **Stale guard:** rapid typing never flashes an earlier query's hits over a later one's.

- [ ] **Step 4: Close the issue**

If the smoke passed:

```bash
bd close obsidian_qmd_plugin-8yk --reason="Semantic [[? link-suggest shipped: parseLinkTrigger + planLinkQuery (vec-only, vault-collection-only) + QmdLinkSuggest EditorSuggest (debounce + searchId stale-guard, resolve-to-TFile, generateMarkdownLink insert); registered in main.ts; unit tests green; manual smoke passed (our popup wins over built-in [[)."
```

**If the built-in suggester wins (fallback path, per spec "Known risk"):** do NOT close the issue. The fallback is a non-`[[` trigger character (e.g. a dedicated prefix). That changes only `parseLinkTrigger`'s regex and its tests (Task 1) — `planLinkQuery`, the view, and the registration are unaffected. Update the regex + the Task 1 test cases for the new sentinel, re-run Tasks 1–2 build/test, then redo this smoke. Record the decision in the issue notes (`bd update obsidian_qmd_plugin-8yk --notes="..."`).

---

## Self-review notes (author)

- **Spec coverage:** `EditorSuggest`-only scope (Task 2) · `[[?` trigger via `parseLinkTrigger` (Task 1) · vec-only + rerank-off + vault-collection-only via `planLinkQuery` (Task 1) · debounce + `searchId` stale-guard + fresh per-query resolver + drop-non-resolving + `[]`-on-error (Task 2 `run`) · `onTrigger` lifecycle (Task 2) · `renderSuggestion` title-or-basename + clean snippet, no badge (Task 2) · `selectSuggestion` `generateMarkdownLink` + `replaceRange` (Task 2) · register with live `client`/`settings` (Task 3) · unit tests for both pure functions + manual smoke for the view (Tasks 1 & 4) · no settings/CSS changes (absent from the file list) · the built-in-`[[`-contention risk is the first smoke check with a written fallback (Task 4). Every spec section maps to a task; all six acceptance criteria are covered by the Task 4 checklist.
- **Type consistency:** `LinkTrigger { query, startCh }` (Task 1) is consumed as `t.query` / `t.startCh` in `onTrigger` (Task 2). `LinkQueryPlan` (Task 1) is narrowed in `getSuggestions` (Task 2). `planLinkQuery(query, settings)` and `parseLinkTrigger(textBeforeCursor)` signatures (Task 1) match their call sites (Task 2). `LinkSuggestion { result, file }` (Task 2) is the `EditorSuggest` generic and the `renderSuggestion` / `selectSuggestion` / `getSuggestions` value type throughout. `QmdSubQuery` / `QmdSearchResult` / `QmdClient` / `QmdSettings` are imported as types and used exactly as in `src/views/search-modal.ts`. Obsidian API signatures (`onTrigger`, `getSuggestions`, `renderSuggestion`, `selectSuggestion`, `registerEditorSuggest`, `generateMarkdownLink`) were verified against `node_modules/obsidian/obsidian.d.ts` (1.7.2).
- **No placeholders:** every code step contains the full file/edit; every run step has an exact command + expected outcome.
