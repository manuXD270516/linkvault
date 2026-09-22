import { Route } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';
import { HOME_ROUTE } from './core/navigation/home-route';

/**
 * Rutas visibles en español salvo `/login` (D11 de auth-users). Todas exigen sesión salvo `/login`, `/registro`,
 * `/recuperar-contrasena`, `/restablecer-contrasena`, `/verificar-email`, `/privacidad` y la vista pública de una oferta
 * (`/oferta/:slug`). Las de email-auth se abren con sesión y sin ella (sin guestGuard: no redirigen a `/grupos`).
 */
export const appRoutes: Route[] = [
  {
    // Sin guard a propósito (D9 de public-preview-share): quien llega desde un chat no tiene cuenta, y esta ruta es la
    // primera impresión del producto. Es distinta de `/p/:slug`, que sirve la API, para poder repartirlas por path.
    path: 'oferta/:slug',
    loadComponent: () =>
      import('./features/public/public-preview.page').then((m) => m.PublicPreviewPage),
  },
  {
    // Público (spec web/privacy): aviso de CV, retención, IA/BYOK y borrado; sin sesión ni guestGuard.
    path: 'privacidad',
    loadComponent: () =>
      import('./features/privacy/privacy.page').then((m) => m.PrivacyPage),
  },
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
    // Sin guestGuard: usables con sesión (p. ej. verificar estando logueado) sin redirigir a `/grupos` (ADR-034).
    path: 'recuperar-contrasena',
    loadComponent: () =>
      import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'restablecer-contrasena',
    loadComponent: () =>
      import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'verificar-email',
    loadComponent: () =>
      import('./features/auth/verify-email.page').then((m) => m.VerifyEmailPage),
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
        path: 'mis-links',
        loadComponent: () =>
          import('./features/links/my-links.page').then((m) => m.MyLinksPage),
      },
      {
        path: 'postulaciones',
        loadChildren: () =>
          import('./features/applications/applications.routes').then((m) => m.APPLICATIONS_ROUTES),
      },
      {
        path: 'mi-cv',
        loadComponent: () => import('./features/cv/my-cv.page').then((m) => m.MyCvPage),
      },
      {
        path: 'plan/:analysisId',
        loadComponent: () =>
          import('./features/roadmap/roadmap.page').then((m) => m.RoadmapPage),
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
