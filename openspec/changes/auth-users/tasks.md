## 1. Base y plataforma

- [x] 1.1 [infra] Añadir `@node-rs/argon2`, `jose` y `@fastify/cookie` (api) y `@ngrx/signals` (web) con versiones compatibles con Node 22, NestJS 11 y Angular 22; verificar que `pnpm install` termina sin builds nativos fallidos en Windows y que `pnpm nx run-many -t typecheck` pasa.
- [x] 1.2 [infra] Ampliar el doble RESP de `tools/testing` con `SET ... PX NX`, `INCR`, `PTTL` y `MULTI`/`EXEC` (D7); verificar con tests del doble usando ioredis real, incluido que `EXEC` devuelve el array con los resultados de `INCR` y `PTTL`.
- [x] 1.3 [backend] Añadir `currentPassword`, `newPassword` y `passwordHash` a `LOG_REDACT_PATHS` en `api` y `worker` (D10); verificar con el escenario "Cambio de contraseña registrado" y que los tests de redacción existentes siguen pasando.
- [x] 1.4 [backend] Añadir las variables `AUTH_*` a `apiConfigSchema` con las reglas y los `path` de D9, a `.env.example` y a `apiTestConfig`; verificar con "Secreto corto", "Secreto de ejemplo en producción", "Máximo menor que la caducidad" y que los tests de configuración, arranque, DI y salud de api y worker pasan.

## 2. Contratos compartidos

- [x] 2.1 [backend] Crear `libs/shared/src/schemas/auth.schema.ts` y `user-profile.schema.ts` (D8) exportados desde el índice; verificar con tests de los schemas: normalización de email, límites de `displayName`, política de contraseña (9, 10, 128, 129 caracteres e igual al email), `updateProfileRequestSchema` vacío, con campo desconocido y con `outputLanguage` `fr`.

## 3. Módulo users

- [x] 3.1 [backend] Dominio de `users` (entidad con `passwordChangedAt`, perfil por defecto, `normalizeEmail`) y puerto `USER_REPOSITORY` con repositorio en memoria; verificar con "Perfil tras el registro" a nivel de dominio y tests de normalización.
- [x] 3.2 [backend] `MongoUserRepository` con schema, índice único sobre el email normalizado (esperando `Model.init()`) y traducción del duplicado a error de dominio; verificar con tests de integración sobre `mongodb-memory-server` (alta, búsqueda por email e id, duplicado, actualización parcial, `setPasswordHash` fija `passwordChangedAt`).
- [x] 3.3 [backend] Use cases `get-my-profile` y `update-my-profile` y `UsersFacade` exportado (`findCredentialsByEmail`, `createWithPassword`, `setPasswordHash`, `getAuthState`, `getProfile`); verificar con tests unitarios sobre el repositorio en memoria, incluida la actualización que solo cambia los campos enviados.

## 4. Módulo auth: dominio y adaptadores

- [x] 4.1 [backend] `domain/password-policy.ts` y errores de dominio de auth; verificar con tests de la política (mismos casos límite que 2.1).
- [x] 4.2 [backend] `domain/refresh-session.ts` con las reglas de D4 (validez de token y sesión, conflicto en < 10 s aunque el sucesor se haya usado, reuso a partir de 10 s, caducidad deslizante con máximo) y reloj inyectado; verificar con tests de "Caducidad deslizante con máximo absoluto", conflicto a 2 s, reuso a 10 y 11 s y sesión revocada.
- [x] 4.3 [infra] Regla de lint entre módulos de D2 (`DOMAIN_RESTRICTED_PATTERNS`, bloque por módulo con rutas absolutas) y filas sobre `modules/auth/domain` y `modules/users/domain` en `tools/workspace-rules`; verificar "El dominio importa otro módulo", "El dominio importa su propio módulo", que `mongoose` y `../application/x` siguen fallando en esos dominios, que las filas positivas fallan si se quitan los bloques y que `pnpm nx run-many -t lint` pasa.
- [x] 4.4 [backend] `Argon2PasswordHasher` con los parámetros de D6 y hash ficticio precalculado; verificar que el hash empieza por `$argon2id$`, que verifica y rechaza, y que `verifyDummy` ejecuta una verificación real.
- [x] 4.5 [backend] `JoseAccessTokenSigner` (HS256, `sub`, `sid`, `typ`, tolerancia 5 s, algoritmo fijado); verificar con tests de token válido, caducado, firmado con otro secreto, con `alg: none` y con `typ` distinto.
- [x] 4.6 [backend] `MongoSessionRepository`, parte 1: `auth_sessions` y `refresh_tokens` con índices único y TTL (`Model.init()`), apertura de sesión y revocación por sesión o por usuario salvo una; verificar con tests de integración de apertura, revocación y búsqueda por hash.
- [x] 4.7 [backend] `MongoSessionRepository`, parte 2: rotación con `withTransaction` que devuelve `rotated`/`conflict`/`reused`/`invalid` (D4); verificar con tests de integración de dos rotaciones concurrentes del mismo token (una gana, la otra `conflict`), de que `reused` deja la sesión revocada y de "Revocación durante un refresh".
- [x] 4.8 [backend] `RedisAppModule` (cliente propio con las opciones de D7) y `RedisAttemptLimiter` (`consume` antes de verificar, claves HMAC, `DEL` del email y `DECR` de la IP en éxito); verificar contra el doble de Redis (conteo, ventana, `reset`, `Retry-After`, IP que no acumula éxitos).
- [x] 4.9 [backend] Fail-open con aviso por racha, agrupación IPv6 por /64 y limitador en memoria para tests; verificar con el doble caído (permite y un solo aviso sin email en dos peticiones) y con tests de claves IPv6.

## 5. Módulo auth: casos de uso

- [x] 5.1 [backend] Use case `register` (política, email único, límite por IP, creación con perfil por defecto, apertura de sesión); verificar con tests unitarios de "Registro correcto", "Email ya registrado", límite de registros por IP y "Fallo al abrir la sesión tras crear el usuario".
- [x] 5.2 [backend] Use case `login` (consumo de límites por email e IP antes de verificar, hash ficticio, reinicio del contador del email en éxito); verificar con tests unitarios de "Credenciales inválidas indistinguibles", "Demasiados fallos por email", "Email inexistente también se limita" y "Login correcto reinicia el contador".
- [x] 5.3 [backend] Use cases `refresh-session` y `logout`; verificar con tests unitarios de "Rotación correcta", "Reuso revoca la sesión", "Refresh concurrente", "Logout revoca el refresh" y "Logout sin sesión", y que el aviso de reuso contiene `userId` y `sessionId` pero ningún token.
- [x] 5.4 [backend] Use case `change-password` (consume el límite del email, verifica la actual, revoca las sesiones distintas de `sid` y después guarda el hash); verificar con tests unitarios de "Cambio correcto revoca las otras sesiones", "Contraseña actual incorrecta", "Fuerza bruta de la contraseña actual" y que un fallo al revocar no cambia el hash.

## 6. Presentación de api

- [x] 6.1 [backend] Registrar `@fastify/cookie` en `configureApp`, helpers de cookie `lv_refresh` y hook `onRequest` de cabecera y tipo de contenido para `POST /api/auth/*` (D5); verificar con tests de atributos con y sin producción, borrado, y del hook sobre una ruta de test (sin cabecera → 403, `text/plain` y form-urlencoded → 415 con el cuerpo de error propio, ambos sin `Set-Cookie`).
- [x] 6.2 [backend] Pipe de validación zod y filtro de errores `{ code, message, fields? }`; verificar con tests del filtro (400 nombra campos sin valores, códigos de dominio a 401/403/409/415/429 con `Retry-After`).
- [x] 6.3 [backend] Decoradores de `presentation/http/auth-context/` y guard global con `passwordChangedAt`; `@Public()` en salud y auth; verificar con "Perfil sin token", "Token caducado", "Token anterior al cambio de contraseña", token de usuario inexistente y "Salud pública" sobre `createApp` + `inject`.
- [x] 6.4 [backend] `AuthController` register y login cableados en `AuthModule`; verificar con tests de integración de "Registro correcto", "Registro inválido", "Email ya registrado", "Login correcto", "Login fija la cookie de refresh", "Cookie segura en producción", "Hash Argon2id", "Respuestas sin hash" y "Login desde un formulario ajeno".
- [x] 6.5 [backend] `AuthController` refresh; verificar con tests de integración de "Rotación correcta", "Refresh sin cookie", "Reuso revoca la sesión", "Refresh concurrente", "Tres refresh concurrentes con el mismo token", "Refresh token no guardado en claro" y "Refresh sin cabecera".
- [x] 6.6 [backend] `AuthController` logout; verificar con tests de integración de "Logout revoca el refresh", "Logout sin sesión" y "Revocación durante un refresh".
- [x] 6.7 [backend] `POST /auth/password` y límites HTTP; verificar con tests de integración de "Cambio correcto revoca las otras sesiones", "Contraseña actual incorrecta", "Fuerza bruta de la contraseña actual", "Demasiados fallos por email", "Fallos concurrentes", "Logins correctos no agotan el límite por IP" y "Almacén de contadores caído".
- [x] 6.8 [backend] `UsersController` (`GET`/`PATCH /users/me`) cableado en `UsersModule` y ambos módulos en `AppModule`; verificar con tests de integración de "Consulta correcta", "Activar el consentimiento", "Campo no editable" e "Idioma no soportado", el test de tipos de `outputLanguage` (D8) y que el test de DI de `api` sigue pasando.

## 7. Web

- [x] 7.1 [frontend] `SessionStore` con `@ngrx/signals` y `AuthApi` con las llamadas de auth y perfil; verificar con tests del store y de `AuthApi` con `HttpTestingController` (`X-Requested-With` en todo `POST /api/auth/*`, sin Bearer en login, registro, refresh y logout).
- [x] 7.2 [frontend] `refresh()` de `AuthApi`: single-flight, lock `lv-refresh` de Web Locks con respaldo sin lock, reintentos con jitter ante 409, logout al agotarlos y `AbortSignal` (D11); verificar con dos llamadas concurrentes que producen un solo refresh, "Conflicto de refresh entre pestañas", "Cinco pestañas restauradas a la vez" (doble de `navigator.locks`), cuatro 409 seguidos (petición inicial y 3 reintentos) que llaman a logout y abort sin logout.
- [x] 7.3 [frontend] Interceptor funcional y registro en `app.config.ts`; verificar con "Token caducado durante el uso", "Refresh rechazado" y "Contraseña actual incorrecta no renueva".
- [x] 7.4 [frontend] Initializer de restauración ("Conectando…", timeout de 10 s que aborta) y `authGuard`/`guestGuard` con `returnUrl` interno; verificar con "Recarga con sesión", "API sin respuesta al cargar", "Ruta protegida sin sesión", "Página de invitado con sesión" y "Ruta de retorno externa" (también `/\evil.example`).
- [x] 7.5 [frontend] Rutas (`/login`, `/registro`, `/perfil`, `/`), shell con botón de cerrar sesión y página de inicio "Hola, {displayName}"; verificar con tests de rutas (lazy, guards aplicados) y "Logout con red caída".
- [x] 7.6 [frontend] Página de login (mostrar/ocultar, mensajes por código, `returnUrl` en el enlace a registro); verificar con "Login correcto con redirección", "Credenciales inválidas", "Demasiados intentos", mensaje sin conexión y "Almacenamiento limpio tras el login" (`localStorage` y `sessionStorage`).
- [x] 7.7 [frontend] Página de registro (pista de longitud, aviso de datos, mostrar/ocultar, `returnUrl`); verificar con "Registro conserva la ruta pedida", "Email ya registrado" (email pasado por `state`, no en la URL) y errores de validación en cliente.
- [x] 7.8 [frontend] Página de perfil con `displayName` y cambio de contraseña; verificar con "Guardar el nombre", "Cambiar la contraseña" (incluida la renovación en la petición siguiente), "Contraseña actual incorrecta en el perfil", mensaje de `429` y pista de longitud, y que no hay controles de consentimiento, idioma de salida ni redacción del nombre.
- [x] 7.9 [frontend] Marcar textos i18n de auth, perfil, inicio y shell, ejecutar `extract-i18n`, traducir `messages.en.xlf` y añadir el spec que exige `target` en cada unidad; verificar con "Traducciones completas" y que `pnpm nx build web` pasa.

## 8. Cierre

- [x] 8.1 [infra] Actualizar README (flujo de auth y variables `AUTH_*`), `docs/RUNBOOK.md` y `openspec-changes.yaml`: verificación de email y recuperación de contraseña en un change posterior; en `deploy-prod`, `trustProxy`, reseteo manual de contraseña por operador documentado, aviso de privacidad y borrado de cuenta; en `cv-match-suggestions`, controles de consentimiento con texto honesto (qué dato, a quién, qué se redacta, revocable) con `consentedAt` y versión del texto, idioma de salida ("Idioma de los análisis de IA") y redacción del nombre; en `groups`, `/` como lista de grupos con estado vacío. Verificar que las variables de `.env.example` coinciden con `apiConfigSchema`.
- [ ] 8.2 [infra] Ejecutar `pnpm nx affected -t lint,typecheck,test,build --base=main` con `AI_CHAIN=mock AI_MOCK_MODE=replay` y `pnpm exec openspec validate --all`; verificar que todo pasa en verde.
