## Context

Motivación en `proposal.md` §Why; la excepción a la precedencia de la fila 35 y las decisiones de fondo, en
**ADR-053**. Aquí, el estado de partida que condiciona el cómo:

- **Ya hay suite.** `apps/web-e2e` tiene quince specs (`auth`, `auth-email-recovery`, `groups`, `links`,
  `applications`, `comments`, `cv`, `match`, `byok`, `freshness`, `home`, `deploy-prod`, `notifications`,
  `public-share`, `search`) y dos helpers (`support/job-ids.ts`, `support/register-limit.ts`). El target `e2e` lo
  infiere `@nx/playwright/plugin` (`nx.json`); `playwright.config.mts` usa `nxE2EPreset`, que en CI pone `retries: 2` y
  `workers: 1`, y fija `trace: 'on-first-retry'`, así que **sin reintento no hay traza**.
- **Cómo arranca hoy.** El `webServer` de Playwright lanza `pnpm nx serve web` con `reuseExistingServer: true`; la `api`
  y el `worker` se levantan aparte, a mano. El 2026-09-19 otra sesión tenía `3000`/`3001`: los `nx serve` nuevos
  fallaron con `EADDRINUSE`, `/health` respondió `200` igualmente y el e2e **corrió contra código viejo** sin avisar.
- **Dependencias ocultas de los specs.** `links`, `match` y `freshness` escriben en Mongo (`MONGO_URI` o
  `localhost:27017`); `register-limit.ts` vacía contadores con `docker exec linkvault-redis-1`, un nombre de contenedor
  que solo existe con el proyecto de compose `linkvault`; `home` y `groups` llevan `http://localhost:4200` escrito a
  mano; `public-share` usa `LINKVAULT_API_ORIGIN` y dos `waitForTimeout(2000)`; `byok` tiene una rama que **se salta y
  pasa igual** según el `.env` (su cabecera explica cómo distinguirlo a mano); `match` depende del fixture escrito a
  mano `match-cv/ce41cbcd…` en replay.
- **CI no ejecuta Playwright** en ningún workflow. `cd-staging` y `cd-prod` verifican el artefacto con
  `infra/ci/verify-artifact.sh` sobre `docker-compose.prod.yml`, entrando por `docker compose exec`: ese compose no
  publica ningún puerto salvo los de Traefik, que exige `PUBLIC_HOST` y ACME.
- **Las imágenes hornean `NODE_ENV=production`**, y con él `parseAiConfig` **prohíbe** `AI_CHAIN=mock`
  (`infra/ci/verify.env`, comentario de `AI_CHAIN`).
- **Staging no existe** hasta 35b: `<ip>.sslip.io` con TLS de Let's Encrypt, correo real por Brevo (300 al día, sin
  dominio propio), IA real por OpenRouter `:free`, sin búsqueda, y un **plan de medición** con scripts `mongosh` que
  cuentan cuentas excluyendo al autor por su id y un recuento de cuentas no invitadas (`staging-host` design D15 y D16).
- **Registrar envía correo**: `register.usecase.ts` emite la verificación tras crear la cuenta. En staging, cada alta de
  prueba sería un correo real por Brevo.
- **Minutos:** repositorio privado en el plan Free (2000 minutos al mes), compartidos con `ci`, `cd-staging` y la
  medición de `arm64` de 35a.

## Goals / Non-Goals

**Goals:**

- Un comando local = el comando de CI, con la pila aislada y apagada al final.
- Un perfil `remote` que se ensaya hoy contra la pila local y mañana contra staging sin cambiar las pruebas.
- El camino crítico cubierto de punta a punta, y un procedimiento para añadir el resto del catálogo por lotes.

**Non-Goals:**

- Reescribir los specs existentes ni admitirlos en este change: entran por lotes (D14).
- Ejecutar la suite contra las imágenes del artefacto en local o en CI (D2).
- Tocar `ci.yml`, `cd-staging.yml`, `cd-prod.yml`, `docker-compose*.yml` o cualquier requirement que modifiquen 35a,
  35b o 35c (D16).
- Ejecutar la suite automáticamente tras cada despliegue a staging (Q4).
- Probar la extensión del navegador, los crons o los CLI (catálogo 23, 36, 41-43, 45, 46): se decide en su lote.

## Decisions

### D1. Se parte de `apps/web-e2e`, y la suite reproducible es lo admitido

Se conserva el proyecto, su preset y sus specs. Lo que cambia es **qué se ejecuta de forma reproducible**: las pruebas
**admitidas** en el mapa de cobertura (D14), y solo esas. Los specs no admitidos siguen ejecutándose como hoy (`pnpm nx
e2e web-e2e` contra la pila que cada cual tenga), documentados en `apps/web-e2e/README.md` como **no reproducibles**
hasta que su lote los admita.

*Descartado:* admitir los quince specs de golpe. Cada uno arrastra supuestos de entorno distintos (flags, Meilisearch,
`AI_VAULT_KEY`, Mongo, Redis); meterlos sin adaptarlos convertiría la primera corrida de CI en un rojo que nadie sabría
leer, que es el defecto que ADR-048 persigue.

### D2. Contra el código servido con `nx serve`, no contra las imágenes del artefacto

El comando local y CI sirven `api`, `worker` y `web` con `nx serve` desde el checkout, sobre la infraestructura de
`docker-compose.yml`. Las **imágenes del artefacto** las prueba la suite **solo en staging**, con el perfil `remote`.

Por qué no las imágenes en local y en CI, con los tres motivos comprobados en el repositorio:

1. **La IA no puede ser determinista con ellas.** Hornean `NODE_ENV=production` y `parseAiConfig` rechaza `mock` en
   producción: el encaje del camino crítico dependería de un proveedor real o de la degradación, nunca del replay que
   CLAUDE.md exige en CI.
2. **No se pueden alcanzar sin cambiar su configuración.** `docker-compose.prod.yml` no publica puertos y el enrutado
   `/api` → `api`, resto → `web` vive en Traefik, que exige `PUBLIC_HOST` y ACME. Hacerlo accesible exigiría un compose
   superpuesto para CI, justo lo que ADR-048 §4 rechazó («un compose escrito para CI verifica una configuración que
   nadie ejecuta»).
3. **Las pruebas `local` necesitan Mongo y Mailpit**, que en ese compose están en una red `internal` sin salida.

Lo que sí garantizan las imágenes ya está cubierto: arrancan y responden (`verify-artifact.sh`), y su comportamiento
funcional lo mirará el perfil `remote` contra staging, donde corren de verdad.

*Descartado también:* ejecutar Playwright en un contenedor dentro de la red de producción (sigue sin enrutado y sin
mock), y servir `dist/` con `node` (sería una tercera forma de arrancar la aplicación que no usa nadie; `nx serve` es la
del README y la del catálogo de uso).

### D3. Un runner, dos llamadores

`apps/web-e2e/scripts/e2e-stack.ts`, ejecutado con `node --import tsx` desde dos targets de Nx sin caché:

| Target | Qué hace |
|---|---|
| `web-e2e:e2e-stack` | Monta la pila, ejecuta el perfil `local` y después el **ensayo** del perfil `remote` contra la misma pila, y la apaga. Es el comando local y el de CI. |
| `web-e2e:e2e-remote` | No monta nada: ejecuta el perfil `remote` contra `E2E_BASE_URL`. Falla si falta el origen o las credenciales. |

Fases de `e2e-stack`, cada una con su nombre en el mensaje de fallo:

1. **Comprobación previa**: Docker responde, los navegadores de Playwright están instalados y **todos** los puertos del
   bloque (D4) están libres. Nada se arranca si algo falla aquí.
2. **Infraestructura**: el comando de arranque de `platform/local-environment` (hoy `docker compose up -d --wait`; tras
   35a, el que deje 35a con su aprovisionamiento), con `-p linkvault-e2e` y los puertos del bloque por sus variables
   (`MONGO_PORT`, `REDIS_PORT`, `MAILPIT_*`…). El runner **no nombra el almacén de objetos**: levanta lo que el compose
   levante sin perfiles.
3. **Aplicaciones**: `nx serve api` y `nx serve worker` con `--watch=false`, y `nx serve web` en el puerto del bloque con
   una configuración de proxy propia de la suite que reenvía `/api` a la `api` del bloque. `NX_DAEMON=false` en los
   tres (en Windows, Nx con daemon se cuelga con la salida por tubería). La salida de cada uno va a
   `dist/.playwright/apps/web-e2e/stack-logs/<app>.log`. Se esperan: `api` y `worker` por `/health` con mongo y redis en
   `up`; `web`, por el documento con `<lv-root`.
4. **Siembra**: la cuenta de prueba del ensayo remoto, **por la API pública** (`POST /api/auth/register`), nunca por
   Mongo, igual que la creará el autor en staging.
5. **Suite**: Playwright con el perfil `local` y después con el perfil `remote`.
6. **Apagado**, siempre (`finally` y manejadores de `SIGINT`/`SIGTERM`): el árbol de cada proceso lanzado (en Windows,
   `taskkill /T /F` por el PID raíz; en Linux, el grupo de procesos) y `docker compose -p linkvault-e2e down -v
   --remove-orphans`. Solo lo que la corrida lanzó: nunca se mata por nombre de imagen ni por puerto.

Mientras dura la corrida, si un proceso lanzado **termina** o su log contiene `EADDRINUSE`, la corrida falla
nombrándolo, aunque el puerto responda.

### D4. Un bloque de puertos propio, sin reutilización

| Servicio | Desarrollo | Suite (por defecto) | Variable |
|---|---|---|---|
| `web` | 4200 | 4300 | `E2E_WEB_PORT` |
| `api` | 3000 | 3100 | `E2E_API_PORT` |
| `worker` (salud) | 3001 | 3101 | `E2E_WORKER_PORT` |
| Mongo | 27017 | 27117 | `E2E_MONGO_PORT` |
| Redis | 6379 | 6479 | `E2E_REDIS_PORT` |
| Almacén S3 (API / consola) | 9000 / 9001 | 9100 / 9101 | `E2E_S3_PORT`, `E2E_S3_CONSOLE_PORT` |
| Mailpit (SMTP / UI y API) | 1025 / 8025 | 1125 / 8125 | `E2E_MAILPIT_SMTP_PORT`, `E2E_MAILPIT_UI_PORT` |

`reuseExistingServer` desaparece del camino del runner: cuando `E2E_BASE_URL` está definida, `playwright.config.mts` no
declara `webServer`. El camino antiguo (`nx e2e web-e2e` sin variables) conserva su comportamiento, documentado como no
reproducible (D1). Así la pila de desarrollo y la suite pueden convivir, y otra sesión con `3000` ocupado ya no cambia el
código que se prueba.

### D5. Datos por prueba sobre una pila desechable; la demo no es dato de la suite

Cada corrida parte de volúmenes nuevos (`down -v` al final y proyecto propio). Cada prueba crea lo suyo con
identificadores únicos por corrida (el patrón `RUN_ID` y `support/job-ids.ts` que ya existe). La demo
(`api:seed-demo`, Ana, Bob y `SEEDD3M2`) **no** se usa: es estado compartido y mutable —el catálogo cambia la contraseña
de Ana en la recuperación—, y una prueba que la toca haría depender a las demás del orden. Si un lote quiere comprobar
que la demo carga, será una prueba que la siembra y la lee, no un dato de fondo.

El contador de registros por IP (ADR-020, diez cada quince minutos) deja de ser un problema en el lote 1 (dos altas por
corrida). `register-limit.ts` recibirá el proyecto de compose por variable cuando un lote admita specs que registren
más; mientras tanto, ninguna prueba admitida lo usa.

### D6. El entorno de la suite está versionado y gana al `.env`

`apps/web-e2e/e2e.env`, sin secretos y con la cabecera «esto no es un fichero de despliegue» de `infra/ci/verify.env`.
El runner lo lee y pasa **cada** variable a los procesos que lanza, por encima de lo que Nx cargue del `.env` local. Lo
esencial:

- `AI_CHAIN=mock`, `AI_MOCK_MODE=replay`, `AI_EMBED_CHAIN=mock` (D7);
- `MAIL_PROVIDER=smtp` hacia el Mailpit del bloque (D8);
- `MONGO_URI`, `REDIS_URL`, `S3_*`, `API_PORT`, `WORKER_HEALTH_PORT`, `WEB_BASE_URL` y `PUBLIC_PAGE_BASE_URL` apuntando
  al bloque;
- flags de producto apagados (`FEATURE_SEARCH`, `FEATURE_DISCOVERY`, `FEATURE_LINK_FRESHNESS`, `FEATURE_GROUP_DIGEST`,
  `FEATURE_HEADLESS_EXTRACTION`): ninguna prueba del lote 1 los necesita. Un lote que admita una prueba con flag lo
  enciende aquí y lo dice en el mapa.

Que Nx no pise lo que pasa el runner **no se supone**: se comprueba rompiéndolo (tarea 2.4).

### D7. IA: replay en local y en CI; en staging, ninguna llamada

- **Local y CI:** replay. El `synth` que recomienda el catálogo es para recorrerlo **a mano** con datos propios; en la
  suite convertiría una entrada sin fixture en una salida inventada que pasa en local y falla en CI con
  `FixtureMissing`. El runner lo ignora.
- **El recorrido del camino crítico tiene su propio fixture escrito a mano**, como el de `match.spec.ts`, porque no
  siembra nada en Mongo (D11): la entrada de `match-cv` es `{ job: { title, text, skills }, cv: { text } }`
  (`analyze-match.usecase.ts`), sin URL ni identificadores de corrida, así que con un título fijo y un CV de líneas
  fijas la clave es estable. Qué entra exactamente en la clave (ADR-018 §3) y si `critique-suggestions` pide otro
  fixture **se mide ejecutando** (tareas 5.4-5.6), no se supone.
- **Staging:** la IA es real y su cupo gratuito es pequeño y compartido con las personas invitadas. La cuenta de prueba
  **no tiene permiso de IA externa**, así que el análisis degrada por falta de permiso **sin llamar a nadie**
  (`cv/match`, «Sin consentimiento y sin proveedor local»). Eso es determinista y se afirma exactamente: marca de
  degradado y `consentRequired`. El recorrido comprueba el permiso **antes** de subir el CV y falla si está concedido.
- El resultado esperado del encaje lo declara el destino (`E2E_MATCH_EXPECTATION`: `replay-report` o
  `consent-required`), no se deduce en la prueba.

### D8. Correo: Mailpit en local y en CI; en staging, ninguno

El recorrido del lote 1 no lee correo. El helper que lo lea (lotes siguientes: verificación, recuperación, avisos)
consulta la API del Mailpit del bloque y está **prohibido en remoto** (D9). En staging la suite no envía correo: no
registra (D10) y la cuenta de prueba tiene el email **sin verificar**, así que los avisos de producto no le llegan
(«los avisos por email de producto no les llegan hasta verificar», catálogo §Datos de la demo). El recorrido comprueba
el aviso de email sin verificar al entrar y falla si no está.

### D9. Perfiles y el guardia que los hace cumplir

| | `local` | `remote` |
|---|---|---|
| Pila | la arranca el runner | no la arranca nadie |
| Pruebas | admitidas (`@lotN`) | admitidas **y** `@remote-safe` |
| Escribir en Mongo / Redis, `docker` | sí | **prohibido** |
| Leer Mailpit | sí | **prohibido** |
| Afirmar salida concreta del mock | sí | **prohibido** |
| Cuentas | las registra cada prueba | declaradas por variables |
| Encaje esperado | `replay-report` | lo declara el destino |

El guardia no es una convención: los helpers de Mongo, Redis, `docker` y Mailpit viven en `src/support/local-only/` y
**lanzan un error** si la prueba en curso lleva `@remote-safe`, **en cualquier perfil**. Así una prueba que se declara
apta para remoto y no lo es cae ya en local y en CI, no el día que se ejecute contra staging. Los orígenes salen de la
configuración (`baseURL`, `E2E_API_ORIGIN`); ninguna prueba admitida lleva un `localhost` escrito.

*Descartado:* `--grep-invert` por etiquetas de capacidad (`@needs-db`…). Una prueba que olvida su etiqueta pasaría en
local y rompería contra staging: sería una comprobación que no puede fallar donde importa.

### D10. Staging: cuentas declaradas, nada de altas, y limpieza al empezar y al terminar

Todo esto se especifica y se ensaya contra la pila local desde el primer día (D3, fase 5); contra staging, las tareas
nacen **bloqueadas por 35b**.

- **Sin altas en staging.** Cada alta envía un correo real por Brevo —con direcciones inventadas, un rebote que
  erosiona la reputación del remitente del que depende el umbral «bandeja de entrada en 2 de 3 proveedores» de 35b— y
  crea una cuenta que el recuento de cuentas no invitadas (35b D16) contaría. El paso de registro se declara «no
  aplicable» en `remote` y se cubre en local y en CI.
- **Cuentas de prueba persistentes**, creadas **a mano por el autor** una vez, con alias de un buzón suyo, con el email
  **sin verificar** y **sin permiso de IA externa**. El lote 1 necesita una; los lotes con dos personas, una segunda.
  Sus credenciales viven en secretos del repositorio (`E2E_STAGING_EMAIL`, `E2E_STAGING_PASSWORD`) y el origen en una
  variable (`E2E_STAGING_URL`). El prefijo `E2E_` los separa de los `STAGING_*` que lee el preflight de 35b.
- **Las credenciales solo viajan al origen declarado**: el workflow no acepta un origen libre en el lanzamiento cuando
  el destino es staging.
- **Limpieza.** Al empezar, el recorrido borra por la API lo que la cuenta tenga de una corrida anterior interrumpida
  (grupos con el prefijo de la suite, CV `e2e-*`, postulaciones sobre esos links); al terminar, borra lo suyo, también si
  falla. Sin eso, la cuenta alcanzaría los límites del producto (20 grupos, 5 CV) y la corrida número 21 fallaría por
  algo que no es un defecto.
- **Links en dominios reservados** (`.invalid`): el worker de staging no pide nada a ninguna bolsa real desde la IP de
  Oracle; la oferta se completa a mano (D11).
- **Cupo del producto:** 10 análisis de encaje al día por persona. La suite contra staging admite, por tanto, hasta
  diez corridas diarias por cuenta; la undécima falla con el `429` del producto, nombrado en el informe.
- **TLS sin excepciones**: nada de `ignoreHTTPSErrors`. Mientras 35b emita contra el ACME de pruebas, la suite contra
  staging falla, y es correcto.
- **Medición de 35b:** sus scripts excluyen al autor por su id; las cuentas de prueba tendrían que excluirse igual (y
  figurar en la lista que usa el recuento de no invitadas). Eso cambia un change que no es este: **Q1**.

### D11. El lote 1: el camino crítico, un recorrido con pasos declarados

`apps/web-e2e/src/critical-path.spec.ts`, una prueba con `test.step` por paso, etiquetas `@lot1 @critical-path
@remote-safe`, sin ninguna escritura en Mongo:

| # | Paso | `local` | `remote` | Catálogo |
|---|---|---|---|---|
| 0 | Limpieza previa de la cuenta | — | sí | — |
| 1 | Registro con cuenta nueva, aterriza en `/grupos` | sí | **no aplicable** (D10) | 1 |
| 1' | Entrar con la cuenta de prueba; aviso de email sin verificar presente; permiso de IA externa apagado | — | sí | 3, 30 |
| 2 | Crear un grupo; detalle con «Propietario» y código de invitación | sí | sí | 7 |
| 3 | Guardar en el grupo el link de una oferta en dominio reservado; la tarjeta aparece | sí | sí | 10 |
| 4 | Completar la oferta a mano (título fijo); «Escrito por …» | sí | sí | 14 |
| 5 | «Postulé» → «Hoy»; la tarjeta muestra la postulación y `/postulaciones` la tiene en «Postuladas» | sí | sí | 24, 26 |
| 6 | Subir un CV de líneas fijas generado en la prueba; «Listo · tu CV se leyó bien» | sí | sí | 29 |
| 7 | «Analizar mi encaje» → «Analizar»; resultado según `E2E_MATCH_EXPECTATION` | `replay-report` | el del destino | 31 |
| 8 | Limpieza de lo creado | sí | sí | — |

El perfil declara la lista de pasos que le tocan; al final, la prueba compara los pasos ejecutados con la lista y falla
nombrando el que falte o sobre. Así «no aplicable» es una declaración comprobada, no un `if` que puede tragarse un paso.

Sincronización: cada paso arma **antes** de la acción la espera de la respuesta o de la navegación que provoca
(`waitForResponse`, `waitForURL`) y afirma con aserciones web-first; la lectura del CV y el análisis se esperan por su
estado visible, con el plazo máximo como techo, no como mecanismo.

### D12. Determinismo: ni esperas fijas ni reintentos que escondan

- **Lint.** En `apps/web-e2e/eslint.config.mjs`, `playwright/no-wait-for-timeout`, `playwright/no-wait-for-selector` y
  `playwright/no-skipped-test` pasan de `warn` a `error`. Las dos esperas observacionales de `public-share.spec.ts` (miden
  qué hace «atrás» tras un `meta refresh`, no sincronizan) y el salto condicional de `byok.spec.ts` llevan una
  excepción de línea **con el motivo**; ninguno está admitido todavía.
- **Reintentos.** Local: `retries: 0`. CI: `retries: 1` con `failOnFlakyTests: true`: el reintento existe para
  **clasificar** (fallo estable frente a intermitente) y dejar la traza de los dos intentos, nunca para dar verde.
- **Trazas y vídeo** en `retain-on-failure` (con `on-first-retry` y cero reintentos no habría traza nunca).
- **`workers: 1`** en los dos sitios: las pruebas comparten el contador de registros y el worker de la pila, y la
  paridad local = CI vale más que minutos de paralelismo que todavía no se han medido.
- **Admisión con carga.** Una prueba entra en un lote tras `--repeat-each=5` en verde **con la CPU cargada**, la técnica
  que destapó la carrera de navegación de `join-group.dialog.spec.ts` (PR #59: 1 fallo en 6 con 20 procesos de carga
  antes del arreglo, 0 en 12 después). Un intermitente se arregla o no se admite; no se reintenta hasta que pase.
- **Saltos.** Todo `test.skip` admitido lleva su motivo en una anotación; un reporter propio falla la corrida si alguna
  prueba `@critical-path` terminó saltada.

### D13. CI: `e2e.yml`, a demanda y medido

- **Disparadores:** `workflow_dispatch` con entrada `target` (`local` | `staging`, por defecto `local`) y
  `pull_request` (`labeled`, `synchronize`, `reopened`), con el job condicionado a la etiqueta `e2e`. Un job que no se
  ejecuta por su `if` no consume minutos. No es check obligatorio.
- **Runner** `ubuntu-24.04` (como `ci.yml`), `timeout-minutes: 30`, `permissions: contents: read` y, mientras el
  compose local descargue el espejo de MinIO del espacio de nombres del repositorio, `packages: read` con `docker login`
  por la entrada estándar con `GITHUB_TOKEN` en un paso `run:` (sin acciones de terceros que reciban el token). Tras
  35a, ese permiso se retira si la imagen del almacén nuevo se descarga sin credenciales (tarea 7.6).
- **Caché:** store de pnpm por `setup-node`; navegadores en `~/.cache/ms-playwright` con clave por la versión de
  `@playwright/test` del lockfile; `playwright install --with-deps chromium` siempre (las dependencias del sistema no se
  cachean).
- **Pasos:** instalar → `pnpm nx run web-e2e:e2e-stack` (target `local`) o `pnpm nx run web-e2e:e2e-remote` con
  `E2E_BASE_URL: ${{ vars.E2E_STAGING_URL }}` y los secretos en `env:` (target `staging`) → subir el informe HTML, la
  salida de Playwright y `stack-logs/` con `if: always()` y `retention-days: 7`. Los valores del evento pasan por `env:`,
  nunca interpolados en `run:` (el estilo de los guardias que 35c añade a `repo-checks`).
- **Staging sin destino = rojo.** Si `vars.E2E_STAGING_URL` está vacía, el paso falla diciendo «no hay destino de staging
  declarado». Un verde ahí sería afirmar una verificación que no ocurrió (ADR-048 §3, cuarto desenlace).
- **Minutos:** se miden las primeras corridas (tarea 7.8) con el tiempo facturable de la API de GitHub y se anotan en
  `infra/README.md`, en una subsección propia junto a la medición de `arm64` de 35a. Con ese dato decide el usuario si
  la suite pasa a correr en cada pull request, cada noche o se queda a demanda (**Q2**).

### D14. Cobertura por lotes, contra el catálogo

- **Mapa** `apps/web-e2e/catalog-coverage.json`: una entrada por cada número de `docs/catalogo-de-uso.md` (1-46), con
  `status` (`covered`, `partial`, `planned`, `to-decide`), `lot`, las pruebas que lo cubren (fichero y título) y, si no
  se cubre con navegador, el motivo.
- **Comprobación:** un spec de Vitest en `apps/web-e2e` (nuevo target `test`, así corre en `nx affected -t test` de
  `ci.yml` sin tocar el workflow) que lee los encabezados `#### N.` del catálogo, el mapa y `playwright test --list
  --reporter=json`, y falla si falta un número, si el mapa cita una prueba inexistente, o si una prueba con `@lotN` no
  está en el mapa o viceversa. El runner ejecuta exactamente `--grep "@lot\d+"` (y `@remote-safe` en remoto).
- **Admitir una prueba** = etiquetarla `@lotN` (y `@remote-safe` si cumple D9), añadirla al mapa, pasarla por el runner
  y por la admisión con carga (D12). Si necesita un flag, se enciende en `e2e.env` y se anota en el mapa.
- **Plan de lotes propuesto** (cada lote, su propio change; si entran en la excepción de ADR-053 es **Q3**):

| Lote | Contenido (números del catálogo) | Parte de |
|---|---|---|
| 1 | 1, 3, 7, 10, 14, 24, 26 (tablero, solo la columna), 29, 31 — el recorrido de D11 | este change |
| 2 | Cuenta y salida: 2 y 4 (Mailpit, solo `local`), 5, 6, 44 | `auth`, `auth-email-recovery`, `deploy-prod` |
| 3 | Grupos y links: 8, 9, 11, 12, 15, 16, 17, 18, 19, 22 | `groups`, `links`, `comments` |
| 4 | Postulaciones: 25, 26 completo, 27, 28 | `applications` |
| 5 | CV e IA: 30, 32, 33, 34 | `cv`, `match`, `byok` |
| 6 | Público: 20, 21 | `public-share` |
| 7 | Búsqueda, descubrimiento y notificaciones: 35, 37, 38, 39 | `search`, `notifications` |
| — | `to-decide`: 13 (depende de la red), 23 y 41 (crons), 36 y 46 (CLI), 40 (push), 42 y 43 (extensión), 45 (salud) | — |

### D15. Dos PR y el orden de archivo

- **PR-1** (grupos 1-8 de tareas): base, lote 1, ensayo remoto y CI. Se fusiona en paralelo a 35a, por la excepción de
  ADR-053, en una ventana que decide el usuario.
- **PR-2** (grupo 9): la verificación contra staging, cuando 35b haya desplegado. Hasta entonces sus tareas están
  **bloqueadas por 35b** y el change sigue abierto: no se archiva nada verificado solo en local como si lo estuviera en
  staging.
- **Archivo:** tras PR-2. No depende del orden de archivo de 35a y 35c, porque no modifica ningún requirement que ellos
  modifiquen (D16).

### D16. Lo que se cruza con la fila 35

| Change | Qué toca que se cruce | Cómo se resuelve aquí |
|---|---|---|
| 35a `object-store` | MODIFIED de «Infraestructura con un comando» (`platform/local-environment`): el arranque local pasa a `pnpm infra:up` = `up --wait` + `api:object-store -- provision`; sustituye MinIO y su puerto pasa a `OBJECT_STORE_PORT`. MODIFIED de «CD a staging en main». | El runner usa el comando de arranque local vigente y no nombra el almacén (D3). Si 35a se archiva antes que PR-1, la fase de infraestructura llama a su comando y el bloque de puertos usa su variable (tarea 2.6 se revisa entonces). No se toca «CD a staging en main». |
| 35b `staging-host` | Medición con exclusión del autor por id y recuento de no invitadas; secretos `STAGING_*`; el host y su URL. | Las tareas de staging nacen bloqueadas por 35b. La exclusión de las cuentas de prueba es **Q1**. Secretos con prefijo `E2E_`. |
| 35c `verify-reusable-workflow` | Workflow reutilizable de verificación; guardias de `repo-checks` sobre workflows (acciones fijadas, `${{ }}` en `run:`); MODIFIED de «CD a staging en main». | `e2e.yml` no llama al workflow reutilizable ni lo necesita; ya pasa los valores por `env:` y no usa acciones de terceros con secretos. Si la suite remota debiera correr tras cada despliegue, eso modifica «CD a staging en main» y sería posterior a 35c: **Q4**, no se hace aquí. |

## Risks / Trade-offs

- [Los minutos del plan Free se agotan y retrasan el CD de la fila 35] → la suite no corre sola: solo a mano o con la
  etiqueta; se mide antes de decidir otra cosa (D13, Q2). Es la condición de ADR-053 §1 que impide que la excepción
  retrase el despliegue.
- [La clave del fixture del recorrido no es estable entre Windows y el runner Linux (fin de línea en la extracción del
  PDF)] → se mide en las dos máquinas antes de escribir el fixture (tarea 5.5); si difiere, el paso 7 local no puede ser
  exacto y vuelve al usuario antes de seguir.
- [Nx carga el `.env` local por encima de lo que pasa el runner] → se comprueba rompiéndolo (tarea 2.4); si Nx gana, el
  runner lanza los procesos con el `.env` apartado a un directorio temporal y restaurado byte a byte en el apagado.
- [La suite local no prueba las imágenes] → aceptado (D2); las imágenes se prueban arrancando (`verify-artifact.sh`) y,
  funcionalmente, en staging.
- [Las cuentas de prueba de staging falsean la medición de 35b] → Q1; hasta resolverla, la tarea que las crea está
  bloqueada también por el usuario.
- [El recorrido remoto contra staging falla por el cupo de 10 análisis al día] → documentado; el informe nombra el `429`.
- [Mantener dos caminos de ejecución (runner y `nx e2e` antiguo)] → el antiguo queda para iterar sobre un spec no
  admitido y se retira cuando el último lote admita el último spec.
- [La primera emisión de 35b contra el ACME de pruebas deja a staging con un certificado no confiable] → la suite falla
  contra staging mientras dure; no se relaja TLS.

## Migration Plan

Nada que migrar: la suite es aditiva. Vuelta atrás: revertir PR-1 deja `apps/web-e2e` como estaba y elimina `e2e.yml`;
no hay datos ni secretos que retirar hasta PR-2, y en PR-2 los secretos `E2E_STAGING_*` se borran con `gh secret delete`.

## Open Questions

Preguntas para el usuario. Cada una tiene la recomendación ya reflejada en specs y tareas; si la respuesta es otra, se
cambian antes de `/opsx:apply`.

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
