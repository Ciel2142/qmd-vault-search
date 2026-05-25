import type { FetchLike } from "./qmd-client";

/** Structural shape of Obsidian's `requestUrl` param — kept local so this module stays obsidian-free and unit-testable. */
export interface RequestUrlParamLike {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
}

/** Structural shape of Obsidian's `RequestUrlResponse` (the fields we read). */
export interface RequestUrlResponseLike {
  status: number;
  headers: Record<string, string>;
  text: string;
  json: unknown;
}

export type RequestUrlFnLike = (param: RequestUrlParamLike) => Promise<RequestUrlResponseLike>;

/**
 * Adapt Obsidian's `requestUrl` to the {@link FetchLike} surface QmdClient uses.
 *
 * Obsidian plugin code must not hit a local daemon with the renderer's `fetch`:
 * it throws "Illegal invocation" when called off the Window, and a JSON POST is
 * CORS-preflighted (the daemon sends no `Access-Control-Allow-Origin`). `requestUrl`
 * runs in the main process — no Window binding, no CORS.
 */
export function makeRequestUrlFetch(requestUrlFn: RequestUrlFnLike): FetchLike {
  return async (url, init) => {
    const res = await requestUrlFn({
      url,
      method: init?.method ?? "GET",
      headers: init?.headers,
      body: init?.body,
      throw: false, // let QmdClient inspect res.ok itself instead of throwing on non-2xx
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: {
        get: (name: string): string | null => {
          const want = name.toLowerCase();
          const hdrs = res.headers ?? {};
          for (const key of Object.keys(hdrs)) {
            if (key.toLowerCase() === want) return hdrs[key];
          }
          return null;
        },
      },
      json: async () => res.json,
    };
  };
}
