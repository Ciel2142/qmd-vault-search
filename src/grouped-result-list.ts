import type { App, Component } from "obsidian";
import type { QmdClient } from "./qmd-client";
import type { FileGroup } from "./group-results";
import { openResolvedTarget } from "./open-action";
import { highlightTerms } from "./highlight";

export interface RenderGroupedOptions {
  container: HTMLElement;
  groups: FileGroup[];
  terms: string[];          // highlight terms; [] in hybrid mode
  app: App;
  client: QmdClient;
  collapsed: Set<string>;    // group keys currently collapsed (mutated as the user folds)
  emptyText: string;
  viewType: string;          // hover-link `source`
  hoverParent: Component;    // hover-link `hoverParent` (the SearchView)
  sourcePath: string;        // hover-link `sourcePath`
}

interface FileItem {
  fileEl: HTMLElement;
  key: string;
  chevron: HTMLElement;
}

/** Render qmd results grouped by file, native-search style. Used only by SearchView. */
export function renderGroupedResults(opts: RenderGroupedOptions): void {
  const { container, groups, terms, app, client, collapsed, emptyText, viewType, hoverParent, sourcePath } = opts;
  container.empty();
  if (groups.length === 0) {
    container.createDiv({ cls: "qmd-status", text: emptyText });
    return;
  }

  const matchCount = groups.reduce((n, g) => n + g.matches.length, 0);
  const head = container.createDiv({ cls: "qmd-results-head" });
  head.createSpan({
    cls: "qmd-results-count",
    text: `${groups.length} ${groups.length === 1 ? "file" : "files"} · ${matchCount} ${matchCount === 1 ? "match" : "matches"}`,
  });
  const collapseAll = head.createSpan({ cls: "qmd-collapse-all" });

  const items: FileItem[] = [];
  const apply = (it: FileItem, isCollapsed: boolean): void => {
    it.fileEl.toggleClass("is-collapsed", isCollapsed);
    it.chevron.setText(isCollapsed ? "▶" : "▼");
    if (isCollapsed) collapsed.add(it.key);
    else collapsed.delete(it.key);
  };

  for (const group of groups) {
    const fileEl = container.createDiv({ cls: "qmd-file" });
    const header = fileEl.createDiv({ cls: "qmd-file-header" });
    const chevron = header.createSpan({ cls: "qmd-chevron" });
    header.createSpan({ cls: "qmd-file-title", text: group.title });
    header.createSpan({ cls: "qmd-file-tag", text: group.tag });

    const matchesEl = fileEl.createDiv({ cls: "qmd-matches" });
    for (const m of group.matches) {
      const row = matchesEl.createDiv({ cls: "qmd-match" });
      row.createSpan({ cls: "qmd-match-line", text: String(m.line) });
      const textEl = row.createSpan({ cls: "qmd-match-text" });
      for (const seg of highlightTerms(m.context, terms)) {
        const span = textEl.createSpan({ text: seg.text });
        if (seg.hit) span.addClass("qmd-hl");
      }
      row.onclick = (): void => { void openResolvedTarget(app, client, group.target, m.line); };
      if (group.target.kind === "vault") {
        const linktext = group.target.path;
        row.addEventListener("mouseover", (event) => {
          app.workspace.trigger("hover-link", { event, source: viewType, hoverParent, targetEl: row, linktext, sourcePath });
        });
      }
    }

    const item: FileItem = { fileEl, key: group.key, chevron };
    items.push(item);
    apply(item, collapsed.has(group.key));
    header.onclick = (): void => { apply(item, !item.fileEl.hasClass("is-collapsed")); };
  }

  const syncCollapseAllLabel = (): void => {
    const anyExpanded = items.some((it) => !it.fileEl.hasClass("is-collapsed"));
    collapseAll.setText(anyExpanded ? "Collapse all" : "Expand all");
  };
  syncCollapseAllLabel();
  collapseAll.onclick = (): void => {
    const anyExpanded = items.some((it) => !it.fileEl.hasClass("is-collapsed"));
    for (const it of items) apply(it, anyExpanded);
    syncCollapseAllLabel();
  };
}
