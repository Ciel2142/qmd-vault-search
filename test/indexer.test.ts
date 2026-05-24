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
});
