# qmd × Obsidian — Phase 3 · Command-palette modal search (SuggestModal hotkey)

- **Date:** 2026-05-26
- **Status:** Approved design — ready for implementation planning
- **Project:** `/home/igi21/experiements/obsidian/obsidian_qmd_plugin`
- **Parent spec:** `docs/superpowers/specs/2026-05-24-qmd-obsidian-plugin-design.md` (this is the Phase-3 deferred item *"modal command-palette search (surface A)"*)
- **Issue:** `obsidian_qmd_plugin-2mp`
- **Builds on:** `2026-05-25-phase-3-search-modes-design.md` (reuses the `planQuery` / `decideFallback` pure modules and the `searchMode` / `searchDebounceMs` / fallback settings shipped there).

## Goal

Add a second search surface: a keyboard-driven modal (`SuggestModal`) opened by a command/hotkey, querying qmd as-you-type and opening the chosen result the same way the side panel does. **New surface only — no new query infrastructure.** The side panel (`SearchView`, just merged in `#5`) is not touched.

## Locked decisions

| Decision | Choice | Source |
|---|---|---|
| Surface | New `QmdSearchModal extends SuggestModal<QmdSearchResult>`, opened by a registered command. Native `SuggestModal` keyboard nav (arrows / Enter-to-choose). | Q: approaches |
| Search mode | **Reuse the persisted `settings.searchMode`** — no in-modal toggle. Keyword and Hybrid behave as in the panel, except the modal is always live (see below). | Q: modal mode |
| Hybrid in the modal | `SuggestModal`'s Enter chooses a result, so there is no free Enter to fire hybrid. Hybrid therefore runs **live, debounced**, with `rerank` = `settings.rerank` — **full parity incl. live rerank** (user choice). Achieved by calling `planQuery("enter", mode, q)` so hybrid emits `[lex,vec]` on input. | Q: hybrid in modal |
| Collection scope | **All collections** — `[vaultCollectionName, ...externalCollections]`. The modal has no chips, so this is the only way external-collection docs are reachable from the palette. | Q: scope |
| Debounce | Reuse `settings.searchDebounceMs` (300 ms default). Rerank fires on a typing *pause*, not every keystroke. | Derived |
| Cancellation | **Stale-result guard via a `searchId` counter** (Obsidian `requestUrl` cannot abort — same constraint as the panel). Superseded queries resolve `[]`; the latest keystroke wins. | requestUrl constraint |
| Fallback | Hybrid only, reusing `decideFallback`: on error → `fallbackOnFailure`; on zero → `fallbackOnZero`. Re-run as `[lex]`, rerank off. (Same policy as the panel.) | search-modes spec |
| Hotkey | Command registered with **no default hotkey** (Ctrl+P = core command palette, Ctrl+O = quick switcher). User binds it in Obsidian → Hotkeys. | Obsidian convention |
| Open action | Reuse the panel's open logic (vault → `openLinkText`; external → `DocPreviewModal`), extracted to a shared module. | Issue ("reuse renderResultList open logic") |

## qmd / codebase facts this design relies on

- `QmdClient.query(opts)` (`src/qmd-client.ts:141`) posts `/query` with `searches: QmdSubQuery[]` (`type: "lex" | "vec" | "hyde"`), plus `collections`, `rerank`. Returns `QmdSearchResult[]` (`docid`, `file`, `title`, `score`, `context`, `line`, `snippet`). Reused unchanged.
- `planQuery(trigger, mode, query)` (`src/search-plan.ts:12`) is pure. `planQuery("enter","keyword",q)` → `{run,[lex]}`; `planQuery("enter","hybrid",q)` → `{run,[lex,vec]}`; empty query → `{clear}`. Forcing `trigger:"enter"` is exactly what makes hybrid run live in the modal.
- `decideFallback(outcome, settings)` (`src/search-fallback.ts`) is pure — reused as-is for the hybrid fallback branch.
- The panel derives rerank identically: `const rerank = mode === "hybrid" ? this.settings.rerank : false;` (`src/views/search-view.ts:101`). The modal mirrors this rule.
- `resolveOpenTarget(file, docid, resolveVaultPath, vaultCollectionName)` (`src/open-target.ts:17`) → `OpenTarget` (`vault` | `external`); `makeVaultResolver(app)` builds the resolver. Pure / reused.
- `cleanSnippet(snippet)` (`src/clean-snippet.ts`) strips qmd's line-number / `@@` header noise — reused for the suggestion body.
- The open action currently lives **private** inside `result-list.ts` (`openTarget`, `src/result-list.ts:43-50`): vault → `app.workspace.openLinkText(path, "", false)`; external → `new DocPreviewModal(app, client, docid).open()` (dynamic import). This is the only genuinely-shared piece to extract.
- `renderResultList` (`src/result-list.ts:17`) renders **all** rows into one container with `onclick`. `SuggestModal` owns per-item rendering + keyboard nav, so `renderResultList` is **not** reused — its constituent pieces (badge / snippet / resolve / open) are.
- Command + view registration pattern: `this.addCommand({ id, name, callback })` (`src/main.ts:37,40,43`). The client is rebuilt on settings save (`src/main.ts:100-103`); the modal must read `this.client` / `this.settings` at open time (pass live references).
- Views are **not** unit-tested in this repo (no `SearchView` test); pure modules are (`search-plan.test.ts`, `search-fallback.test.ts`, `open-target.test.ts`, `clean-snippet.test.ts`). This feature follows that split.

## Components

**New — pure logic (MUST NOT import `obsidian`; unit-tested mock-free):**

| File | Responsibility |
|---|---|
| `src/modal-query.ts` | `planModalSearch(mode, query, settings): ModalSearchPlan` — composes `planQuery("enter", mode, query)` + the rerank rule + the all-collections list into one decision: `{kind:"clear"}` or `{kind:"run", searches, rerank, collections}`. The sole testable orchestration unit. |

**New — view (untested; manual smoke):**

| File | Responsibility |
|---|---|
| `src/views/search-modal.ts` | `QmdSearchModal extends SuggestModal<QmdSearchResult>`. Holds `client`, `settings`, a debounce timer, a `searchId` counter, and the pending-resolver ref. Implements `getSuggestions` (debounce + stale-guard + `planModalSearch` + `client.query` + hybrid fallback), `renderSuggestion` (badge + title + clean snippet), `onChooseSuggestion` (`resolveOpenTarget` → `openResolvedTarget`). |

**New — shared open action:**

| File | Responsibility |
|---|---|
| `src/open-action.ts` | `export async function openResolvedTarget(app, client, target: OpenTarget): Promise<void>` — the open logic lifted verbatim from `result-list.ts`'s private `openTarget`. |

**Changed:**

| File | Change |
|---|---|
| `src/result-list.ts` | Import `openResolvedTarget` from `open-action.ts`; delete the private `openTarget`. **No behavior change** — pure move. |
| `src/main.ts` | Register `addCommand({ id:"open-qmd-search-modal", name:"Search qmd (modal)", callback: () => new QmdSearchModal(this.app, this.client, this.settings).open() })`. No default hotkey. |

No `settings.ts` / `settings-tab.ts` / `styles.css` changes required — the modal reuses existing settings and the existing `.qmd-badge` / snippet CSS classes (applied inside `renderSuggestion`).

## Pure logic — `planModalSearch`

```ts
import { planQuery, type SearchMode } from "./search-plan";
import type { QmdSubQuery } from "./qmd-client";
import type { QmdSettings } from "./settings";

export type ModalSearchPlan =
  | { kind: "clear" }
  | { kind: "run"; searches: QmdSubQuery[]; rerank: boolean; collections: string[] };

export function planModalSearch(mode: SearchMode, query: string, settings: QmdSettings): ModalSearchPlan {
  const plan = planQuery("enter", mode, query); // forced "enter": hybrid emits [lex,vec] live
  if (plan.kind !== "run") return { kind: "clear" }; // "clear" or (unreachable with "enter") "none"
  return {
    kind: "run",
    searches: plan.searches,
    rerank: mode === "hybrid" ? settings.rerank : false,
    collections: [settings.vaultCollectionName, ...settings.externalCollections],
  };
}
```

## Query lifecycle — `getSuggestions`

`SuggestModal` calls `getSuggestions(query)` on every input change and renders whatever its returned promise resolves to. The modal wraps this in a debounce + stale-guard:

1. **Empty query** → resolve `[]` (native empty state).
2. **Debounce** `settings.searchDebounceMs`: clear any pending timer; resolve the *previous* pending promise with `[]` (so no timer/promise dangles); start a new timer.
3. On fire, `const id = ++this.searchId`. Compute `planModalSearch(settings.searchMode, query, settings)`. `clear` → resolve `[]`.
4. `await this.client.query({ searches, collections, rerank })`. If `id !== this.searchId`, resolve `[]` (superseded).
5. **Hybrid fallback**: if `mode === "hybrid"` and `decideFallback({errored:false, resultCount}, settings).fallback` → re-run `[{type:"lex",query}]` (rerank off), guarded, resolve those.
6. **Error**: `catch` → if hybrid and `decideFallback({errored:true, resultCount:0}, settings).fallback` → keyword retry; else set `this.emptyStateText = "Error: …"` and resolve `[]`. The modal stays open and usable (daemon-down is non-fatal).

The stale-guard is the same `searchId` pattern as `SearchView`; superseded responses are discarded, never network-cancelled (`requestUrl` has no abort).

## Rendering — `renderSuggestion(result, el)`

Mirror the result-row visual language using existing CSS classes; resolve the target once for the badge:

- `el.createDiv({ cls:"qmd-result-title", text: result.title || result.file })`
- meta row: `qmd-badge` span (`vault` | `external`, from `resolveOpenTarget`)
- `el.createDiv({ cls:"qmd-snippet", text: cleanSnippet(result.snippet) })`

**Dropped vs the panel row:** the `graph` link (needs panel/workspace context) and the `#rank` chip (palette stays lean).

## Choosing — `onChooseSuggestion(result, evt)`

```ts
const target = resolveOpenTarget(result.file, result.docid, makeVaultResolver(this.app), this.settings.vaultCollectionName);
await openResolvedTarget(this.app, this.client, target);
```

## Testing

| Test | Kind | Asserts |
|---|---|---|
| `test/modal-query.test.ts` | unit (mock-free) | `planModalSearch`: keyword → `[lex]`, rerank `false`; hybrid → `[lex,vec]`, rerank = `settings.rerank`; empty → `clear`; collections = `[vault, ...external]`. |
| `test/open-action.test.ts` | unit | vault target → `app.workspace.openLinkText` called with the resolved path; external target → `openLinkText` **not** called. |
| existing `search-plan` / `search-fallback` / `open-target` / `clean-snippet` tests | unit | unchanged, stay green (regression guard for the `result-list` open-action move). |
| Manual smoke (Obsidian) | manual | command appears + opens; debounced typing shows results from vault + external; keyword vs hybrid (rerank) behavior; vault result opens note, external opens `DocPreviewModal`; rapid typing never shows stale results; daemon-down shows error empty-state without crashing. |

## Out of scope (YAGNI)

- In-modal mode toggle — the modal reads the persisted `settings.searchMode`.
- Collection chips in the modal — scope is fixed to all collections.
- Graph-link and rank chip in suggestions.
- Modifier-key "open in new pane" on choose.
- A shipped default hotkey.
- Refactoring `SearchView.execute()` into a shared runner (Approach 2) — rejected to keep the just-merged panel stable; only the open action is extracted.

## Acceptance criteria

1. Command **"Search qmd (modal)"** is registered (no default hotkey) and opens a `SuggestModal`.
2. Typing runs a debounced, stale-guarded qmd query across **all** collections; results render with a vault/external badge + cleaned snippet.
3. Keyword mode runs `[lex]` (rerank off); hybrid mode runs `[lex,vec]` with `rerank = settings.rerank`, live.
4. Hybrid honours `decideFallback` (error / zero → keyword retry) identically to the panel.
5. Choosing a vault result opens the note in the workspace; choosing an external result opens `DocPreviewModal`.
6. Rapid typing never lets an earlier query's results overwrite a later one's.
7. Daemon-down (or query error, no fallback) shows an error empty-state; the modal does not crash.
8. `result-list.ts` behavior is unchanged (open action extracted, not altered); all existing tests stay green; the two new unit tests pass.
