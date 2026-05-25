export interface QmdSettings {
  binaryPath: string;             // command or absolute path to `qmd`
  daemonPort: number;             // HTTP daemon port
  vaultCollectionName: string;    // qmd collection name for this vault
  mask: string;                   // glob for vault indexing
  externalCollections: string[];  // extra collections to include in search/graph
  rerank: boolean;                // LLM rerank on explicit search
  debounceMs: number;             // on-save reindex debounce
  graphTopK: number;              // focus-graph neighbor count
  graphMinScore: number;          // focus-graph min similarity
  relatedTopK: number;            // related-notes panel neighbor count
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
  graphTopK: 12,
  graphMinScore: 0.3,
  relatedTopK: 8,
  autoReindex: true,
};

export function baseUrl(s: Pick<QmdSettings, "daemonPort">): string {
  return `http://localhost:${s.daemonPort}`;
}
