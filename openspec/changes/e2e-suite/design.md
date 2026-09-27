## Context

Motivación en `proposal.md` §Why; la excepción a la precedencia de la fila 35 y las decisiones de fondo, en
**ADR-053**. Aquí, el estado de partida que condiciona el cómo:

- **Ya hay suite.** `apps/web-e2e` tiene quince specs (`auth`, `auth-email-recovery`, `groups`, `links`,
  `applications`, `comments`, `cv`, `match`, `byok`, `freshness`, `home`, `deploy-prod`, `notifications`,
  `public-share`, `search`) y dos helpers (`support/job-ids.ts`, `support/register-limit.ts`). El target `e2e` lo
  infiere `@nx/playwright/plugin` (`nx.json`); `playwright.config.mts` usa `nxE2EPreset`, que en CI pone `retries: 2` y
  `workers: 1`, y fija `trace: 'on-first-retry'`, así que **sin reintento no hay traza**. Hay un solo proyecto de
  navegador, `chromium` (`Desktop Chrome`).
- **Cómo arranca hoy.** El `webServer` de Playwright lanza `pnpm nx serve web` con `reuseExistingServer: true`; la `api`
  y el `worker` se levantan aparte, a mano. El 2026-09-19 otra sesión tenía `3000`/`3001`: los `nx serve` nuevos
  fallaron con `EADDRINUSE`, `/health` respondió `200` igualmente y el e2e **corrió contra código viejo** sin avisar.
- **Dependencias ocultas de los specs.** `links`, `match` y `freshness` escriben en Mongo (`MONGO_URI` o
  `localhost:27017`); `register-limit.ts` vacía contadores con `docker exec linkvault-redis-1`, un nombre de contenedor
  que solo existe con el proyecto de compose `linkvault`; `home` y `groups` llevan `http://localhost:4200` escrito a
  mano; `public-share` usa `LINKVAULT_API_ORIGIN` y dos `waitForTimeout(2000)`; `byok` tiene una rama que **se salta y
  pasa igual** según el `.env` (su cabecera explica cómo distinguirlo a mano); `match` depende del fixture escrito a
  mano `match-cv/ce41cbcd…` en replay. Casi todos llevan `test.setTimeout(…)` como techo; ninguno llama al
  `setTimeout` global.
- **CI no ejecuta Playwright** en ningún workflow. `cd-staging` y `cd-prod` verifican el artefacto con
  `infra/ci/verify-artifact.sh` sobre `docker-compose.prod.yml`, entrando por `docker compose exec`: ese compose no
  publica ningún puerto salvo los de Traefik, que exige `PUBLIC_HOST` y ACME.
- **Las imágenes hornean `NODE_ENV=production`**, y con él `parseAiConfig` **prohíbe** `AI_CHAIN=mock`
  (`infra/ci/verify.env`, comentario de `AI_CHAIN`).
- **35a cambia el arranque local.** En la rama `change/object-store`, «Infraestructura con un comando» pasa a
  `pnpm infra:up` = `docker compose up -d --wait` + `pnpm nx run api:object-store -- provision`, MinIO desaparece y el
  puerto del almacén pasa a `OBJECT_STORE_PORT` (sin consola). PR-1 de este change se fusiona **después** de 35a (D15),
  así que nace con ese comando.
- **Staging no existe** hasta 35b: `<ip>.sslip.io` con TLS de Let's Encrypt, correo real por Brevo (300 al día, sin
  dominio propio), IA real por OpenRouter `:free`, sin búsqueda, y un **plan de medición** con scripts `mongosh`
  (`staging-host` design D15 y D16). Desde este change, esos scripts excluyen **por `userId` en cada métrica** la lista
  «autor + cuentas E2E», que vive fuera del repositorio y se pasa a `run.sh` (Q1, trasladada a 35b; D10).
- **Registrar envía correo**: `register.usecase.ts` emite la verificación tras crear la cuenta. En staging, cada alta de
  prueba sería un correo real por Brevo. Y el registro está limitado a **10 intentos de registro cada 15 minutos por
  IP** (`REGISTRATIONS_PER_IP`, ADR-020): el limitador consume **antes** de crear la cuenta, así que un `409` (la
  cuenta ya existe) también cuenta, y el undécimo intento recibe `429`.
- **Minutos:** repositorio privado en el plan Free (2000 minutos al mes), compartidos con `ci`, `cd-staging` y la
  medición de `arm64` de 35a.

## Goals / Non-Goals

**Goals:**

- Un comando local = el comando de CI, con la pila aislada y apagada al final.
- Un perfil `remote` que se ensaya contra la pila local cuando se pide y contra staging sin cambiar las pruebas.
- El camino crítico cubierto de punta a punta, **en escritorio y en un móvil emulado**, con una **segunda persona** que
  se une al grupo con el enlace de invitación, y una corrida de `e2e-remote` en verde contra staging como
  **precondición de invitar** en 35b.

**Non-Goals:**

- Reescribir los specs existentes, limpiar sus orígenes o admitirlos: es del **lote 2** (D14).
- El mapa de cobertura contra el catálogo y su comprobación: pasan al **lote 2** (D14).
- Ejecutar la suite contra las imágenes del artefacto en local o en CI (D2).
- Tocar `ci.yml`, `cd-staging.yml`, `cd-prod.yml`, `docker-compose*.yml` o cualquier requirement que modifiquen 35a,
  35b o 35c (D16). Las únicas ediciones a otro change son las de Q1 y de la precondición de invitar en
  `staging-host`, decididas por el usuario, que llegan a `main` en un PR solo de spec (D16).
- Los helpers `local-only` (Mongo, Redis/`docker`, Mailpit) y su guardia: ninguna prueba del lote 1 los usa; entran
  con el lote 2 (D9).
- Un reporter propio de saltos: el lint en `error` sobre `test.skip` y la comprobación de pasos declarados del
  recorrido bastan para el lote 1 (D12).
- Disparar `e2e.yml` desde pull requests: hasta Q2, solo `workflow_dispatch` (D13).
- Ejecutar la suite automáticamente tras cada despliegue a staging (Q4).
- Probar la extensión del navegador, los crons o los CLI (catálogo 23, 36, 41-43, 45, 46): se decide en su lote.

## Decisions

### D1. Se parte de `apps/web-e2e`, y la suite reproducible es lo etiquetado `@lot1`

Se conserva el proyecto, su preset y sus specs. Lo que cambia es **qué se ejecuta de forma reproducible**: las pruebas
etiquetadas con su lote (`@lot1` en este change), y solo esas; el runner ejecuta `--grep @lot1`. Los specs no admitidos
siguen ejecutándose como hoy (`pnpm nx e2e web-e2e` contra la pila que cada cual tenga), documentados en
`apps/web-e2e/README.md` como **no reproducibles** hasta que su lote los admita, y **no se tocan** en este change salvo
las excepciones de lint de D12.

*Descartado:* admitir los quince specs de golpe. Cada uno arrastra supuestos de entorno distintos (flags, Meilisearch,
`AI_VAULT_KEY`, Mongo, Redis); meterlos sin adaptarlos convertiría la primera corrida de CI en un rojo que nadie sabría
leer, que es el defecto que ADR-048 persigue.

### D2. Contra el código servido con `nx serve`, no contra las imágenes del artefacto

El comando local y CI sirven `api` y `worker` con `nx serve` desde el checkout, y `web` con `nx serve web -c production`
(el bundle de producción, servido por el servidor de desarrollo con el proxy de la suite), sobre la infraestructura de
`docker-compose.yml`. Las **imágenes del artefacto** las prueba la suite **solo en staging**, con el perfil `remote`.

Por qué no las imágenes en local y en CI, con los tres motivos comprobados en el repositorio:

1. **La IA no puede ser determinista con ellas.** Hornean `NODE_ENV=production` y `parseAiConfig` rechaza `mock` en
   producción: el encaje del camino crítico dependería de un proveedor real o de la degradación, nunca del replay que
   CLAUDE.md exige en CI.
2. **No se pueden alcanzar sin cambiar su configuración.** `docker-compose.prod.yml` no publica puertos y el enrutado
   `/api` → `api`, resto → `web` vive en Traefik, que exige `PUBLIC_HOST` y ACME. Hacerlo accesible exigiría un compose
   superpuesto para CI, justo lo que ADR-048 §4 rechazó («un compose escrito para CI verifica una configuración que
   nadie ejecuta»).
3. **Las pruebas `local` necesitan escribir precondiciones y leer correo.** En `docker-compose.prod.yml` Mongo está en
   una red `internal` sin salida, y **no hay Mailpit**: el correo sale por el proveedor que declare `MAIL_PROVIDER`.

Lo que sí garantizan las imágenes ya está cubierto: arrancan y responden (`verify-artifact.sh`). **Queda sin probar
hasta PR-2** (staging), y así lo lista ADR-053 §Riesgos: el bundle de producción servido por nginx con el fallback del
SPA, el enrutado `/api` de Traefik y las cookies `Secure` bajo HTTPS.

*Descartado también:* ejecutar Playwright en un contenedor dentro de la red de producción (sigue sin enrutado y sin
mock), y servir `dist/` con `node` (sería una tercera forma de arrancar la aplicación que no usa nadie).

### D3. Un runner, dos llamadores

`apps/web-e2e/scripts/e2e-stack.ts`, ejecutado con `node --import tsx` desde dos targets de Nx sin caché:

| Target | Qué hace |
|---|---|
| `web-e2e:e2e-stack` | Monta la pila, ejecuta el perfil `local` y la apaga. Con **`--rehearse-remote`**, además, el **ensayo** del perfil `remote` contra la misma pila. Es el comando local y el de CI. |
| `web-e2e:e2e-remote` | No monta nada: ejecuta el perfil `remote` contra el origen de `--base-url`. Falla si falta el origen o las credenciales. |

El ensayo remoto **no** corre en cada `e2e-stack`: solo con `--rehearse-remote`, en la corrida de verificación de sus
tareas (grupo 4 y 5.9) y cuando alguien cambie el perfil `remote`. Así no duplica los minutos de CI. Para la admisión
del ensayo sin gastar los intentos de registro de `local` (D5), `--rehearse-remote --skip-local` ejecuta solo el
ensayo.

**Entradas del runner: solo flags, no el entorno.** El runner se lanza con `pnpm nx run …`, y Nx carga el `.env` de la
raíz en el entorno de la tarea antes de ejecutarla: cualquier variable que el runner leyera del entorno podría venir
del `.env` de quien ejecuta. Por eso las anulaciones se aceptan **solo como flags** —`--web-port`, `--api-port`,
`--worker-port`, `--mongo-port`, `--redis-port`, `--object-store-port`, `--mailpit-smtp-port`, `--mailpit-ui-port`
(D4), `--base-url`, `--api-origin`, `--match-expectation` y `--stack-fault`— y el runner **no lee** `E2E_*_PORT`,
`E2E_BASE_URL`, `E2E_API_ORIGIN`, `E2E_MATCH_EXPECTATION` ni `E2E_STACK_FAULT` de su entorno. Las variables con esos
nombres existen solo **del runner hacia Playwright**, que las recibe de él con la lista blanca de D6. **Única
excepción, las credenciales** de la cuenta remota: son secretos y en un flag quedarían en la lista de procesos, así
que se leen del entorno, y son **solo dos**: `E2E_REMOTE_EMAIL` y `E2E_REMOTE_PASSWORD` (ninguna otra entrada del
runner sale de su entorno). El runner **falla** si cualquiera de las dos aparece en **alguno** de los `.env*` que Nx
cargaría en la tarea —los de la raíz y los de `apps/web-e2e/`, salvo `.env.example`— («pásala en el entorno de la
sesión, no en un `.env`»). El README enseña a ponerlas en la sesión sin dejarlas en el historial: `Read-Host
-AsSecureString` en PowerShell y `read -s` en bash, nunca un `export` con el valor escrito. En el ensayo, las
credenciales de la cuenta del ensayo salen de `e2e.env`, no del entorno. En CI, los secretos `E2E_STAGING_EMAIL` y
`E2E_STAGING_PASSWORD` llegan al paso por `env:` con esos dos nombres, y los valores del evento, al runner como
`--base-url "$E2E_BASE_URL"`, nunca interpolados en `run:`.

Fases de `e2e-stack`, cada una con su nombre en el mensaje de fallo:

1. **Comprobación previa**, sin arrancar nada:
   - Docker responde y los navegadores de Playwright están instalados;
   - **cada** puerto del bloque (D4) está libre **por dos vías**: nadie acepta una conexión en `127.0.0.1` ni en
     `::1`, y el runner puede hacer `bind` (en Windows un `bind` a todas las interfaces puede prosperar con otro proceso
     escuchando solo en `127.0.0.1`, y las conexiones a `localhost` irían a ese otro);
   - **ningún `serve` de `api` o `worker` del mismo checkout** está vivo: se buscan procesos cuya línea de comando
     contenga `<ruta del workspace>\node_modules\` (con el separador final, para que el checkout principal no case con
     un worktree anidado bajo él, como `.claude/worktrees/…`) y `serve` (`Get-CimInstance Win32_Process` en Windows,
     `ps -eo pid,args` en Linux), y se falla nombrándolos (PID y línea). La comparación **no distingue mayúsculas en
     `win32`** y acepta los dos separadores. Compilan en el mismo `dist/apps/<app>`, y el `serve` del runner cambiaría el
     código bajo el de desarrollo o al revés; un `serve` de **otro** worktree tiene su propio `dist/` y **no** bloquea.
     `web` no cuenta: su servidor compila en memoria.
2. **Infraestructura**: el comando de arranque de `platform/local-environment`, que tras 35a es `pnpm infra:up`, con
   `COMPOSE_PROJECT_NAME=linkvault-e2e-<hash8>` (D4) y el fichero de entorno de la suite (`--env-file
   apps/web-e2e/e2e.env`, o `COMPOSE_ENV_FILES` con el mismo valor cuando la orden la compone `pnpm infra:up`), de modo
   que compose no lea el `.env` de la raíz. El runner **no nombra el almacén de objetos**: levanta lo que el compose
   levante sin perfiles y lo aprovisiona con la orden de 35a. Tras el `up`, `docker compose ps --format json` y
   **fallo** si algún puerto publicado del proyecto queda fuera del bloque.
3. **Aplicaciones**: `nx serve api` y `nx serve worker` con `--watch=false` e **`--inspect=false`**: `@nx/js:node`
   23.2.1 abre por defecto el inspector en `9229`, fuera del bloque y sin guardia. Solo con `--stack-fault=inspect` se
   lanzan con `--inspect=inspect --port=<su puerto de inspector del bloque>` (D4), para leer su entorno efectivo en la
   tarea 2.4c. `nx serve web -c production`, en el puerto
   del bloque con una configuración de proxy propia de la suite que reenvía `/api` a la `api` del bloque. Entorno de
   cada proceso: D6 (lista blanca + `e2e.env`, `NX_LOAD_DOT_ENV_FILES=false`, `NX_DAEMON=false`). La salida de cada uno
   va a `dist/.playwright/apps/web-e2e/stack-logs/<app>.log`. Se esperan: `api` y `worker` por `/health` con mongo y
   redis en `up`; `web`, por el documento con `<lv-root`. **Después**, el runner comprueba que el proceso que escucha en
   el puerto de cada aplicación **pertenece al árbol que lanzó** (`Get-NetTCPConnection -LocalPort` en Windows,
   `ss -ltnp` en Linux) y falla nombrando el puerto y el PID ajeno si no es así. Se comprueban **todas** las filas de
   escucha de cada puerto, no la primera: Windows admite a la vez un proceso en `127.0.0.1` y otro en `0.0.0.0` o `::`.
   Una fila **sin PID** (`ss` no lo muestra para procesos de otro usuario o sin permisos) **cuenta como ajena**. La
   decisión es una función pura, `evaluateListeners(rows, ownPids)`, con `ownPids` = el árbol lanzado **sin** el PID
   del propio runner: falla ante cualquier fila ajena, sin PID o del runner (Vitest de la tarea 2.6b). Los
   puertos de la infraestructura los publica Docker, no el árbol lanzado: para ellos vale la comprobación de la fase 2.
4. **Siembra** (solo con `--rehearse-remote`): la cuenta de prueba del ensayo remoto, **por la API pública**
   (`POST /api/auth/register`), nunca por Mongo, igual que la creará el autor en staging.
5. **Suite**: Playwright con el perfil `local`. Con `--rehearse-remote`, después, el **ensayo**: el runner reinicia
   **solo** `worker` con `AI_CHAIN=openrouter`, una clave falsa, `OPENROUTER_MODEL=<modelo>:free` (`parseOpenRouter`
   lo exige cuando la cadena incluye `openrouter`; vale el de los tests, `cohere/north-mini-code:free`),
   `OPENROUTER_BASE_URL=https://ai.invalid` y `NODE_ENV=development`, espera su `/health` y el guardia de PID, y ejecuta
   el perfil `remote` con `E2E_MATCH_EXPECTATION=consent-required` (D7).
6. **Apagado**, siempre (`finally` y manejadores de `SIGINT`/`SIGTERM`): el árbol de cada proceso lanzado (en Windows,
   `taskkill /T /F` por el PID raíz; en Linux, el grupo de procesos) y `docker compose -p <proyecto> down -v
   --remove-orphans`. Solo lo que la corrida lanzó: nunca se mata por nombre de imagen ni por puerto. Al terminar,
   **vuelve a probar el bloque** (conexión y `bind`, como en la fase 1) y falla nombrando el puerto que siga ocupado.

Mientras dura la corrida, si un proceso lanzado **termina** o su log contiene `EADDRINUSE`, la corrida falla
nombrándolo, aunque el puerto responda.

**Falsación.** Los guardias que dependen de una carrera (un proceso ajeno que aparece tras la comprobación previa, un
proceso que el apagado no mata) se provocan con un flag de prueba, `--stack-fault`, que el runner usa solo para eso y
anuncia en su salida cuando está presente (valores en las tareas 2.4c, 2.6b y 2.7). Sin él, el runner no tiene ningún
camino distinto. El oyente de `listen-after-preflight` vive en un **proceso hijo que el runner no registra en el árbol
lanzado** (y que mata aparte al apagar): si lo abriera un hijo registrado, el guardia de PID lo daría por propio y el
fallo no probaría nada.

### D4. Un bloque de puertos propio, un proyecto de compose por checkout y bloque

| Servicio | Desarrollo | Suite (por defecto) | Variable del compose | Anulación (flag, D3) |
|---|---|---|---|---|
| `web` | 4200 | 4300 | — | `--web-port` |
| `api` | 3000 | 3100 | — | `--api-port` |
| `worker` (salud) | 3001 | 3101 | — | `--worker-port` |
| Mongo | 27017 | 27117 | `MONGO_PORT` | `--mongo-port` |
| Redis | 6379 | 6479 | `REDIS_PORT` | `--redis-port` |
| Almacén S3 (35a) | 9000 | 9100 | `OBJECT_STORE_PORT` | `--object-store-port` |
| MinIO, **solo antes de 35a** (API / consola) | 9000 / 9001 | 9100 / 9101 | `MINIO_PORT`, `MINIO_CONSOLE_PORT` | `--object-store-port` (la consola, +1) |
| Mailpit (SMTP / UI y API) | 1025 / 8025 | 1125 / 8125 | `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT` | `--mailpit-smtp-port`, `--mailpit-ui-port` |
| Inspector de `api` / `worker` (solo con `--stack-fault=inspect`, D3) | 9229 (por defecto de `@nx/js:node`) | 9329 / 9330 | — | — |

Los dos puertos de inspector son del bloque aunque solo se usen con ese fallo: entran en la comprobación previa y en la
re-prueba tras apagar. El bloque por defecto vive en `e2e.env`; una anulación por flag lo desplaza, y el runner recalcula a partir del bloque
efectivo las URIs (`MONGO_URI`, `REDIS_URL`, `S3_ENDPOINT`…). **Mientras la función de arranque (tarea 1.2) use el
compose anterior a 35a**, `e2e.env` lleva además `MINIO_PORT=9100`, `MINIO_CONSOLE_PORT=9101` y `S3_ENDPOINT` hacia
`9100`: sin ellos, el MinIO de ese compose publicaría `9000`/`9001`, fuera del bloque, y la fase 2 fallaría. La tarea
7.9 los retira al pasar a `pnpm infra:up` y lo comprueba.

**Nombre del proyecto de compose:** `linkvault-e2e-<hash8>`, donde `hash8` son los ocho primeros caracteres hex del
SHA-256 de «ruta absoluta del checkout + bloque efectivo». La ruta se **normaliza** antes del hash (letra de unidad en
minúscula, barras `/` y sin separador final), para que `D:\projects\…`, `d:/projects/…` y `d:\projects\…\` den el
mismo nombre; la normalización es una función pura con su Vitest (tarea 2.3a). Se pasa por
`COMPOSE_PROJECT_NAME` y el runner lo imprime al empezar. Dos checkouts no comparten contenedores ni volúmenes; un
`down -v` de uno no toca al otro.

`reuseExistingServer` desaparece del camino del runner: cuando el runner le pasa `E2E_BASE_URL`,
`playwright.config.mts` no declara `webServer`. El camino antiguo (`nx e2e web-e2e` sin variables) conserva su comportamiento, documentado como no
reproducible (D1). Así la pila de desarrollo y la suite pueden convivir, y otra sesión con `3000` ocupado ya no cambia el
código que se prueba.

### D5. Datos por prueba sobre una pila desechable; la demo no es dato de la suite

Cada corrida parte de volúmenes nuevos (`down -v` al final y proyecto propio). Cada prueba crea lo suyo con
identificadores únicos por corrida (el patrón `RUN_ID` y `support/job-ids.ts` que ya existe). La demo
(`api:seed-demo`, Ana, Bob y `SEEDD3M2`) **no** se usa: es estado compartido y mutable —el catálogo cambia la contraseña
de Ana en la recuperación—, y una prueba que la toca haría depender a las demás del orden.

**Presupuesto de intentos de registro** (10 cada 15 minutos por IP, y toda la corrida sale de la misma IP). Se cuentan
**intentos**, no altas: el limitador consume antes de crear la cuenta, así que un `409` y la siembra que hace «alta; si
existe, login» (tarea 4.1) consumen igual que una alta nueva.

| Corrida | Intentos de registro |
|---|---|
| `e2e-stack` normal: perfil `local`, proyectos `chromium` y `mobile`, dos personas cada uno | 4 |
| `e2e-stack --rehearse-remote`: lo anterior + el intento de la siembra | 5 |
| Admisión de `local` en **un** proyecto, `--repeat-each=5` (una invocación por proyecto, pila nueva) | 10, **justo el límite** |
| Admisión del ensayo en un proyecto (`--rehearse-remote --skip-local`) | 1 |

La admisión de `local` no tiene margen: si un lote añade un intento de registro al recorrido, la admisión cae con el
`429` del producto, nombrado en el informe, y ese lote decide cómo repartirlo. `register-limit.ts` no lo usa ninguna
prueba admitida.

### D6. El entorno de la suite está versionado y es el único que llega a las aplicaciones

`apps/web-e2e/e2e.env`, sin secretos y con la cabecera «esto no es un fichero de despliegue» de `infra/ci/verify.env`.
El runner **no hereda su entorno** a los procesos que lanza (aplicaciones, `docker compose`, `pnpm infra:up` y
Playwright): cada uno recibe una **lista blanca** de variables del
sistema (`PATH`/`Path`, `PATHEXT`, `SystemRoot`, `windir`, `ComSpec`, `HOME`, `USERPROFILE`, `APPDATA`,
`LOCALAPPDATA`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `CI`), las de `e2e.env` y tres de control:
`NX_LOAD_DOT_ENV_FILES=false` (Nx no carga ningún `.env`), `NX_DAEMON=false` (en Windows, Nx con daemon se cuelga con la
salida por tubería) y `COMPOSE_PROJECT_NAME`. Compose recibe `e2e.env` como fichero de entorno (D3, fase 2). Lo
esencial de `e2e.env`:

- `AI_CHAIN=mock`, `AI_MOCK_MODE=replay`, `AI_EMBED_CHAIN=mock` (D7);
- `MAIL_PROVIDER=smtp` hacia el Mailpit del bloque (D8);
- las variables de interpolación del compose con el bloque (D4) y `MONGO_URI`, `REDIS_URL`, `S3_*`, `API_PORT`,
  `WORKER_HEALTH_PORT`, `WEB_BASE_URL` y `PUBLIC_PAGE_BASE_URL` apuntando al bloque;
- las credenciales de la cuenta del ensayo remoto, con alias `+e2e` (D10);
- flags de producto apagados (`FEATURE_SEARCH`, `FEATURE_DISCOVERY`, `FEATURE_LINK_FRESHNESS`, `FEATURE_GROUP_DIGEST`,
  `FEATURE_HEADLESS_EXTRACTION`): ninguna prueba del lote 1 los necesita. Un lote que admita una prueba con flag lo
  enciende aquí.

Que el `.env` no se filtra **no se supone**: se comprueba con un canario que está en el `.env` y no en `e2e.env`, con
una variable de interpolación del compose que el `.env` cambia (`MONGO_PORT=27999`: el `config` de compose tiene que
seguir mostrando `27117`), y leyendo el entorno efectivo de los procesos `api` **y** `worker` por su inspector (tareas
2.4b y 2.4c). **Conjunto permitido** en ese entorno: la lista blanca ∪ las tres de control ∪ `e2e.env` ∪ las que añade
libuv al lanzar un proceso en Windows (`HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER`, `SYSTEMDRIVE`, `USERDOMAIN`,
`USERNAME`) ∪ `NX_*` ∪ `FORCE_COLOR` (∪ `npm_*` y `PNPM_*` solo si el proceso se lanza por pnpm); las entradas `=X:`
(el directorio actual por unidad que arrastra Windows) se ignoran. Cualquier otra clave es una fuga. El
propio runner sí recibe el `.env` (Nx lo carga antes de lanzarlo); por eso sus entradas son flags (D3).

### D7. IA: replay en local y en CI; en el ensayo y en staging, ninguna llamada

- **Local y CI:** replay. El `synth` que recomienda el catálogo es para recorrerlo **a mano** con datos propios; en la
  suite convertiría una entrada sin fixture en una salida inventada que pasa en local y falla en CI con
  `FixtureMissing`. El runner lo ignora.
- **El recorrido tiene sus propios fixtures escritos a mano**, porque no siembra nada en Mongo (D11): la entrada de
  `match-cv` es `{ job: { title, text, skills }, cv: { text } }` (`analyze-match.usecase.ts`), sin URL ni
  identificadores de corrida, así que con una oferta fija y un CV de líneas fijas la clave es estable. **La entrada se
  versiona junto a los fixtures**, en `libs/ai/src/infrastructure/fixture-inputs/critical-path.json` (oferta y texto del
  CV tal como lo extrae el worker, medido en 5.5a y 5.5b); la prueba genera el PDF desde esas líneas y rellena la oferta con
  esos campos. Qué tareas pide el recorrido (`match-cv`, `critique-suggestions`, `build-roadmap`) y sus claves **se
  miden ejecutando** (tareas 5.5a y 5.5b), no se suponen.
- **Un Vitest en `libs/ai`** (corre en `ci.yml` con `nx affected -t test`, sin tocar el workflow) calcula con la
  definición **actual** de cada tarea la clave de esa entrada y **exige** los fixtures de `match-cv`,
  `critique-suggestions` y `build-roadmap`, **o** que el de `match-cv` tenga `missingSkills: []` y 5.5a haya medido que
  entonces el recorrido no pide las otras dos. Así, cambiar un prompt o su versión rompe CI en el mismo commit, no la
  suite días después.
- **Ensayo remoto (pila local):** el runner reinicia solo `worker` con un proveedor externo configurado pero
  inalcanzable (`AI_CHAIN=openrouter`, clave falsa, `OPENROUTER_MODEL=<modelo>:free` —sin él `parseOpenRouter` no
  arranca—, `OPENROUTER_BASE_URL=https://ai.invalid`, `NODE_ENV=development`), y el ensayo afirma `consent-required`. La cuenta del ensayo no tiene permiso de IA externa, así
  que el análisis degrada **sin llamar a nadie**; si hubiera cualquier llamada, el motivo del análisis sería un error del
  proveedor, no `consent_required`, y la prueba fallaría. Es el mismo desenlace que en staging, ensayado de verdad.
- **Staging:** la IA es real y su cupo gratuito es pequeño y compartido con las personas invitadas. La cuenta de prueba
  **no tiene permiso de IA externa**, así que el análisis degrada por falta de permiso (`cv/match`, «Sin
  consentimiento y sin proveedor local»). Se afirma exactamente: marca de degradado y `consentRequired`.
- **`remote` afirma solo el desenlace que declara el destino** (`--match-expectation`, que el runner pasa a Playwright
  como `E2E_MATCH_EXPECTATION`: `replay-report` o `consent-required`); no se deduce en la prueba.

### D8. Correo: Mailpit en local y en CI; en staging, ninguno

El recorrido del lote 1 no lee correo. El helper que lo lea (lotes siguientes: verificación, recuperación, avisos)
consulta la API del Mailpit del bloque y está **prohibido en remoto** (D9). En staging la suite no envía correo: no
registra (D10) y la cuenta de prueba tiene el email **sin verificar**, así que los avisos de producto no le llegan.
Que el email está sin verificar lo comprueba el guardia por la API (D10), **no** el texto del aviso de la interfaz, que
35b cambia.

### D9. Perfiles y el guardia que los hace cumplir

| | `local` | `remote` |
|---|---|---|
| Pila | la arranca el runner | no la arranca nadie |
| Pruebas | `@lot1` | `@lot1` **y** `@remote-safe` |
| Escribir en Mongo / Redis, `docker` | sí | **prohibido** |
| Leer Mailpit | sí | **prohibido** |
| Afirmar salida concreta del mock | sí | **prohibido** |
| Cuentas | las registra cada prueba | declaradas por variables |
| Encaje esperado | `replay-report` | lo declara el destino |
| Origen de la API | configuración del runner | **siempre** `new URL('/api', E2E_BASE_URL)` |

**En el lote 1 no hay helpers `local-only`** (R-18 de la iteración 2): la única prueba admitida, el recorrido de D11,
no escribe en Mongo ni en Redis, no llama a `docker` ni lee Mailpit (todo por la interfaz, D11). El guardia que hace
cumplir las filas «prohibido» llega **con el lote 2**, el primero que admite pruebas que las necesitan (entrada
`e2e-suite-lot-2` de `openspec-changes.yaml`): los helpers de Mongo, Redis, `docker` y Mailpit vivirán en
`src/support/local-only/` y **lanzarán un error** si la prueba en curso lleva `@remote-safe`, **en cualquier perfil**,
para que una prueba que se declara apta para remoto y no lo es caiga ya en local y en CI. Ninguna prueba admitida lleva
un `localhost` escrito.

**Credenciales.** En `remote`, el origen de la API se deriva siempre del origen de la aplicación; si llega un origen de
API distinto (`--api-origin`, que el runner pasa como `E2E_API_ORIGIN`), el perfil **falla** antes de ejecutar nada. Las credenciales de la cuenta de prueba solo
viajan a ese origen. **El guardia evita accidentes, no autoriza**: quien puede lanzar el workflow o tiene las
credenciales puede usarlas donde quiera; lo que el guardia impide es mandarlas a otro origen por un error de
configuración.

*Descartado:* `--grep-invert` por etiquetas de capacidad (`@needs-db`…). Una prueba que olvida su etiqueta pasaría en
local y rompería contra staging.

### D10. Staging: cuentas declaradas, nada de altas, guardias antes de limpiar

Todo esto se especifica y se ensaya contra la pila local con `--rehearse-remote` (D3); contra staging, las tareas nacen
**bloqueadas por 35b**.

- **Sin altas en staging.** Cada alta envía un correo real por Brevo —con direcciones inventadas, un rebote que
  erosiona la reputación del remitente del que depende el umbral «bandeja de entrada en 2 de 3 proveedores» de 35b— y
  crea una cuenta que el recuento de cuentas no invitadas contaría. El paso de registro y la segunda persona se
  declaran «no aplicable» en `remote` y se cubren en local y en CI.
- **Cuentas de prueba persistentes**, creadas **a mano por el autor** una vez, con **alias `+e2e`** de un buzón suyo,
  el email **sin verificar** y **sin permiso de IA externa**. El lote 1 necesita una. Credenciales en secretos del
  repositorio (`E2E_STAGING_EMAIL`, `E2E_STAGING_PASSWORD`) y el origen en una variable (`E2E_STAGING_URL`). El prefijo
  `E2E_` los separa de los `STAGING_*` que lee el preflight de 35b.
- **Orden al empezar**: entrar → **guardias por la API** (`GET /api/users/me`: email sin verificar, permiso de IA
  externa apagado, email con `+e2e`) → **solo después**, limpieza de lo que quede de una corrida interrumpida (grupos
  con el prefijo de la suite, CV `e2e-*`, postulaciones sobre esos links). Un guardia que falla deja la cuenta como
  estaba: no se borra nada de una cuenta que no es la que se cree.
- **Grupo sin visibilidad pública**: el recorrido crea el grupo con la visibilidad pública por defecto **apagada**, para
  que nada de la suite quede enlazable desde fuera.
- **Limpieza al terminar**, también si falla: grupos, postulaciones y CV. Sin eso, la cuenta alcanzaría los límites del
  producto (20 grupos, 5 CV). **Lo que queda tras la limpieza** (no lo borra ninguna operación del producto que pueda
  invocar la cuenta): el link deduplicado global en dominio reservado, su preview y el historial de sus cambios, y los
  análisis de encaje ligados a la cuenta. Nada de eso cuenta en la medición, porque 35b excluye por `userId` a las
  cuentas E2E en cada métrica (Q1).
- **Links en dominios reservados** (`.invalid`): el worker de staging no pide nada a ninguna bolsa real desde la IP de
  Oracle; la oferta se completa a mano (D11).
- **Cupo del producto:** 10 análisis de encaje al día por persona (`AI_QUOTAS`). Una corrida remota en verde hace **dos**
  análisis (uno por proyecto: `chromium` y `mobile`); con `retries: 1`, cada prueba que falla y se reintenta gasta **un
  análisis más**. Así caben **cinco corridas en verde al día** por cuenta y, en el peor caso (los dos proyectos fallan y
  se reintentan, cuatro análisis por corrida), **dos**: la tercera recibe el `429` del producto, nombrado en el informe.
  Si el análisis degradado por falta de permiso consume cupo o no se mide en 9.4; si no lo consume, el límite no aplica.
  Regla de trabajo del grupo 9: **como mucho 5 corridas contra staging por día**, y las verificaciones 9.2-9.6
  repartidas en días distintos.
- **TLS sin excepciones**: nada de `ignoreHTTPSErrors`, comprobado con un `node -e` en la tarea 3.2; rechazar un
  certificado no confiable es el comportamiento por defecto de Playwright, no código de la suite. Mientras 35b emita
  contra el ACME de pruebas, la suite contra staging falla, y es correcto.
- **Días de medición:** la suite remota **no se lanza contra staging los días 7 y 14** de la medición de 35b (README y
  RUNBOOK, tarea 6.4 y 35b 10.2).
- **Medición de 35b (Q1, trasladada):** `measure.mongosh.js` y `uninvited.mongosh.js` excluyen **por `userId` en cada
  métrica** —users, groups, links, applications, cvs y analyses— la lista «autor + cuentas E2E», que vive **fuera del
  repositorio** y se pasa a `run.sh`; la línea base de 35b (10.6) **no borra** las cuentas `+e2e`. Está escrito en
  `staging-host` design D15/D16 y tareas 10.3, 10.6 y 10.7 desde este change, y llega a `main` en el PR solo de spec
  de D16.

### D11. El lote 1: el camino crítico, un recorrido con pasos declarados

`apps/web-e2e/src/critical-path.spec.ts`, una prueba con `test.step` por paso, etiquetas `@lot1 @critical-path
@remote-safe`, sin ninguna escritura en Mongo, en **dos proyectos**: `chromium` (`Desktop Chrome`) y `mobile`
(`devices['Pixel 7']`, Chromium), este último solo para este fichero. Persona **A** y, en `local`, persona **B** en un
contexto de navegador aparte con el mismo dispositivo del proyecto:

| # | Paso | `local` | `remote` | Catálogo |
|---|---|---|---|---|
| 0 | Entrar con la cuenta de prueba, guardias por la API, limpieza previa (D10) | — | sí | 3, 30 |
| 1 | A se registra y aterriza en `/grupos` | sí | **no aplicable** (D10) | 1 |
| 2 | A crea un grupo (visibilidad pública apagada); detalle con «Propietario» y código de invitación | sí | sí | 7 |
| 2b | A pulsa «Copiar invitación»; B, **sin sesión**, abre ese enlace (`/unirse?codigo=…`) → inicio de sesión con `returnUrl` → «Crear cuenta» → se registra, vuelve a `/unirse` con el código ya escrito, se une y aterriza en el detalle del grupo | sí | **no aplicable** (D10) | 1, 8 |
| 3 | Guardar en el grupo el link de una oferta en dominio reservado; la tarjeta aparece | A y B | A | 10 |
| 4 | Completar la oferta a mano con la entrada versionada (D7); «Escrito por …» | A y B | A | 14 |
| 5 | «Postulé» → «Hoy»; la tarjeta muestra la postulación y `/postulaciones` la tiene en «Postuladas» | A y B | A | 24, 26 |
| 6 | Subir el CV de líneas fijas generado en la prueba; «Listo · tu CV se leyó bien» | A y B | A | 29 |
| 7 | «Analizar mi encaje» → «Analizar»; resultado según `E2E_MATCH_EXPECTATION` | A y B, `replay-report` | A, el del destino | 31 |
| 8 | Limpieza de lo creado | sí | sí | — |

El paso 2b es el camino que seguirá una persona invitada en 35b: recibe el mensaje de «Copiar invitación», lo abre sin
cuenta y la crea desde el inicio de sesión. Los intentos de registro no cambian (uno por persona, D5). Cada persona guarda **su** link
(URL distinta con el `RUN_ID`) con la misma oferta fija, así que las dos piden la misma clave de replay. El perfil declara la lista de pasos (y de personas) que le tocan; al final, la prueba compara lo
ejecutado con la lista y falla nombrando el que falte o sobre. Así «no aplicable» es una declaración comprobada, no un
`if` que puede tragarse un paso.

Sincronización: cada paso arma **antes** de la acción la espera de la respuesta o de la navegación que provoca
(`waitForResponse`, `waitForURL`) y afirma con aserciones web-first; la lectura del CV y el análisis se esperan por su
estado visible, con el plazo máximo como techo, no como mecanismo.

**WebKit**, solo si la entrevista de 35b (su tarea 9.7) dice que algún invitado usa iPhone: un proyecto más para este
fichero, con su admisión (tarea 9.9, condicional).

### D12. Determinismo: ni esperas fijas ni reintentos que escondan

- **Lint.** En `apps/web-e2e/eslint.config.mjs`, `playwright/no-wait-for-timeout`, `playwright/no-wait-for-selector` y
  `playwright/no-skipped-test` pasan de `warn` a `error`, y `no-restricted-syntax` prohíbe en `apps/web-e2e/src` la
  llamada al `setTimeout` global (identificador suelto o `globalThis.setTimeout`/`window.setTimeout`, incluido el de
  `node:timers/promises`); `test.setTimeout(…)`, que es un techo, sigue permitido. Las dos esperas observacionales de
  `public-share.spec.ts` y el salto condicional de `byok.spec.ts` llevan una excepción de línea **con el motivo**: es
  el único cambio en specs no admitidos, y lo impone el lint.
- **Reintentos.** Local: `retries: 0`. CI: `retries: 1` con `failOnFlakyTests: true`: el reintento existe para
  **clasificar** (fallo estable frente a intermitente) y dejar la traza de los dos intentos, nunca para dar verde.
- **Trazas y vídeo** en `retain-on-failure` (con `on-first-retry` y cero reintentos no habría traza nunca).
- **`workers: 1`** en los dos sitios: las pruebas comparten el contador de registros y el worker de la pila.
- **Admisión con carga.** Una prueba entra en un lote tras `--repeat-each=5` en verde **con la CPU cargada**, en **cada
  proyecto** (`chromium` y `mobile`) y en cada perfil que la ejecuta (`local` y ensayo `remote`), una invocación del
  runner por proyecto y perfil sobre una pila nueva (presupuesto de intentos de registro, D5). Es la técnica que
  destapó la carrera de navegación de `join-group.dialog.spec.ts` (PR #59). Un intermitente se arregla o no se admite.
- **Saltos.** `playwright/no-skipped-test` en `error` rechaza cualquier `test.skip` (también el condicional) en
  `apps/web-e2e/src`; el único admitido es el que lleva excepción de línea **con su motivo**, y el recorrido no lleva
  ninguno. Un salto parcial dentro del recorrido lo detecta la comprobación de pasos declarados (D11). El reporter
  propio de saltos se retiró en la iteración 2 (R-19): con lo anterior no le queda nada que detectar en el lote 1; si
  un lote admite pruebas con saltos en tiempo de ejecución, lo trae ese lote.

### D13. CI: `e2e.yml`, a demanda y medido

- **Disparador único: `workflow_dispatch`** (Q2 respondida: «a demanda» = solo a mano), con entradas `target`
  (`local` | `staging`, por defecto `local`) y `rehearse_remote` (booleano, por defecto `false`). **Sin
  `pull_request`** ni etiqueta hasta que Q2 se decida con los minutos medidos (R-21 de la iteración 2). No es check
  obligatorio.
- **Concurrencia en el job, no en el workflow:** el job de staging lleva `concurrency: { group: e2e-staging,
  cancel-in-progress: false }`, para que dos corridas no se pisen la cuenta de prueba ni se corte una limpieza a medias;
  el job `local` no la necesita (cada corrida tiene su runner y su pila).
- **Staging solo desde `main`:** el job de staging lleva `if: github.ref == 'refs/heads/main' && inputs.target ==
  'staging'`. Como un job omitido deja la corrida en verde sin haber verificado nada, un **job de guardia** con
  `if: github.event_name == 'workflow_dispatch' && inputs.target == 'staging'` falla cuando la referencia no es `main`,
  diciéndolo (ADR-048 §3: un verde que no verificó no es verde). El job `local` lleva `if: inputs.target == 'local'`:
  pedir staging no ejecuta también la pila local.
- **Runner** `ubuntu-24.04` (como `ci.yml`), `timeout-minutes: 30`, `permissions: contents: read`. Mientras la rama se
  construye sobre un `main` anterior a 35a, el compose descarga el espejo de MinIO del espacio de nombres del
  repositorio y el job lleva **temporalmente** `packages: read` con `docker login` por la entrada estándar con
  `GITHUB_TOKEN` en un paso `run:`; la tarea 7.6 lo retira tras 35a, antes de fusionar.
- **Sin caché de navegadores:** `playwright install --with-deps chromium` en cada corrida. La caché ahorraría segundos y
  exigiría verificarla; se descartó en el debate. El store de pnpm, por `setup-node`.
- **Pasos:** instalar → `pnpm nx run web-e2e:e2e-stack` (con `-- --rehearse-remote` si la entrada lo pide) o, con
  target `staging`, `pnpm nx run web-e2e:e2e-remote -- --base-url "$E2E_BASE_URL" --match-expectation
  consent-required` con `E2E_BASE_URL: ${{ vars.E2E_STAGING_URL }}` y los secretos en `env:` como `E2E_REMOTE_EMAIL` y
  `E2E_REMOTE_PASSWORD` (D3) → subir el informe HTML,
  la salida de Playwright y `stack-logs/` con `if: always()` y `retention-days: 7`. Los valores del evento pasan por
  `env:`, nunca interpolados en `run:`.
- **Staging sin destino = rojo.** Si `vars.E2E_STAGING_URL` está vacía, el paso falla diciendo «no hay destino de staging
  declarado».
- **Minutos:** se miden las primeras corridas (tarea 7.8a) con el tiempo facturable de la API de GitHub y se anotan en
  `infra/README.md`, en una subsección propia junto a la medición de `arm64` de 35a. Con ese dato decide el usuario si la
  suite pasa a correr en cada pull request, cada noche o se queda a demanda (**Q2**, en PR-2: tarea 9.10). **Umbral**
  (ADR-053 §1.2): el consumo se consulta antes de cada corrida manual, y con el 70 % o más de los 2000 minutos del mes
  consumidos **no se lanza `e2e.yml`**: la suite se ejecuta en local con el mismo comando, sin minutos.

### D14. Cobertura por lotes; el mapa, en el lote 2

- **En este change:** lo admitido es lo etiquetado `@lot1`, y el runner ejecuta `--grep @lot1` (y `@remote-safe` en
  remoto). Admitir una prueba = etiquetarla (y `@remote-safe` si cumple D9), pasarla por el runner y por la admisión con
  carga (D12). El procedimiento está en el README (tarea 6.4).
- **Al change del lote 2** (candidato posterior a la fila 35 en `openspec-changes.yaml`, por Q3): el inventario de la
  suite actual, el **mapa de cobertura** `apps/web-e2e/catalog-coverage.json` contra `docs/catalogo-de-uso.md` con su
  comprobación, el requirement «La cobertura se declara contra el catálogo», la limpieza de orígenes y accesos a
  Mongo de los specs no admitidos y, desde la iteración 2 (R-18), los **helpers `local-only`** con su guardia
  `@remote-safe` (la antigua tarea 3.3) y la frase del requirement de perfiles que lo exige (D9). Anotado allí: la comprobación del mapa necesita **`inputs` que incluyan
  `docs/catalogo-de-uso.md`** —si no, la caché de Nx la daría por buena tras cambiar solo el catálogo— o **vivir en
  `repo-checks`**, que no cachea.
- **Plan de lotes propuesto** (cada lote, su propio change; esperan a que se cierre la fila 35, Q3):

| Lote | Contenido (números del catálogo) | Parte de |
|---|---|---|
| 1 | 1, 3, 7, 8 (unirse con el enlace de invitación, sin sesión), 10, 14, 24, 26 (tablero, solo la columna), 29, 31 — el recorrido de D11 | este change |
| 2 | Mapa de cobertura e inventario; cuenta y salida: 2 y 4 (Mailpit, solo `local`), 5, 6, 44 | `auth`, `auth-email-recovery`, `deploy-prod` |
| 3 | Grupos y links: 8 (unirse escribiendo el código y regenerarlo), 9, 11, 12, 15, 16, 17, 18, 19, 22 | `groups`, `links`, `comments` |
| 4 | Postulaciones: 25, 26 completo, 27, 28 | `applications` |
| 5 | CV e IA: 30, 32, 33, 34 | `cv`, `match`, `byok` |
| 6 | Público: 20, 21 | `public-share` |
| 7 | Búsqueda, descubrimiento y notificaciones: 35, 37, 38, 39 | `search`, `notifications` |
| — | Por decidir: 13 (depende de la red), 23 y 41 (crons), 36 y 46 (CLI), 40 (push), 42 y 43 (extensión), 45 (salud) | — |

### D15. Dos PR, PR-1 después de 35a, y el orden de archivo

- **PR-1** (grupos 1-8 de tareas): base, lote 1, ensayo remoto y CI. **Se construye en paralelo a 35a, pero se fusiona
  después de que 35a esté en `main`**: así el runner nace con el comando de arranque definitivo (`pnpm infra:up` con
  `provision`), el paso del CV prueba el almacén nuevo y el workflow no necesita `packages: read` (tareas 1.2, 7.6 y
  7.9). Su ventana la decide el usuario: **antes del PR-1 de 35b o después de su 11.6**, nunca entre el PR-2 de 35b y
  su 11.6 (B-V0-27 de la iteración 3: la 11.6 relanza los despliegues de la corrida de 6.3 y de la del PR-2 de 35b, y
  una fusión en medio desplegaría otro commit entre los dos; entre los PR-1 y PR-2 de 35b ya no se fusiona nada, por
  la cabecera de sus tareas). Si cae después de la 11.6, también **fuera de los días 7 y 14** de la medición de 35b,
  como el PR-2, porque también despliega a staging (B-V1-30, pasada extra).
- **Mientras se construye**, 35a va primero: si 35a tiene una tarea ejecutable, se hace esa, y `e2e-suite` solo ocupa
  sus esperas (ADR-053 §1, condición 6).
- **Tras fusionar 35a** (B-V1-17 de la iteración 2): la **cola de PR-1** —7.6, 7.9 y 8.1— se hace **enseguida**, en la
  ventana que queda antes del PR-1 de 35b, para que PR-1 se fusione allí. Para **todo lo demás** de este change, primero
  va la **fila 35 entera** (35b y 35c), no solo 35a.
- **Precondición de invitar en 35b** (9.4 y 9.8, añadida al bloqueo de la 10.7 de 35b, a su D14 y a su tabla de
  bloqueos): **`e2e-remote` contra staging, en `chromium` y `mobile`, en verde sobre el commit desplegado**, lanzada
  desde la máquina del autor, sin minutos de CI y gastando dos análisis del cupo de la cuenta de prueba. El commit
  desplegado se toma **del host** (`docker compose images` → `sha-<12>`) o del estado de commit `cd-staging/artifact`,
  no de la lista de corridas. **Sin respaldo local** (B-V1-28, R-27 y C13 de la iteración 3): una corrida de
  `e2e-stack`, aunque sea en un `git worktree` del commit desplegado, no prueba lo desplegado y no cuenta. Un `429` del
  cupo de análisis se resuelve repitiendo la 9.4 **otro día** (el cupo es diario). La anotación (commit, fecha,
  resultado) **no se lleva a `main` con un push**, que desplegaría otro commit y la invalidaría: viaja en el PR-2 de
  este change o en el PR de archivo de 35b, que se fusionan **después** de invitar. **El despliegue no espera a la
  suite; la invitación, sí, a una corrida en verde.**
- **Si PR-1 no está en `main`** el día de invitar: la 9.4 se lanza **desde la cabeza de la rama de PR-1** (en un `git
  worktree`) contra staging, con el commit desplegado leído del host. Vale lo mismo: la suite es la de la rama y lo
  probado es lo desplegado. **Último recurso**, si ni así puede lanzarse y el usuario decide no esperar: la
  **alternativa manual**, escrita paso a paso en la D14 de 35b —los pasos que D11 declara para el perfil `remote` (0 y
  2-8), hechos a mano en el móvil contra staging con la cuenta de prueba de 9.2 y anotados con su resultado y la
  hora—. 35b la tiene escrita entera porque, en ese caso, este design no está en `main`.
- **PR-2** (grupo 9): la verificación contra staging, cuando 35b haya desplegado, más lo que la iteración 2 movió allí
  (la parte «sin destino = rojo» de la antigua 7.5, ahora 9.3a, y Q2 con los minutos, ahora 9.10). Hasta entonces sus
  tareas están **bloqueadas por 35b** y el change sigue abierto.
- **Archivo:** tras PR-2. No depende del orden de archivo de 35a y 35c, porque no modifica ningún requirement que ellos
  modifiquen (D16).

### D16. Lo que se cruza con la fila 35

| Change | Qué toca que se cruce | Cómo se resuelve aquí |
|---|---|---|
| 35a `object-store` | MODIFIED de «Infraestructura con un comando» (`platform/local-environment`): el arranque local pasa a `pnpm infra:up` = `up --wait` + `api:object-store -- provision`; sustituye MinIO y su puerto pasa a `OBJECT_STORE_PORT`. MODIFIED de «CD a staging en main». También edita `staging-host` (D4, D5 y sus tareas 1.1, 2.1-2.2, 4.1, 4.4, 5.3 y 9.10). | PR-1 se fusiona **después** de 35a (D15): el runner llama a `pnpm infra:up` desde una sola función (tarea 1.2), el bloque usa `OBJECT_STORE_PORT` (D4, tarea 2.1), `packages: read` se retira (7.6) y la 7.9 ejecuta `e2e-stack` en local y en CI sobre la rama rebasada en el `main` que ya contiene 35a. No se toca «CD a staging en main». Las ediciones de aquí a `staging-host` evitan las secciones que edita 35a. La línea que la iteración 2 añadía bajo la tarea 1.1 (la precondición del PR solo de spec) se **retiró** en la iteración 3 (C2/C3): se comprobaba a sí misma y chocaba con la línea de la 1.1 que 35a reescribe. |
| 35b `staging-host` | Medición con exclusión del autor y recuento de no invitadas; secretos `STAGING_*`; el host y su URL; la invitación (10.7). | **Q1 y la precondición de invitar, trasladadas** por el **PR solo de spec `spec(staging-host): trasladar la exclusión de cuentas E2E y la precondición de invitar` (PR #71)**, que se fusiona en `main` **como condición de la aprobación humana del `/opsx:apply` de este change**, en paralelo a 35a y siempre antes de 35b: design D14 (la corrida `e2e-remote`, la opción desde la cabeza de la rama de PR-1, sin respaldo local, y la alternativa manual escrita paso a paso), D15/D16 (lista «autor + cuentas E2E» fuera del repositorio, pasada a `run.sh`, exclusión por `userId` en cada métrica) y la fila de la tabla de bloqueos; tareas 10.2 (días 7 y 14), 10.3 (exclusión, probada con Bob y con Ana), 10.6 (la línea base no borra las cuentas `+e2e`) y 10.7 (precondición de invitar, D15). La tarea 8.2 comprueba, como primera tarea del `/opsx:apply` de este change, que el texto está en `main`, y que sigue en los dos ficheros tras fusionar 35a. Secretos con prefijo `E2E_`. |
| 35c `verify-reusable-workflow` | Workflow reutilizable de verificación; guardias de `repo-checks` sobre workflows (acciones fijadas, `${{ }}` en `run:`); MODIFIED de «CD a staging en main». | `e2e.yml` no llama al workflow reutilizable ni lo necesita; ya pasa los valores por `env:` y no usa acciones de terceros con secretos. Si la suite remota debiera correr tras cada despliegue, eso modifica «CD a staging en main» y sería posterior a 35c: **Q4**, no se hace aquí. |

## Risks / Trade-offs

- [Los minutos del plan Free se agotan y retrasan el CD de la fila 35] → la suite no corre sola: solo a mano
  (`workflow_dispatch`); el ensayo remoto solo cuando se pide; umbral del 70 % (D13). Es la condición 2 de ADR-053 §1.
- [La clave del fixture del recorrido no es estable entre Windows y el runner Linux (fin de línea en la extracción del
  PDF)] → se mide en las dos máquinas antes de escribir el fixture (tareas 5.5a y 5.5b, esta con el esqueleto de 7.1a); si difiere, el
  paso 7 local no puede ser exacto y vuelve al usuario antes de seguir.
- [Un cambio de prompt deja al recorrido sin fixture] → el Vitest de `libs/ai` (D7) lo rompe en `ci.yml` en el mismo
  commit.
- [Algo del `.env` llega a los procesos igualmente] → lista blanca y `NX_LOAD_DOT_ENV_FILES=false`, comprobado con un
  canario, con `MONGO_PORT` en el `.env` y con el entorno efectivo de `api` y `worker` (2.4b, 2.4c).
- [El `.env` llega al propio runner, porque Nx lo carga antes de lanzarlo] → el runner no lee anulaciones del entorno:
  solo flags; las credenciales, del entorno, y falla si también están en el `.env` (D3).
- [La suite local no prueba las imágenes: nginx y el fallback del SPA, Traefik `/api` y cookies `Secure` bajo HTTPS] →
  aceptado (D2) y listado en ADR-053 §Riesgos; se prueban en staging (PR-2).
- [La admisión de `local` gasta exactamente los 10 intentos de registro del límite] → documentado (D5); un lote que
  añada intentos lo ve caer con el `429` nombrado.
- [El recorrido remoto contra staging agota el cupo de análisis] → cuenta hecha en D10; el informe nombra el `429` y la
  corrida se repite otro día (el cupo es diario).
- [Mantener dos caminos de ejecución (runner y `nx e2e` antiguo)] → el antiguo queda para iterar sobre un spec no
  admitido y se retira cuando el último lote admita el último spec.
- [La primera emisión de 35b contra el ACME de pruebas deja a staging con un certificado no confiable] → la suite falla
  contra staging mientras dure; no se relaja TLS.
- [PR-1 no está en `main` cuando 35b va a invitar] → la 9.4 se lanza desde la cabeza de la rama de PR-1 contra
  staging; la alternativa manual, escrita paso a paso en la D14 de 35b, queda como último recurso (D15). La cola de
  PR-1 tras 35a se hace enseguida para que no llegue a pasar (D15).
- [Las ediciones a `staging-host` no llegan a `main` antes del `/opsx:apply` de 35b] → van en un PR solo de spec (#71),
  cuya fusión es condición de la aprobación humana del `/opsx:apply` de este change; la 8.2 lo comprueba (D16).
- [La suite en staging gasta el cupo de análisis del día] → como mucho 5 corridas contra staging por día y
  las verificaciones del grupo 9 repartidas en días distintos (D10).

## Migration Plan

Nada que migrar: la suite es aditiva. Vuelta atrás: revertir PR-1 deja `apps/web-e2e` como estaba, elimina `e2e.yml` y
el Vitest de fixtures de `libs/ai`; no hay datos ni secretos que retirar hasta PR-2, y en PR-2 los secretos
`E2E_STAGING_*` se borran con `gh secret delete`. Las ediciones de Q1 en `staging-host` no se revierten con PR-1: van en
su propio PR solo de spec y son una decisión del usuario sobre la medición, independiente de que la suite exista.

## Open Questions

**Respondidas por el usuario el 2026-09-26, antes del debate: se aceptan las cuatro recomendaciones.**

- **Q1 →** cuentas de prueba persistentes en staging, creadas a mano por el autor, con alias `+e2e`, sin verificar y sin
  permiso de IA; excluidas de la medición de 35b. **Trasladada a `staging-host`** en este change (D10, D16).
- **Q2 →** la suite corre **a demanda** hasta medir sus minutos; los disparadores automáticos se deciden con esa cifra.
  «A demanda» = solo `workflow_dispatch`, sin `pull_request` ni etiqueta (iteración 2, R-21); la decisión con la cifra
  es la tarea 9.10.
- **Q3 →** la excepción de ADR-053 cubre **solo el lote 1**. Los lotes 2 a 7 esperan a que se cierre la fila 35.
- **Q4 →** la suite remota tras cada despliegue a staging queda **anotada como candidata para después de 35c**.

Texto original de las preguntas, conservado como histórico:

- **Q1 — Cuentas de prueba en staging y medición de 35b.** Recomendación: una cuenta persistente (dos cuando un lote lo
  necesite), creada a mano por el autor con alias de su buzón, sin verificar y sin permiso de IA; sus ids se excluyen de
  `measure.mongosh.js` y figuran en la lista que usa `uninvited.mongosh.js`, igual que el autor. Eso **añade** algo al
  design de 35b, que ya convergió. *Alternativa:* alta por corrida con alias reales y borrado de cuenta al final (sin
  tocar la medición si se ejecuta fuera de los días de medición, pero con un correo real por corrida). ¿Se aprueba la
  recomendación y se anota en 35b antes de su `/opsx:apply`?
- **Q2 — Disparadores de CI** tras medir los minutos: ¿cada pull request, cada noche sobre `main`, o se queda a demanda?
- **Q3 — Los lotes 2 a 7**: ¿entran en la misma excepción de ADR-053 o esperan a que se cierre la fila 35?
- **Q4 — Suite remota tras cada despliegue a staging**: modificaría «CD a staging en main»; ¿se anota como candidata
  para después de 35c?

## Debate

**Iteración 1 (2026-09-26)**: critic, 1 P0 y 13 P1; business, 5 V0 y varios V1/V2. Reflect aplicado:

| Hallazgo | Decisión | Dónde |
|---|---|---|
| C-P0-1 + B-V0-5: Q1 no estaba trasladada a 35b | trasladada de verdad a `staging-host` | D10, D16; 35b D15/D16, 10.2, 10.3, 10.6, 10.7; tareas 8.2 y 9.2 |
| B-V0-1: invitar sin haber visto el recorrido en verde | corrida local en verde sobre el commit desplegado, precondición de invitar | D15; 9.8; 35b 10.7; ADR-053 §1.3 |
| B-V0-2: los invitados usan el móvil | proyecto `mobile` (`Pixel 7`) para el recorrido; admisión en los dos | D11, D12; 3.8, 5.9a/b |
| B-V0-3: unirse con el código no estaba | segunda persona en `local`; «no aplicable» en `remote`; presupuesto de altas | D5, D11; 5.10 |
| B-V0-4: PR-1 nacía con un comando de arranque que 35a cambia | se fusiona después de 35a | D15, D16; 1.2, 7.6, 7.9; ADR-053 |
| B-V1-6: quitar `remote` de PR-1 | **rechazado** (el usuario pidió staging desde ya); el ensayo corre solo con `--rehearse-remote` | D3, D13 |
| B-V1-7: el mapa y la limpieza de specs no son del lote 1 | al change del lote 2; se retira el requirement del mapa | D14; yaml |
| B-V1-8: la excepción no debe robar turnos a 35a | condición 6 de ADR-053 §1 | D15; ADR-053 |
| B-V1-9 + C9: minutos y concurrencia | filtro de etiqueta, concurrencia por destino, umbral del 70 %, cifra de corridas diarias corregida | D10, D13; 7.4 |
| B-rechazo-10 | fuera 3.7 y 7.2; la 2.9 se funde en la 2.6 | tareas |
| B-V2-11: iPhone | WebKit solo si la entrevista de 35b lo pide | D11; 9.9 |
| B-V2-12: días de medición | sin suite remota los días 7 y 14 | D10; 6.4; 35b 10.2 |
| C2 | guardia de puertos por conexión y `bind`, PID dueño del puerto, bloque libre tras apagar | D3; 2.3a, 2.6a-b |
| C3 | lista blanca + `NX_LOAD_DOT_ENV_FILES=false`; compose con `--env-file` | D3, D6; 2.4b |
| C4 | proyecto `linkvault-e2e-<hash8>`; puertos publicados dentro del bloque | D4; 2.3a/b |
| C5 | `serve` del mismo checkout detectado en la comprobación previa | D3; 2.6c |
| C6 | el ensayo reinicia `worker` con un proveedor externo inalcanzable y afirma `consent-required` | D3, D7; 4.5 |
| C7 | origen de la API derivado; staging solo desde `main`; «el guardia evita accidentes, no autoriza» | D9, D13; 3.2, 7.5 |
| C8 | guardias antes de limpiar, alias `+e2e`, grupo sin visibilidad pública, qué queda tras limpiar, 1' sin texto | D8, D10, D11; 4.2, 4.3, 5.1 |
| C10 | tarea tras 35a que ejecuta `e2e-stack` en local y en CI | 7.9 |
| C11 | `web -c production`; motivo 3 corregido; lo no probado hasta PR-2, en ADR-053 | D2 |
| C12 | entrada versionada junto a los fixtures; Vitest en `libs/ai`; 5.5 nombra las tres tareas | D7; 5.5, 5.6 |
| C13 | sin objeto aquí (el mapa se va al lote 2); anotado para ese change | D14; yaml |
| C14 | 7.1 en 7.1a/7.1b; 2.3, 2.4, 5.9 y 7.8 partidas; TLS con certificado local; lint contra `setTimeout` | tareas; D12 |

**Iteración 2 (2026-09-26)**: critic, 1 P0 y 12 P1; business, 1 V0, V1/V2 y recortes R-18 a R-26. Reflect aplicado:

| Hallazgo | Decisión | Dónde |
|---|---|---|
| C1 (P0): las ediciones a `staging-host` no tenían vehículo hacia `main` | PR solo de spec `spec(staging-host): trasladar la exclusión de cuentas E2E y la precondición de invitar`, fusionado antes del `/opsx:apply` de 35b; commit propio que solo toca `staging-host`; precondición en su 1.1 | D16; 8.2; 35b 1.1; ADR-053 §1.4 |
| B-V0-13 + C8: el ciclo de la 9.8 se invalidaba solo | la anotación viaja en el PR-2 o en el PR de archivo de 35b; commit desplegado tomado del host o de `cd-staging/artifact`; respaldo local en un `git worktree` | D15; 9.8; 35b 10.7 |
| B-V1-14 + C9: la precondición de invitar no probaba staging | la 9.4 (`e2e-remote` contra staging, dos proyectos, commit desplegado, máquina del autor) es la precondición; la corrida local, respaldo | D15; 9.4, 9.8; 35b D14, tabla de bloqueos y 10.7; ADR-053 §1.3 |
| B-V1-15: la persona invitada llega sin sesión | paso 2b por el enlace de «Copiar invitación», sin sesión → login con `returnUrl` → «Crear cuenta» | D11, D14; 5.10; spec |
| B-V1-16: «el recorrido manual de 35b» no existía | alternativa manual = pasos del perfil `remote` de D11 a mano en el móvil contra staging, anotados paso a paso | D15; 9.8; 35b D14, 10.7; ADR-053 §1.6 |
| B-V1-17: turnos tras 35a | la cola de PR-1 (7.6, 7.9, 8.1) enseguida; lo demás, tras la fila 35 entera | D15; ADR-053 §1.6 |
| B-V2-18 | excepción de la 9.8 en la cabecera; 5.10 sin mezclar proyectos y perfiles | tareas |
| R-18 | 3.3 y la frase del guardia de helpers al lote 2 | D9, D14; spec; yaml |
| R-19 | fuera la 3.6; los saltos, por lint | D12; 3.5; spec |
| R-20 | la 4.4 se reduce a un `node -e` en la 3.2 | D10; 3.2 |
| R-21 | fuera `pull_request` y la 7.4 | D13; spec de `ci-pipeline`; 7.1a |
| R-22, R-23, R-24 | 7.7 en 7.1b; 7.8b → 9.10; 7.5(2) → 9.3a | tareas |
| R-25, R-26 | fuera la mitad Linux de la 2.4b y el `kill -INT` de la 7.3 y la 2.8; la 2.2 en la 2.4a | tareas |
| C2 | filas de `ss` sin PID = ajenas; todas las filas de escucha; `<ruta>\node_modules\` sin distinguir mayúsculas en `win32`; ruta normalizada antes del `hash8`; fuera «mismo checkout con dos bloques» | D3, D4; 2.6c |
| C3 | entradas del runner solo por flags; credenciales del entorno y rojo si están en el `.env`; `MONGO_PORT=27999`; entorno de `worker` | D3, D6; 2.4b, 2.4c |
| C4 | `OPENROUTER_MODEL=<modelo>:free` en el ensayo | D3, D7; 4.5 |
| C5 | `MINIO_PORT`/`MINIO_CONSOLE_PORT`/`S3_ENDPOINT` del bloque mientras el compose sea el anterior a 35a; la 7.9 los retira | D4; 2.1, 7.9 |
| C6 | la falsación de la 2.3b publica fuera del bloque sin tocar `e2e.env` | 2.3b |
| C7 | job de guardia con su `if`; `concurrency` en el job | D13; 7.1a |
| C10 | grupo 4 tras la 5.1; el paso 7 de la 4.5 se verifica en la 5.7; la 3.8 tras la 5.1 | tareas |
| C11 | 2.4b/2.4c, 4.3a/4.3b y 5.5a/5.5b partidas | tareas |
| C12 | `uninvited` sube a 1 al quitar la cuenta E2E de la lista; 35b 10.3 también con Ana | 9.2; 35b 10.3 |
| C13 | «intentos de registro»; como mucho 5 corridas contra staging al día | Context, D5, D10; grupo 9 |

**Iteración 3 (2026-09-26, la última)**: reflect aplicado sobre los hallazgos de critic y business:

| Hallazgo | Decisión | Dónde |
|---|---|---|
| C2 + C3 | se retira la línea añadida a la 1.1 de 35b (se comprobaba a sí misma y chocaba con la rama de 35a); la #71 se fusiona en `main` **como condición de la aprobación humana del `/opsx:apply`** de este change, en paralelo a 35a y siempre antes de 35b; la 8.2 (a) es la primera tarea del `/opsx:apply` | D16; Riesgos; cabecera de tareas, 8.2; ADR-053 §1.1 y §1.4; 35b 1.1 |
| C4 | la alternativa manual, escrita paso a paso en la D14 de 35b sin remitir a ficheros que no están en `main`; la 10.7 y la tabla de bloqueos de 35b citan ADR-053 solo como origen | D15; 9.8; 35b D14, tabla de bloqueos y 10.7 |
| B-V0-27 | ventana de fusión de PR-1: antes del PR-1 de 35b o después de su 11.6, nunca entre el PR-2 de 35b y su 11.6 | D15; cabecera de tareas, 8.1; ADR-053 §1.7 |
| B-V1-30 (pasada extra) | PR-1 fusionado tras la 11.6: también fuera de los días 7 y 14 de la medición, como el PR-2 (los dos despliegan) | D15; 8.1; ADR-053 §1.7 |
| B-V1-28 + R-27 + C13 | fuera el respaldo local (no prueba lo desplegado); sin PR-1 en `main`, `e2e-remote` desde la cabeza de su rama contra staging con el commit leído del host; un `429`, la 9.4 otro día; la alternativa manual, último recurso | D15; Riesgos; 9.4, 9.8; ADR-053 §1.3 y §1.6; 35b D14, tabla de bloqueos y 10.7 |
| B-V2-29 | la fusión del PR-2 de este change, fuera de los días 7 y 14 de medición | 9.8 |
| C5 | `api` y `worker` con `--inspect=false` por defecto (`@nx/js:node` 23.2.1 abre el `9229`); `--stack-fault=inspect` con dos puertos de inspector del bloque; entorno leído por `/json/list` y `Runtime.evaluate` con el `WebSocket` de Node 22; conjunto permitido explícito, `=X:` ignoradas | D3, D4, D6; 2.4c |
| C6 | credenciales `E2E_REMOTE_EMAIL`/`E2E_REMOTE_PASSWORD`, comparadas con todos los `.env*` que Nx cargaría (raíz y proyecto, salvo `.env.example`); `Read-Host -AsSecureString` y `read -s` en el README | D3, D13; 3.2, 6.4; spec de `e2e-suite` |
| C7 | la normalización de la ruta, con un Vitest de tres entradas (mayúsculas de la unidad, barras, `\` final); `cmd /c "cd /d d:\…"` opcional | D4; 2.3a |
| C8 | `evaluateListeners(rows, ownPids)`, función pura con Vitest de cuatro casos en fallo (y uno en verde de control); el oyente del fallo inyectado, en un hijo no registrado en el árbol | D3; 2.6b |
| C9 | la falsación publica `'18125:8025'`; el mensaje nombra la fase «infraestructura» y «fuera del bloque» | 2.3b |
| C10 | 5.9a y 5.9b tras la 5.10 | cabecera de tareas; 5.9a, 5.9b |
| C11 | el job `local` con `if: inputs.target == 'local'`, comprobado en la 7.1a | D13; 7.1a |
| C12 | «no se ejecutan a la vez; una en espera puede ser sustituida por otra más nueva» | spec de `ci-pipeline` |
