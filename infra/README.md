# Producción LinkVault (camino canónico)

Camino soportado en este change (`deploy-prod` / ADR-033): **Docker Compose + Traefik + Let's Encrypt** en un VPS.
Otros hosts (Fly, Railway, Render, k3s+Helm, Cloud Run, VPS genérico sin este compose) **no están soportados** en este change.

## Piezas

| Artefacto | Rol |
|---|---|
| `docker/api.Dockerfile` | Imagen `api` (prompts en `/app/assets/ai/prompts`) |
| `docker/worker.Dockerfile` | Imagen `worker` |
| `docker/web.Dockerfile` | SPA Angular vía nginx |
| `docker-compose.prod.yml` | Stack completo: api, worker (≥1), web, mongo `rs0`, redis, MinIO, Traefik |
| `infra/traefik/dynamic.yml` | Rutas `/p/`+`/api/`→api, else→web; CV rate/body; Referrer-Policy |
| `infra/traefik/access-log-no-query.md` | Logs sin query (`RequestURI` drop) |
| `infra/minio/ensure-buckets.sh` | Bucket CV con SSE-S3; snapshots ILM 30d |

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

Copia `.env.example` → `.env.prod` (o `.env.staging`) y rellena. Obligatorias en prod (arranque Nest las valida; sin ellas el proceso sale ≠0):

- `PUBLIC_HOST`, `ACME_EMAIL`
- `PUBLIC_PAGE_BASE_URL`, `WEB_BASE_URL` (HTTPS absolutos, sin barra final; suelen ser `https://$PUBLIC_HOST`)
- `AUTH_JWT_SECRET` (≥32 chars, distinto del ejemplo de desarrollo)
- `AI_VAULT_KEY` (32 bytes en base64)
- `AI_CHAIN` (en prod **no** puede incluir `mock`)
- `OPENROUTER_*` si `openrouter` está en `AI_CHAIN`
- `ENRICH_*` (worker), `PASTE_EXTRACTION_TIMEOUT_MS`, `ENRICH_USER_AGENT`
- `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `MINIO_KMS_SECRET_KEY`
- `AI_PROMPTS_DIR` en la imagen de api/worker ya apunta a `/app/assets/ai/prompts` (compose lo fija)
- Correo (ADR-034): `MAIL_PROVIDER=resend`, `MAIL_FROM` (dominio real), `RESEND_API_KEY`; TTLs
  `AUTH_VERIFY_TOKEN_TTL_HOURS` / `AUTH_RESET_TOKEN_TTL_SECONDS`. DNS SPF/DKIM/DMARC: [RUNBOOK Paso 6 terdecies](../docs/RUNBOOK.md#paso-6-terdecies--correo-transaccional-verify--reset--adr-034).
  Local usa Mailpit; CI usa `CapturingMailer` (`MAIL_PROVIDER=capture`), no Mailpit.

`TRUST_PROXY=true` lo pone **solo** `docker-compose.prod.yml` (detrás de Traefik). No lo actives en el compose local ni en tests genéricos.

Cuando se active búsqueda (`FEATURE_SEARCH`): Meilisearch es **solo red interna** — no publicar su puerto en el
entrypoint público ni exponer `MEILI_MASTER_KEY`. En local el perfil `search` publica 7700 para `nx serve`; en prod
debe vivir en la red private/internal junto a api/worker (ver [RUNBOOK Paso 6 quattuordecies](../docs/RUNBOOK.md#paso-6-quattuordecies--meilisearch-perfil-search--adr-006-f2)).

Generar `MINIO_KMS_SECRET_KEY` (SSE-S3 del bucket de CV):

```bash
node -e "console.log('linkvault-cv:'+require('crypto').randomBytes(32).toString('base64'))"
```

## Arranque

En el host (con el repo o al menos compose + `infra/` + env):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod config   # valida
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --wait
```

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

## Object store

- Bucket CV (`S3_BUCKET`, default `cvs`): **SSE-S3**, sin lifecycle de borrado; el objeto vive hasta delete de CV o borrado de cuenta.
- Bucket snapshots (`S3_SNAPSHOTS_BUCKET`): ILM **30 días** (`expire-snapshots-30d`).
- Script reproducible: `infra/minio/ensure-buckets.sh` (también lo ejecuta el healthcheck de MinIO).

Verificar:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T minio \
  sh -c 'mc encrypt info admin/${S3_BUCKET:-cvs}; mc ilm rule ls admin/${S3_SNAPSHOTS_BUCKET:-snapshots}'
```

## Build local de imágenes

```bash
docker build -f docker/api.Dockerfile -t linkvault-api:local .
docker build -f docker/worker.Dockerfile -t linkvault-worker:local .
docker build -f docker/web.Dockerfile -t linkvault-web:local .
```

## CD (GitHub Actions)

- `.github/workflows/cd-staging.yml` — `main` → verify → **construir (load, sin push) → verificar el artefacto →
  publicar lo verificado** en GHCR → ssh compose pull+up staging → smoke interno.
- `.github/workflows/cd-prod.yml` — tag `vX.Y.Z` → verify **de todo el workspace** → **construir (load, sin push) →
  verificar el artefacto → publicar lo verificado** en GHCR → ssh compose pull+up prod → smoke interno. Misma
  estructura y mismos scripts que `cd-staging`.

Dry-run **no** cuenta como despliegue exitoso. Secrets requeridos documentados arriba y en los propios workflows.

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
