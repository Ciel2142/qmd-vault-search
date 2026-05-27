# Vault-folder-derived collection name — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fresh installs default the qmd vault collection name to `vault_<slug(vaultFolderName)>`; existing installs keep their name.

**Architecture:** Two pure functions in `src/settings.ts` (`deriveCollectionName`, `resolveVaultCollectionName`) + a `""` default sentinel; `main.ts` `loadSettings` resolves the name (fresh→derive, persist once); `settings-tab.ts` description + clear-resets-to-derived.

**Tech Stack:** TypeScript, Obsidian 1.7.2, vitest, esbuild.

**Spec:** `docs/superpowers/specs/2026-05-27-vault-collection-name-design.md` · **Issue:** `obsidian_qmd_plugin-gnc` · **Branch:** `vault-collection-name`

Run one test file: `npx vitest run test/settings.test.ts`. Full: `npm test`. Build: `npm run build`.

---

## Task 1: pure functions + default sentinel (TDD)

**Files:** Modify `src/settings.ts`; Test `test/settings.test.ts`.

- [ ] **Step 1: Write the failing tests.** Append to `test/settings.test.ts`:
```ts
import { deriveCollectionName, resolveVaultCollectionName } from "../src/settings";

describe("deriveCollectionName", () => {
  it("slugs spaces and case", () => { expect(deriveCollectionName("My Notes")).toBe("vault_my_notes"); });
  it("slugs digits and mixed punctuation", () => { expect(deriveCollectionName("Work 2025!")).toBe("vault_work_2025"); });
  it("keeps an already-clean name", () => { expect(deriveCollectionName("already_clean")).toBe("vault_already_clean"); });
  it("trims leading/trailing separators", () => { expect(deriveCollectionName("  -Vault- ")).toBe("vault_vault"); });
  it("falls back to 'vault' when the slug is empty", () => {
    expect(deriveCollectionName("***")).toBe("vault");
    expect(deriveCollectionName("")).toBe("vault");
    expect(deriveCollectionName("日本語")).toBe("vault");
  });
});

describe("resolveVaultCollectionName", () => {
  it("keeps an explicit/persisted name", () => {
    expect(resolveVaultCollectionName({ savedName: "custom", hadSavedData: true, vaultName: "X" })).toBe("custom");
  });
  it("derives for a fresh install (no saved data)", () => {
    expect(resolveVaultCollectionName({ savedName: "", hadSavedData: false, vaultName: "My Notes" })).toBe("vault_my_notes");
  });
  it("keeps legacy 'vault' for an existing install with an empty name", () => {
    expect(resolveVaultCollectionName({ savedName: "", hadSavedData: true, vaultName: "My Notes" })).toBe("vault");
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/settings.test.ts` — "deriveCollectionName is not a function".

- [ ] **Step 3: Implement.** In `src/settings.ts`: change the default `vaultCollectionName: "vault",` to `vaultCollectionName: "",` and append the two functions:
```ts
/** Slug a vault folder name into a qmd collection name: vault_<slug>. */
export function deriveCollectionName(vaultName: string): string {
  const slug = vaultName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug ? `vault_${slug}` : "vault";
}

/** Resolve the effective collection name: explicit/persisted wins; else fresh→derive, existing→legacy "vault". */
export function resolveVaultCollectionName(args: { savedName: string; hadSavedData: boolean; vaultName: string }): string {
  if (args.savedName) return args.savedName;
  return args.hadSavedData ? "vault" : deriveCollectionName(args.vaultName);
}
```

- [ ] **Step 4: Fix any default assertion.** If `test/settings.test.ts` already asserts `DEFAULT_SETTINGS.vaultCollectionName === "vault"`, change that expectation to `""`. (Check first — only edit if present.)

- [ ] **Step 5: Run → PASS.** `npm test` — all green (existing + new).

- [ ] **Step 6: Commit.**
```bash
git add src/settings.ts test/settings.test.ts
git commit -m "feat: derive vault collection name from folder (pure fns + sentinel)"
```

---

## Task 2: wire `loadSettings` (build-verified)

**Files:** Modify `src/main.ts`.

- [ ] **Step 1: Import the resolver.** The settings import line `import { DEFAULT_SETTINGS, QmdSettings, baseUrl } from "./settings";` becomes:
```ts
import { DEFAULT_SETTINGS, QmdSettings, baseUrl, resolveVaultCollectionName } from "./settings";
```

- [ ] **Step 2: Replace `loadSettings`.** Current (`main.ts:86`):
```ts
  async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
```
becomes:
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

- [ ] **Step 3: Build + test.** `npm run build && npm test` — tsc clean (no unused imports, `merged.vaultCollectionName` typed string), esbuild writes main.js, all tests pass. If a type error on `saved` indexing, STOP and report rather than casting to `any`.

- [ ] **Step 4: Commit.**
```bash
git add src/main.ts
git commit -m "feat: resolve vault collection name on load (fresh installs derive)"
```

---

## Task 3: settings-tab description + clear-resets (build-verified)

**Files:** Modify `src/settings-tab.ts`.

- [ ] **Step 1: Import the deriver.** Add to the top: `import { deriveCollectionName } from "./settings";`

- [ ] **Step 2: Update the field.** Replace the "Vault collection name" `Setting` (lines 17–18):
```ts
    new Setting(containerEl).setName("Vault collection name").setDesc("qmd collection name for this vault.")
      .addText((t) => t.setValue(this.plugin.settings.vaultCollectionName).onChange(async (v) => { this.plugin.settings.vaultCollectionName = v || "vault"; await this.plugin.saveSettings(); }));
```
with:
```ts
    new Setting(containerEl).setName("Vault collection name").setDesc("qmd collection name for this vault. Defaults to vault_<vault name>; clear to reset.")
      .addText((t) => t.setValue(this.plugin.settings.vaultCollectionName).onChange(async (v) => { this.plugin.settings.vaultCollectionName = v.trim() || deriveCollectionName(this.app.vault.getName()); await this.plugin.saveSettings(); }));
```

- [ ] **Step 3: Build.** `npm run build` — tsc clean (`this.app` is available on `PluginSettingTab`), esbuild writes main.js.

- [ ] **Step 4: Commit.**
```bash
git add src/settings-tab.ts
git commit -m "feat: settings field defaults to derived collection name; clear resets"
```

---

## Done criteria
- [ ] `npm run build && npm test` green.
- [ ] `git log` shows 3 task commits on `vault-collection-name`.
- [ ] Manual smoke (spec) on a fresh test vault: collection `vault_<folder>` created; existing vault unchanged.
- [ ] `bd close obsidian_qmd_plugin-gnc` after merge; merge no-ff → master (user pushes).
