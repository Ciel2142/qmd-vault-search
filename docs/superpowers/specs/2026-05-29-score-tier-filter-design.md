# Design: HIGH/MED/LOW relevance tiers — badge + min-score filter

**Date:** 2026-05-29
**Status:** Approved (design); ready for implementation plan
**Scope:** the search panel (`SearchView`) only

## Summary

Add two related features to the search panel, both driven by the relevance
`score` qmd already returns on every result:

1. A color-coded **HIGH / MED / LOW badge** on each file group, mirroring qmd's
   CLI score coloring (green > 0.7, yellow > 0.4, dim otherwise).
2. A **minimum-relevance filter** — a segmented `HIGH | MED | LOW` control that
   sets a server-side `minScore` floor on the query.

Both are **hybrid-mode-only** and active only when reranking is on (see
§"Edge cases"). In keyword mode, or with rerank disabled, the panel behaves
exactly as it does today.

## Background

- qmd's CLI color-codes each result's score: **green > 0.7, yellow > 0.4, dim
  otherwise** (qmd `README.md`, result output-format section). This 3-tier
  split is the HIGH/MED/LOW model we mirror. (qmd's separate "Score
  Interpretation" table uses finer 0.8/0.5/0.2 bands; we deliberately follow
  the 3-tier CLI coloring, not that table.)
- qmd's HTTP `/query` returns a `score` per result. The plugin's
  `QmdQueryOptions` already has an (unused) `minScore?` field; `SearchView`
  never sets it.
- `groupResults` currently **drops** the `score` field — only `line`, `docid`,
  and `context` survive into `ResultMatch`. The badge needs the score threaded
  through.
- Reranked scores are normalized 0–1, so the 0.7/0.4 thresholds are meaningful.
  Raw RRF fusion scores (`score = Σ(1/(k+rank+1)), k=60`, no rerank) are tiny
  (~0.01–0.08) and **not** comparable to those thresholds — this drives the
  rerank gating below.

## Tier model — new pure unit `src/score-tier.ts`

```ts
export type ScoreTier = "high" | "med" | "low";

// green > 0.7, yellow > 0.4, dim otherwise (qmd parity)
scoreTier(score: number): ScoreTier      // ≥0.7 high, ≥0.4 med, else low
tierFloor(tier: ScoreTier): number       // high→0.7, med→0.4, low→0
tierLabel(tier: ScoreTier): string       // "HIGH" | "MED" | "LOW"
tiersActive(mode: SearchMode, rerank: boolean): boolean  // hybrid && rerank
```

No Obsidian, no client — pure and unit-tested.

Threshold note: `scoreTier` uses `>=` (a score of exactly 0.7 is HIGH, exactly
0.4 is MED). `tierFloor("low")` is `0`, i.e. no filtering.

## Behavior / UX

- **Badge.** Each file-group header shows a small colored pill — `HIGH`
  (green) / `MED` (yellow) / `LOW` (dim) — computed from the group's **top
  match score** (`scoreTier(group.topScore)`).
- **Filter control.** A segmented control labeled `Min relevance:` with three
  buttons `HIGH | MED | LOW`, styled like the existing mode toggle
  (`.qmd-mode-btn`). `LOW` means "show all" (floor 0) and is the default, so
  default behavior is unchanged.
- **Server-side filtering.** The selected tier's `tierFloor` is passed as
  `minScore` to `client.query`. Changing the tier **re-runs the query** (same
  path as pressing Enter), since hybrid mode does not search on every keystroke.
- **Visibility.** The entire tier UI (badge + control) renders only when
  `tiersActive(mode, settings.rerank)` is true. In keyword mode or with rerank
  off, neither the badge nor the control appears.

Selection semantics: the floor is a *minimum*. `MED` shows results scoring
≥ 0.4 (MED and HIGH); `HIGH` shows only ≥ 0.7; `LOW` shows everything.

## Data flow / component changes

- **`src/score-tier.ts`** (new): the pure tier model above.
- **`src/group-results.ts`**: `ResultMatch` gains `score: number`; `FileGroup`
  gains `topScore: number` (max score among the group's matches). Stop dropping
  the score.
- **`src/grouped-result-list.ts`**: `RenderGroupedOptions` gains
  `showTiers: boolean`. When true, render a tier badge on each file header from
  `scoreTier(group.topScore)`. Badge sits on the header's right side, just
  before the existing `.qmd-file-tag`.
- **`src/views/search-view.ts`**:
  - Build the `Min relevance` control (only when `tiersActive`).
  - Persist the chosen tier (`settings.searchMinTier`, saved via the existing
    `saveSettings`).
  - When `tiersActive`, add `minScore: tierFloor(tier)` to the **main hybrid**
    `client.query` options. The keyword fallback query does **not** get a
    `minScore` (lex scores aren't comparable to 0.7/0.4).
  - Pass `showTiers: tiersActive(...)` to `renderGroupedResults`.
  - On tier change, re-run the query via the existing `execute("enter")` path.
- **`src/settings.ts`**: add `searchMinTier: ScoreTier` to `QmdSettings` and
  `DEFAULT_SETTINGS` (default `"low"`).
- **`styles.css`**: `.qmd-tier-badge` plus `.qmd-tier-high` (`--color-green`),
  `.qmd-tier-med` (`--color-yellow`), `.qmd-tier-low` (`--text-faint`); and the
  `Min relevance` control reusing the `.qmd-mode-btn` / `.is-active` look.

## Edge cases

### Rerank gating

Hybrid reranks only when `settings.rerank` is true (`search-view.ts:119`:
`const rerank = mode === "hybrid" ? this.settings.rerank : false`). Only
reranked scores are 0–1, so the 0.7/0.4 thresholds are valid only then. With
rerank off, scores are raw RRF and the thresholds would mark everything LOW and
make the filter useless. Therefore `tiersActive` returns false unless
`mode === "hybrid" && rerank`, and the tier UI is hidden in every other case.
Keyword mode never gets tiers (its lex scores are not comparable to 0.7/0.4).

A change to `settings.rerank` (made in the settings tab) takes effect on the
next view open / mode switch — the open view is not live-updated. Acceptable
for v1.

### Zero-result fallback

`fallbackOnZero` defaults to false, so by default a filter returning zero
results simply shows an empty state. But if a user has enabled `fallbackOnZero`,
a `HIGH` filter returning zero would wrongly trigger the keyword fallback (which
ignores the filter and shows unrelated keyword hits). Fix: when an active floor
is > 0, **suppress the zero-result fallback** and instead show a tailored empty
message, e.g. `No HIGH-relevance results — try MED or LOW.` The *failure*
fallback (query errored) still runs — that is error recovery, not a filter
effect. Implementation: guard at the call site in `execute` (keep
`decideFallback` pure and unchanged).

## Testing

- **`test/score-tier.test.ts`** (new): boundaries for `scoreTier` (0.7, 0.699,
  0.4, 0.399, 0, 1), `tierFloor` values, `tierLabel`, and the `tiersActive`
  truth table.
- **`test/group-results.test.ts`** (extend): `topScore` equals the max score in
  a group; `score` is threaded into each `ResultMatch`.
- **Build-time verification step (in the plan):** confirm reranked hybrid
  `/query` scores are actually in 0–1 against the live daemon, since the tier
  semantics depend on it. Characterize the keyword-mode score range too, to
  document why keyword mode is excluded.

## Out of scope (YAGNI)

- Configurable thresholds (hard-code qmd's 0.7 / 0.4).
- Per-match badges (badge is per file group, from the top match).
- Tiers in keyword mode.
- Client-side instant re-filter (we re-query server-side instead).
- Live-updating the open view when `settings.rerank` changes.
