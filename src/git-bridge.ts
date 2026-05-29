import type { App, EventRef } from "obsidian";

const OBSIDIAN_GIT_ID = "obsidian-git";
export const HEAD_CHANGE_EVENT = "obsidian-git:head-change";

export interface InvokeResult { ok: boolean; error?: string }

/** True iff the obsidian-git community plugin is installed AND enabled in this vault. */
export function isObsidianGitPresent(app: App): boolean {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
  return !!plugins && OBSIDIAN_GIT_ID in plugins;
}

/** Invoke an obsidian-git command by id. Returns a structured result; never throws. */
export async function invokeGitCommand(app: App, id: string): Promise<InvokeResult> {
  const commands = (app as unknown as { commands?: { commands?: Record<string, unknown>; executeCommandById?: (id: string) => boolean } }).commands;
  if (!commands?.commands || !(id in commands.commands)) {
    return { ok: false, error: `obsidian-git command '${id}' not found. Update obsidian-git or open an issue.` };
  }
  try {
    const ran = commands.executeCommandById?.(id) ?? false;
    return ran ? { ok: true } : { ok: false, error: `Command '${id}' did not execute.` };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Subscribe to the post-pull head-change event. Returns a disposer. */
export function onHeadChange(app: App, cb: () => void): () => void {
  const ref = app.workspace.on(HEAD_CHANGE_EVENT as never, cb as never) as unknown as EventRef;
  return () => app.workspace.offref(ref);
}
