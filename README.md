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
Un worker compilado que no arranque desde la raíz del workspace necesita `AI_PROMPTS_DIR=dist/apps/worker/assets/ai/prompts` (o la ruta absoluta equivalente).

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
modalidad) llega con el change `link-enrichment`: hoy todo link nace `pending` y el SPA lo muestra como "Sin vista previa
todavía".

### Endpoints

Todas las rutas exigen access token (`Authorization: Bearer`); sin él responden `401 unauthorized`.

| Método y ruta                          | Quién             | Respuesta                                                                          |
| -------------------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `POST /api/links`                      | cualquier usuario | `201` con el link, `created`, `shared`, `sharedBy?` y `alreadyInGroups`.           |
| `POST /api/links/import`               | cualquier usuario | `201` con el resumen de la importación y los links guardados.                      |
| `GET /api/links/mine`                  | cualquier usuario | `200` con su lista privada: `items`, `total` y `nextCursor`.                       |
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
`forbidden` (403). Un cursor manipulado responde `400 validation_error` nombrando `cursor`.

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

Todavía no hay límite de llamadas a `POST /api/links/import`: llega con `link-enrichment`, que es cuando cada importación
pasa a encolar trabajo real (anotado en `openspec-changes.yaml`).

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
- **Nadie consume `enrich-link` todavía**, a propósito: los jobs esperan en la cola hasta que llegue el consumidor de
  `link-enrichment` y el link sigue `pending`. La retención olvida un job completado al día (o a los 1000) y uno fallido a
  la semana, así que ese consumidor tendrá que ser idempotente por sí mismo y no solo por el `jobId`.
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
se ofrece a quien lo compartió y al owner del grupo.

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
```

Con el relay encendido y Redis arriba, el job queda esperando a que exista un consumidor:

```bash
docker compose exec redis redis-cli keys 'bull:enrich-link:*'
```

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
```

- `--provider=mock` usa replay y falla (código 1) si una métrica bloqueante, el golden o la versión del prompt difieren de
  `baseline.json`, tanto si empeora como si mejora. Cambiar prompt, modelo o fixtures del golden exige `--update-baseline` en
  el mismo commit.
- Con proveedores reales (`ollama`, u `openrouter` solo con `--allow-external`) mide el modelo sin comparar con la línea base;
  los casos degradados cuentan en el reporte, que se escribe en `reports/eval/<task>/<proveedor>.md` (ignorado por git).
- `ai:record-fixtures` graba los fixtures que falten para los casos del golden (con `--overwrite`, también los existentes); un
  upstream externo exige `--allow-external`. `AI_MOCK_MODE` solo admite `replay` y `synth`.
- Ollama: con la app de escritorio basta `http://localhost:11434`; si ese puerto está ocupado, levanta el contenedor del perfil
  `ai-local` con `OLLAMA_PORT=11435` y usa `--ollama-url=http://localhost:11435`.

## Estructura

| Ruta                    | Qué es                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/api`              | API HTTP (NestJS + Fastify). Rutas bajo `/api`; `/health` y `/health/live` fuera del prefijo.                |
| `apps/worker`           | Procesos en segundo plano (NestJS + BullMQ); solo expone salud en `WORKER_HEALTH_PORT`.                      |
| `apps/web`              | SPA Angular 22 standalone y zoneless, con Material, Tailwind e i18n ES/EN.                                   |
| `libs/shared`           | Contratos compartidos entre plataformas: schemas zod, enums y eventos de integración.                        |
| `libs/ai`               | Módulo de IA (ADR-014): ports, tareas y errores; los SDKs de proveedores solo en `infrastructure/providers`. |
| `tools/test-env`        | Preset de Vitest con las variables de IA en mock (todas las plataformas).                                    |
| `tools/testing`         | Preset de Vitest para Node con MongoDB efímero, doble de Redis y suite de contrato de salud.                 |
| `tools/workspace-rules` | Test tabular que comprueba las reglas de lint del workspace.                                                 |
| `openspec/`             | Specs y changes de OpenSpec.                                                                                 |
| `docs/`                 | Diseño, ADRs y runbook.                                                                                      |

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
