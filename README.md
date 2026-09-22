# LinkVault

Monorepo Nx (pnpm) con `api` (NestJS + Fastify), `worker` (NestJS + BullMQ), `web` (Angular 22 zoneless) y las
librerías `shared` y `ai`. En desarrollo, Docker solo levanta la infraestructura (MongoDB, Redis, MinIO, Mailpit) y las
apps corren en el host ([ADR-017](docs/adr/ADR-017.md), correo local [ADR-034](docs/adr/ADR-034.md)).

- Reglas del proyecto y flujo con Claude Code: [CLAUDE.md](CLAUDE.md)
- Flujo de trabajo por changes de OpenSpec: [docs/RUNBOOK.md](docs/RUNBOOK.md)
- Decisiones de arquitectura: [docs/adr/](docs/adr/)

## Prerrequisitos

- **Node.js** en la versión de [`.nvmrc`](.nvmrc) (línea 22 LTS), por ejemplo con `nvm use`.
- **pnpm** en la versión exacta del campo `packageManager` de [`package.json`](package.json) (`corepack enable` la
  activa).
- **Docker** con Docker Compose v2.
- **Windows**: el redistribuible de Visual C++ (x64), que necesita el binario de MongoDB que descargan los tests
  (`mongodb-memory-server`).

## Puesta en marcha

```bash
pnpm install
cp .env.example .env
docker compose up -d --wait        # mongo (replica set rs0), redis, minio y mailpit, esperando a que estén sanos
```

Si ya tenías un `.env` de antes del enriquecimiento de links, cópiale de `.env.example` las variables `ENRICH_*` y `S3_*`:
son obligatorias y **el worker no arranca sin ellas** (ver [Variables del enriquecimiento](#variables-del-enriquecimiento)).
Si es de antes de pegar descripciones, cópiale además `PASTE_EXTRACTION_TIMEOUT_MS` y la sección `--- IA ---` entera:
**`api` ya no arranca sin ellas** (ver [La IA que ejecuta `api`](#la-ia-que-ejecuta-api)). Y si es de antes de los
enlaces públicos, `PUBLIC_PAGE_BASE_URL` y `WEB_BASE_URL`, obligatorias por el mismo motivo (ver
[Variables de las URLs públicas](#variables-de-las-urls-públicas)). Y si es de antes de los CV, **las cinco `S3_*`
—incluida `S3_BUCKET`— pasan a ser obligatorias también en `api`**, y el worker añade `CV_EXTRACTION_TIMEOUT_MS` y
`CV_EXTRACT_CONCURRENCY` (ver [Mi CV](#mi-cv)). Y si es de antes del correo transaccional, cópiale el bloque
`MAIL_*` / `RESEND_API_KEY` / `AUTH_VERIFY_TOKEN_TTL_HOURS` / `AUTH_RESET_TOKEN_TTL_SECONDS` (ver
[Correo transaccional](#correo-transaccional)).

Arranca cada app en su propia terminal:

```bash
pnpm nx serve api      # http://localhost:3000  (rutas de la API bajo /api)
pnpm nx serve worker   # http://localhost:3001  (solo rutas de salud)
pnpm nx serve web      # http://localhost:4200  (reenvía /api a la API: mismo origen)
```

Comprueba la salud (fuera del prefijo `/api`):

```bash
curl http://localhost:3000/health/live   # liveness: 200 si el proceso vive, sin consultar dependencias
curl http://localhost:3000/health        # readiness: 200 con Mongo y Redis arriba, 503 si alguno falla
curl http://localhost:3001/health        # lo mismo para el worker
```

Para bajar la infraestructura sin borrar datos: `docker compose down`.

### IA local con Ollama (opcional)

```bash
docker compose --profile ai-local up -d --wait   # añade ollama en http://localhost:11434
```

No descarga modelos. En desarrollo, `.env.example` usa el mock con `AI_CHAIN=mock` y `AI_MOCK_MODE=synth`; los tests y CI fuerzan `AI_CHAIN=mock` y `AI_MOCK_MODE=replay`. `AI_CHAIN=none` desactiva la IA (las tareas degradan).
La IA la ejecutan **dos procesos**: el worker (lectura de páginas) y `api` (descripciones pegadas). Un `api` o un worker compilado que no arranque desde la raíz del workspace necesita `AI_PROMPTS_DIR=dist/apps/<api|worker>/assets/ai/prompts` (o la ruta absoluta equivalente).

### Búsqueda con Meilisearch (opcional, profile search)

```bash
docker compose --profile search up -d --wait   # añade meilisearch en http://localhost:7700
```

No arranca con `docker compose up` por defecto (mismo patrón que `ai-local`). Variables en `.env.example`:
`FEATURE_SEARCH`, `MEILI_HOST`, `MEILI_MASTER_KEY`, `MEILI_INDEX`, `AI_EMBED_CHAIN`, `AI_EMBED_MODEL`,
`SEARCH_SEMANTIC_RATIO`, `SEARCH_BACKFILL_RATE`. Con `FEATURE_SEARCH=false`, api/worker no exigen Meili.

En local el puerto se publica para `nx serve` en el host (`MEILI_HOST=http://localhost:7700`). En la red
compose el hostname es `meilisearch` (`http://meilisearch:7700`). En producción Meili es **solo red interna**
(VPC / red internal de compose): no exponer el puerto ni la master key a Internet.

### MongoDB

MongoDB corre siempre como replica set de un nodo (`rs0`). Su healthcheck lo inicializa en el primer arranque, y el
contenedor no pasa a sano hasta que hay primario.

| Desde                              | URI                                                         |
| ---------------------------------- | ----------------------------------------------------------- |
| El host (apps con `nx serve`)      | `mongodb://localhost:27017/linkvault?directConnection=true` |
| Un contenedor de la red de compose | `mongodb://mongo:27017/linkvault?replicaSet=rs0`            |

Desde el host hace falta `directConnection=true`: el replica set anuncia `mongo:27017`, que el host no resuelve.

### Puertos ocupados por otro proyecto

Los puertos publicados en el host se configuran con `MONGO_PORT`, `REDIS_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT`,
`MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`, `OLLAMA_PORT` y `MEILI_PORT`. Docker Compose los lee del `.env`. Si otro
proyecto ya usa el 6379, por ejemplo, pon en tu `.env`:

```dotenv
REDIS_PORT=6380
REDIS_URL=redis://localhost:6380
```

La URL de la app (`REDIS_URL`, `MONGO_URI`, `MAIL_SMTP_PORT` si cambias el SMTP de Mailpit) debe apuntar al mismo puerto
que publicas.

## Autenticación

Cuentas con email y contraseña (Argon2id) y sesión según [ADR-012](docs/adr/ADR-012.md) y
[ADR-020](docs/adr/ADR-020.md). Verificación de email y recuperación de contraseña: [ADR-034](docs/adr/ADR-034.md)
(change `auth-email-recovery`). Infra local: [Correo transaccional](#correo-transaccional).

### Flujo

1. **Registro o login.** `POST /api/auth/register` (`email`, `password`, `displayName`) responde `201` y
   `POST /api/auth/login` (`email`, `password`) responde `200`. Ambos abren una sesión nueva y devuelven en el cuerpo
   `accessToken`, `expiresIn` (segundos) y el perfil, y fijan la cookie `lv_refresh` (`HttpOnly`, `SameSite=Lax`,
   `Path=/api/auth`; `Secure` con `NODE_ENV=production`) con un refresh token opaco. En la base de datos solo se guarda su
   hash.
2. **Peticiones autenticadas.** El SPA guarda el access token solo en memoria (nunca en `localStorage`, `sessionStorage`,
   IndexedDB ni cookies) y lo envía como `Authorization: Bearer`. Toda ruta bajo `/api` lo exige salvo register, login,
   refresh y logout; `/health` y `/health/live` siguen públicos. Sin token válido, la API responde `401` con código
   `unauthorized`.
3. **Refresh.** Ante ese `401`, el SPA llama a `POST /api/auth/refresh`, que lee el refresh token de la cookie, lo rota
   (cookie nueva) y devuelve un access token nuevo. El refresh caduca a los `AUTH_REFRESH_TTL_DAYS` desde la última rotación,
   sin pasar de `AUTH_REFRESH_MAX_DAYS` desde que se abrió la sesión. Presentar un token rotado hace menos de 10 s responde
   `409 refresh_conflict` (pestañas que refrescan a la vez; el SPA serializa los refresh y reintenta). Pasados 10 s cuenta
   como reuso: revoca la sesión completa y responde `401 invalid_refresh`.
4. **Logout.** `POST /api/auth/logout` revoca la sesión de la cookie, la borra y responde `204`, haya cookie o no. El access
   token ya emitido sigue valiendo hasta que caduca (15 min con `.env.example`).
5. **Cambio de contraseña.** `POST /api/auth/password` (`currentPassword`, `newPassword`, con access token) responde `204` y
   revoca las demás sesiones del usuario; la sesión actual sigue abierta tras un refresh.
6. **Verificación de email (ADR-034).** Tras el registro se emite un correo con enlace a
   `{WEB_BASE_URL}/verificar-email?token=…`. El SPA hace `POST /api/auth/verify-email` `{ token }` (público).
   `POST /api/auth/verify-email/resend` es **solo autenticado** (cuerpo vacío). Login y refresh **no** exigen
   `emailVerified`; el perfil/sesión lo exponen para el banner del SPA.
7. **Recuperación de contraseña (ADR-034).** `POST /api/auth/forgot-password` `{ email }` (público, anti-enumeración:
   siempre `200` genérico). Enlace a `{WEB_BASE_URL}/restablecer-contrasena?token=…` →
   `POST /api/auth/reset-password` `{ token, newPassword }`. Al aceptar: revoca **todas** las sesiones, luego el hash
   (mismo orden que change-password). Fallback de operador: [RUNBOOK](docs/RUNBOOK.md#reseteo-manual-de-contraseña-operador).

Perfil propio: `GET /api/users/me` y `PATCH /api/users/me` (`displayName`, `aiConsent` con `externalProviders` /
`textVersion` / `consentedAt`, `outputLanguage`, `redactName`). En el SPA, `/perfil` incluye el permiso de proveedores
externos (texto versión `2026-09-21`), el idioma de los análisis y la redacción del nombre. Ver
[Análisis de encaje](#análisis-de-encaje-cv-y-oferta).

**Protecciones.** Todo `POST /api/auth/*` exige la cabecera `X-Requested-With: linkvault` (si falta, `403`) y, si lleva
cuerpo, `Content-Type: application/json` (si no, `415`). Los intentos se cuentan en Redis por ventanas fijas de 15 minutos:
5 fallos por email (exista o no la cuenta), 50 logins fallidos por IP y 10 registros por IP; al superarlos la API responde
`429 too_many_attempts` con `Retry-After`. Si Redis no responde, las peticiones pasan sin límite y la API registra un aviso.

### Rutas del SPA

| Ruta                       | Acceso     | Contenido                                                                              |
| -------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `/login`                   | Sin sesión | Login. Enlace a recuperar contraseña. Con sesión redirige a `/grupos`.                 |
| `/registro`                | Sin sesión | Registro. Con sesión redirige a `/grupos`.                                             |
| `/recuperar-contrasena`    | Sin sesión | Forgot-password (pide email).                                                          |
| `/restablecer-contrasena`  | Sin sesión | Lee `token` de la query y llama a reset-password.                                      |
| `/verificar-email`         | Sin sesión | Lee `token` de la query y llama a verify-email.                                        |
| `/`                        | Con sesión | Redirige a `/grupos`, la pantalla de inicio (ver [Grupos](#grupos)).                   |
| `/perfil`                  | Con sesión | Email, nombre, cambio de contraseña, permiso de IA externa, idioma de análisis y redacción del nombre. |

Sin sesión, una ruta autenticada lleva a `/login?returnUrl=<ruta>` y, tras entrar, vuelve a ella. Al cargar, el SPA muestra
"Conectando…" e intenta restaurar la sesión con la cookie durante como máximo 10 segundos.

### Variables

`api` valida estas variables al arrancar; si una falta o no es válida, el arranque falla nombrándola sin mostrar su valor.
`worker` no las lee.

| Variable                        | `.env.example`                             | Regla                                                                                 |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `AUTH_JWT_SECRET`               | `dev-only-change-me-not-a-real-jwt-secret` | Mínimo 32 caracteres; con `NODE_ENV=production` se rechaza el valor de ejemplo.       |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS` | `900`                                      | Vida del access token, de 60 a 3600 segundos.                                         |
| `AUTH_REFRESH_TTL_DAYS`         | `30`                                       | Caducidad deslizante del refresh token, de 1 a 90 días.                               |
| `AUTH_REFRESH_MAX_DAYS`         | `90`                                       | Máximo absoluto de una sesión, hasta 365 días y no menor que `AUTH_REFRESH_TTL_DAYS`. |
| `AUTH_VERIFY_TOKEN_TTL_HOURS`   | `24`                                       | Caducidad del token de verificación de email (horas).                                 |
| `AUTH_RESET_TOKEN_TTL_SECONDS`  | `3600`                                     | Caducidad del token de reset (1 h de producto).                                       |

El secreto firma los access tokens y las claves de los contadores de intentos: cambiarlo invalida los access tokens emitidos
y reinicia esos contadores. En producción usa un valor propio, por ejemplo 48 bytes aleatorios en base64url.

### Correo transaccional

Puerto Mailer con adaptadores por entorno ([ADR-034](docs/adr/ADR-034.md)):

| Entorno | Adaptador | Cómo |
|---|---|---|
| Local | SMTP → **Mailpit** | `MAIL_PROVIDER=smtp` + `MAIL_SMTP_HOST`/`MAIL_SMTP_PORT` (defaults de `.env.example`) |
| Tests / CI | **CapturingMailer** | `MAIL_PROVIDER=capture` (o DI de test); **sin** Mailpit ni red en el pipeline |
| Staging / prod | **Resend** | `MAIL_PROVIDER=resend` + `RESEND_API_KEY` + `MAIL_FROM` |

Smoke local tras `docker compose up -d --wait`: UI de Mailpit en http://localhost:8025 (SMTP `localhost:1025`).
DNS SPF/DKIM/DMARC del From: [RUNBOOK Paso 6 terdecies](docs/RUNBOOK.md#paso-6-terdecies--correo-transaccional-verify--reset--adr-034)
(no bloquea local ni el merge).

| Variable | `.env.example` | Regla |
|---|---|---|
| `MAIL_PROVIDER` | `smtp` | `smtp` \| `resend` \| `capture` |
| `MAIL_FROM` | `LinkVault <noreply@example.com>` | Remitente placeholder; en prod alineado al dominio verificado |
| `MAIL_SMTP_HOST` | `localhost` | Obligatoria con `smtp` (Mailpit) |
| `MAIL_SMTP_PORT` | `1025` | Puerto SMTP de Mailpit en el host |
| `RESEND_API_KEY` | *(vacía)* | Obligatoria solo con `MAIL_PROVIDER=resend`; nunca una clave real en git |
| `MAILPIT_SMTP_PORT` / `MAILPIT_UI_PORT` | `1025` / `8025` | Solo compose: puertos publicados en el host |

La validación Nest de estas variables vive en `apiConfigSchema` (tarea backend del change); `.env.example` documenta el
contrato local.

### Probar en local

Con la infraestructura y las apps en marcha (ver [Puesta en marcha](#puesta-en-marcha)), abre http://localhost:4200: el
proxy de `web` reenvía `/api` a la API en el mismo origen, así que la cookie funciona sin CORS. Crea una cuenta en
`/registro`, recarga en `/perfil` para comprobar que la sesión se restaura y cierra sesión desde la barra. Los correos
de verificación/reset aparecen en Mailpit (http://localhost:8025) cuando el adaptador SMTP está cableado.

Contra la API directamente, con un archivo de cookies de `curl` (contiene el refresh token: bórralo al terminar):

```bash
H='X-Requested-With: linkvault'
J='Content-Type: application/json'

curl -i -c cookies.txt -H "$H" -H "$J" http://localhost:3000/api/auth/register \
  -d '{"email":"ana@example.com","password":"una-clave-de-prueba","displayName":"Ana"}'
curl -i -c cookies.txt -H "$H" -H "$J" http://localhost:3000/api/auth/login \
  -d '{"email":"ana@example.com","password":"una-clave-de-prueba"}'

curl -i http://localhost:3000/api/users/me -H "Authorization: Bearer <accessToken>"   # sin cabecera: 401

curl -i -b cookies.txt -c cookies.txt -H "$H" -X POST http://localhost:3000/api/auth/refresh   # rota la cookie
curl -i -b cookies.txt -c cookies.txt -H "$H" -X POST http://localhost:3000/api/auth/logout    # 204
rm cookies.txt
```

Si durante las pruebas quedas bloqueado con `429`, espera a que pase la ventana de 15 minutos o borra los contadores de tu
Redis local:

```bash
docker compose exec redis sh -c "redis-cli --scan --pattern 'auth:*' | xargs -r redis-cli del"
```

## Grupos

Un grupo es el espacio donde una persona y su círculo juntan las ofertas de empleo que encuentran
([ADR-002](docs/adr/ADR-002.md)). Solo se entra con un código de invitación: no hay buscador ni directorio de grupos. Lo
que se comparte dentro está en [Links](#links).

### Endpoints

Todas las rutas exigen access token (`Authorization: Bearer`); sin él responden `401 unauthorized`.

| Método y ruta                            | Quién             | Respuesta                                                                |
| ---------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `POST /api/groups`                       | cualquier usuario | `201` con el grupo nuevo, ya con `inviteCode`; `name` inválido, `400`.   |
| `GET /api/groups`                        | cualquier usuario | `200` con sus grupos (`role`, `memberCount`, `joinedAt`), sin el código. |
| `POST /api/groups/join`                  | cualquier usuario | `200` con el grupo al que entra; nunca devuelve el código.               |
| `GET /api/groups/:id`                    | miembro           | `200` con el detalle; `inviteCode` solo si es owner.                     |
| `PATCH /api/groups/:id`                  | owner             | `200` con el detalle renombrado.                                         |
| `DELETE /api/groups/:id`                 | owner             | `204`; borra el grupo, sus membresías y sus links en una transacción.    |
| `POST /api/groups/:id/invite-code`       | owner             | `200` con `{ "inviteCode": "…" }`; el código anterior deja de servir.    |
| `GET /api/groups/:id/members`            | miembro           | `200` con `userId`, `displayName`, `role` y `joinedAt`, por antigüedad.  |
| `DELETE /api/groups/:id/members/me`      | miembro           | `204` al salir; el owner recibe `409 owner_cannot_leave`.                |
| `DELETE /api/groups/:id/members/:userId` | owner             | `204` al expulsar; la membresía `owner` no se puede eliminar.            |
| `POST /api/groups/:id/owner`             | owner             | `200` con el detalle visto ya como miembro, sin `inviteCode`.            |
| `PATCH /api/groups/:id/settings`         | owner             | `200` con el detalle; cambia `defaultVisibility` de los links nuevos.    |

La lista ordena por `joinedAt` descendente y descarta las membresías cuyo grupo ya no existe. `memberCount` sale de una
sola agregación, no de un conteo por grupo.

`GET /api/groups/:id` devuelve además `defaultVisibility`, el ajuste que decide si los links **nuevos** del grupo nacen
con un enlace público (`public` por defecto). Lo ve cualquier miembro —quien comparte tiene derecho a saber si su link
nacerá público— y solo lo cambia el owner, con `PATCH /api/groups/:id/settings`: está en
[Enlaces públicos de una oferta](#enlaces-públicos-de-una-oferta). `GET /api/groups` no lo lleva.

**Privacidad.** Quien no es miembro no distingue un grupo ajeno de uno inexistente: el grupo ajeno, un id que no existe y
un id con otro formato responden `404 group_not_found` con el mismo cuerpo. Un miembro que no es owner ya sabe que el
grupo existe, así que las acciones de owner le responden `403 forbidden`. La lista de miembros muestra el nombre visible
de cada uno, nunca el email ni ningún otro dato de contacto.

Códigos de error propios: `group_not_found` (404), `invalid_invite_code` (404), `member_not_found` (404), `forbidden`
(403), `group_full` (409), `too_many_groups` (409), `owner_cannot_leave` (409), `already_owner` (409, el owner se nombra
a sí mismo; el SPA nunca ofrece ese camino) y `too_many_attempts` (429, con `Retry-After`, ver [Límites](#límites)).

### Código de invitación

Cada grupo tiene uno: 8 caracteres del alfabeto `23456789ABCDEFGHJKMNPQRSTVWXYZ` (base32 de Crockford sin `0`, `1`, `I`,
`L`, `O` ni `U`, que se confunden al dictar o copiar), único entre todos los grupos, sin caducidad y reutilizable. Solo lo
ve el owner, que puede regenerarlo cuando quiera: el anterior deja de servir y los miembros actuales siguen dentro.

Al unirse, el código se normaliza (espacios exteriores fuera y mayúsculas), así que `" abcd2345 "` y `ABCD2345` son el
mismo. Un código desconocido y uno con formato imposible responden igual (`404 invalid_invite_code`), para no revelar
cuáles existen. Volver a unirse siendo ya miembro responde `200` con el rol actual, sin duplicar la membresía.

El enlace de invitación del SPA es `<origen>/unirse?codigo=<código>`: quien lo tenga puede entrar y ver los nombres de los
miembros, así que el owner debe regenerar el código si se filtró.

### Límites

- **50 miembros por grupo.** Unirse a uno completo responde `409 group_full`.
- **20 grupos por usuario.** Crear o unirse por encima del tope responde `409 too_many_groups`. Volver a un grupo del que
  ya se es miembro sigue funcionando aunque se esté en el límite.

- **Códigos incorrectos al unirse** ([ADR-025](docs/adr/ADR-025.md)): **10 por usuario** y **100 por IP** (una IPv6
  cuenta por su prefijo /64) en ventanas fijas de **15 minutos**. Al superarlos, `POST /api/groups/join` responde
  `429 too_many_attempts` con `Retry-After`, y el SPA dice cuántos minutos esperar, con el mismo mensaje del login.

Son límites antiabuso, no invariantes: dos uniones simultáneas pueden dejar un grupo con 51 miembros. Lo que sí impide el
índice único `(groupId, userId)` es una membresía duplicada.

Del límite del join, lo que conviene saber al probar:

- **Solo cuentan los códigos incorrectos** (desconocidos o mal formados), y se cuentan **antes** de buscar el código, así
  que peticiones simultáneas no se saltan el tope. Un código válido devuelve su intento, también si la unión acaba en
  `group_full`, `too_many_groups` o un error inesperado; pero **no pone a cero** la cuenta, para que nadie la reinicie
  intercalando el código de un grupo propio. Un código vacío lo rechaza la validación (`400`) y no cuenta.
- **Primero el usuario, después la IP.** Si el contador del usuario rechaza, la IP no se toca: un usuario bloqueado que
  insiste no gasta los intentos de quienes comparten su red. Si rechaza el de la IP, el usuario recupera su intento.
  `Retry-After` es el del contador que rechazó.
- **Falla abierto:** si Redis no responde, se procesa la unión sin límite; el contador avisa una vez por racha de fallos.
- **Sin `trustProxy`** (lo configura `deploy-prod`), detrás de un proxy todas las peticiones comparten IP y el contador de
  IP se vuelve global. En local no hay proxy.

Los contadores viven en Redis con las claves `groups:join:user:<userId>` y `groups:join:ip:<grupo de IP>`. Si quedas
bloqueado en local, espera a que pase la ventana o bórralos (en un entorno compartido, ver el
[RUNBOOK](docs/RUNBOOK.md#paso-6-quater--operar-la-propiedad-de-los-grupos-y-el-límite-del-join)):

```bash
docker compose exec redis sh -c "redis-cli --scan --pattern 'groups:join:*' | xargs -r redis-cli del"
```

### Roles

El creador es `owner` y cada grupo tiene exactamente una membresía `owner`; no hay campo `ownerId`, la propiedad vive solo
en la membresía. El owner renombra, regenera el código, expulsa, borra el grupo y **nombra propietario a otro miembro**;
un miembro solo puede salir. El owner no puede salir ni ser expulsado: para irse, primero transfiere la propiedad y
después sale como cualquier miembro. Si es el único miembro, su única salida es borrar el grupo, y borrarlo se lleva por
delante los links compartidos allí (la confirmación del SPA dice cuántas ofertas se pierden).

**Transferir la propiedad** ([ADR-025](docs/adr/ADR-025.md)): `POST /api/groups/:id/owner` con `{ "userId": "…" }`. El
elegido pasa a `owner` y quien transfiere a `member`, sin cambiar su `joinedAt`, y la respuesta ya es el detalle de un
miembro (sin `inviteCode`). Quien transfirió no puede deshacerlo; el nuevo owner sí puede devolverle la propiedad.
Errores, en este orden: `404 group_not_found` (no es miembro o id mal formado), `403 forbidden` (no es owner),
`409 already_owner` (se nombra a sí mismo) y `404 member_not_found` (el elegido no es miembro o su id está mal formado).

Un grupo tiene exactamente un owner también ante carreras entre transferir, salir, expulsar y borrar:

- Degradar y promover van en **una transacción**, en ese orden: se confirman juntos o ninguno, así que nunca queda un
  grupo **sin** owner.
- El índice único parcial `one_owner_per_group` de `group_members` (`{ groupId: 1 }` con `role: 'owner'`) impide que
  haya **dos**, también ante escrituras futuras. `api` lo construye al arrancar; si no puede (datos antiguos con dos owners
  en un grupo), registra un `error` y sigue sirviendo. Cómo resolverlo: [RUNBOOK](docs/RUNBOOK.md#paso-6-quater--operar-la-propiedad-de-los-grupos-y-el-límite-del-join).
- Salir, expulsar y borrar comprueban el rol **al escribir**: quien acaba de recibir la propiedad no puede salir
  (`409 owner_cannot_leave`), quien acaba de cederla no puede expulsar al nuevo owner ni borrar el grupo (`403 forbidden`).

### Rutas del SPA

| Ruta          | Contenido                                                                                                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/grupos`     | Pantalla de inicio: grupos con su rol y su número de miembros, o el estado vacío con crear y unirse.                                                                                                                                                                                                                  |
| `/grupos/:id` | Detalle: miembros con fecha de alta y los links del grupo (ver [Links](#links)); el owner ve el código, copia la invitación, renombra, regenera, expulsa, nombra propietario a otro miembro y borra; el miembro puede salir. El owner ve "Para salir, nombra propietario a otro miembro" donde el miembro ve "Salir". |
| `/unirse`     | Formulario de unirse. `?codigo=<código>` lo abre con el código escrito y lo quita de la URL al leerlo.                                                                                                                                                                                                                |

`/` redirige a `/grupos`. Las tres exigen sesión: desde el enlace de invitación sin sesión, el código vuelve tras el login
o el registro. La confirmación de borrado dice a cuántos miembros afecta y cuántas ofertas se pierden y, con más de un
miembro, empieza por "Si solo quieres irte, nombra propietario a otro miembro y sal del grupo.". "Nombrar propietario"
pide confirmación ("«{nombre}» tendrá el rol de propietario de «{grupo}»…") y, al terminar, recarga el detalle ya como
miembro, con "Salir" a mano.

### Probar los grupos en local

Con la API en marcha y un access token obtenido como en [Probar en local](#probar-en-local):

```bash
T='Authorization: Bearer <accessToken>'
J='Content-Type: application/json'
GROUP_ID=...   # el id que devuelve la creación

curl -s -H "$T" -H "$J" http://localhost:3000/api/groups -d '{"name":"Backend Bolivia"}'   # 201 con inviteCode
curl -s -H "$T" http://localhost:3000/api/groups                                           # sus grupos
curl -s -H "$T" -H "$J" http://localhost:3000/api/groups/join -d '{"code":"abcd2345"}'      # 200, código normalizado
curl -s -H "$T" "http://localhost:3000/api/groups/$GROUP_ID/members"                       # nombres, rol y fecha
MEMBER_ID=...  # el userId de otro miembro, de la lista anterior
curl -s -H "$T" -H "$J" "http://localhost:3000/api/groups/$GROUP_ID/owner" -d "{\"userId\":\"$MEMBER_ID\"}"   # 200, ya como miembro
curl -s -i -H "$T" -X DELETE "http://localhost:3000/api/groups/$GROUP_ID/members/me"       # 204: el antiguo owner sale
```

## Links

Un link es una oferta de empleo guardada en LinkVault: compartida en un grupo o solo para uno mismo. La vacante
(`JobLink`) es única en todo el sistema y nunca se borra; lo que se crea y se quita es la **relación** con un grupo o con
una lista privada ([ADR-008](docs/adr/ADR-008.md), [ADR-021](docs/adr/ADR-021.md)). El preview (título, empresa,
modalidad) lo escribe el worker leyendo la página de la oferta; todo link nace `pending` y pasa a `enriched`, `partial`,
`failed` o `manual`. Cómo se lee, qué se le dice a la persona cuando no se puede y qué bolsas no lo permiten está en
[Enriquecimiento de ofertas](#enriquecimiento-de-ofertas); cómo se completa una oferta que no se deja leer, en
[Pegar la descripción](#pegar-la-descripción).

### Endpoints

Todas las rutas exigen access token (`Authorization: Bearer`); sin él responden `401 unauthorized`.

| Método y ruta                          | Quién             | Respuesta                                                                          |
| -------------------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `POST /api/links`                      | cualquier usuario | `201` con el link, `created`, `shared`, `sharedBy?` y `alreadyInGroups`.           |
| `POST /api/links/import`               | cualquier usuario | `201` con el resumen de la importación y los links guardados.                      |
| `GET /api/links/mine`                  | cualquier usuario | `200` con su lista privada: `items`, `total` y `nextCursor`.                       |
| `PATCH /api/links/:linkId/preview`     | quien ve el link  | `200` con el link; corrige campos a mano o los devuelve a lo extraído.             |
| `POST /api/links/:linkId/enrich`       | quien ve el link  | `202`: la relectura queda pedida; la hace el worker.                               |
| `POST /api/links/:linkId/pasted`       | quien ve el link  | `200` con el link completado con el texto pegado, leído en la misma petición.      |
| `DELETE /api/links/mine/:linkId`       | quien lo guardó   | `204`; quita solo la entrada privada.                                              |
| `GET /api/groups/:id/links`            | miembro           | `200` con los links del grupo, cada uno con `sharedBy` (`userId` y `displayName`). |
| `DELETE /api/groups/:id/links/:linkId` | autor u owner     | `204`; otro miembro recibe `403 forbidden`.                                        |
| `PUT /api/groups/:id/links/:linkId/public`    | autor u owner | `200` con el enlace público de la oferta; ver [Enlaces públicos](#enlaces-públicos-de-una-oferta). |
| `DELETE /api/groups/:id/links/:linkId/public` | autor u owner | `204`; el enlace público deja de funcionar para siempre.                       |

`POST /api/links` y `POST /api/links/import` aceptan `groupId`: con él el link se comparte en ese grupo; sin él queda en
la lista privada de quien lo guarda. Compartir en un grupo **no** crea además entrada privada (ADR-021 §5). `POST
/api/links` acepta además `note`, la nota de quien comparte, y `GET /api/groups/:id/links` devuelve esa nota y el
resumen de comentarios de cada tarjeta: los dos están en
[Comentarios y notas en los grupos](#comentarios-y-notas-en-los-grupos), con las rutas del hilo. Esa misma respuesta
trae el **enlace público** de la tarjeta cuando lo tiene, y `POST /api/links` lo devuelve si el grupo comparte en
público: [Enlaces públicos de una oferta](#enlaces-públicos-de-una-oferta).

`created` dice si la vacante no existía en LinkVault y `shared` (`created` o `already_there`), si la relación con el
destino es nueva: son cosas distintas, y el SPA solo avisa "ya estaba aquí" con la segunda, nombrando a quien la compartió
primero. `alreadyInGroups` lista los **grupos propios**, distintos del destino, donde ese link ya estaba; nunca un grupo
ajeno.

**Privacidad.** Un grupo del que no se es miembro, un id que no existe y un id con otro formato responden igual
(`404 group_not_found`), como en [Grupos](#grupos). Un `:linkId` mal formado responde `404 link_not_found`, lo mismo que un
link que no está en esa lista. Quitar un link de un grupo lo pueden hacer quien lo compartió y el owner; a otro miembro se
le responde `403 forbidden` y no `404`, porque ya ve el link en la lista y no hay nada que ocultarle.

Códigos de error propios: `invalid_url` (400, campo `url`), `text_too_long` (400, campo `text`), `link_not_found` (404) y
`forbidden` (403). Un cursor manipulado responde `400 validation_error` nombrando `cursor`. Los de la edición y la
relectura —`preview_field_unknown` (400), `enrichment_not_retryable` (409) y `too_many_attempts` (429)— se explican en
[Enriquecimiento de ofertas](#enriquecimiento-de-ofertas), los del pegado —`not_a_job_posting` (422),
`extraction_unavailable` (503) y `ai_quota_exceeded` (429)— en [Pegar la descripción](#pegar-la-descripción), y
`comment_not_found` (404), en [Comentarios y notas en los grupos](#comentarios-y-notas-en-los-grupos).

### Paginación de los listados

Los dos listados comparten contrato: `limit` de 1 a 50 (20 por defecto) y `cursor` opaco. El orden es por fecha de
compartido o de guardado y, a igualdad, por el identificador de la relación, ambos descendentes, así que 50 links creados
en el mismo instante se paginan sin saltos ni repetidos. `total` es el tamaño del listado entero y no depende del tamaño
de página; `nextCursor` solo viaja cuando hay más.

### Identidad y dedupe

La misma vacante compartida con dos URLs distintas es un solo `JobLink`. La clave es `dedupeKey`, con un único índice
único (ADR-021 §1):

- `"<plataforma>:<externalJobId>"` cuando un canonicalizador reconoce la oferta. Hay uno por plataforma prevista:
  `linkedin` (`/jobs/view/<id>`, el `/comm/jobs/view/<id>` de sus correos y el `currentJobId` de la búsqueda),
  `computrabajo` (el identificador final, con slug variable y un dominio por país), `indeed` (`jk`), `trabajopolis` (el
  número de `/trabajo/<id>/<slug>`) y `getonboard` (el slug de la oferta).
- `"url:<urlHash>"` cuando ninguno la reconoce (`platform: generic`): el `sha256` de la URL normalizada.

La normalización es **solo identidad**: `https`, host en minúsculas y sin `www.`, sin credenciales, sin fragmento, sin
barra final, sin parámetros de campaña (`utm_*`, `gclid`, `fbclid`, `mc_cid`, `mc_eid`, `igshid`, `ref`, `trk`,
`trkcampaign`) y con el resto de parámetros ordenados, de modo que el hash no depende de su orden. Lo que el SPA abre y lo
que `link-enrichment` descargará es `displayUrl`, la primera URL que escribió una persona, que es inmutable; las 20
últimas URLs originales quedan como historial. Una URL que no es `http(s)`, que no tiene host o que pasa de 2048
caracteres responde `400 invalid_url`.

Formas que hoy caen en `generic` a propósito, porque ningún enlace conocido justifica otra cosa: las subpáginas
(`/apply`) y los prefijos de idioma de Get on Board. Degradan a dedupe por `urlHash`, que nunca funde vacantes distintas;
como mucho, la misma oferta cuenta dos veces.

### Importación de un chat

`POST /api/links/import` recibe el texto pegado (un chat de WhatsApp, por ejemplo) y se queda con las URLs, en el orden en
que aparecen. El texto **no se guarda en ninguna colección ni se registra en ningún log**: de ahí solo salen las URLs
extraídas, así que se puede pegar una conversación con nombres y teléfonos.

- Máximo 20 000 caracteres de texto; por encima, `400 text_too_long`.
- Las URLs repetidas que normalizan igual cuentan una vez.
- Máximo 50 links guardados por llamada. El tope cuenta solo los que hay que guardar, no los que ya estaban en el destino,
  así que volver a pegar el mismo chat avanza con los siguientes.
- La respuesta resume `created` (nuevas), `existing` (ya estaban en el destino), `unrecognized` (lo que no es una URL
  válida) y `skipped` (lo que quedó fuera del tope), con los links guardados.
- Cada link va en su propia transacción: un fallo aislado no tira el resto de la importación.

`POST /api/links/import` está acotado a **10 llamadas por usuario cada 15 minutos** (cada una guarda hasta 50 links);
pasado el tope responde `429 too_many_attempts` con `Retry-After`. El contador **falla abierto**: si el almacén no
responde, la importación pasa, porque lo que se permitiría de más es escribir en nuestra propia base de datos. Guardar
links de uno en uno con `POST /api/links` no gasta ese contador.

### Outbox y cola

Guardar un link escribe en **una sola transacción** la vacante, la relación y el evento `LinkCreated.v1` en
`outbox_events` (patrón outbox, [ADR-009](docs/adr/ADR-009.md)): o se guardan las tres cosas o ninguna.

Un relay dentro de `api` publica esos eventos en la cola `enrich-link` de BullMQ (ADR-021 §2-§4):

- Cada `OUTBOX_RELAY_INTERVAL_MS` toma hasta 50 eventos pendientes vencidos, **publica primero y marca después**, con el
  `jobId` determinista `enrich:<linkId>:<previewVersion>`: si la marca no llega a guardarse, la vuelta siguiente republica
  y el `jobId` impide el duplicado. Una vuelta nunca se solapa con la anterior.
- Un fallo de publicación aplaza el evento a `now + min(2^intentos s, 5 min)`. Solo a las **24 h** desde que se escribió
  se da por perdido, con un aviso que nombra el id y el tipo del evento y nada más: un corte de Redis de minutos u horas
  no quema los reintentos.
- **Quien consume `enrich-link` es `apps/worker`** (ver [Enriquecimiento de ofertas](#enriquecimiento-de-ofertas)). Con
  el worker parado los jobs esperan en la cola y el link sigue `pending`. La retención olvida un job completado al día (o
  a los 1000) y uno fallido a la semana; pasada esa retención el `jobId` ya no protege de nada, así que el consumidor es
  idempotente por sí mismo, por `previewVersion` ([ADR-022](docs/adr/ADR-022.md) §1).
- El relay supone **una sola instancia de `api`**: con varias, todas competirían por los mismos eventos pendientes (riesgo
  aceptado en ADR-021).

| Variable                   | `.env.example` | Regla                                                                                    |
| -------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `OUTBOX_RELAY_ENABLED`     | `true`         | Con `false`, `api` no registra la cola ni abre Redis por esta vía y los eventos esperan. |
| `OUTBOX_RELAY_INTERVAL_MS` | `1000`         | Milisegundos entre vueltas del relay, de 100 a 300 000.                                  |

Los tests corren con el relay apagado, así que la suite de integración de `api` no necesita Redis.

### Rutas del SPA

| Ruta          | Contenido                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `/grupos/:id` | Además de los miembros, los links del grupo, el formulario de guardar y el diálogo de importar. |
| `/mis-links`  | "Solo para mí": los links guardados sin grupo, con las mismas acciones.                         |

Cada fila abre `displayUrl` en una pestaña nueva con `rel="noopener noreferrer"`. Quitar un link pide confirmación y solo
se ofrece a quien lo compartió y al owner del grupo. La tarjeta muestra además el preview con quién escribió cada dato,
el diálogo para corregirlo a mano y, solo en los motivos reintentables, la acción de volver a pedir la lectura; los
previews que van llegando actualizan la tarjeta en vivo por el canal SSE.

### Probar los links en local

Con la API en marcha y un access token obtenido como en [Probar en local](#probar-en-local):

```bash
T='Authorization: Bearer <accessToken>'
J='Content-Type: application/json'
GROUP_ID=...   # un grupo del que seas miembro

curl -s -H "$T" -H "$J" http://localhost:3000/api/links \
  -d "{\"url\":\"https://www.linkedin.com/jobs/view/1234567890/\",\"groupId\":\"$GROUP_ID\"}"       # 201
curl -s -H "$T" -H "$J" http://localhost:3000/api/links -d '{"url":"https://example.com/vacante"}'  # sin grupo: privado
curl -s -H "$T" -H "$J" http://localhost:3000/api/links/import \
  -d "{\"text\":\"mira esta https://example.com/a y esta https://example.com/b\",\"groupId\":\"$GROUP_ID\"}"
curl -s -H "$T" "http://localhost:3000/api/groups/$GROUP_ID/links?limit=20"                         # página del grupo
curl -s -H "$T" http://localhost:3000/api/links/mine                                                # lista privada

LINK_ID=...   # un link de los listados
curl -s -H "$T" -H "$J" -X PATCH "http://localhost:3000/api/links/$LINK_ID/preview" \
  -d '{"fields":{"title":"Backend Engineer"}}'                                                      # corregir a mano
curl -s -H "$T" -H "$J" -X PATCH "http://localhost:3000/api/links/$LINK_ID/preview" \
  -d '{"revert":["title"]}'                                                                         # volver a lo anterior
curl -s -i -H "$T" -X POST "http://localhost:3000/api/links/$LINK_ID/enrich"                        # 202, 409 o 429
curl -s -i -H "$T" -H "$J" "http://localhost:3000/api/links/$LINK_ID/pasted" \
  -d '{"text":"Buscamos Backend Engineer con Node y MongoDB, remoto…","company":"Acme"}'           # 200, 422, 429 o 503
curl -sN -H "$T" http://localhost:3000/api/events                                                   # canal SSE (Ctrl+C)
```

Con el relay encendido y Redis arriba, el job se publica en `enrich-link`; con el worker parado se queda ahí esperando:

```bash
docker compose exec redis redis-cli keys 'bull:enrich-link:*'
```

## Enriquecimiento de ofertas

Guardar un link deja el preview en `pending` y encola su lectura. Quien la hace es **`apps/worker`**, consumiendo la cola
`enrich-link`: descarga la página de la oferta, saca de ella lo que puede (título, empresa, ubicación, modalidad,
seniority, salario, skills, idiomas, resumen y fechas), lo guarda en el `JobLink` y avisa a las pantallas abiertas.
Decisiones y alternativas descartadas: [ADR-003](docs/adr/ADR-003.md) (cadena lícita) y [ADR-022](docs/adr/ADR-022.md)
(idempotencia, procedencia, motivos, cortesía, SSE, backfill y snapshots).

### Qué bolsas no permiten la lectura automática

Esto no es un fallo del producto y el SPA no lo presenta como tal: **hay bolsas de empleo que nos prohíben o nos impiden
leer sus ofertas**, y un link suyo va a quedarse casi siempre sin preview automático. Medición del `robots.txt` de las
cinco plataformas del manifiesto con nuestro `User-Agent`, del 2026-09-17 (ADR-022, Contexto):

| Plataforma       | `robots.txt`                  | Una oferta                                        | Datos estructurados           |
| ---------------- | ----------------------------- | ------------------------------------------------- | ----------------------------- |
| **LinkedIn**     | `Disallow: /` para `*`        | **prohibida**: ni se pide                         | —                             |
| **Indeed**       | `/viewjob` prohibido para `*` | **prohibida**: ni se pide                         | —                             |
| **Computrabajo** | responde `403` al pedirlo     | se asume permitido, pero el sitio **nos bloquea** | —                             |
| Trabajopolis     | permitido                     | `200`, 287 KB                                     | JSON-LD `JobPosting` completo |
| Get on Board     | permitido (sin reglas)        | `200`, 198 KB                                     | Open Graph rico; sin JSON-LD  |

Consecuencias, dichas sin rodeos:

- Un link de **LinkedIn** o **Indeed** termina en `robots_disallowed` y **no ofrece reintentar**: volver a pedir lo que
  un sitio ya negó por escrito es exactamente lo que ADR-003 evita.
- Un link de **Computrabajo** termina en `blocked`, tampoco reintentable.
- La salida en los tres casos es **pegar la descripción** de la oferta ([Pegar la descripción](#pegar-la-descripción)):
  mientras la tarjeta no tiene título dice "<Plataforma> no nos deja leer sus ofertas. Pega su descripción para
  completarla", con "Pegar la descripción" como acción principal y completarla a mano
  (`PATCH /api/links/:linkId/preview`) como secundaria. El link sigue siendo útil y abre igual.
- El smoke de `link-enrichment`, posterior a esta medición, encontró además que el CDN de **Trabajopolis** rechaza el
  cliente de Node aunque su `robots.txt` lo permita: en la práctica, hoy solo Get on Board se lee de punta a punta
  (ADR-023, Contexto).
- **No hay adaptadores de selectores por plataforma** y no los habrá mientras la medición diga esto: serían código que no
  podríamos ni probar contra el sitio real (ADR-022 §3).
- La medición lleva fecha a propósito. Un `robots.txt` cambia: si LinkedIn o Indeed abrieran sus ofertas, la decisión se
  revisa con una medición nueva, no con una intuición.

### La cadena de extracción

1. **Se descarga `displayUrl`**, la primera URL que escribió una persona, **nunca la normalizada**: la normalizada existe
   solo para la identidad del link (ADR-008) y puede haber perdido parámetros que el sitio necesita para servir la
   oferta.
2. **Permiso del sitio.** Se lee su `robots.txt` con nuestro `User-Agent` (`ENRICH_USER_AGENT`, identificable y con URL
   de contacto) y se cachea por host `ENRICH_ROBOTS_TTL_SECONDS` —también el "prohibido"—. Si no se puede leer, se asume
   permitido; si no es texto, no se interpreta.
3. **Turno del host.** Un host a la vez, con una clave en Redis. Mientras se descarga, el host queda tomado; al terminar,
   la clave se reescribe con la **espera efectiva**, que es `max(ENRICH_DOMAIN_DELAY_MS, Crawl-delay del sitio)`: el
   sitio puede pedir más espera, nunca menos. Un job que encuentra el host ocupado se aplaza y no ocupa concurrencia
   mientras espera; `ENRICH_MAX_DEFERRALS` solo evita que un host que nunca se libera rebote para siempre.
4. **Descarga.** Solo `text/html`, con `ENRICH_FETCH_TIMEOUT_MS` de plazo y corte del flujo al pasar de
   `ENRICH_MAX_BYTES`.
5. **Parseo.** El HTML se convierte en título, texto limpio, metaetiquetas y bloques JSON-LD. El texto sale ya **sin
   `mailto:`, `tel:`, emails ni teléfonos**: son datos del reclutador que no hacen falta para leer la vacante.
6. **Extractores, en este orden fijo:** `json-ld` (`JobPosting` de schema.org) → `metadata` (Open Graph, `<title>`,
   `description`) → `ai:extract-job` (por `runTask`, ver [Evaluación de IA](#evaluación-de-ia)) → `headless`, que hoy es
   un hueco y no se ejecuta (`FEATURE_HEADLESS_EXTRACTION=false`). **Parada temprana**: en cuanto hay título y empresa no
   se ejecuta ninguna etapa más, así que una página con JSON-LD completo no llama a la IA. El plazo total del link
   (`ENRICH_DEADLINE_MS`) se reparte entre las etapas; la que se queda sin plazo se salta, y una etapa que se rompe no
   tira lo que sacaron las anteriores.
7. **Merge y escritura.** Dentro de una misma pasada gana la etapa anterior del orden de arriba; frente a lo ya guardado
   gana lo nuevo automático, **salvo un campo escrito a mano o pegado, que la lectura no toca nunca** (ver
   [Precedencia y deshacer](#precedencia-y-deshacer)). Un campo que esta pasada no trajo no borra el que ya había. La escritura va condicionada a `previewVersion`: quien pierde la carrera no escribe, no sube
   snapshot y no avisa.

La IA se llama con `outputLanguage` fijo `es` (el preview es compartido: no puede depender del idioma de una persona) y se
atribuye a **quien guardó el link**, también cuando la relectura la pide otro: el gasto pertenece al dueño del dato
(ADR-022 §6).

### Rescate por el historial de URLs

La misma vacante puede haberse guardado con varias URLs (el link guarda las 20 últimas en su historial,
`originalUrls`). Si el `robots.txt` prohíbe la `displayUrl` —el caso real: una URL de Trabajopolis con `search_id`, que
su `robots.txt` prohíbe, mientras la misma oferta sin ese parámetro está permitida—, el worker **prueba las demás URLs
del historial** antes de rendirse:

- **Solo las del mismo host** que la `displayUrl`, sin repetidas y sin la propia `displayUrl`, **las más recientes
  primero**. Una URL de otro host no se prueba: su turno y su `Crawl-delay` son otros (ADR-022 §5).
- Pide permiso para cada una **dentro del mismo turno del host** y descarga **la primera permitida**. Ninguna prohibida
  llega a pedirse. Si ninguna lo está, el link termina en `robots_disallowed`, como antes.
- `displayUrl` **no cambia** ([ADR-021](docs/adr/ADR-021.md)): la tarjeta sigue abriendo la URL que se compartió.

**Qué lo dispara.** `robots_disallowed` no se reintenta nunca, así que el rescate necesita un disparador: **volver a
guardar la vacante con una URL nueva del mismo host** (con `POST /api/links` o en una importación) sobre un link que
está en `failed` por `robots_disallowed`. Ese guardado pide una lectura nueva en la misma transacción —sube
`previewVersion`, vuelve a `pending` y escribe en el outbox, como un reintento—, y el worker prueba la URL nueva. Guardar
otra vez la misma URL, una que ya estaba en el historial, una de otro host, o hacerlo sobre un link que ya no está en
`failed` (por ejemplo, porque se completó pegando su descripción) no pide nada. No hay backfill de los links que ya
están en `robots_disallowed`: se rescatan así o pegando su descripción. Detalle: [ADR-023](docs/adr/ADR-023.md) §6.

### Estados y motivos

El texto de la tarjeta **no sale del nombre del estado**, sino de los campos que hay, del motivo del último fallo y de
cuándo se pidió la lectura:

| Estado     | Qué significa                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `pending`  | La lectura está pedida. Menos de 10 min: "Leyendo la oferta…"; más: "Sin vista previa todavía".           |
| `enriched` | Se leyó y salieron los obligatorios: título y empresa.                                                    |
| `partial`  | Se leyó y salió algo, pero no lo obligatorio: "Faltan datos de esta oferta".                              |
| `failed`   | No se pudo leer, o se leyó y no salió nada. El motivo va en `lastEnrichmentError`.                        |
| `manual`   | Alguien escribió algún campo a mano. Manda sobre el estado: un fallo posterior no lo devuelve a `failed`. |

Un link completado **pegando su descripción** sigue la misma regla: `enriched` con título y empresa, `partial` sin ellos,
`manual` si además alguien escribió algo a mano; y una lectura fallida posterior tampoco lo devuelve a `failed` ni borra
lo pegado ([ADR-023](docs/adr/ADR-023.md) §5).

Motivos de `lastEnrichmentError.reason`. Los tres primeros **no son errores nuestros**, y por eso ni se reintentan ni se
presentan como tales:

| Motivo              | Qué pasó                                                    | Qué ve la persona                                      | ¿Reintentar? |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------ | ------------ |
| `robots_disallowed` | El `robots.txt` del sitio prohíbe esa ruta                  | "Esta bolsa no permite la lectura automática…"         | **No**       |
| `blocked`           | El sitio respondió `401`/`403` a nuestra petición           | "Esta bolsa no nos deja leer esta oferta"              | **No**       |
| `not_a_job`         | Se leyó y la IA dice que eso no es una vacante              | "Esto no parece una oferta" (la acción es quitarlo)    | **No**       |
| `rate_limited`      | El sitio respondió `429`: literalmente "vuelve más tarde"   | "No pudimos leer esta oferta"                          | Sí           |
| `host_busy`         | Nuestro turno para ese host no llegó a tiempo               | "No pudimos leer esta oferta"                          | Sí           |
| `timeout`           | La descarga agotó su plazo                                  | "No pudimos leer esta oferta"                          | Sí           |
| `http_error`        | Otro error de red o de HTTP                                 | "No pudimos leer esta oferta"                          | Sí           |
| `not_html`          | La respuesta no era HTML (un PDF, una imagen)               | "No pudimos leer esta oferta"                          | Sí           |
| `too_large`         | La página pasó de `ENRICH_MAX_BYTES`                        | "No pudimos leer esta oferta"                          | Sí           |
| `no_data`           | Se leyó y se parseó, pero no salió ningún campo             | "No pudimos leer esta oferta" (completar o reintentar) | Sí           |
| `retries_exhausted` | El job agotó sus intentos; el link no se queda en `pending` | "No pudimos leer esta oferta"                          | Sí           |

Dos distinciones que parecen sutiles y no lo son: `no_data` (la página se leyó y no dijo nada) lleva a "complétalo o
reinténtalo" mientras que `not_a_job` lleva a "quítalo"; y `host_busy` no es `blocked`, porque el sitio no negó nada: el
que no llegó a tiempo fue nuestro turno.

### Corregir a mano, volver a pedir la lectura y avisos en vivo

- `PATCH /api/links/:linkId/preview` lo puede usar **cualquiera que pueda ver el link**, no solo quien lo guardó: un
  `JobLink` es de todos los grupos donde está compartido, y un dato equivocado no puede quedarse eterno para los demás.
  Lo que hace segura esa apertura es que cada campo guarda quién lo escribió y cuándo, y **guarda lo que desplazó**
  (valor, origen y autor), así que una edición ajena se ve en la tarjeta y se deshace con "Volver a lo anterior" (`revert`). Un campo
  que no existe responde `400 preview_field_unknown` nombrándolo.
- `POST /api/links/:linkId/enrich` responde `202` y deja el link en `pending` otra vez. Un motivo no reintentable
  responde `409 enrichment_not_retryable` y **no gasta cuota**. El límite es de **3 relecturas por link cada 15
  minutos** —por link y no por persona: lo que protege es al sitio del que se descarga— y responde
  `429 too_many_attempts`. Ese contador **falla cerrado**: si el almacén no responde, la relectura se niega, porque lo
  que se permitiría de más es volver a descargar la página de un tercero.
- Ni ese endpoint ni el backfill montan una cola: los dos escriben `LinkCreated.v1` en el outbox dentro de la transacción
  que sube `previewVersion`, y el relay lo publica (ADR-022 §8). Por eso funcionan con `OUTBOX_RELAY_ENABLED=false`: los
  eventos esperan ahí y se publican cuando vuelva a encenderse.
- `GET /api/events` es el canal SSE por el que la tarjeta se entera de que su preview ya está, sin recargar la lista. Lo
  protege el guard global (`Authorization: Bearer`), así que **no hay tokens en la URL**; el SPA lo lee con `HttpClient`
  (`observe: 'events'`, `responseType: 'text'`, `reportProgress: true`) y no con `EventSource`, que no pasa por el
  interceptor que pone y refresca el access token. Cada aviso lleva el link ya actualizado dentro —estado, versión,
  preview, origen de cada campo y motivo del último fallo— y se reparte solo a quien puede ver ese link.

### Variables del enriquecimiento

Las lee **el worker**, y **todas son obligatorias**: sin ellas no arranca y dice cuáles faltan. Un `.env` creado antes de
este change no las tiene, así que **cópialas de [`.env.example`](.env.example) antes de levantar el worker**.

| Variable                    | `.env.example`          | Qué hace                                                                                          |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `ENRICH_FETCH_TIMEOUT_MS`   | `10000`                 | Plazo de una descarga (1 000–60 000). Es además lo que dura la exclusión del host.                |
| `ENRICH_MAX_BYTES`          | `2097152`               | Tamaño máximo del HTML (64 KiB–32 MiB); al pasarlo se corta el flujo.                             |
| `ENRICH_DOMAIN_DELAY_MS`    | `2000`                  | Espera mínima entre dos peticiones al mismo host (250–300 000); el `Crawl-delay` puede pedir más. |
| `ENRICH_DEADLINE_MS`        | `45000`                 | Plazo total por link (5 000–300 000), repartido entre las etapas de la cadena.                    |
| `ENRICH_ROBOTS_TTL_SECONDS` | `43200`                 | Vida de la caché de `robots.txt` por host, en segundos (60–604 800).                              |
| `ENRICH_USER_AGENT`         | `LinkVaultBot/0.1 (+…)` | Agente identificable con URL de contacto; contra él se resuelve el grupo del `robots.txt`.        |
| `ENRICH_CONCURRENCY`        | `4`                     | Jobs simultáneos en el proceso (1–64). Es global: un host a la vez lo garantiza el mutex.         |
| `ENRICH_MAX_DEFERRALS`      | `600`                   | Aplazamientos por host ocupado antes de darlo por fallido transitorio (1–10 000).                 |
| `S3_ENDPOINT`               | `http://localhost:9000` | Almacén de objetos: MinIO en local, cualquier S3 en producción.                                   |
| `S3_REGION`                 | `us-east-1`             | MinIO la ignora, pero el protocolo la exige para firmar la petición.                              |
| `S3_ACCESS_KEY`             | `linkvault`             | Credencial del almacén; docker compose la usa además como raíz de MinIO.                          |
| `S3_SECRET_KEY`             | `linkvault-dev-secret`  | Idem. Valor de desarrollo, nunca uno real.                                                        |
| `S3_SNAPSHOTS_BUCKET`       | `snapshots`             | Bucket de los snapshots; el healthcheck de MinIO lo crea con su regla de 30 días.                 |

`ENRICH_DOMAIN_DELAY_MS` y `ENRICH_CONCURRENCY` son la cara visible de nuestra cortesía con sitios ajenos: bajarlos en un
entorno real es una decisión con consecuencias, no un ajuste de rendimiento.

### Reencolar lo que quedó sin leer (backfill)

Comando **manual**: no se ejecuta al arrancar la aplicación, porque un despliegue no es una razón para volver a descargar
páginas ajenas. Arranca el contexto de `api` sin servidor HTTP y sin cola, escribe en el outbox y se apaga.

```bash
pnpm nx run api:backfill-enrichment                             # 500 links `pending` (valores por defecto)
pnpm nx run api:backfill-enrichment --limit=200                 # una tanda más corta
pnpm nx run api:backfill-enrichment --status=failed --limit=50  # rescate de los fallos transitorios
```

- `--status` admite `pending` (por defecto) y `failed`; `--limit` va de 1 a 5000 (500 por defecto). Nx reenvía los dos al
  comando tal cual, y `pnpm nx run api:backfill-enrichment -- --limit=200` hace lo mismo. Un argumento que no se entiende
  **no se ignora**: el comando falla diciendo qué corregir, porque reencolar de más significa volver a descargar páginas
  de terceros.
- Con `--status=failed` **rescata** `timeout`, `http_error`, `rate_limited`, `host_busy`, `not_html`, `too_large`,
  `no_data` y `retries_exhausted`, y **deja fuera** `robots_disallowed`, `blocked` y `not_a_job`: volver a pedir lo que un
  sitio ya negó es el daño que ADR-003 existe para evitar, y en `not_a_job` no hay nada nuevo que leer.
- **Sube `previewVersion` siempre**, también con `--status=pending`: con la misma versión el `jobId` determinista no
  cambia y `Queue.add` sobre un job retenido es un no-op silencioso, que es justo el atasco que el comando existe para
  deshacer. Tampoco duplica trabajo: si el job viejo sigue vivo, el consumidor lo descarta por versión.
- Avanza en tandas y no vacía la base de una vez; al terminar imprime cuántos links pidió de cuántos encontró.

### Snapshots y el golden real de `extract-job`

Cada lectura que gana la escritura guarda una copia comprimida de la página en
`snapshots/<linkId>/<previewVersion>.html.gz`, y **su clave se guarda en el link** (`snapshotKey`): nunca se deduce de
`previewVersion`, que también sube con las ediciones manuales y con los reintentos, que no producen snapshot. Si el
almacén está caído, el enriquecimiento no falla; lo que se pierde es la copia.

El bucket tiene una **regla de expiración a 30 días**, que crea el healthcheck de MinIO al levantar el compose. Su única
razón de existir es poder construir después el **golden real de `extract-job`** sin volver a pedirle nada al sitio, y eso
no necesita historia infinita. La consecuencia es operativa y está asumida:

> **El golden real de `extract-job` hay que grabarlo dentro de esos 30 días.** Pasados, el snapshot ya no está y habrá
> que volver a descargar las páginas, con el permiso del sitio que corresponda.

El golden que hay hoy en `libs/ai/src/evals/extract-job/golden.jsonl` es **sintético** (siete casos, uno de ellos una
página de listado que espera `isJobPosting: false`); las vacantes reales llegan con `/lv:golden 20`
(ver [docs/RUNBOOK.md](docs/RUNBOOK.md)).

## Pegar la descripción

El smoke de `link-enrichment` midió que de las cinco bolsas solo **Get on Board** se deja leer: LinkedIn e Indeed lo
prohíben, Computrabajo nos bloquea (ver [la tabla](#qué-bolsas-no-permiten-la-lectura-automática)) y el CDN de
Trabajopolis rechaza el cliente de Node (ADR-023, Contexto). Esos links se quedan sin preview automático. La persona, en cambio, tiene la oferta delante en su teléfono. La salida lícita es que **pegue su texto** y la
IA lo convierta en la misma vacante legible que da una página bien marcada. Decisiones y alternativas descartadas:
[ADR-023](docs/adr/ADR-023.md).

### Para quien usa el producto

- **Dónde.** "Pegar la descripción" está en **cualquier tarjeta**: también sirve para corregir una oferta mal leída o
  incompleta. En las que la bolsa no deja leer y todavía no tienen título, es la acción principal ("<Plataforma> no nos
  deja leer sus ofertas. Pega su descripción para completarla") y completarla a mano, la secundaria. Puede hacerlo
  cualquiera que vea el link, no solo quien lo guardó.
- **Qué copiar desde el móvil.** El texto de la oferta tal como se ve en la app de la bolsa —"Acerca del empleo", los
  requisitos, la modalidad—, hasta 20 000 caracteres. **No** la conversación donde te pasaron el link: eso responde "Eso
  no parece una oferta de trabajo". Los emails y teléfonos se quitan antes de leer el texto.
- **Por qué el puesto y la empresa se piden aparte.** Lo que se copia desde la app casi nunca trae la cabecera, y sin
  puesto la oferta no se puede completar. El diálogo los muestra precargados con lo que el link ya tenía: si los dejas
  tal cual no cambian de autor; si los cambias, cuentan como escritos a mano por ti. Además se le pasan a la IA como
  contexto, para que no invente un puesto que el texto no trae.
- **El texto no se guarda.** Se lee dentro de la misma petición y se descarta: no se escribe en ninguna colección, cola,
  caché ni log. Se guardan solo los campos que salen de él (puesto, empresa, modalidad, skills…), marcados "Descripción
  pegada por <nombre>". La consecuencia, asumida: cuando la bolsa retire la oferta, el texto completo ya no está en
  ningún sitio.
- **Mientras lee** el diálogo dice "Leyendo… puede tardar unos segundos" y no deja enviar dos veces. Si algo falla, lo
  pegado sigue en el cuadro para volver a intentarlo.

### Endpoint, límites y códigos

`POST /api/links/:linkId/pasted` con `{ "text": "…", "title"?: "…", "company"?: "…" }` responde `200` con el link ya
actualizado (la misma forma que una fila de lista), y avisa a las demás pantallas por el canal SSE. Se comprueba en
este orden: el cuerpo (`400`), el permiso de lectura (`404`), el texto tras quitarle emails y teléfonos (`422`, **sin
gastar límite ni IA**), el límite de pegados (`503` o `429`) y por último la IA (`422`, `503` o `429`).

| Respuesta | Código                   | Cuándo                                                                                                                          |
| --------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `400`     | `validation_error`       | Texto vacío o de solo espacios, `title`/`company` vacíos, o un cuerpo con campos de más.                                        |
| `400`     | `text_too_long`          | Más de 20 000 caracteres.                                                                                                       |
| `404`     | `link_not_found`         | Quien pide no puede ver el link, o el id no existe.                                                                             |
| `422`     | `not_a_job_posting`      | El texto queda vacío tras quitar emails y teléfonos, o la IA dice que no es una oferta.                                         |
| `503`     | `extraction_unavailable` | La IA degradó o no respondió en `PASTE_EXTRACTION_TIMEOUT_MS`, o el contador de pegados no respondió. Con `Retry-After` (60 s). |
| `429`     | `too_many_attempts`      | Más de **10 pegados por usuario cada 15 minutos**. Con `Retry-After`.                                                           |
| `429`     | `ai_quota_exceeded`      | Quien pega agotó su **cuota diaria** de `extract-pasted-job`: "vuelve mañana". `Retry-After` fijo de 24 h.                      |

- En ningún caso de error cambia el link.
- **Un fallo de la IA devuelve el intento**: un `503` resta el pegado del contador (sin bajar de cero), así que nadie
  pierde uno de sus diez porque el proveedor no respondió.
- El contador de pegados **falla cerrado**: sin Redis no se lee nada, porque nada más acotaría las llamadas a la IA. Pero
  responde `503` y no `429`, para no decir "pegaste demasiadas" a quien no pegó ninguna.
- **La cuota diaria es propia** y se configura en `AI_QUOTAS` con la tarea `extract-pasted-job`, **independiente** de
  la de `extract-job`: pegar no gasta el presupuesto con el que se leen los links propios. Cuenta las lecturas con éxito
  de las últimas 24 h por usuario. Con `AI_QUOTAS` vacía no hay cuota y este `429` no aparece. Ejemplo:
  `AI_QUOTAS=extract-job=200,extract-pasted-job=30`.
- Si el cliente cierra la conexión antes de la respuesta, la lectura se aborta: no se gasta IA para un diálogo que ya
  nadie mira.
- Un pegado que no cambia ningún campo no escribe, no sube `previewVersion` y no avisa.

### Lo pegado es un dato personal

Una página de una bolsa es contenido **publicado**, y por eso `extract-job` es una tarea `public`. Lo pegado no: es lo
que alguien seleccionó en su teléfono, y en la práctica arrastra el nombre del reclutador, trozos de un chat o notas
propias. Por eso se lee con **su propia tarea, `extract-pasted-job`**, registrada con `dataSensitivity: 'personal'`
(ADR-023 §2, ADR-018 §11):

- **No sale a un proveedor externo sin el consentimiento de quien pega** (`aiConsent.externalProviders` de su perfil), y
  si sale, pasa por el `PiiRedactor`. Con la cadena de hoy —mock u Ollama local— no sale de la máquina.
- Su prompt (`libs/ai/src/infrastructure/prompts/extract-pasted-job.v1.md`) deriva del de `extract-job` y pide además no
  reproducir nombres de personas en el resumen; su golden (`libs/ai/src/evals/extract-pasted-job/golden.jsonl`, seis
  casos sintéticos de texto copiado de una app) lo mide con `summary_person_name_rate`. Se evalúa como las demás:
  `pnpm nx run ai:eval --task=extract-pasted-job --provider=mock`.
- **Condición pendiente para el día que se añada un proveedor externo a la cadena de `api`**: si la cadena solo tuviera
  externos y quien pega no hubiera dado su consentimiento, hoy respondería `503` "inténtalo en un rato" **para siempre**.
  Ese change tiene que añadir antes un código `ai_consent_required`, con un mensaje que lleve a dar el permiso
  (ADR-023, riesgos aceptados).

### La IA que ejecuta `api`

Hasta este change solo el worker ejecutaba IA. Ahora `api` también, dentro de la petición del pegado:

- **Variables.** `api` valida al arrancar la configuración de IA con el mismo `parseAiConfig` de `libs/ai` que el worker
  —`AI_CHAIN`, `AI_MOCK_MODE`, `AI_PROMPTS_DIR`, `AI_FIXTURES_DIR`, `AI_CACHE_TTL_SECONDS`, `AI_QUOTAS`, las
  `OLLAMA_*` y las `OPENROUTER_*`, con las mismas reglas: `AI_CHAIN` siempre, `AI_MOCK_MODE` si la cadena lleva `mock`,
  clave y modelo si lleva `openrouter`— y además **`PASTE_EXTRACTION_TIMEOUT_MS`** (`20000` en `.env.example`, de 1 000
  a 120 000 ms): el plazo de la lectura, que es lo que como mucho espera la petición.
- **Son obligatorias.** Si falta o no vale alguna, `api` no arranca y lo dice nombrándola, sin su valor:
  `[api] Invalid configuration, check these environment variables: PASTE_EXTRACTION_TIMEOUT_MS (missing)`. Un `.env`
  anterior necesita copiar de [`.env.example`](.env.example) `PASTE_EXTRACTION_TIMEOUT_MS` y la sección `--- IA ---`.
  Reglas que antes solo aplicaba el worker ahora también tumban `api`: `mock` con `NODE_ENV=production`, un
  `AI_MOCK_MODE` fuera de `replay`/`synth` o una tarea desconocida en `AI_QUOTAS`.
- **Tests y CI** corren con `AI_CHAIN=mock` y `AI_MOCK_MODE=replay`, como el resto.
- **Prompts en una imagen.** El build de `api` copia `libs/ai/src/infrastructure/prompts` a
  `dist/apps/api/assets/ai/prompts`, igual que el del worker, y CI comprueba que la copia está. Un `api` compilado que
  no arranque desde la raíz del workspace necesita `AI_PROMPTS_DIR=dist/apps/api/assets/ai/prompts` (o la ruta absoluta
  equivalente); si no, **no arranca**: `AiModule` comprueba al iniciarse que existen los prompts de todas sus tareas.
- La cuota se lleva por usuario en el ledger de Mongo (`ai_usage`), así que es global aunque haya varias instancias de
  `api`; el circuit breaker, en cambio, es por proceso.

### Precedencia y deshacer

Cada campo del preview guarda de dónde salió, y hay tres orígenes con **un solo orden**, que comparten `api` y el worker
(`mayOverwrite` en `libs/shared`):

> **escrito a mano > pegado > leído de la página**

- Una lectura automática **no pisa** lo pegado ni lo escrito a mano.
- Pegar sustituye lo leído de la página y lo pegado antes, **nunca un campo escrito a mano**. Y solo escribe los campos
  que trae con valor: si el texto no dice la empresa, se queda la que había.
- Escribir a mano sustituye cualquier cosa, y es lo único que puede vaciar un campo.
- Pegar conserva el motivo del último fallo de lectura, salvo `not_a_job`, que el propio pegado desmiente y se cambia
  por `no_data` con la misma fecha: con `robots_disallowed` o `blocked` la tarjeta queda completa sin volver a ofrecer
  un reintento que el sitio ya negó, y deshacer el pegado devuelve el link a `failed` con un motivo, nunca a un
  `pending` sin lectura en curso.
- "Deshacer lo que pegó <nombre>" deshace todo ese gesto, incluidos el título y la empresa tecleados en el mismo
  diálogo.

Lo que sustituye una persona (pegando o escribiendo) **guarda la entrada que desplazó entera**: valor, origen y autor.
En la tarjeta:

- **"Volver a lo anterior"**, campo a campo en el diálogo de edición: devuelve ese campo a lo que había, con su origen y
  su autor (lo leído de la página vuelve con su extractor; lo que pegó Beto vuelve como "Descripción pegada por Beto").
  Es el `revert` de `PATCH /api/links/:linkId/preview`.
- **"Deshacer lo que pegó <nombre>"**: devuelve de una vez todos los campos de un mismo pegado (los que comparten autor y
  fecha), en una sola petición. No toca lo escrito a mano, tampoco el puesto y la empresa escritos en el diálogo de
  pegado, que se devuelven campo a campo. Tras deshacer, el estado se recalcula: un link de LinkedIn completado pegando
  y luego deshecho vuelve a `failed` con su motivo, no a `manual`.
- **Deshacer llega un solo nivel atrás**: si sobre un pegado se pegan otros dos, el primero ya no se recupera.

## Postulaciones

Una postulación es el seguimiento que una persona hace de una oferta: en qué punto está, desde cuándo y qué ha pasado.
Hay **una por persona y oferta**, es **privada** y es **de quien la sigue**, no del grupo. Guardar un link **no** crea
ninguna: nace con el primer gesto ("Me interesa", "Postulé" o moverla en el tablero). Los estados son los de
[ADR-004](docs/adr/ADR-004.md), con transiciones libres; las decisiones y las alternativas descartadas están en
[ADR-024](docs/adr/ADR-024.md). Cómo operarlo: [RUNBOOK, Paso 6 quinquies](docs/RUNBOOK.md#paso-6-quinquies--operar-las-postulaciones).

### Para quien usa el producto

- **Seguir una oferta.** En cualquier tarjeta del detalle de un grupo o de `/mis-links`, "Me interesa" o "Postulé". Una
  tarjeta que ya sigues muestra el nombre de tu estado con un enlace al tablero, y sigue ofreciendo "Postulé" mientras
  esté en "Guardada" o "Interés". Si ya la seguías desde otra pestaña, la tarjeta muestra tu estado real con "Ya la
  seguías".
- **El tablero, `/postulaciones`** (enlace "Postulaciones" en la barra). Tiene seis columnas: "Interés" (también lo que
  esté en `saved`), "Postuladas", "En proceso", "Con oferta", "Aceptadas" y "Cerradas". "Cerradas" reúne las rechazadas,
  retiradas y expiradas con una etiqueta que dice cuál es cada una. No hay columna de guardadas. Cada tarjeta muestra el
  título (o la etiqueta de su URL), la empresa, la plataforma, la etapa en "En proceso", "Postulaste hoy / ayer / hace N
  días" y una marca si la compartes.
- **Mover.** Arrastra la tarjeta a otra columna o, sin ratón, usa "Mover a…", que ofrece todos los estados salvo
  "Guardada".
  - Soltar en "En proceso" pide una etapa opcional (texto libre, hasta 60 caracteres; por ejemplo, "Prueba técnica").
  - Soltar en "Cerradas" pregunta cuál de los tres cierres es.
  - La tarjeta cambia de columna cuando la API lo confirma, y vuelve a su sitio si falla o cancelas.
  - Se puede saltar etapas, retroceder para corregir un error, cerrar desde cualquier estado y reabrir una cerrada.
    Cada cambio queda en el historial.
- **"¿Cuándo postulaste?"** Se pregunta al entrar **sin fecha previa** en "Postuladas", "En proceso", "Con oferta" o
  "Aceptadas", desde la tarjeta o desde el tablero. En "En proceso" va en el mismo diálogo que la etapa. "Hoy" es el
  botón principal y tiene el foco; "Otro día" abre un selector que no admite días futuros. Si ya hay fecha, no se
  pregunta.
- **El panel** se abre al pulsar una tarjeta del tablero y reúne:
  - la oferta (en una pestaña nueva);
  - el estado y la etapa;
  - el historial, del cambio más antiguo al más reciente;
  - las notas privadas (hasta 2000 caracteres);
  - el interruptor "Compartir mi estado con mis grupos";
  - "Dejar de seguir".
- **Compartir tras el gesto.** En el detalle de un grupo, tras "Me interesa" o "Postulé" sobre una postulación privada,
  aparece un aviso: "¿Que tus grupos vean que postulaste a esta oferta? También quien entre después." (o "…que te
  interesa…").
  - Tiene dos acciones: "Compartir" y "Qué verán". "Compartir" muestra "Compartido · Deshacer".
  - El aviso no se cierra antes de 10 s ni mientras tenga el foco. Si no pulsas, la postulación sigue privada.
  - En `/mis-links` no aparece, porque ahí no hay grupo mirando.

### Qué ve el grupo y qué no

Compartir es **un solo interruptor por postulación** (`visibility`: `private` por defecto, o `group`), sin listas de
grupos. Con `group`, te ven los miembros de **cada grupo tuyo donde esté esa oferta**, ahora o más adelante, incluidos
quienes entren después. Es el texto que acompaña al interruptor y a "Qué verán".

- **Lo que ven:** tu nombre visible, como avatar con iniciales en la tarjeta de la oferta, y tu **estado canónico**,
  también cuando cambia (por ejemplo, "Rechazada"). La etiqueta accesible es "Beto · postulación: Postulada". Se ven
  hasta cinco avatares y después "+N". En `/mis-links` no hay avatares.
- **Lo que nunca ven:** la etapa, las notas, el historial, la fecha de postulación, la `version` ni el id de la
  postulación. El schema de la respuesta es estricto y no los admite.
- **La visibilidad se deriva al leer, no se guarda.** Una postulación sale en la tarjeta del link L en el grupo G si y
  solo si ahora mismo cumple las tres condiciones:
  - es `group`;
  - su dueña es miembro **actual** de G;
  - L está compartido **ahora** en G.

  Salir del grupo, ser expulsada, que quiten el link o que borren el grupo no escribe nada en la postulación: deja de
  cumplirse la condición y deja de verse. Si se revierte (vuelve a entrar, vuelven a compartir el link), vuelve a verse.
  Por eso `applications` no está registrado en `GroupDeletionHooks` ([ADR-024 §6](docs/adr/ADR-024.md)), y por eso
  borrar un grupo no le quita a nadie su postulación ni la ficha de la oferta en su tablero.

- **Los avatares no se mueven en vivo** (ADR-024 §9). Se actualizan al abrir el grupo, al cargar más, al guardar o
  importar links y al volver a la pestaña. Tu propio avatar aparece o desaparece al momento cuando compartes, dejas de
  compartir o dejas de seguir.

### "Dejar de seguir"

Está en el panel y pide confirmación: "Dejarás de seguir esta oferta: se borrarán tu estado, tus notas y tu historial
de esta oferta. Tus grupos dejarán de verte en ella. No se puede deshacer.".

- `DELETE /api/applications/:id` borra la postulación y **todos** sus eventos en una transacción. No hay borrado
  lógico. La oferta sigue donde estaba: en el grupo y en tu lista privada, si la tenías.
- Volver a seguirla crea una postulación **nueva**, con `version` 1 y un historial vacío.
- Es la salida para lo que se siguió por error. Cerrarla como "Retirada" mentiría sobre el proceso.
- Si otra pestaña ya la había borrado, el `404` se trata como éxito: el panel se cierra sin error. Mientras la petición
  está en curso, el botón queda bloqueado. Cualquier otra operación sobre una postulación que ya no existe responde
  `404 application_not_found`, y el SPA la quita de la pantalla sin mostrar error.

### Endpoints

Todas las rutas exigen access token (`Authorization: Bearer`); sin él responden `401 unauthorized`. Las de
`/api/applications/:id` solo operan sobre las postulaciones de quien pide: una ajena, una inexistente y un id mal formado
responden el mismo `404 application_not_found`.

| Método y ruta                        | Quién             | Respuesta                                                                               |
| ------------------------------------ | ----------------- | --------------------------------------------------------------------------------------- |
| `POST /api/applications`             | quien ve el link  | `201` con `{ application, created }`; `created: false` si ya la seguía, sin tocarla.    |
| `GET /api/applications`              | cualquier usuario | `200` con `{ items }`, las suyas, de la actualizada más recientemente a la más antigua. |
| `PATCH /api/applications/:id/status` | la dueña          | `200` con la postulación; cambia estado y etapa, con `version`.                         |
| `PATCH /api/applications/:id`        | la dueña          | `200` con la postulación; cambia `notes`, `visibility` o ambas, sin `version`.          |
| `GET /api/applications/:id/events`   | la dueña          | `200` con `{ items }`, el historial del evento más antiguo al más reciente.             |
| `DELETE /api/applications/:id`       | la dueña          | `204`; "Dejar de seguir": borra la postulación y su historial.                          |
| `GET /api/groups/:id/applications`   | miembro           | `200` con `{ items: [{ linkId, trackers: [{ userId, displayName, status }] }] }`.       |

- **Toda postulación que devuelve la API** lleva `id`, `linkId`, `status`, `stageLabel?`, `visibility`, `notes`,
  `appliedAt?`, `statusChangedAt`, `version`, `createdAt`, `updatedAt` y **`link`**. `link` es la ficha de la oferta sin
  contexto de grupo (`id`, `displayUrl`, `platform`, `previewStatus`, `title?`, `company?`), así que el tablero sigue
  pintando la oferta aunque ya no estés en el grupo donde la viste. Vale para el alta, los dos `PATCH` y el tablero.
- **`POST /api/applications`** recibe `{ "linkId", "status", "stageLabel"?, "appliedAt"? }` y admite cualquier estado
  canónico. Solo se puede seguir un link que se ve (el grupo del que eres miembro o tu lista privada). Si no, responde
  `404 link_not_found`, el mismo cuerpo que da `links`. Se comprueba antes que la fecha: un link ajeno da ese `404`
  aunque `appliedAt` sea futura.
- **`GET /api/applications?linkIds=a,b,…`** (opcional) limita la lista a esos links. Es lo que usa el SPA para pintar
  el estado propio de cada página de tarjetas.
- **`PATCH /api/applications/:id/status`** recibe `{ "status", "stageLabel"?, "appliedAt"?, "version" }` y decide en
  este orden:
  1. **Sin cambios.** Pedir el mismo estado y la misma etapa responde `200` sin escribir y **sin mirar la `version`**:
     un doble clic desde una pestaña vieja no es un conflicto.
  2. **Conflicto.** Si hay cambio y la `version` no es la actual, `409 application_conflict`. El SPA vuelve a pedir la
     lista y dice "Esta postulación cambió en otra pestaña…".
  3. **Cambio.** Si no, escribe el cambio y su evento en una transacción y sube `version`.

  La etapa se comporta así:
  - Solo con `in_process`, de 1 a 60 caracteres tras `trim`.
  - Omitida estando en `in_process` y pidiendo `in_process`, se conserva; `null` la borra.
  - Cambiar solo la etapa es un cambio con evento.
  - Salir de `in_process` la borra.

  `statusChangedAt` cambia solo con el estado o la etapa.

- **`PATCH /api/applications/:id`** recibe `{ "notes"?, "visibility"? }` (al menos uno). Es última escritura gana: no
  toca `version` ni `statusChangedAt`, así que compartir en una pestaña no hace fallar un arrastre en otra. Las notas se
  guardan tal como se escriben; `""` las borra.
- **`GET /api/groups/:id/applications?linkIds=a,b,…`** (obligatoria) devuelve **todos** los links pedidos que están
  compartidos en el grupo, en el orden pedido, también con `trackers` vacío. Los que no están en el grupo no salen.
  - Los `trackers` van del último cambio de estado o de etapa al más antiguo (editar una nota no reordena), con el
    `userId` como desempate. Quien pide también aparece si comparte el suyo.
  - Hace siempre cuatro lecturas (miembros, links del grupo, postulaciones compartidas, nombres), pida 2 links o 50.

| Respuesta | Código                  | Cuándo                                                                                                                                                                                                                                                                                                    |
| --------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`     | `validation_error`      | Nombra el campo: `status` desconocido; `stageLabel` vacía, de más de 60 o con otro estado; `notes` de más de 2000; `appliedAt` inválida, futura o con un estado que no la admite; `linkIds` vacía o con más de 50 tras deduplicar. `PATCH /api/applications/:id` sin `notes` ni `visibility`: sin campos. |
| `404`     | `application_not_found` | La postulación no es de quien pide, no existe (también tras "Dejar de seguir") o su id está mal formado.                                                                                                                                                                                                  |
| `404`     | `link_not_found`        | `POST`: quien pide no ve el link, no existe o su id está mal formado.                                                                                                                                                                                                                                     |
| `404`     | `group_not_found`       | `GET /api/groups/:id/applications`: quien pide no es miembro, el grupo no existe o su id está mal formado.                                                                                                                                                                                                |
| `409`     | `application_conflict`  | `PATCH …/status` con una `version` que ya no es la actual y un cambio real.                                                                                                                                                                                                                               |

### `appliedAt` y el margen de 24 h

La fecha de postulación se decide por el **estado de destino**, nunca por el de origen ([ADR-024 §3](docs/adr/ADR-024.md)):

| Destino                                                        | Sin `appliedAt` en la petición | Con `appliedAt` en la petición |
| -------------------------------------------------------------- | ------------------------------ | ------------------------------ |
| `applied`, `in_process`, `offer`, `accepted`, sin fecha previa | la hora del cambio             | la enviada                     |
| `applied`, `in_process`, `offer`, `accepted`, con fecha previa | se conserva                    | se ignora y se conserva        |
| `saved`, `interested`                                          | se borra                       | `400`                          |
| `rejected`, `withdrawn`, `expired`                             | no se toca                     | `400`                          |

- **"Hoy" no viaja.** Con "Hoy", el SPA **omite** `appliedAt` y el servidor usa la hora del cambio. Con otro día, manda
  la ISO de la **medianoche local** de ese día (`Z` o desplazamiento).
- **Margen de 24 h.** Solo se rechaza como futura una fecha posterior a `now + 24 h` según el reloj del servidor
  (`400 validation_error` nombrando `appliedAt`). Así, ni una zona horaria adelantada ni un reloj de cliente que va por
  delante rechazan una fecha legítima.
- Una fecha futura es `400` **también** cuando se iba a ignorar. La excepción es el "sin cambios", que responde `200`
  antes de mirarla.
- **Corregir una fecha que ya existe no es posible** en este change: la enviada se ignora.
- Deshacer un "Postulé" por error (volver a "Interés") borra la fecha. Reabrir en "En proceso" una oferta cerrada sin
  haber postulado la fija.

### Colecciones e índices

Dos colecciones nuevas en MongoDB. Ninguna guarda un `groupId`: la visibilidad en un grupo se deriva en cada lectura.
`api` construye los índices al arrancar (`autoIndex` de Mongoose). Cómo comprobarlos:
[RUNBOOK](docs/RUNBOOK.md#paso-6-quinquies--operar-las-postulaciones).

| Colección            | Índice                                    | Para qué                                                                              |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `applications`       | `{ userId: 1, linkId: 1 }`, **único**     | Una postulación por persona y oferta, también ante dos altas simultáneas.             |
| `applications`       | `{ userId: 1, updatedAt: -1, _id: -1 }`   | El tablero: las de una persona, de la actualizada más recientemente a la más antigua. |
| `applications`       | `{ linkId: 1, visibility: 1, userId: 1 }` | Los estados compartidos de una página de tarjetas, en una sola consulta.              |
| `application_events` | `{ applicationId: 1, at: 1, _id: 1 }`     | El historial en orden y su borrado entero al dejar de seguir.                         |

`application_events` repite el `userId` para filtrar el historial por dueña sin leer la postulación. `fitScore` /
`fitScoreDegraded` **no viven en el documento**: se **derivan al leer** del último análisis de encaje de quien pide
([ADR-030](docs/adr/ADR-030.md) §5). Un análisis básico solo aporta la marca; el informe no viaja con la postulación.
Ver [Análisis de encaje](#análisis-de-encaje-cv-y-oferta).

### Probar las postulaciones en local

Con la API en marcha, un access token obtenido como en [Probar en local](#probar-en-local) y un link que veas:

```bash
T='Authorization: Bearer <accessToken>'
J='Content-Type: application/json'
LINK_ID=...    # el id de un link de tu grupo o de tu lista privada
GROUP_ID=...   # un grupo donde está ese link

curl -s -H "$T" -H "$J" http://localhost:3000/api/applications -d "{\"linkId\":\"$LINK_ID\",\"status\":\"interested\"}"   # 201, created: true
APP_ID=...     # el application.id de la respuesta
curl -s -H "$T" -H "$J" -X PATCH "http://localhost:3000/api/applications/$APP_ID/status" -d '{"status":"in_process","stageLabel":"Prueba técnica","version":1}'   # 200, version 2
curl -s -H "$T" -H "$J" -X PATCH "http://localhost:3000/api/applications/$APP_ID" -d '{"visibility":"group"}'   # 200, version sigue en 2
curl -s -H "$T" "http://localhost:3000/api/groups/$GROUP_ID/applications?linkIds=$LINK_ID"   # tu nombre y in_process, sin la etapa
curl -s -H "$T" "http://localhost:3000/api/applications/$APP_ID/events"                     # dos eventos
curl -s -i -H "$T" -X DELETE "http://localhost:3000/api/applications/$APP_ID"               # 204: dejar de seguir
```

## Comentarios y notas en los grupos

El contexto que hoy se cuenta en el chat ("piden C1", "ya cerró", "escríbele a Ana") se queda pegado a la oferta, en el
grupo donde se dijo. Hay dos cosas distintas ([ADR-015](docs/adr/ADR-015.md), [ADR-026](docs/adr/ADR-026.md)):

- la **nota**, una por relación, que escribe quien comparte el link en el momento de compartirlo;
- los **comentarios**, muchos, que escribe cualquier miembro del grupo.

Los dos son **del grupo**: el mismo link en otro grupo tiene su propio hilo, y quien lo tiene en su lista privada no ve
ninguno. Nunca salen en la página pública. Cómo operarlo:
[RUNBOOK, Paso 6 sexies](docs/RUNBOOK.md#paso-6-sexies--operar-los-comentarios-de-grupo).

### Para quien usa el producto

- **La tarjeta del grupo** muestra, bajo el preview, "Nota de {nombre}" y los **2 últimos comentarios** (el más antiguo
  arriba) con su autor y una fecha relativa ("hace un momento", "hace 5 min", "ayer", `dd/MM/yyyy`). La nota y cada
  comentario se cortan a dos líneas; el texto entero está en el hilo. La acción dice qué falta por ver: "Comentar" sin
  ninguno, "Responder" con 1 o 2 y "Ver los N comentarios" con más. En `/mis-links` no hay nada de esto.
- **El hilo** se abre desde esa acción, en un diálogo: los comentarios en orden cronológico, "Ver comentarios
  anteriores" para seguir hacia atrás y un compositor con contador de 500 caracteres, que publica con el botón o con
  Ctrl/Cmd+Enter (Enter a secas es un salto de línea). La indicación dice qué pasa con lo que se escribe: "Lo verán los
  miembros de este grupo y seguirá aquí aunque salgas.". Por debajo de 600 px el diálogo ocupa la pantalla y el
  compositor queda por encima del teclado.
- **Quién borra qué.** Un comentario lo borran **su autor** y el **propietario del grupo**; la nota, **quien compartió
  el link** y el propietario. Nadie edita ni lo uno ni lo otro: no hay ruta para hacerlo. El borrado no deja marca, y la
  confirmación de lo ajeno lo dice ("Desaparecerá para todo el grupo y no se puede deshacer."). Es la forma de moderar
  un grupo sin tener que quitar la oferta entera, que se llevaría por delante lo valioso.
- **Salir del grupo no borra nada.** Los comentarios se quedan con el nombre de su autor y la marca "ya no está en el
  grupo", que se calcula en cada lectura. Mientras está fuera, esa persona no lee el hilo ni borra lo suyo, y el
  propietario sí puede borrarlo; si vuelve, la marca desaparece sola y puede volver a borrarlo. Lo que sí se lleva todo
  es **quitar el link del grupo** o **borrar el grupo**: relación, nota y comentarios se borran en una transacción, y
  volver a compartir el link empieza de cero. La confirmación de quitar un link dice cuántos comentarios se pierden.
- **En vivo.** Con la pantalla del grupo abierta, un comentario nuevo o borrado actualiza el contador y los 2 últimos de
  la tarjeta sin recargar, y el hilo abierto lo añade o lo quita ("Ver comentarios nuevos" cuando llega más de lo que
  cabe en el resumen). Un cambio de nota **no** se avisa en vivo.

### Endpoints

Todas las rutas exigen access token (`Authorization: Bearer`); sin él responden `401 unauthorized`. Los identificadores
de la URL no pasan por la validación del cuerpo: uno mal formado responde el mismo `404` que uno inexistente.

| Método y ruta                                              | Quién                   | Respuesta                                                                   |
| ---------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `POST /api/groups/:id/links/:linkId/comments`              | miembro                 | `201` con `{ comment, comments }`, el comentario y el resumen actualizado.  |
| `GET /api/groups/:id/links/:linkId/comments?limit&cursor`  | miembro                 | `200` con `{ items, total, nextCursor? }`, del más reciente al más antiguo. |
| `DELETE /api/groups/:id/links/:linkId/comments/:commentId` | autor u owner           | `200` con `{ comments }`, el resumen ya actualizado.                        |
| `DELETE /api/groups/:id/links/:linkId/note`                | quien compartió u owner | `204`, hubiera nota o no.                                                   |
| `POST /api/links` con `note`                               | quien comparte          | `201`; la nota solo se guarda si la relación es nueva.                      |

- **El cuerpo del alta** es `{ "text": "…" }`, de 1 a 500 caracteres tras normalizar. La **nota** llega en
  `POST /api/links { url, groupId, note }` y admite hasta 280. Los dos textos se normalizan igual (saltos de línea
  unificados, caracteres de control y de dirección fuera, `trim`) y **nada más**: un teléfono o un email se guardan tal
  cual, y el HTML se guarda y se devuelve como texto plano, que el SPA pinta escapado, nunca como HTML. Una nota que
  queda vacía tras normalizar equivale a no enviarla; con texto y sin `groupId` responde `400` nombrando `note`.
  `POST /api/links/import` no admite nota.
- **Si el link ya estaba en el grupo** (`shared: "already_there"`), la nota enviada se descarta sin error y la del
  primero no cambia: el SPA avisa "Tu nota no se añadió…" y deja el texto en el campo. La respuesta trae `link.note`, la
  de la relación.
- **El resumen** (`comments`) viaja dentro de `GET /api/groups/:id/links` y en las respuestas del alta y del borrado:
  `count`, `revision`, `sharedAt` y `latest` (los 2 últimos, con `author`, `authorLeft`, `text` y `createdAt`).
  `revision` sube con cada alta y cada borrado y nunca retrocede **mientras dure la relación**; `sharedAt` dice de qué
  relación es, porque al volver a compartir el link la revisión empieza otra vez en 0. El SPA compara la pareja
  (`sharedAt`, `revision`) y así un aviso atrasado nunca pisa un resumen más nuevo.
- **El hilo** se pagina como los listados de links: `limit` de 1 a 50 (20 por defecto) y `cursor` opaco por
  `(createdAt, _id)`. `total` sale de `commentCount` y no depende del tamaño de página. Un cursor manipulado responde
  `400 validation_error` nombrando `cursor`.
- **Sin N+1:** el listado del grupo hace 5 lecturas por página (miembros, página, total, una agregación `$topN` para los
  2 últimos de cada link y los nombres) y el hilo, 4 (miembros, relación, página y nombres), pida 2 links o 50.

| Respuesta | Código              | Cuándo                                                                                                                                                  |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`     | `validation_error`  | `text` vacío o de más de 500 tras normalizar (campo `text`); `note` de más de 280 o con texto y sin grupo (campo `note`); `limit` o `cursor` inválidos. |
| `403`     | `forbidden`         | Otro miembro intenta borrar un comentario ajeno, o quitar una nota que no es suya sin ser owner. Se responde `403` y no `404` porque ya los ve.         |
| `404`     | `group_not_found`   | Quien pide no es miembro **ahora**, el grupo no existe o su id está mal formado.                                                                        |
| `404`     | `link_not_found`    | El link no está compartido en ese grupo (también si lo quitaron a mitad) o su id está mal formado.                                                      |
| `404`     | `comment_not_found` | El comentario no existe, es de otro link o de otro grupo, su id está mal formado o otro borrado se adelantó.                                            |
| `429`     | `too_many_attempts` | Más de 30 comentarios en 15 minutos, con `Retry-After`.                                                                                                 |

### Límite de comentarios

**30 comentarios por persona cada 15 minutos**, contados en todos sus grupos, con el contador de ventana fija de Redis
`links:comment:<userId>` (el `<userId>` es el `_id` hexadecimal). Pasado el tope, `429 too_many_attempts` con
`Retry-After`, y el SPA dice cuántos minutos esperar.

- Se cuenta **por persona**, no por grupo ni por link: un script que reparte lo mismo en varios grupos gasta el mismo
  contador.
- El intento se gasta **antes** de la transacción y **se devuelve** si el comentario no llega a guardarse, incluida la
  carrera que termina en `404 link_not_found`. Lo que rechaza la validación (`400`) y lo que rechaza la pertenencia
  (`404`) no cuenta, y **borrar no cuenta**.
- **Falla abierto:** si Redis no responde, el comentario se guarda igual, porque lo que se permite de más es escribir en
  nuestra propia base y avisar a los 50 miembros de un grupo como mucho.
- Liberar a alguien antes de que pase la ventana:
  [RUNBOOK](docs/RUNBOOK.md#paso-6-sexies--operar-los-comentarios-de-grupo).

### El aviso en vivo

Un alta o un borrado se publica en el canal de Redis `events:group-link.comments` (tipo `GroupLinkCommentsChanged.v1`),
después de confirmar la escritura y sin esperar a que se publique: la respuesta no depende del aviso. Cada instancia de
`api` lo recibe y lo reparte por el canal SSE de `GET /api/events` (evento `group-link.comments`). Cada tramo lleva
cosas distintas a propósito:

| Tramo | Qué lleva                                                                                                  | Por qué                                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redis | `{ groupId, linkId, commentId, change }` (`created` o `deleted`)                                           | El canal no sabe quién puede ver qué, sus mensajes se ven con `MONITOR` y cualquier suscriptor los recibe todos: **el texto de un comentario nunca viaja por Redis, ni aparece en los logs**. |
| SSE   | `{ groupId, linkId, change, commentId, comments }`, con el texto, el autor y `authorLeft` de los 2 últimos | Solo llega a los miembros **actuales** de ese grupo, que ya pueden leer lo mismo con un `GET`; sin el texto, cada comentario costaría una petición por miembro conectado.                     |

Los destinatarios son los miembros del grupo, no quienes ven el link por otro sitio. Si el link ya no está compartido
allí cuando toca repartir, no se envía nada. Es un aviso de mejor esfuerzo, sin outbox: si Redis está caído, la tarjeta
se pone al día al volver a la pestaña o al reabrir el hilo.

### Colección, índices y campos nuevos

`api` construye los índices al arrancar (`autoIndex` de Mongoose). Cómo comprobarlos:
[RUNBOOK](docs/RUNBOOK.md#paso-6-sexies--operar-los-comentarios-de-grupo).

| Colección             | Índice                                              | Para qué                                                                              |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `group_link_comments` | `{ groupId: 1, linkId: 1, createdAt: -1, _id: -1 }` | El hilo paginado, los 2 últimos de cada link, el borrado por relación y el del grupo. |

Un comentario es `{ _id, groupId, linkId, authorId, text, createdAt }`. `group_links` suma tres campos y **no cambia
ninguno de sus índices**: `note?` (`text`, `createdAt`, sin `updatedAt` porque no se edita), `commentCount` y
`commentsRevision`, que se leen como 0 si el documento no los tiene. No hay migración ni backfill: los crea el primer
`$inc`.

`group_links` es el **único dueño** de esos dos contadores y el único que abre las transacciones que tocan comentarios,
así que comentar y quitar el link a la vez chocan en el mismo documento y una de las dos se reintenta: nunca queda un
comentario sin su relación que reaparezca al volver a compartirla.

### Probar los comentarios en local

Con la API en marcha, un access token obtenido como en [Probar en local](#probar-en-local) y un link compartido en un
grupo del que seas miembro:

```bash
T='Authorization: Bearer <accessToken>'
J='Content-Type: application/json'
GROUP_ID=...   # un grupo del que seas miembro
LINK_ID=...    # un link compartido en ese grupo

curl -s -H "$T" -H "$J" http://localhost:3000/api/links \
  -d "{\"url\":\"https://www.getonbrd.com/jobs/backend\",\"groupId\":\"$GROUP_ID\",\"note\":\"esta es la que te dije\"}"   # 201 con link.note
curl -s -H "$T" -H "$J" "http://localhost:3000/api/groups/$GROUP_ID/links/$LINK_ID/comments" -d '{"text":"piden C1"}'      # 201 con comment y comments
curl -s -H "$T" "http://localhost:3000/api/groups/$GROUP_ID/links/$LINK_ID/comments?limit=20"                              # el hilo, con total
curl -s -H "$T" "http://localhost:3000/api/groups/$GROUP_ID/links?limit=20"                                                # la nota y el resumen en la tarjeta
COMMENT_ID=...  # el comment.id del alta
curl -s -H "$T" -X DELETE "http://localhost:3000/api/groups/$GROUP_ID/links/$LINK_ID/comments/$COMMENT_ID"                  # 200 con comments
curl -s -i -H "$T" -X DELETE "http://localhost:3000/api/groups/$GROUP_ID/links/$LINK_ID/note"                              # 204
curl -sN -H "$T" http://localhost:3000/api/events                                                                          # el canal SSE (Ctrl+C)
```

Con el `curl -sN` de la última línea abierto en otra terminal, cada alta y cada borrado sale como un evento
`group-link.comments`. Lo que Redis reparte entre instancias se ve sin texto alguno:

```bash
docker compose exec redis redis-cli subscribe events:group-link.comments
```

## Enlaces públicos de una oferta

Una oferta compartida en un grupo puede tener además un **enlace público**: una URL corta que se pega en un chat y que
cualquiera abre sin cuenta, con la oferta puesta —título, empresa, dónde y cuánto— en lugar de una URL pelada
([ADR-013](docs/adr/ADR-013.md), [ADR-027](docs/adr/ADR-027.md)). La sirve la **API**, no el SPA, en HTML sin SSR y sin
JavaScript, para que los bots de WhatsApp y compañía compongan su tarjeta. Cómo operarlo:
[RUNBOOK, Paso 6 septies](docs/RUNBOOK.md#paso-6-septies--operar-los-enlaces-públicos).

El enlace vive en la **relación link-grupo**, no en la vacante: quitar el link del grupo o borrar el grupo se lo llevan,
y la misma oferta publicada en dos grupos tiene dos enlaces independientes. No hay enlaces públicos de la lista privada.

### Para quien usa el producto

- **La URL es `<origen de la API>/p/<slug>`**, con un `slug` opaco de 12 caracteres del alfabeto
  `23456789abcdefghjkmnpqrstvwxyz` (Crockford sin `0`, `1`, `i`, `l`, `o` ni `u`), en minúscula y **sensible a
  mayúsculas**: un slug con otra caja es un slug que no existe. No lleva dentro nada de la oferta, ni del grupo, ni
  ningún identificador interno.
- **Qué se ve:** el título (o una etiqueta derivada de la URL si la oferta aún no se ha leído), empresa, ubicación,
  salario, modalidad, nivel, fecha de publicación y de cierre, y "Ver la oferta original".
- **Qué no se ve nunca:** el resumen, las habilidades, los idiomas, quién escribió o pegó cada dato, el estado del
  preview o su motivo de fallo, **quién compartió la oferta**, **el grupo y su nombre**, la nota, los comentarios,
  ninguna postulación y ningún identificador interno. Un enlace público no dice a qué grupo pertenece.
- **La URL de la oferta original sale saneada:** sin usuario ni contraseña embebidos y sin los parámetros de campaña y
  seguimiento (`utm_*`, `gclid`, `fbclid`, `mc_cid`, `mc_eid`, `igshid`, `ref`, `trk`, `trkcampaign`), que pueden
  arrastrar el rastro de quien recibió esa oferta por correo. **El fragmento (`#…`) se conserva**, porque hay bolsas que
  ponen ahí la ruta de la vacante. Si la URL guardada no es `http(s)`, la página se pinta sin ese enlace. Lo guardado no
  se toca: esto es solo lo que se publica.
- **Quién lo enciende y lo apaga:** **quien compartió el link o el propietario del grupo**, en el menú de la tarjeta
  ("Compartir con un enlace público", "Copiar enlace", "Dejar de compartir"), igual que la nota y los comentarios.
  Cualquier **miembro** ve la marca "Enlace público" y puede copiar la URL —ya es pública—, pero no toca el interruptor.
- **Despublicar quema el slug:** esa URL responde `404` para siempre, y volver a publicar genera **otra**. Lo que un
  chat ya pintó no se borra: WhatsApp guarda su tarjeta días, así que despublicar mata la página, no la vista previa que
  ya se envió. El texto del interruptor lo dice.
- **Publicar es idempotente:** dos pestañas no dejan dos enlaces vivos; la segunda recibe el mismo `slug`.
- **Visibilidad por defecto del grupo.** `defaultVisibility` es `public`: **los links nuevos de un grupo nacen con su
  enlace público**, tanto al guardarlos uno a uno como al importar un chat. El propietario la apaga en `/grupos/:id`
  ("Los links nuevos se comparten con un enlace público"). Cambiarla **no toca ningún link ya compartido** —ni publica
  ni despublica— y cada link conserva su interruptor; un grupo anterior a esta función, sin el ajuste guardado, se lee
  como `public`. Al guardar en un grupo que comparte en público, la confirmación lo dice y ofrece "Copiar enlace".
- **Copiar el enlace de una oferta que aún no se ha leído** avisa ("Todavía estamos leyendo la oferta: si lo envías
  ahora, la tarjeta saldrá sin datos") y **deja copiar**: la página mejora sola cuando llegue el enriquecimiento, pero
  la tarjeta que ya se pegó en un chat no se rehace.
- **Quien recibe el enlace sin cuenta** ve la oferta y un botón "Guardar en LinkVault", que lleva a
  `/registro?import=<slug>`; tras registrarse o entrar, la oferta se guarda en su **lista privada** ("Solo para mí"),
  nunca en un grupo.

### Las dos URLs públicas

| Ruta                                  | Qué sirve                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /p/:slug`                        | La página HTML que lee el bot del chat. **Fuera del prefijo `/api`** y sin sesión.            |
| `GET /api/public/previews/:slug`      | Los datos de la oferta en JSON, sin sesión, para la vista `/oferta/:slug` del SPA.            |

- **La misma respuesta para todo el mundo:** no se mira el `User-Agent` ni el `Accept` y no hay `Vary`. Lo que separa a
  un bot de una persona es que el navegador ejecuta el `<meta http-equiv="refresh" content="0; …">` hacia
  `/oferta/:slug` y el bot no. No hay **ninguna** etiqueta `<script>`: la página no ejecuta JavaScript y lleva además un
  enlace visible de respaldo ("Ver la oferta en LinkVault").
- **Etiquetas Open Graph** con `og:url` desde la configuración (nunca desde la cabecera `Host`, que es falsificable),
  título cortado a 100 code points y descripción a 200, en el orden empresa · ubicación · **salario** · modalidad ·
  nivel · cierre —el salario delante porque es lo que decide si alguien abre la oferta y lo primero que cada app
  recorta—. La imagen es fija, de marca: `<WEB_BASE_URL>/assets/og-default.png` (1200×630). El `index.html` del SPA lleva
  su propio juego de OG de marca, para que un bot que **sí** siga el `refresh` componga una tarjeta genérica y no una
  vacía.
- **Cabeceras** de las tres respuestas (`200`, `404` y `429`): `Referrer-Policy: no-referrer` —sin ella el slug, que es
  la llave de la página, viajaría a la bolsa dentro del `Referer`—, `X-Content-Type-Options: nosniff` y
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none';
  frame-ancestors 'none'`. Siempre `text/html; charset=utf-8`: **esa ruta nunca responde JSON**, tampoco en `/p/`, en
  `/p/a/b` ni ante un error inesperado. La página va con `noindex` y **sin** `Disallow` en `robots.txt`, porque
  bloquearía también a los bots de las tarjetas; la vista `/oferta/:slug` del SPA sí lleva `Disallow: /oferta/`.
- **Caché:** `200` con `Cache-Control: public, max-age=60` (suficiente para absorber a los bots que piden la misma URL,
  poco para que despublicar se note); `404` y `429`, `no-store`.
- **Coste:** dos lecturas indexadas y **ninguna escritura**. No pide el enriquecimiento del link aunque esté sin leer,
  no llama a la IA, no escribe en el outbox y no reparte avisos. Un bot que pida mil veces la página no genera ni una
  petición a la bolsa.
- **Log:** cada petición de las dos rutas deja `{ slug, status }` y **nada más** —ni dirección de origen, ni
  `User-Agent`, ni referente—, y el log automático de petición está apagado para ellas.
- **Un `404` es idéntico** para un slug inexistente, uno quemado, uno mal formado, uno cuyo link salió del grupo y uno
  cuyo grupo se borró: "Este enlace ya no está disponible" y "Pídeselo de nuevo a quien te lo envió" en la página,
  `404 link_not_found` en el JSON.

### Endpoints del interruptor

Estas dos rutas exigen access token; las dos públicas de arriba, no.

| Método y ruta                                  | Quién                    | Respuesta                                                            |
| ---------------------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `PUT /api/groups/:id/links/:linkId/public`     | quien compartió u owner  | `200` con `{ slug, url, publishedAt }`; publicar dos veces, el mismo. |
| `DELETE /api/groups/:id/links/:linkId/public`  | quien compartió u owner  | `204`, estuviera publicado o no.                                     |
| `PATCH /api/groups/:id/settings`               | owner                    | `200` con el detalle del grupo, ya con `defaultVisibility`.          |

El orden de comprobaciones es pertenencia → relación → permiso, así que un no miembro recibe `404 group_not_found`, un
link que no está en el grupo `404 link_not_found` y otro miembro `403 forbidden` **esté o no publicado**: la respuesta no
le revela a quien no puede tocarlo si el enlace existía. `GET /api/groups/:id/links` trae `publicShare` (`slug`, `url`
absoluta y `publishedAt`) de cada tarjeta publicada, sin una lectura más; `GET /api/links/mine` **no** lo lleva.
`POST /api/links` y `POST /api/links/import` lo devuelven cuando el grupo comparte en público y la relación es nueva.
`PATCH /api/groups/:id/settings` recibe `{ "defaultVisibility": "public" | "private" }`; otro valor responde
`400 validation_error` nombrando `defaultVisibility`, y un miembro que no es owner, `403 forbidden`.

### Variables de las URLs públicas

Las dos son **obligatorias**: `api` no arranca sin ellas, así que un `.env` anterior a esta función tiene que copiarlas
de `.env.example`. Absolutas, `http(s)` y **sin barra final**. Nunca se deducen de la cabecera `Host` de una petición:
acabarían dentro de una etiqueta que los chats muestran y cachean.

| Variable               | `.env.example`          | Para qué                                                                             |
| ---------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `PUBLIC_PAGE_BASE_URL` | `http://localhost:3000` | Origen que sirve `/p/:slug`: la URL que se pega en un chat y el valor de `og:url`.    |
| `WEB_BASE_URL`         | `http://localhost:4200` | Origen del SPA: el destino del redirect (`/oferta/:slug`) y la imagen fija de la OG. |

En producción pueden apuntar al mismo origen. En desarrollo son distintos a propósito: la página la sirve `api` en el
3000 y la vista pública, `web` en el 4200.

### Límites de las rutas públicas

Son un tope de **coste** —que un bucle no nos haga leer Mongo sin fin—, no un control por cliente: **ninguna clave
depende de nada que envíe quien pide**, así que no hay nada que falsificar y no hace falta `trustProxy` (que sigue
siendo de `deploy-prod`, y activarlo a ciegas debilitaría los límites de login, registro y unirse a un grupo).

| Contador en Redis           | Ruta                               | Tope por ventana de 15 min |
| --------------------------- | ---------------------------------- | -------------------------- |
| `links:public-page`         | `GET /p/:slug`, todas juntas       | 6000                       |
| `links:public-preview`      | `GET /api/public/previews/:slug`   | 6000                       |
| `links:public-page:<slug>`  | `GET /p/:slug`, de **ese** enlace  | 2000                       |

- **El orden es formato del slug → contador global → contador del slug → lecturas.** Un slug mal formado responde `404`
  sin gastar ni el contador, y superar el tope no cuesta **ninguna** lectura.
- **Si el contador del slug rechaza, el intento se devuelve al global**, para que un bucle contra un enlace agotado no
  vacíe el tope de todos los demás.
- **Los dos globales son independientes:** una avalancha contra la página no deja sin ver la oferta a quien ya está en
  `/oferta/:slug`.
- **Fallan abiertos:** si Redis no responde se sirve igual, porque lo que se permite de más son dos lecturas indexadas.
- **Cuando se agotan:** `/p/:slug` responde `429` **en HTML** con `Retry-After` y "Demasiadas peticiones. Inténtalo en un
  momento."; el endpoint JSON, `429 too_many_attempts` con `Retry-After`, y la vista del SPA dice "Ahora mismo no
  podemos mostrar esta oferta. Inténtalo en un momento." con "Reintentar" **sin perder** el botón de guardar. La
  ventana es fija: o se espera a que pase, o se libera el contador en Redis
  ([RUNBOOK](docs/RUNBOOK.md#paso-6-septies--operar-los-enlaces-públicos)). Lo que no se arregla es la tarjeta que un
  chat cacheó vacía mientras duraba el `429`.

### Índice y campos nuevos

`api` construye el índice al arrancar (`autoIndex` de Mongoose). Cómo comprobarlo:
[RUNBOOK](docs/RUNBOOK.md#paso-6-septies--operar-los-enlaces-públicos).

| Colección     | Índice                                                              | Para qué                                                   |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `group_links` | `public_share_slug`: `{ 'publicShare.slug': 1 }`, único **parcial** | Resolver la página con un `findOne` y garantizar el slug. |

- Es el **único** índice que añade esta función, y los tres de `group_links` no cambian
  (`groupId_1_linkId_1` único, `groupId_1_sharedAt_-1__id_-1` y `linkId_1`). Es **parcial**
  (`partialFilterExpression: { 'publicShare.slug': { $exists: true } }`) porque casi ninguna relación está publicada y
  un índice único a secas las haría chocar a todas.
- `group_links` gana `publicShare?` (`slug`, `publishedBy`, `publishedAt`) y `groups`, `settings.defaultVisibility`
  (`public` | `private`), sin índices. `publishedBy` es solo trazabilidad interna: **no sale en ninguna respuesta**.
- **No hay backfill ni migración.** Ningún link ya compartido se publica: se compartió cuando "compartir en el grupo"
  significaba "lo ven los miembros". Un grupo sin `settings` se lee `public`, y eso solo afecta a lo que entre después.
- La unicidad la garantiza el índice, no una consulta previa: publicar reintenta hasta 5 veces con otro slug si choca, y
  el alta que nace publicada deja que se reintente la transacción entera (por eso `MAX_RESOLVE_ATTEMPTS` es 3).
- Volver a la versión anterior es desplegarla: ignora los campos, y `/p/:slug` deja de existir, con lo que las URLs
  repartidas dejan de responder.

### Rutas del SPA

| Ruta            | Contenido                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/oferta/:slug` | Vista pública de la oferta, **sin sesión y sin guard**, con "Ver la oferta original" y el CTA "Guardar en LinkVault". |
| `/mis-links`    | Con `?import=<slug>` guarda esa oferta en la lista privada, una sola vez, y quita el parámetro de la URL.              |

Al arrancar en `/oferta/…` el SPA **no restaura la sesión**: quien llega desde un chat no tiene cookie y no debe esperar
a "Conectando…". La sesión se resuelve donde siempre, en el guard de la ruta a la que se navegue después. El CTA navega
siempre a `/registro?import=<slug>` sin consultar la sesión; `guestGuard` desvía a `/mis-links?import=<slug>` a quien ya
la tenga, y el `import` se valida como slug y **gana** al `returnUrl`.

### Probar los enlaces públicos en local

Con la API en marcha, un access token obtenido como en [Probar en local](#probar-en-local) y un link compartido en un
grupo del que seas miembro:

```bash
T='Authorization: Bearer <accessToken>'
J='Content-Type: application/json'
GROUP_ID=...   # un grupo del que seas miembro
LINK_ID=...    # un link compartido en ese grupo

curl -s -H "$T" -X PUT "http://localhost:3000/api/groups/$GROUP_ID/links/$LINK_ID/public"        # 200 con slug, url y publishedAt
SLUG=...       # el slug de la respuesta
curl -s -i "http://localhost:3000/p/$SLUG" | head -20                                            # 200 text/html con sus cabeceras
curl -s "http://localhost:3000/p/$SLUG" | grep -o '<meta property="og:[a-z:]*" content="[^"]*"'  # las etiquetas de la tarjeta
curl -s "http://localhost:3000/api/public/previews/$SLUG"                                        # el JSON de la vista del SPA
curl -s -H "$T" "http://localhost:3000/api/groups/$GROUP_ID/links?limit=20"                      # publicShare en la tarjeta
curl -s -i -H "$T" -X DELETE "http://localhost:3000/api/groups/$GROUP_ID/links/$LINK_ID/public"  # 204: el slug se quema
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "http://localhost:3000/p/$SLUG"         # 404 text/html, para siempre

curl -s -H "$T" -H "$J" -X PATCH "http://localhost:3000/api/groups/$GROUP_ID/settings" \
  -d '{"defaultVisibility":"private"}'                                                           # los links nuevos ya no nacen públicos
curl -s -H "$T" -H "$J" http://localhost:3000/api/links \
  -d "{\"url\":\"https://example.com/vacante-nueva\",\"groupId\":\"$GROUP_ID\"}"                 # 201 sin publicShare
```

Ninguna de las dos rutas públicas lleva `Authorization`, y el `404` es el mismo para un slug inventado
(`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/p/22222222222x`) que para uno quemado.

## Mi CV

Cada persona puede guardar **hasta 5 CV** en PDF o DOCX (≤ 5 MiB), y LinkVault **lee su texto** para que
`cv-match-suggestions` pueda compararlo después con cada vacante ([ADR-006](docs/adr/ADR-006.md),
[ADR-009](docs/adr/ADR-009.md), [ADR-028](docs/adr/ADR-028.md)). Es el dato más personal que guarda el producto, así que
lo primero es qué se hace con él. Cómo operarlo: [RUNBOOK, Paso 6 octies](docs/RUNBOOK.md#paso-6-octies--operar-los-cv).

### Qué se guarda, dónde y quién lo ve

| Dato | Dónde | Quién lo ve |
| ---- | ----- | ----------- |
| Los **bytes del archivo** | MinIO, bucket de CV (`S3_BUCKET`, por defecto `cvs`), clave `<userId>/<cvId>` | **Nadie por HTTP.** El único que los lee es el worker, para extraer el texto. |
| `fileName` (saneado), `fileType`, `sizeBytes`, `version`, `isDefault`, `uploadedAt` | `cv_documents` | Su dueño, en su listado. |
| `extraction`: `status`, `failureReason?`, `textChars`, `extractedAt?` | `cv_documents` | Su dueño, en su listado. |
| `extractedText` | `cv_documents` | Su dueño, **solo los primeros 2.000 caracteres** y solo por la vista previa. |
| `truncated` (el texto se recortó a 200.000 caracteres) y `fileKey` | `cv_documents` | **Nadie**: son detalles de cómo guardamos, no salen en ninguna respuesta. |

- **No hay descarga, y no es un olvido.** No existe `GET /api/cv/:id/file` ni ningún botón "Descargar", ni una URL
  prefirmada de MinIO: una ruta que devuelve el CV entero es la mayor superficie de salida de datos de todo esto, y el
  archivo lo acaba de subir la persona desde su dispositivo. Para saber "cuál de estos tres subí" están el **nombre y la
  fecha** de la tarjeta y la **vista previa del texto**.
- **La clave del objeto no dice nada**: `<userId>/<cvId>`, sin el nombre del archivo y sin extensión, para que no acabe
  en el listado de un bucket, en un mensaje de error del SDK ni en una traza. El prefijo por usuario existe para poder
  borrar de una vez todo lo de una persona.
- **El bucket es privado, sin política anónima y sin regla de expiración**: un CV no caduca solo. El cifrado en reposo y
  la política de retención **no entran aquí** y los hereda `deploy-prod` (desviación explícita de `docs/design.md` §8,
  anotada en ADR-028).
- **Nada del CV en los logs**: ni el texto, ni el nombre del archivo, ni sus bytes, ni el mensaje de error de un parser
  o del SDK de S3. Las líneas llevan `cvId`, estado, motivo, tamaño, caracteres y duración.
- **La extracción no usa IA.** La primera vez que el texto puede salir de nuestra infraestructura es al **analizar el
  encaje** contra una oferta, y solo con el permiso de `/perfil` y la redacción de datos personales. Detalle:
  [Análisis de encaje](#análisis-de-encaje-cv-y-oferta).

### Endpoints

Las cinco exigen access token y operan **solo** sobre los CV de quien pide. Un `:id` de otra persona, inexistente o mal
formado responde el mismo `404 cv_not_found`, con el mismo cuerpo en los tres casos.

| Método y ruta | Respuesta |
| ------------- | --------- |
| `POST /api/cv` (`multipart/form-data`, una parte `file`) | `201` con el CV (`id`, `fileName`, `fileType`, `sizeBytes`, `version`, `isDefault`, `uploadedAt`, `extraction`). |
| `GET /api/cv` | `200` con `items`, del más reciente al más antiguo. Sin paginación: el máximo son 5. |
| `GET /api/cv/:id/text-preview` | `200` con `{ status, text, chars, complete }` y `Cache-Control: private, no-store`. |
| `PUT /api/cv/:id/default` | `200` con la lista actualizada; idempotente si ese CV ya lo era. |
| `DELETE /api/cv/:id` | `200` con la lista actualizada; el archivo se borra después, por la cola. |

- **El tipo lo deciden los bytes y la extensión**, que tienen que coincidir: `%PDF-` dentro del primer kilobyte o
  `PK\x03\x04` al principio, y `.pdf` o `.docx`. El `Content-Type` de la parte **solo veta**: si nombra un tipo conocido
  que contradice, `415 unsupported_file_type`; si es `application/octet-stream`, `text/plain` o falta, no estorba
  (rechazarlo sería rechazar un CV por culpa del navegador de quien lo sube). La decisión se toma **con el primer trozo
  que llega**; lo que no cuadra se descarta sobre la marcha sin acumular el archivo.
- **Códigos:** `415 unsupported_file_type` (no es PDF ni DOCX), `413 file_too_large` (más de 5 MiB),
  `409 too_many_cvs` (ya hay 5 guardados; no se borra ninguno solo), `404 cv_not_found`, `429 too_many_attempts` con
  `Retry-After`, y `415 unsupported_media_type` cuando el cuerpo **no es multipart**, que es otra cosa. Ningún error del
  parser de multipart sale como `500`.
- **Cada subida es una versión nueva** (`version` correlativo por persona) y **los números no se reutilizan**: con 1, 2
  y 3, borrar la 3 hace que la siguiente sea la 4. Un CV guardado no se modifica nunca.
- **Siempre hay exactamente un CV marcado** mientras quede alguno: la subida más reciente se lleva la marca, `PUT …
  /default` la mueve a mano, y borrar el marcado promueve al más reciente de los que quedan. La marca dice "este quiero
  usar", no "este se pudo leer": un CV en `failed` puede estar marcado, y la pantalla avisa de la consecuencia.
- **La vista previa** devuelve los primeros 2.000 caracteres cortados en un límite de palabra, con `status` (para
  distinguir un CV que todavía se está leyendo de uno que no se pudo leer) y `complete` (si con eso ya está todo el
  texto guardado). Un CV que aún no está `extracted` responde `200` con texto vacío y su `status`, no un error. Es la
  **única** ruta que lee el texto, y lee solo ese prefijo. Existe porque un PDF a dos columnas se extrae entrelazando las
  dos: `textChars` sale alto, el estado es `extracted` y lo guardado no sirve para nada; así se ve en dos segundos.

### Estados de la lectura

La extracción la hace el worker en su cola `extract-cv` (`pdf-parse` para PDF, `mammoth` para DOCX), a partir del evento
`CvUploaded.v1` que el alta escribe en `outbox_events` **dentro de su transacción**. Un archivo ilegible o sin texto
**no es un error del job**: es un resultado, y se enseña.

| Estado | Cuándo | Qué dice la pantalla |
| ------ | ------ | -------------------- |
| `pending` | Desde el `201` hasta que el worker escribe | "Estamos leyendo tu CV…" |
| `extracted` | Texto útil: al menos 100 caracteres tras normalizar | "Listo · tu CV se leyó bien", con "Ver lo que leímos" |
| `failed` · `unreadable_file` | El parser no pudo abrirlo: corrupto, cifrado, un ZIP que no es DOCX, o venció el plazo | "No pudimos abrir este archivo. Si tiene contraseña, quítasela y vuelve a subirlo." |
| `failed` · `no_text` | Se abrió, pero no hay texto: un escaneo o imágenes | "Este archivo no tiene texto…", con el consejo según el formato (PDF o DOCX) |
| `failed` · `internal_error` | Un fallo nuestro que agotó los tres intentos, o el archivo no estaba en el almacén | "No pudimos leerlo ahora. Vuelve a subirlo en un rato." |

- **Nunca se queda en `pending` para siempre:** agotados los reintentos, el consumidor lo deja en `failed` con
  `internal_error`. El SPA sondea la lista cada 2 s mientras alguno esté `pending`, hasta 60 s, y después ofrece
  "Actualizar", que reanuda otra ventana.
- **El texto se guarda normalizado** (`\r\n` → `\n`, sin caracteres de control, sin líneas en blanco repetidas) y
  **acotado a 200.000 caracteres**; si sobra, se recorta y se marca en la base, marca que no sale en ninguna respuesta.
- **Un `failed` no borra nada**: el documento y el archivo siguen ahí, se puede marcar por defecto y eliminar como
  cualquier otro. El remedio es volver a subirlo, que crea otra versión; no hay "reintentar la lectura".
- **Eliminar se lleva el archivo**: el borrado escribe `CvDeleted.v1` en la misma transacción y el worker borra el objeto
  desde la cola `delete-cv-file`. Borrar un objeto que ya no está es un acierto, así que repetirlo es inofensivo.

### Los tres contadores

Ventana fija de 15 min por persona, con el contador de plataforma; superado el tope, `429 too_many_attempts` con
`Retry-After`. **Los tres fallan abiertos**: con Redis caído, quien quiere subir su CV lo sube.

| Clave en Redis | Ruta | Tope | Devolución |
| -------------- | ---- | ---- | ---------- |
| `cv:upload:<userId>` | `POST /api/cv` | 10 | **Sí**, si la subida falla después de consumirlo y antes de quedar guardada (`409`, almacén caído, transacción que no confirma). |
| `cv:text-preview:<userId>` | `GET /api/cv/:id/text-preview` | 60 | No hace falta: solo se consume al leer. |
| `cv:reject:<userId>` | `POST /api/cv`, **solo al rechazar en la puerta** | 30 | **Nunca**: un rechazo ocurrió. |

- **El de subidas no se toca hasta pasar la puerta:** un `413` o un `415` no lo consumen, así que equivocarse de archivo
  no cuesta una subida. Lo que sí cuentan esos dos es el **contador de rechazos**, que es lo que pone techo a una ráfaga
  de basura; el `413` lo consume también porque es el único camino que llega a leer megabytes antes de rechazar.
- **El tope duro de almacenamiento no lo pone el contador**, sino el máximo de 5 CV: sin contador, una persona puede
  subir y borrar en bucle, que gasta tráfico pero no acumula nada.
- El techo **por cliente** (límite por IP y tope de cuerpo en el proxy) es de `deploy-prod`: estos tres cuentan por
  persona autenticada.

### Colecciones, bucket y variables

`api` construye los índices al arrancar (`autoIndex` de Mongoose). Cómo comprobarlos:
[RUNBOOK](docs/RUNBOOK.md#paso-6-octies--operar-los-cv).

| Colección | Índices | Para qué |
| --------- | ------- | -------- |
| `cv_documents` | único `(userId, version)`; único **parcial** `(userId, isDefault)` sobre `isDefault: true`; `(userId, uploadedAt)` | La correlatividad de las versiones, la invariante de "un solo marcado" y el listado. |
| `cv_version_counters` | solo `_id` | Un documento por persona (`_id` = `userId`, `next`) con el **próximo** número de versión, para que no se reutilice el de un CV borrado. Se borra con el último CV de esa persona. |

- **Sin backfill ni migración:** no existe ningún CV previo. Volver atrás es desplegar la versión anterior; los
  documentos y los objetos se quedan como están.
- **El bucket se llama `cvs`, no `cv`:** S3 —y MinIO con él— exige entre 3 y 63 caracteres en el nombre de un bucket. Lo
  crea el `docker-compose` de forma idempotente, privado y sin regla de expiración, en una comprobación **independiente**
  de la del bucket de snapshots (con un volumen que ya existía, si colgara de ella no se crearía nunca).
- **Variables**: las cinco `S3_*` pasan a ser **obligatorias también en `api`** (incluida `S3_BUCKET`, que hasta ahora no
  leía nadie), y `worker` añade `CV_EXTRACTION_TIMEOUT_MS` (30 s por defecto, de 1 s a 120 s) y `CV_EXTRACT_CONCURRENCY`
  (1 por defecto, de 1 a 4). Un `.env` anterior a esta función **no las tiene y los procesos no arrancan**.

### Rutas del SPA

| Ruta | Contenido |
| ---- | --------- |
| `/mi-cv` | "Mi CV" en la barra de navegación: subir con progreso, las tarjetas de los CV guardados con su estado, "Usar este", "Ver lo que leímos" y "Eliminar". |

La pantalla habla de **"CV guardado"** y los identifica por **nombre y fecha**, no por número de versión ni por
caracteres leídos. Bajo el marcado se lee "Este es el CV que compararemos con las vacantes", y siempre está visible la
línea de privacidad actualizada: el CV solo lo ve su dueño y **no sale de LinkVault sin permiso**; en **Perfil** se
decide si un proveedor externo puede analizarlo, y qué se sustituye antes de enviarlo. Detalle del permiso y de qué
sale: [Análisis de encaje](#análisis-de-encaje-cv-y-oferta).

### Probar los CV en local

Con la API y el worker en marcha y un access token obtenido como en [Probar en local](#probar-en-local):

```bash
T='Authorization: Bearer <accessToken>'

curl -s -H "$T" -F 'file=@CV_backend.pdf' http://localhost:3000/api/cv     # 201 con version 1, isDefault true y extraction.status pending
curl -s -H "$T" http://localhost:3000/api/cv                               # la lista; en unos segundos, extracted
CV_ID=...                                                                  # el id de la respuesta
curl -s -H "$T" "http://localhost:3000/api/cv/$CV_ID/text-preview"         # { status, text, chars, complete }
curl -s -H "$T" -X PUT "http://localhost:3000/api/cv/$CV_ID/default"       # 200 con la lista actualizada
curl -s -H "$T" -X DELETE "http://localhost:3000/api/cv/$CV_ID"            # 200: el archivo lo borra el worker

curl -s -H "$T" -F 'file=@notas.odt' http://localhost:3000/api/cv          # 415 unsupported_file_type
curl -s -H "$T" -H 'Content-Type: application/json' -d '{}' \
  http://localhost:3000/api/cv                                             # 415 unsupported_media_type: no es multipart
```

Ninguna ruta devuelve el archivo: si alguna vez aparece una, hay que añadir en el mismo commit
`res.headers["content-disposition"]` y cualquier campo `fileName` a la lista de redacción del logger, porque `pino`
redacta **rutas declaradas** y no adivina.

## Análisis de encaje (CV y oferta)

Con un CV leído y una oferta guardada, la persona puede pedir un **análisis de encaje** desde la tarjeta
([ADR-029](docs/adr/ADR-029.md), [ADR-030](docs/adr/ADR-030.md)). Cómo operarlo:
[RUNBOOK, Paso 6 nonies](docs/RUNBOOK.md#paso-6-nonies--operar-los-análisis-de-encaje).

### Qué se analiza, qué sale y bajo qué permiso

| Qué | Detalle |
| --- | ------- |
| **Se analiza** | El texto del CV marcado (o el elegido en el diálogo) y la descripción / preview de la oferta. |
| **Qué sale de LinkVault** | Solo si hay permiso vigente en `/perfil` (`aiConsent.externalProviders` y `textVersion` = versión actual del texto, hoy `2026-09-21`): el texto del CV y de la oferta, **después** de sustituir email, teléfonos, dirección, documento, URL y (por defecto) el nombre por marcadores. El resto del CV —experiencia, estudios, empresas, fechas— **viaja tal cual** y puede identificar. Sin permiso, el análisis se intenta dentro de LinkVault (Ollama) o degrada a un análisis básico por reglas, sin sugerencias. |
| **Qué no promete el producto** | Anonimato; que el proveedor no use lo enviado (elegimos quien se compromete a no entrenar, pero **no podemos comprobarlo**); aviso en vivo por SSE del progreso del análisis (eso llega en `cv-suggestions-review`; aquí el SPA **sondea** `GET /api/links/:linkId/match`). |
| **Qué ve la persona** | Diálogo "Tu encaje…": no dispara nada al abrirse; badge, sugerencias con evidencia y copiar. En postulaciones, `fitScore` / `fitScoreDegraded` **derivados al leer** del último análisis; el informe no viaja con la postulación. |
| **Proveedores** | Ollama local y OpenRouter limitado a modelos `:free` con `data_collection: "deny"`. BYOK no entra aquí. |

Endpoints (sesión requerida, solo sobre links que la persona ve):

| Método y ruta | Respuesta |
| ------------- | --------- |
| `POST /api/links/:linkId/match` | `202` con el análisis en curso (o reutilización según reglas de cuota / degradado vigente). |
| `GET /api/links/:linkId/match` | `200` con bloques `latest?` y/o `running?` (paso, plazos, informe solo en `done`). |

### Probar el encaje en local (mock)

Con `AI_CHAIN=mock` y `AI_MOCK_MODE=replay`, consentimiento opcional según el caso, y un CV `extracted`:

```bash
T='Authorization: Bearer <accessToken>'
J='Content-Type: application/json'
LINK_ID=...

curl -s -H "$T" -H "$J" -X POST "http://localhost:3000/api/links/$LINK_ID/match" -d '{}'
curl -s -H "$T" "http://localhost:3000/api/links/$LINK_ID/match"
```

La pasada real contra OpenRouter (marcadores + `data_collection: deny`) es la **tarea 17.8** del change: puerta humana
documentada en el RUNBOOK; el change no se archiva sin ella.

## Calidad

```bash
pnpm nx affected -t lint,typecheck,test        # solo lo afectado respecto de main
pnpm nx run-many -t lint,typecheck,test,build  # todo el workspace
pnpm exec openspec validate --all              # specs y changes de OpenSpec
```

Los tests usan un MongoDB efímero en replica set (`mongodb-memory-server`, sin Docker) y fijan la IA en mock. La
primera ejecución descarga el binario de MongoDB, unos 600 MB en Windows. CI (`.github/workflows/ci.yml`) ejecuta lint →
validación de OpenSpec → typecheck → test → evaluación de IA en replay (`ai:eval-ci`, si `ai` está afectado) → build sobre
los proyectos afectados.

## Evaluación de IA

Los golden sets de las tareas evaluables viven en `libs/ai/src/evals/<task>/` (ADR-019).

```bash
pnpm nx run ai:eval --task=classify-skills --provider=mock                     # replay de fixtures contra la línea base
pnpm nx run ai:eval --task=classify-skills --provider=mock --update-baseline   # reescribe baseline.json a propósito
pnpm nx run ai:eval --task=classify-skills --provider=ollama --ollama-url=http://localhost:11434
pnpm nx run ai:eval-ci                                                          # todas las tareas en mock (CI)
pnpm nx run ai:record-fixtures --task=classify-skills --upstream=ollama --ollama-url=http://localhost:11434 --timeout-ms=300000
pnpm nx run ai:record-fixtures --from-pending --upstream=ollama --ollama-url=http://localhost:11434   # lo que anotaron los tests
pnpm nx run ai:record-fixtures --from-pending --task=extract-job --pending-file=tmp/ai-pending-fixtures.jsonl --upstream=ollama
```

- `--provider=mock` usa replay y falla (código 1) si una métrica bloqueante, el golden o la versión del prompt difieren de
  `baseline.json`, tanto si empeora como si mejora. Cambiar prompt, modelo o fixtures del golden exige `--update-baseline` en
  el mismo commit.
- Con proveedores reales (`ollama`, u `openrouter` solo con `--allow-external`) mide el modelo sin comparar con la línea base;
  los casos degradados cuentan en el reporte, que se escribe en `reports/eval/<task>/<proveedor>.md` (ignorado por git).
- `ai:record-fixtures` graba los fixtures que falten para los casos del golden (con `--overwrite`, también los existentes); un
  upstream externo exige `--allow-external`. `AI_MOCK_MODE` solo admite `replay` y `synth`.
- **Fixtures pendientes.** Cuando un test en replay pide una ejecución cuyo fixture no existe, `runTask` la anota en un
  registro JSONL (`tmp/ai-pending-fixtures.jsonl` por defecto, o `AI_PENDING_FIXTURES_FILE`) con su tarea, su versión de
  prompt, su idioma de salida y la clave que falta. Solo se escribe **durante los tests**, nunca en producción, y un test
  que espera la ausencia del fixture lo apaga con `AI_PENDING_FIXTURES=off`.
  `ai:record-fixtures --from-pending` graba esas entradas en vez de los casos del golden: acepta `--task` para filtrar y
  `--pending-file` para leer otro registro (ese flag **solo** vale con `--from-pending`). El registro es append-only y se
  deduplica al consumirlo, así que varios archivos de test anotando a la vez no se pisan. Lo que no se puede grabar —una
  entrada de una tarea `personal`, que nunca lleva su texto, o una que quedó obsoleta— se lista con su motivo y no hace
  fallar el comando.
- Ollama: con la app de escritorio basta `http://localhost:11434`; si ese puerto está ocupado, levanta el contenedor del perfil
  `ai-local` con `OLLAMA_PORT=11435` y usa `--ollama-url=http://localhost:11435`.

## Estructura

| Ruta                    | Qué es                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/api`              | API HTTP (NestJS + Fastify). Rutas bajo `/api`; `/health` y `/health/live` fuera del prefijo. Ejecuta IA.      |
| `apps/worker`           | Procesos en segundo plano (NestJS + BullMQ): consume `enrich-link`; solo expone salud en `WORKER_HEALTH_PORT`. |
| `apps/web`              | SPA Angular 22 standalone y zoneless, con Material, Tailwind e i18n ES/EN.                                     |
| `libs/shared`           | Contratos compartidos entre plataformas: schemas zod, enums y eventos de integración.                          |
| `libs/ai`               | Módulo de IA (ADR-014): ports, tareas y errores; los SDKs de proveedores solo en `infrastructure/providers`.   |
| `tools/test-env`        | Preset de Vitest con las variables de IA en mock (todas las plataformas).                                      |
| `tools/testing`         | Preset de Vitest para Node con MongoDB efímero, doble de Redis y suite de contrato de salud.                   |
| `tools/workspace-rules` | Test tabular que comprueba las reglas de lint del workspace.                                                   |
| `openspec/`             | Specs y changes de OpenSpec.                                                                                   |
| `docs/`                 | Diseño, ADRs y runbook.                                                                                        |

Los límites entre proyectos (tags `scope:*`, `type:*`, `platform:*`), la capa de dominio, los SDKs de IA, `any` y
`console` se comprueban con lint (`eslint.config.mjs`).

## Problemas conocidos en Windows

- **`nx` colgado sin salida.** No canalices la salida de `nx` por un pipe (`pnpm nx ... | tail`). Si ese comando
  arranca el daemon de Nx, el daemon hereda el handle del pipe y quien lee nunca recibe EOF. Redirige la salida a un
  archivo (`pnpm nx run-many -t test > test.log 2>&1`) o desactiva el daemon (`NX_DAEMON=false`). Si el daemon queda
  deshabilitado ("Nx Daemon is going to be disabled until you run nx reset"), ejecuta `pnpm nx reset`.
- **Finales de línea.** El repo fuerza LF (`.gitattributes` con `* text=auto eol=lf`, Prettier con `endOfLine: lf`).
  Con `core.autocrlf=true` un script con CRLF falla con `bad interpreter`. Si ves CRLF en el disco, con el árbol
  limpio ejecuta `git add --renormalize .` (corrige el índice) y después `git checkout -- .` (reescribe los archivos).

## Salida a Turborepo

[ADR-011](docs/adr/ADR-011.md) eligió Nx con reservas y deja documentada la salida. Pasar a Turborepo supondría:

- un `package.json` con scripts por proyecto;
- un `turbo.json` con el pipeline `lint`, `typecheck`, `test` y `build`;
- sustituir `nx affected` por los filtros de Turborepo (`--filter=...[origin/main]`).

Se perderían los generadores oficiales de Nest y Angular, los targets inferidos por plugins y
`@nx/enforce-module-boundaries`, que habría que reemplazar por otra herramienta de límites (por ejemplo
`eslint-plugin-boundaries` o `dependency-cruiser`). La caché local de tareas tiene equivalente en Turborepo, y la
caché remota es opcional en ambos.
