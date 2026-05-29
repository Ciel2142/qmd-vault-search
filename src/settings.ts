import type { ScoreTier } from "./score-tier";

export interface QmdSettings {
  binaryPath: string;             // command or absolute path to `qmd`
  daemonPort: number;             // HTTP daemon port
  vaultCollectionName: string;    // qmd collection name for this vault; "" = auto-derive from the vault folder name on first load
  mask: string;                   // glob for vault indexing
  externalCollections: string[];  // extra collections to include in search
  rerank: boolean;                // LLM rerank on explicit search
  debounceMs: number;             // on-save reindex debounce
  relatedMinScore: number;        // related-notes min similarity
  relatedTopK: number;            // related-notes panel neighbor count
  searchMode: "keyword" | "hybrid"; // search-panel mode (persisted toggle)
  searchMinTier: ScoreTier;       // search-panel minimum relevance floor (hybrid+rerank only)
  searchDebounceMs: number;       // keyword as-you-type debounce
  fallbackOnFailure: boolean;     // hybrid errors → retry as keyword
  fallbackOnZero: boolean;        // hybrid 0 results → retry as keyword
  autoReindex: boolean;           // reindex vault on save
}

export const DEFAULT_SETTINGS: QmdSettings = {
  binaryPath: "qmd",
  daemonPort: 8181,
  vaultCollectionName: "",
  mask: "**/*.md",
  externalCollections: [],
  rerank: true,
  debounceMs: 1500,
  relatedMinScore: 0.3,
  relatedTopK: 8,
  searchMode: "hybrid",
  searchMinTier: "low",
  searchDebounceMs: 300,
  fallbackOnFailure: true,
  fallbackOnZero: false,
  autoReindex: true,
};

export function baseUrl(s: Pick<QmdSettings, "daemonPort">): string {
  return `http://localhost:${s.daemonPort}`;
}

/**
 * Slug a vault folder name into a qmd collection name: vault_<slug>.
 * Lowercases, collapses non-alphanumerics to "_", trims, and caps length
 * (vault_ + slug ≤ 64). A name with no [a-z0-9] (symbol- or non-Latin-only)
 * slugs to "" and falls back to the generic "vault".
 */
export function deriveCollectionName(vaultName: string): string {
  const slug = vaultName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 58)
    .replace(/_+$/, "");
  return slug ? `vault_${slug}` : "vault";
}

/** Resolve the effective collection name: explicit/persisted wins; else fresh→derive, existing→legacy "vault". */
export function resolveVaultCollectionName(args: { savedName: string; hadSavedData: boolean; vaultName: string }): string {
  if (args.savedName) return args.savedName;
  return args.hadSavedData ? "vault" : deriveCollectionName(args.vaultName);
}
