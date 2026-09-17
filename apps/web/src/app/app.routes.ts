import { Route } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';
import { HOME_ROUTE } from './core/navigation/home-route';

/** Rutas visibles en español salvo `/login` (D11 de auth-users). Todas exigen sesión salvo `/login` y `/registro`. */
export const appRoutes: Route[] = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'registro',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/register.page').then((m) => m.RegisterPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: HOME_ROUTE },
      {
        path: 'grupos',
        loadComponent: () =>
          import('./features/groups/groups-list.page').then((m) => m.GroupsListPage),
      },
      {
        path: 'grupos/:id',
        loadComponent: () =>
          import('./features/groups/group-detail.page').then((m) => m.GroupDetailPage),
      },
      {
        path: 'unirse',
        loadComponent: () =>
          import('./features/groups/join-group.page').then((m) => m.JoinGroupPage),
      },
      {
        path: 'perfil',
        loadComponent: () =>
          import('./features/profile/profile.page').then((m) => m.ProfilePage),
      },
    ],
  },
  { path: '**', redirectTo: HOME_ROUTE },
];
