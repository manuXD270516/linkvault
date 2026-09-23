import { getBrowser } from './browser-api';

/** Wrapper fino sobre i18n de la extensión para el popup. */
export function t(key: string, substitutions?: string | string[]): string {
  return getBrowser().i18n.getMessage(key, substitutions);
}
