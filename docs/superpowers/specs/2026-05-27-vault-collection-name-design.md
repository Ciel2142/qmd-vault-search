# qmd × Obsidian — Vault-folder-derived collection name

- **Date:** 2026-05-27
- **Status:** Approved design — ready for implementation
- **Project:** `/home/igi21/experiements/obsidian/obsidian_qmd_plugin`
- **Issue:** `obsidian_qmd_plugin-gnc`
- **Builds on:** `src/settings.ts` (`DEFAULT_SETTINGS`, `baseUrl`), `main.ts` `loadSettings`, `settings-tab.ts`.

## Goal

Stop defaulting every vault's qmd collection to the static name `vault`. On a **fresh install**, default it to `vault_<slug(vaultFolderName)>` so multiple vaults on one machine don't collide on the single shared qmd index (where `ensureCollection` skips by name and a second vault silently rides the first's collection). Existing installs keep their current name. The name stays user-editable.

## Locked decisions

| Decision | Choice | Source |
|---|---|---|
| Scope of change | **Fresh installs only.** Existing installs (a `data.json` exists) keep their persisted name, including the literal `vault`. No auto-rename, no `mcpStatus` migration. | Q: migration |
| Fresh-vs-existing signal | `Plugin.loadData()` returns `null` when there is no `data.json` (truly fresh). Any prior use leaves a `data.json`. Use that, not a qmd query — avoids needing the daemon during settings load. | Derived |
| Name format | `vault_<slug>`, prefix kept per the request (`vault_foldername`). | Q: format |
| Slug rule | `vaultName.toLowerCase()` → non-`[a-z0-9]` runs to `_` → trim leading/trailing `_`. Empty result (symbol/emoji-only name) → fall back to `vault`. | Derived |
| Override | The `Vault collection name` setting stays editable. The derived name is **persisted once** so it shows as a concrete value. Clearing the field re-derives the default. | UX |
| Vault name source | `app.vault.getName()` — the vault's folder/display name. | Obsidian API |

## qmd / codebase facts this relies on

- One global qmd index per machine (`~/.cache/qmd/index.sqlite`); the plugin registers each vault as a named collection in it. `Indexer.ensureCollection` skips when a collection of that **name** already exists (`src/indexer.ts:21`) — the collision this fixes.
- `loadSettings` currently is `this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())` (`main.ts:86`). `loadData()` resolves to the saved object or `null`.
- The collection name is consumed by: `Indexer` (constructed in `onload` *after* `loadSettings`), the `ContextModal` (reads `settings.vaultCollectionName` at click time), and `settings-tab.ts:18`/`:48`. All read it after `loadSettings` resolves it to a non-empty value, so a `""` default is never observed downstream.
- qmd collection names accept lowercase + digits + `_`/`-` (existing collections include `obsidian_qmd_plugin`, `crawl4ai-docs`). `vault_<slug>` is valid.
- Pure logic lives in tested modules; `settings.test.ts` already exists for `settings.ts`.

## Components

### `src/settings.ts` (modify) — two pure functions + default sentinel

```ts
// default change:
vaultCollectionName: "",   // "" = auto-derive on first load (was "vault")

/** Slug a vault folder name into a qmd collection name: vault_<slug>. */
export function deriveCollectionName(vaultName: string): string {
  const slug = vaultName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug ? `vault_${slug}` : "vault";
}

/** Resolve the effective name: explicit/persisted wins; else fresh→derive, existing→legacy "vault". */
export function resolveVaultCollectionName(args: { savedName: string; hadSavedData: boolean; vaultName: string }): string {
  if (args.savedName) return args.savedName;
  return args.hadSavedData ? "vault" : deriveCollectionName(args.vaultName);
}
```

### `src/main.ts` (modify) — `loadSettings` resolves + persists once

```ts
async loadSettings(): Promise<void> {
  const saved = (await this.loadData()) as Partial<QmdSettings> | null;
  const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
  const vaultCollectionName = resolveVaultCollectionName({
    savedName: merged.vaultCollectionName,
    hadSavedData: saved != null,
    vaultName: this.app.vault.getName(),
  });
  this.settings = { ...merged, vaultCollectionName };
  if (vaultCollectionName !== merged.vaultCollectionName) await this.saveData(this.settings);
}
```

### `src/settings-tab.ts` (modify) — description + clear-resets-to-derived

Line 17–18 becomes (import `deriveCollectionName`):
```ts
new Setting(containerEl).setName("Vault collection name").setDesc("qmd collection name for this vault. Defaults to vault_<vault name>; clear to reset.")
  .addText((t) => t.setValue(this.plugin.settings.vaultCollectionName).onChange(async (v) => { this.plugin.settings.vaultCollectionName = v.trim() || deriveCollectionName(this.app.vault.getName()); await this.plugin.saveSettings(); }));
```

## Behavior table

| Situation | `loadData()` | merged name | Result |
|---|---|---|---|
| Fresh install | `null` | `""` | `deriveCollectionName(vaultName)` → `vault_<slug>`, persisted |
| Existing user (has `vault` saved) | object | `"vault"` | kept `"vault"` |
| Existing user, name field cleared then reloaded | object | `""` | `"vault"` (conservative; existing user untouched) |
| User set a custom name | object | `"my-notes"` | kept `"my-notes"` |

## Testing (vitest — pure logic)

`test/settings.test.ts`:
- `deriveCollectionName`: `"My Notes"` → `vault_my_notes`; `"Work 2025"` → `vault_work_2025`; `"already_clean"` → `vault_already_clean`; leading/trailing punctuation trimmed; `"***"`/`""` → `vault` (fallback); unicode-only → `vault`.
- `resolveVaultCollectionName`: explicit name kept; `savedName:"" + hadSavedData:false` → derived; `savedName:"" + hadSavedData:true` → `vault`; `savedName:"custom"` ignores `vaultName`.
- If `settings.test.ts` asserts `DEFAULT_SETTINGS.vaultCollectionName === "vault"`, update it to `""`.

`loadSettings` wiring + `settings-tab` are not unit-tested (need the plugin/Obsidian runtime); covered by build + manual smoke.

## Manual smoke

1. Build, deploy to a **new** test vault, enable → confirm a collection `vault_<thatfoldername>` is created (`qmd collection list`), and Settings shows that name.
2. Existing vault (already has `vault`): reload → still uses `vault`, no new collection.
3. Settings → clear the name field → it resets to `vault_<folder>`; type a custom name → persists.

## Out of scope

Auto-renaming existing `vault` collections; deriving names for external collections; changing the daemon-port-per-vault story (separate concern).
