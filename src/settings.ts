export interface QmdSettings {
  binaryPath: string;             // command or absolute path to `qmd`
  daemonPort: number;             // HTTP daemon port
  vaultCollectionName: string;    // qmd collection name for this vault
  mask: string;                   // glob for vault indexing
  externalCollections: string[];  // extra collections to include in search
  rerank: boolean;                // LLM rerank on explicit search
  debounceMs: number;             // on-save reindex debounce
  relatedMinScore: number;        // related-notes min similarity
  relatedTopK: number;            // related-notes panel neighbor count
  searchMode: "keyword" | "hybrid"; // search-panel mode (persisted toggle)
  searchDebounceMs: number;       // keyword as-you-type debounce
  fallbackOnFailure: boolean;     // hybrid errors → retry as keyword
  fallbackOnZero: boolean;        // hybrid 0 results → retry as keyword
  autoReindex: boolean;           // reindex vault on save
}

export const DEFAULT_SETTINGS: QmdSettings = {
  binaryPath: "qmd",
  daemonPort: 8181,
  vaultCollectionName: "vault",
  mask: "**/*.md",
  externalCollections: [],
  rerank: true,
  debounceMs: 1500,
  relatedMinScore: 0.3,
  relatedTopK: 8,
  searchMode: "hybrid",
  searchDebounceMs: 300,
  fallbackOnFailure: true,
  fallbackOnZero: false,
  autoReindex: true,
};

export function baseUrl(s: Pick<QmdSettings, "daemonPort">): string {
  return `http://localhost:${s.daemonPort}`;
}
