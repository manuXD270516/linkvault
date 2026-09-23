/**
 * Thin WebExtension API accessor: Firefox prefers `browser`, Chromium exposes `chrome`.
 * Both promise-based surfaces used by this app are compatible in FF ≥ 121 / Chrome MV3.
 */
export type ExtBrowser = typeof chrome;

export function getBrowser(): ExtBrowser {
  const global = globalThis as typeof globalThis & {
    browser?: ExtBrowser;
    chrome?: ExtBrowser;
  };
  const api = global.browser ?? global.chrome;
  if (api === undefined) {
    throw new Error('WebExtension API unavailable');
  }
  return api;
}
