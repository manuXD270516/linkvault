## Why

Todo lo que viene después (grupos, links, postulaciones, CV) pertenece a un usuario, y la pasarela de IA ya espera su
consentimiento y preferencias (`aiConsent`, `outputLanguage`, `redactName`, ADR-018) sin que exista nadie que los tenga.
`auth-users` crea la identidad y la sesión con el modelo de ADR-012 (Critic C11 de design-v0.2: nada de JWT en
`localStorage`), para que `groups` y los changes siguientes solo tengan que pedir "usuario autenticado".

## What Changes

- **Registro y login** con email y contraseña (Argon2id), email normalizado y único, mensajes que no distinguen email
  inexistente de contraseña incorrecta en el login.
- **Sesión según ADR-012**: access token de 15 min devuelto en el cuerpo y guardado solo en memoria del SPA; refresh token
  opaco en cookie `httpOnly; SameSite=Lax` (`Secure` en producción) con **rotación** en cada uso, caducidad deslizante de
  30 días y máximo absoluto de 90 días por sesión; **detección de reuso** que revoca la sesión completa.
- **Endpoints** bajo `/api`: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`,
  `POST /auth/password` (cambio autenticado que revoca las demás sesiones), `GET /users/me` y `PATCH /users/me`.
- **Rutas protegidas por defecto**: toda ruta de la API exige access token salvo las marcadas públicas (auth y salud).
- **Protección contra fuerza bruta** con límites de intentos en Redis (login por email e IP, registro por IP), `429` con
  `Retry-After`.
- **Perfil** con `displayName`, `aiConsent.externalProviders` (por defecto `false`), `outputLanguage` (`es` por defecto,
  `en`) y `redactName` (por defecto `false`), editables por API; el SPA solo muestra email, nombre y cambio de contraseña
  (los controles de IA llegan con `cv-match-suggestions`).
- **Frontend**: páginas de login y registro (mostrar contraseña, mensajes por error, aviso de uso de datos), perfil con
  nombre y cambio de contraseña, inicio con saludo, store de sesión con signals, interceptor que adjunta el token y renueva
  ante `401`, guards de rutas autenticadas y de invitado, restauración de la sesión al recargar y logout; textos en ES y EN.
- **Plataforma**: dos módulos de dominio en `api` (`auth` y `users`) y la regla de lint pendiente de ADR-017: el dominio
  de un módulo no importa otros módulos. Redacción en logs de los nuevos campos de contraseña.

## Capabilities

### New Capabilities
- `auth/credentials`: registro, login, política y almacenamiento de contraseñas, cambio de contraseña y límites contra
  fuerza bruta.
- `auth/sessions`: access token, refresh token en cookie con rotación, caducidad y detección de reuso, logout, rutas
  protegidas por defecto y defensa CSRF de los endpoints de auth.
- `users/profile`: lectura y edición del perfil propio con consentimiento de IA y preferencias de salida.
- `web/auth`: login, registro, perfil, store de sesión, interceptor, guards y restauración de la sesión en el SPA.

### Modified Capabilities
- `platform/workspace`: "Aislamiento de la capa de dominio" añade que el dominio de un módulo de `api` no importa otros
  módulos.
- `platform/runtime-health`: "Logs sin secretos" añade `currentPassword`, `newPassword` y `passwordHash` a los campos
  redactados.

## Impact

- **Código**: `apps/api/src/modules/{auth,users}/` (domain, application, infrastructure, presentation), guard global y
  cookie en el arranque de `api`, conexión Redis de aplicación; `apps/web/src/app/{core/auth,features/auth,features/profile}`;
  contratos zod en `libs/shared/src/schemas/`.
- **API**: 7 endpoints nuevos bajo `/api`; `/health` y `/health/live` siguen públicos.
- **Datos**: colecciones `users` (índice único por email normalizado), `auth_sessions` y `refresh_tokens` (índices TTL).
- **Dependencias**: `@node-rs/argon2`, `jose`, `@fastify/cookie` (api) y `@ngrx/signals` (web).
- **Configuración**: `AUTH_JWT_SECRET`, `AUTH_ACCESS_TOKEN_TTL_SECONDS`, `AUTH_REFRESH_TTL_DAYS` y
  `AUTH_REFRESH_MAX_DAYS` en `.env.example` y en la validación de arranque de `api`.
- **Lint**: bloque de imports entre módulos de dominio en `eslint.config.mjs` con filas en `tools/workspace-rules`.
- **ADRs**: implementa ADR-012 y crea ADR-020 (detalles de sesión y límites); cumple ADR-017 (límites, cierra su pendiente de imports entre módulos) y ADR-018 (el
  perfil aporta `aiConsent`, `outputLanguage` y `redactName` al contexto de `runTask`).
- **Fuera de alcance**: verificación de email y recuperación de contraseña (no hay infraestructura de email; se anotan en
  el manifiesto), OAuth/SSO, 2FA, borrado de cuenta, avatar, gestión de sesiones por dispositivo y roles de grupo
  (`groups`).
