import { renderDaemonStatus, type DaemonState } from "../daemon-status";

const PROBE_INTERVAL_MS = 2000; // re-probe cadence while a manual start loads models
const PROBE_ATTEMPTS = 10;      // ~20s budget for the daemon to come up

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface DaemonStatusBarDeps {
  el: HTMLElement;                              // addStatusBarItem() element
  port: number;
  health: () => Promise<{ ok: boolean }>;       // QmdClient.health
  start: () => void;                            // DaemonController.start
  notify: (msg: string) => void;                // new Notice
}

/**
 * Status-bar daemon indicator + manual start. Thin DOM wrapper around
 * renderDaemonStatus; the plugin owns the poll interval (registerInterval).
 */
export class DaemonStatusBar {
  private state: DaemonState = "unknown";

  constructor(private readonly deps: DaemonStatusBarDeps) {
    this.render();
  }

  /** Click handler for the status-bar element. Registered by the plugin via registerDomEvent (auto-cleaned on unload). */
  handleClick(): void {
    if (this.state === "down") void this.startDaemon();
  }

  private render(): void {
    const v = renderDaemonStatus(this.state, this.deps.port);
    this.deps.el.textContent = v.text;
    this.deps.el.title = v.tooltip;
    this.deps.el.className = `qmd-daemon-status ${v.className}${this.state === "down" ? " mod-clickable" : ""}`;
  }

  private set(state: DaemonState): void {
    this.state = state;
    this.render();
  }

  /** Poll health once and reflect it. Skipped while a manual start is in flight. */
  async refresh(): Promise<void> {
    if (this.state === "starting") return;
    this.set((await this.deps.health()).ok ? "up" : "down");
  }

  /** Spawn the daemon, then re-probe until healthy or the budget elapses. */
  async startDaemon(): Promise<void> {
    if ((await this.deps.health()).ok) {
      this.set("up");
      this.deps.notify("qmd daemon already running");
      return;
    }
    this.set("starting");
    this.deps.start();
    for (let i = 0; i < PROBE_ATTEMPTS; i++) {
      await delay(PROBE_INTERVAL_MS);
      if ((await this.deps.health()).ok) {
        this.set("up");
        this.deps.notify("qmd daemon started");
        return;
      }
    }
    this.set("down");
    this.deps.notify("qmd daemon didn't come up — check the qmd binary path in settings.");
  }
}
