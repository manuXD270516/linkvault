## Why

LinkVault ya cubre el producto de punta a punta en local, pero **no hay un camino reproducible a un entorno real**: sin imágenes Docker, compose de producción, proxy con TLS, CD, borrado de cuenta ni el resto de deudas operativas que los ADRs pospusieron a este change. Sin eso, cada despliegue se inventaría a mano y los datos personales (CV, claves BYOK, postulaciones) quedarían sin ciclo de vida completo.

## What Changes

- **Imágenes multi-stage** de `api`, `worker` y `web` (publicables en **GHCR**), más `docker-compose.prod.yml` con Mongo (replica set), Redis, almacenamiento S3-compatible, Traefik + Let's Encrypt, réplicas del worker y healthchecks.
- **`infra/README.md`**: operar el compose prod (camino canónico). Otros hosts **no soportados** en este change (una línea).
- **CD**: staging en merge a `main`; prod en tag `v*`. Flujo: verify → build/push GHCR → ssh/compose pull+up; smoke `/health`. Dry-run **no** es aceptación.
- **Traefik**: rutas `/p/` y `/api/` → api, resto → web; rate limit IP + tope de cuerpo en `POST /api/cv`; `/metrics` y `/health*` no públicos; Referrer-Policy en SPA; logs sin query en `/login`, `/registro`, `/unirse`.
- **`TRUST_PROXY=true`** solo en compose.prod detrás de Traefik.
- **Observabilidad mínima**: `GET /metrics` (Prometheus) en api y worker. **Sin OpenTelemetry** en este change.
- **Borrado de cuenta** autenticado (`401` si password incorrecto): cascada atómica incl. `user_links`, `$unset note`, contadores de comentarios, `ai_usage`, reuso de `GroupDeletionHooks`; consumers BullMQ ack si el user ya no existe.
- **Aviso de privacidad** en el SPA y enlace desde perfil / mi-cv.
- **Reseteo manual de contraseña por operador** en RUNBOOK.
- **Object store prod**: MinIO; CV con SSE-S3 y sin lifecycle de borrado; snapshots 30 días; GC huérfanos documentado.
- **Env prod**: `PUBLIC_PAGE_BASE_URL`, `WEB_BASE_URL`, `ENRICH_*`, `PASTE_*`, `AI_*`, `OPENROUTER_*`, `AI_VAULT_KEY`, relay en **una** api.

**Fuera de alcance:** `auth-email-recovery`; marketplace de modelos; re-encrypt BYOK; multi-región; HA Mongo multi-nodo; OTel; manifiestos de hosts alternativos.

## Capabilities

### New Capabilities

- `platform/production-deploy`: compose prod, Traefik/TLS/rutas, imágenes, réplicas worker, contrato de env prod, docs canónicas.
- `platform/observability`: `/metrics`, convenciones de logs en prod, ACL de métricas (sin OTel).
- `users/account-deletion`: API de borrado de cuenta y cascada de datos personales.
- `web/privacy`: página de aviso de privacidad y UI de borrado de cuenta.

### Modified Capabilities

- `platform/ci-pipeline`: CD a staging (main) y prod (tag) con mecanismo D10.
- `platform/runtime-health`: healthchecks usados por el orquestador de prod (compose/Traefik); no públicos en Internet.
- `auth/credentials`: `TRUST_PROXY` y IP real; reseteo operador.
- `cv/documents`: cifrado/retención CV; huérfanos; límites de proxy en CV (D7).
- `links/public-share`: despublicar al borrar cuenta; URLs públicas por entorno.
- `web/auth`: enlace a privacidad y flujo de borrado desde perfil.
- `web/cv`: línea corta de `/mi-cv`; enlace a `/privacidad`.

## Impact

- `apps/api`, `apps/worker`, `apps/web`, Dockerfiles, `docker-compose.prod.yml`, `infra/`, `.github/workflows/`, `docs/RUNBOOK.md`, `.env.example`.
- ADRs: **001**, **009**, **020**; concreta herencias de **022–032**. Nuevo **ADR-033** (D1–D14).
- Agente primario: **devops**; también backend/frontend para borrado, métricas y UI de privacidad.
