export type StaleState =
  | { kind: "clean" }
  | { kind: "stale" }
  | { kind: "deferred-by-merge" }
  | { kind: "error"; message: string };

/** Minimal status-bar element surface — covers what we use. */
export interface StatusBarEl {
  setText(text: string): void;
  setAttr(name: string, value: string): void;
}

const LABELS = {
  clean: "",
  stale: "qmd: indexing…",
  "deferred-by-merge": "qmd: merge in progress",
  error: "qmd: index error",
} as const;

const TOOLTIPS = {
  clean: "",
  stale: "Vault changed (pull). Reindexing.",
  "deferred-by-merge": "Resolve merge conflicts, then reindex will run.",
} as const;

export class GitStaleStatus {
  private state: StaleState = { kind: "clean" };
  constructor(private el: StatusBarEl) { this.render(); }

  setState(next: StaleState): void {
    this.state = next;
    this.render();
  }

  snapshot(): StaleState { return this.state; }

  private render(): void {
    this.el.setText(LABELS[this.state.kind]);
    const tooltip =
      this.state.kind === "error"
        ? this.state.message.slice(0, 200)
        : TOOLTIPS[this.state.kind];
    this.el.setAttr("aria-label", tooltip);
  }
}
