import type { StaleState } from "./git-stale-status";

const REINDEX_DEDUP_MS = 5000;

export interface GitTriggerDeps {
  onHeadChange: (cb: () => void) => () => void;
  isMergeInProgress: () => Promise<boolean>;
  reindexNow: () => Promise<void>;
  setStale: (s: StaleState) => void;
  debounceMs: number;
  autoReindex: boolean;
  /** Epoch ms of the last completed reindex (0 if none). Used to skip a redundant reindex within REINDEX_DEDUP_MS of a manual sync/pull (spec §6.2). */
  lastReindexAt: () => number;
}

/** Wire head-change → guard → debounce → reindex. Returns a disposer. */
export function registerGitTriggers(deps: GitTriggerDeps): () => void {
  if (!deps.autoReindex) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;

  const runOnce = async () => {
    if (running) { pending = true; return; }
    running = true;
    try {
      if (await deps.isMergeInProgress()) {
        deps.setStale({ kind: "deferred-by-merge" });
        return;
      }
      if (Date.now() - deps.lastReindexAt() < REINDEX_DEDUP_MS) {
        deps.setStale({ kind: "clean" });
        return;
      }
      deps.setStale({ kind: "stale" });
      try {
        await deps.reindexNow();
        deps.setStale({ kind: "clean" });
      } catch (e: unknown) {
        deps.setStale({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      running = false;
      if (pending) { pending = false; void runOnce(); }
    }
  };

  const onFire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void runOnce(); }, deps.debounceMs);
  };

  const unsubscribe = deps.onHeadChange(onFire);
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
