# qmd × Obsidian — Phase 3 · Semantic `[[?` link suggestions (EditorSuggest)

- **Date:** 2026-05-26
- **Status:** Approved design — ready for implementation planning
- **Project:** `/home/igi21/experiements/obsidian/obsidian_qmd_plugin`
- **Parent spec:** `docs/superpowers/specs/2026-05-24-qmd-obsidian-plugin-design.md` (Phase-3 deferred item *"[[link]] + semantic overlay (graph concept C)"*)
- **Issue:** `obsidian_qmd_plugin-8yk`
- **Builds on:** the shipped `QmdClient`, `makeVaultResolver`, `cleanSnippet`, and the search-modal debounce + `searchId` stale-guard pattern (`src/views/search-modal.ts`).

## Goal

Augment the `[[wikilink]]` workflow with qmd semantic suggestions: typing `[[?<text>` opens an `EditorSuggest` of **semantically related vault notes**; choosing one inserts a normal `[[wikilink]]`. This is the *complement* to Obsidian's built-in `[[` suggester, which only does filename/prefix matching.

## Locked decisions

| Decision | Choice | Source |
|---|---|---|
| Scope | **`EditorSuggest` only.** Drop the graph-overlay interpretation: Obsidian's core graph is not API-extensible, and the plugin's own `focus-graph-view` + the pending `#2` (5jz) whole-corpus similarity-map already cover graph visualization. | Q: scope |
| Trigger | **`[[?` sentinel.** Typing `?` immediately after `[[` enters semantic mode; the `?` is stripped on insert. Chosen to avoid contending with Obsidian's built-in `[[` link suggester (it occupies the plain `[[` trigger). | Q: trigger |
| Query | **vec only, rerank off.** Pure semantic query on the typed partial — the differentiator from core's filename match. rerank off keeps the typeahead responsive. | Q: query type |
| Collection scope | **Vault collection only** — `[settings.vaultCollectionName]`. A wikilink can only target a vault note; external-collection docs are not `[[`-linkable. | Constraint |
| Debounce / cancellation | Reuse `settings.searchDebounceMs` + a `searchId` stale-guard (same pattern as the search modal; `requestUrl` cannot abort). | Derived |
| Insertion | `app.fileManager.generateMarkdownLink(tfile, activeFilePath)` — respects the user's link-format settings (wikilink vs markdown, shortest/relative/absolute). | Obsidian convention |
| Settings | **None added.** The `[[?` sentinel is explicit opt-in, so no enable/disable toggle is needed for v1. | YAGNI |

## qmd / codebase facts this design relies on

- `QmdClient.query(opts)` (`src/qmd-client.ts`) accepts `searches: QmdSubQuery[]` (`type:"lex"|"vec"|"hyde"`), `collections`, `rerank`, `minScore`, `limit`; returns `QmdSearchResult[]` (`docid`, `file`, `title`, `score`, `snippet`, …). Reused unchanged.
- `makeVaultResolver(app)` (`src/vault-resolver.ts`) builds `(collectionRelativePath) => string | null`, mapping qmd's slugged collection-relative paths back to real vault paths (handles `My Note.md` → `My-Note.md`). Reused to turn a vault-collection hit into a real `TFile`.
- `cleanSnippet(snippet)` (`src/clean-snippet.ts`) strips qmd's line-number / `@@` noise. Reused for the suggestion body.
- The search modal (`src/views/search-modal.ts`) established the debounce + `searchId` + pending-resolver pattern for an as-you-type Obsidian surface backed by `requestUrl`. This view mirrors it.
- Views are **not** unit-tested in this repo; pure modules are. `EditorSuggest` needs the Obsidian runtime (absent from the test mock), so the view is manual-smoke only; its pure logic (`parseLinkTrigger`, `planLinkQuery`) is unit-tested.
- `EditorSuggest<T>` public API: `onTrigger(cursor, editor, file) → EditorSuggestTriggerInfo | null`, `getSuggestions(ctx) → T[] | Promise<T[]>`, `renderSuggestion(value, el)`, `selectSuggestion(value, evt)`. The active session's `{ editor, start, end, file, query }` is exposed as `this.context`. Registered via `Plugin.registerEditorSuggest(...)`.

## Components

**New — pure logic (MUST NOT import `obsidian`; unit-tested mock-free):**

| File | Responsibility |
|---|---|
| `src/link-suggest.ts` | `parseLinkTrigger(textBeforeCursor): LinkTrigger \| null` — detect the `[[?<partial>` sentinel ending at the cursor. `planLinkQuery(query, settings): LinkQueryPlan` — `{kind:"clear"}` for an empty query, else `{kind:"run", searches:[{type:"vec",query}], collections:[vaultCollectionName], rerank:false}`. |

```ts
import type { QmdSubQuery } from "./qmd-client";
import type { QmdSettings } from "./settings";

export interface LinkTrigger { query: string; startCh: number; }

/**
 * Detect the `[[?<partial>` semantic-link sentinel ending at the cursor.
 * Returns the partial query + the column of the opening `[`, or null when the
 * text before the cursor is not an open `[[?...`. Plain `[[` never matches, so
 * Obsidian's built-in link suggester is left untouched.
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

**New — view (untested; manual smoke):**

| File | Responsibility |
|---|---|
| `src/views/link-suggest-view.ts` | `QmdLinkSuggest extends EditorSuggest<LinkSuggestion>`. Holds `client`, `settings`, a debounce timer, a `searchId`, and the pending-resolver ref. `onTrigger` → `parseLinkTrigger`; `getSuggestions` → debounce + stale-guard + `planLinkQuery` + `client.query` + resolve each hit to a vault `TFile` (drop non-resolving); `renderSuggestion` → title + clean snippet; `selectSuggestion` → `generateMarkdownLink` + `replaceRange`. |

`LinkSuggestion` = `{ result: QmdSearchResult; file: TFile }` (the qmd hit plus its resolved vault file).

**Changed:**

| File | Change |
|---|---|
| `src/main.ts` | `this.registerEditorSuggest(new QmdLinkSuggest(this.app, this.client, this.settings));` (live `client`/`settings` refs, same rationale as the modal command). |

No `settings.ts` / `styles.css` changes (reuses existing snippet/title CSS classes and `searchDebounceMs` / `vaultCollectionName`).

## Trigger lifecycle — `onTrigger`

```ts
const before = editor.getLine(cursor.line).slice(0, cursor.ch);
const t = parseLinkTrigger(before);
if (!t) return null;
return { start: { line: cursor.line, ch: t.startCh }, end: cursor, query: t.query };
```

- `start` is the column of the opening `[` of `[[?`; `end` is the cursor. On select, the whole `[[?partial` span is replaced by the generated link — no stray `?`, no double brackets.
- The regex `/\[\[\?([^\[\]]*)$/` requires the literal `[[?` and a partial containing no `[`/`]`, anchored at the cursor. So `[[` (no `?`) → null (core suggester handles it); a closed `[[?x]]` with the cursor after `]]` → null.

## Query lifecycle — `getSuggestions(context)`

Mirrors the search modal:
1. **Debounce** `settings.searchDebounceMs`; supersede any pending timer/promise (resolve the old one `[]`).
2. On fire, `const id = ++this.searchId`. `planLinkQuery(context.query, settings)`; `clear` → resolve `[]`.
3. Build a fresh `makeVaultResolver(this.app)` (the `EditorSuggest` instance is long-lived and the vault mutates while editing, so resolve per settled query, not once at construction).
4. `await client.query({ searches, collections, rerank })`. If `id !== this.searchId` → resolve `[]` (superseded).
5. Map each hit through the resolver → a `TFile` (`app.vault.getAbstractFileByPath`); **drop hits that don't resolve** to a vault file. Resolve `[]` on error (daemon down → no popup, no crash).

## Rendering — `renderSuggestion(s, el)`

- `el.createDiv({ cls:"qmd-result-title", text: s.result.title || s.file.basename })`
- `el.createDiv({ cls:"qmd-snippet", text: cleanSnippet(s.result.snippet) })`

(No badge — every suggestion is a vault note by construction.)

## Selecting — `selectSuggestion(s, evt)`

```ts
const ctx = this.context;             // active EditorSuggestContext
if (!ctx) return;
const link = this.app.fileManager.generateMarkdownLink(s.file, ctx.file?.path ?? "");
ctx.editor.replaceRange(link, ctx.start, ctx.end);
```

`generateMarkdownLink` respects the user's link settings (wikilink vs markdown, shortest/relative/absolute). It returns the full link form, replacing the entire `[[?partial` span.

## Testing

| Test | Kind | Asserts |
|---|---|---|
| `test/link-suggest.test.ts` | unit (mock-free) | `parseLinkTrigger`: `[[?neural` → `{query:"neural", startCh:0}`; mid-line `foo [[?net` → `{query:"net", startCh:4}`; empty `[[?` → `{query:"", startCh:…}`; plain `[[foo` → `null`; closed `[[?x]]` (cursor after) → `null`; a query containing a bracket (`[[?a[b`) → `null` (the `[` is excluded from the partial, so `$` is not reached and no trigger fires — acceptable; brackets inside a link query are unsupported). `planLinkQuery`: empty → `clear`; `"foo"` → `{run, [vec foo], [vault], rerank:false}`. |
| existing suites | unit | stay green (no shared module changed except an additive `main.ts` registration). |
| Manual smoke (Obsidian) | manual | `[[?`+text opens the semantic suggester (not core's); suggestions are vault notes with clean snippets; picking inserts a proper `[[wikilink]]` (no `?`); plain `[[` still shows the built-in suggester; daemon-down → no popup, no crash; rapid typing never shows stale hits. |

## Known risk

Obsidian's built-in `[[` link suggester may still contend for the `[[?` context. The `?` sentinel is chosen to minimize this (the built-in finds no filename matching `?`, and our `onTrigger` returns a valid trigger). The manual-smoke task **must confirm our popup wins**; if the built-in fights it, the fallback is a non-`[[` trigger character (e.g. a dedicated prefix), decided after the smoke result.

## Out of scope (YAGNI)

- Graph overlay / semantic edges (core graph not extensible; covered by focus-graph + `#2`).
- Linking to external-collection docs (not `[[`-linkable).
- Enable/disable settings toggle (the `[[?` sentinel is explicit opt-in).
- Alias insertion (`[[note|alias]]`).
- Blending the current note's surrounding context into the query (typed partial only).
- Reranking / hybrid lex+vec (pure vec by decision).

## Acceptance criteria

1. Typing `[[?<text>` triggers the qmd semantic suggester; plain `[[` is untouched (built-in suggester still works).
2. Suggestions are vec/semantic hits from the **vault collection only**, debounced + stale-guarded, rendered with title + clean snippet.
3. Choosing a suggestion inserts a proper `[[wikilink]]` via `generateMarkdownLink` (respecting link settings), replacing the whole `[[?partial` span with no stray `?`.
4. Daemon-down or query error → no suggestions shown; the editor never crashes.
5. Rapid typing never lets an earlier query's hits overwrite a later one's.
6. `parseLinkTrigger` + `planLinkQuery` are unit-tested; the `EditorSuggest` view is manual-smoke only (repo convention).
