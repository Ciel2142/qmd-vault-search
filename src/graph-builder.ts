import type { QmdSearchResult } from "./qmd-client";

export type CollectionKind = "vault" | "external";
export interface GraphNode { id: string; label: string; file: string; collectionKind: CollectionKind; score: number; }
export interface GraphEdge { source: string; target: string; weight: number; }
export interface EgoGraph { nodes: GraphNode[]; edges: GraphEdge[]; }

export interface CenterSpec { id: string; label: string; file: string; }

export function buildEgoGraph(
  center: CenterSpec,
  neighbors: QmdSearchResult[],
  isVaultFile: (path: string) => boolean,
): EgoGraph {
  const nodes: GraphNode[] = [
    { id: center.id, label: center.label, file: center.file, collectionKind: isVaultFile(center.file) ? "vault" : "external", score: 1 },
  ];
  const edges: GraphEdge[] = [];
  for (const n of neighbors) {
    nodes.push({ id: n.docid, label: n.title || n.file, file: n.file, collectionKind: isVaultFile(n.file) ? "vault" : "external", score: n.score });
    edges.push({ source: center.id, target: n.docid, weight: n.score });
  }
  return { nodes, edges };
}
