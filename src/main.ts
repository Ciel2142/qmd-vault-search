import { Plugin } from "obsidian";

export default class QmdPlugin extends Plugin {
  async onload(): Promise<void> {
    console.log("qmd-search: loaded");
  }
  async onunload(): Promise<void> {
    console.log("qmd-search: unloaded");
  }
}
