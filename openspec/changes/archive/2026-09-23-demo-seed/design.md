## Context

Decisiones humanas (2026-09-23): (1) seed con **compose profile `demo`** + CLI;
(2) **F3 cerrado** sin discovery (post-v1). Api/worker/web en el host.

## Goals / Non-Goals

**Goals:** profile `demo` + `api:seed-demo` idempotente; dataset tour completo;
guards URI; search vía backfill/outbox; docs; fila 28; ADR-042; cierre F3.

**Non-Goals:** discovery; headless; seed en prod; Meili SDK desde el seed; UI admin.

## Decisions

### D1 — Profile + CLI (una vía)

- **Seed = solo** `pnpm nx run api:seed-demo` (mismo entrypoint siempre).
- **Compose profile `demo`:** Meilisearch declara `profiles: ['search', 'demo']` para que
  `--profile demo` levante el índice sin segundo sembrador. **Prohibido** mongosh crudo u
  otro entrypoint de datos bajo `demo`.
- Arranque canónico: `docker compose --profile demo up -d --wait` (trae meili) +
  `ALLOW_DEMO_SEED=true pnpm nx run api:seed-demo`.

### D2 — Credenciales e idempotencia

| Clave | Valor |
|---|---|
| Ana | `ana@demo.linkvault.local` / `Demo-pass-Ana-12345!` |
| Bob | `bob@demo.linkvault.local` / `Demo-pass-Bob-12345!` |

Upsert por: email usuario; slug/código grupo demo; `normalizedUrl` (o id determinista
documentado) de cada link seed; `(userId, linkId)` application; un comment seed id;
know-someone de Bob. Segunda corrida no duplica ninguno. Passwords **SHALL** hashearse con
el mismo Argon2id / hasher que el registro de auth (no hash ad hoc).

### D3 — Dataset obligatorio

| Pieza | Contenido |
|---|---|
| Users | Ana (owner), Bob (member) |
| Group | «Demo LatAm» |
| Links | ≥1 abierto con preview (salary min/max + currency BOB/USD + modality); ≥1 cerrado `closedReason=recheck` |
| Apps | Ana: `applied`, `in_process`, ≥1 **closed** (`rejected`\|`withdrawn`\|`expired`), ≥1 **stale** (`statusChangedAt` ≤ now−11d, status abierto) |
| Social | 1 comentario plano; Bob know-someone |
| CV | Best-effort (skip documentado si MinIO falla) |
| Search | Tras seed Mongo: invocar **mismo** camino que `api:backfill-search` / outbox SearchUpsert — **NO** SDK Meili en el seed. Índice visible requiere api relay + worker up (RUNBOOK). |

### D4 — Guards

Fallar sin escribir si:

1. `NODE_ENV=production`, o
2. `ALLOW_DEMO_SEED` ≠ `true`, o
3. host de `MONGODB_URI`: **cada** host del URI ∈ allowlist
   `{localhost, 127.0.0.1, ::1, mongo, host.docker.internal}` (fail closed).

No HTTP. No `ALLOW_DEMO_SEED` en compose prod.

### D5 — F3 / discovery

Fila **28** `demo-seed`. Nota: **F3 construcción cerrada**; `discovery` → post-v1.
Actualizar `docs/design.md` (discovery diferido).

### D6 — ADR-042

Credenciales fijas locales; idempotencia; guards URI; no Meili directo; profile+CLI.

## Risks / Trade-offs

- [reopen UI] → skip en checklist si #47 no mergeado.
- [CV/MinIO] → best-effort.
- [Search vacío] → RUNBOOK: servir api+worker con `FEATURE_SEARCH` tras seed.

## Migration Plan

Dev only. Rollback: borrar volume mongo o no sembrar.

## Open Questions

Ninguna.

## Reflect (iteración 1)

| Hallazgo | Origen | Decisión | Motivo |
|---|---|---|---|
| Compose vs CLI ambiguo | P0 critic | Aceptado D1 | Una vía: Nx seed; profile solo marca stack |
| Prod leak URI | P0 critic | Aceptado D4 | Allowlist host Mongo |
| Dual-write Meili | P0 critic | Aceptado D3 | Solo backfill/outbox |
| Dataset corto p/ analytics | P0 critic | Aceptado D3 | closed + stale + salary obligatorios |
| Password literal | P1 | Aceptado D2 | Valores fijos en tabla |
| Claves upsert | P1 | Aceptado D2 | Tabla de claves |
