# Producción LinkVault (camino canónico)

Camino soportado en este change (`deploy-prod` / ADR-033): **Docker Compose + Traefik + Let's Encrypt** en un VPS.

**Alternativas de despliegue:** Fly, Railway, Render, k3s+Helm, Cloud Run y el VPS genérico sin este compose **no
están soportados**, y el repositorio no trae —ni debe traer— ningún manifiesto para ellos: la spec de
`platform/production-deploy` lo prohíbe como entregable, porque un manifiesto que nadie ejecuta es otra afirmación sin
comprobar. Lo único que este repositorio demuestra en cada corrida de CD es que `docker-compose.prod.yml` levanta y
responde.

## Piezas

| Artefacto | Rol |
|---|---|
| `docker/api.Dockerfile` | Imagen `api` (prompts en `/app/assets/ai/prompts`) |
| `docker/worker.Dockerfile` | Imagen `worker` |
| `docker/web.Dockerfile` | SPA Angular vía nginx |
| `docker-compose.prod.yml` | Stack completo: api, worker (≥1), web, mongo `rs0`, redis, almacén de objetos (`object-store`, SeaweedFS), Traefik |
| `infra/traefik/dynamic.yml` | Rutas `/p/`+`/api/`→api, else→web; CV rate/body; Referrer-Policy |
| `infra/traefik/access-log-no-query.md` | Logs sin query (`RequestURI` drop) |
| `object-store.js` (imagen de `api`) | `provision` y `verify` del almacén por la API S3 (ADR-052 §4): buckets, cifrado del de CV, sin reglas de caducidad |
| `infra/deploy/check-image-platforms.sh` | Comprueba en el registro que las imágenes existen para la plataforma del destino (ADR-052 §9) |
| [`infra/revision-despliegue.md`](revision-despliegue.md) | Procedimiento de revisión de toda la configuración de despliegue, con registro |
| `infra/ci/check-env-file.mjs` | Revisa un env file contra el contrato del compose sin imprimir valores |
| `infra/ci/check-verify-stages.mjs` | Mismas etapas y orden en los tres jobs `verify` (hasta la fila 35c) |

## Targets de deploy (placeholders)

Configura dos hosts distintos (o el mismo host con dos directorios/env files).

| Target | Trigger CD | Secrets (GitHub) | Compose env file (en el host) |
|---|---|---|---|
| **staging** | push/merge a `main` (verify verde) | `STAGING_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_COMPOSE_DIR`; opcional `GHCR_READ_TOKEN` (PAT `read:packages` si las imágenes GHCR son privadas) | `.env.staging` |
| **prod** | tag `vX.Y.Z` semver | `PROD_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY`, `PROD_COMPOSE_DIR`; opcional `GHCR_READ_TOKEN` | `.env.prod` |

### Qué pasa según cuántos secrets haya (ADR-048 §3)

La regla anterior —«sin secrets el job de deploy falla»— dejaba el CD **rojo por construcción** en un repositorio sin
servidor, y detrás de ese rojo esperado se escondió un defecto real de build durante un mes. Hoy hay **tres**
resultados, y los decide un job `preflight` en cada workflow de CD:

| Secrets del target | Estado | Resultado del workflow |
|---|---|---|
| ninguno de los cuatro | `none` | **verde**, diciendo de forma visible que **no se desplegó** y por qué |
| los cuatro | `full` | se despliega y se comprueba con el smoke interno |
| algunos sí y otros no | `partial` | **fallo**, nombrando los que faltan: ahí alguien sí quería desplegar |

Un artefacto que no construye o no arranca es **fallo** en los tres casos, haya destino o no. Un dry-run sigue sin
contar como despliegue.

### Dónde van los secrets de producción, y por qué hay un entorno espejo

Los cuatro `PROD_*` pueden vivir como **secrets de repositorio** o como **secrets del environment `production`**. Las
dos opciones funcionan, pero la segunda tiene una trampa: el job que decide si hay destino **tiene que poder leerlos**.
Un preflight sin acceso a ese entorno los vería vacíos y reportaría «sin destino → verde» **para siempre**, aunque
estuvieran configurados — la misma mentira que este mecanismo corrige, mudada al peor sitio.

Por eso `cd-prod.yml` usa dos entornos:

- **`production-preflight`** — espejo **de solo lectura**, en el job `preflight`. **Sin reglas de protección, sin
  revisores y sin URL.** Si los `PROD_*` son secrets de repositorio, este entorno los hereda y no hay nada que hacer;
  si son secrets del entorno `production`, hay que **copiarlos también aquí**, o el preflight dirá que no hay destino.
- **`production`** — el entorno real, **solo** en el job de despliegue. Es el único sitio donde registrar un
  despliegue en producción es verdad, y donde una regla de protección con revisores hace lo que se espera de ella.

No se usa `production` en el preflight a propósito: cada job que referencia un entorno **registra un despliegue** en
él (producción aparecería como desplegada sin haberlo estado) y, si ese entorno exige revisores, el job se quedaría
**colgado** esperando aprobación, que no es ninguno de los tres resultados de arriba.

### Probar `cd-prod` sin tocar producción

`cd-prod` admite `workflow_dispatch` con `dry_run: true`: construye y **verifica** el artefacto y **no publica ni
despliega nada**. Importa porque el tag móvil de producción es `:latest`, que es además el **valor por defecto de
`IMAGE_TAG`** en `docker-compose.prod.yml`: una prueba que lo moviera dejaría a producción llevándose código de prueba
en el siguiente `docker compose pull`. En ese modo, el input `ref` dice **qué rama o commit construir**; vacío, la
referencia desde la que se lanza el dispatch. Sin él, el checkout usaría `tag` y la prueba correría el código anterior.

Imágenes en GHCR (nombres por defecto del compose):

- `ghcr.io/<owner>/linkvault-api:<tag>`
- `ghcr.io/<owner>/linkvault-worker:<tag>`
- `ghcr.io/<owner>/linkvault-web:<tag>`

Sustituye con `API_IMAGE` / `WORKER_IMAGE` / `WEB_IMAGE` + `IMAGE_TAG` en el env del host si hace falta.

## Prerrequisitos DNS / TLS

1. `PUBLIC_HOST` (p. ej. `app.example.com`) con A/AAAA al VPS.
2. Puertos 80 y 443 abiertos hacia Traefik (challenge HTTP de Let's Encrypt).
3. `ACME_EMAIL` válido para el registro ACME.

## Variables de entorno (contrato prod)

Copia `.env.example` → `.env.prod` (o `.env.staging`) y rellena. **Los dos procesos validan su configuración al
arrancar y terminan ≠0 *antes de escuchar* si algo falta**: la pila no arranca degradada, no arranca (ADR-048 §2).

Son **30 obligatorias por proceso** —29 del esquema zod más `AI_VAULT_KEY`, contadas una a una en
[`inventarios.md`](../openspec/changes/deploy-image-verification/inventarios.md) del change `deploy-image-verification`—,
pero casi todas las fija el propio `docker-compose.prod.yml` con un valor razonable o con uno literal que no depende
del operador (`NODE_ENV`, `MONGO_URI`, `REDIS_URL`, `S3_ENDPOINT`, `AI_PROMPTS_DIR`, `TRUST_PROXY`,
`OUTBOX_RELAY_ENABLED`…). **Lo que el env file tiene que aportar sí o sí son estas trece**, declaradas como
`${VAR:?}`: sin ellas el `up` aborta nombrando la variable, antes de crear nada.

| Variable | Servicios que la exigen | Forma |
|---|---|---|
| `PUBLIC_HOST` | traefik | host público con A/AAAA al VPS |
| `ACME_EMAIL` | traefik | correo válido para el registro ACME |
| `PUBLIC_PAGE_BASE_URL` | api | URL absoluta **sin barra final** (`publicBaseUrl` la rechaza) |
| `WEB_BASE_URL` | api, worker | ídem; es la base de los enlaces que viajan en los correos |
| `AUTH_JWT_SECRET` | api | ≥32 caracteres y **distinto** del de `.env.example`: el esquema rechaza ese valor con `NODE_ENV=production` |
| `AI_CHAIN` | api, worker | en producción **no puede incluir `mock`** (ver abajo) |
| `AI_VAULT_KEY` | api, worker | **base64 de exactamente 32 bytes**; obligatoria aunque `AI_CHAIN=none` |
| `MAIL_PROVIDER` | api, worker | `smtp` \| `resend` \| `capture`; **sin valor por defecto a propósito** (ver «Correo») |
| `MAIL_FROM` | api, worker | remitente visible, p. ej. `LinkVault <noreply@tu-dominio>` |
| `S3_ACCESS_KEY` | api, worker, object-store | credencial del almacén de objetos |
| `S3_SECRET_KEY` | api, worker, object-store | ídem |
| `OBJECT_STORE_SSE_KEY` | object-store | **64 hexadecimales en minúscula**: la clave del cifrado del bucket de CV (ver [«Almacén de objetos»](#almacén-de-objetos-cv-y-snapshots)) |
| `ENRICH_USER_AGENT` | worker | `User-Agent` identificable del extractor (obligación de la spec de extracción) |

Condicionales, que **no** salen en esa lista porque dependen del valor de otra variable, y que desde el change
`deploy-image-verification` valida el esquema de **los dos** procesos (antes solo el de `api`, así que un worker con
`MAIL_PROVIDER=smtp` y sin host arrancaba y fallaba al enviar el primer correo):

| Rama | Pasan a ser obligatorias |
|---|---|
| `MAIL_PROVIDER=smtp` | `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT` |
| `MAIL_PROVIDER=resend` | `RESEND_API_KEY` |
| `AI_CHAIN`/`AI_EMBED_CHAIN` con `openrouter` | `OPENROUTER_API_KEY`, y `OPENROUTER_MODEL` **terminado en `:free`** |
| `AI_CHAIN`/`AI_EMBED_CHAIN` con `mock` | `AI_MOCK_MODE` — **pero `mock` está prohibido en producción** |

Con valor por defecto en el compose, listadas porque son las que más se querrán cambiar: `S3_BUCKET` (`cvs`),
`S3_SNAPSHOTS_BUCKET` (`snapshots`), `AUTH_VERIFY_TOKEN_TTL_HOURS` (24) y `AUTH_RESET_TOKEN_TTL_SECONDS` (3600) — las
dos últimas son **obligatorias para el proceso** y el compose las cubre con el valor de producto.

**`mock` no es una opción en producción, y el fallo es un arranque abortado, no un aviso.** `parseAiConfig` lo prohíbe
en `AI_CHAIN` y en `AI_EMBED_CHAIN` cuando `NODE_ENV=production`, y `NODE_ENV=production` viene por **dos** caminos que
coinciden: horneado en `docker/api.Dockerfile` y `docker/worker.Dockerfile`, y vuelto a fijar con valor literal en el
`environment` del compose. Sin proveedor real, el valor que arranca es `AI_CHAIN=none`.

`AI_PROMPTS_DIR` no se toca: la imagen la hornea a `/app/assets/ai/prompts` y el compose la vuelve a fijar ahí.

### Correo: obligatorio, y el compose **no trae ningún servidor**

`MAIL_PROVIDER` va declarada como `${MAIL_PROVIDER:?}` **a propósito** (ADR-048 §2): el único valor que no exige nada
más es `capture`, y `CapturingMailer` **guarda los mensajes en memoria y no envía ninguno**. Un despliegue que arranca
y nunca entrega la verificación de una cuenta es peor que uno que se niega a arrancar, así que el `up` aborta
nombrando la variable en vez de elegir por ti. `capture` es de tests y CI; **no** de un despliegue.

Y `docker-compose.prod.yml` **no incluye ningún servicio de correo**: Mailpit solo existe en el `docker-compose.yml`
local. Hay que apuntar a algo de fuera. Dos caminos **sin cuenta de pago**:

- **`MAIL_PROVIDER=smtp` contra un relay que ya tengas** (un MTA en el propio host, el relay de tu red o el de tu
  proveedor de VPS). Gratis y sin depender de nadie, **pero con una limitación real que conviene saber antes de
  intentarlo**: el adaptador (`apps/api/src/infrastructure/mail/smtp-mailer.ts`) crea el transporte **sin
  autenticación** —`secure: false`, sin bloque `auth`— y no existen `MAIL_SMTP_USER` ni `MAIL_SMTP_PASSWORD` en
  ninguno de los dos esquemas de configuración. Es decir: sirve para un relay que autorice **por red o por IP**, y
  **no** sirve para una submission con usuario y contraseña en el 587 (Gmail, Fastmail, el SMTP de Mailgun…). Eso es
  una carencia del adaptador, no de la documentación, y se retoma en la **fila 35** (`staging-host`): está escrita en
  `openspec-changes.yaml`, en `docs/design-v0.2.md` §6 y en el `proposal.md` de `deploy-image-verification`, §"Lo que
  este change NO cierra". (Esta frase decía antes "y está registrada como tal" sin que lo estuviera en ningún sitio:
  corregido el 2026-09-24 registrándola, que es lo que la frase prometía.)
- **`MAIL_PROVIDER=resend` con una clave del nivel gratuito.** No pide tarjeta, pero sí una clave (`RESEND_API_KEY`) y,
  para enviar desde tu dominio, **verificarlo con SPF y DKIM**; mientras no lo verifiques, Resend solo deja enviar
  desde su dominio de pruebas y **solo a la dirección de tu propia cuenta**, lo que basta para probar el circuito
  entero con un usuario y no para dar de alta a nadie más. Los topes del nivel gratuito (mensual y diario) los publica
  Resend y cambian, así que **míralos en su página de precios** antes de contarlos como capacidad: aquí no se copian
  unos números que envejecerían solos. El DNS, paso a paso, en
  [RUNBOOK Paso 6 terdecies](../docs/RUNBOOK.md#paso-6-terdecies--correo-transaccional-verify--reset--adr-034).

**Qué pasa si no lo configuras bien**, medido contra el código y no supuesto:

- **El alta se completa igual.** `Register` (`apps/api/src/modules/auth/application/register.usecase.ts`) captura el
  fallo del envío, responde `201` con aviso, y el login **no** exige `emailVerified` (ADR-034 D3). Nadie se queda
  fuera por no tener correo.
- Lo que sí queda inutilizable: la **verificación de la cuenta** —el banner del SPA se queda para siempre y el reenvío
  tampoco llega—, la **recuperación de contraseña por autoservicio** (forgot → enlace → reset) y **las notificaciones
  por email**, que solo se envían a cuentas con `emailVerified = true` (`notifications/dispatch` y el digest semanal de
  grupo). El push no depende del correo.
- **Salida de operador para la contraseña:** el reseteo manual con Argon2id del
  [RUNBOOK Paso 6 duodecies](../docs/RUNBOOK.md#reseteo-manual-de-contraseña-operador). Para `emailVerified` **no hay
  procedimiento de operador escrito**, y decirlo es más útil que improvisar uno aquí: la cuenta queda usable pero sin
  verificar y sin correos de notificación.

`TRUST_PROXY=true` lo pone **solo** `docker-compose.prod.yml` (detrás de Traefik). No lo actives en el compose local ni en tests genéricos.

Cuando se active búsqueda (`FEATURE_SEARCH`): Meilisearch es **solo red interna** — no publicar su puerto en el
entrypoint público ni exponer `MEILI_MASTER_KEY`. En local el perfil `search` publica 7700 para `nx serve`; en prod
debe vivir en la red private/internal junto a api/worker (ver [RUNBOOK Paso 6 quattuordecies](../docs/RUNBOOK.md#paso-6-quattuordecies--meilisearch-perfil-search--adr-006-f2)).

## Arranque

En el host (con el repo o al menos compose + `infra/` + env):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod config   # valida
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --wait --wait-timeout 360
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps api node object-store.js provision
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps api node object-store.js verify
```

El `up` no crea los buckets: el healthcheck del almacén es de solo lectura. Los crea `provision`, por la API S3 y con la
imagen de `api` (idempotente: se puede repetir en cada despliegue), y `verify` comprueba sin escribir nada que el
almacén está como se entrega (ver [«Almacén de objetos»](#almacén-de-objetos-cv-y-snapshots)).

El plazo es el mismo que usan los dos workflows de CD y la verificación del artefacto, por el mismo motivo y con el
mismo cálculo (`infra/ci/verify-artifact.sh`). Si el `up` falla, mira `docker compose ps` y
`docker compose logs api worker web` antes que nada: es lo que distingue «esta imagen no arranca» de «esta readiness
todavía no converge».

Escalar worker sin tocar el resto:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --scale worker=2 --no-recreate
```

## Checklist pre-prod / relay único (OUTBOX)

- [ ] Exactamente **una** instancia de `api` con `OUTBOX_RELAY_ENABLED=true` (el servicio `api` del compose; no clones el servicio con relay en true).
- [ ] Si añades una segunda réplica de api, debe arrancar con `OUTBOX_RELAY_ENABLED=false` (hoy el compose no define una segunda; no uses `--scale api=2` con relay true).
- [ ] `TRUST_PROXY=true` solo en este compose.
- [ ] Consulta “un owner por grupo” (RUNBOOK Paso 6 quater) antes del primer deploy con datos migrados.
- [ ] Smoke de readiness **interno** (no Traefik público):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api \
  node -e "fetch('http://127.0.0.1:3000/health').then(async r=>{const t=await r.text();console.log(r.status,t);const j=JSON.parse(t);if(!r.ok||j.status!=='up')process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"
```

El cuerpo debe ser JSON Nest (`status`, `checks.mongo`, `checks.redis`), no HTML del SPA.

## Almacén de objetos (CV y snapshots)

El servicio `object-store` es **SeaweedFS**, elegido por una matriz ejecutada:
[`docs/object-store-matrix/matriz.md`](../docs/object-store-matrix/matriz.md) tiene cada celda con la orden que la
aprobó, y [ADR-052](../docs/adr/ADR-052.md), en «Elección», el producto y su versión, el **digest del índice** de la
imagen, la **fecha** en que se leyó y la tabla resumen. Sustituir el producto o subir su versión mayor **repite la
matriz** antes de cambiar la imagen por defecto (ADR-052, «Consecuencias»), con los scripts y los composes del mismo
directorio.

- Bucket de CV (`S3_BUCKET`, por defecto `cvs`): **cifrado por defecto** con la clave del almacén, privado, sin regla
  de caducidad; el objeto vive hasta que se borra el CV o la cuenta.
- Bucket de snapshots (`S3_SNAPSHOTS_BUCKET`): sin regla de caducidad en el almacén; los de más de 30 días los borra
  un barrido diario del `worker` (ADR-052 §7).

**La clave del cifrado de los CV es `OBJECT_STORE_SSE_KEY`**: 32 bytes en 64 hexadecimales en minúscula, que el almacén
lee de `WEED_S3_SSE_KEK`. Se genera con esta orden, la de ADR-052 «Elección»:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Guarda `OBJECT_STORE_SSE_KEY` en el fichero de entorno del host y **cópiala fuera del host junto a `AI_VAULT_KEY`**, en
el mismo sitio y con el mismo cuidado: **perder la clave es perder los CV**, porque sin ella el almacén no puede
descifrarlos y no hay otra copia.

La clave es **obligatoria**: el almacén **no arranca** sin ella, ni con un formato distinto de **64** hexadecimales en
minúscula, ni sobre un volumen que arrancó alguna vez sin ella. En producción, Compose ni siquiera crea el contenedor
sin la variable (`${OBJECT_STORE_SSE_KEY:?}`); en los dos composes, un guardia de arranque sale con `64` (clave ausente
o mal formada) o `65` (el volumen tiene `.mini_sse_kek`, la clave que SeaweedFS genera cuando arranca sin ninguna).
Qué hacer en cada caso, y por qué nunca se borra ese fichero sin saber con qué clave se cifraron los objetos:
[RUNBOOK, «Operar los CV»](../docs/RUNBOOK.md#paso-6-octies--operar-los-cv).

Comprobar el almacén, sin escribir nada (buckets, sin reglas de caducidad, cifrado del de CV, ningún snapshot de más de
31 días y acceso anónimo rechazado):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps api node object-store.js verify
```

## Levantar la pila entera en tu máquina (lo mismo que verifica el CI)

El CD demuestra en cada corrida que esta pila arranca, pero eso no servía de nada mientras el único modo de repetirlo
fuera leer el YAML de un workflow. Aquí está el procedimiento, y es **el mismo `up`** que ejecuta
`infra/ci/verify-artifact.sh`: mismo fichero de compose, misma selección de servicios y mismas banderas. Que no se
separen lo comprueba `tools/repo-checks` (`check-docs-stack-up`), que compara este bloque con el del script y falla
nombrando la diferencia.

**Lee esto antes de ejecutarlo, porque es la mitad que se suele omitir.** Al terminar tendrás **seis servicios sanos**
—`mongo`, `redis`, `object-store`, `api`, `worker` y `web`— y **ninguna URL que abrir**. En `docker-compose.prod.yml`
**Traefik es el único servicio que publica puertos** (80 y 443); los seis de abajo viven en la red `internal`, que es
`internal: true`, y no publican ninguno. Este camino responde a «¿arranca el artefacto con su configuración real?», que
es justo lo que el CD verifica, y **no** a «¿puedo usar la aplicación?». Para desarrollar, usa el `docker compose up` +
`nx serve` del [README raíz](../README.md). Para un destino usable de verdad —con Traefik, DNS y TLS— hace falta un
host, y eso es la **fila 35** del plan (`staging-host`), que sigue abierta.

<!-- repo-check: stack-up — este bloque se compara con infra/ci/verify-artifact.sh (tools/repo-checks/src/docs-stack-up.check.mjs). Si cambias uno, cambia el otro. -->

```bash
# 1) Las tres imágenes, con los mismos Dockerfile que publica el CD.
docker build -f docker/api.Dockerfile    -t linkvault-api:local    .
docker build -f docker/worker.Dockerfile -t linkvault-worker:local .
docker build -f docker/web.Dockerfile    -t linkvault-web:local    .

# 2) Un env file propio, partiendo de .env.example y con los secretos generados aquí mismo.
#    Las líneas añadidas al final GANAN: `--env-file` rellena un mapa y la última definición de cada clave es la
#    que queda. Por eso basta con anexar: .env.example trae `AI_CHAIN=mock`, que `parseAiConfig` PROHÍBE con el
#    NODE_ENV=production que las imágenes hornean, y este anexo lo deja en `none`.
#    `AUTH_JWT_SECRET` también hay que cambiarlo: el esquema rechaza en producción el valor de .env.example.
cp .env.example .env.local-stack
cat >> .env.local-stack <<EOF

# --- Lo que la configuración de producción exige y .env.example no trae ---
PUBLIC_HOST=localhost
ACME_EMAIL=ops@example.invalid
AI_CHAIN=none
AUTH_JWT_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))")
AI_VAULT_KEY=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")
OBJECT_STORE_SSE_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
EOF

# 3) Qué imágenes usa el compose: las recién construidas, no las de GHCR.
export API_IMAGE=linkvault-api WORKER_IMAGE=linkvault-worker WEB_IMAGE=linkvault-web IMAGE_TAG=local

# 4) Valida la resolución antes de arrancar nada (aquí es donde salta una obligatoria que falte).
docker compose -f docker-compose.prod.yml --env-file .env.local-stack config >/dev/null

# 5) La pila, igual que en el corredor: sin traefik, con plazo y sin tirar del registro.
docker compose -f docker-compose.prod.yml --env-file .env.local-stack \
  up -d --wait --wait-timeout 330 --pull never mongo redis object-store api worker web

# 6) El almacén, por la API S3 y con la imagen de `api`: crear los buckets y el cifrado del de CV, comprobarlo (sin
#    escribir), y que el `worker` lee el bucket de CV con su propia configuración. Cada orden, con plazo.
timeout 180 docker compose -f docker-compose.prod.yml --env-file .env.local-stack run --rm --no-deps api node object-store.js provision
timeout 180 docker compose -f docker-compose.prod.yml --env-file .env.local-stack run --rm --no-deps api node object-store.js verify
timeout 180 docker compose -f docker-compose.prod.yml --env-file .env.local-stack run --rm --no-deps worker node s3-probe.js
```

Sobre las banderas, que no son decorativas:

- **`--pull never`** — si una imagen no está en tu daemon, el `up` tiene que **decirlo**, no descargar de GHCR una
  versión anterior y arrancarla como si fuera la que acabas de construir.
- **`--wait --wait-timeout 330`** — el plazo sale de los `start_period` y las ventanas de reintento de este mismo
  compose, encadenadas (`object-store` 60 s + 6×10 s = 120 s y, solo entonces, `api`/`worker` 60 s + 12×10 s = 180 s
  → 300 s de suelo, × 1,10 y redondeado hacia arriba a múltiplo de 30). El número, su cálculo y los tiempos medidos
  viven en un solo sitio, `infra/ci/verify-artifact.sh`.
- **la selección de servicios** — `traefik` queda fuera a propósito: exige DNS y un certificado ACME reales.

Qué mirar cuando termine. Como no hay puertos publicados, se entra con `exec`; el cuerpo tiene que ser el JSON de
readiness de Nest, no un `200` cualquiera ni el HTML del SPA:

```bash
dc() { docker compose -f docker-compose.prod.yml --env-file .env.local-stack "$@"; }

dc ps --format 'table {{.Service}}\t{{.Status}}'
dc exec -T api    node -e "fetch('http://127.0.0.1:3000/health').then(async r=>console.log(r.status, await r.text()))"
dc exec -T worker node -e "fetch('http://127.0.0.1:3001/health').then(async r=>console.log(r.status, await r.text()))"

# `web` no se comprueba con un 200: un nginx sirviendo otra cosa también responde 200. Se exige la raíz de la
# aplicación Angular en el cuerpo, igual que hace el healthcheck del compose y la verificación del artefacto.
body="$(dc exec -T web wget -qO- http://127.0.0.1/)"
case "$body" in
  *'<lv-root'*) echo 'ok: web sirve el documento del SPA' ;;
  *) echo 'FALLA: web responde, pero el cuerpo no es el documento del SPA' ; exit 1 ;;
esac
```

Lo que se vio al repetirlo con el almacén nuevo (2026-09-27, Docker 29.8.0; las imágenes, construidas con otro nombre
y exportadas en el paso 3; `provision: ok`, `verify: ok` y `s3-probe: ok` en el paso 6):

```text
SERVICE        STATUS
api            Up 12 seconds (healthy)
mongo          Up 18 seconds (healthy)
object-store   Up 19 seconds (healthy)
redis          Up 18 seconds (healthy)
web            Up 18 seconds (healthy)
worker         Up 12 seconds (healthy)
200 {"status":"up","service":"api","version":"0.0.0","checks":{"mongo":{"status":"up"},"redis":{"status":"up"}}}
200 {"status":"up","service":"worker","version":"0.0.0","checks":{"mongo":{"status":"up"},"redis":{"status":"up"}}}
ok: web sirve el documento del SPA
```

Y al terminar, **con `-v`**: sin borrar los volúmenes, el siguiente arranque parte de una mongo ya inicializada y de un
almacén con los buckets ya creados, que es justo lo que esconde los fallos de arranque que esto busca.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.local-stack down -v --remove-orphans
```

## CD (GitHub Actions)

- `.github/workflows/cd-staging.yml` — `main` → verify → **construir (load, sin push) → verificar el artefacto →
  publicar lo verificado** en GHCR → ssh compose pull+up staging → smoke interno.
- `.github/workflows/cd-prod.yml` — tag `vX.Y.Z` → verify **de todo el workspace** → **construir (load, sin push) →
  verificar el artefacto → publicar lo verificado** en GHCR → ssh compose pull+up prod → smoke interno. Misma
  estructura y mismos scripts que `cd-staging`.

**Qué pasa si no hay secrets** está arriba, en «Qué pasa según cuántos secrets haya (ADR-048 §3)»: son **tres**
resultados y los decide un job `preflight`, no la presencia de los secrets en un `if:`. La regla anterior —«sin
secrets el job de deploy falla»— queda **revocada** por ADR-048 §3; lo que se mantiene de ADR-033 D10 es que un
dry-run **no** cuenta como despliegue y que el pipeline nunca afirma haber desplegado. Un artefacto que no construye o
no arranca es **fallo** en los tres casos, y un destino **a medias** también.

**El verify de un release corre sobre todo el workspace, no sobre `nx affected`.** Un tag apunta casi siempre a un
commit que ya está en `main`: base y cabeza coinciden, el conjunto afectado sale **vacío** y `nx affected` termina con
`No tasks were run` y **código 0**. Sería un «verify verde» sin haber ejecutado nada, justo antes de desplegar a
producción. `cd-prod` usa `nx run-many --all` y, además, `infra/ci/assert-release-projects.sh` falla si el conjunto de
proyectos de algún target del release sale vacío (`run-many --all` tampoco garantiza que se ejecute algo). Ese guardia
es **solo** del release: en `ci.yml` y `cd-staging.yml` el conjunto vacío es legítimo —un merge que solo toca
documentación no afecta a ningún proyecto— y allí pondría en rojo merges sanos.

**El tag de release se valida con una expresión anclada** (`infra/ci/assert-semver-tag.sh`): `v1.2.3` y `v0.1.0` pasan;
`v1.2.3abc`, `v1.2`, `v01.2.3`, `1.2.3` y los prerelease tipo `v1.2.3-rc.1` se rechazan nombrando el tag. Los ceros a
la izquierda se rechazan porque `v01.2.3` y `v1.2.3` se leen igual y son **dos tags distintos** para git y para el
registro.

### Construir → verificar → publicar, en un solo job (ADR-048 §4)

Las tres imágenes se construyen con `load: true` y **sin `push`**, se levanta con ellas la pila de
`docker-compose.prod.yml` en el propio corredor (`infra/ci/verify-artifact.sh`) y **solo entonces** se publican
(`infra/ci/publish-artifact.sh`). Los tres pasos viven en el **mismo job** porque tienen que ocurrir en el **mismo
daemon**: una imagen cargada vive solo ahí, así que publicar desde otro sitio la reconstruiría y subiría bits que
nadie ha arrancado.

Qué levanta exactamente esa verificación, y qué deja fuera:

- **el mismo `docker-compose.prod.yml` que se despliega**, nunca un compose escrito para CI — el defecto de ADR-048 §2
  (variables que los procesos exigen y el compose no daba) vivía **literalmente** en ese fichero, así que verificar
  otro no habría encontrado nada;
- `mongo`, `redis` y `object-store` como dependencias, y `api`, `worker` y `web` como lo que se verifica; **mongo queda
  como replica set de un nodo** (`rs0`, primario escribible), igual que en producción, porque con instancia suelta una
  transacción multi-documento fallaría **solo** en el despliegue real;
- **sin Traefik y sin certificados** (exigen DNS y ACME, fuera de alcance) y **sin publicar ni un puerto**: la red
  `internal` es `internal: true` y ningún servicio de aplicación publica nada, así que la readiness se comprueba desde
  dentro con `docker compose exec`. Abrir puertos para poder mirar cambiaría la configuración que se está verificando;
- el env file es `infra/ci/verify.env`, **versionado y de relleno**, con `AI_CHAIN=none` porque `mock` está prohibido
  con el `NODE_ENV=production` que las imágenes hornean. Ese fichero **no sirve para desplegar** y lo dice en su
  cabecera.

El `/health` de `api` y de `worker` declara indicadores de mongo y redis, y **ninguno mira el almacén de objetos**.
Por eso, después del `up`, la verificación aprovisiona y comprueba el almacén con la imagen de `api`
(`object-store.js provision` y `verify`) y comprueba que el `worker` lee el bucket de CV con su propia configuración
(`s3-probe.js`). Y antes de descargar nada comprueba que cada imagen existe para la plataforma del destino
(`TARGET_PLATFORM`, `linux/arm64` en `cd-staging`): las propias en el daemon y las de terceros en su registro, con
`infra/deploy/check-image-platforms.sh`; si falta, el fallo es del artefacto, no del registro.

Por eso la publicación es `docker push` del tag ya cargado y **nunca** una segunda construcción (`push: true` o
`buildx build --push`), y por eso el script comprueba en la propia corrida la **identidad por digest** entre lo
publicado y lo verificado —digest de repositorio de la imagen local contra el `Digest:` que devuelve
`docker buildx imagetools inspect`— y falla si difieren.

Tags que publica cada workflow:

| Workflow | Tag | Cuándo |
|---|---|---|
| `cd-staging` | `sha-<12>` (inmutable) | en toda corrida que publique |
| `cd-staging` | `:staging` (móvil) | **solo** desde `main`: una corrida de rama no mueve el canal |
| `cd-prod` | `vX.Y.Z` (inmutable) | en toda corrida de release que publique |
| `cd-prod` | `:latest` (móvil) | en toda corrida de release que publique; **nunca** en modo prueba |

`:latest` no es cosmético: es el **valor por defecto de `IMAGE_TAG`** en `docker-compose.prod.yml`, así que moverlo
decide qué se lleva el siguiente `pull` de un host que no ha desplegado nada.

**Modo de prueba:** `workflow_dispatch` con `dry_run: true` construye y verifica **sin publicar nada** (útil para
probar el workflow desde una rama sin dejar imágenes en el registro). En `cd-prod` va acompañado del input `ref`
(ver arriba).

Los tres scripts se ejecutan igual en local que en CI, que es la razón de que sean scripts y no pasos inline. Contra
un registro local (`docker run -d -p 5000:5000 --name lv-registry registry:2`):

```bash
export API_IMAGE=127.0.0.1:5000/linkvault-api WORKER_IMAGE=127.0.0.1:5000/linkvault-worker \
       WEB_IMAGE=127.0.0.1:5000/linkvault-web IMAGE_TAG=sha-000000000001
infra/ci/verify-artifact.sh && infra/ci/publish-artifact.sh   # MOVING_TAG=staging para mover el canal
infra/ci/teardown-artifact.sh
```

Operaciones de operador (password reset, GC de huérfanos, ack BullMQ): ver `docs/RUNBOOK.md` Paso 6 duodecies.
