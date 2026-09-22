## 1. Imágenes y compose prod

- [x] 1.1 [infra] Dockerfiles multi-stage para `api`, `worker` y `web` (prompts embebidos en api; `AI_PROMPTS_DIR`); verificar `docker build` de cada uno.
- [x] 1.2 [infra] `docker-compose.prod.yml` con api, worker (≥1 réplica), web, mongo `rs0`, redis, MinIO, Traefik + LE; healthchecks `/health/live` y `/health`; `docker compose … config`.
- [x] 1.3 [infra] Compose/docs: `OUTBOX_RELAY_ENABLED=true` en **exactamente una** api; resto `false`; checklist.
- [x] 1.4 [infra] Traefik TLS + access logs **sin** query en `/login`, `/registro`, `/unirse`; snippet en `infra/`.
- [x] 1.5 [infra] Traefik rutas: `/p/`→api, `/api/`→api, else→web; `/metrics` y `/health*` no públicos (red interna/ACL).
- [x] 1.6 [infra] Traefik: rate limit **10 req / 15 min** por IP en `POST /api/cv` + `clientMaxBodySize` ≤ **6 MiB** (archivo 5 MiB + multipart).
- [x] 1.7 [infra] Referrer-Policy en rutas SPA (esp. `/unirse`) vía Traefik o headers de `web`.
- [x] 1.8 [infra] `TRUST_PROXY=true` **solo** en compose.prod (detrás de Traefik); ausente en local/dev.

## 2. Contrato de entorno y docs

- [x] 2.1 [infra] `.env.example` / parse: vars prod (`PUBLIC_PAGE_BASE_URL`, `WEB_BASE_URL`, `AI_VAULT_KEY`, `OPENROUTER_*`, `ENRICH_*`, `PASTE_*`, `AI_PROMPTS_DIR`, `TRUST_PROXY`); arranque rechaza prod incompleto.
- [x] 2.2 [infra] `infra/README.md`: operar compose+Traefik; placeholders host staging/prod; una línea “otros hosts no soportados en este change”.
- [x] 2.3 [infra] RUNBOOK: reseteo password (Argon2id + revocar sesiones), GC huérfanos, “un owner por grupo”, relay único, ack BullMQ si user gone.

## 3. Object store prod

- [x] 3.1 [infra] Bucket CV con SSE-S3; sin lifecycle de borrado automático; script/init o doc reproducible.
- [x] 3.2 [infra] Bucket snapshots con lifecycle 30 días; verificar regla ILM.
## 4. Observabilidad y proxy

- [ ] 4.1 [backend] `GET /metrics` Prometheus en api y worker (sin auth app, sin secretos/PII); smoke del endpoint.
- [ ] 4.2 [backend] `trustProxy` solo si `TRUST_PROXY=true` (compose.prod); límites login/registro/join por IP de cliente; tests `X-Forwarded-For`.

## 5. Borrado de cuenta

- [ ] 5.1 [backend] `DeleteAccount` + `DELETE /api/users/me` `{ password }`; 204 / **401** password / 409 owner; reusa `GroupDeletionHooks` con sesión Mongo; unitarios.
- [ ] 5.2 [backend] Cascada txn: user, sessions, memberships (grupo si owner solo), applications+events, comments+`commentCount`/`commentsRevision`, `$unset note`/`publicShare`, `user_links`, cv+S3, ai_analyses, **ai_usage**, keys, roadmaps, feedback; integración.
- [ ] 5.3 [backend] Consumers BullMQ con `userId`: si el usuario ya no existe, **ack** (no reintentar); tests por cola afectada o justificación documentada si ya es no-op/`attempts:1`.
- [ ] 5.4 [frontend] Ruta pública `/privacidad` (CV, retención, IA/OpenRouter/BYOK, borrado); i18n ES/EN; tests.
- [ ] 5.5 [frontend] `/perfil`: peligro + password → API → logout `/login`; enlace `/privacidad`; tests.
- [ ] 5.6 [frontend] `/mi-cv`: enlace `/privacidad`; ajustar línea según delta MODIFIED; tests + i18n.

## 6. CI/CD

- [x] 6.1 [infra] CD staging: `main` → verify → GHCR → ssh/compose pull+up staging; smoke `/health` **vía red Docker/`compose exec api`** (no Traefik público); cuerpo readiness Nest; **sin** dry-run.
- [x] 6.2 [infra] CD prod: tag `v*` → verify → GHCR → compose pull+up prod; mismo smoke interno `/health` contra `api`; no dry-run.

## 7. Cierre

- [x] 7.1 [infra] Actualizar scope `deploy-prod` en `openspec-changes.yaml` a D1–D14 + decisiones del debate.
- [ ] 7.2 [infra] `pnpm nx affected -t lint,typecheck,test` con `AI_CHAIN=mock AI_MOCK_MODE=replay` en verde.
- [ ] 7.3 [infra] Confirmar **ADR-033** (D1–D14) y referencias RUNBOOK fila 15 / design-v0.2 al cerrar apply.
