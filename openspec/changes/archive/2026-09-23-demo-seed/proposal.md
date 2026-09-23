## Why

Con F3 de construcción cerrado (extension + analytics; discovery diferido a otra
iteración), el producto ya cubre los tres dolores en browser — pero montar un recorrido
útil lleva demasiado setup manual. Hace falta un **seed reproducible** acotado al stack
local (compose profile `demo` + CLI) para demostrar el sistema en ~10 minutos.

## What Changes

- Profile compose **`demo`** (marca el stack de demo; no mete api/worker/web en Docker).
- Comando canónico **`pnpm nx run api:seed-demo`** (idempotente) tras infra healthy.
- Dataset fijo para el tour: grupo Ana/Bob, links (abierto + cerrado reopen), apps
  (incl. closed + stale ≥11d), salary/modality, comentario, know-someone; CV best-effort.
- Search: seed **no** habla a Meili; reutiliza backfill/outbox existente.
- Guards: no prod, `ALLOW_DEMO_SEED`, allowlist de host Mongo local.
- RUNBOOK / `docs/demo.md` checklist 8–10 min.
- Plan §6 fila **27**; **F3 cerrado** sin discovery (post-v1).
- ADR-042.

**Fuera de alcance:** discovery; headless; analytics de grupo; OTel; UI de reseeding;
escribir Meili desde el seed.

## Capabilities

### New Capabilities

- `platform/demo-seed`: contrato del seed (datos, idempotencia, guards, no Meili directo).

### Modified Capabilities

- `platform/local-environment`: profile compose `demo` + arranque documentado.

## Impact

- **Infra/docs:** compose profile, Nx target, RUNBOOK, design-v0.2, design.md.
- **ADR-042.** Agentes: devops, backend-dev.
- **Deps:** features 1–27 (reopen UI tras merge #47; checklist con skip si falta).
