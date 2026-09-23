import type { Route } from '@angular/router';

/**
 * Rutas de `/descubrir`. El `Shell` las carga con `loadChildren`, así que ni este archivo ni la
 * página se descargan hasta navegar aquí (spec web/discovery).
 */
export const DISCOVERY_ROUTES: Route[] = [
  {
    path: '',
    loadComponent: () => import('./discovery.page').then((m) => m.DiscoveryPage),
  },
];
