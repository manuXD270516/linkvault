/**
 * Consulta que decide el modo compacto de la barra (D8 de web-shell-capabilities). Es el único sitio del SPA que
 * conoce el umbral: `shell.scss` cuelga los estilos compactos de una clase que pone el Shell. Si cambia, cambia
 * también `SHELL_WIDE_MIN_WIDTH_PX` en `apps/web-e2e/src/support/shell-nav.ts`, que decide el modo desde Playwright.
 */
export const SHELL_COMPACT_QUERY = '(max-width: 1023.98px)';
