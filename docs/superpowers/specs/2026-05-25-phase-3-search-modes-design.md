# qmd × Obsidian — Phase 3 · Search modes (Keyword / Hybrid toggle + as-you-type)

- **Date:** 2026-05-25
- **Status:** Approved design — ready for implementation planning
- **Project:** `/home/igi21/experiements/obsidian/obsidian_qmd_plugin`
- **Parent spec:** `docs/superpowers/specs/2026-05-24-qmd-obsidian-plugin-design.md` (this is the Phase-3 deferred item *"BM25-only as-you-type preview"*)
- **Supersedes:** `obsidian_qmd_plugin-b48` (debounce + cancellable + stale-result guard) and `obsidian_qmd_plugin-548` (BM25 fallback on semantic failure/zero) — both fold into this feature.

## Goal

Give the existing search panel two explicit modes behind a toggle:

- **Keyword ⚡** — `lex`/BM25 only, fired **live as you type** (debounced, stale-guarded) for instant feedback.
- **Hybrid 🧠** — `lex`+`vec` + rerank, fired **on Enter** (exactly today's behavior), with an automatic keyword fallback when it errors or returns nothing.

The toggle is a per-user speed-vs-quality choice; the heavy combined search stays the default.

## Locked decisions

| Decision | Choice | Source |
|---|---|---|
| Surface | A mode toggle inside the existing `SearchView` — not a new panel. | Q: UX shape |
| Keyword mode | `searches:[{type:"lex"}]`, debounced live on input. | Q: heavy mode |
| Hybrid mode | `searches:[{type:"lex"},{type:"vec"}]` + `rerank` (= current Enter behavior). | Q: heavy mode |
| Default mode | `hybrid` — preserves today's quality-first behavior. | Confirmed |
| Debounce | 300 ms trailing (same as the related-notes panel). | Confirmed |
| Cancellation | **Stale-result guard via a `searchId` counter.** Obsidian `requestUrl` cannot be aborted, so superseded responses are *discarded*, not network-cancelled. | requestUrl constraint |
| Mode persistence | Persist `searchMode` as a setting — the toggle sticks across reopen. | Confirmed |
| Fallback | Hybrid only: on error → `fallbackOnFailure` (default **ON**); on zero results → `fallbackOnZero` (default **OFF**). Re-run as `[lex]`, show an indicator. | 548 spec |
| Structure | Extract pure `planQuery` + `decideFallback`; keep `SearchView` a DOM/timer shell. | Approach B |

## qmd / codebase facts this design relies on

- `QmdClient.query(opts)` (`src/qmd-client.ts:141`) posts `/query` with `searches: QmdSubQuery[]` where `type: "lex" | "vec" | "hyde"`, plus `collections`, `rerank`, etc. Keyword = `[{type:"lex", query}]`; hybrid = `[{type:"lex"},{type:"vec"}]`. (`QmdSubQuery`/`QmdQueryOptions`: `src/qmd-client.ts:1-21`.)
- In qmd's own vocabulary, **`query` is the operation** and **`vec` is the "semantic" sub-type**; "Hybrid" here means running `lex`+`vec` together and reranking the union.
- `SearchView` today (`src/views/search-view.ts:45-63`): text input → **Enter** → `runSearch` → `client.query({ searches:[lex,vec], collections, rerank: settings.rerank })` → `renderResultList(...)`. No debounce, no as-you-type, no cancellation; an empty query is a silent no-op (it does not clear the list).
- `renderResultList({ container, results, app, client, emptyText, vaultCollectionName })` (`src/result-list.ts`, called at `search-view.ts:56`) is the shared row renderer — reused unchanged.
- Collection selection stays the existing per-panel ephemeral chip `Set` (`search-view.ts:29-41`) — unchanged.
- The requestUrl transport (`src/request-url-fetch.ts`, injected as `QmdClient.fetchFn`) has **no abort** capability → cancellation is necessarily a stale-result guard, not a network abort. This corrects `obsidian_qmd_plugin-b48`'s AbortController premise.
- The repo already uses a pure-module + thin-view split: `src/related-refresh.ts` (pure `shouldRefresh`, unit-tested mock-free) feeding an untested DOM view. This feature mirrors that exactly.

## Components

**New — pure logic (MUST NOT import `obsidian`; unit-tested mock-free):**

| File | Responsibility |
|---|---|
| `src/search-plan.ts` | `planQuery(trigger, mode, query): QueryPlan` — the sole mode/trigger branching. Decides clear / no-op / which `searches[]` to run. |
| `src/search-fallback.ts` | `decideFallback(outcome, opts): FallbackDecision` — whether a hybrid result should fall back to keyword, and why. |

**Changed:**

| File | Change |
|---|---|
| `src/views/search-view.ts` | Add a mode toggle + a fallback-indicator element; hold `mode`, a debounce timer, and a `searchId` counter; route input (debounced) / Enter / toggle through `planQuery`; run `client.query` under the stale-guard; apply `decideFallback` on the hybrid path. |
| `src/settings.ts` | Add `searchMode`, `searchDebounceMs`, `fallbackOnFailure`, `fallbackOnZero` + defaults. |
| `src/settings-tab.ts` | Controls for the debounce and the two fallback toggles. (`searchMode` is driven by the panel toggle and persisted silently — no settings-tab control.) |
| `styles.css` | Minimal additions: `.qmd-mode-toggle`, `.qmd-mode-btn` (+ `.is-active`), `.qmd-fallback-indicator`. |

## Pure logic

```ts
// src/search-plan.ts
import type { QmdSubQuery } from "./qmd-client";

export type SearchMode = "keyword" | "hybrid";
export type SearchTrigger = "input" | "enter";

export type QueryPlan =
  | { kind: "clear" }                          // empty query → empty the list
  | { kind: "none" }                           // nothing to do (hybrid waiting for Enter)
  | { kind: "run"; searches: QmdSubQuery[] };  // fire this query

/** The only mode/trigger branching. Pure; no obsidian, no client. */
export function planQuery(trigger: SearchTrigger, mode: SearchMode, query: string): QueryPlan {
  if (query.trim() === "") return { kind: "clear" };
  if (mode === "keyword") return { kind: "run", searches: [{ type: "lex", query }] };
  // hybrid:
  if (trigger === "input") return { kind: "none" };  // wait for Enter
  return { kind: "run", searches: [{ type: "lex", query }, { type: "vec", query }] };
}
```

```ts
// src/search-fallback.ts
export interface SearchOutcome { errored: boolean; resultCount: number }
export interface FallbackOpts { fallbackOnFailure: boolean; fallbackOnZero: boolean }
export type FallbackReason = "failure" | "zero";
export interface FallbackDecision { fallback: boolean; reason: FallbackReason | null }

/** Hybrid path only. Decides whether to re-run the query as keyword-only. */
export function decideFallback(o: SearchOutcome, opts: FallbackOpts): FallbackDecision {
  if (o.errored) {
    return opts.fallbackOnFailure ? { fallback: true, reason: "failure" } : { fallback: false, reason: null };
  }
  if (o.resultCount === 0 && opts.fallbackOnZero) return { fallback: true, reason: "zero" };
  return { fallback: false, reason: null };
}
```

`rerank` stays a view + settings concern, not part of `planQuery`: hybrid runs pass `rerank: settings.rerank`; keyword runs pass `rerank: false` (a single sub-query — rerank is moot).

## Behavior (view wiring)

| Trigger | Keyword ⚡ | Hybrid 🧠 |
|---|---|---|
| keystroke | debounce 300 ms → `planQuery("input",…)` → run `[lex]` | debounce → `planQuery` → `none` |
| Enter | flush debounce → run `[lex]` now | run `[lex,vec]` + rerank |
| empty input | clear list + indicator | clear list + indicator |
| toggle → keyword | re-run `[lex]` live if text present | — |
| toggle → hybrid | — | keep current results; wait for Enter |

**Stale-guard:** each run does `const id = ++this.searchId;`, and after `await client.query(...)`, `if (id !== this.searchId) return;` before rendering. A slow earlier response cannot overwrite a newer one.

**Hybrid result handling:**

1. Run `[lex,vec]` (rerank) → `decideFallback({ errored:false, resultCount })`.
2. If `fallback` → run `[lex]`, render with the indicator *"Keyword results — semantic search returned nothing."*; else render results (or the empty `"No results."`).
3. On a thrown error → `decideFallback({ errored:true, resultCount:0 })`. If `fallback` → run `[lex]` with the indicator *"Keyword results — semantic search failed."*; if that also throws → inline `Error: …`. If no fallback → inline error.

**Keyword result handling:** run `[lex]`; stale-guard; render; on error → inline `Error: …`. No fallback (it is already keyword). The indicator is cleared on every non-fallback render.

## Error handling

- All errors render inline in the result list (existing `.qmd-status` pattern) — no `Notice` popups.
- Stale responses (searchId mismatch) are silently dropped.
- A daemon-unreachable failure surfaces as the inline query error.

## Settings

| Key | Type | Default |
|---|---|---|
| `searchMode` | `"keyword" \| "hybrid"` | `"hybrid"` |
| `searchDebounceMs` | `number` | `300` |
| `fallbackOnFailure` | `boolean` | `true` |
| `fallbackOnZero` | `boolean` | `false` |

## Testing

- `test/search-plan.test.ts` — truth table over (trigger × mode × empty/non-empty query): `clear` / `none` / run-`[lex]` / run-`[lex,vec]`.
- `test/search-fallback.test.ts` — error + toggle, zero + toggle, and the two off cases.
- `test/settings.test.ts` — the four new defaults.
- `SearchView` — no unit test (DOM/Obsidian-heavy, consistent with the project's other views); verified by `npm run build` + manual smoke.

## Acceptance criteria

- A toggle switches Keyword ⚡ / Hybrid 🧠; the choice persists across panel reopen.
- Keyword mode: typing yields debounced live `[lex]` results; clearing the input empties the list.
- Hybrid mode: typing does nothing until Enter; Enter runs `[lex,vec]` + rerank (unchanged from today).
- Hybrid error → keyword fallback + indicator (when `fallbackOnFailure`); hybrid zero results → keyword fallback + indicator (when `fallbackOnZero`).
- Fast typing never shows a stale older response (searchId guard verified manually).
- `planQuery` + `decideFallback` unit tests green; `npm run build` clean.
- `obsidian_qmd_plugin-b48` and `obsidian_qmd_plugin-548` closed as superseded by this feature.

## Out of scope

- `hyde` sub-queries / any third mode.
- True network cancellation (requestUrl cannot abort; the stale-guard is the mechanism).
- Diagnostics surfacing — `lastSearchMode` / last error belong to `obsidian_qmd_plugin-dgx`.
- Snippet cleanup (`obsidian_qmd_plugin-wvz`), graph node-click (`obsidian_qmd_plugin-792`), resolver-parity tests (`obsidian_qmd_plugin-cn3`).

## Self-review (completed by design author)

- **Placeholder scan:** none — every section is concrete; the two pure modules are written out in full.
- **Internal consistency:** the behavior table, the `planQuery` truth table, and the acceptance criteria agree (empty→clear, keyword→`[lex]`, hybrid+input→none, hybrid+enter→`[lex,vec]`). `rerank` ownership stated once (view+settings, not `planQuery`).
- **Scope:** single implementation plan — three small surfaces (2 pure modules + SearchView wiring + 4 settings). Fits one plan; supersedes two issues rather than adding new scope.
- **Ambiguity:** "cancellable" is explicitly defined as a stale-result guard (not network abort) to avoid the b48 AbortController misread; "semantic" is pinned to `vec` and "Hybrid" to `lex+vec` to avoid the naming confusion surfaced during brainstorming.
