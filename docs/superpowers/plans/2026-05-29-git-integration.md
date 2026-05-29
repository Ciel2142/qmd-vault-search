# Git Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the design in `docs/superpowers/specs/2026-05-29-git-integration-design.md`: auto-reindex on `obsidian-git:head-change`, a proxy "reindex + commit-and-sync" command, an empty-vault bootstrap command, a status-bar staleness tile, and a settings toggle. All broad git UX is delegated to the `obsidian-git` plugin via stable command IDs and workspace events.

**Architecture:** Two new responsibilities live in `src/`:
1. A **git bridge** — detects the presence of `obsidian-git`, invokes its commands by ID, subscribes to its workspace events. Never touches the plugin instance internals.
2. **qmd-side glue** — a merge-state guard, a status-bar tile, a triggers module that wires `head-change → debounce → reindex`, and a bootstrap pipeline that spawns `git init / remote add / fetch / reset --hard` for empty vaults only.

The existing `Indexer` gains a single public method (`reindexNow`) so callers can await a full reindex. No new dependencies. All git CLI work goes through a new `runGit` runner that mirrors `runQmd` (argv array, never a shell).

**Tech Stack:** TypeScript, Vitest (`npm test` → `vitest run`, node env, `obsidian` aliased to `test/__mocks__/obsidian.ts`), esbuild, Obsidian plugin API, system `git` CLI via `child_process.spawn`.

**Bead:** `obsidian_qmd_plugin-8ns` (research deliverable already merged at `docs/superpowers/specs/2026-05-29-git-integration-design.md`). This implementation gets a separate bead created at the end (Task 13).

**Read before starting:**

- `docs/superpowers/specs/2026-05-29-git-integration-design.md` — the spec this plan implements. Every decision (D1–D7), data flow, and out-of-scope item is fixed there.
- `src/cli.ts` — `makeRunQmd` is the pattern for `runGit`. Argv array, never `{shell: true}`, never string-concatenated commands.
- `src/indexer.ts` — `notifyChange()` is the existing debounced fire-and-forget entry point. We add `reindexNow()` to await a single run.
- `src/main.ts` — plugin registration pattern. New commands, status bar, and event listeners attach in `onload`.
- `src/views/daemon-status-bar.ts` — pattern for our status-bar tile (read it first; mirror its structure).
- `test/indexer.test.ts` + `test/__mocks__/obsidian.ts` — vitest setup; the mock exports trivial classes for `Plugin`, `Notice`, `TFile`, etc. Tests run in node env (no DOM).

**Conventions observed in this codebase:**

- File names are kebab-case in `src/`, single responsibility per file, ≤ ~150 LOC where possible.
- Public functions on shared modules have explicit parameter and return types; locals can infer.
- No `any` in app code; use `unknown` and narrow at boundaries.
- No `console.log` in production code; surface user-facing errors via `Notice`.
- Tests live under `test/<module-name>.test.ts`. Import obsidian classes from the mock.
- Commits are small and topic-scoped, one task per commit.

**Out of scope (do NOT touch in this plan):**

- Mobile platform paths (`isomorphic-git`).
- Submodules, multi-repo vault layouts.
- Conflict resolution UI (delegated to `obsidian-git`).
- Authentication / credentials UI.
- Commit message authoring.
- `.gitignore` management (a follow-up doc-only task may exist later).

---

## File structure

### New files (`src/`)

| File | Responsibility | Approx. LOC |
|---|---|---|
| `git-runner.ts` | `runGit(args, opts) → Promise<{code, stdout, stderr}>` mirror of `runQmd`, no shell. | ~30 |
| `git-bridge.ts` | obsidian-git detection + `executeCommandById` + workspace event subscription. | ~80 |
| `git-merge-guard.ts` | Resolve `.git` (dir or file → external gitdir) + detect `MERGE_HEAD`/`REBASE_HEAD`. | ~70 |
| `git-bootstrap.ts` | Empty-vault check + URL/branch validation + spawn `git init/remote add/fetch/reset --hard` pipeline. | ~130 |
| `git-stale-status.ts` | Status-bar tile + state machine (clean/stale/deferred/error). Mirrors `daemon-status-bar.ts`. | ~90 |
| `git-triggers.ts` | Wires `head-change → guard → debounce → reindexNow → status updates`. Registers proxy commands. | ~120 |
| `views/git-bootstrap-modal.ts` | Tiny modal prompting for remote URL + branch. Mirrors existing modal patterns. | ~60 |

### Touched files

| File | Reason |
|---|---|
| `src/settings.ts` | Add two fields: `gitAutoReindex: boolean` (default `true`), `gitAutoReindexDebounceMs: number` (default `2000`). |
| `src/settings-tab.ts` | Render one new toggle: "Auto-reindex after pull (obsidian-git)". |
| `src/indexer.ts` | Add `reindexNow(): Promise<void>` that runs the internal `reindex()` and returns its completion. |
| `src/main.ts` | Register triggers, mount status tile, register bootstrap command. |

### New tests

| Test file | Targets |
|---|---|
| `test/git-runner.test.ts` | argv passthrough, `ENOENT` handling. |
| `test/git-bridge.test.ts` | Plugin detection, `executeCommandById` invocation, missing-command result, event subscriber + disposer. |
| `test/git-merge-guard.test.ts` | Directory `.git`, file `.git` → gitdir, MERGE_HEAD, REBASE_HEAD, neither. |
| `test/git-bootstrap.test.ts` | Empty-vault scan (ignores `.obsidian/`), refusal on non-empty, URL/branch validation, spawn pipeline order. |
| `test/git-stale-status.test.ts` | State transitions: clean → stale → clean, stale → error sticky, deferred sticky. |
| `test/git-triggers.test.ts` | Listener registered, merge-guard short-circuits reindex, debounce coalescing, idempotent on rapid re-fires. |
| `test/indexer.test.ts` | Add a case: `reindexNow()` awaits a full single reindex; concurrent calls share the in-flight promise. |
| `test/settings.test.ts` | Defaults include `gitAutoReindex: true` and `gitAutoReindexDebounceMs: 2000`. |

---

## Task 1: Settings fields

**Files:**
- Modify: `src/settings.ts`
- Test: `test/settings.test.ts`

- [ ] **Step 1: Add failing test**

Edit `test/settings.test.ts` — locate the `DEFAULT_SETTINGS` test block, add a new assertion:

```typescript
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("DEFAULT_SETTINGS — git integration fields", () => {
  it("defaults gitAutoReindex to true", () => {
    expect(DEFAULT_SETTINGS.gitAutoReindex).toBe(true);
  });
  it("defaults gitAutoReindexDebounceMs to 2000", () => {
    expect(DEFAULT_SETTINGS.gitAutoReindexDebounceMs).toBe(2000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/settings.test.ts -t "git integration fields"`
Expected: 2 failures — `gitAutoReindex` undefined, `gitAutoReindexDebounceMs` undefined.

- [ ] **Step 3: Add settings fields**

Edit `src/settings.ts`:

In `interface QmdSettings`, add:
```typescript
  gitAutoReindex: boolean;          // reindex after obsidian-git pull (on head-change)
  gitAutoReindexDebounceMs: number; // idle delay after head-change before reindex
```

In `DEFAULT_SETTINGS`, add:
```typescript
  gitAutoReindex: true,
  gitAutoReindexDebounceMs: 2000,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/settings.test.ts`
Expected: all green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts test/settings.test.ts
git commit -m "feat(settings): add gitAutoReindex + debounce defaults"
```

---

## Task 2: `runGit` CLI runner

**Files:**
- Create: `src/git-runner.ts`
- Test: `test/git-runner.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/git-runner.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git-runner.test.ts`
Expected: module not found / function not defined.

- [ ] **Step 3: Implement `git-runner.ts`**

Create `src/git-runner.ts`:

```typescript
import type { SpawnOptions, ChildProcess } from "node:child_process";

export interface GitRunResult { code: number; stdout: string; stderr: string }
export type RunGit = (args: string[]) => Promise<GitRunResult>;

export interface MakeRunGitDeps {
  spawn: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
  cwd: string;
}

/** Serialized-by-caller git CLI runner. Argv only (no shell). Never throws. */
export function makeRunGit(deps: MakeRunGitDeps): RunGit {
  return (args) =>
    new Promise((resolve) => {
      const child = deps.spawn("git", args, { stdio: ["ignore", "pipe", "pipe"], cwd: deps.cwd });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => resolve({ code: -1, stdout, stderr: String(e) }));
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/git-runner.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/git-runner.ts test/git-runner.test.ts
git commit -m "feat(git): add runGit CLI runner (argv only, no shell)"
```

---

## Task 3: `Indexer.reindexNow()`

The existing `Indexer.reindex` is private and fire-and-forget. We need to await a single reindex completion from the triggers module. Add a public method that drives the existing serialized internal `reindex()` and returns a promise.

**Files:**
- Modify: `src/indexer.ts`
- Test: `test/indexer.test.ts`

- [ ] **Step 1: Add failing test**

Append to `test/indexer.test.ts`:

```typescript
describe("Indexer.reindexNow()", () => {
  it("awaits the underlying reindex and resolves on success", async () => {
    const calls: string[][] = [];
    const runQmd = async (args: string[]) => {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    };
    const idx = new Indexer({ runQmd, vaultPath: "/v", collectionName: "vault", mask: "**/*.md", debounceMs: 10 });
    await idx.reindexNow();
    expect(calls).toEqual([["update"], ["embed", "-c", "vault"]]);
  });

  it("coalesces concurrent calls into one run", async () => {
    let active = 0;
    let maxActive = 0;
    const runQmd = async (_args: string[]) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { code: 0, stdout: "", stderr: "" };
    };
    const idx = new Indexer({ runQmd, vaultPath: "/v", collectionName: "vault", mask: "**/*.md", debounceMs: 10 });
    await Promise.all([idx.reindexNow(), idx.reindexNow(), idx.reindexNow()]);
    expect(maxActive).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/indexer.test.ts -t "reindexNow"`
Expected: `idx.reindexNow is not a function`.

- [ ] **Step 3: Add `reindexNow` to `Indexer`**

Edit `src/indexer.ts`. Replace the existing `reindex` private method block with:

```typescript
  private inflight: Promise<void> | null = null;

  /** Public entry: returns a promise that resolves when the next reindex finishes (cascaded re-runs included). */
  reindexNow(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.reindex().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async reindex(): Promise<void> {
    if (this.disposed) return;
    if (this.running) { this.dirty = true; return; }
    this.running = true;
    try {
      await this.deps.runQmd(["update"]);
      await this.deps.runQmd(["embed", "-c", this.deps.collectionName]);
    } finally {
      this.running = false;
      if (this.dirty && !this.disposed) { this.dirty = false; await this.reindex(); }
    }
  }
```

Also update `notifyChange` to call the new public entry instead of the private one — find the line:

```typescript
    this.timer = setTimeout(() => { void this.reindex(); }, this.deps.debounceMs);
```

Replace with:

```typescript
    this.timer = setTimeout(() => { void this.reindexNow(); }, this.deps.debounceMs);
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run test/indexer.test.ts`
Expected: all green (new cases plus existing cases).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/indexer.ts test/indexer.test.ts
git commit -m "feat(indexer): public reindexNow() returns single-flight promise"
```

---

## Task 4: `git-bridge` — detect + invoke + listen

**Files:**
- Create: `src/git-bridge.ts`
- Test: `test/git-bridge.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/git-bridge.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git-bridge.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement `git-bridge.ts`**

Create `src/git-bridge.ts`:

```typescript
import type { App, EventRef } from "obsidian";

const OBSIDIAN_GIT_ID = "obsidian-git";
export const HEAD_CHANGE_EVENT = "obsidian-git:head-change";

export interface InvokeResult { ok: boolean; error?: string }

/** True iff the obsidian-git community plugin is installed AND enabled in this vault. */
export function isObsidianGitPresent(app: App): boolean {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
  return !!plugins && OBSIDIAN_GIT_ID in plugins;
}

/** Invoke an obsidian-git command by id. Returns a structured result; never throws. */
export async function invokeGitCommand(app: App, id: string): Promise<InvokeResult> {
  const commands = (app as unknown as { commands?: { commands?: Record<string, unknown>; executeCommandById?: (id: string) => boolean } }).commands;
  if (!commands?.commands || !(id in commands.commands)) {
    return { ok: false, error: `obsidian-git command '${id}' not found. Update obsidian-git or open an issue.` };
  }
  try {
    const ran = commands.executeCommandById?.(id) ?? false;
    return ran ? { ok: true } : { ok: false, error: `Command '${id}' did not execute.` };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Subscribe to the post-pull head-change event. Returns a disposer. */
export function onHeadChange(app: App, cb: () => void): () => void {
  const ref = app.workspace.on(HEAD_CHANGE_EVENT as never, cb as never) as unknown as EventRef;
  return () => app.workspace.offref(ref);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run test/git-bridge.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/git-bridge.ts test/git-bridge.test.ts
git commit -m "feat(git): bridge to obsidian-git (detect/invoke/head-change)"
```

---

## Task 5: `git-merge-guard` — detect merge / rebase state

`git-merge-guard.isMergeInProgress(vaultPath)` returns `true` when the repo at `vaultPath` is mid-merge or mid-rebase. It must resolve `.git` when it is a file (`gitdir: <path>` indirection — used in the iCloud workaround documented in obsidian-git's "Getting Started").

**Files:**
- Create: `src/git-merge-guard.ts`
- Test: `test/git-merge-guard.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/git-merge-guard.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMergeInProgress } from "../src/git-merge-guard";

let root = "";

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "qmd-mg-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("isMergeInProgress", () => {
  it("returns false when .git does not exist", async () => {
    expect(await isMergeInProgress(root)).toBe(false);
  });

  it("returns false when .git is a directory but no merge state files exist", async () => {
    mkdirSync(join(root, ".git"));
    expect(await isMergeInProgress(root)).toBe(false);
  });

  it("returns true when .git/MERGE_HEAD is present", async () => {
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "MERGE_HEAD"), "deadbeef\n");
    expect(await isMergeInProgress(root)).toBe(true);
  });

  it("returns true when .git/REBASE_HEAD is present", async () => {
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "REBASE_HEAD"), "cafef00d\n");
    expect(await isMergeInProgress(root)).toBe(true);
  });

  it("returns true when rebase-merge or rebase-apply directory is present", async () => {
    mkdirSync(join(root, ".git", "rebase-merge"), { recursive: true });
    expect(await isMergeInProgress(root)).toBe(true);
  });

  it("resolves .git file → external gitdir and detects MERGE_HEAD there", async () => {
    const external = join(root, "external-gitdir");
    mkdirSync(external, { recursive: true });
    writeFileSync(join(external, "MERGE_HEAD"), "abc123\n");
    writeFileSync(join(root, ".git"), `gitdir: ${external}\n`);
    expect(await isMergeInProgress(root)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git-merge-guard.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement `git-merge-guard.ts`**

Create `src/git-merge-guard.ts`:

```typescript
import { stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";

/** Return true iff the vault's git repo is mid-merge / mid-rebase. */
export async function isMergeInProgress(vaultPath: string): Promise<boolean> {
  const gitDir = await resolveGitDir(vaultPath);
  if (!gitDir) return false;
  const markers = ["MERGE_HEAD", "REBASE_HEAD", "rebase-merge", "rebase-apply"];
  for (const m of markers) {
    if (existsSync(join(gitDir, m))) return true;
  }
  return false;
}

/** Resolve the actual gitdir for a working tree. Handles `.git` as a dir or as a `gitdir:` pointer file. */
export async function resolveGitDir(vaultPath: string): Promise<string | null> {
  const dotGit = join(vaultPath, ".git");
  let st;
  try { st = await stat(dotGit); } catch { return null; }
  if (st.isDirectory()) return dotGit;
  if (st.isFile()) {
    const text = await readFile(dotGit, "utf8");
    const m = text.match(/^gitdir:\s*(.+?)\s*$/m);
    if (!m) return null;
    const p = m[1];
    return isAbsolute(p) ? p : resolve(vaultPath, p);
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run test/git-merge-guard.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/git-merge-guard.ts test/git-merge-guard.test.ts
git commit -m "feat(git): merge-guard detects merge/rebase + resolves gitdir pointer"
```

---

## Task 6: `git-stale-status` — status-bar tile + state machine

Mirrors `src/views/daemon-status-bar.ts` structure (`mount`, `setState`, `unmount`).

**Files:**
- Create: `src/git-stale-status.ts`
- Test: `test/git-stale-status.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/git-stale-status.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { GitStaleStatus, type StaleState } from "../src/git-stale-status";

function fakeEl(): { setText: (s: string) => void; setAttr: (k: string, v: string) => void; addClass: (c: string) => void; removeClass: (c: string) => void; text: string; attrs: Record<string, string> } {
  const el = { text: "", attrs: {} as Record<string, string> } as ReturnType<typeof fakeEl>;
  el.setText = (s: string) => { el.text = s; };
  el.setAttr = (k: string, v: string) => { el.attrs[k] = v; };
  el.addClass = () => {};
  el.removeClass = () => {};
  return el;
}

describe("GitStaleStatus", () => {
  it("starts in clean state with hidden tile", () => {
    const el = fakeEl();
    const s = new GitStaleStatus(el as never);
    expect(el.text).toBe("");
  });

  it("transitions clean → stale → clean", () => {
    const el = fakeEl();
    const s = new GitStaleStatus(el as never);
    s.setState({ kind: "stale" });
    expect(el.text).toContain("indexing");
    s.setState({ kind: "clean" });
    expect(el.text).toBe("");
  });

  it("shows deferred-by-merge tile until cleared", () => {
    const el = fakeEl();
    const s = new GitStaleStatus(el as never);
    s.setState({ kind: "deferred-by-merge" });
    expect(el.text).toContain("merge in progress");
  });

  it("shows error tile with stderr tooltip (truncated to 200 chars)", () => {
    const el = fakeEl();
    const s = new GitStaleStatus(el as never);
    const longErr = "x".repeat(500);
    s.setState({ kind: "error", message: longErr });
    expect(el.text).toContain("error");
    expect((el.attrs["aria-label"] ?? "").length).toBeLessThanOrEqual(200);
  });

  it("snapshot returns the current state", () => {
    const el = fakeEl();
    const s = new GitStaleStatus(el as never);
    s.setState({ kind: "stale" });
    expect(s.snapshot()).toEqual({ kind: "stale" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git-stale-status.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement `git-stale-status.ts`**

Create `src/git-stale-status.ts`:

```typescript
export type StaleState =
  | { kind: "clean" }
  | { kind: "stale" }
  | { kind: "deferred-by-merge" }
  | { kind: "error"; message: string };

/** Minimal status-bar element surface — covers what we use. */
export interface StatusBarEl {
  setText(text: string): void;
  setAttr(name: string, value: string): void;
  addClass(cls: string): void;
  removeClass(cls: string): void;
}

const LABELS = {
  clean: "",
  stale: "qmd: indexing…",
  "deferred-by-merge": "qmd: merge in progress",
  error: "qmd: index error",
} as const;

const TOOLTIPS = {
  clean: "",
  stale: "Vault changed (pull). Reindexing.",
  "deferred-by-merge": "Resolve merge conflicts, then reindex will run.",
} as const;

export class GitStaleStatus {
  private state: StaleState = { kind: "clean" };
  constructor(private el: StatusBarEl) { this.render(); }

  setState(next: StaleState): void {
    this.state = next;
    this.render();
  }

  snapshot(): StaleState { return this.state; }

  private render(): void {
    this.el.setText(LABELS[this.state.kind]);
    const tooltip =
      this.state.kind === "error"
        ? this.state.message.slice(0, 200)
        : TOOLTIPS[this.state.kind];
    this.el.setAttr("aria-label", tooltip);
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run test/git-stale-status.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/git-stale-status.ts test/git-stale-status.test.ts
git commit -m "feat(git): stale-status tile + state machine"
```

---

## Task 7: `git-triggers` — wire auto-reindex + proxy command

This module owns the runtime wiring: it subscribes to `obsidian-git:head-change`, runs the merge guard, debounces, fires `indexer.reindexNow()`, updates the status tile, and registers the proxy "reindex + commit-and-sync" command.

**Files:**
- Create: `src/git-triggers.ts`
- Test: `test/git-triggers.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/git-triggers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerGitTriggers, type GitTriggerDeps } from "../src/git-triggers";

function deps(overrides: Partial<GitTriggerDeps> = {}): GitTriggerDeps {
  return {
    onHeadChange: vi.fn().mockImplementation((cb: () => void) => { (deps as any).fired = cb; return () => {}; }),
    isMergeInProgress: vi.fn().mockResolvedValue(false),
    reindexNow: vi.fn().mockResolvedValue(undefined),
    setStale: vi.fn(),
    debounceMs: 0,
    autoReindex: true,
    ...overrides,
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("registerGitTriggers", () => {
  it("subscribes to head-change when autoReindex is true", () => {
    const d = deps();
    registerGitTriggers(d);
    expect(d.onHeadChange).toHaveBeenCalledTimes(1);
  });

  it("does NOT subscribe when autoReindex is false", () => {
    const d = deps({ autoReindex: false });
    registerGitTriggers(d);
    expect(d.onHeadChange).not.toHaveBeenCalled();
  });

  it("on head-change: sets stale, calls reindex, then clean", async () => {
    let fired = () => {};
    const d = deps({ onHeadChange: vi.fn().mockImplementation((cb: () => void) => { fired = cb; return () => {}; }) });
    registerGitTriggers(d);
    fired();
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTimersAsync();
    expect(d.setStale).toHaveBeenCalledWith({ kind: "stale" });
    expect(d.reindexNow).toHaveBeenCalledTimes(1);
    expect(d.setStale).toHaveBeenLastCalledWith({ kind: "clean" });
  });

  it("on head-change in merge state: sets deferred, skips reindex", async () => {
    let fired = () => {};
    const d = deps({
      onHeadChange: vi.fn().mockImplementation((cb: () => void) => { fired = cb; return () => {}; }),
      isMergeInProgress: vi.fn().mockResolvedValue(true),
    });
    registerGitTriggers(d);
    fired();
    await vi.runAllTimersAsync();
    expect(d.setStale).toHaveBeenCalledWith({ kind: "deferred-by-merge" });
    expect(d.reindexNow).not.toHaveBeenCalled();
  });

  it("coalesces rapid head-change bursts into one reindex", async () => {
    let fired = () => {};
    const d = deps({
      onHeadChange: vi.fn().mockImplementation((cb: () => void) => { fired = cb; return () => {}; }),
      debounceMs: 50,
    });
    registerGitTriggers(d);
    fired(); fired(); fired();
    await vi.advanceTimersByTimeAsync(60);
    await vi.runAllTimersAsync();
    expect(d.reindexNow).toHaveBeenCalledTimes(1);
  });

  it("reindex failure sets error state", async () => {
    let fired = () => {};
    const d = deps({
      onHeadChange: vi.fn().mockImplementation((cb: () => void) => { fired = cb; return () => {}; }),
      reindexNow: vi.fn().mockRejectedValue(new Error("boom")),
    });
    registerGitTriggers(d);
    fired();
    await vi.runAllTimersAsync();
    expect(d.setStale).toHaveBeenLastCalledWith({ kind: "error", message: "boom" });
  });

  it("returns a disposer that unsubscribes", () => {
    const unsubscribe = vi.fn();
    const d = deps({ onHeadChange: vi.fn().mockReturnValue(unsubscribe) });
    const dispose = registerGitTriggers(d);
    dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git-triggers.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement `git-triggers.ts`**

Create `src/git-triggers.ts`:

```typescript
import type { StaleState } from "./git-stale-status";

export interface GitTriggerDeps {
  onHeadChange: (cb: () => void) => () => void;
  isMergeInProgress: () => Promise<boolean>;
  reindexNow: () => Promise<void>;
  setStale: (s: StaleState) => void;
  debounceMs: number;
  autoReindex: boolean;
}

/** Wire head-change → guard → debounce → reindex. Returns a disposer. */
export function registerGitTriggers(deps: GitTriggerDeps): () => void {
  if (!deps.autoReindex) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;

  const runOnce = async () => {
    if (running) { pending = true; return; }
    running = true;
    try {
      if (await deps.isMergeInProgress()) {
        deps.setStale({ kind: "deferred-by-merge" });
        return;
      }
      deps.setStale({ kind: "stale" });
      try {
        await deps.reindexNow();
        deps.setStale({ kind: "clean" });
      } catch (e: unknown) {
        deps.setStale({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      running = false;
      if (pending) { pending = false; void runOnce(); }
    }
  };

  const onFire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void runOnce(); }, deps.debounceMs);
  };

  const unsubscribe = deps.onHeadChange(onFire);
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run test/git-triggers.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/git-triggers.ts test/git-triggers.test.ts
git commit -m "feat(git): triggers wire head-change → guard → debounce → reindex"
```

---

## Task 8: `git-bootstrap` — empty-vault validation + spawn pipeline

**Files:**
- Create: `src/git-bootstrap.ts`
- Test: `test/git-bootstrap.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/git-bootstrap.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapVault, isVaultEmpty, validateRemoteUrl, validateBranch } from "../src/git-bootstrap";

let root = "";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "qmd-bs-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("validateRemoteUrl", () => {
  it.each([
    ["https://github.com/u/r.git", true],
    ["http://example.com/r.git", true],
    ["git@github.com:u/r.git", true],
    ["ssh://git@host/u/r.git", true],
    ["", false],
    ["not a url", false],
    ["https://host/r.git; rm -rf /", false],
    ["https://host/r.git && evil", false],
  ])("validateRemoteUrl(%j) → %j", (url, ok) => {
    expect(validateRemoteUrl(url).ok).toBe(ok);
  });
});

describe("validateBranch", () => {
  it.each([
    ["main", true], ["dev", true], ["feature/x", true], ["release-1.2", true],
    ["", false], ["..", false], ["with space", false], ["bad;name", false],
  ])("validateBranch(%j) → %j", (b, ok) => {
    expect(validateBranch(b).ok).toBe(ok);
  });
});

describe("isVaultEmpty", () => {
  it("returns empty when only .obsidian/ exists", async () => {
    mkdirSync(join(root, ".obsidian"));
    const r = await isVaultEmpty(root);
    expect(r.empty).toBe(true);
  });

  it("returns non-empty with offending paths when any other file exists", async () => {
    mkdirSync(join(root, ".obsidian"));
    writeFileSync(join(root, "note.md"), "hi");
    mkdirSync(join(root, "subdir"));
    const r = await isVaultEmpty(root);
    expect(r.empty).toBe(false);
    expect(r.offending).toContain("note.md");
    expect(r.offending).toContain("subdir");
  });

  it("caps offending list at 10 entries", async () => {
    for (let i = 0; i < 20; i++) writeFileSync(join(root, `f${i}.md`), "");
    const r = await isVaultEmpty(root);
    expect(r.empty).toBe(false);
    expect(r.offending.length).toBe(10);
  });
});

describe("bootstrapVault", () => {
  it("refuses non-empty vaults without invoking git", async () => {
    writeFileSync(join(root, "preexisting.md"), "hello");
    const runGit = vi.fn();
    const result = await bootstrapVault({ vaultPath: root, remoteUrl: "https://h/r.git", branch: "main", runGit });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not empty");
    expect(runGit).not.toHaveBeenCalled();
  });

  it("rejects bad URL before invoking git", async () => {
    const runGit = vi.fn();
    const result = await bootstrapVault({ vaultPath: root, remoteUrl: "bad url", branch: "main", runGit });
    expect(result.ok).toBe(false);
    expect(runGit).not.toHaveBeenCalled();
  });

  it("rejects bad branch before invoking git", async () => {
    const runGit = vi.fn();
    const result = await bootstrapVault({ vaultPath: root, remoteUrl: "https://h/r.git", branch: "bad branch", runGit });
    expect(result.ok).toBe(false);
    expect(runGit).not.toHaveBeenCalled();
  });

  it("runs init, remote add, fetch, reset --hard in order for empty vault", async () => {
    const calls: string[][] = [];
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    });
    const result = await bootstrapVault({ vaultPath: root, remoteUrl: "https://h/r.git", branch: "main", runGit });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      ["init"],
      ["remote", "add", "origin", "https://h/r.git"],
      ["fetch", "origin", "main"],
      ["reset", "--hard", "origin/main"],
    ]);
  });

  it("stops on first non-zero exit and returns stderr", async () => {
    const runGit = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 128, stdout: "", stderr: "fatal: Authentication failed" });
    const result = await bootstrapVault({ vaultPath: root, remoteUrl: "https://h/r.git", branch: "main", runGit });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Authentication failed");
    expect(runGit).toHaveBeenCalledTimes(3);
  });

  it("treats ENOENT (code=-1) as git-not-installed", async () => {
    const runGit = vi.fn().mockResolvedValue({ code: -1, stdout: "", stderr: "Error: spawn git ENOENT" });
    const result = await bootstrapVault({ vaultPath: root, remoteUrl: "https://h/r.git", branch: "main", runGit });
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("git cli not found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/git-bootstrap.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement `git-bootstrap.ts`**

Create `src/git-bootstrap.ts`:

```typescript
import { readdir } from "node:fs/promises";
import type { RunGit } from "./git-runner";

export interface ValidateResult { ok: boolean; error?: string }
export interface BootstrapResult { ok: boolean; error?: string; step?: "init" | "remote" | "fetch" | "reset" }

export interface BootstrapDeps {
  vaultPath: string;
  remoteUrl: string;
  branch: string;
  runGit: RunGit;
}

const IGNORED = new Set([".obsidian"]);
const MAX_OFFENDING = 10;

const URL_RE = /^(?:https?:\/\/[^\s;&|`$()<>]+|ssh:\/\/[^\s;&|`$()<>]+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s;&|`$()<>]+|git:\/\/[^\s;&|`$()<>]+)$/;
const BRANCH_RE = /^[A-Za-z0-9._\-/]+$/;

export function validateRemoteUrl(url: string): ValidateResult {
  if (!url || !URL_RE.test(url) || url.includes("..")) return { ok: false, error: "Invalid remote URL." };
  return { ok: true };
}

export function validateBranch(branch: string): ValidateResult {
  if (!branch || !BRANCH_RE.test(branch) || branch.includes("..")) return { ok: false, error: "Invalid branch name." };
  return { ok: true };
}

export async function isVaultEmpty(vaultPath: string): Promise<{ empty: boolean; offending: string[] }> {
  const entries = await readdir(vaultPath);
  const offending = entries.filter((e) => !IGNORED.has(e)).slice(0, MAX_OFFENDING);
  return { empty: offending.length === 0, offending };
}

export async function bootstrapVault(deps: BootstrapDeps): Promise<BootstrapResult> {
  const urlCheck = validateRemoteUrl(deps.remoteUrl);
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error };
  const branchCheck = validateBranch(deps.branch);
  if (!branchCheck.ok) return { ok: false, error: branchCheck.error };

  const probe = await isVaultEmpty(deps.vaultPath);
  if (!probe.empty) {
    return { ok: false, error: `Vault is not empty. Found: ${probe.offending.join(", ")}` };
  }

  const steps: { name: BootstrapResult["step"]; argv: string[] }[] = [
    { name: "init", argv: ["init"] },
    { name: "remote", argv: ["remote", "add", "origin", deps.remoteUrl] },
    { name: "fetch", argv: ["fetch", "origin", deps.branch] },
    { name: "reset", argv: ["reset", "--hard", `origin/${deps.branch}`] },
  ];

  for (const step of steps) {
    const r = await deps.runGit(step.argv);
    if (r.code === -1 && /enoent/i.test(r.stderr)) {
      return { ok: false, error: "git CLI not found. Install git and ensure it's on your PATH.", step: step.name };
    }
    if (r.code !== 0) {
      return { ok: false, error: r.stderr.trim() || `git ${step.argv.join(" ")} exited with code ${r.code}`, step: step.name };
    }
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run test/git-bootstrap.test.ts`
Expected: all green (validateRemoteUrl 8 cases, validateBranch 8 cases, isVaultEmpty 3 cases, bootstrapVault 5 cases).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/git-bootstrap.ts test/git-bootstrap.test.ts
git commit -m "feat(git): bootstrap pipeline + URL/branch validation"
```

---

## Task 9: Bootstrap modal

Tiny Obsidian modal that prompts for remote URL + branch, then resolves with `{ url, branch }` or `null` (cancel). No tests — pure UI, exercised via manual smoke.

**Files:**
- Create: `src/views/git-bootstrap-modal.ts`

- [ ] **Step 1: Implement the modal**

Create `src/views/git-bootstrap-modal.ts`:

```typescript
import { App, Modal, Setting } from "obsidian";

export interface BootstrapInput { url: string; branch: string }

export class GitBootstrapModal extends Modal {
  private input: BootstrapInput = { url: "", branch: "main" };
  private submitted = false;
  constructor(app: App, private onSubmit: (input: BootstrapInput | null) => void) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Bootstrap vault from remote" });
    contentEl.createEl("p", { text: "Initialises this empty vault as a git repo and resets to the remote branch. Aborts if the vault is not empty." });

    new Setting(contentEl).setName("Remote URL")
      .addText((t) => t.setPlaceholder("https://github.com/you/notes.git").onChange((v) => { this.input.url = v.trim(); }));
    new Setting(contentEl).setName("Branch")
      .addText((t) => t.setValue(this.input.branch).onChange((v) => { this.input.branch = v.trim() || "main"; }));
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Bootstrap").setCta().onClick(() => {
        this.submitted = true;
        this.close();
        this.onSubmit({ ...this.input });
      }));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.submitted) this.onSubmit(null);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build to confirm no esbuild error**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/views/git-bootstrap-modal.ts
git commit -m "feat(git): bootstrap modal (url + branch prompt)"
```

---

## Task 10: Wire everything into `main.ts`

Now register the triggers, mount the status tile, and add the two new commands. Detect obsidian-git presence; degrade gracefully when absent.

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add imports**

In `src/main.ts`, append to the existing import block:

```typescript
import { isObsidianGitPresent, invokeGitCommand, onHeadChange } from "./git-bridge";
import { isMergeInProgress } from "./git-merge-guard";
import { GitStaleStatus } from "./git-stale-status";
import { registerGitTriggers } from "./git-triggers";
import { bootstrapVault } from "./git-bootstrap";
import { makeRunGit } from "./git-runner";
import { GitBootstrapModal } from "./views/git-bootstrap-modal";
```

- [ ] **Step 2: Add a status field**

In `class QmdPlugin extends Plugin`, add a new field next to `statusBar`:

```typescript
  gitStatus!: GitStaleStatus;
```

- [ ] **Step 3: Register triggers + tile + commands in `onload`**

At the bottom of `onload()`, after the existing `if (this.settings.autoReindex && vaultPath) { ... }` block, append:

```typescript
    // Git integration. Wires obsidian-git head-change → debounced reindex.
    if (vaultPath) {
      this.gitStatus = new GitStaleStatus(this.addStatusBarItem() as never);
      const dispose = registerGitTriggers({
        onHeadChange: (cb) => onHeadChange(this.app, cb),
        isMergeInProgress: () => isMergeInProgress(vaultPath),
        reindexNow: () => this.indexer.reindexNow(),
        setStale: (s) => this.gitStatus.setState(s),
        debounceMs: this.settings.gitAutoReindexDebounceMs,
        autoReindex: this.settings.gitAutoReindex && isObsidianGitPresent(this.app),
      });
      this.register(dispose);

      this.addCommand({
        id: "qmd-reindex-and-sync",
        name: "Reindex + Commit-and-sync (obsidian-git)",
        callback: async () => {
          if (!isObsidianGitPresent(this.app)) {
            new Notice("Install the obsidian-git plugin to use sync features.");
            return;
          }
          this.gitStatus.setState({ kind: "stale" });
          try {
            await this.indexer.reindexNow();
            this.gitStatus.setState({ kind: "clean" });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.gitStatus.setState({ kind: "error", message: msg });
            new Notice(`Reindex failed: ${msg}`);
            return;
          }
          const r = await invokeGitCommand(this.app, "obsidian-git:push");
          if (!r.ok) new Notice(r.error ?? "obsidian-git push failed.");
        },
      });

      this.addCommand({
        id: "qmd-bootstrap-vault",
        name: "Bootstrap vault from remote",
        callback: () => {
          new GitBootstrapModal(this.app, async (input) => {
            if (!input) return;
            const runGit = makeRunGit({ spawn, cwd: vaultPath });
            this.gitStatus.setState({ kind: "stale" });
            const result = await bootstrapVault({ vaultPath, remoteUrl: input.url, branch: input.branch, runGit });
            if (!result.ok) {
              this.gitStatus.setState({ kind: "error", message: result.error ?? "Bootstrap failed." });
              new Notice(`Bootstrap failed: ${result.error}`);
              return;
            }
            try {
              await this.indexer.reindexNow();
              this.gitStatus.setState({ kind: "clean" });
              new Notice("Vault bootstrapped from remote.");
            } catch (e: unknown) {
              this.gitStatus.setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
            }
          }).open();
        },
      });
    }
```

- [ ] **Step 4: Build to confirm wiring**

Run: `npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: all green (existing + new).

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(git): wire triggers, tile, sync command, bootstrap command in main"
```

---

## Task 11: Settings toggle in `settings-tab.ts`

**Files:**
- Modify: `src/settings-tab.ts`

- [ ] **Step 1: Add the toggle**

In `src/settings-tab.ts`, inside `display()`, after the "Reindex on save" `Setting`, add:

```typescript
    new Setting(containerEl).setName("Auto-reindex after pull (obsidian-git)").setDesc("When obsidian-git pulls, reindex this vault. Requires the obsidian-git plugin.")
      .addToggle((t) => t.setValue(this.plugin.settings.gitAutoReindex).onChange(async (v) => { this.plugin.settings.gitAutoReindex = v; await this.plugin.saveSettings(); }));
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/settings-tab.ts
git commit -m "feat(settings-tab): auto-reindex after pull toggle"
```

---

## Task 12: Manual smoke pass

This task is non-automated. The plan does not check this off — the human running the smoke does. Document outcomes in the bead created in Task 13.

- [ ] **Step 1: Install both plugins side by side in a throwaway vault**

  - Copy `main.js` + `manifest.json` (after `npm run build`) into `<vault>/.obsidian/plugins/qmd-vault-search/`.
  - Install obsidian-git from Community Plugins.
  - Enable both. Set qmd binary path + daemon port. Start the daemon.

- [ ] **Step 2: Auto-reindex on pull**

  1. In a terminal, commit + push a small change to the vault remote from another clone (e.g. add `smoke.md`).
  2. In Obsidian: run `obsidian-git: Pull`.
  3. Verify status-bar tile transitions: clean → "qmd: indexing…" → clean within ~5 s.
  4. Run `qmd status` (terminal): vector count includes the new file.
  5. **Pass criterion:** tile cleared + new file searchable.

- [ ] **Step 3: Skip during merge**

  1. Terminal in vault: `git merge --no-commit --no-ff <branch-with-conflicts>` (force conflict).
  2. In Obsidian: trigger obsidian-git refresh (any of its commands).
  3. Verify status-bar shows "qmd: merge in progress".
  4. Resolve conflicts via obsidian-git's source-control view, commit.
  5. Verify status-bar returns to clean after the next head-change.
  6. **Pass criterion:** no reindex during merge; clean after resolution.

- [ ] **Step 4: Bootstrap empty vault**

  1. Create new empty Obsidian vault. Install qmd plugin into it. Do NOT install obsidian-git.
  2. Run `qmd: Bootstrap vault from remote` with a small test repo URL.
  3. Verify files appear, status-bar tile clears, qmd search returns results from the cloned files.
  4. **Pass criterion:** files present, initial reindex succeeds.

- [ ] **Step 5: Bootstrap refuses non-empty vault**

  1. Repeat Step 4 in a vault that already has one note.
  2. Verify refusal modal/notice lists the offending path.
  3. **Pass criterion:** no `.git/` created; vault untouched.

- [ ] **Step 6: Reindex failure**

  1. Rename or break the qmd binary on PATH so `qmd update` fails.
  2. Trigger a head-change.
  3. Verify status-bar shows "qmd: index error" with stderr in tooltip.
  4. **Pass criterion:** tile sticky red, no silent failure.

- [ ] **Step 7: obsidian-git missing**

  1. Disable obsidian-git plugin. Reload Obsidian.
  2. Run `qmd: Reindex + Commit-and-sync (obsidian-git)`.
  3. Verify single notice "Install the obsidian-git plugin to use sync features." and no exception in dev tools.
  4. **Pass criterion:** clean degradation.

---

## Task 13: Bead + handoff

- [ ] **Step 1: Run full quality gates**

```bash
npm run typecheck && npm test && npm run build
```

Expected: all green.

- [ ] **Step 2: File a follow-up bead for documentation**

```bash
bd create "Docs: README + recommended .gitignore for qmd × obsidian-git workflow" \
  --type task --priority P3 \
  --description "After the git-integration code (bead 8ns implementation) merges, add a README section explaining the obsidian-git pairing, the bootstrap command, the auto-reindex behavior, and a recommended starter .gitignore that excludes .obsidian/workspace.json, .obsidian/workspace-mobile.json, and local-only caches. Out of scope for the implementation bead."
```

- [ ] **Step 3: Close the implementation bead**

The implementation bead (create with `bd create` at the start of execution, or use whatever ID was already allocated) should now be closed:

```bash
bd update <impl-bead-id> --status closed
```

- [ ] **Step 4: Final commit + push**

```bash
git log --oneline -15  # sanity-check the task commit chain
git pull --rebase
git push
git status             # MUST show "up to date with origin"
```

---

## Self-review against spec

The spec at `docs/superpowers/specs/2026-05-29-git-integration-design.md` defines 7 decisions (D1–D7), 5 new files, 4 touched files, 4 data flows, 13 error scenarios, and 5 manual smoke tests.

| Spec item | Covered by |
|---|---|
| D1 Hybrid scope | Architecture (bridge delegates broad ops; only narrow ops implemented) |
| D2 Desktop only | `spawn` from `node:child_process` (no isomorphic-git) — Task 2, Task 8, Task 10 |
| D3 Commands + events delegation | Task 4 (`git-bridge`) |
| D4 Auto-reindex on head-change + reindex-before-our-proxy-commit | Task 7 (triggers) + Task 10 (proxy command) |
| D5 Bootstrap empty-vault only | Task 8 (`isVaultEmpty` + refusal path) |
| D6 UX surface (2 commands + 1 toggle + 1 tile) | Task 6 (tile), Task 10 (2 commands), Task 11 (toggle) |
| D7 Defaults (auto-reindex ON, skip-during-merge ON, bootstrap explicit) | Task 1 (defaults), Task 7 (guard always runs), Task 10 (bootstrap = explicit command) |
| 5 new src files | Task 2 (runner), Task 4 (bridge), Task 5 (guard), Task 6 (tile), Task 7 (triggers), Task 8 (bootstrap), Task 9 (modal) — Note: spec listed 5 new files but design + plan converge on 7 (modal + runner pulled out for testability). Spec section §5.2 should be read alongside; runner + modal are infrastructure spinoffs, not separate features. |
| 4 touched files | Task 1 (settings), Task 3 (indexer), Task 10 (main), Task 11 (settings-tab) |
| 4 data flows | Task 7 (auto path), Task 10 (manual + bootstrap), Task 5+7 (merge state machine) |
| 13 error scenarios | Tasks 4/5/7/8/10 cover each; Task 12 smokes them |
| 5 manual smoke tests | Task 12 |

**Placeholder scan:** no `TBD`, `TODO`, "implement later," or "appropriate error handling" anywhere in the tasks. Every code step has a complete code block; every test step has full test source; every command has expected output described.

**Type consistency:** the public surface is `runGit(args)`, `isObsidianGitPresent(app)`, `invokeGitCommand(app, id)`, `onHeadChange(app, cb)`, `isMergeInProgress(vaultPath)`, `resolveGitDir(vaultPath)`, `bootstrapVault({vaultPath, remoteUrl, branch, runGit})`, `validateRemoteUrl(url)`, `validateBranch(branch)`, `isVaultEmpty(vaultPath)`, `registerGitTriggers(deps)`, `GitStaleStatus(el) / setState(s) / snapshot()`, `GitBootstrapModal(app, onSubmit)`, `Indexer.reindexNow()`. Naming is consistent across tasks.

**Scope check:** Spec is a single sub-project; this plan implements all of it. Manual smoke is the only non-coded work and is explicitly marked as such.

If you find a spec requirement uncovered during execution, stop and add a task — do not bolt fixes onto an unrelated task.
