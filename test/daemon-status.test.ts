import { describe, it, expect } from "vitest";
import { renderDaemonStatus } from "../src/daemon-status";

describe("renderDaemonStatus", () => {
  it("up: filled dot, running tooltip with port", () => {
    const v = renderDaemonStatus("up", 8181);
    expect(v.text).toBe("qmd ● up");
    expect(v.className).toBe("qmd-daemon-up");
    expect(v.tooltip).toContain("8181");
    expect(v.tooltip).toMatch(/running/i);
  });

  it("down: hollow dot, 'start' affordance, click-to-start tooltip", () => {
    const v = renderDaemonStatus("down", 8181);
    expect(v.text).toBe("qmd ○ start");
    expect(v.className).toBe("qmd-daemon-down");
    expect(v.tooltip).toMatch(/click to start/i);
  });

  it("starting: dotted marker + label", () => {
    const v = renderDaemonStatus("starting", 8181);
    expect(v.text).toBe("qmd ◌ starting…");
    expect(v.className).toBe("qmd-daemon-starting");
  });

  it("unknown: neutral checking state", () => {
    const v = renderDaemonStatus("unknown", 8181);
    expect(v.className).toBe("qmd-daemon-unknown");
    expect(v.tooltip).toMatch(/checking/i);
  });

  it("interpolates a custom port into up/down tooltips", () => {
    expect(renderDaemonStatus("up", 9999).tooltip).toContain("9999");
    expect(renderDaemonStatus("down", 9999).tooltip).toContain("9999");
  });
});
