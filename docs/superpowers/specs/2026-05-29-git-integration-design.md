# Git Integration for qmd Plugin — Design

**Status:** Draft (spec only — research deliverable for `obsidian_qmd_plugin-8ns`)
**Date:** 2026-05-29
**Author:** brainstorm with user `AT_VALukin`
**Related issue:** `obsidian_qmd_plugin-8ns`

---

## 1. Goal

Give qmd plugin users a tight, narrow integration with git: embeddings stay aligned with vault history, and a one-shot bootstrap command initialises a vault from a remote. All broad git UX (commit authoring, conflict resolution, branch ops, auth) is delegated to the existing **obsidian-git** community plugin (Vinzent03), which the user is expected to install alongside.

We do **not** build a general-purpose git client. We build the qmd-specific glue around someone else's.

## 2. Background

- Vault notes are markdown; users already round-trip through an external terminal or obsidian-git to commit / push.
- qmd embeddings (stored in `~/.cache/qmd/index.sqlite`, outside the vault) silently go stale after a pull until the user runs `qmd update --embed`. Search results lag.
- A fresh machine workflow ("install Obsidian + qmd plugin, then pull the vault") has no first-class command; obsidian-git refuses to clone into an existing vault root on desktop (verified via upstream `src/main.ts` clone modal placeholder + `CHANGELOG.md` entry "disallow clone in vault root on desktop").

## 3. Scope

### In scope

1. **Auto-reindex on pull.** Listen for `obsidian-git:head-change` workspace event; debounce; trigger `qmd update --embed`. Skip during merge / rebase state.
2. **Reindex-before-commit-and-sync proxy command.** Single command in palette that reindexes vault first, then delegates to `obsidian-git:push` (which = Commit-and-sync).
3. **Bootstrap vault from remote.** Single command that initialises an **empty** vault as a git repo, fetches from a remote URL/branch, hard-resets to that branch, and triggers initial reindex+embed.
4. **Status-bar tile** showing embedding-staleness state (clean / stale / deferred-by-merge / error).
5. **Settings toggle** for auto-reindex (default ON).
6. **Graceful degradation** when obsidian-git is absent: features no-op with a single notice.

### Out of scope

| Concern | Why |
|---|---|
| Mobile support | obsidian-git itself flags mobile as "highly unstable"; native git unavailable on iOS/Android. Our narrow ops spawn system `git`, so desktop-only. |
| Multi-repo vault (submodules, sibling repos) | KISS — explicit user decision. One vault = one git repo. Submodule-recursing pulls still work because we only listen to `head-change`, but no submodule UI / bootstrap. |
| Conflict resolution UI | obsidian-git owns this. |
| Commit message authoring | obsidian-git owns this (configurable date/template per upstream `docs/Features.md`). |
| Auth (PAT / SSH / credential helper) | obsidian-git owns this; bootstrap relies on system git credential helper. We never store credentials. |
| `.gitignore` management | User concern. We document a recommended template in a follow-up doc, no code. |
| LFS, signed commits, hooks | Out of scope. Pass-through if user configures system git for them. |
| Cloning into non-empty vault | Bootstrap is greenfield only; non-empty vaults must use obsidian-git's documented workflow (`Initialize a new repo` → add remote → pull). |
| Commit-on-reindex (auto) | Too noisy; explicit user trigger only. |

## 4. Decisions

| ID | Decision | Rationale |
|---|---|---|
| D1 | **Hybrid: build narrow ops, delegate broad ops.** | Avoids reinventing obsidian-git's mature conflict UI / commit views. Keeps bundle small. |
| D2 | **Desktop only.** | Native git spawn via `child_process` is smallest, most reliable; mobile path requires bundling isomorphic-git (~500KB+) for negligible benefit since obsidian-git already does that on its side. |
| D3 | **Delegate via command IDs + workspace events.** | `app.commands.executeCommandById('obsidian-git:push')` and `app.workspace.on('obsidian-git:head-change', ...)`. Stable surface in upstream source; not coupled to private plugin instance internals. |
| D4 | **Trigger model: auto-reindex on `head-change`, reindex-before-our-proxy-commit, never auto-commit.** | Captures the two moments embeddings drift (pull + push) without spamming commit history. |
| D5 | **Bootstrap: empty-vault only.** | Risk of merging unrelated histories into user-curated notes is unacceptable. Refuse on non-empty vault, point to obsidian-git's documented workflow. |
| D6 | **UX surface: 2 commands + 1 settings toggle + 1 status-bar tile.** | Matches the project's existing UX restraint (cf. score-tier feature). |
| D7 | **Defaults: auto-reindex ON, skip-during-merge ON, bootstrap explicit.** | Zero-config "search caught up after pull" is the dominant use case. Power users can disable in settings. |

## 5. Architecture

### 5.1 Component overview

```
              ┌──────────────────────────────────────────────┐
              │              qmd plugin (this)               │
              │                                              │
  user ──────▶│  command palette                             │
              │     ├─ qmd: Reindex + Commit-and-sync        │
              │     └─ qmd: Bootstrap vault from remote      │
              │                                              │
              │  status bar                                  │
              │     └─ embedding-staleness tile              │
              │                                              │
              │  settings tab                                │
              │     └─ Auto-reindex after pull (toggle)      │
              │                                              │
              │  ┌──────────────────────────────────────┐    │
              │  │ git-triggers   git-stale-status      │    │
              │  │ git-bridge     git-merge-guard       │    │
              │  │ git-bootstrap  indexer (existing)    │    │
              │  └──────────────────────────────────────┘    │
              └──────────────────────────────────────────────┘
                              │                  │
            executeCommandById│                  │spawn(qmd update --embed)
            workspace.on      │                  │spawn(git init/remote/fetch/reset)
                              ▼                  ▼
              ┌─────────────────────────┐  ┌────────────────────────┐
              │  obsidian-git plugin    │  │  system tooling        │
              │  (peer dependency)      │  │  - qmd CLI             │
              │   ├─ pull               │  │  - git                 │
              │   ├─ push (= Commit-    │  │                        │
              │   │   and-sync)        │  │                        │
              │   └─ emits head-change  │  │                        │
              └─────────────────────────┘  └────────────────────────┘
```

### 5.2 New files (`src/`)

| File | Purpose | Public surface |
|---|---|---|
| `git-bridge.ts` | Detect obsidian-git presence, invoke its commands, subscribe to its workspace events. | `isObsidianGitPresent(app): boolean`<br>`invokeGitCommand(app, id): Promise<Result>`<br>`onHeadChange(app, cb): () => void` |
| `git-bootstrap.ts` | Empty-vault check + spawn `git init/remote add/fetch/reset --hard` pipeline. | `bootstrapVault(opts: { vaultPath, remoteUrl, branch }): Promise<Result>` |
| `git-merge-guard.ts` | Inspect `.git/MERGE_HEAD` and `.git/REBASE_HEAD`. Resolve `.git` file → external gitdir. | `isMergeInProgress(vaultPath): Promise<boolean>` |
| `git-stale-status.ts` | Status-bar tile + state machine: clean / stale / deferred / error. | `mount(plugin)`, `setState(state)`, `unmount()` |
| `git-triggers.ts` | Wire `head-change` → debounce → reindex; register proxy commands. | `register(plugin, settings, bridge, guard, status)` |

Each new file targets ≤ ~150 LOC. No new dependencies. `child_process.spawn` already used elsewhere in the codebase (`runQmd`).

### 5.3 Touched existing files

- `src/main.ts` — register new commands, mount status-bar tile, call `git-triggers.register(...)` during plugin load.
- `src/settings.ts` — add fields:
  - `gitAutoReindex: boolean` (default `true`)
  - `gitAutoReindexDebounceMs: number` (default `2000`, no UI — internal constant for now)
- `src/settings-tab.ts` — render single toggle "Auto-reindex after pull".
- `src/indexer.ts` — expose a programmatic reindex entry point that returns a promise (current `notifyChange` is fire-and-forget). May already exist; verify during implementation.

## 6. Data flow

### 6.1 Pull → reindex (auto path)

```
obsidian-git pulls vault files
  → app.workspace.trigger('obsidian-git:head-change')
  → git-triggers listener
  → if settings.gitAutoReindex === false: stop
  → git-merge-guard.isMergeInProgress(vaultPath)?
        true  → git-stale-status.setState('deferred-by-merge'); stop
        false → debounce(settings.gitAutoReindexDebounceMs)
              → git-stale-status.setState('stale')
              → indexer.reindex({ embed: true })
              → on resolve: git-stale-status.setState('clean')
              → on reject:  git-stale-status.setState('error', err.message)
```

### 6.2 Manual sync (proxy command)

```
user runs "qmd: Reindex + Commit-and-sync"
  → if !bridge.isObsidianGitPresent: notice; stop
  → git-stale-status.setState('stale')
  → await indexer.reindex({ embed: true })
        reject → notice; setState('error'); stop (do not invoke obsidian-git)
        resolve → setState('clean')
                → await bridge.invokeGitCommand('obsidian-git:push')
                → obsidian-git handles commit + pull + push
                → its post-pull head-change re-fires our auto path
                  (idempotent: guard against immediate redundant reindex
                   by tracking "last reindex completed at" timestamp;
                   if reindex finished < 5s ago, skip)
```

### 6.3 Bootstrap (empty vault)

```
user runs "qmd: Bootstrap vault from remote"
  → modal: prompt for remote URL + branch (default "main")
  → on cancel: stop
  → on submit:
       → scan vault root: list files excluding .obsidian/
       → if non-empty: modal "Vault not empty. Cannot bootstrap.
                              Found: <up to 10 paths>. See docs."
                       stop
       → if empty:
             spawn git init                      cwd=vaultPath
             spawn git remote add origin <url>
             spawn git fetch origin <branch>
             spawn git reset --hard origin/<branch>
                → any non-zero exit: notice with stderr; stop
                                     (leave .git/ for user inspection)
             → trigger initial: indexer.reindex({ embed: true })
             → setState('clean')
```

### 6.4 Stale-state machine

```
        head-change                  reindex-success
  ┌───────────────────┐          ┌─────────────────────┐
  │                   ▼          │                     ▼
clean              stale ─────────────────────────▶ clean
  ▲   │              ▲│
  │   │ merge        │└─ reindex-failure ─▶ error ──┐
  │   │ detected     │                              │
  │   ▼              │                              │
  │  deferred ──merge-cleared (head-change)─────────┤
  │                                                 │
  └────────────────── user runs reindex manually ───┘
```

States rendered in status bar:

| State | Tile text | Tooltip |
|---|---|---|
| `clean` | (hidden) | — |
| `stale` | `qmd: indexing…` | "Vault changed (pull). Reindexing." |
| `deferred-by-merge` | `qmd: merge in progress` | "Resolve merge conflicts, then reindex will run." |
| `error` | `qmd: index error` | stderr last line, max 200 chars |

## 7. Error handling

| Scenario | Behavior |
|---|---|
| obsidian-git not installed/enabled | Proxy commands no-op + notice "Install obsidian-git plugin to use sync features". Auto-reindex listener still registers (cheap), but `head-change` is never emitted, so effectively dormant. Settings toggle visible but with helper text "Requires obsidian-git". |
| obsidian-git command ID missing (upstream rename) | `invokeGitCommand` returns error result; notice "obsidian-git command 'X' not found. Update obsidian-git, or open an issue at qmd plugin tracker." No exception. |
| `head-change` fires while reindex already running | Coalesce: drop incoming, set `reindexPending=true`. On completion, if `reindexPending`, run once more (max one re-run). |
| `qmd update --embed` exits non-zero | Status-bar `error` state; tooltip shows last stderr line. Stale flag stays until next successful reindex. No retry loop, no auto-restart. |
| Bootstrap into non-empty vault | Refuse with modal listing offending paths (cap 10). Never destructive. Show docs link. |
| Bootstrap: `git` not in PATH | Detect `ENOENT` from spawn; notice "git CLI not found. Install git and ensure it's on your PATH." |
| Bootstrap: remote auth failure | Surface git stderr verbatim (e.g. `fatal: Authentication failed for ...`). Leave `.git/` in place for user inspection. Don't auto-clean. |
| Vault `.git/` is a file (gitdir pointer for iCloud workaround) | Resolve before reading merge-state files: if `.git` is a file, parse `gitdir: <path>` line, read merge state from the resolved gitdir. |
| `.git/MERGE_HEAD` or `.git/REBASE_HEAD` present | Skip auto-reindex; status-bar shows `deferred-by-merge`. Next `head-change` after resolution clears state and triggers reindex. |
| User on iCloud with external gitdir | Bootstrap and auto-reindex both work (we resolve gitdir pointer; we depend on obsidian-git's events, not on watching `.git/`). |
| User has obsidian-git but no remote configured | Bootstrap unaffected (it creates the remote). Proxy commit-and-sync fails inside obsidian-git with its own error; we don't intercept. |
| Daemon (qmd MCP) is down during reindex | `qmd update --embed` runs via CLI (no daemon dependency for embed). Surfaces CLI stderr as status-bar `error`. |

## 8. Testing

### 8.1 Vitest unit tests (`test/`)

- `git-bootstrap.test.ts`
  - empty-vault detection ignores `.obsidian/`
  - non-empty vault: returns refusal + list of offending paths
  - URL/branch validation: reject empty input, reject shell-metachar input (`;`, `&`, ` `)
  - spawn pipeline argv composition (mock `spawn`, assert sequence of calls)
- `git-merge-guard.test.ts`
  - detects `.git/MERGE_HEAD` present
  - detects `.git/REBASE_HEAD` present
  - resolves `.git` file → external gitdir → reads merge state
  - returns `false` when neither file exists
- `git-bridge.test.ts`
  - `isObsidianGitPresent` reads `app.plugins.plugins['obsidian-git']`
  - `invokeGitCommand` calls `app.commands.executeCommandById` with correct ID
  - missing command → returns error result, no throw
  - `onHeadChange` subscribes + returns disposer
- `git-stale-status.test.ts`
  - state machine transitions: clean → stale → clean
  - stale → error sticky until cleared
  - merge → deferred sticky until merge clears
  - rendered tile text matches state

### 8.2 Manual smoke (documented, not automated)

1. **Auto-reindex on pull.** Install qmd plugin + obsidian-git in test vault. Pull vault changes via `obsidian-git: Pull`. Verify status-bar transitions clean → stale → clean within ~5s; `qmd status` shows new vector count.
2. **Skip during merge.** From terminal: `git merge --no-commit --no-ff <branch>` in vault. Trigger obsidian-git refresh. Verify status-bar shows `deferred-by-merge`. Resolve merge in obsidian-git UI. Verify status returns to clean after next `head-change`.
3. **Bootstrap empty vault.** Create new empty Obsidian vault. Run `qmd: Bootstrap vault from remote` with a small test repo. Verify files appear, status-bar shows clean, qmd search returns results.
4. **Bootstrap non-empty vault.** Run bootstrap on a vault with one note already. Verify refusal modal lists the note path. No `.git/` created.
5. **Reindex failure.** Kill qmd daemon mid-reindex (or rename the qmd binary on PATH). Trigger `head-change`. Verify status-bar shows `error` with stderr tooltip; flag stays until next successful run.
6. **obsidian-git missing.** Disable obsidian-git plugin. Run `qmd: Reindex + Commit-and-sync`. Verify single notice "Install obsidian-git plugin to use sync features". No exception in dev tools.

## 9. Security & risk

- **Spawn argv hygiene.** All bootstrap spawn calls pass argv as an array (no shell). Remote URL is validated against a simple regex (`^(https?|git|ssh)://...` or `git@host:path.git`) before reaching spawn. Branch name is validated against `^[A-Za-z0-9._\-/]+$`. No shell interpolation paths.
- **No credentials in plugin state.** Bootstrap relies on system `git credential helper`; we never read, prompt for, or persist passwords / PATs / SSH keys. Obsidian's `saveData` is plaintext on disk — would be unacceptable storage.
- **Destructive ops gated.** Only one destructive op exists: `git reset --hard origin/<branch>` during bootstrap, and only after the empty-vault check passes. No force-push, no `git clean`, no branch deletion, no submodule deinit.
- **Reentrancy.** Reindex coalescing prevents N concurrent `qmd update --embed` spawns; bootstrap is one-shot per command invocation; merge-guard caches per-tick (1s) to avoid hammering `fs.stat`.
- **Upstream stability risk.** `obsidian-git` command IDs and workspace event names are read from source, not a published API contract. We feature-detect commands; if upstream renames, we surface a clear error rather than crash. Documented in `git-bridge.ts` JSDoc.

## 10. Open questions / deferred

- **Branch detection for bootstrap.** Default branch could be detected via `git ls-remote --symref origin HEAD` instead of asking user. Deferred — Phase 5 polish.
- **iCloud vault preflight.** We rely on user having set up the `gitdir:` indirection per obsidian-git docs. We could detect a synced vault root and warn. Deferred.
- **First-class debounce setting in UI.** Currently hidden as an internal constant. Promote to advanced settings if real-world tuning needed.
- **Multi-repo vault.** Explicitly out of scope for this spec. If demand surfaces, a follow-up spec covering submodule mode (Model 1 from brainstorm) is the obvious extension.

## 11. Self-review

| Check | Result |
|---|---|
| Placeholders / TBD / TODO present? | None. |
| Internal contradictions? | None found. Scope (§3), decisions (§4), and data flow (§6) are consistent. |
| Scope appropriate for one implementation plan? | Yes. 5 new files + 4 touched files, ~750 LOC total. Single sprint. |
| Ambiguous requirements? | None. Each behavior has an explicit code path or out-of-scope marker. |

## 12. Implementation roadmap (handed off to writing-plans)

This spec is the research deliverable. A separate beads issue will be filed for the implementation plan (`bd create`) — typical phasing:

1. `git-bridge` + `git-merge-guard` + unit tests
2. `git-stale-status` + unit tests
3. `git-triggers` wiring + auto-reindex path (manual smoke 1, 2, 5)
4. Proxy command + manual smoke
5. `git-bootstrap` + bootstrap command + unit tests (manual smoke 3, 4, 6)
6. Settings toggle + tab rendering
7. Documentation update (README, `.gitignore` template recommendation)

## 13. References

- `obsidian-git` source (read 2026-05-29 at v2.38.3, 11k★, MIT): https://github.com/Vinzent03/obsidian-git
  - Command IDs verified in `src/commands.ts`
  - Workspace event names verified in `src/main.ts` (`obsidian-git:head-change`, `obsidian-git:refresh`, `obsidian-git:refreshed`, `obsidian-git:loading-status`)
  - Mobile caveats: `README.md` "📱 Mobile Support (⚠️ Experimental)" section
  - "Disallow clone in vault root on desktop" — `CHANGELOG.md`, closes upstream `#540`
  - Submodule support: `docs/Features.md` "Submodules Support" + `src/setting/settings.ts`
- qmd index location verified locally via `qmd status` → `~/.cache/qmd/index.sqlite`
- Existing qmd plugin code patterns: `src/qmd-client.ts`, `src/indexer.ts`, `src/main.ts`
