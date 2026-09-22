import type { Route } from '@angular/router';

/**
 * Rutas de `/buscar`. El `Shell` las carga con `loadChildren`, así que ni este archivo ni la página
 * se descargan hasta navegar aquí (spec web/search).
 */
export const SEARCH_ROUTES: Route[] = [
  {
    path: '',
    loadComponent: () => import('./search.page').then((m) => m.SearchPage),
  },
];
