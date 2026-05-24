export type RunQmd = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface IndexerDeps {
  runQmd: RunQmd;
  vaultPath: string;       // absolute vault root
  collectionName: string;  // "vault"
  mask: string;            // "**/*.md"
  debounceMs: number;
}

export class Indexer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private dirty = false;
  private disposed = false;

  constructor(private deps: IndexerDeps) {}

  /** Register + index the vault as a qmd collection if not already present. */
  async ensureCollection(existingCollections: string[]): Promise<void> {
    if (existingCollections.includes(this.deps.collectionName)) return;
    await this.deps.runQmd(["collection", "add", this.deps.vaultPath, "--name", this.deps.collectionName, "--mask", this.deps.mask]);
    await this.deps.runQmd(["embed", "-c", this.deps.collectionName]);
  }

  /** Debounced trigger; call on every vault modify/create/delete/rename. */
  notifyChange(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.reindex(); }, this.deps.debounceMs);
  }

  /** Serialized reindex: no overlap; a change during a run schedules one re-run. */
  private async reindex(): Promise<void> {
    if (this.disposed) return;
    if (this.running) { this.dirty = true; return; }
    this.running = true;
    try {
      await this.deps.runQmd(["update"]);
      await this.deps.runQmd(["embed", "-c", this.deps.collectionName]);
    } finally {
      this.running = false;
      if (this.dirty && !this.disposed) { this.dirty = false; await this.reindex(); }
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.disposed = true;
  }
}
