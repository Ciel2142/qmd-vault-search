import { App, EditorSuggest, TFile } from "obsidian";
import type { Editor, EditorPosition, EditorSuggestContext, EditorSuggestTriggerInfo } from "obsidian";
import type { QmdClient, QmdSearchResult, QmdSubQuery } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { parseLinkTrigger, planLinkQuery } from "../link-suggest";
import { makeVaultResolver } from "../vault-resolver";
import { resolveOpenTarget } from "../open-target";
import { cleanSnippet } from "../clean-snippet";

/** A qmd vault-collection hit plus the real vault TFile it resolved to. */
export interface LinkSuggestion {
  result: QmdSearchResult;
  file: TFile;
}

/**
 * Semantic `@@` link suggester. Typing `@@<text>` opens a vec-only suggester
 * over the vault collection; choosing a hit inserts a normal `[[wikilink]]`.
 * Uses `@@` (not `[[`) because Obsidian's built-in `[[` suggester claims any
 * `[[...` context, so a custom suggester there never shows (confirmed by smoke);
 * `@@` leaves the built-in untouched and lets this popup win.
 * Long-lived (registered once); mirrors the search modal's debounce + searchId stale-guard.
 */
export class QmdLinkSuggest extends EditorSuggest<LinkSuggestion> {
  private searchId = 0;
  private warmAt = 0;
  private warming = false;

  constructor(app: App, private client: QmdClient, private settings: QmdSettings) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const t = parseLinkTrigger(before);
    if (!t) return null;
    this.warmEmbedder();
    return { start: { line: cursor.line, ch: t.startCh }, end: cursor, query: t.query };
  }

  /**
   * Fire-and-forget embedder warm-up: prime the daemon's vec model so the first real
   * suggestion query doesn't pay the cold model-load (~700ms measured). Called from
   * onTrigger, which Obsidian fires on every keystroke while an `@@` span is open (not
   * only when it opens). A `warming` in-flight guard collapses a burst of keystrokes to
   * one request, and the 60s cooldown starts only AFTER a warm succeeds — so if the
   * daemon was down (the exact cold-start case) the next `@@` retries instead of being
   * throttled out for a minute. Errors are ignored; warming is best-effort.
   */
  private warmEmbedder(): void {
    if (this.warming || Date.now() - this.warmAt < 60_000) return;
    this.warming = true;
    void this.client
      .query({ searches: [{ type: "vec", query: "warm" }], collections: [this.settings.vaultCollectionName], rerank: false, limit: 1 })
      .then(() => { this.warmAt = Date.now(); })
      .catch(() => { /* daemon down / superseded — leave warmAt so the next @@ retries */ })
      .finally(() => { this.warming = false; });
  }

  /**
   * Resolve directly off the query — no internal debounce. An EditorSuggest only
   * opens its popup on the trigger cycle, so a result that resolves on a later
   * setTimeout never reopens the popup that was closed while typing; the hit then
   * surfaced only after the next keystroke (the "@@ shows nothing until I press
   * space" bug). Returning the live query promise lets Obsidian open the popup as
   * soon as the hits land; the searchId guard drops an out-of-order (superseded)
   * response so a slow earlier keystroke can't clobber a newer one.
   */
  getSuggestions(context: EditorSuggestContext): Promise<LinkSuggestion[]> {
    const plan = planLinkQuery(context.query, this.settings);
    if (plan.kind !== "run") return Promise.resolve([]);
    return this.run(plan.searches, plan.collections, plan.rerank);
  }

  private async run(searches: QmdSubQuery[], collections: string[], rerank: boolean): Promise<LinkSuggestion[]> {
    const id = ++this.searchId;
    // Fresh resolver per query: the suggester is long-lived and the vault mutates while editing.
    const resolveVaultPath = makeVaultResolver(this.app);
    try {
      const results = await this.client.query({ searches, collections, rerank });
      if (id !== this.searchId) return []; // superseded by a newer keystroke
      const out: LinkSuggestion[] = [];
      for (const result of results) {
        // qmd prefixes paths with the collection name (`vault/...`) and handelizes them
        // (spaces/punctuation/underscores → hyphens); resolveOpenTarget strips the prefix +
        // reverses the slug. External-collection hits aren't [[-linkable.
        const target = resolveOpenTarget(result.file, result.docid, resolveVaultPath, this.settings.vaultCollectionName);
        if (target.kind !== "vault") continue;
        const file = this.app.vault.getAbstractFileByPath(target.path);
        if (file instanceof TFile) out.push({ result, file });
      }
      return out;
    } catch {
      // Daemon down or query error → no popup, no crash.
      return [];
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
