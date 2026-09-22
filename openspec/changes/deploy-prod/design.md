## Context

LinkVault ya corre de punta a punta en local (compose de desarrollo, CI de verificación, outbox, CV en MinIO, auth con
límites por IP **sin** `trustProxy`). Los ADRs **020**, **022**, **025**, **027**, **028** y el RUNBOOK pospusieron a
`deploy-prod` el camino a un entorno real: imágenes, compose prod, TLS, CD, `trustProxy` solo detrás de proxy de
confianza, cifrado/retención del bucket de CV, métricas, borrado de cuenta y aviso de privacidad. Sin cerrar eso, cada
despliegue se inventaría a mano y los datos personales no tendrían ciclo de vida completo.

## Goals / Non-Goals

**Goals**

- Compose de producción reproducible (api, worker ≥1 réplica, web, mongo `rs0`, redis, object store, Traefik + Let's Encrypt).
- Imágenes multi-stage publicables (GHCR) con healthchecks `/health/live` y `/health`.
- CD: staging tras verify en `main`; prod al publicar tag `v*` (semver); mecanismo cerrado en D10 (sin dry-run como aceptación).
- Observabilidad mínima (`GET /metrics` Prometheus, pino redactado); ACL de métricas/health en el borde.
- Borrado de cuenta con cascada atómica (incl. extras D11) y regla de ownership; aviso `/privacidad` y UI de peligro en el SPA.
- Contrato de env de prod y docs del camino canónico compose+Traefik.

**Non-goals**

- `auth-email-recovery`; marketplace de modelos; re-encrypt BYOK al rotar vault.
- Multi-región; HA de Mongo más allá de un nodo (sigue ADR-009).
- Activar `trustProxy` sin Traefik (u otro proxy) de confianza.
- Manifiestos Helm / Fly / Railway / Render / Cloud Run como entregables (solo una línea en README: no soportados en este change).
- Job automático de GC de objetos huérfanos (solo RUNBOOK manual).
- **OpenTelemetry / OTLP** (diferido; fuera de este change).

## Decisions

### D1 — Imágenes multi-stage + compose.prod

Dockerfiles multi-stage para `api`, `worker` y `web`. `docker-compose.prod.yml` levanta el stack completo con MinIO como
object store S3-compatible por defecto. Healthchecks de contenedor alineados con `platform/runtime-health`. Prompts de
IA embebidos en la imagen de `api`; `AI_PROMPTS_DIR` apunta a esa ruta.

### D2 — Traefik, trustProxy y logs sin query

Traefik termina TLS (Let's Encrypt) y es el **único** proxy de confianza del camino canónico. Con Traefik delante, `api`
activa `trustProxy` (vía `TRUST_PROXY=true`, ver D12) para que login, registro y join cuenten la IP del cliente. Logs de
acceso de Traefik **sin query strings** en `/login`, `/registro` y `/unirse` (códigos de invitación). Límites de rutas
públicas en el borde siguen ADR-027 §6. Enrutado y límites de CV: D7 y D9.

### D3 — CD staging / tag prod

- Push/merge a `main` → verify → desplegar **staging** solo si verify pasa.
- Tag `v*` (semver) → verify → desplegar **prod** solo si verify pasa.
- Fallo de verify **nunca** despliega.
- Mecanismo concreto (GHCR, dos targets compose, smoke): D10. Dry-run **no** cuenta como aceptación de CD.

### D4 — Cascada de borrado de cuenta y ownership

`DELETE /api/users/me` con `{ password }`. Contraseña incorrecta → **`401`** únicamente (alineado con spec). Cascada en
una txn (donde aplique): user, sessions, memberships, applications+events, **borrar** `group_link_comments` (no
anonimizar) con actualización de `commentCount`/`commentsRevision` como el RUNBOOK, unset `publicShare` de lo publicado
por esa persona, `$unset note` donde `sharedBy=userId`, `user_links` (`deleteMany` por `userId`), cv_documents+contadores+objetos
bajo `userId/`, ai_analyses, **`ai_usage`**, user_ai_keys, roadmaps, ai_feedback. Detalle y reuso de hooks: D11.

**Ownership:** bloquear con `409` si es único owner de un grupo **con otros miembros**; si es único miembro (owner solo),
**borrar el grupo** en la misma cascada (vía `GroupDeletionHooks` con sesión Mongo inyectada). Éxito → `204`, sesiones
invalidadas, no login.

### D5 — Object store: MinIO, SSE-S3, retención CV y snapshots

- Compose prod usa **MinIO** (API S3). Bucket de CV con **SSE-S3** (cifrado en reposo del proveedor).
- **Retención CV:** sin lifecycle de borrado automático; el objeto vive hasta delete de CV o borrado de cuenta.
  Documentado en README/RUNBOOK y reflejable en `/privacidad`.
- Snapshots de enrich: lifecycle **30 días**.
- Huérfanos: procedimiento manual en RUNBOOK (sin job en este change).

### D6 — Path de métricas

`GET /metrics` (Prometheus) en `api` y `worker`, sin auth a nivel de aplicación, sin secretos ni PII en series/labels.
Exposición pública: **prohibida**; ACL en Traefik / red Docker (D13).

### D7 — Traefik: rate limit y tope de cuerpo en POST /api/cv

En el borde, Traefik SHALL aplicar **rate limit por IP** a `POST /api/cv` (**10 peticiones / 15 min** por IP, alineado
en espíritu a los contadores de subida por persona) y `clientMaxBodySize` ≤ contrato CV (**5 MiB** + overhead de
multipart documentado, tope proxy **6 MiB**). Cierra la herencia de ADR-028 sin activar `trustProxy` a ciegas fuera de
prod.

### D8 — Una sola instancia con outbox relay

`OUTBOX_RELAY_ENABLED=true` en **exactamente una** instancia de `api` (compose/documentación lo fijan). Resto apagado.
Cierra la herencia de ADR-021 / ADR-022.

### D9 — Enrutado Traefik público

Rutas de entrada:

- `/p/` → `api` (páginas públicas de share);
- `/api/` → `api`;
- resto → `web` (SPA).

`/metrics` y `/health*` **NO** SHALL exponerse a Internet público; solo red interna / Docker (o ACL Traefik equivalente).

### D10 — Mecanismo CD cerrado

- Imágenes publicadas en **GHCR**.
- Staging y prod = **dos targets de deploy compose** (placeholders de host documentados en `infra/README`; no inventar
  orquestadores).
- Workflow: **verify → build/push (GHCR) → ssh/compose pull+up** (o equivalente documentado idéntico en efecto).
- Post-deploy smoke de readiness: `GET /health` **contra el servicio `api` en la red host/Docker** (p. ej.
  `docker compose exec api wget -qO- http://127.0.0.1:3000/health` o curl SSH al puerto interno). **NO** contra el
  entrypoint público Traefik (`else → web` devolvería HTML 200 con `api` caída). SHALL exigir cuerpo JSON de readiness
  Nest (p. ej. checks de mongo/redis), no HTML del SPA.
- Un job que solo hace dry-run **no** satisface los requirements de CD.

### D11 — Extras de cascada y jobs en vuelo

Además de D4:

- `user_links`: `deleteMany` por `userId`.
- `group_links`: `$unset note` donde `sharedBy = userId` (la relación puede quedar; la nota personal no).
- Al borrar `group_link_comments`, actualizar `commentCount` y `commentsRevision` como el procedimiento del RUNBOOK
  (ADR-026).
- `ai_usage`: **DELETE** filas de ese `userId` (sin residuo).
- `DeleteAccount` **reutiliza** `GroupDeletionHooks` con sesión Mongo inyectada (un solo camino de cascada de grupo).
- Jobs BullMQ en vuelo cuyo `userId` ya no existe: los consumers **SHALL ack** (no reintentar indefinidamente);
  documentado en design/RUNBOOK.

### D12 — `TRUST_PROXY=true` solo en compose.prod

La variable de entorno `TRUST_PROXY=true` SHALL aparecer **solo** en el compose de producción detrás de Traefik. Local,
dev y tests genéricos la dejan apagada / ausente. No activar por defecto en código sin el compose prod.

### D13 — ACL de `/metrics` y Referrer-Policy

- `/metrics` (y, junto a D9, `/health*`): Traefik allowlist / solo red interna; no Internet público.
- Rutas del SPA (en especial `/unirse`): cabecera **`Referrer-Policy`** (p. ej. `no-referrer` o `strict-origin-when-cross-origin`
  documentada) vía Traefik o headers de `web`, para que códigos de invitación no filtren a terceros.

### D14 — Sin OpenTelemetry en este change

OTel/OTLP **fuera de alcance**. No flag, no task de exportación, no requirement ADDED de OTel. Queda diferido a un
change futuro si hace falta.

## Risks / Trade-offs

| Riesgo | Mitigación |
|---|---|
| Dos api con relay → doble publicación | Compose/docs fijan una sola; verificar en checklist pre-prod |
| `trustProxy` mal configurado → límites inútiles o spoofing | Solo `TRUST_PROXY=true` en compose.prod detrás de Traefik |
| Borrado bloqueado por ownership frustra a usuarias | `409` claro + copy en UI; consulta pre-despliegue “un owner” en RUNBOOK (ADR-025) |
| Objetos huérfanos tras fallo S3 post-txn | RUNBOOK de GC manual; caso feliz borra Mongo + S3 |
| Let's Encrypt / DNS fallan en primer deploy | Documentar prerrequisitos DNS en `infra/README` |
| `/metrics` expuesto a Internet | D9/D13: no público; solo red interna / allowlist Traefik |
| Jobs BullMQ tras borrado de cuenta | Consumers ack si el user ya no existe (D11) |
| Dry-run confundido con deploy | D10: dry-run no es aceptación de CD |

## Migration Plan

1. Añadir Dockerfiles, `docker-compose.prod.yml`, variables en `.env.example`, ampliar `infra/README.md` (camino canónico
   compose+Traefik; una línea sobre otros hosts) y RUNBOOK (reseteo password, GC huérfanos, checklist owner, relay único,
   ack de jobs huérfanos).
2. Workflows CD: verify → GHCR → ssh/compose a staging (`main`) y prod (`v*`); smoke `/health`.
3. Implementar `/metrics` (sin OTel), `TRUST_PROXY` condicionado a compose.prod, rutas Traefik D7/D9/D13.
4. Aprovisionar buckets MinIO: SSE en CV; lifecycle 30d en snapshots.
5. API `DELETE /api/users/me` + cascada D4/D11; SPA `/privacidad` + peligro en `/perfil` + enlaces; ajustar línea de `/mi-cv`.
6. Publicar **ADR-033** con estas decisiones; actualizar referencias en design-v0.2 / RUNBOOK fila 15.
7. Primer despliegue: staging → smoke health → tag `v*` a prod.

## Open Questions

Ninguna bloqueante. Decisiones D1–D14 cerradas en este design (debate critic/business/reflect 2026-09-22).

## Debate reflect (critic / business)

| Hallazgo | Origen | Decisión | Motivo |
|---|---|---|---|
| Cascada omite `user_links` | Critic P0 | ACCEPT — `deleteMany` por `userId` (D11) | Residuo de lista privada identificable |
| Comentarios sin `commentCount`/`commentsRevision`; nota de `sharedBy` | Critic P0 | ACCEPT — alinear con RUNBOOK; `$unset note` (D11) | Contadores derivados y nota personal |
| Traefik sin rate limit / body en `POST /api/cv` | Critic P0 | ACCEPT — rate limit IP + `clientMaxBodySize` ≤ 5 MiB + multipart (D7) | Herencia ADR-028; camino caro |
| CD con dry-run como aceptación; mecanismo ambiguo | Critic P0 | ACCEPT — GHCR; dos targets compose; verify→push→pull+up; smoke `/health`; no dry-run (D10) | Deploy real verificable |
| Rutas Traefik y exposición de `/metrics` `/health*` | Critic P0 | ACCEPT — `/p/`+`/api/`→api, else→web; health/metrics no públicos (D9) | Superficie y share |
| Referrer-Policy en SPA (esp. `/unirse`) | Critic P1 | ACCEPT — Traefik o headers web (D13) | Códigos de invitación |
| `DeleteAccount` vs `GroupDeletionHooks` | Critic P1 | ACCEPT — reusar hooks con sesión inyectada (D11) | Un solo camino de cascada de grupo |
| `TRUST_PROXY` solo en compose.prod | Critic P1 | ACCEPT (D12) | Evitar spoofing fuera de Traefik |
| `/metrics` allowlist / interno | Critic P1 | ACCEPT (D13) | Sin auth en app; mitigar en borde |
| BullMQ in-flight tras borrado | Critic P1 | ACCEPT — consumers ack si user gone (D11) | Evitar reintentos eternos |
| Residuo `ai_usage` | Critic P1 | ACCEPT — DELETE por `userId` (D11) | Cascada sin PII en ledger |
| Password incorrecto → no solo 401 en tasks | Critic P1 | ACCEPT — tasks alinean a `401` únicamente | Spec ya lo exige |
| Scope `openspec-changes.yaml` desactualizado | Critic P1 | ACCEPT — actualizar a D1–D14 | Manifiesto = verdad operativa |
| OTel en goals/specs/tasks | Business | ACCEPT — quitar de este change (D14); non-goal | Alcance y valor; métricas Prometheus bastan |
| Alternativas infra/README largas | Business | ACCEPT — una línea: otros hosts no soportados; canónico = compose+Traefik | Evitar falsa promesa de soporte |
