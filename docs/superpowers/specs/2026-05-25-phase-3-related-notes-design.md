# qmd × Obsidian — Phase 3 · Related Notes panel

- **Date:** 2026-05-25
- **Status:** Approved design — ready for implementation planning
- **Project:** `/home/igi21/experiements/obsidian/obsidian_qmd_plugin`
- **Parent spec:** `docs/superpowers/specs/2026-05-24-qmd-obsidian-plugin-design.md` (this is Phase-3 deferred item *"auto related to current note list"*)

## Goal

A dedicated right-sidebar panel that ambiently shows the top-k semantically related documents for the **active note**, refreshing as the user navigates the vault. It is the lightweight, always-visible, scannable counterpart to the on-demand focus graph — same neighbor data, textual surface.

## Locked decisions

| Decision | Choice | Source |
|---|---|---|
| **Surface** | Dedicated right-sidebar `ItemView` (not a section in SearchView). | Q1 |
| **Refresh** | Auto on note switch — debounced ~300 ms, **only when the panel is visible**. | Q1 |
| **Corpus** | `[vaultCollectionName, ...externalCollections]` — same set the focus graph uses. External hits get a badge + open in `DocPreviewModal`. | Q2 |
| **Row rendering** | **Extract** a shared `renderResultList` from SearchView; both views use it (single source of truth). | Approach A |
| **Top-k** | New setting `relatedTopK` (default **8** — a 12-row list reads long). | Confirmed |
| **Similarity floor** | Reuse existing `graphMinScore` (same semantics). | — |

## qmd / codebase facts this design relies on

- **`deriveNeighbors(client, {content, collections, selfFile, limit, minScore})`** (`src/neighbors.ts:23`) already derives doc→doc neighbors via a `vec` query built from the source note's excerpt, drops self, slices to `limit`. Unit-tested (`test/neighbors.test.ts`). Reused as-is.
- Collection selection is **not** shared state: SearchView uses an ephemeral per-panel chip `Set`; `FocusGraphView` uses `[vaultCollectionName, ...externalCollections]` directly. "Match graph/search selection" therefore resolves to the focus-graph set — there is nothing else to match.
- Result-row rendering + open split (`renderResults` / `openTarget`) currently lives **private inside `SearchView`** (`src/views/search-view.ts:66-95`): row = title · collection badge · score% · `graph` link · snippet; click → vault `workspace.openLinkText` or external `DocPreviewModal`; `graph` link → `app.workspace.trigger("qmd:center-graph", file, label)`.
- `resolveOpenTarget(file, docid, isVaultFile)` (`src/open-target.ts`) classifies vault vs external.
- `FocusGraphView.centerOn` (`src/views/focus-graph-view.ts:33`) establishes the `renderToken` pattern for dropping superseded async renders — reused here.

## Components

**New (3):**

| File | Responsibility |
|---|---|
| `src/views/related-notes-view.ts` | `RelatedNotesView extends ItemView`, `VIEW_TYPE_QMD_RELATED = "qmd-related-notes"`. Right-sidebar panel "Related notes". State: `lastPath`, `renderToken`, debounce timer, `visible` flag. In `onOpen`: registers `active-leaf-change` via `this.registerEvent` (auto-cleaned on close) + an `IntersectionObserver` on `containerEl` (disconnected in `onClose`) that flips `visible` and, on hidden→visible, calls `scheduleRefresh()`. |
| `src/result-list.ts` | Shared `renderResultList({ container, results, app, client, emptyText })` — the row markup, the vault/external open split (`openLinkText` / `DocPreviewModal`), and the `qmd:center-graph` trigger. Single source of truth for both views. |
| `src/related-refresh.ts` | Pure `shouldRefresh(activeFile, lastPath, visible) → RefreshDecision`. The only branching logic; fully unit-testable, no mocks. |

**Changed (3):**

| File | Change |
|---|---|
| `src/views/search-view.ts` | Call `renderResultList` instead of private `renderResults`/`openTarget` (move-only, behavior-preserving). |
| `src/main.ts` | Register the view; ribbon icon; command `open-qmd-related` "Open related notes panel"; `activateRelatedView()`. Stays thin (matches SearchView/Graph wiring). |
| `src/settings.ts` + `src/settings-tab.ts` | Add `relatedTopK: number` (default 8) + a settings-tab control. Reuse `graphMinScore`. |

## Refresh logic — `shouldRefresh`

```ts
type RefreshDecision =
  | { action: "skip" }                 // same note, or non-markdown → keep current
  | { action: "clear" }                // no active file → empty state
  | { action: "defer" }                // panel hidden → re-evaluated on reveal
  | { action: "render"; path: string };

// activeFile: { path: string; extension: string } | null
function shouldRefresh(activeFile, lastPath, visible): RefreshDecision
//  null                       → clear
//  extension !== "md"         → skip
//  path === lastPath          → skip
//  !visible                   → defer
//  else                       → render(path)
```

## Data flow

```
active-leaf-change  /  IntersectionObserver(hidden→visible)
 → scheduleRefresh()                         [debounce ~300 ms]
 → decide = shouldRefresh(getActiveFile(), lastPath, visible)
     skip   → return
     clear  → render empty state; lastPath = null
     defer  → return                          (re-evaluated on reveal)
     render → token = ++renderToken
              content   = await vault.cachedRead(file)
              neighbors = await deriveNeighbors(client, {
                            content,
                            collections: [vaultCollectionName, ...externalCollections],
                            selfFile: path,
                            limit:   settings.relatedTopK,
                            minScore: settings.graphMinScore })
              if token !== renderToken → drop (superseded)
              renderResultList({ container, results: neighbors, ... })
              lastPath = path
```

- **Visibility:** tracked by `IntersectionObserver` on `containerEl`; `visible` flag fed into `shouldRefresh`. On a hidden→visible transition it calls `scheduleRefresh()` — `shouldRefresh` then renders because the current active note ≠ `lastPath`. No pending-path bookkeeping: `lastPath` already encodes what is shown. This covers "user expands the collapsed sidebar / switches to this tab."
- **Staleness:** `renderToken` (same guard as `FocusGraphView.centerOn`) drops async results superseded by a newer refresh.
- **Loading state:** before the await on a `render`, show "Finding related notes…" (only when the path changed, to avoid flicker).

## Error handling

| Case | Behavior |
|---|---|
| Daemon down / `query` throws | Inline panel message ("qmd daemon not reachable — related notes unavailable"). **No `Notice`** (navigation fires often). `lastPath` left unchanged → next switch retries. |
| Empty neighbors | "No related notes found." |
| No active file | "Open a note to see related notes." |
| Non-markdown active (PDF/image) | `skip` — keep last shown. |
| Active note not yet indexed | Show whatever qmd returns (possibly empty/stale) — same behavior as the focus graph. |

## Reuse (not rebuilt)

`deriveNeighbors` · `resolveOpenTarget` · `DocPreviewModal` · `qmd:center-graph` event · collection set = `[vaultCollectionName, ...externalCollections]`.

## Testing (TDD)

- **`test/related-refresh.test.ts`** — `shouldRefresh` truth table: `null → clear`; `.pdf → skip`; `path === lastPath → skip`; `!visible → defer`; new markdown + visible → `render`. Pure, no mocks.
- `test/neighbors.test.ts` — already covers derivation; unchanged.
- `renderResultList` + the views — **not** unit-tested (DOM/Obsidian-heavy; consistent with existing untested views). Verified by build + **manual smoke** in a scratch vault:
  1. Open panel → switch notes → list updates to each note's neighbors.
  2. Click a vault row → note opens **and** the panel re-centers on it.
  3. Click an external row → `DocPreviewModal` opens.
  4. Click a row's `graph` link → focus graph centers on that doc.
  5. Stop the daemon → inline "not reachable" message, no Notice spam.
  6. Collapse the sidebar, navigate several notes, re-expand → panel shows the current note's neighbors (refresh on reveal).
- **SearchView refactor** — behavior-preserving; verified by build + manual search smoke (no `search-view` tests exist to break).

## Acceptance criteria

1. `npm test` green incl. new `related-refresh` tests; `npm run build` clean, `main.js` emits.
2. Panel opens from ribbon + command, lives in the right sidebar.
3. Navigating notes updates the list (debounced); hidden panel does no queries and flushes on reveal.
4. Vault/external rows behave as in SearchView (open split, badges, score, graph link).
5. SearchView search behavior unchanged after the renderer extraction.

## Out of scope (this spec)

Hover tooltips · pinning a note · drag-to-graph · configurable row contents · the other five Phase-3 features (command-palette, similarity-map, `[[link]]`+semantic overlay, BM25 as-you-type, qmd per-file reindex). Each gets its own spec → plan → implementation cycle.
