import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { forceSimulation, forceLink, forceManyBody, forceCenter, type SimulationLinkDatum } from "d3-force";
import type { QmdClient } from "../qmd-client";
import type { QmdSettings } from "../settings";
import { deriveNeighbors } from "../neighbors";
import { buildEgoGraph, type EgoGraph, type GraphNode } from "../graph-builder";

export const VIEW_TYPE_QMD_GRAPH = "qmd-focus-graph";

type SimNode = GraphNode & { x?: number; y?: number; fx?: number | null; fy?: number | null };
type SimLink = SimulationLinkDatum<SimNode> & { weight: number };

export class FocusGraphView extends ItemView {
  private canvas!: HTMLCanvasElement;
  private sim: ReturnType<typeof forceSimulation<SimNode, SimLink>> | null = null;
  private renderToken = 0;

  constructor(leaf: WorkspaceLeaf, private client: QmdClient, private settings: QmdSettings) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_QMD_GRAPH; }
  getDisplayText(): string { return "qmd Focus Graph"; }
  getIcon(): string { return "git-fork"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.canvas = this.contentEl.createEl("canvas");
    this.canvas.width = this.contentEl.clientWidth || 600;
    this.canvas.height = this.contentEl.clientHeight || 400;
    const active = this.app.workspace.getActiveFile();
    if (active) await this.centerOn(active.path, active.basename);
  }

  /** Build the ego graph for a vault path and render it. */
  async centerOn(path: string, label: string): Promise<void> {
    const token = ++this.renderToken;
    try {
      const file = this.app.vault.getAbstractFileByPath(path);
      const content = file instanceof TFile ? await this.app.vault.cachedRead(file) : "";
      const neighbors = await deriveNeighbors(this.client, {
        content,
        collections: [this.settings.vaultCollectionName, ...this.settings.externalCollections],
        selfFile: path,
        limit: this.settings.graphTopK,
        minScore: this.settings.graphMinScore,
      });
      if (token !== this.renderToken) return; // a newer centerOn superseded this one
      const graph = buildEgoGraph({ id: "center", label, file: path }, neighbors, (p) => this.app.vault.getAbstractFileByPath(p) instanceof TFile);
      this.render(graph);
    } catch (e) {
      if (token === this.renderToken) new Notice("qmd graph: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  private render(graph: EgoGraph): void {
    const ctx = this.canvas.getContext("2d")!;
    const w = this.canvas.width, h = this.canvas.height;
    const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = graph.edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight }));
    this.sim?.stop();
    this.sim = forceSimulation<SimNode, SimLink>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id((d: SimNode) => d.id).distance(90))
      .force("charge", forceManyBody().strength(-220))
      .force("center", forceCenter(w / 2, h / 2))
      .on("tick", () => {
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = "rgba(168,130,255,0.5)";
        for (const l of links as (SimLink & { source: SimNode; target: SimNode })[]) {
          ctx.lineWidth = 0.5 + l.weight * 2;
          ctx.beginPath(); ctx.moveTo(l.source.x!, l.source.y!); ctx.lineTo(l.target.x!, l.target.y!); ctx.stroke();
        }
        for (const n of nodes) {
          ctx.fillStyle = n.collectionKind === "vault" ? "#a882ff" : "#4fd1c5";
          ctx.beginPath(); ctx.arc(n.x!, n.y!, n.id === "center" ? 9 : 6, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "var(--text-normal)"; ctx.font = "10px sans-serif";
          ctx.fillText(n.label.slice(0, 24), n.x! + 8, n.y! + 3);
        }
      });

    // Click → re-center on the clicked node (vault opens; external re-centers via its file path).
    this.canvas.onclick = (ev) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      const hit = nodes.find((n) => Math.hypot((n.x ?? 0) - mx, (n.y ?? 0) - my) < 10);
      if (hit && hit.id !== "center") void this.centerOn(hit.file, hit.label);
    };
  }

  async onClose(): Promise<void> { this.sim?.stop(); this.contentEl.empty(); }
}
