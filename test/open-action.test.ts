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

import { openResolvedTarget } from "../src/open-action";

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
});
