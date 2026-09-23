/** Wrapper fino sobre `chrome.i18n` para el popup. */
export function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions);
}
