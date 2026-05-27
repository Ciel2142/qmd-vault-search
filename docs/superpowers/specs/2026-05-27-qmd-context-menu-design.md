# qmd × Obsidian — Right-click "Set qmd context…" on files/folders

- **Date:** 2026-05-27
- **Status:** Approved design — ready for implementation planning
- **Project:** `/home/igi21/experiements/obsidian/obsidian_qmd_plugin`
- **Parent spec:** `docs/superpowers/specs/2026-05-24-qmd-obsidian-plugin-design.md`
- **Issue:** `obsidian_qmd_plugin-n5k`
- **Builds on:** the existing `makeRunQmd(binaryPath)` CLI runner (`src/cli.ts`), the `Indexer`'s injectable-`runQmd` pattern, and the `views/` modal/view convention.

## Goal

Let the user attach a **human-written qmd context summary** to any vault file or folder straight from Obsidian's file-explorer right-click menu, instead of dropping to a terminal to run `qmd context add`. A new menu item **"Set qmd context…"** opens a modal pre-filled with the path's current context; Save writes it, Remove deletes it.

qmd "context" = a human-authored summary attached to a path prefix within a collection (`qmd context add/list/rm`). The collection-root context is the description qmd shows in `qmd status` / the MCP collection listing; subpath contexts describe folders or individual files. qmd injects these summaries to tell the search/rerank pipeline what a folder contains.

## Locked decisions

| Decision | Choice | Source |
|---|---|---|
| Shape | **Approach A — one modal, pre-filled.** Single `file-menu` item "Set qmd context…" on files *and* folders; one modal handles add / edit / remove. | Q: approach |
| Path argument | **Virtual path `qmd://<vaultCollectionName>/<rel>`.** The plugin spawns qmd with an inherited (wrong) cwd, so `.`/relative/absolute resolution is unreliable; the virtual path is exactly what the plugin already knows from `TAbstractFile.path`. | Constraint (cwd) |
| Root folder | Vault-root folder → `qmd://<col>/` (collection-root context). | qmd semantics |
| Re-index needed? | **No.** `context add/rm` mutates YAML config + `resyncConfig()` into SQLite `store_config`. No embed. | qmd source (`contextAdd`, `addContext`) |
| Edit semantics | Re-adding the same path **overwrites** (`collection.context[pathPrefix] = text`, upsert). Editing = re-add. | qmd source (`addContext`) |
| Pre-fill source | Parse `qmd context list` stdout (no `--json` exists). Parse failure or no entry → **blank textarea** (graceful degrade ≈ no pre-read). | qmd CLI surface |
| Save guard | Save enabled only when textarea is non-blank. Empty summary is never stored; deletion is via **Remove**. | UX |
| Remove visibility | Remove button shown only when an existing context was found for the path. | UX |
| Multi-select | **Out.** No `files-menu` (multi-file) handler — setting one summary across many paths is not a real use case. | YAGNI |
| Contexts panel | **Out.** No dedicated side-view (rejected option C). | YAGNI |
| Settings added | **None.** | YAGNI |
| Cross-repo changes | **None.** No `context list --json` request to the qmd repo. | Scope |

## qmd / codebase facts this design relies on

- **`qmd context` CLI** (verified against qmd `v2.5.2-8-g8cb24de`, the installed build):
  - `qmd context add [path] "text"` — `path` may be `/` (global), an fs path (resolved → collection via `detectCollectionFromPath`), or a `qmd://collection/subpath` virtual path (`parseVirtualPath`). Stores to YAML config then `resyncConfig()`.
  - `qmd context rm <path>` — same path resolution; deletes the entry.
  - `qmd context list` — prints grouped human text (see parser below); **no `--json`** (the flag is silently ignored).
  - Context value is upserted per `(collectionName, pathPrefix)` and applied to a file when its collection-relative path matches the stored prefix.
- **`makeRunQmd(binaryPath)`** (`src/cli.ts`) returns `RunQmd = (args:string[]) => Promise<{code,stdout,stderr}>`; never throws (spawn error → `{code:-1,...}`). Already constructed in `main.ts` for the `Indexer`. The context module reuses the same runner instance.
- **`platformSpawnOptions`** (`src/spawn-opts.ts`) handles the Windows `qmd.cmd` shell quirk; reused transparently via `makeRunQmd`. Args carrying user free-text (the summary) flow through `spawn` argv — **not** a shell string — on non-Windows. On Windows, `shell:true` is set; see Security below.
- **`mcpStatus()`** (`src/qmd-client.ts`) lists collections (`name`, `documents`, …) but **not** per-path contexts, so it cannot supply the pre-fill — hence parsing `context list`.
- **Color codes:** qmd disables ANSI color when stdout is not a TTY. The plugin spawns with `stdio:["ignore","pipe","pipe"]`, so `context list` output is plain text (verified) — the parser need not strip ANSI.
- **Obsidian `file-menu`:** `workspace.on("file-menu", (menu: Menu, file: TAbstractFile, source: string) => …)` fires for both files (`TFile`) and folders (`TFolder`) in the file explorer. `TAbstractFile.path` is vault-relative with forward slashes on all platforms. `TFolder.isRoot()` identifies the vault root.
- Views/modals are **not** unit-tested in this repo (no Obsidian runtime in the vitest mock); **pure modules are**. So the parser and path-mapping live in a pure module with tests; the modal + menu wiring is manual-smoke only.

## Components

### New — pure logic: `src/qmd-context.ts` (MUST NOT import `obsidian`)

| Export | Signature | Responsibility |
|---|---|---|
| `vaultVirtualPath` | `(collection: string, relPath: string, isRoot: boolean) => string` | `isRoot` → `qmd://${collection}/`; else `qmd://${collection}/${relPath}`. `relPath` is the vault-relative path (`TAbstractFile.path`). |
| `parseContextList` | `(stdout: string) => ContextEntry[]` | Parse the grouped `qmd context list` text into `{collection, path, context}[]`. `path: ""` for root. |
| `readContext` | `(runQmd, collection, relPath, isRoot) => Promise<string \| null>` | Run `context list`, parse, return the matching entry's text or `null`. Any failure → `null`. |
| `setContext` | `(runQmd, virtualPath, text) => Promise<QmdResult>` | `runQmd(["context","add",virtualPath,text])`; map exit code → `{ok, error?}` (error = trimmed stderr). |
| `removeContext` | `(runQmd, virtualPath) => Promise<QmdResult>` | `runQmd(["context","rm",virtualPath])` → `{ok, error?}`. |

```ts
export interface ContextEntry { collection: string; path: string; context: string }
export interface QmdResult { ok: boolean; error?: string }
```

**`parseContextList` grammar** (matches `contextList()` in qmd source):
```
<collection>            ← line, no leading space, non-empty
  <path>                ← 2-space indent; literal "/ (root)" means path = ""
    <context text>      ← 4-space indent (the summary)
```
Lines before the first collection header (the `Configured Contexts` banner, blank lines) are ignored. A context value is taken as the single 4-space-indented line following its path line. Multi-line stored summaries are a known edge: only the first line is recovered; on any mismatch `readContext` returns `null` and the modal opens blank (acceptable degrade — no worse than Approach B).

### New — view: `src/views/context-modal.ts`

`ContextModal extends Modal`. Constructor deps: `{ app, runQmd, collection, file: TAbstractFile }`.
- `onOpen`: render a read-only label with the computed virtual path; render a `<textarea>`; render `[Remove]` (hidden initially) + `[Save]` (disabled) + Cancel. Then `await readContext(...)`: on a non-null result, fill the textarea and reveal `[Remove]`; the modal stays usable while loading (placeholder text "Loading current context…").
- Textarea `input` → enable Save iff `value.trim()` non-empty.
- **Save** → `setContext(runQmd, virtualPath, value.trim())` → `new Notice(ok ? "qmd context saved" : "qmd context: " + error)` → `close()`.
- **Remove** → `removeContext(runQmd, virtualPath)` → Notice → `close()`.
- Buttons disabled while a call is in flight (prevent double-submit).

### Edit — `src/main.ts`

- After the existing registrations, add:
  ```ts
  this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
    menu.addItem((i) => i.setTitle("Set qmd context…").setIcon("text-cursor-input")
      .onClick(() => new ContextModal({ app: this.app, runQmd, collection: this.settings.vaultCollectionName, file }).open()));
  }));
  ```
  `runQmd` = the same `makeRunQmd(this.settings.binaryPath)` already built for the `Indexer` (lift it into a local so both share it).
- Add a command (no default hotkey, matching the others):
  ```ts
  this.addCommand({ id: "set-qmd-context", name: "Set qmd context for current file",
    checkCallback: (checking) => {
      const f = this.app.workspace.getActiveFile();
      if (!f) return false;
      if (!checking) new ContextModal({ app: this.app, runQmd, collection: this.settings.vaultCollectionName, file: f }).open();
      return true;
    }});
  ```

## Data flow

```
right-click file/folder ─▶ "Set qmd context…" ─▶ ContextModal.open()
  └─ readContext(runQmd, col, file.path, isRoot)
        └─ qmd context list ─▶ parseContextList ─▶ match path ─▶ prefill | blank
  Save ─▶ setContext(runQmd, qmd://col/rel, text) ─▶ qmd context add … ─▶ Notice
  Remove ─▶ removeContext(runQmd, qmd://col/rel) ─▶ qmd context rm … ─▶ Notice
```

## Error handling

- All qmd calls use the never-throws `runQmd`; non-zero exit → `{ok:false, error: stderr.trim()}` → surfaced verbatim in a `Notice`.
- **Vault not indexed yet** (`vaultCollectionName` is not a registered collection): `context add` exits non-zero with `Path is not in any indexed collection` / `Collection not found` — shown as-is in the Notice. No upfront async guard in the menu handler (menu build stays synchronous).
- `readContext` failure is silent → blank textarea (never blocks opening the modal).

## Open question — daemon liveness (verify in smoke; non-blocking)

`context add/rm` writes config and syncs to SQLite `store_config`; the query/rerank pipeline reads contexts via `getStoreContexts(db)`. Whether the **already-running** daemon re-reads contexts per request or caches them at startup is unverified. Plan: during the manual smoke step, add a context, then run a search whose rerank should reflect it (or re-read the MCP collection-listing resource) **without** restarting the daemon. If stale, document "contexts apply on next daemon start" in the README and treat a live-refresh hook as possible later work — it does **not** block this feature.

## Security

The summary text is user free-text passed as a **spawn argv element** (not a shell string) on macOS/Linux — safe. On **Windows**, `platformSpawnOptions` sets `shell:true`, which routes argv through `cmd.exe`; a summary containing shell metacharacters (`&`, `|`, `>`, `"`, `%`) could be mangled or injected. Mitigation for v1: this matches the *existing* posture (collection name / mask already flow through the same Windows `shell:true` path) and the input is local + first-party (the vault owner typing their own note summary), so the trust boundary is unchanged. Note the Windows-quoting caveat in the plan; if hardening is wanted, escape/quote the argv for the Windows shell path — out of scope for v1 unless requested.

## Testing (vitest — pure logic only)

- `parseContextList`: multi-collection grouped output; root (`/ (root)` → `""`) vs subpath; the `Configured Contexts` banner and blank lines ignored; empty output → `[]`; a malformed block does not throw.
- `vaultVirtualPath`: root folder → `qmd://vault/`; nested folder `Projects/Sub` → `qmd://vault/Projects/Sub`; file `Projects/note.md` → `qmd://vault/Projects/note.md`; custom collection name honored.
- `setContext` / `removeContext`: assert exact argv handed to a fake `runQmd` (`["context","add","qmd://vault/Projects/note.md","summary"]` / `["context","rm",…]`) and the `{ok}` / `{ok:false,error}` mapping from `code`/`stderr`.
- `readContext`: fake `runQmd` returning canned `context list` stdout → returns the matching summary; non-matching path → `null`; `code:-1` → `null`.

The modal + menu/command wiring is **manual-smoke only** (no Obsidian runtime in tests).

## Manual smoke (Windows-native qmd + Obsidian per deploy topology)

1. Build, copy `main.js` + `manifest.json` + `styles.css` to the vault's `.obsidian/plugins/qmd-search/`, reload Obsidian.
2. Right-click a note → "Set qmd context…" → type a summary → Save → confirm Notice; verify `qmd context list` shows it under `vault` at the note's path.
3. Right-click the same note again → textarea pre-filled with the saved summary → edit → Save → verify overwrite (no duplicate).
4. Right-click a folder → set context → verify `qmd://vault/<folder>` entry.
5. Remove → verify the entry is gone from `qmd context list`.
6. Daemon-liveness check (see Open question).
7. Vault-not-indexed path: confirm the qmd stderr is surfaced in the Notice (only if reproducible).

## Out of scope (YAGNI)

Multi-select `files-menu`; a contexts side-panel; an `editor-menu` trigger; global (`/`) context editing from the UI; any change to the qmd repo (e.g. `context list --json`); Windows shell-arg hardening beyond the existing posture.
