import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { makeRunGit } from "../src/git-runner";

function fakeChild() {
  const e = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  e.stdout = new EventEmitter();
  e.stderr = new EventEmitter();
  return e;
}

describe("makeRunGit", () => {
  it("passes argv straight to spawn (no shell)", async () => {
    const child = fakeChild();
    const spawn = vi.fn().mockReturnValue(child);
    const runGit = makeRunGit({ spawn, cwd: "/vault" });
    const p = runGit(["init"]);
    child.stdout.emit("data", Buffer.from("Initialized\n"));
    child.emit("close", 0);
    const result = await p;
    expect(spawn).toHaveBeenCalledWith("git", ["init"], expect.objectContaining({ cwd: "/vault" }));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Initialized");
  });

  it("returns code=-1 with stringified error on spawn ENOENT", async () => {
    const child = fakeChild();
    const spawn = vi.fn().mockReturnValue(child);
    const runGit = makeRunGit({ spawn, cwd: "/vault" });
    const p = runGit(["status"]);
    child.emit("error", Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }));
    const result = await p;
    expect(result.code).toBe(-1);
    expect(result.stderr).toContain("ENOENT");
  });

  it("captures stderr on non-zero exit", async () => {
    const child = fakeChild();
    const spawn = vi.fn().mockReturnValue(child);
    const runGit = makeRunGit({ spawn, cwd: "/vault" });
    const p = runGit(["fetch", "origin", "main"]);
    child.stderr.emit("data", Buffer.from("fatal: Authentication failed\n"));
    child.emit("close", 128);
    const result = await p;
    expect(result.code).toBe(128);
    expect(result.stderr).toContain("Authentication failed");
  });
});
