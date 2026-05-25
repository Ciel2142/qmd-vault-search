# Search Modes (Keyword / Hybrid toggle + as-you-type) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Keyword ⚡ / Hybrid 🧠 mode toggle to the qmd search panel — Keyword runs `lex`/BM25 live as you type (debounced, stale-guarded); Hybrid runs `lex+vec`+rerank on Enter (today's behavior) with an automatic keyword fallback on error/zero.

**Architecture:** Two pure, unit-tested, obsidian-free decision modules — `planQuery` (which `searches[]` to run for a given trigger+mode) and `decideFallback` (whether a hybrid result falls back to keyword) — drive a thin `SearchView` that owns DOM, a debounce timer, and a `searchId` stale-result guard. Mirrors the existing `related-refresh.ts` (pure) + untested-DOM-view split.

**Tech Stack:** TypeScript, Obsidian Plugin API 1.7.2, esbuild, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-25-phase-3-search-modes-design.md`

**Issue:** `obsidian_qmd_plugin-60g`. Supersedes `obsidian_qmd_plugin-b48` (debounce/cancel/stale-guard) + `obsidian_qmd_plugin-548` (BM25 fallback) — do NOT rework those standalone; they are folded into this feature.

**Conventions:**
- Commands: `npm test` (vitest run), `npm run build` (`tsc --noEmit` + esbuild), `npm run typecheck` (`tsc --noEmit`).
- Every commit message ends with the trailer line: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` (omitted from the snippets below for brevity — add it to each commit).
- Pure logic modules (`search-plan.ts`, `search-fallback.ts`) MUST NOT import `obsidian` (vitest runs them mock-free). `qmd-client.ts` is already obsidian-free, so importing the `QmdSubQuery` *type* from it is allowed.
- **Cancellation = stale-result guard only.** Obsidian `requestUrl` cannot be aborted; a `searchId` counter discards superseded responses. Never add an AbortController.

---

## File Structure

**Create:**
- `src/search-plan.ts` — pure `planQuery(trigger, mode, query): QueryPlan`. The sole mode/trigger branching. Unit-tested.
- `test/search-plan.test.ts` — truth-table tests for `planQuery`.
- `src/search-fallback.ts` — pure `decideFallback(outcome, opts): FallbackDecision`. Unit-tested.
- `test/search-fallback.test.ts` — truth-table tests for `decideFallback`.

**Modify:**
- `src/settings.ts` — add `searchMode`, `searchDebounceMs`, `fallbackOnFailure`, `fallbackOnZero` + defaults.
- `test/settings.test.ts` — assert the new defaults.
- `src/views/search-view.ts` — full rewrite of `onOpen`: mode toggle, debounce, `searchId` guard, fallback; add a `saveSettings` constructor arg.
- `src/main.ts:35` — pass `() => this.saveSettings()` to the `SearchView` constructor.
- `src/settings-tab.ts` — add a "Search debounce (ms)" control + two fallback toggles.
- `styles.css` — `.qmd-mode-toggle`, `.qmd-mode-btn` (+ `.is-active`), `.qmd-fallback-indicator`.

**No new dependencies. `result-list.ts`, `qmd-client.ts`, collection chips: unchanged.**

---

## Task 1: Settings — four new fields

**Files:**
- Modify: `test/settings.test.ts`
- Modify: `src/settings.ts:1-27`

- [ ] **Step 1: Write the failing test**

Add this `it` block inside `describe("settings", …)` in `test/settings.test.ts`, after the `relatedTopK` test (line 12):

```ts
  it("defaults search-mode fields", () => {
    expect(DEFAULT_SETTINGS.searchMode).toBe("hybrid");
    expect(DEFAULT_SETTINGS.searchDebounceMs).toBe(300);
    expect(DEFAULT_SETTINGS.fallbackOnFailure).toBe(true);
    expect(DEFAULT_SETTINGS.fallbackOnZero).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/settings.test.ts`
Expected: FAIL — `expected undefined to be "hybrid"`.

- [ ] **Step 3: Add the fields + defaults**

In `src/settings.ts`, add to the `QmdSettings` interface after `relatedTopK` (line 11):

```ts
  relatedTopK: number;            // related-notes panel neighbor count
  searchMode: "keyword" | "hybrid"; // search-panel mode (persisted toggle)
  searchDebounceMs: number;       // keyword as-you-type debounce
  fallbackOnFailure: boolean;     // hybrid errors → retry as keyword
  fallbackOnZero: boolean;        // hybrid 0 results → retry as keyword
  autoReindex: boolean;           // reindex vault on save
```

And add to `DEFAULT_SETTINGS` after `relatedTopK: 8,` (line 25):

```ts
  relatedTopK: 8,
  searchMode: "hybrid",
  searchDebounceMs: 300,
  fallbackOnFailure: true,
  fallbackOnZero: false,
  autoReindex: true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/settings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts test/settings.test.ts
git commit -m "feat: add search-mode + fallback settings"
```

---

## Task 2: `planQuery` pure module

**Files:**
- Create: `src/search-plan.ts`
- Test: `test/search-plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/search-plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planQuery } from "../src/search-plan";

describe("planQuery", () => {
  it("clears on empty query regardless of trigger/mode", () => {
    expect(planQuery("input", "keyword", "")).toEqual({ kind: "clear" });
    expect(planQuery("enter", "hybrid", "   ")).toEqual({ kind: "clear" });
  });

  it("runs lex-only in keyword mode (both triggers)", () => {
    expect(planQuery("input", "keyword", "foo")).toEqual({ kind: "run", searches: [{ type: "lex", query: "foo" }] });
    expect(planQuery("enter", "keyword", "foo")).toEqual({ kind: "run", searches: [{ type: "lex", query: "foo" }] });
  });

  it("does nothing on input in hybrid mode (waits for Enter)", () => {
    expect(planQuery("input", "hybrid", "foo")).toEqual({ kind: "none" });
  });

  it("runs lex+vec on Enter in hybrid mode", () => {
    expect(planQuery("enter", "hybrid", "foo")).toEqual({
      kind: "run",
      searches: [{ type: "lex", query: "foo" }, { type: "vec", query: "foo" }],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/search-plan.test.ts`
Expected: FAIL — cannot find module `../src/search-plan`.

- [ ] **Step 3: Write the implementation**

Create `src/search-plan.ts`:

```ts
import type { QmdSubQuery } from "./qmd-client";

export type SearchMode = "keyword" | "hybrid";
export type SearchTrigger = "input" | "enter";

export type QueryPlan =
  | { kind: "clear" }                          // empty query → empty the list
  | { kind: "none" }                           // nothing to do (hybrid waiting for Enter)
  | { kind: "run"; searches: QmdSubQuery[] };  // fire this query

/** The only mode/trigger branching for the search panel. Pure; no obsidian, no client. */
export function planQuery(trigger: SearchTrigger, mode: SearchMode, query: string): QueryPlan {
  if (query.trim() === "") return { kind: "clear" };
  if (mode === "keyword") return { kind: "run", searches: [{ type: "lex", query }] };
  // hybrid:
  if (trigger === "input") return { kind: "none" }; // wait for Enter
  return { kind: "run", searches: [{ type: "lex", query }, { type: "vec", query }] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/search-plan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/search-plan.ts test/search-plan.test.ts
git commit -m "feat: add planQuery search-mode decision module"
```

---

## Task 3: `decideFallback` pure module

**Files:**
- Create: `src/search-fallback.ts`
- Test: `test/search-fallback.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/search-fallback.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decideFallback } from "../src/search-fallback";

const opts = (failure: boolean, zero: boolean) => ({ fallbackOnFailure: failure, fallbackOnZero: zero });

describe("decideFallback", () => {
  it("falls back on error when fallbackOnFailure is on", () => {
    expect(decideFallback({ errored: true, resultCount: 0 }, opts(true, false))).toEqual({ fallback: true, reason: "failure" });
  });

  it("does not fall back on error when fallbackOnFailure is off", () => {
    expect(decideFallback({ errored: true, resultCount: 0 }, opts(false, false))).toEqual({ fallback: false, reason: null });
  });

  it("falls back on zero results when fallbackOnZero is on", () => {
    expect(decideFallback({ errored: false, resultCount: 0 }, opts(true, true))).toEqual({ fallback: true, reason: "zero" });
  });

  it("does not fall back on zero results when fallbackOnZero is off", () => {
    expect(decideFallback({ errored: false, resultCount: 0 }, opts(true, false))).toEqual({ fallback: false, reason: null });
  });

  it("does not fall back when there are results", () => {
    expect(decideFallback({ errored: false, resultCount: 5 }, opts(true, true))).toEqual({ fallback: false, reason: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/search-fallback.test.ts`
Expected: FAIL — cannot find module `../src/search-fallback`.

- [ ] **Step 3: Write the implementation**

Create `src/search-fallback.ts`:

```ts
export interface SearchOutcome { errored: boolean; resultCount: number }
export interface FallbackOpts { fallbackOnFailure: boolean; fallbackOnZero: boolean }
export type FallbackReason = "failure" | "zero";
export interface FallbackDecision { fallback: boolean; reason: FallbackReason | null }

/** Hybrid path only. Decides whether to re-run the query as keyword-only, and why. */
export function decideFallback(o: SearchOutcome, opts: FallbackOpts): FallbackDecision {
  if (o.errored) {
    return opts.fallbackOnFailure ? { fallback: true, reason: "failure" } : { fallback: false, reason: null };
  }
  if (o.resultCount === 0 && opts.fallbackOnZero) return { fallback: true, reason: "zero" };
  return { fallback: false, reason: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/search-fallback.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/search-fallback.ts test/search-fallback.test.ts
git commit -m "feat: add decideFallback hybrid→keyword decision module"
```

---

## Task 4: SearchView — toggle, debounce, stale-guard, fallback

This is the wiring task: rewrite `SearchView.onOpen` and add a `saveSettings` constructor arg. No `search-view` unit tests exist (DOM/Obsidian-heavy, consistent with the project); verify via build + the manual smoke in Task 7.

**Files:**
- Modify: `src/views/search-view.ts` (full file replace)
- Modify: `src/main.ts:35`

- [ ] **Step 1: Replace `src/views/search-view.ts` with:**

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { QmdClient } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { renderResultList } from "../result-list";
import { planQuery, type SearchMode, type SearchTrigger } from "../search-plan";
import { decideFallback } from "../search-fallback";

export const VIEW_TYPE_QMD_SEARCH = "qmd-search-view";

export class SearchView extends ItemView {
  private mode: SearchMode;
  private searchId = 0;
  private debounceTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private client: QmdClient,
    private settings: QmdSettings,
    private saveSettings: () => Promise<void>,
  ) {
    super(leaf);
    this.mode = settings.searchMode;
  }

  getViewType(): string { return VIEW_TYPE_QMD_SEARCH; }
  getDisplayText(): string { return "qmd Search"; }
  getIcon(): string { return "search"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("qmd-search-view");

    // Mode toggle ─────────────────────────────────────────────
    const toggle = root.createDiv({ cls: "qmd-mode-toggle" });
    const keywordBtn = toggle.createSpan({ cls: "qmd-mode-btn", text: "⚡ Keyword" });
    const hybridBtn = toggle.createSpan({ cls: "qmd-mode-btn", text: "🧠 Hybrid" });
    const renderToggle = (): void => {
      keywordBtn.toggleClass("is-active", this.mode === "keyword");
      hybridBtn.toggleClass("is-active", this.mode === "hybrid");
    };
    renderToggle();

    const input = root.createEl("input", { type: "text", placeholder: "Search vault + collections…" });
    input.addClass("qmd-search-input");

    // Collection chips (unchanged) ────────────────────────────
    const chips = root.createDiv({ cls: "qmd-chips" });
    const selected = new Set<string>([this.settings.vaultCollectionName]);
    const renderChips = (): void => {
      chips.empty();
      const all = [this.settings.vaultCollectionName, ...this.settings.externalCollections];
      for (const name of all) {
        const chip = chips.createSpan({ cls: "qmd-chip", text: name });
        if (selected.has(name)) chip.addClass("is-active");
        if (name === this.settings.vaultCollectionName) { chip.addClass("is-locked"); }
        else chip.onclick = (): void => { selected.has(name) ? selected.delete(name) : selected.add(name); renderChips(); };
      }
    };
    renderChips();

    const indicator = root.createDiv({ cls: "qmd-fallback-indicator" });
    indicator.hide();
    const list = root.createDiv({ cls: "qmd-results" });

    const showIndicator = (text: string): void => { indicator.setText(text); indicator.show(); };
    const clearIndicator = (): void => { indicator.empty(); indicator.hide(); };
    const render = (results: Parameters<typeof renderResultList>[0]["results"]): void => {
      renderResultList({ container: list, results, app: this.app, client: this.client, emptyText: "No results.", vaultCollectionName: this.settings.vaultCollectionName });
    };
    const renderError = (e: unknown): void => {
      list.empty();
      list.createDiv({ cls: "qmd-status", text: `Error: ${e instanceof Error ? e.message : String(e)}` });
    };

    // Keyword fallback re-run for the hybrid path ─────────────
    const runFallback = async (id: number, reason: "zero" | "failure"): Promise<void> => {
      try {
        const results = await this.client.query({ searches: [{ type: "lex", query: input.value }], collections: [...selected], rerank: false });
        if (id !== this.searchId) return;
        showIndicator(reason === "zero" ? "Keyword results — semantic search returned nothing." : "Keyword results — semantic search failed.");
        render(results);
      } catch (e) {
        if (id !== this.searchId) return;
        clearIndicator();
        renderError(e);
      }
    };

    // Single entry point for both triggers ────────────────────
    const execute = async (trigger: SearchTrigger): Promise<void> => {
      const plan = planQuery(trigger, this.mode, input.value);
      if (plan.kind === "none") return;
      if (plan.kind === "clear") { clearIndicator(); list.empty(); return; }

      const id = ++this.searchId;
      clearIndicator();
      list.empty();
      list.createDiv({ cls: "qmd-status", text: "Searching…" });
      const rerank = this.mode === "hybrid" ? this.settings.rerank : false;
      try {
        const results = await this.client.query({ searches: plan.searches, collections: [...selected], rerank });
        if (id !== this.searchId) return;
        if (this.mode === "hybrid") {
          const fb = decideFallback({ errored: false, resultCount: results.length }, this.settings);
          if (fb.fallback) { await runFallback(id, "zero"); return; }
        }
        render(results);
      } catch (e) {
        if (id !== this.searchId) return;
        if (this.mode === "hybrid") {
          const fb = decideFallback({ errored: true, resultCount: 0 }, this.settings);
          if (fb.fallback) { await runFallback(id, "failure"); return; }
        }
        renderError(e);
      }
    };

    const scheduleInput = (): void => {
      if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => { this.debounceTimer = null; void execute("input"); }, this.settings.searchDebounceMs);
    };

    const switchMode = async (next: SearchMode): Promise<void> => {
      if (this.mode === next) return;
      this.mode = next;
      this.settings.searchMode = next;
      renderToggle();
      await this.saveSettings();
      if (next === "keyword") void execute("input"); // go live immediately if text present
    };

    input.addEventListener("input", () => scheduleInput());
    input.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      if (this.debounceTimer !== null) { window.clearTimeout(this.debounceTimer); this.debounceTimer = null; }
      void execute("enter");
    });
    keywordBtn.onclick = (): void => { void switchMode("keyword"); };
    hybridBtn.onclick = (): void => { void switchMode("hybrid"); };
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.contentEl.empty();
  }
}
```

- [ ] **Step 2: Pass `saveSettings` from main.ts**

In `src/main.ts`, replace the `SearchView` registration line (line 35):

```ts
    this.registerView(VIEW_TYPE_QMD_SEARCH, (leaf: WorkspaceLeaf) => new SearchView(leaf, this.client, this.settings));
```

with:

```ts
    this.registerView(VIEW_TYPE_QMD_SEARCH, (leaf: WorkspaceLeaf) => new SearchView(leaf, this.client, this.settings, () => this.saveSettings()));
```

(Note: `saveSettings` re-creates `this.client`; harmless here because `/query` is sessionless. The view keeps its own `client` reference, which still queries fine.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: `tsc --noEmit` passes (no unused-import errors), esbuild writes `main.js`.

- [ ] **Step 4: Run the full test suite (no regressions)**

Run: `npm test`
Expected: all tests PASS (search has no unit tests; this confirms the pure modules + settings still pass and nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add src/views/search-view.ts src/main.ts
git commit -m "feat: Keyword/Hybrid search modes — as-you-type, stale-guard, fallback"
```

---

## Task 5: Settings-tab controls

**Files:**
- Modify: `src/settings-tab.ts:33` (insert after the "Related notes count" setting)

- [ ] **Step 1: Add the controls**

In `src/settings-tab.ts`, insert this block immediately after the "Related notes count" `new Setting(...)` (currently ending at line 33), before the "Detect collections" setting:

```ts
    new Setting(containerEl).setName("Search debounce (ms)").setDesc("Idle delay before the live keyword search fires as you type.")
      .addText((t) => t.setValue(String(this.plugin.settings.searchDebounceMs)).onChange(async (v) => { const n = parseInt(v, 10); if (!Number.isNaN(n)) { this.plugin.settings.searchDebounceMs = n; await this.plugin.saveSettings(); } }));

    new Setting(containerEl).setName("Fallback on semantic failure").setDesc("If a Hybrid search errors, retry as a keyword search.")
      .addToggle((t) => t.setValue(this.plugin.settings.fallbackOnFailure).onChange(async (v) => { this.plugin.settings.fallbackOnFailure = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Fallback on zero results").setDesc("If a Hybrid search returns nothing, retry as a keyword search.")
      .addToggle((t) => t.setValue(this.plugin.settings.fallbackOnZero).onChange(async (v) => { this.plugin.settings.fallbackOnZero = v; await this.plugin.saveSettings(); }));
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run build`
Expected: `tsc --noEmit` passes, esbuild writes `main.js`.

- [ ] **Step 3: Commit**

```bash
git add src/settings-tab.ts
git commit -m "feat: settings-tab controls for search debounce + fallbacks"
```

---

## Task 6: Styles

**Files:**
- Modify: `styles.css` (append)

- [ ] **Step 1: Append the toggle + indicator styles**

Append to `styles.css` (after line 13):

```css
.qmd-mode-toggle { display: flex; gap: 6px; margin-bottom: 8px; }
.qmd-mode-btn { font-size: 11px; padding: 2px 10px; border-radius: 10px; border: 1px solid var(--background-modifier-border); cursor: pointer; opacity: 0.5; user-select: none; }
.qmd-mode-btn.is-active { opacity: 1; border-color: var(--interactive-accent); color: var(--interactive-accent); }
.qmd-fallback-indicator { font-size: 11px; opacity: 0.7; margin-bottom: 6px; font-style: italic; }
```

- [ ] **Step 2: Build (sanity)**

Run: `npm run build`
Expected: `tsc --noEmit` passes, esbuild writes `main.js`.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "style: search mode toggle + fallback indicator"
```

---

## Task 7: Manual smoke verification

No code; verifies end-to-end against a real daemon. Requires a scratch vault with the qmd daemon running and the plugin built (`npm run build`) + loaded. (Cannot run headless — Obsidian is a Windows-native Electron app; see the deploy procedure memory.)

- [ ] **Step 1:** Reload Obsidian / re-enable the plugin. Open the qmd Search panel. A two-button toggle **⚡ Keyword | 🧠 Hybrid** shows above the input; **Hybrid** is active (default).
- [ ] **Step 2:** In **Hybrid** mode, type a query — nothing fires while typing. Press **Enter** → results appear (this is unchanged from before).
- [ ] **Step 3:** Click **⚡ Keyword**. Type a few characters → after ~300 ms a live result list appears, updating as you type. No Enter needed.
- [ ] **Step 4:** Type quickly, then delete back to a shorter query — the list never flashes an older, longer-query result (searchId stale-guard).
- [ ] **Step 5:** Clear the input entirely → the list empties.
- [ ] **Step 6:** Switch back to **🧠 Hybrid**, reload Obsidian → the panel reopens in the **last-used mode** (persistence). Switch to Keyword, reload → reopens in Keyword.
- [ ] **Step 7:** With `fallbackOnFailure` ON, stop the daemon (`qmd mcp stop`), Hybrid-search → an inline `Keyword results — semantic search failed.` indicator appears only if a keyword result set is reachable; if the daemon is fully down, an inline `Error: …` shows instead (both keyword + hybrid fail). Restart the daemon → recovers.
- [ ] **Step 8:** In settings, toggle `Fallback on zero results` ON; Hybrid-search a nonsense string with no hits → the indicator `Keyword results — semantic search returned nothing.` shows (or `No results.` if keyword is also empty).
- [ ] **Step 9:** Confirm vault/external row open + the `graph` link still work (renderResultList unchanged).

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Mode toggle in SearchView → Task 4 (toggle DOM + `switchMode`) + Task 6 (styles). ✓
- Keyword = `[lex]` live debounced → Task 2 (`planQuery`) + Task 4 (`scheduleInput`/`execute`). ✓
- Hybrid = `[lex,vec]`+rerank on Enter → Task 2 + Task 4 (`execute("enter")`, `rerank`). ✓
- Default `hybrid`, debounce 300, persist `searchMode` → Task 1 (defaults) + Task 4 (`switchMode` → `saveSettings`). ✓
- Stale-guard via `searchId` (no abort) → Task 4 (`++this.searchId` / mismatch returns). ✓
- Fallback on failure/zero + indicator → Task 3 (`decideFallback`) + Task 4 (`runFallback`). ✓
- Four settings + tab controls → Task 1 + Task 5. ✓
- Supersede b48 + 548 → recorded in header + issue `60g` (bd close already attempted; re-confirm at merge). ✓

**Placeholder scan:** none — every code/command step is concrete; `search-view.ts` is given in full.

**Type consistency:** `SearchMode`/`SearchTrigger`/`QueryPlan` defined in Task 2, imported + consumed identically in Task 4. `decideFallback(SearchOutcome, FallbackOpts)` from Task 3 is called in Task 4 with `this.settings` (structurally satisfies `FallbackOpts` via the Task 1 fields) and literal outcomes. `renderResultList` options shape matches `result-list.ts` (`container/results/app/client/emptyText/vaultCollectionName`). `SearchView` 4-arg constructor (Task 4) matches the `main.ts` call (Task 4 Step 2). Settings keys `searchMode`/`searchDebounceMs`/`fallbackOnFailure`/`fallbackOnZero` are identical across Tasks 1, 4, 5.
