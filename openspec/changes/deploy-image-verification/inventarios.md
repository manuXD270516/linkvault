# Inventarios del grupo 1

Insumos de las tareas **1.1** y **1.2** de `tasks.md`. Se escriben aquí, y no en el cuerpo de las tareas, porque los
**grupos 4, 5 y 12** los consumen: el 4 compara el compose de producción contra estas listas, el 5 escribe
`infra/ci/verify.env` a partir de ellas, y el 12 las usa como referencia de lo que un despliegue tiene que aportar.

Todo lo de aquí está **contado**, no estimado: las listas salen de leer los dos esquemas zod y clasificar cada
propiedad de primer nivel por la presencia de `.default(` o `.optional(` en su bloque, y los recuentos se cotejaron a
mano con el fichero.

Fecha del recuento: **2026-09-23**, sobre `HEAD = d782886`.

---

## 1.1 — Variables obligatorias de `api` y `worker`

**Criterio de "obligatoria":** propiedad del esquema zod **sin** `.default()` y **sin** `.optional()`, de modo que su
ausencia hace fallar el parseo y el proceso termina antes de escuchar. Se añaden las que valida en cadena
`parseAiConfig` (`libs/ai/src/infrastructure/config/parse-ai-config.ts`), que `api` y `worker` invocan al arrancar y
que **no** están en los esquemas zod de cada app.

### Recuento

| Proceso | Esquema zod | Obligatorias en el esquema | De `parseAiConfig` | **Total obligatorias** | Con default/opcionales |
|---|---|---:|---:|---:|---:|
| `api` | `apps/api/src/infrastructure/config/api-config.schema.ts` | **29** | **1** (`AI_VAULT_KEY`) | **30** | 17 |
| `worker` | `apps/worker/src/infrastructure/config/worker-config.schema.ts` | **29** | **1** (`AI_VAULT_KEY`) | **30** | 18 |

> Corrección de una afirmación previa: **no son "dos variables de infraestructura"**. Son 29 por proceso en el esquema
> zod, más `AI_VAULT_KEY`. El número que importa para el grupo 5 es **30 por servicio**, no cuatro ni siete: cuatro y
> siete son solo las que **hoy le faltan al compose** (ver la última columna de las dos tablas).

### `api` — 29 del esquema + `AI_VAULT_KEY` = 30

| # | Variable | ¿La declara `docker-compose.prod.yml`? |
|---:|---|---|
| 1 | `NODE_ENV` | sí (`:149`, valor fijo `production`) |
| 2 | `API_PORT` | sí |
| 3 | `MONGO_URI` | sí |
| 4 | `REDIS_URL` | sí |
| 5 | `AI_CHAIN` | sí (`:167`, `${AI_CHAIN:?}`) |
| 6 | `FEATURE_HEADLESS_EXTRACTION` | sí |
| 7 | `LOG_LEVEL` | sí |
| 8 | `AUTH_JWT_SECRET` | sí |
| 9 | `AUTH_ACCESS_TOKEN_TTL_SECONDS` | sí |
| 10 | `AUTH_REFRESH_TTL_DAYS` | sí |
| 11 | `AUTH_REFRESH_MAX_DAYS` | sí |
| 12 | `OUTBOX_RELAY_ENABLED` | sí |
| 13 | `OUTBOX_RELAY_INTERVAL_MS` | sí |
| 14 | `PASTE_EXTRACTION_TIMEOUT_MS` | sí |
| 15 | `PUBLIC_PAGE_BASE_URL` | sí |
| 16 | `WEB_BASE_URL` | sí |
| 17 | `S3_ENDPOINT` | sí |
| 18 | `S3_REGION` | sí |
| 19 | `S3_ACCESS_KEY` | sí |
| 20 | `S3_SECRET_KEY` | sí |
| 21 | `S3_BUCKET` | sí |
| 22 | `MATCH_ANALYSES_PER_USER` | sí |
| 23 | `MATCH_QUOTA_WINDOW_MS` | sí |
| 24 | `MATCH_ANALYSIS_MAX_AGE_MS` | sí |
| 25 | `MATCH_ANALYSIS_TIMEOUT_MS` | sí |
| 26 | `MAIL_PROVIDER` | **NO** → tarea 4.1 / 4.3 |
| 27 | `MAIL_FROM` | **NO** → tarea 4.1 |
| 28 | `AUTH_VERIFY_TOKEN_TTL_HOURS` | **NO** → tarea 4.1 |
| 29 | `AUTH_RESET_TOKEN_TTL_SECONDS` | **NO** → tarea 4.1 |
| 30 | `AI_VAULT_KEY` (`parseAiConfig`) | sí (`:168`, `${AI_VAULT_KEY:?}`) |

Faltan **4** en el bloque `environment` del servicio `api`, que es exactamente lo que enumera la tarea 4.1.

**Con `.default()` o `.optional()` en `api` (17, no hay que declararlas para arrancar):** `FEATURE_SEARCH`,
`FEATURE_DISCOVERY`, `DISCOVERY_CHAIN`, `MEILI_HOST`, `MEILI_MASTER_KEY`, `MEILI_INDEX`, `SEARCH_SEMANTIC_RATIO`,
`SEARCH_BACKFILL_RATE`, `APP_VERSION`, `TRUST_PROXY`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `RESEND_API_KEY`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `EXTENSION_CORS_ORIGINS`.

### `worker` — 29 del esquema + `AI_VAULT_KEY` = 30

| # | Variable | ¿La declara `docker-compose.prod.yml`? |
|---:|---|---|
| 1 | `NODE_ENV` | sí (`:220`, valor fijo `production`) |
| 2 | `WORKER_HEALTH_PORT` | sí |
| 3 | `MONGO_URI` | sí |
| 4 | `REDIS_URL` | sí |
| 5 | `AI_CHAIN` | sí (`:226`, `${AI_CHAIN:?}`) |
| 6 | `FEATURE_HEADLESS_EXTRACTION` | sí |
| 7 | `LOG_LEVEL` | sí |
| 8 | `ENRICH_FETCH_TIMEOUT_MS` | sí |
| 9 | `ENRICH_MAX_BYTES` | sí |
| 10 | `ENRICH_DOMAIN_DELAY_MS` | sí |
| 11 | `ENRICH_DEADLINE_MS` | sí |
| 12 | `ENRICH_ROBOTS_TTL_SECONDS` | sí |
| 13 | `ENRICH_USER_AGENT` | sí |
| 14 | `ENRICH_CONCURRENCY` | sí |
| 15 | `ENRICH_MAX_DEFERRALS` | sí |
| 16 | `S3_ENDPOINT` | sí |
| 17 | `S3_REGION` | sí |
| 18 | `S3_ACCESS_KEY` | sí |
| 19 | `S3_SECRET_KEY` | sí |
| 20 | `S3_SNAPSHOTS_BUCKET` | sí |
| 21 | `S3_BUCKET` | sí |
| 22 | `CV_EXTRACTION_TIMEOUT_MS` | sí |
| 23 | `CV_EXTRACT_CONCURRENCY` | sí |
| 24 | `MATCH_ANALYSIS_TIMEOUT_MS` | sí |
| 25 | `MATCH_ANALYSIS_CONCURRENCY` | sí |
| 26 | `MATCH_ANALYSIS_MAX_AGE_MS` | sí |
| 27 | `WEB_BASE_URL` | **NO** → tarea 4.2 |
| 28 | `MAIL_PROVIDER` | **NO** → tarea 4.2 / 4.3 |
| 29 | `MAIL_FROM` | **NO** → tarea 4.2 |
| 30 | `AI_VAULT_KEY` (`parseAiConfig`) | sí (`:227`, `${AI_VAULT_KEY:?}`) |

Faltan **3** en el bloque `environment` del servicio `worker`, que es exactamente lo que enumera la tarea 4.2.

**Con `.default()` o `.optional()` en `worker` (18):** `FEATURE_SEARCH`, `FEATURE_LINK_FRESHNESS`,
`LINK_FRESHNESS_INTERVAL_DAYS`, `LINK_FRESHNESS_BATCH_LIMIT`, `FEATURE_GROUP_DIGEST`, `GROUP_DIGEST_CRON`,
`MEILI_HOST`, `MEILI_MASTER_KEY`, `MEILI_INDEX`, `SEARCH_SEMANTIC_RATIO`, `SEARCH_BACKFILL_RATE`, `APP_VERSION`,
`MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `RESEND_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

### Condicionales (no salen del recuento de 30; se activan según el valor de otra variable)

Estas **no** son obligatorias siempre, así que no entran en los treinta, pero un env file que fije
`MAIL_PROVIDER=smtp` o `=resend` las vuelve obligatorias y sin ellas el proceso **no arranca**.

| Rama | Variables que pasan a ser obligatorias | Dónde se valida hoy |
|---|---|---|
| `MAIL_PROVIDER=smtp` | `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT` | **solo `api`** (`api-config.schema.ts:215-230`) |
| `MAIL_PROVIDER=resend` | `RESEND_API_KEY` | **solo `api`** (`api-config.schema.ts:206-214`) |
| `MAIL_PROVIDER=capture` | ninguna | — |

**Hallazgo para el grupo 4:** el `superRefine` del worker
(`worker-config.schema.ts:146-154`) comprueba **únicamente** `ENRICH_DEADLINE_MS >= ENRICH_FETCH_TIMEOUT_MS`. No tiene
ninguna rama de correo. Es decir, hoy un `worker` con `MAIL_PROVIDER=smtp` y sin `MAIL_SMTP_HOST` **arranca** y falla
al enviar el primer correo. Lo cierra la tarea **4.4**, y hasta que 4.4 exista la verificación de 4.5 no es posible por
el lado del worker.

Otras condicionales, de IA, que este change no necesita activar pero que conviene tener escritas:

| Condición | Variables que pasan a ser obligatorias |
|---|---|
| `AI_CHAIN` o `AI_EMBED_CHAIN` incluyen `mock` | `AI_MOCK_MODE` (`parse-ai-config.ts:260-268`) |
| `AI_CHAIN` o `AI_EMBED_CHAIN` incluyen `openrouter` | `OPENROUTER_API_KEY` (`:328-335`) |
| `AI_CHAIN` incluye `openrouter` | `OPENROUTER_MODEL`, además **terminado en `:free`** (`:337-351`) |

Con `AI_CHAIN=none` (ver 1.2) **ninguna** de las tres se activa. `AI_EMBED_CHAIN` no es obligatoria: ausente vale `[]`
(`parse-ai-config.ts:207-216`, `required=false` en la llamada de `:56-62`).

---

## 1.2 — `mock` está prohibido en producción, luego la verificación usa `AI_CHAIN=none`

Tres hechos comprobados sobre el código, no supuestos:

1. **`parseAiConfig` prohíbe `mock` con `NODE_ENV=production`, en las dos cadenas.**
   `libs/ai/src/infrastructure/config/parse-ai-config.ts:64-70` para `AI_CHAIN` y `:71-81` para `AI_EMBED_CHAIN`, con
   el mismo detalle literal: `mock is not allowed with NODE_ENV=production`. Al tratarse de un `problem`, el resultado
   es `{ ok: false, problems }` (`:128-136`) y `formatAiConfigProblems` (`:157-169`) lo escribe y el proceso **aborta**.
   No es un aviso: es un arranque abortado.

2. **Las imágenes hornean `NODE_ENV=production`.**
   `docker/api.Dockerfile:54` y `docker/worker.Dockerfile:55`, en la etapa `runner`: `ENV NODE_ENV=production`.

3. **Y el compose lo vuelve a fijar, con valor literal, no interpolado.**
   `docker-compose.prod.yml:149` (`api`) y `:220` (`worker`): `NODE_ENV: production`. Esto importa porque el
   `environment` del compose **pisa** el `ENV` de la imagen: aunque alguien retirase el `ENV` del Dockerfile, el
   compose que la verificación levanta seguiría poniendo `production`. Las dos vías coinciden, así que no hay forma de
   colar `NODE_ENV=development` sin editar el fichero que se está verificando.

**Conclusión que hereda el grupo 5:** la verificación del artefacto **no puede usar `AI_CHAIN=mock`**. El único valor
que arranca sin pedir credenciales de ningún proveedor real es **`AI_CHAIN=none`**, y con él tampoco hace falta
`AI_MOCK_MODE` ni ninguna `OPENROUTER_*`. Esto **no** contradice la regla de `CLAUDE.md` de usar `AI_CHAIN=mock` en
tests y CI: esa regla habla de los tests de Vitest y del eval harness, que corren con `NODE_ENV=test`; aquí lo que se
levanta es la **imagen de producción con su configuración de producción**, y ahí `mock` está prohibido por diseño.

`AI_VAULT_KEY` sigue siendo obligatoria aunque `AI_CHAIN=none`: `parseVaultKey` (`parse-ai-config.ts:440-466`) la
exige en cuanto `NODE_ENV=production`, con independencia de la cadena, y ha de ser **base64 de exactamente 32 bytes**.
Lo recoge la tarea 5.2.
