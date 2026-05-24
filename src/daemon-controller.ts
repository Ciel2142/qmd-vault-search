export interface SpawnedChild {
  unref(): void;
}
export type SpawnFn = (cmd: string, args: string[], opts: Record<string, unknown>) => SpawnedChild;

export interface DaemonControllerDeps {
  client: { health(): Promise<{ ok: boolean }> };
  spawnFn: SpawnFn;
  binaryPath: string;
  port: number;
}

export class DaemonController {
  constructor(private deps: DaemonControllerDeps) {}

  async isRunning(): Promise<boolean> {
    return (await this.deps.client.health()).ok;
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
