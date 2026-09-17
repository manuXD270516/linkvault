## Context

`api` tiene arranque, configuración validada con zod antes de Nest, logs con redacción, Mongo (replica set) y un cliente
Redis solo para salud; sus carpetas son planas (`infrastructure/`, `presentation/`). `web` tiene Material, Tailwind, i18n
ES/EN, una ruta placeholder y el proxy de `/api` al mismo origen (D10 de `bootstrap-monorepo`), pensado para la cookie de
ADR-012. `libs/ai` define `RunContext` con `aiConsent`, `outputLanguage` (`es`|`en`) y `redactName`. No hay usuarios.
Los tests de `api` usan `mongodb-memory-server` y un doble RESP de Redis con `PING`, `GET`, `SET` y `DEL`. Motivación y
alcance: ver proposal.md; comportamiento: ver specs. Las decisiones no triviales quedan en ADR-020.

## Goals / Non-Goals

**Goals:**
- Primer módulo de dominio completo de `api` con clean architecture, que sirva de plantilla a `groups` y `job-links`.
- Sesión segura por defecto: rutas protegidas salvo exclusión explícita, sin tokens en almacenamiento del navegador.
- Tests de integración de cada endpoint sin servicios externos (Mongo en memoria, doble de Redis).

**Non-Goals:**
- Lista negra de access tokens: el access token vive 15 min tras un logout (tras un cambio de contraseña se invalida, D3).
- Sesiones por dispositivo visibles al usuario, "cerrar todas las sesiones" como acción propia.
- Controles de consentimiento de IA, idioma de salida y redacción del nombre en el SPA: llegan con `cv-match-suggestions`,
  cuando haya CV y redacción completa que explicar. La API y los valores por defecto sí entran (ADR-018).
- Integración del perfil con `runTask` en el worker (llega con el primer consumidor).
- Aviso "Tu sesión caducó" al volver a `/login` (posterior a `groups`).
- E2E de Playwright en CI: el recorrido de navegador lo cubre `/lv:smoke`.

## Decisions

### D1 — Dos módulos: `users` y `auth`

```
apps/api/src/modules/
├── users/
│   ├── domain/          user.ts (entidad, normalizeEmail, reglas de displayName), user-profile.ts
│   ├── application/     ports (USER_REPOSITORY), get-my-profile, update-my-profile, users.facade.ts
│   ├── infrastructure/  mongo-user.repository.ts, user.schema.ts (índice único emailNormalized)
│   └── presentation/    users.controller.ts (GET/PATCH /users/me), users.module.ts
└── auth/
    ├── domain/          password-policy.ts, refresh-session.ts (reglas de rotación, conflicto, reuso y caducidad), errores
    ├── application/     ports (USER_ACCOUNTS, PASSWORD_HASHER, SESSION_REPOSITORY, ACCESS_TOKEN_SIGNER,
    │                    ATTEMPT_LIMITER, CLOCK), register, login, refresh-session, logout, change-password
    ├── infrastructure/  argon2-password-hasher, jose-access-token-signer, mongo-session.repository,
    │                    redis-attempt-limiter, users-facade-user-accounts (adaptador al facade de users)
    └── presentation/    auth.controller.ts, access-token.guard.ts (global), refresh-cookie.ts, auth-headers.ts,
                         auth.module.ts
apps/api/src/presentation/http/auth-context/   public.decorator.ts, current-user.decorator.ts, authenticated-user.ts
```

El documento `users` (dueño: `users`) guarda perfil, `passwordHash` y `passwordChangedAt`. `auth` no toca la colección:
usa el puerto `USER_ACCOUNTS` (`findCredentialsByEmail`, `createWithPassword`, `setPasswordHash`, `getAuthState`,
`getProfile`) implementado con el `UsersFacade` que exporta `UsersModule`. El usuario se crea en una sola escritura; la
sesión se abre después en otra. Si esta falla, el registro responde 500 y el usuario ya existe: un reintento recibe
`email_taken` y un login funciona (escenario de `auth/credentials`). *Alternativa descartada:* colección `credentials`
propia de `auth`, que obliga a una transacción entre módulos en el registro.

`@Public()`, `@CurrentUser()` y el tipo `AuthenticatedUser` viven en `presentation/http/auth-context/`, fuera de los
módulos: los usan la salud (plataforma), `users` y `auth`, y así ningún módulo importa la presentación de otro. Los
adaptadores de Mongo y Redis de la app (`MongoPersistenceModule`, un nuevo `RedisAppModule`) siguen en
`apps/api/src/infrastructure/`; las carpetas planas actuales no se mueven.

Nota de implementación: el filtro global de errores (`presentation/http/api-exception.filter.ts`, plataforma) traduce los
errores de dominio de `auth` y `users` importándolos directamente. Es aceptable con dos módulos; cuando `groups` añada los
suyos, se sustituirá por una base común de error de dominio con `code` que el filtro traduzca sin conocer los módulos.

### D2 — Regla de lint entre módulos

El bloque actual `**/domain/**` usa la regla base `no-restricted-imports` con la lista de infraestructura y la prohibición
de importar otras capas; ESLint no combina opciones entre bloques, así que un bloque posterior sobre la misma regla la
reemplazaría. Por eso:

- Los patrones del dominio pasan a una constante `DOMAIN_RESTRICTED_PATTERNS` que usa el bloque genérico.
- Un bloque por módulo de `apps/api/src/modules/<m>/domain/**` con `[...DOMAIN_RESTRICTED_PATTERNS, ...patrones de otros
  módulos]`, expresados con `regex` como el resto de la lista:
  `^(?:\.\./)+<otro>/(?:domain|application|infrastructure|presentation)(?:/|$)`, que acierta a cualquier profundidad dentro
  de `domain/` y no confunde una carpeta propia con el mismo nombre. Los módulos se listan con
  `readdirSync(join(import.meta.dirname, 'apps/api/src/modules'))` y `existsSync`, independientes del cwd de `nx lint`.
- Filas en `tools/workspace-rules` sobre rutas reales: `modules/auth/domain` importando `users` falla, importando
  `mongoose` falla, importando `../application/x` falla, un archivo anidado en `auth/domain/sub/` importando `users` falla,
  y un import interno de `auth/domain` pasa.

La tarea va después de crear los dominios de ambos módulos.

### D3 — Access token JWT con `jose`

HS256 firmado con `AUTH_JWT_SECRET`, claims `sub` (userId), `sid` (id de sesión), `iat`, `exp`, `typ: "access"`;
verificación con tolerancia de reloj de 5 s y algoritmo fijado. El guard global (`APP_GUARD`) verifica firma y caducidad
y carga con `getAuthState` el usuario (existencia y `passwordChangedAt`): si `iat` es anterior a
`floor(passwordChangedAt / 1000)`, responde 401. Esa lectura por petición es asumida (un documento por id); lo que evita el
JWT frente a un token opaco es la búsqueda por hash del token y la gestión de su caducidad en cada petición, no la consulta
del usuario. `@Public()` marca register, login, refresh, logout y los controladores de salud. *Alternativa:*
`@nestjs/jwt` (añade `jsonwebtoken` y opciones laxas de algoritmo por defecto).

### D4 — Sesiones y refresh tokens en Mongo

Colecciones del módulo `auth`:

- `auth_sessions { _id (sid), userId, createdAt, expiresAt (createdAt + AUTH_REFRESH_MAX_DAYS), revokedAt? }`.
- `refresh_tokens { tokenHash (único), sessionId, userId, createdAt, expiresAt, rotatedAt?, replacedByHash? }`, índice
  TTL sobre `expiresAt` e índice TTL de `auth_sessions` sobre `expiresAt` (limpieza; la validez se comprueba en código).

Token: 32 bytes aleatorios en base64url; se guarda `sha256(token)`.

Rotación (use case `refresh-session`), dentro de `session.withTransaction` (que reintenta ante `WriteConflict`; al releer,
el perdedor ve `rotatedAt` y cae en el paso 2):
1. Buscar el token por hash y su sesión. Sin token, sesión revocada, o cualquiera de los dos caducado → `invalid_refresh`.
2. Si `rotatedAt` existe: si `now - rotatedAt < 10 s` → `refresh_conflict` (409); si no → revocar la sesión y
   `invalid_refresh` con aviso de reuso.
3. `findOneAndUpdate({ tokenHash, rotatedAt: null }, { rotatedAt: now, replacedByHash })`.
4. Comprobar de nuevo `auth_sessions.revokedAt` dentro de la transacción e insertar el sucesor con
   `expiresAt = min(now + AUTH_REFRESH_TTL_DAYS, session.expiresAt)`.

El callback **devuelve** un resultado (`rotated`, `conflict`, `reused`, `invalid`); no lanza para señalar reuso, porque eso
deshace la revocación. El código HTTP se decide fuera de la transacción.

La revocación (logout, reuso, cambio de contraseña) es un único `updateOne`/`updateMany` sobre `auth_sessions`; como el
refresh valida la sesión dentro de la transacción, un sucesor emitido en paralelo a una revocación queda inservible en su
siguiente uso. La ventana de 10 s cubre pestañas o peticiones que refrescan a la vez: el jar de cookies es compartido, así
que quien recibe 409 reintenta con el token nuevo. Si un ladrón rota primero, el cliente legítimo agota sus reintentos y
llama a logout, que revoca la sesión (D11). Las reglas de los pasos 1–2 y la caducidad viven en
`domain/refresh-session.ts` con reloj inyectado.

### D5 — Cookie y CSRF

`@fastify/cookie` registrado en `configureApp`. Cookie `lv_refresh`: `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`,
`Max-Age` = segundos hasta `expiresAt`, `Secure` si `NODE_ENV=production`. Borrado con el mismo `Path` y `Max-Age=0`.
Respuestas 403, 409 y 415 no emiten `Set-Cookie`. Un hook `onRequest` de las rutas `POST /api/auth/*`, antes del parser de
cuerpo, mira solo cabeceras: primero `X-Requested-With: linkvault` (403) y después, si hay cuerpo, `application/json` (415),
ambos con el cuerpo de error propio; así login y registro tampoco pueden
dispararse desde un formulario ajeno (login CSRF). Sin CORS: web y API comparten origen.

### D6 — Argon2id con `@node-rs/argon2`

Parámetros OWASP mínimos: `memoryCost 19456` KiB, `timeCost 2`, `parallelism 1`. Binarios precompilados (napi) para
Windows y Linux sin toolchain nativa. El login con email inexistente verifica contra un hash ficticio calculado una vez al
arrancar. `needsRehash` no se implementa hasta que cambien los parámetros. *Alternativa:* `argon2` (node-gyp como respaldo).

### D7 — Límite de intentos en Redis

Puerto `ATTEMPT_LIMITER` con `consume(key, limit) → { allowed, retryAfterSeconds }` y `reset(key)`. Se consume **antes** de
verificar: `MULTI` con `SET k 0 PX 900000 NX`, `INCR k`, `PTTL k`; rechazo si el contador supera el límite. Un login
correcto hace, en un `MULTI`, `DEL` de la clave del email y `DECR` de la de IP, para que la IP solo acumule fallos (sin
`trustProxy` todas las peticiones del proxy comparten IP). Claves: `auth:login:email:<HMAC-SHA256(AUTH_JWT_SECRET,
email)>`, `auth:login:ip:<ip>`, `auth:register:ip:<ip>`; IPv6 se agrupa por su /64. El email cuenta exista o no la cuenta
(evita enumerar por el 429). El registro cuenta cada intento. IP desde `request.ip` con `trustProxy` desactivado; su
configuración de producción llega con `deploy-prod`.

Fail-open: si Redis falla o tarda más de 200 ms, la petición se permite. Un solo `warn` sin email al empezar cada racha de
fallos (patrón `reportedFailure` del cliente de salud) y un `info` al recuperarse.

Conexión: `RedisAppModule` con un cliente ioredis propio (no el de salud), `lazyConnect`, `enableOfflineQueue: false`,
`enableReadyCheck: false` y `commandTimeout` 200 ms. El doble RESP de `tools/testing` añade `SET ... PX NX`, `INCR`, `PTTL`
y `MULTI`/`EXEC` (con `+QUEUED` y array de resultados); los tests unitarios usan un limitador en memoria.

### D8 — Contratos en `libs/shared`

`libs/shared/src/schemas/auth.schema.ts` (`registerRequestSchema`, `loginRequestSchema`, `changePasswordRequestSchema`,
`sessionResponseSchema`, códigos de error como enum) y `user-profile.schema.ts` (`userProfileSchema`,
`updateProfileRequestSchema` con `.strict()` y refinamiento de no vacío, `outputLanguageSchema = z.enum(['es','en'])`).
Los usan los controladores (pipe zod) y el SPA (formularios y tipos). La política de contraseña está en el schema
compartido y el dominio de `auth` la reaplica. Errores con cuerpo `{ code, message, fields? }`; `fields` solo nombra campos.

`libs/ai` mantiene su tipo `OutputLanguage`; un test de tipos en `api`
(`expectTypeOf<z.infer<typeof outputLanguageSchema>>().toEqualTypeOf<OutputLanguage>()`) evita que diverjan sin crear aún
una dependencia `ai → shared`.

### D9 — Configuración

`apiConfigSchema` añade `AUTH_JWT_SECRET` (≥32), `AUTH_ACCESS_TOKEN_TTL_SECONDS` (60–3600), `AUTH_REFRESH_TTL_DAYS`
(1–90) y `AUTH_REFRESH_MAX_DAYS` (≤365) con `superRefine` para la relación TTL ≤ máximo y para rechazar en producción el
secreto de ejemplo (constante exportada, que el test de `.env.example` compara). Cada issue del `superRefine` lleva
`path: ['AUTH_REFRESH_MAX_DAYS']` o `['AUTH_JWT_SECRET']`, porque `parseEnv` descarta los issues sin variable.
`.env.example`: `AUTH_JWT_SECRET=dev-only-change-me-...`, 900, 30, 90. `apiTestConfig` añade un secreto de test y los mismos
TTL; `worker` no los lee.

### D10 — Redacción de logs

`LOG_REDACT_PATHS` (api y worker) añade `currentPassword`, `newPassword` y `passwordHash` con las tres profundidades de D11
de `bootstrap-monorepo`. `pino-http` no registra cuerpos; los use cases no registran emails (el aviso de reuso usa `userId`
y `sessionId`).

### D11 — SPA

- `core/auth/session.store.ts` con `@ngrx/signals`: `accessToken`, `expiresAt`, `user`, `status`
  (`unknown` | `authenticated` | `anonymous`); `setSession`, `clear`.
- `core/auth/auth.api.ts`: llamadas de auth y perfil; `X-Requested-With` en todo `POST /api/auth/*`; `refresh()`
  single-flight en la pestaña y serializado entre pestañas con `navigator.locks.request('lv-refresh', …)` (Web Locks, sin
  almacenamiento); dentro del lock, hasta 3 reintentos ante 409 (250/500/1000 ms con ±50 % de jitter) y, si se agotan,
  `logout()`. Acepta un `AbortSignal` que cancela esperas y reintentos sin llamar a logout.
- `core/auth/auth.interceptor.ts` (funcional): adjunta `Bearer` salvo en login, register, refresh y logout; solo ante 401 con
  `code === 'unauthorized'` espera el refresh compartido y reintenta una vez; si falla, `clear()` y navega a
  `/login?returnUrl=`.
- `provideAppInitializer` muestra "Conectando…", intenta el refresh inicial con timeout de 10 s que aborta la cadena y fija
  `status`. Tras un cambio de contraseña el access token actual deja de valer; la petición siguiente recibe 401 y el
  interceptor renueva (respuesta 204 sin sesión nueva).
- `core/auth/auth.guards.ts`: `authGuard` y `guestGuard`; `returnUrl` solo si empieza por `/` y no por `//` ni `/\`, y se
  navega con `router.navigateByUrl`.
- `features/auth/{login,register}.page.ts`: Reactive Forms tipados y Material, mostrar/ocultar contraseña, pista de
  longitud y aviso de datos en el registro, `returnUrl` propagado en los enlaces y email pasado por `router.navigate(...,
  { state })` (nunca en la URL), mapa código → mensaje con `Retry-After` en minutos.
- `features/profile/profile.page.ts`: email en lectura, `displayName` y formulario de cambio de contraseña con sus mensajes
  de error propios y pista de longitud.
- `features/home/home.page.ts`: "Hola, {displayName}" (`groups` la convierte en la lista de grupos).
- `layout/shell` con barra y botón de cerrar sesión para las rutas autenticadas.
- Rutas visibles en español salvo `/login` (reconocible): `/registro`, `/perfil`; `groups` sigue la regla (`/grupos`).
- i18n con atributos `i18n` y `$localize`; ES fuente y `messages.en.xlf` actualizado con `extract-i18n`.

### D12 — Tests

- Dominio y use cases: unitarios con repositorios, hasher, firmador, limitador y reloj en memoria.
- Endpoints: integración con `createApp` + `inject` de Fastify sobre `mongodb-memory-server` y el doble de Redis, con
  `it(...)` con el nombre del escenario (nota de implementación: los specs de integración se agrupan por endpoint/tarea,
  `auth.controller.{register-login,refresh,logout,password}.spec.ts`, en lugar de uno por requisito; la trazabilidad es
  por nombre de escenario). Los repositorios esperan `Model.init()` antes de probar
  índices únicos; ningún test depende del borrado por TTL (el monitor corre cada 60 s).
- Web: Vitest + TestBed para store, `AuthApi`, interceptor (single-flight con `HttpTestingController`), guards,
  initializer y páginas. "Almacenamiento limpio" se prueba en unitario sobre `localStorage` y `sessionStorage` (jsdom no
  tiene IndexedDB) y en `/lv:smoke` con navegador real. Un spec de `web` lee `messages.en.xlf` y exige `target` en cada
  unidad (el build de `web` no localiza).

## Risks / Trade-offs

- **Access token válido 15 min tras logout** → TTL corto y configurable; tras un cambio de contraseña sí se invalida (D3).
- **`409 email_taken` permite enumerar emails en el registro** → aceptado sin verificación de email; limitado a 10
  registros por IP cada 15 min.
- **Bloqueo de login por email como DoS**: 5 intentos cada 15 min desde IPs distintas bloquean a la víctima → aceptado con
  grupos pequeños; el mensaje habla de "intentos", no de cuenta bloqueada (ADR-020).
- **Fail-open del limitador con Redis caído** → aviso por racha; readiness ya marca Redis caído.
- **Ventana de 10 s de conflicto** → un robo del refresh token dentro de la ventana obtiene como mucho una rotación; el
  cliente legítimo que agota sus reintentos llama a logout y revoca la sesión (ADR-020).
- **Corte de red tras rotar**: si el servidor rota pero la cookie nueva no llega, el siguiente refresh pasados 10 s cuenta
  como reuso y cierra la sesión → aceptado: caso raro y seguro (obliga a volver a entrar).
- **Web Locks no disponible** (navegadores antiguos) → se degrada a single-flight por pestaña con jitter.
- **Logout con la red caída** deja la cookie válida y una recarga restaura la sesión → aceptado: caso raro, sin almacenamiento
  extra en el navegador.
- **Sin recuperación de contraseña** → mostrar/ocultar y pista de longitud en el registro; el reseteo manual por operador se
  anota en el manifiesto como requisito de `deploy-prod`.
- **Argon2id cuesta ~50 ms y 19 MiB por verificación** → el límite se consume antes de verificar y acota el abuso.

## Migration Plan

Sin datos previos. Despliegue: añadir las variables `AUTH_*` al entorno antes de arrancar la versión nueva (el arranque
falla nombrándolas si faltan). Rollback: la versión anterior ignora `users`, `auth_sessions` y `refresh_tokens`.

## Open Questions

- Configuración de `trustProxy` y cabecera de IP real detrás del proxy de producción: se fija en `deploy-prod` sin cambiar
  la spec (la clave de límite sigue siendo "IP del cliente").
