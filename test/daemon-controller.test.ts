import { describe, it, expect, vi } from "vitest";
import { DaemonController } from "../src/daemon-controller";

function makeClient(ok: boolean) {
  return { health: vi.fn(async () => ({ ok })) };
}

describe("DaemonController", () => {
  it("isRunning reflects client health", async () => {
    const dc = new DaemonController({ client: makeClient(true), spawnFn: vi.fn(), binaryPath: "qmd", port: 8181 });
    expect(await dc.isRunning()).toBe(true);
  });

  it("start spawns detached daemon with correct args and unrefs", () => {
    const unref = vi.fn();
    const spawnFn = vi.fn(() => ({ unref }));
    const dc = new DaemonController({ client: makeClient(false), spawnFn, binaryPath: "/usr/bin/qmd", port: 9000 });
    dc.start();
    expect(spawnFn).toHaveBeenCalledWith(
      "/usr/bin/qmd",
      ["mcp", "--http", "--daemon", "--port", "9000"],
      expect.objectContaining({ detached: true, stdio: "ignore" }),
    );
    expect(unref).toHaveBeenCalled();
  });

  it("ensureRunning returns 'already' when healthy and does not spawn", async () => {
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }));
    const dc = new DaemonController({ client: makeClient(true), spawnFn, binaryPath: "qmd", port: 8181 });
    expect(await dc.ensureRunning()).toBe("already");
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
