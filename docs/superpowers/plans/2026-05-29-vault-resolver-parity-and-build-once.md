# Vault-Resolver Parity + Build-Once Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin `makeVaultResolver`'s slug-to-vault-file resolution behavior with parity tests (bd `cn3`), then refactor the resolver to be built once per search instead of once per render (bd `2fb`).

**Architecture:** `makeVaultResolver(app)` builds a `Map` of every vault markdown file keyed by its qmd-slugged form (spaces→hyphens), so a qmd result path (`notes/My-Note.md`) resolves back to the real vault path (`notes/My Note.md`). Today it is rebuilt on every render — per debounced keystroke in `SearchView`. We add a focused unit-test file that characterizes the resolver across all parity dimensions, then thread a single resolver instance through the `SearchView` render path and let the flat `renderResultList` accept one.

**Tech Stack:** TypeScript, Vitest (`npm test` → `vitest run`, node env, `obsidian` aliased to `test/__mocks__/obsidian.ts`), esbuild. Obsidian plugin API.

**Two beads, sequenced for safety:**
1. `cn3` (P2) — verify + lock resolution behavior with tests. Do this FIRST so the `2fb` refactor runs under green characterization tests.
2. `2fb` (P2) — build the resolver once per `execute()`; thread it through render + fallback; give the flat renderer an optional resolver param.

**Out of scope (do NOT touch):**
- `src/views/link-suggest-view.ts:60` — already builds once per settled query (explicit comment "Fresh resolver per settled query"). Same anti-pattern was already fixed here; leave it. File a separate bead only if you want symmetry.
- `src/views/search-modal.ts:21` — already builds once in the constructor. Correct.
- Collection-name slug collisions — that is bd `8z9`, a different code path (`deriveCollectionName`), deliberately excluded.

---

## Key facts established before writing this plan (read before starting)

- **Vitest wiring** (`vitest.config.ts`): `resolve.alias` maps `obsidian` → `test/__mocks__/obsidian.ts`. Env is `node` (NO DOM — `container.createDiv()` etc. do not exist under test). The mock exports `class TFile {}` (empty). Tests live in `test/**/*.test.ts`.
- **`makeVaultResolver` uses exactly two vault methods** (`src/vault-resolver.ts`):
  - `app.vault.getMarkdownFiles()` → `TFile[]`, reads `.path` to build the slug map.
  - `app.vault.getAbstractFileByPath(p) instanceof TFile` → exact-path hit detection.
  - Current slug rule: `f.path.replace(/ /g, "-")` — **spaces→hyphens only, case preserved, no unicode change.**
- **The collection prefix is stripped upstream** by `toVaultPath()` in `src/open-target.ts` BEFORE the resolver is called. So the resolver only ever sees collection-relative paths. The "collection-prefix" parity dimension is already covered by `test/open-target.test.ts` ("strips the collection prefix"). Do not duplicate it in the resolver test.
- **qmd slug rule — partially verified, one open question for Task 1:**
  - Live qmd returns space-LESS paths with case preserved (observed: `obsidian-qmd/CLAUDE.md`, `qmd-src/README.md` come back capitalized). This matches our resolver and `test/open-target.test.ts` (`My-Note.md`, not `my-note.md`).
  - The achekulaev plugin's notes (`obsidian-qmd/CLAUDE.md:119`) claim qmd returns `costly-rituals.md` for `Costly Rituals.md` (lowercased). This is contradicted by the case-preserved space-less observation, so it is **likely stale** — BUT the observation does not cover a *spaced + capitalized* filename. Whether qmd lowercases *only when it slugifies a space* is the one open question Task 1 settles. The characterization tests assume case-preserved (current behavior); Task 1 confirms or triggers the Task 2b contingency.
- **Existing test pattern** (`test/open-target.test.ts`, `test/group-results.test.ts`): pass plain resolver functions directly; build result fixtures with a small factory. We follow the same style but build a fake `App` for `makeVaultResolver`.

---

## Task 1: Verify qmd's slug rule for spaced + capitalized filenames (cn3 groundwork)

This is a verification spike, not a code change. It decides whether Task 2's case-sensitivity assertions are correct or whether the Task 2b contingency fix is needed. The live qmd daemon + smoke vault already contain `qmd-smoke/Plugins/...` notes (see the `smoke-test-deploy-procedure` memory).

**Files:** none (investigation only).

- [ ] **Step 1: Confirm the qmd daemon is up (Windows-native, IPv6 loopback)**

Run (from WSL):
```bash
cd /mnt/c && cmd.exe /c "curl -s -m5 -o NUL -w '%{http_code}' http://[::1]:8181/"
```
Expected: `404` (MCP lives at a sub-path; 404 = alive). If not 404, start it: `cd /mnt/c && cmd.exe /c "qmd mcp --http --daemon"`.

- [ ] **Step 2: List the slugged paths qmd reports for the `vault` collection**

Use the qmd MCP `query` tool (or `qmd vsearch`) against collection `vault` and inspect the raw `file` field of results, looking specifically for a note whose ORIGINAL name has both a space and a capital letter (the `qmd-smoke/Plugins/` corpus has these).

MCP call:
```
mcp__qmd__query  searches=[{type:"lex", query:"plugin"}]  collections=["vault"]  rerank=false  limit=20
```
Look at each `file` value. Find one whose vault original had a space (e.g. a note titled like `Community Plugins.md`).

- [ ] **Step 3: Record the rule and pick the branch**

Compare the reported `file` to the real vault filename:
- If `Community Plugins.md` → `Community-Plugins.md` (**case preserved**) → rule confirmed = spaces→hyphens, case preserved. **Skip Task 2b.** Proceed to Task 2 as written.
- If `Community Plugins.md` → `community-plugins.md` (**lowercased**) → real gap. **Do Task 2b** (and invert the boundary assertion in Task 2 Step 1 as noted there).

Write the finding into the bead so it is not lost:
```bash
bd comment obsidian_qmd_plugin-cn3 "Verified live qmd slug rule: <paste the before→after path here>. Case <preserved|lowercased>."
```

Expected outcome (strong prior): **case preserved** — Task 2b not needed.

---

## Task 2: Characterization tests for makeVaultResolver (cn3)

Lock the resolver's behavior across every parity dimension cn3 names: exact hit, space-slug, case, unicode, real-hyphen, no-match. Collection-prefix is intentionally out (covered by `open-target.test.ts`).

**Files:**
- Create: `test/vault-resolver.test.ts`
- (No change to `src/vault-resolver.ts` in this task — these tests must pass against the CURRENT implementation, proving parity. If Task 1 found a gap, the fix is Task 2b.)

- [ ] **Step 1: Write the test file**

Create `test/vault-resolver.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { App, TFile } from "obsidian";
import { makeVaultResolver } from "../src/vault-resolver";

// Build a fake App whose vault contains exactly `paths` as markdown files.
// makeVaultResolver reads only two vault methods:
//   getMarkdownFiles() -> TFile[]            (reads .path to build the slug map)
//   getAbstractFileByPath(p) instanceof TFile (exact-path hit detection)
// The mock's TFile is an empty class, so `instanceof TFile` works on `new TFile()`.
function fakeApp(paths: string[]): App {
  const present = new Set(paths);
  const files = paths.map((p) => Object.assign(new TFile(), { path: p }));
  return {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (p: string) =>
        present.has(p) ? Object.assign(new TFile(), { path: p }) : null,
    },
  } as unknown as App;
}

describe("makeVaultResolver", () => {
  it("resolves an exact (un-slugged) path hit", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/x.md"]));
    expect(resolve("notes/x.md")).toBe("notes/x.md");
  });

  it("reverses qmd's space->hyphen slug back to the real spaced path", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/My Note.md"]));
    expect(resolve("notes/My-Note.md")).toBe("notes/My Note.md");
  });

  it("preserves case: a capitalized spaced file resolves from its case-preserved slug", () => {
    // Task 1 ground truth: current qmd slugs spaces->hyphens but PRESERVES case,
    // so `Costly Rituals.md` is reported as `Costly-Rituals.md` (NOT `costly-rituals.md`).
    const resolve = makeVaultResolver(fakeApp(["lore/Costly Rituals.md"]));
    expect(resolve("lore/Costly-Rituals.md")).toBe("lore/Costly Rituals.md");
  });

  it("does NOT resolve a lowercased slug (documents the case-sensitivity boundary)", () => {
    // Boundary/characterization test. If Task 1 found qmd lowercases spaced files,
    // this expectation is WRONG in production -> delete this test and apply Task 2b,
    // whose new assertion is that the lowercased slug DOES resolve.
    const resolve = makeVaultResolver(fakeApp(["lore/Costly Rituals.md"]));
    expect(resolve("lore/costly-rituals.md")).toBeNull();
  });

  it("preserves real hyphens (a literal `qmd-smoke/` folder is not a slugged space)", () => {
    const resolve = makeVaultResolver(fakeApp(["qmd-smoke/note.md"]));
    expect(resolve("qmd-smoke/note.md")).toBe("qmd-smoke/note.md");
  });

  it("preserves unicode characters in the path", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/Café León.md"]));
    expect(resolve("notes/Café-León.md")).toBe("notes/Café León.md");
  });

  it("returns null for a path that is not a vault file (external collection)", () => {
    const resolve = makeVaultResolver(fakeApp(["notes/x.md"]));
    expect(resolve("crawl4ai-docs/embeddings.md")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests — they must PASS against the current implementation**

Run:
```bash
npx vitest run test/vault-resolver.test.ts
```
Expected: **7 passed** (parity confirmed against current behavior).

If any FAIL, that is a real gap surfaced by cn3. Do not weaken the assertion to make it pass — stop and decide:
- A case/lowercasing failure → apply Task 2b.
- Any other failure → it is a genuine resolver bug; fix `src/vault-resolver.ts` minimally and re-run. Note the fix in the cn3 bead.

- [ ] **Step 3: Run the full suite to confirm no regression**

Run:
```bash
npm test
```
Expected: all suites pass (the prior count plus the 7 new resolver tests).

- [ ] **Step 4: Commit**

```bash
git add test/vault-resolver.test.ts
git commit -m "test: characterize makeVaultResolver slug parity (cn3)"
```

---

## Task 2b (CONTINGENCY — only if Task 1 found qmd lowercases spaced files)

Skip entirely if Task 1 confirmed case-preserved. This task makes the resolver case-insensitive to match qmd's output.

**Files:**
- Modify: `src/vault-resolver.ts`
- Modify: `test/vault-resolver.test.ts` (invert the boundary assertion from Task 2 Step 1)

- [ ] **Step 1: Invert the boundary test to assert the lowercased slug resolves**

In `test/vault-resolver.test.ts`, replace the `"does NOT resolve a lowercased slug"` test with:

```typescript
  it("resolves a lowercased slug to the real path (qmd lowercases when slugging spaces)", () => {
    const resolve = makeVaultResolver(fakeApp(["lore/Costly Rituals.md"]));
    expect(resolve("lore/costly-rituals.md")).toBe("lore/Costly Rituals.md");
  });
```

- [ ] **Step 2: Run it to confirm it FAILS**

```bash
npx vitest run test/vault-resolver.test.ts -t "lowercased slug"
```
Expected: FAIL (`expected null to be 'lore/Costly Rituals.md'`).

- [ ] **Step 3: Make the resolver case-insensitive (minimal change)**

In `src/vault-resolver.ts`, replace the function body:

```typescript
export function makeVaultResolver(app: App): (collectionRelativePath: string) => string | null {
  const bySlug = new Map<string, string>();
  // qmd slugs spaces->hyphens AND lowercases; match on the same normalized form.
  // Real hyphens survive (no special handling). On a same-slug collision, last file wins.
  const slug = (p: string): string => p.replace(/ /g, "-").toLowerCase();
  for (const f of app.vault.getMarkdownFiles()) bySlug.set(slug(f.path), f.path);
  return (p) => {
    if (app.vault.getAbstractFileByPath(p) instanceof TFile) return p;
    return bySlug.get(slug(p)) ?? null;
  };
}
```

Also update the doc comment above the function to say "spaces→hyphens and lowercases" instead of "Only spaces are converted".

- [ ] **Step 4: Run the resolver tests — all pass**

```bash
npx vitest run test/vault-resolver.test.ts
```
Expected: all pass (note the case-preserved test still passes — `Costly-Rituals.md` lowercases to the same key).

- [ ] **Step 5: Full suite (open-target/group-results pass-through still green)**

```bash
npm test
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/vault-resolver.ts test/vault-resolver.test.ts
git commit -m "fix: case-insensitive vault slug resolution to match qmd output (cn3)"
```

---

## Task 3: Build the resolver once per execute() in SearchView (2fb, primary)

`SearchView` rebuilds the slug map on every render — once per debounced keystroke in keyword mode. Build it once per `execute()` (the vault does not change mid-search) and thread it into `render()` and `runFallback()`.

**Files:**
- Modify: `src/views/search-view.ts` (the `render` closure ~line 72, `runFallback` ~line 94, `execute` ~line 108)

This change lives entirely inside `onOpen()` closures and is not unit-testable in the node/no-DOM harness. Correctness is guaranteed by typecheck (signatures line up), the Task 2 resolver tests (the resolver itself is correct), the existing `group-results`/`open-target` tests (the consumer is correct), and the Task 5 manual smoke.

- [ ] **Step 1: Change the `render` closure to accept the resolver**

In `src/views/search-view.ts`, change the `render` signature and its `groupResults` call.

Find:
```typescript
    const render = (results: QmdSearchResult[], terms?: string[]): void => {
      const groups = groupResults(results, makeVaultResolver(this.app), this.settings.vaultCollectionName);
```
Replace with:
```typescript
    const render = (results: QmdSearchResult[], resolveVaultPath: ReturnType<typeof makeVaultResolver>, terms?: string[]): void => {
      const groups = groupResults(results, resolveVaultPath, this.settings.vaultCollectionName);
```
(Leave the rest of the `render` body unchanged — `hl`, `renderGroupedResults({...})`.)

- [ ] **Step 2: Thread the resolver through `runFallback`**

Find:
```typescript
    const runFallback = async (id: number, reason: "zero" | "failure"): Promise<void> => {
      try {
        const results = await this.client.query({ searches: [{ type: "lex", query: input.value }], collections: [...selected], rerank: false });
        if (id !== this.searchId) return;
        showIndicator(reason === "zero" ? "Keyword results — semantic search returned nothing." : "Keyword results — semantic search failed.");
        render(results, queryTerms(input.value));
```
Replace with:
```typescript
    const runFallback = async (id: number, reason: "zero" | "failure", resolveVaultPath: ReturnType<typeof makeVaultResolver>): Promise<void> => {
      try {
        const results = await this.client.query({ searches: [{ type: "lex", query: input.value }], collections: [...selected], rerank: false });
        if (id !== this.searchId) return;
        showIndicator(reason === "zero" ? "Keyword results — semantic search returned nothing." : "Keyword results — semantic search failed.");
        render(results, resolveVaultPath, queryTerms(input.value));
```
(The `catch` block in `runFallback` is unchanged.)

- [ ] **Step 3: Build the resolver once in `execute()` and pass it to render + fallback**

In `execute`, find:
```typescript
      const id = ++this.searchId;
      this.collapsed.clear();
      clearIndicator();
      list.empty();
      list.createDiv({ cls: "qmd-status", text: "Searching…" });
      const rerank = mode === "hybrid" ? this.settings.rerank : false;
      try {
        const results = await this.client.query({ searches: plan.searches, collections: [...selected], rerank });
        if (id !== this.searchId) return;
        if (mode === "hybrid") {
          const fb = decideFallback({ errored: false, resultCount: results.length }, this.settings);
          if (fb.fallback) { await runFallback(id, "zero"); return; }
        }
        render(results);
      } catch (e) {
        if (id !== this.searchId) return;
        if (mode === "hybrid") {
          const fb = decideFallback({ errored: true, resultCount: 0 }, this.settings);
          if (fb.fallback) { await runFallback(id, "failure"); return; }
        }
        renderError(e);
      }
```
Replace with:
```typescript
      const id = ++this.searchId;
      this.collapsed.clear();
      clearIndicator();
      list.empty();
      list.createDiv({ cls: "qmd-status", text: "Searching…" });
      const rerank = mode === "hybrid" ? this.settings.rerank : false;
      // Build the vault slug-map once per search: the vault does not change mid-search,
      // and keyword mode re-renders per debounced keystroke (bd 2fb).
      const resolveVaultPath = makeVaultResolver(this.app);
      try {
        const results = await this.client.query({ searches: plan.searches, collections: [...selected], rerank });
        if (id !== this.searchId) return;
        if (mode === "hybrid") {
          const fb = decideFallback({ errored: false, resultCount: results.length }, this.settings);
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
```

- [ ] **Step 4: Typecheck (catches any missed call site / signature mismatch)**

Run:
```bash
npm run typecheck
```
Expected: no errors. (`makeVaultResolver` import is still used — by the `execute()` build — so no unused-import error.)

- [ ] **Step 5: Full test suite (no behavior change → still green)**

Run:
```bash
npm test
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/views/search-view.ts
git commit -m "perf: build vault slug-map once per search in SearchView (2fb)"
```

---

## Task 4: Let the flat renderer accept an optional resolver (2fb, secondary)

`renderResultList` (used by `RelatedNotesView`) also builds the resolver internally on every call. Per 2fb ("the flat renderer could take an optional resolver too"), add an optional param so a caller can supply one. This is low-value on its own (related-notes re-renders on active-file change, not per keystroke) but completes 2fb and keeps the two renderers symmetric. Backward compatible — existing callers need no change.

Like Task 3, `renderResultList` touches Obsidian DOM (`createDiv`) and is not unit-testable in the node harness; correctness is via typecheck + the unchanged default path + Task 5 smoke.

**Files:**
- Modify: `src/result-list.ts` (`RenderResultListOptions` interface + the `makeVaultResolver` call ~line 25)

- [ ] **Step 1: Add the optional field to the options interface**

In `src/result-list.ts`, find:
```typescript
export interface RenderResultListOptions {
  container: HTMLElement;
  results: QmdSearchResult[];
  app: App;
  client: QmdClient;
  emptyText: string;
  vaultCollectionName: string;
}
```
Replace with:
```typescript
export interface RenderResultListOptions {
  container: HTMLElement;
  results: QmdSearchResult[];
  app: App;
  client: QmdClient;
  emptyText: string;
  vaultCollectionName: string;
  /** Optional: reuse a resolver built once by the caller (avoids rebuilding the slug map per render). Built from `app` if omitted. */
  resolveVaultPath?: ReturnType<typeof makeVaultResolver>;
}
```

- [ ] **Step 2: Use the supplied resolver, else build one**

In `renderResultList`, find:
```typescript
  const resolveVaultPath = makeVaultResolver(app);
```
Replace with:
```typescript
  const resolveVaultPath = opts.resolveVaultPath ?? makeVaultResolver(app);
```
(`opts` is in scope — it is the function parameter the other fields are destructured from. Leave the `resolveOpenTarget(...)` call on the next line unchanged.)

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: no errors. (`makeVaultResolver` still imported and used in the `?? makeVaultResolver(app)` fallback; `RelatedNotesView` callers compile unchanged since the new field is optional.)

- [ ] **Step 4: Full test suite**

Run:
```bash
npm test
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/result-list.ts
git commit -m "perf: renderResultList accepts an optional prebuilt resolver (2fb)"
```

---

## Task 5: Build + manual GUI smoke (verifies the threaded resolver end-to-end)

Tasks 3 and 4 have no unit coverage (closures + DOM). This is their real verification: confirm vault results still resolve to the vault (not mis-tagged "external") after threading the single resolver. Procedure per the `smoke-test-deploy-procedure` memory.

**Files:** none (deploy + observe).

- [ ] **Step 1: Production build**

Run:
```bash
npm run build
```
Expected: `tsc --noEmit` clean, then esbuild writes `main.js`. (`manifest.json` and `styles.css` already exist in the repo root.)

- [ ] **Step 2: Deploy the 3 artifacts into the Windows vault plugin folder**

Run (quote the Cyrillic path):
```bash
cp main.js manifest.json styles.css "/mnt/c/Users/igi21/OneDrive/Документы/Obsidian Vault/.obsidian/plugins/qmd-vault-search/"
```

- [ ] **Step 3: Confirm the daemon is alive, then reload Obsidian**

```bash
cd /mnt/c && cmd.exe /c "curl -s -m5 -o NUL -w '%{http_code}' http://[::1]:8181/"
```
Expected: `404` (alive). In Obsidian: toggle the "qmd Vault Search" plugin off/on (or reload) so the rebuilt view loads.

- [ ] **Step 4: Smoke the resolver via the search view**

In Obsidian, open the qmd Vault Search view and run a keyword search that hits the `qmd-smoke/Plugins/` corpus (e.g. `plugin`). Verify:
- Vault hits show the **`vault`** badge and open the real note on click (this is the threaded resolver working).
- External-collection hits show the **external** badge.
- Type several characters quickly (keyword mode debounces): results still tag correctly — confirms the once-per-execute resolver is built fresh each search and stays correct.
- If a `qmd-smoke/` note (real hyphen in the folder) resolves as `vault`, the real-hyphen path still works.

Expected: vault notes resolve to `vault`; no vault note is mis-tagged `external`.

- [ ] **Step 5: Record the smoke result on the beads**

```bash
bd comment obsidian_qmd_plugin-2fb "Manual smoke after build-once refactor: vault hits resolve to vault badge + open correctly; external hits tagged external; real-hyphen qmd-smoke/ paths resolve. Pass."
```

---

## Task 6: Close the beads

- [ ] **Step 1: Close cn3 and 2fb**

```bash
bd close obsidian_qmd_plugin-cn3 --reason "Parity verified against live qmd (Task 1); characterization tests added in test/vault-resolver.test.ts."
bd close obsidian_qmd_plugin-2fb --reason "Resolver built once per execute() in SearchView; renderResultList takes optional prebuilt resolver; smoke passed."
```

- [ ] **Step 2: Push (per CLAUDE.md session-completion rule)**

```bash
git pull --rebase
git push
git status   # MUST show "up to date with origin"
```

---

## Self-Review

**Spec coverage:**
- cn3 dimensions — spaces (Task 2 Step 1, "reverses qmd's space->hyphen slug"), case (Task 1 + the case-preserved test + Task 2b contingency), unicode (unicode test), space-slug (same as spaces), collection-prefix (explicitly delegated to existing `open-target.test.ts` — documented in Key Facts, not re-tested). Covered.
- 2fb — both named call sites: `search-view.ts` render closure (Task 3), `result-list.ts:25` flat renderer (Task 4). Covered. The extra call sites (`link-suggest-view.ts`, `search-modal.ts`) are documented as out-of-scope-and-already-correct.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". All code shown in full; the only conditional is Task 2b, which is fully written and gated on a concrete Task 1 finding.

**Type consistency:** Resolver type is `ReturnType<typeof makeVaultResolver>` everywhere it is threaded (Task 3 `render`/`runFallback` params, Task 4 interface field) — matches the existing `search-modal.ts:17` convention. `makeVaultResolver`'s own signature is unchanged in Tasks 3–4 (only Task 2b touches it). `groupResults(results, resolveVaultPath, vaultCollectionName)` arg order matches `src/group-results.ts:20`. `renderResultList` keeps its single-options-object shape; the new field is optional so all existing callers (`related-notes-view.ts:58,80`) still compile.
