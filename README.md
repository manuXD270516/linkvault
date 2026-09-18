# LinkVault

Monorepo Nx (pnpm) con `api` (NestJS + Fastify), `worker` (NestJS + BullMQ), `web` (Angular 22 zoneless) y las
librerías `shared` y `ai`. En desarrollo, Docker solo levanta la infraestructura (MongoDB, Redis, MinIO) y las apps
corren en el host ([ADR-017](docs/adr/ADR-017.md)).

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
docker compose up -d --wait        # mongo (replica set rs0), redis y minio, esperando a que estén sanos
```

Si ya tenías un `.env` de antes del enriquecimiento de links, cópiale de `.env.example` las variables `ENRICH_*` y `S3_*`:
son obligatorias y **el worker no arranca sin ellas** (ver [Variables del enriquecimiento](#variables-del-enriquecimiento)).
Si es de antes de pegar descripciones, cópiale además `PASTE_EXTRACTION_TIMEOUT_MS` y la sección `--- IA ---` entera:
**`api` ya no arranca sin ellas** (ver [La IA que ejecuta `api`](#la-ia-que-ejecuta-api)).

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

### MongoDB

MongoDB corre siempre como replica set de un nodo (`rs0`). Su healthcheck lo inicializa en el primer arranque, y el
contenedor no pasa a sano hasta que hay primario.

| Desde                              | URI                                                         |
| ---------------------------------- | ----------------------------------------------------------- |
| El host (apps con `nx serve`)      | `mongodb://localhost:27017/linkvault?directConnection=true` |
| Un contenedor de la red de compose | `mongodb://mongo:27017/linkvault?replicaSet=rs0`            |

Desde el host hace falta `directConnection=true`: el replica set anuncia `mongo:27017`, que el host no resuelve.

### Puertos ocupados por otro proyecto

Los puertos publicados en el host se configuran con `MONGO_PORT`, `REDIS_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT` y
`OLLAMA_PORT`. Docker Compose los lee del `.env`. Si otro proyecto ya usa el 6379, por ejemplo, pon en tu `.env`:

```dotenv
REDIS_PORT=6380
REDIS_URL=redis://localhost:6380
```

La URL de la app (`REDIS_URL`, `MONGO_URI`) debe apuntar al mismo puerto que publicas.

## Autenticación

Cuentas con email y contraseña (Argon2id) y sesión según [ADR-012](docs/adr/ADR-012.md) y
[ADR-020](docs/adr/ADR-020.md). No hay verificación de email ni recuperación de contraseña: llegan en un change posterior
(`auth-email-recovery` en `openspec-changes.yaml`).

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

Perfil propio: `GET /api/users/me` y `PATCH /api/users/me` (`displayName`, `aiConsent.externalProviders`, `outputLanguage`,
`redactName`). El SPA solo muestra el email, el nombre y el cambio de contraseña; los controles de IA llegan con
`cv-match-suggestions`.

**Protecciones.** Todo `POST /api/auth/*` exige la cabecera `X-Requested-With: linkvault` (si falta, `403`) y, si lleva
cuerpo, `Content-Type: application/json` (si no, `415`). Los intentos se cuentan en Redis por ventanas fijas de 15 minutos:
5 fallos por email (exista o no la cuenta), 50 logins fallidos por IP y 10 registros por IP; al superarlos la API responde
`429 too_many_attempts` con `Retry-After`. Si Redis no responde, las peticiones pasan sin límite y la API registra un aviso.

### Rutas del SPA

| Ruta        | Acceso     | Contenido                                                            |
| ----------- | ---------- | -------------------------------------------------------------------- |
| `/login`    | Sin sesión | Login. Con sesión redirige a `/grupos`.                              |
| `/registro` | Sin sesión | Registro. Con sesión redirige a `/grupos`.                           |
| `/`         | Con sesión | Redirige a `/grupos`, la pantalla de inicio (ver [Grupos](#grupos)). |
| `/perfil`   | Con sesión | Email (solo lectura), nombre y cambio de contraseña.                 |

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

El secreto firma los access tokens y las claves de los contadores de intentos: cambiarlo invalida los access tokens emitidos
y reinicia esos contadores. En producción usa un valor propio, por ejemplo 48 bytes aleatorios en base64url.

### Probar en local

Con la infraestructura y las apps en marcha (ver [Puesta en marcha](#puesta-en-marcha)), abre http://localhost:4200: el
proxy de `web` reenvía `/api` a la API en el mismo origen, así que la cookie funciona sin CORS. Crea una cuenta en
`/registro`, recarga en `/perfil` para comprobar que la sesión se restaura y cierra sesión desde la barra.

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

La lista ordena por `joinedAt` descendente y descarta las membresías cuyo grupo ya no existe. `memberCount` sale de una
sola agregación, no de un conteo por grupo.

**Privacidad.** Quien no es miembro no distingue un grupo ajeno de uno inexistente: el grupo ajeno, un id que no existe y
un id con otro formato responden `404 group_not_found` con el mismo cuerpo. Un miembro que no es owner ya sabe que el
grupo existe, así que las acciones de owner le responden `403 forbidden`. La lista de miembros muestra el nombre visible
de cada uno, nunca el email ni ningún otro dato de contacto.

Códigos de error propios: `group_not_found` (404), `invalid_invite_code` (404), `member_not_found` (404), `forbidden`
(403), `group_full` (409), `too_many_groups` (409) y `owner_cannot_leave` (409).

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

Son límites antiabuso, no invariantes: dos uniones simultáneas pueden dejar un grupo con 51 miembros. Lo que sí impide el
índice único `(groupId, userId)` es una membresía duplicada.

### Roles

El creador es `owner` y cada grupo tiene exactamente una membresía `owner`; no hay campo `ownerId`, la propiedad vive solo
en la membresía. El owner renombra, regenera el código, expulsa y borra el grupo; un miembro solo puede salir. El owner no
puede salir ni ser expulsado: todavía no hay transferencia de propiedad, así que quien quiere irse borra el grupo, y
borrarlo se lleva por delante los links que los demás compartieron allí (la confirmación del SPA dice cuántas ofertas se
pierden). La transferencia es la primera tarea de `applications-tracking`.

### Rutas del SPA

| Ruta          | Contenido                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/grupos`     | Pantalla de inicio: grupos con su rol y su número de miembros, o el estado vacío con crear y unirse.                                                                                      |
| `/grupos/:id` | Detalle: miembros con fecha de alta y los links del grupo (ver [Links](#links)); el owner ve el código, copia la invitación, renombra, regenera, expulsa y borra; el miembro puede salir. |
| `/unirse`     | Formulario de unirse. `?codigo=<código>` lo abre con el código escrito y lo quita de la URL al leerlo.                                                                                    |

`/` redirige a `/grupos`. Las tres exigen sesión: desde el enlace de invitación sin sesión, el código vuelve tras el login
o el registro. La confirmación de borrado dice a cuántos miembros afecta y cuántas ofertas se pierden.

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

`POST /api/links` y `POST /api/links/import` aceptan `groupId`: con él el link se comparte en ese grupo; sin él queda en
la lista privada de quien lo guarda. Compartir en un grupo **no** crea además entrada privada (ADR-021 §5).

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
[Enriquecimiento de ofertas](#enriquecimiento-de-ofertas), y los del pegado —`not_a_job_posting` (422),
`extraction_unavailable` (503) y `ai_quota_exceeded` (429)— en [Pegar la descripción](#pegar-la-descripción).

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
  equivalente); si no, fallaría al primer pegado.
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
- Pegar no borra el motivo `robots_disallowed` o `blocked`: la tarjeta queda completa, pero no vuelve a ofrecer un
  reintento que el sitio ya negó.

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
