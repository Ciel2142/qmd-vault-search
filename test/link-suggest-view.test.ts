import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import { QmdLinkSuggest } from "../src/views/link-suggest-view";
import type { QmdSettings } from "../src/settings";
import type { QmdSearchResult } from "../src/qmd-client";

const settings = { vaultCollectionName: "vault_obsidian_vault" } as unknown as QmdSettings;

function makeApp(files: string[]) {
  return {
    vault: {
      getMarkdownFiles: () => files.map((path) => ({ path })),
      getAbstractFileByPath: (p: string) =>
        files.includes(p) ? Object.assign(new TFile(), { path: p, basename: p.split("/").pop()!.replace(/\.md$/, "") }) : null,
    },
  };
}

function makeResult(file: string): QmdSearchResult {
  return { docid: "#1", file, title: "T", score: 1, context: null, line: 0, snippet: "" };
}

describe("QmdLinkSuggest.getSuggestions", () => {
  it("resolves directly to mapped vault suggestions for a run-plan query (so the popup opens on the current keystroke, not the next)", async () => {
    const app = makeApp(["esb/Note.md"]);
    const client = { query: vi.fn(async () => [makeResult("vault_obsidian_vault/esb/Note.md")]), mcpStatus: vi.fn(async () => []) };
    const sug = new QmdLinkSuggest(app as never, client as never, settings);

    const res = await sug.getSuggestions({ query: "diadoc" } as never);

    expect(res.map((s) => s.file.path)).toEqual(["esb/Note.md"]);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("returns empty for a blank/whitespace query without hitting the daemon", async () => {
    const app = makeApp(["esb/Note.md"]);
    const client = { query: vi.fn(async () => []), mcpStatus: vi.fn(async () => []) };
    const sug = new QmdLinkSuggest(app as never, client as never, settings);

    expect(await sug.getSuggestions({ query: "   " } as never)).toEqual([]);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("a superseded earlier query resolves empty; the latest keystroke's results win (stale-guard replaces the debounce)", async () => {
    const app = makeApp(["a/A.md", "b/B.md"]);
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const client = {
      query: vi
        .fn()
        .mockImplementationOnce(() => new Promise((r) => { resolveFirst = () => r([makeResult("vault_obsidian_vault/a/A.md")]); }))
        .mockImplementationOnce(() => new Promise((r) => { resolveSecond = () => r([makeResult("vault_obsidian_vault/b/B.md")]); })),
      mcpStatus: vi.fn(async () => []),
    };
    const sug = new QmdLinkSuggest(app as never, client as never, settings);

    const p1 = sug.getSuggestions({ query: "a" } as never);
    const p2 = sug.getSuggestions({ query: "ab" } as never);
    resolveSecond(); // newer query finishes first
    resolveFirst(); // older finishes later — must not clobber the newer result

    expect((await p2).map((s) => s.file.path)).toEqual(["b/B.md"]);
    expect(await p1).toEqual([]);
  });
});
