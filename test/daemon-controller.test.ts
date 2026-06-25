import { describe, it, expect, vi } from "vitest";
import { DaemonController } from "../src/daemon-controller";

function makeClient(ok: boolean, collections: string[] = []) {
  return {
    health: vi.fn(async () => ({ ok })),
    mcpStatus: vi.fn(async () => collections.map((name) => ({ name }))),
  };
}

describe("DaemonController", () => {
  it("isRunning reflects client health", async () => {
    const dc = new DaemonController({ client: makeClient(true), spawnFn: vi.fn(), binaryPath: "qmd", port: 8181, vaultCollectionName: "vault_obsidian_vault" });
    expect(await dc.isRunning()).toBe(true);
  });

  it("start spawns detached daemon with correct args and unrefs", () => {
    const unref = vi.fn();
    const spawnFn = vi.fn(() => ({ unref }));
    const dc = new DaemonController({ client: makeClient(false), spawnFn, binaryPath: "/usr/bin/qmd", port: 9000, vaultCollectionName: "vault_obsidian_vault" });
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
    const dc = new DaemonController({ client: makeClient(true), spawnFn, binaryPath: "qmd", port: 8181, vaultCollectionName: "vault_obsidian_vault" });
    expect(await dc.ensureRunning()).toBe("already");
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("servesVaultCollection is false when a healthy daemon's status lacks our collection (foreign daemon on the port)", async () => {
    const dc = new DaemonController({ client: makeClient(true, ["beads-docs", "chezmoi"]), spawnFn: vi.fn(), binaryPath: "qmd", port: 8181, vaultCollectionName: "vault_obsidian_vault" });
    expect(await dc.servesVaultCollection()).toBe(false);
  });

  it("servesVaultCollection is true when the daemon serves our configured collection", async () => {
    const dc = new DaemonController({ client: makeClient(true, ["beads-docs", "vault_obsidian_vault"]), spawnFn: vi.fn(), binaryPath: "qmd", port: 8181, vaultCollectionName: "vault_obsidian_vault" });
    expect(await dc.servesVaultCollection()).toBe(true);
  });

  it("servesVaultCollection is false and skips the status call when health is down", async () => {
    const client = makeClient(false, ["vault_obsidian_vault"]);
    const dc = new DaemonController({ client, spawnFn: vi.fn(), binaryPath: "qmd", port: 8181, vaultCollectionName: "vault_obsidian_vault" });
    expect(await dc.servesVaultCollection()).toBe(false);
    expect(client.mcpStatus).not.toHaveBeenCalled();
  });

  it("servesVaultCollection is false when the status lookup throws", async () => {
    const client = { health: vi.fn(async () => ({ ok: true })), mcpStatus: vi.fn(async () => { throw new Error("boom"); }) };
    const dc = new DaemonController({ client, spawnFn: vi.fn(), binaryPath: "qmd", port: 8181, vaultCollectionName: "vault_obsidian_vault" });
    expect(await dc.servesVaultCollection()).toBe(false);
  });
});
