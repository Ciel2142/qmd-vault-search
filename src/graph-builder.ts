import type { QmdSearchResult } from "./qmd-client";
import { toVaultPath } from "./open-target";

export type CollectionKind = "vault" | "external";
export interface GraphNode { id: string; label: string; file: string; collectionKind: CollectionKind; score: number; }
export interface GraphEdge { source: string; target: string; weight: number; }
export interface EgoGraph { nodes: GraphNode[]; edges: GraphEdge[]; }

export interface CenterSpec { id: string; label: string; file: string; }

export function buildEgoGraph(
  center: CenterSpec,
  neighbors: QmdSearchResult[],
  resolveVaultPath: (collectionRelativePath: string) => string | null,
  vaultCollectionName: string,
): EgoGraph {
  // Vault nodes carry the real Obsidian path so click-to-recenter can read them; externals keep their collection path.
  const classify = (file: string): { file: string; kind: CollectionKind } => {
    const realPath = resolveVaultPath(toVaultPath(file, vaultCollectionName));
    return realPath !== null ? { file: realPath, kind: "vault" } : { file, kind: "external" };
  };

  const c = classify(center.file);
  const nodes: GraphNode[] = [
    { id: center.id, label: center.label, file: c.file, collectionKind: c.kind, score: 1 },
  ];
  const edges: GraphEdge[] = [];
  for (const n of neighbors) {
    const { file, kind } = classify(n.file);
    nodes.push({ id: n.docid, label: n.title || n.file, file, collectionKind: kind, score: n.score });
    edges.push({ source: center.id, target: n.docid, weight: n.score });
  }
  return { nodes, edges };
}
