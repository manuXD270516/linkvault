import type { Route } from '@angular/router';

/**
 * Rutas de `/postulaciones`, el primer feature con su propio archivo de rutas (D11). El `Shell` lo carga con
 * `loadChildren`, así que ni este archivo ni el tablero se descargan hasta navegar aquí.
 * Insights: `/postulaciones/insights` (design D5 / spec web/analytics).
 */
export const APPLICATIONS_ROUTES: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('./applications-board.page').then((m) => m.ApplicationsBoardPage),
  },
  {
    path: 'insights',
    loadComponent: () =>
      import('./applications-insights.page').then((m) => m.ApplicationsInsightsPage),
  },
];
