import { describe, it, expect } from "vitest";
import { resolveOpenTarget } from "../src/open-target";

describe("resolveOpenTarget", () => {
  const isVault = (p: string) => p.startsWith("notes/");
  it("routes vault-resident paths to 'vault'", () => {
    expect(resolveOpenTarget("notes/x.md", "#a1", isVault)).toEqual({ kind: "vault", path: "notes/x.md" });
  });
  it("routes non-vault paths to 'external' with docid", () => {
    expect(resolveOpenTarget("docs/y.md", "#b2", isVault)).toEqual({ kind: "external", file: "docs/y.md", docid: "#b2" });
  });
});
