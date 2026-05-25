import { describe, it, expect } from "vitest";
import { shouldRefresh } from "../src/related-refresh";

describe("shouldRefresh", () => {
  const md = (path: string) => ({ path, extension: "md" });

  it("clears when there is no active file", () => {
    expect(shouldRefresh(null, "notes/a.md", true)).toEqual({ action: "clear" });
  });

  it("skips non-markdown active files (keeps current)", () => {
    expect(shouldRefresh({ path: "x.pdf", extension: "pdf" }, "notes/a.md", true)).toEqual({ action: "skip" });
  });

  it("skips when the active note is already shown", () => {
    expect(shouldRefresh(md("notes/a.md"), "notes/a.md", true)).toEqual({ action: "skip" });
  });

  it("defers when the panel is hidden", () => {
    expect(shouldRefresh(md("notes/b.md"), "notes/a.md", false)).toEqual({ action: "defer" });
  });

  it("renders a new markdown note when visible", () => {
    expect(shouldRefresh(md("notes/b.md"), "notes/a.md", true)).toEqual({ action: "render", path: "notes/b.md" });
  });

  it("renders when nothing has been shown yet", () => {
    expect(shouldRefresh(md("notes/a.md"), null, true)).toEqual({ action: "render", path: "notes/a.md" });
  });
});
