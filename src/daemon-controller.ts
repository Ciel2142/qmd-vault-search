export interface SpawnedChild {
  unref(): void;
}
export type SpawnFn = (cmd: string, args: string[], opts: Record<string, unknown>) => SpawnedChild;

export interface DaemonControllerDeps {
  client: { health(): Promise<{ ok: boolean }>; mcpStatus(): Promise<{ name: string }[]> };
  spawnFn: SpawnFn;
  binaryPath: string;
  port: number;
  vaultCollectionName: string;
}

export class DaemonController {
  constructor(private deps: DaemonControllerDeps) {}

  async isRunning(): Promise<boolean> {
    return (await this.deps.client.health()).ok;
  }

  /**
   * Health alone can't tell our daemon from a FOREIGN qmd daemon squatting the same
   * port (e.g. a WSL daemon shadowing the Windows one under WSL2 mirrored networking):
   * the foreign one answers /health ok but serves a different index. Confirm the
   * reachable daemon actually lists our vault collection before trusting it.
   */
  async servesVaultCollection(): Promise<boolean> {
    if (!(await this.isRunning())) return false;
    try {
      const cols = await this.deps.client.mcpStatus();
      return cols.some((c) => c.name === this.deps.vaultCollectionName);
    } catch {
      return false;
    }
  }

  start(): void {
    const child = this.deps.spawnFn(
      this.deps.binaryPath,
      ["mcp", "--http", "--daemon", "--port", String(this.deps.port)],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
  }

  /** Probe once; if down, start and report. Caller re-probes before use. */
  async ensureRunning(): Promise<"already" | "started"> {
    if (await this.isRunning()) return "already";
    this.start();
    return "started";
  }
}
