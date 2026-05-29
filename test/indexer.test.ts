import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Indexer } from "../src/indexer";

type Call = string[];
function makeRunner() {
  const calls: Call[] = [];
  const run = vi.fn(async (args: string[]) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; });
  return { run, calls };
}
const base = { vaultPath: "/v", collectionName: "vault", mask: "**/*.md", debounceMs: 1000 };

describe("Indexer.ensureCollection", () => {
  it("adds + embeds vault when collection missing", async () => {
    const { run, calls } = makeRunner();
    const ix = new Indexer({ ...base, runQmd: run });
    await ix.ensureCollection(["docs", "beads"]);
    expect(calls[0]).toEqual(["collection", "add", "/v", "--name", "vault", "--mask", "**/*.md"]);
    expect(calls[1]).toEqual(["embed", "-c", "vault"]);
  });
  it("does nothing when collection already present", async () => {
    const { run, calls } = makeRunner();
    const ix = new Indexer({ ...base, runQmd: run });
    await ix.ensureCollection(["vault", "docs"]);
    expect(calls).toEqual([]);
  });
});

describe("Indexer.notifyChange debounce + serialize", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces multiple changes into one reindex (update + embed)", async () => {
    const { run, calls } = makeRunner();
    const ix = new Indexer({ ...base, runQmd: run });
    ix.notifyChange(); ix.notifyChange(); ix.notifyChange();
    expect(calls).toEqual([]);                 // nothing before debounce elapses
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([["update"], ["embed", "-c", "vault"]]);
  });

  it("dirty flag coalesces mid-flight changes into exactly one re-run", async () => {
    // Set up a runner where the FIRST runQmd(["update"]) call blocks until
    // we manually resolve, all subsequent calls resolve immediately.
    const calls: string[][] = [];
    let unblockFirstUpdate!: () => void;
    let callCount = 0;
    const run = vi.fn(async (args: string[]) => {
      callCount++;
      calls.push(args);
      if (callCount === 1) {
        // First call (["update"] from reindex #1) — block until unblocked.
        await new Promise<void>((resolve) => { unblockFirstUpdate = resolve; });
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const ix = new Indexer({ ...base, runQmd: run });

    // Fire first notifyChange; advance timer so reindex #1 starts and
    // blocks inside runQmd(["update"]).
    ix.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    // reindex #1 is now awaiting the blocked promise; one call recorded so far.
    expect(calls).toEqual([["update"]]);

    // Fire two more notifyChange calls while reindex #1 is still in flight.
    // Their debounce timers each fire and call reindex(), but reindex() sees
    // running=true and just sets dirty=true (no runQmd calls).
    ix.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    ix.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    // Still only the one blocked call — dirty re-run hasn't happened yet.
    expect(calls).toEqual([["update"]]);

    // Unblock the first runQmd(["update"]).  The rest of reindex #1
    // (embed call + finally block + dirty re-run) executes as microtasks /
    // already-resolved promises, so we just need to drain them.
    unblockFirstUpdate();
    // Drain all pending microtasks and any zero-delay timers that arise
    // from the dirty re-run (reindex() recurses synchronously in finally,
    // so no new setTimeout is involved — just Promise resolution chains).
    await vi.advanceTimersByTimeAsync(0);

    // Expected sequence: original run (update + embed) + one dirty re-run (update + embed).
    expect(calls).toEqual([
      ["update"],
      ["embed", "-c", "vault"],
      ["update"],
      ["embed", "-c", "vault"],
    ]);
  });

  it("dispose during in-flight reindex cancels the pending dirty re-run", async () => {
    let unblock!: () => void;
    const calls: string[][] = [];
    const run = vi.fn((args: string[]) => {
      calls.push(args);
      if (calls.length === 1) {
        return new Promise<{ code: number; stdout: string; stderr: string }>((res) => {
          unblock = () => res({ code: 0, stdout: "", stderr: "" });
        });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    });
    const ix = new Indexer({ ...base, runQmd: run });
    ix.notifyChange();
    await vi.advanceTimersByTimeAsync(1000); // reindex #1 starts, blocks on the first runQmd(["update"])
    ix.notifyChange();
    await vi.advanceTimersByTimeAsync(1000); // reindex #2 sees running → sets dirty
    ix.dispose();                            // disposed = true
    unblock();                               // reindex #1 finishes update + embed
    await vi.advanceTimersByTimeAsync(0);    // drain microtasks; finally sees dirty but disposed → NO re-run
    expect(calls).toEqual([["update"], ["embed", "-c", "vault"]]); // exactly one run, no dirty re-run
  });
});
