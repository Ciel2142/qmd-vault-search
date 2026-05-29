import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerGitTriggers, type GitTriggerDeps } from "../src/git-triggers";

function deps(overrides: Partial<GitTriggerDeps> = {}): GitTriggerDeps {
  return {
    onHeadChange: vi.fn(() => () => {}),
    isMergeInProgress: vi.fn().mockResolvedValue(false),
    reindexNow: vi.fn().mockResolvedValue(undefined),
    setStale: vi.fn(),
    debounceMs: 0,
    autoReindex: true,
    lastReindexAt: () => 0,
    ...overrides,
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("registerGitTriggers", () => {
  it("subscribes to head-change when autoReindex is true", () => {
    const d = deps();
    registerGitTriggers(d);
    expect(d.onHeadChange).toHaveBeenCalledTimes(1);
  });

  it("does NOT subscribe when autoReindex is false", () => {
    const d = deps({ autoReindex: false });
    registerGitTriggers(d);
    expect(d.onHeadChange).not.toHaveBeenCalled();
  });

  it("on head-change: sets stale, calls reindex, then clean", async () => {
    let fired = () => {};
    const d = deps({ onHeadChange: vi.fn().mockImplementation((cb: () => void) => { fired = cb; return () => {}; }) });
    registerGitTriggers(d);
    fired();
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTimersAsync();
    expect(d.setStale).toHaveBeenCalledWith({ kind: "stale" });
    expect(d.reindexNow).toHaveBeenCalledTimes(1);
    expect(d.setStale).toHaveBeenLastCalledWith({ kind: "clean" });
  });

  it("on head-change in merge state: sets deferred, skips reindex", async () => {
    let fired = () => {};
    const d = deps({
      onHeadChange: vi.fn().mockImplementation((cb: () => void) => { fired = cb; return () => {}; }),
      isMergeInProgress: vi.fn().mockResolvedValue(true),
    });
    registerGitTriggers(d);
    fired();
    await vi.runAllTimersAsync();
    expect(d.setStale).toHaveBeenCalledWith({ kind: "deferred-by-merge" });
    expect(d.reindexNow).not.toHaveBeenCalled();
  });

  it("coalesces rapid head-change bursts into one reindex", async () => {
    let fired = () => {};
    const d = deps({
      onHeadChange: vi.fn().mockImplementation((cb: () => void) => { fired = cb; return () => {}; }),
      debounceMs: 50,
    });
    registerGitTriggers(d);
    fired(); fired(); fired();
    await vi.advanceTimersByTimeAsync(60);
    await vi.runAllTimersAsync();
    expect(d.reindexNow).toHaveBeenCalledTimes(1);
  });

  it("fire during in-flight reindex triggers exactly one follow-up", async () => {
    let resolveReindex!: () => void;
    let fired = () => {};
    const d = deps({
      onHeadChange: vi.fn().mockImplementation((cb: () => void) => { fired = cb; return () => {}; }),
      reindexNow: vi.fn().mockImplementation(() => new Promise<void>((r) => { resolveReindex = r; })),
    });
    registerGitTriggers(d);
    fired();
    await vi.runAllTimersAsync();          // debounce fires → runOnce starts → reindexNow #1 is in-flight (blocked)
    expect(d.reindexNow).toHaveBeenCalledTimes(1);
    fired();                               // arrives while reindexNow #1 still awaiting
    await vi.advanceTimersByTimeAsync(0);  // 2nd debounce fires → runOnce sees running → sets pending
    expect(d.reindexNow).toHaveBeenCalledTimes(1);
    resolveReindex();                      // complete #1 → finally drains pending → exactly one follow-up
    await vi.runAllTimersAsync();
    expect(d.reindexNow).toHaveBeenCalledTimes(2);
  });

  it("reindex failure sets error state", async () => {
    let fired = () => {};
    const d = deps({
      onHeadChange: vi.fn().mockImplementation((cb: () => void) => { fired = cb; return () => {}; }),
      reindexNow: vi.fn().mockRejectedValue(new Error("boom")),
    });
    registerGitTriggers(d);
    fired();
    await vi.runAllTimersAsync();
    expect(d.setStale).toHaveBeenLastCalledWith({ kind: "error", message: "boom" });
  });

  it("skips reindex when a reindex completed within the dedup window", async () => {
    let fired = () => {};
    const now = Date.now();
    const d = deps({
      onHeadChange: vi.fn().mockImplementation((cb: () => void) => { fired = cb; return () => {}; }),
      lastReindexAt: () => now,
    });
    registerGitTriggers(d);
    fired();
    await vi.runAllTimersAsync();
    expect(d.reindexNow).not.toHaveBeenCalled();
    expect(d.setStale).toHaveBeenLastCalledWith({ kind: "clean" });
  });

  it("reindexes when the last reindex is older than the dedup window", async () => {
    let fired = () => {};
    const base = Date.now();
    const d = deps({
      onHeadChange: vi.fn().mockImplementation((cb: () => void) => { fired = cb; return () => {}; }),
      lastReindexAt: () => base - 6000,
    });
    registerGitTriggers(d);
    fired();
    await vi.runAllTimersAsync();
    expect(d.reindexNow).toHaveBeenCalledTimes(1);
  });

  it("returns a disposer that unsubscribes", () => {
    const unsubscribe = vi.fn();
    const d = deps({ onHeadChange: vi.fn().mockReturnValue(unsubscribe) });
    const dispose = registerGitTriggers(d);
    dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
