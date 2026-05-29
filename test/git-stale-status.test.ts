import { describe, it, expect } from "vitest";
import { GitStaleStatus, type StatusBarEl } from "../src/git-stale-status";

type FakeEl = StatusBarEl & { text: string; attrs: Record<string, string> };

function fakeEl(): FakeEl {
  const el = { text: "", attrs: {} as Record<string, string> } as FakeEl;
  el.setText = (s: string) => { el.text = s; };
  el.setAttr = (k: string, v: string) => { el.attrs[k] = v; };
  return el;
}

describe("GitStaleStatus", () => {
  it("starts in clean state with hidden tile", () => {
    const el = fakeEl();
    const s = new GitStaleStatus(el);
    expect(el.text).toBe("");
  });

  it("transitions clean → stale → clean", () => {
    const el = fakeEl();
    const s = new GitStaleStatus(el);
    s.setState({ kind: "stale" });
    expect(el.text).toContain("indexing");
    s.setState({ kind: "clean" });
    expect(el.text).toBe("");
  });

  it("shows deferred-by-merge tile until cleared", () => {
    const el = fakeEl();
    const s = new GitStaleStatus(el);
    s.setState({ kind: "deferred-by-merge" });
    expect(el.text).toContain("merge in progress");
  });

  it("shows error tile with stderr tooltip (truncated to 200 chars)", () => {
    const el = fakeEl();
    const s = new GitStaleStatus(el);
    const longErr = "x".repeat(500);
    s.setState({ kind: "error", message: longErr });
    expect(el.text).toContain("error");
    expect((el.attrs["aria-label"] ?? "").length).toBeLessThanOrEqual(200);
  });

  it("snapshot returns the current state", () => {
    const el = fakeEl();
    const s = new GitStaleStatus(el);
    s.setState({ kind: "stale" });
    expect(s.snapshot()).toEqual({ kind: "stale" });
  });
});
