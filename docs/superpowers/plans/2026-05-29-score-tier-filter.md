# HIGH/MED/LOW Relevance Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-file HIGH/MED/LOW relevance badge and a server-side minimum-relevance filter to the search panel, mirroring qmd's score coloring — active in hybrid+rerank mode only.

**Architecture:** A new pure `score-tier` unit owns the thresholds (qmd parity: ≥0.7 HIGH, ≥0.4 MED, else LOW), the min-score floors, labels, and the "tiers active" predicate. `group-results` stops dropping the `score` and exposes a per-group `topScore`. The grouped renderer paints a badge from that. `SearchView` adds a `Min relevance` control that passes a `minScore` floor to qmd and re-queries on change, suppressing the keyword fallback when a filter hides everything.

**Tech Stack:** TypeScript, Obsidian plugin API, Vitest. Build: `npm run build`. Test: `npm test`.

Spec: `docs/superpowers/specs/2026-05-29-score-tier-filter-design.md`.

---

## File Structure

- **Create** `src/score-tier.ts` — pure tier model (type, `scoreTier`, `tierFloor`, `tierLabel`, `tierEmptyText`, `tiersActive`, `TIERS`).
- **Create** `test/score-tier.test.ts` — unit tests for the above.
- **Modify** `src/group-results.ts` — add `score` to `ResultMatch`, `topScore` to `FileGroup`.
- **Modify** `test/group-results.test.ts` — assert score threading + `topScore`.
- **Modify** `src/grouped-result-list.ts` — `showTiers` option + header badge.
- **Modify** `src/settings.ts` — `searchMinTier` field + default.
- **Modify** `src/views/search-view.ts` — tier control, `minScore`, re-query, fallback suppression, `showTiers`, empty text.
- **Modify** `styles.css` — badge + control styles.

No automated tests for `grouped-result-list.ts` / `search-view.ts` (Obsidian `ItemView` + DOM); their logic lives in the pure units that ARE tested, and Task 8 is a manual smoke. Run single test file with `npx vitest run <path>`.

---

### Task 1: Pure tier model (`score-tier.ts`)

**Files:**
- Create: `src/score-tier.ts`
- Test: `test/score-tier.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/score-tier.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scoreTier, tierFloor, tierLabel, tierEmptyText, tiersActive, TIERS } from "../src/score-tier";

describe("scoreTier", () => {
  it("buckets at qmd thresholds (>=0.7 high, >=0.4 med, else low)", () => {
    expect(scoreTier(1)).toBe("high");
    expect(scoreTier(0.7)).toBe("high");
    expect(scoreTier(0.699)).toBe("med");
    expect(scoreTier(0.4)).toBe("med");
    expect(scoreTier(0.399)).toBe("low");
    expect(scoreTier(0)).toBe("low");
  });
});

describe("tierFloor", () => {
  it("maps a tier to the qmd minScore floor (low = no filter)", () => {
    expect(tierFloor("high")).toBe(0.7);
    expect(tierFloor("med")).toBe(0.4);
    expect(tierFloor("low")).toBe(0);
  });
});

describe("tierLabel", () => {
  it("uppercases the tier", () => {
    expect(tierLabel("high")).toBe("HIGH");
    expect(tierLabel("med")).toBe("MED");
    expect(tierLabel("low")).toBe("LOW");
  });
});

describe("tierEmptyText", () => {
  it("suggests lower tiers (only high/med ever filter to empty)", () => {
    expect(tierEmptyText("high")).toBe("No HIGH-relevance results — try MED or LOW.");
    expect(tierEmptyText("med")).toBe("No MED-relevance results — try LOW.");
  });
});

describe("tiersActive", () => {
  it("is true only for hybrid + rerank (reranked scores are 0-1)", () => {
    expect(tiersActive("hybrid", true)).toBe(true);
    expect(tiersActive("hybrid", false)).toBe(false);
    expect(tiersActive("keyword", true)).toBe(false);
    expect(tiersActive("keyword", false)).toBe(false);
  });
});

describe("TIERS", () => {
  it("lists tiers high→low for the control order", () => {
    expect(TIERS).toEqual(["high", "med", "low"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/score-tier.test.ts`
Expected: FAIL — cannot find module `../src/score-tier`.

- [ ] **Step 3: Write minimal implementation**

Create `src/score-tier.ts`:

```ts
import type { SearchMode } from "./search-plan";

export type ScoreTier = "high" | "med" | "low";

/** Control order, highest floor first. */
export const TIERS: ScoreTier[] = ["high", "med", "low"];

/** qmd CLI parity: green > 0.7 (HIGH), yellow > 0.4 (MED), dim otherwise (LOW). Uses >= at the boundary. */
export function scoreTier(score: number): ScoreTier {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "med";
  return "low";
}

/** Minimum-score floor for a tier, passed to qmd's `minScore`. "low" = 0 = no filtering. */
export function tierFloor(tier: ScoreTier): number {
  if (tier === "high") return 0.7;
  if (tier === "med") return 0.4;
  return 0;
}

/** Uppercase label for the badge / control button. */
export function tierLabel(tier: ScoreTier): string {
  return tier.toUpperCase();
}

/** Empty-state message when a min-tier filter hides everything. Only "high"/"med" filter to empty. */
export function tierEmptyText(tier: ScoreTier): string {
  const suggest = tier === "high" ? "MED or LOW" : "LOW";
  return `No ${tierLabel(tier)}-relevance results — try ${suggest}.`;
}

/** Tiers are meaningful only for reranked hybrid scores (normalized 0-1). */
export function tiersActive(mode: SearchMode, rerank: boolean): boolean {
  return mode === "hybrid" && rerank;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/score-tier.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/score-tier.ts test/score-tier.test.ts
git commit -m "feat: pure HIGH/MED/LOW score-tier model"
```

---

### Task 2: Thread score through grouping (`group-results.ts`)

**Files:**
- Modify: `src/group-results.ts`
- Test: `test/group-results.test.ts`

- [ ] **Step 1: Confirm no other constructors**

Run: `grep -rn "FileGroup\|ResultMatch\|groupResults" src test`
Expected: only `src/group-results.ts` constructs them; `src/views/search-view.ts` + `test/group-results.test.ts` consume `groupResults`. If anything else constructs a `FileGroup`/`ResultMatch` literal, add `score`/`topScore` there too.

- [ ] **Step 2: Write the failing test**

Add this `it` block inside the `describe("groupResults", …)` in `test/group-results.test.ts` (the `r()` helper already defaults `score: 1`):

```ts
  it("threads score into each match and exposes the file's top score", () => {
    const results = [
      r({ file: "vault/a.md", docid: "#1", score: 0.42 }),
      r({ file: "vault/a.md", docid: "#2", score: 0.81 }),
    ];
    const groups = groupResults(results, () => null, "vault");
    expect(groups[0].matches.map((m) => m.score)).toEqual([0.42, 0.81]);
    expect(groups[0].topScore).toBe(0.81);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/group-results.test.ts`
Expected: FAIL — `topScore` is `undefined` / property missing on the type.

- [ ] **Step 4: Implement — add the fields and populate them**

In `src/group-results.ts`, add `score` to `ResultMatch`:

```ts
export interface ResultMatch {
  line: number;
  docid: string;
  context: string;
  score: number;
}
```

Add `topScore` to `FileGroup` (place it just above `matches`):

```ts
export interface FileGroup {
  key: string;        // group identity for collapse state — the collection-relative `file`
  target: OpenTarget; // resolved once per file
  title: string;      // r.title || filename(file)
  tag: string;        // "vault" for vault files; else the collection prefix (first path segment)
  topScore: number;   // max score among matches; drives the tier badge
  matches: ResultMatch[];
}
```

In `groupResults`, set `topScore` when creating the group, update it per result, and include `score` in the pushed match:

```ts
      group = {
        key: result.file,
        target,
        title: result.title || (result.file.split("/").pop() ?? result.file),
        tag: target.kind === "vault" ? "vault" : (result.file.split("/")[0] ?? result.file),
        topScore: result.score,
        matches: [],
      };
      byFile.set(result.file, group);
    }
    group.topScore = Math.max(group.topScore, result.score);
    group.matches.push({ line: result.line, docid: result.docid, context: cleanSnippet(result.snippet), score: result.score });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/group-results.test.ts`
Expected: PASS (all existing + the new test).

- [ ] **Step 6: Commit**

```bash
git add src/group-results.ts test/group-results.test.ts
git commit -m "feat: group-results keeps score + exposes per-file topScore"
```

---

### Task 3: Settings field (`settings.ts`)

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Add the import**

At the top of `src/settings.ts`:

```ts
import type { ScoreTier } from "./score-tier";
```

- [ ] **Step 2: Add the field to `QmdSettings`**

Add after `searchMode`:

```ts
  searchMinTier: ScoreTier;       // search-panel minimum relevance floor (hybrid+rerank only)
```

- [ ] **Step 3: Add the default to `DEFAULT_SETTINGS`**

Add after the `searchMode: "hybrid",` line:

```ts
  searchMinTier: "low",
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts
git commit -m "feat: searchMinTier setting (default low = no filter)"
```

---

### Task 4: Render the badge (`grouped-result-list.ts`)

**Files:**
- Modify: `src/grouped-result-list.ts`

No unit test (DOM rendering); verified in Task 7 (typecheck) and Task 8 (smoke).

- [ ] **Step 1: Add the import**

After the existing `highlightTerms` import in `src/grouped-result-list.ts`:

```ts
import { scoreTier, tierLabel } from "./score-tier";
```

- [ ] **Step 2: Add `showTiers` to the options interface**

In `RenderGroupedOptions`, add after `collapsed` (optional so this task builds green on its own; Task 5 supplies it explicitly):

```ts
  showTiers?: boolean;       // paint the HIGH/MED/LOW badge per file group
```

- [ ] **Step 3: Destructure it**

In `renderGroupedResults`, add `showTiers` to the destructuring of `opts`:

```ts
  const { container, groups, terms, app, client, collapsed, showTiers, emptyText, viewType, hoverParent, sourcePath } = opts;
```

- [ ] **Step 4: Render the badge after the tag span**

In the `for (const group of groups)` loop, immediately after the `qmd-file-tag` span is created, add:

```ts
    if (showTiers) {
      const tier = scoreTier(group.topScore);
      header.createSpan({ cls: `qmd-tier-badge qmd-tier-${tier}`, text: tierLabel(tier) });
    }
```

(The badge sits after the tag on the header's right edge — this avoids fighting the tag's `margin-left:auto`.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS — `showTiers` is optional, so `search-view.ts` (not yet passing it) still compiles; the badge just stays off until Task 5 wires it.

- [ ] **Step 6: Commit**

```bash
git add src/grouped-result-list.ts
git commit -m "feat: grouped renderer paints per-file relevance badge"
```

---

### Task 5: Wire the control into the panel (`search-view.ts`)

**Files:**
- Modify: `src/views/search-view.ts`

No unit test (Obsidian `ItemView`); verified in Task 7 (typecheck/build) and Task 8 (smoke).

- [ ] **Step 1: Replace the file with the wired version**

Overwrite `src/views/search-view.ts` with:

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
import { tierFloor, tiersActive, tierLabel, tierEmptyText, TIERS, type ScoreTier } from "../score-tier";

export const VIEW_TYPE_QMD_SEARCH = "qmd-search-view";

export class SearchView extends ItemView {
  private mode: SearchMode;
  private minTier: ScoreTier;
  private searchId = 0;
  private debounceTimer: number | null = null;
  private collapsed = new Set<string>();

  constructor(
    leaf: WorkspaceLeaf,
    private client: QmdClient,
    private settings: QmdSettings,
    private saveSettings: () => Promise<void>,
  ) {
    super(leaf);
    this.mode = settings.searchMode;
    this.minTier = settings.searchMinTier;
  }

  getViewType(): string { return VIEW_TYPE_QMD_SEARCH; }
  getDisplayText(): string { return "qmd Vault Search"; }
  getIcon(): string { return "search"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("qmd-search-view");

    // Tiers (badge + min-score filter) are meaningful only for reranked hybrid scores (0-1).
    const tiersOn = (): boolean => tiersActive(this.mode, this.settings.rerank);

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

    // Collection chips ────────────────────────────────────────
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

    // Min-relevance tier filter (hybrid + rerank only) ────────
    const tierBar = root.createDiv({ cls: "qmd-tier-filter" });
    tierBar.createSpan({ cls: "qmd-tier-label", text: "Min relevance:" });
    const tierBtns = new Map<ScoreTier, HTMLElement>();
    for (const t of TIERS) {
      tierBtns.set(t, tierBar.createSpan({ cls: "qmd-mode-btn", text: tierLabel(t) }));
    }
    const renderTierBar = (): void => {
      if (tiersOn()) tierBar.show(); else tierBar.hide();
      for (const [t, btn] of tierBtns) btn.toggleClass("is-active", t === this.minTier);
    };

    const indicator = root.createDiv({ cls: "qmd-fallback-indicator" });
    indicator.hide();
    const list = root.createDiv({ cls: "qmd-results" });

    const showIndicator = (text: string): void => { indicator.setText(text); indicator.show(); };
    const clearIndicator = (): void => { indicator.empty(); indicator.hide(); };

    const emptyText = (): string =>
      (tiersOn() && tierFloor(this.minTier) > 0) ? tierEmptyText(this.minTier) : "No results.";

    const render = (
      results: QmdSearchResult[],
      resolveVaultPath: ReturnType<typeof makeVaultResolver>,
      terms?: string[],
      showTiers: boolean = tiersOn(),
    ): void => {
      const groups = groupResults(results, resolveVaultPath, this.settings.vaultCollectionName);
      const hl = terms ?? (this.mode === "keyword" ? queryTerms(input.value) : []);
      renderGroupedResults({
        container: list,
        groups,
        terms: hl,
        app: this.app,
        client: this.client,
        collapsed: this.collapsed,
        showTiers,
        emptyText: emptyText(),
        viewType: VIEW_TYPE_QMD_SEARCH,
        hoverParent: this,
        sourcePath: this.app.workspace.getActiveFile()?.path ?? "",
      });
    };
    const renderError = (e: unknown): void => {
      list.empty();
      list.createDiv({ cls: "qmd-status", text: `Error: ${e instanceof Error ? e.message : String(e)}` });
    };

    // Keyword fallback re-run for the hybrid path. Fallback hits are lex-scored,
    // so badges are off (showTiers = false). ──────────────────
    const runFallback = async (id: number, reason: "zero" | "failure", resolveVaultPath: ReturnType<typeof makeVaultResolver>): Promise<void> => {
      try {
        const results = await this.client.query({ searches: [{ type: "lex", query: input.value }], collections: [...selected], rerank: false });
        if (id !== this.searchId) return;
        showIndicator(reason === "zero" ? "Keyword results — semantic search returned nothing." : "Keyword results — semantic search failed.");
        render(results, resolveVaultPath, queryTerms(input.value), false);
      } catch (e) {
        if (id !== this.searchId) return;
        clearIndicator();
        renderError(e);
      }
    };

    // Single entry point for both triggers ────────────────────
    const execute = async (trigger: SearchTrigger): Promise<void> => {
      const mode = this.mode; // snapshot: a mid-flight mode switch must not change this run's fallback behavior
      const plan = planQuery(trigger, mode, input.value);
      if (plan.kind === "none") return;
      if (plan.kind === "clear") { clearIndicator(); list.empty(); return; }

      const id = ++this.searchId;
      this.collapsed.clear();
      clearIndicator();
      list.empty();
      list.createDiv({ cls: "qmd-status", text: "Searching…" });
      const rerank = mode === "hybrid" ? this.settings.rerank : false;
      const minScore = tiersOn() ? tierFloor(this.minTier) : 0;
      const filtering = minScore > 0;
      // Build the vault slug-map once per search (bd 2fb).
      const resolveVaultPath = makeVaultResolver(this.app);
      try {
        const results = await this.client.query({ searches: plan.searches, collections: [...selected], rerank, minScore });
        if (id !== this.searchId) return;
        if (mode === "hybrid") {
          const fb = decideFallback({ errored: false, resultCount: results.length }, this.settings);
          // A zero count under an active filter is the filter working — show the tailored
          // empty state instead of falling back to unfiltered keyword results.
          if (fb.fallback && filtering) { render([], resolveVaultPath); return; }
          if (fb.fallback) { await runFallback(id, "zero", resolveVaultPath); return; }
        }
        render(results, resolveVaultPath);
      } catch (e) {
        if (id !== this.searchId) return;
        if (mode === "hybrid") {
          const fb = decideFallback({ errored: true, resultCount: 0 }, this.settings);
          if (fb.fallback) { await runFallback(id, "failure", resolveVaultPath); return; }
        }
        renderError(e);
      }
    };

    // Tier selection re-queries with the new floor. ───────────
    const selectTier = async (t: ScoreTier): Promise<void> => {
      if (this.minTier === t) return;
      this.minTier = t;
      this.settings.searchMinTier = t;
      renderTierBar();
      await this.saveSettings();
      void execute("enter");
    };
    for (const [t, btn] of tierBtns) btn.onclick = (): void => { void selectTier(t); };
    renderTierBar();

    const scheduleInput = (): void => {
      if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => { this.debounceTimer = null; void execute("input"); }, this.settings.searchDebounceMs);
    };

    const switchMode = async (next: SearchMode): Promise<void> => {
      if (this.mode === next) return;
      if (this.debounceTimer !== null) { window.clearTimeout(this.debounceTimer); this.debounceTimer = null; }
      this.mode = next;
      this.settings.searchMode = next;
      renderToggle();
      renderTierBar();
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

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS — `search-view.ts` now supplies `showTiers` explicitly and imports resolve.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS (all existing tests + Task 1/2 additions; nothing regressed).

- [ ] **Step 4: Commit**

```bash
git add src/views/search-view.ts
git commit -m "feat: min-relevance tier filter + badge wiring in SearchView"
```

---

### Task 6: Styles (`styles.css`)

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Append the tier styles**

Add to the end of `styles.css`:

```css
/* Relevance tiers (badge + min-score filter) */
.qmd-tier-filter { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.qmd-tier-label { font-size: 11px; color: var(--text-muted); }
.qmd-tier-badge { flex: 0 0 auto; margin-left: 6px; font-size: var(--font-ui-smaller); font-weight: var(--font-semibold); letter-spacing: 0.04em; }
.qmd-tier-high { color: var(--color-green); }
.qmd-tier-med { color: var(--color-yellow); }
.qmd-tier-low { color: var(--text-faint); }
```

(The tier-filter buttons reuse the existing `.qmd-mode-btn` / `.qmd-mode-btn.is-active` styles — no new button rules needed.)

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "style: relevance badge + min-relevance control"
```

---

### Task 7: Build verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + production build**

Run: `npm run build`
Expected: PASS — `tsc --noEmit` clean, esbuild writes `main.js`. No type errors, no missing-export errors.

- [ ] **Step 2: Full test run**

Run: `npm test`
Expected: PASS — full suite green (prior phase baseline was 47 tests; this adds the `score-tier` file + one `group-results` test).

- [ ] **Step 3: Commit (only if the build produced tracked artifacts that changed)**

```bash
git status   # if main.js is tracked and changed, commit it; otherwise skip
```

---

### Task 8: Manual smoke (live daemon + Obsidian)

**Files:** none (manual verification). Prereq: Windows-native qmd daemon running on `[::1]:8181` (IPv6-only), vault indexed + embedded.

- [ ] **Step 1: Verify reranked hybrid scores are 0-1 (the assumption tiers rest on)**

Run (workstation, IPv6 loopback):

```bash
curl -s -g 'http://[::1]:8181/query' -H 'Content-Type: application/json' \
  -d '{"searches":[{"type":"lex","query":"obsidian"},{"type":"vec","query":"obsidian plugin search"}],"rerank":true,"limit":10}' \
  | python3 -c 'import sys,json; xs=[r["score"] for r in json.load(sys.stdin)["results"]]; print("scores:",xs); print("in_0_1:", all(0<=s<=1 for s in xs))'
```

Expected: `in_0_1: True`. If any score is > 1 or tiny (~0.0x), STOP — the thresholds need revisiting; record findings in the spec and a bd issue before shipping.

- [ ] **Step 2: Characterize keyword (rerank=false) score range (documents why keyword is excluded)**

Run:

```bash
curl -s -g 'http://[::1]:8181/query' -H 'Content-Type: application/json' \
  -d '{"searches":[{"type":"lex","query":"obsidian"}],"rerank":false,"limit":10}' \
  | python3 -c 'import sys,json; print("lex scores:",[r["score"] for r in json.load(sys.stdin)["results"]])'
```

Expected: a different/raw distribution (note it for the bd issue). Confirms keyword mode rightly gets no tiers.

- [ ] **Step 2.5: Build artifacts (if not already built)**

Run: `npm run build`
Expected: `main.js`, `manifest.json`, `styles.css` present in the repo root.

- [ ] **Step 3: Deploy + reload**

Copy `main.js`, `manifest.json`, `styles.css` into the vault's `.obsidian/plugins/qmd-vault-search/` (note the renamed plugin id `qmd-vault-search`), then reload Obsidian (or toggle the plugin off/on).

- [ ] **Step 4: Verify the feature**

In the qmd search panel:
1. **Hybrid mode (rerank on):** the `Min relevance: HIGH MED LOW` control is visible. Run a query → each file group shows a green/yellow/dim `HIGH`/`MED`/`LOW` badge matching its top result.
2. **Filter:** click `HIGH` → list re-queries, only HIGH (green) groups remain; `MED` → HIGH+MED; `LOW` → all. A `HIGH` query with no high hits shows `No HIGH-relevance results — try MED or LOW.`
3. **Persistence:** set `MED`, close & reopen the panel → still `MED`.
4. **Keyword mode:** switch to ⚡ Keyword → the control and badges disappear; results render as before.
5. (If you can toggle `rerank` off in settings) reopen the panel in Hybrid → control/badges absent.

- [ ] **Step 5: Record results**

Note the Step 1/2 score ranges and smoke outcome in a bd comment on the tracking issue (`bd remember` if a durable fact, e.g. "hybrid reranked /query scores confirmed 0-1 on <date>").

---

## Self-Review

- **Spec coverage:** tier model → Task 1; score threading + topScore → Task 2; setting → Task 3; badge → Task 4; control + server-side minScore + re-query + rerank gating + zero-fallback suppression + empty text → Task 5; CSS (green/yellow/dim) → Task 6; build → Task 7; 0-1 score verification + keyword characterization + persistence/visibility smoke → Task 8. All spec sections mapped.
- **Placeholder scan:** none — every code step shows full code; every command has expected output.
- **Type consistency:** `ScoreTier`, `scoreTier`, `tierFloor`, `tierLabel`, `tierEmptyText`, `tiersActive`, `TIERS` are defined in Task 1 and used with identical names/signatures in Tasks 3/4/5. `showTiers` is added to `RenderGroupedOptions` in Task 4 and supplied in Task 5. `topScore`/`score` added in Task 2 and read in Task 4.

## Notes / known limitations (per spec, intentional)

- A `settings.rerank` change does not live-update an already-open panel; it takes effect on next open / mode switch.
- Tiers never apply to keyword mode (lex scores aren't comparable to 0.7/0.4).
- Badge is per file group (top match), not per match.
