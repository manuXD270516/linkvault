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
([ADR-002](docs/adr/ADR-002.md)). Solo se entra con un código de invitación: no hay buscador ni directorio de grupos. Los
links llegan con el change `job-links`; hoy un grupo tiene nombre, miembros y código.

### Endpoints

Todas las rutas exigen access token (`Authorization: Bearer`); sin él responden `401 unauthorized`.

| Método y ruta                            | Quién             | Respuesta                                                                |
| ---------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `POST /api/groups`                       | cualquier usuario | `201` con el grupo nuevo, ya con `inviteCode`; `name` inválido, `400`.   |
| `GET /api/groups`                        | cualquier usuario | `200` con sus grupos (`role`, `memberCount`, `joinedAt`), sin el código. |
| `POST /api/groups/join`                  | cualquier usuario | `200` con el grupo al que entra; nunca devuelve el código.               |
| `GET /api/groups/:id`                    | miembro           | `200` con el detalle; `inviteCode` solo si es owner.                     |
| `PATCH /api/groups/:id`                  | owner             | `200` con el detalle renombrado.                                         |
| `DELETE /api/groups/:id`                 | owner             | `204`; borra el grupo y sus membresías en una transacción.               |
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
puede salir ni ser expulsado: todavía no hay transferencia de propiedad, así que quien quiere irse borra el grupo.

### Rutas del SPA

| Ruta          | Contenido                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/grupos`     | Pantalla de inicio: grupos con su rol y su número de miembros, o el estado vacío con crear y unirse.                                          |
| `/grupos/:id` | Detalle: miembros con fecha de alta; el owner ve el código, copia la invitación, renombra, regenera, expulsa y borra; el miembro puede salir. |
| `/unirse`     | Formulario de unirse. `?codigo=<código>` lo abre con el código escrito y lo quita de la URL al leerlo.                                        |

`/` redirige a `/grupos`. Las tres exigen sesión: desde el enlace de invitación sin sesión, el código vuelve tras el login
o el registro.

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
