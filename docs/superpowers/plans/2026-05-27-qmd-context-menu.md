# Right-click "Set qmd context…" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a file-explorer right-click item "Set qmd context…" (plus a command-palette command) that opens a pre-filled modal to set / edit / remove a human-written qmd context summary for any vault file or folder.

**Architecture:** A new pure module `src/qmd-context.ts` builds the qmd virtual path, parses `qmd context list`, and runs `qmd context add|rm` through the existing injectable `RunQmd` runner. A new `src/views/context-modal.ts` (`Modal` subclass) is the UI. `src/main.ts` registers the `file-menu` handler and a command, sharing the one `makeRunQmd(binaryPath)` instance already built for the `Indexer`.

**Tech Stack:** TypeScript, Obsidian plugin API 1.7.2, vitest, esbuild. qmd CLI `v2.5.2+`.

**Spec:** `docs/superpowers/specs/2026-05-27-qmd-context-menu-design.md` · **Issue:** `obsidian_qmd_plugin-n5k` · **Branch:** `qmd-context-menu`

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/qmd-context.ts` | Create | Pure/injectable logic: `vaultVirtualPath`, `parseContextList`, `readContext`, `setContext`, `removeContext`. No `obsidian` import. |
| `test/qmd-context.test.ts` | Create | Unit tests for every export of `qmd-context.ts`. |
| `src/views/context-modal.ts` | Create | `ContextModal extends Modal` — textarea UI, Save/Remove. Imports `obsidian`; not unit-tested. |
| `src/main.ts` | Modify | Lift `runQmd` to a shared local; register `file-menu` item + `set-qmd-context` command. |
| `styles.css` | Modify | Two rules for the modal path label + full-width textarea. |

Conventions to match (from the existing repo):
- Pure modules take injected deps (`runQmd: RunQmd` from `src/indexer.ts`) and are unit-tested with a fake runner that records argv: `expect(calls[0]).toEqual([...])`.
- `RunQmd = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>` and **never throws** (spawn error → `{code:-1,...}`).
- Tests live in `test/<module>.test.ts`; run all with `npm test`, one file with `npx vitest run test/<file>`.
- `npm run build` = `tsc --noEmit && esbuild` (tsc type-checks `context-modal.ts` against the real `obsidian` types).
- Commands register with no default hotkey (see the existing `addCommand` calls in `main.ts`).

---

## Task 1: `qmd-context.ts` — types + `vaultVirtualPath`

**Files:**
- Create: `src/qmd-context.ts`
- Test: `test/qmd-context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/qmd-context.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { vaultVirtualPath } from "../src/qmd-context";

describe("vaultVirtualPath", () => {
  it("maps a file to a virtual path", () => {
    expect(vaultVirtualPath("vault", "Projects/note.md", false)).toBe("qmd://vault/Projects/note.md");
  });
  it("maps a nested folder to a virtual path", () => {
    expect(vaultVirtualPath("vault", "Projects/Sub", false)).toBe("qmd://vault/Projects/Sub");
  });
  it("maps the vault root folder to the collection root", () => {
    expect(vaultVirtualPath("vault", "/", true)).toBe("qmd://vault/");
  });
  it("honors a custom collection name", () => {
    expect(vaultVirtualPath("notes", "a.md", false)).toBe("qmd://notes/a.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/qmd-context.test.ts`
Expected: FAIL — "Failed to resolve import \"../src/qmd-context\"" (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/qmd-context.ts`:
```ts
import type { RunQmd } from "./indexer";

export interface ContextEntry {
  collection: string;
  path: string; // "" for the collection root
  context: string;
}

export interface QmdResult {
  ok: boolean;
  error?: string;
}

/** Build the qmd virtual path for a vault file/folder. Root folder → collection root. */
export function vaultVirtualPath(collection: string, relPath: string, isRoot: boolean): string {
  return isRoot ? `qmd://${collection}/` : `qmd://${collection}/${relPath}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/qmd-context.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/qmd-context.ts test/qmd-context.test.ts
git commit -m "feat: add vaultVirtualPath + qmd-context types"
```

---

## Task 2: `parseContextList`

**Files:**
- Modify: `src/qmd-context.ts`
- Test: `test/qmd-context.test.ts`

`qmd context list` prints (no ANSI when piped; verified):
```
<blank>
Configured Contexts
<blank>
vault
  / (root)
    Whole-vault summary.
  Projects/note.md
    Spec for feature X.
qmd
  / (root)
    QMD source code.
```
Indentation is exactly: collection = 0 spaces, path = 2 spaces (`/ (root)` means root → `""`), context = 4 spaces. Only the first context line after a path is captured (multi-line stored values lose lines 2+ — acceptable per spec).

- [ ] **Step 1: Write the failing test**

Append to `test/qmd-context.test.ts`:
```ts
import { parseContextList } from "../src/qmd-context";

const SAMPLE = [
  "",
  "Configured Contexts",
  "",
  "vault",
  "  / (root)",
  "    Whole-vault summary.",
  "  Projects/note.md",
  "    Spec for feature X.",
  "qmd",
  "  / (root)",
  "    QMD source code.",
].join("\n");

describe("parseContextList", () => {
  it("parses collections, root, and subpaths", () => {
    expect(parseContextList(SAMPLE)).toEqual([
      { collection: "vault", path: "", context: "Whole-vault summary." },
      { collection: "vault", path: "Projects/note.md", context: "Spec for feature X." },
      { collection: "qmd", path: "", context: "QMD source code." },
    ]);
  });
  it("returns [] for empty / no-context output", () => {
    expect(parseContextList("")).toEqual([]);
    expect(parseContextList("No contexts configured. Use 'qmd context add' to add one.")).toEqual([]);
  });
  it("does not throw on a malformed block (path with no following context)", () => {
    const out = ["vault", "  Orphan/path.md", "qmd", "  / (root)", "    ok"].join("\n");
    expect(parseContextList(out)).toEqual([{ collection: "qmd", path: "", context: "ok" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/qmd-context.test.ts -t parseContextList`
Expected: FAIL — "parseContextList is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/qmd-context.ts`:
```ts
/** Parse `qmd context list` stdout into entries. Tolerates the banner + blanks; never throws. */
export function parseContextList(stdout: string): ContextEntry[] {
  const entries: ContextEntry[] = [];
  let collection = "";
  let pendingPath: string | null = null;
  for (const raw of stdout.split("\n")) {
    if (raw.trim() === "") continue;
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (indent === 0) {
      if (text === "Configured Contexts") continue;
      if (text.startsWith("No contexts configured")) continue;
      collection = text;
      pendingPath = null;
    } else if (indent <= 2) {
      pendingPath = text === "/ (root)" ? "" : text;
    } else if (pendingPath !== null && collection) {
      entries.push({ collection, path: pendingPath, context: text });
      pendingPath = null;
    }
  }
  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/qmd-context.test.ts`
Expected: PASS — all `parseContextList` + `vaultVirtualPath` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/qmd-context.ts test/qmd-context.test.ts
git commit -m "feat: add parseContextList for qmd context list output"
```

---

## Task 3: `readContext`

**Files:**
- Modify: `src/qmd-context.ts`
- Test: `test/qmd-context.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/qmd-context.test.ts`:
```ts
import { vi } from "vitest";
import { readContext } from "../src/qmd-context";

function runnerReturning(code: number, stdout: string) {
  const calls: string[][] = [];
  const run = vi.fn(async (args: string[]) => { calls.push(args); return { code, stdout, stderr: "" }; });
  return { run, calls };
}

describe("readContext", () => {
  it("returns the matching summary for a file path", async () => {
    const { run, calls } = runnerReturning(0, SAMPLE);
    const got = await readContext(run, "vault", "Projects/note.md", false);
    expect(got).toBe("Spec for feature X.");
    expect(calls[0]).toEqual(["context", "list"]);
  });
  it("returns the root summary when isRoot", async () => {
    const { run } = runnerReturning(0, SAMPLE);
    expect(await readContext(run, "vault", "/", true)).toBe("Whole-vault summary.");
  });
  it("returns null when the path has no context", async () => {
    const { run } = runnerReturning(0, SAMPLE);
    expect(await readContext(run, "vault", "Nope.md", false)).toBeNull();
  });
  it("returns null when qmd exits non-zero", async () => {
    const { run } = runnerReturning(-1, "");
    expect(await readContext(run, "vault", "Projects/note.md", false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/qmd-context.test.ts -t readContext`
Expected: FAIL — "readContext is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/qmd-context.ts`:
```ts
/** Read the current context summary for a vault path, or null. Never throws. */
export async function readContext(
  runQmd: RunQmd,
  collection: string,
  relPath: string,
  isRoot: boolean,
): Promise<string | null> {
  const target = isRoot ? "" : relPath;
  const res = await runQmd(["context", "list"]);
  if (res.code !== 0) return null;
  const match = parseContextList(res.stdout).find((e) => e.collection === collection && e.path === target);
  return match ? match.context : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/qmd-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qmd-context.ts test/qmd-context.test.ts
git commit -m "feat: add readContext (parse context list for a path)"
```

---

## Task 4: `setContext` + `removeContext`

**Files:**
- Modify: `src/qmd-context.ts`
- Test: `test/qmd-context.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/qmd-context.test.ts`:
```ts
import { setContext, removeContext } from "../src/qmd-context";

function recordingRunner(code: number, stderr = "") {
  const calls: string[][] = [];
  const run = vi.fn(async (args: string[]) => { calls.push(args); return { code, stdout: "", stderr }; });
  return { run, calls };
}

describe("setContext", () => {
  it("runs context add with the virtual path + text and reports ok", async () => {
    const { run, calls } = recordingRunner(0);
    expect(await setContext(run, "qmd://vault/Projects/note.md", "summary")).toEqual({ ok: true });
    expect(calls[0]).toEqual(["context", "add", "qmd://vault/Projects/note.md", "summary"]);
  });
  it("reports the stderr on failure", async () => {
    const { run } = recordingRunner(1, "Path is not in any indexed collection: …");
    expect(await setContext(run, "qmd://vault/x.md", "s")).toEqual({ ok: false, error: "Path is not in any indexed collection: …" });
  });
});

describe("removeContext", () => {
  it("runs context rm with the virtual path", async () => {
    const { run, calls } = recordingRunner(0);
    expect(await removeContext(run, "qmd://vault/x.md")).toEqual({ ok: true });
    expect(calls[0]).toEqual(["context", "rm", "qmd://vault/x.md"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/qmd-context.test.ts -t "setContext"`
Expected: FAIL — "setContext is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/qmd-context.ts`:
```ts
function toResult(res: { code: number; stderr: string }): QmdResult {
  return res.code === 0 ? { ok: true } : { ok: false, error: res.stderr.trim() || `qmd exited ${res.code}` };
}

/** Add/overwrite the context summary for a virtual path. */
export async function setContext(runQmd: RunQmd, virtualPath: string, text: string): Promise<QmdResult> {
  return toResult(await runQmd(["context", "add", virtualPath, text]));
}

/** Remove the context summary for a virtual path. */
export async function removeContext(runQmd: RunQmd, virtualPath: string): Promise<QmdResult> {
  return toResult(await runQmd(["context", "rm", virtualPath]));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/qmd-context.test.ts`
Expected: PASS — full `qmd-context` suite green.

- [ ] **Step 5: Commit**

```bash
git add src/qmd-context.ts test/qmd-context.test.ts
git commit -m "feat: add setContext + removeContext qmd runners"
```

---

## Task 5: `ContextModal` view + styles

**Files:**
- Create: `src/views/context-modal.ts`
- Modify: `styles.css`

No unit test (needs the Obsidian runtime; smoke-tested in Task 7). Verification = `npm run build` type-checks it.

- [ ] **Step 1: Write the modal**

Create `src/views/context-modal.ts`:
```ts
import { App, Modal, Notice, Setting, TAbstractFile, TFolder } from "obsidian";
import type { RunQmd } from "../indexer";
import { vaultVirtualPath, readContext, setContext, removeContext } from "../qmd-context";

export interface ContextModalDeps {
  app: App;
  runQmd: RunQmd;
  collection: string;
  file: TAbstractFile;
}

/** Modal to set/edit/remove a qmd context summary for a vault file or folder. */
export class ContextModal extends Modal {
  private readonly deps: ContextModalDeps;
  private readonly isRoot: boolean;
  private readonly virtualPath: string;

  constructor(deps: ContextModalDeps) {
    super(deps.app);
    this.deps = deps;
    this.isRoot = deps.file instanceof TFolder && deps.file.isRoot();
    this.virtualPath = vaultVirtualPath(deps.collection, deps.file.path, this.isRoot);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Set qmd context" });
    contentEl.createEl("div", { text: this.virtualPath, cls: "qmd-context-path" });

    const textarea = contentEl.createEl("textarea", { cls: "qmd-context-textarea" });
    textarea.rows = 5;
    textarea.placeholder = "Loading current context…";
    textarea.disabled = true;

    let removeBtn: HTMLButtonElement | null = null;
    let saveBtn: HTMLButtonElement | null = null;
    new Setting(contentEl)
      .addButton((b) => {
        removeBtn = b.setButtonText("Remove").buttonEl;
        b.onClick(() => void this.runAndClose(() => removeContext(this.deps.runQmd, this.virtualPath), removeBtn, saveBtn, "removed"));
        removeBtn.hide();
      })
      .addButton((b) => {
        saveBtn = b.setButtonText("Save").setCta().buttonEl;
        b.setDisabled(true);
        b.onClick(() => void this.runAndClose(() => setContext(this.deps.runQmd, this.virtualPath, textarea.value.trim()), removeBtn, saveBtn, "saved"));
      });

    textarea.addEventListener("input", () => { if (saveBtn) saveBtn.disabled = textarea.value.trim() === ""; });

    void readContext(this.deps.runQmd, this.deps.collection, this.deps.file.path, this.isRoot).then((cur) => {
      textarea.disabled = false;
      textarea.placeholder = "Describe what this file/folder contains…";
      if (cur !== null) {
        textarea.value = cur;
        removeBtn?.show();
        if (saveBtn) saveBtn.disabled = cur.trim() === "";
      }
    });
  }

  private async runAndClose(
    op: () => Promise<{ ok: boolean; error?: string }>,
    removeBtn: HTMLButtonElement | null,
    saveBtn: HTMLButtonElement | null,
    verb: string,
  ): Promise<void> {
    if (removeBtn) removeBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    const res = await op();
    new Notice(res.ok ? `qmd context ${verb}` : `qmd context: ${res.error}`);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
```

- [ ] **Step 2: Add styles**

Append to `styles.css`:
```css
.qmd-context-path {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  margin-bottom: var(--size-4-2);
  word-break: break-all;
}
.qmd-context-textarea {
  width: 100%;
  resize: vertical;
}
```

- [ ] **Step 3: Build to verify it type-checks**

Run: `npm run build`
Expected: PASS — `tsc --noEmit` reports no errors and esbuild writes `main.js`.

- [ ] **Step 4: Commit**

```bash
git add src/views/context-modal.ts styles.css
git commit -m "feat: add ContextModal for setting qmd context"
```

---

## Task 6: Wire into `main.ts` (menu + command)

**Files:**
- Modify: `src/main.ts`

Currently (`src/main.ts:33-34`) `runQmd` is built inline inside the `Indexer` constructor call. Lift it to a shared local so the menu/command reuse it. The captured `binaryPath` only refreshes on plugin reload — the same behavior already documented for the daemon URL.

- [ ] **Step 1: Add the import**

After the existing view imports (near `src/main.ts:12`), add:
```ts
import { ContextModal } from "./views/context-modal";
```

- [ ] **Step 2: Share the `runQmd` instance**

Replace (`src/main.ts:34`):
```ts
    this.indexer = new Indexer({ runQmd: makeRunQmd(this.settings.binaryPath), vaultPath, collectionName: this.settings.vaultCollectionName, mask: this.settings.mask, debounceMs: this.settings.debounceMs });
```
with:
```ts
    const runQmd = makeRunQmd(this.settings.binaryPath);
    this.indexer = new Indexer({ runQmd, vaultPath, collectionName: this.settings.vaultCollectionName, mask: this.settings.mask, debounceMs: this.settings.debounceMs });
```

- [ ] **Step 3: Register the menu item + command**

After `this.addSettingTab(new QmdSettingTab(this.app, this));` (`src/main.ts:47`), add:
```ts
    // Right-click a file/folder → set its qmd context summary.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        menu.addItem((item) =>
          item
            .setTitle("Set qmd context…")
            .setIcon("text-cursor-input")
            .onClick(() => new ContextModal({ app: this.app, runQmd, collection: this.settings.vaultCollectionName, file }).open()),
        );
      }),
    );
    this.addCommand({
      id: "set-qmd-context",
      name: "Set qmd context for current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) new ContextModal({ app: this.app, runQmd, collection: this.settings.vaultCollectionName, file }).open();
        return true;
      },
    });
```

- [ ] **Step 4: Build + run the full suite**

Run: `npm run build && npm test`
Expected: PASS — `tsc` clean, esbuild writes `main.js`, all tests green (existing 69 + the new `qmd-context` tests).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: register 'Set qmd context…' file-menu item + command"
```

---

## Task 7: Manual smoke + daemon-liveness verification + README note

**Files:**
- Modify: `README.md` (document the feature + the daemon-liveness finding)

Deploy per the project's Windows-native topology (qmd + Obsidian on Windows; daemon on `[::1]:8181`).

- [ ] **Step 1: Deploy the build to the vault**

Copy `main.js`, `manifest.json`, `styles.css` into the vault's `.obsidian/plugins/qmd-search/`, then reload Obsidian (or toggle the plugin off/on). Confirm no load errors in the console.

- [ ] **Step 2: Smoke — file context add/edit**

1. Right-click a note → **Set qmd context…** → type a summary → **Save** → expect Notice "qmd context saved".
2. In a terminal: `qmd context list` shows the summary under `vault` at the note's path.
3. Right-click the same note again → the textarea is **pre-filled** with the saved summary → edit it → **Save** → `qmd context list` shows the new text, **no duplicate** entry.

- [ ] **Step 3: Smoke — folder context + remove**

1. Right-click a folder → **Set qmd context…** → save a summary → `qmd context list` shows `qmd://vault/<folder>`.
2. Right-click it again → **Remove** → expect Notice "qmd context removed"; the entry is gone from `qmd context list`.
3. Right-click the vault root folder → save → confirm it lands at `vault / (root)` (the collection description).

- [ ] **Step 4: Smoke — command palette + error path**

1. With a note open, run command **"Set qmd context for current file"** → modal opens for the active file.
2. (If reproducible) point the plugin at a vault whose collection is not yet indexed and Save → confirm the qmd stderr (`Path is not in any indexed collection` / `Collection not found`) is shown verbatim in the Notice.

- [ ] **Step 5: Verify daemon liveness (spec open question)**

Without restarting the daemon: add a distinctive context to a folder, then run a search in the plugin whose ranking/snippet should reflect that summary (or re-open the collection listing). Determine whether the change is reflected **live** or only **after a daemon restart**. Record the result.

- [ ] **Step 6: Document in README + record the finding**

Add a short "qmd context" subsection to `README.md`: what the right-click item does, that it writes `qmd context add/rm`, and the daemon-liveness behavior found in Step 5 (e.g. "context changes apply on the next daemon start" if stale). If stale, also note it as possible follow-up work (a daemon-refresh nudge) — do **not** implement it here.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: document qmd context right-click + daemon-liveness finding"
```

---

## Security note (no code change in v1)

The summary text is passed as a **spawn argv element** through the existing `RunQmd` runner — safe on macOS/Linux. On Windows, `platformSpawnOptions` sets `shell:true` (the `qmd.cmd` shim quirk), so a summary containing `cmd.exe` metacharacters (`&`, `|`, `>`, `"`, `%`) could be mangled. This matches the existing posture (collection name / mask already flow through the same path) and the input is local + first-party, so v1 ships as-is. If hardening is later requested, quote/escape argv on the Windows shell path — out of scope here.

## Done criteria

- [ ] All steps checked; `npm run build && npm test` green.
- [ ] Smoke steps 2–4 pass on the real vault; daemon-liveness result recorded in README.
- [ ] `git log` shows the per-task commits on branch `qmd-context-menu`.
- [ ] `bd close obsidian_qmd_plugin-n5k` after merge.
- [ ] Merge `qmd-context-menu` → `master` (no-ff, matching the repo's branch workflow); user runs `git push origin master` (master push is user-gated).
