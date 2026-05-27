import { describe, it, expect, vi } from "vitest";

const { openSpy } = vi.hoisted(() => ({ openSpy: vi.fn() }));

// The external branch dynamically imports doc-preview (which imports obsidian's
// Component, absent from the test mock); stub it so only branch selection is tested.
vi.mock("../src/views/doc-preview", () => ({
  DocPreviewModal: class {
    open = openSpy;
    constructor(public app?: unknown, public client?: unknown, public docid?: string) {}
  },
}));

import { openResolvedTarget, toEditorLine } from "../src/open-action";

type App = Parameters<typeof openResolvedTarget>[0];
type Client = Parameters<typeof openResolvedTarget>[1];

describe("openResolvedTarget", () => {
  it("opens a vault target via workspace.openLinkText", async () => {
    const openLinkText = vi.fn();
    const app = { workspace: { openLinkText } } as unknown as App;
    await openResolvedTarget(app, {} as Client, { kind: "vault", path: "notes/x.md" });
    expect(openLinkText).toHaveBeenCalledWith("notes/x.md", "", false);
  });

  it("does not open a vault link for an external target", async () => {
    const openLinkText = vi.fn();
    const app = { workspace: { openLinkText } } as unknown as App;
    await openResolvedTarget(app, {} as Client, { kind: "external", file: "docs/y.md", docid: "#b2" });
    expect(openLinkText).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalled();
  });

  it("scrolls to the line when a line is provided", async () => {
    const setEphemeralState = vi.fn();
    const openLinkText = vi.fn();
    const app = {
      workspace: { openLinkText, getActiveViewOfType: () => ({ setEphemeralState }) },
    } as unknown as App;
    await openResolvedTarget(app, {} as Client, { kind: "vault", path: "notes/x.md" }, 5);
    expect(setEphemeralState).toHaveBeenCalledWith({ line: 4 });
  });
});

describe("toEditorLine", () => {
  it("converts 1-indexed qmd lines to 0-indexed editor lines", () => {
    expect(toEditorLine(1)).toBe(0);
    expect(toEditorLine(50)).toBe(49);
  });
  it("clamps non-positive lines to 0", () => {
    expect(toEditorLine(0)).toBe(0);
    expect(toEditorLine(-3)).toBe(0);
  });
});
