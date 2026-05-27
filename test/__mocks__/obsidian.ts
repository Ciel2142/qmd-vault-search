// Minimal stand-ins so any accidental "obsidian" import resolves under vitest.
// Pure logic modules must NOT import obsidian; this exists as a safety net.
export class Plugin {}
export class PluginSettingTab {}
export class ItemView {}
export class Modal {}
export class Setting {}
export class Notice { constructor(_msg: string) {} }
export class TFile {}
export class WorkspaceLeaf {}
export class MarkdownView {}
export const MarkdownRenderer = { render: async () => {} };
