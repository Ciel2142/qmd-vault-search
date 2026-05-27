export type DaemonState = "up" | "down" | "starting" | "unknown";

export interface DaemonStatusView {
  text: string;       // status-bar label
  className: string;  // state-specific CSS class (colour)
  tooltip: string;    // hover title
}

/** Map daemon state → status-bar presentation. Pure; the UI controller owns the DOM. */
export function renderDaemonStatus(state: DaemonState, port: number): DaemonStatusView {
  switch (state) {
    case "up":
      return { text: "qmd ● up", className: "qmd-daemon-up", tooltip: `qmd daemon running on port ${port}` };
    case "starting":
      return { text: "qmd ◌ starting…", className: "qmd-daemon-starting", tooltip: "qmd daemon starting…" };
    case "down":
      return { text: "qmd ○ start", className: "qmd-daemon-down", tooltip: `qmd daemon down on port ${port} — click to start` };
    case "unknown":
      return { text: "qmd ◌", className: "qmd-daemon-unknown", tooltip: "qmd daemon — checking…" };
  }
}
