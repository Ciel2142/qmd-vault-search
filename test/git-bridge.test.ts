import { describe, it, expect, vi } from "vitest";
import { isObsidianGitPresent, invokeGitCommand, onHeadChange } from "../src/git-bridge";

type App = {
  plugins: { plugins: Record<string, unknown> };
  commands: { commands: Record<string, unknown>; executeCommandById: (id: string) => boolean };
  workspace: {
    on: (event: string, cb: () => void) => { event: string; cb: () => void };
    offref: (ref: unknown) => void;
  };
};

function fakeApp(opts: { hasPlugin: boolean; hasCommand?: string }): App {
  const handlers: { event: string; cb: () => void }[] = [];
  return {
    plugins: { plugins: opts.hasPlugin ? { "obsidian-git": {} } : {} },
    commands: {
      commands: opts.hasCommand ? { [opts.hasCommand]: { id: opts.hasCommand } } : {},
      executeCommandById: vi.fn().mockReturnValue(true),
    },
    workspace: {
      on: (event, cb) => { const ref = { event, cb }; handlers.push(ref); return ref; },
      offref: vi.fn(),
    },
  };
}

describe("git-bridge", () => {
  it("detects obsidian-git presence", () => {
    expect(isObsidianGitPresent(fakeApp({ hasPlugin: true }) as never)).toBe(true);
    expect(isObsidianGitPresent(fakeApp({ hasPlugin: false }) as never)).toBe(false);
  });

  it("invokeGitCommand calls executeCommandById with the correct id", async () => {
    const app = fakeApp({ hasPlugin: true, hasCommand: "obsidian-git:push" });
    const result = await invokeGitCommand(app as never, "obsidian-git:push");
    expect(result.ok).toBe(true);
    expect(app.commands.executeCommandById).toHaveBeenCalledWith("obsidian-git:push");
  });

  it("invokeGitCommand returns error when command id is not registered", async () => {
    const app = fakeApp({ hasPlugin: true });
    const result = await invokeGitCommand(app as never, "obsidian-git:does-not-exist");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
    expect(app.commands.executeCommandById).not.toHaveBeenCalled();
  });

  it("onHeadChange subscribes to the workspace event and returns a disposer", () => {
    const app = fakeApp({ hasPlugin: true });
    const cb = vi.fn();
    const dispose = onHeadChange(app as never, cb);
    expect(typeof dispose).toBe("function");
    dispose();
    expect(app.workspace.offref).toHaveBeenCalled();
  });
});
