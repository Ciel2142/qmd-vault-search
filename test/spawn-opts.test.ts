import { describe, it, expect } from "vitest";
import { platformSpawnOptions } from "../src/spawn-opts";

describe("platformSpawnOptions", () => {
  it("returns base options unchanged on non-Windows", () => {
    expect(platformSpawnOptions({ detached: true, stdio: "ignore" }, "linux")).toEqual({ detached: true, stdio: "ignore" });
    expect(platformSpawnOptions({ stdio: ["ignore", "pipe", "pipe"] }, "darwin")).toEqual({ stdio: ["ignore", "pipe", "pipe"] });
  });
  it("adds shell + windowsHide on win32, preserving base options", () => {
    expect(platformSpawnOptions({ detached: true, stdio: "ignore" }, "win32")).toEqual({ detached: true, stdio: "ignore", shell: true, windowsHide: true });
  });
});
