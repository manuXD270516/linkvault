# Demo local — LinkVault

Tour ~8–10 min tras sembrar datos fijos (ADR-042).

## Arranque

```bash
docker compose --profile demo up -d --wait
# .env: FEATURE_SEARCH=true, MEILI_*, AI_CHAIN=mock, AI_MOCK_MODE=replay
ALLOW_DEMO_SEED=true pnpm nx run api:seed-demo
pnpm nx serve api   # + worker + web en otras terminales
```

Credenciales:

| Usuario | Email | Password |
|---|---|---|
| Ana (owner) | `ana@demo.linkvault.local` | `Demo-pass-Ana-12345!` |
| Bob (member) | `bob@demo.linkvault.local` | `Demo-pass-Bob-12345!` |

SPA: http://localhost:4200

## Checklist del tour

1. Login como Ana → ver grupo «Demo LatAm».
2. Lista de links: preview con salary/modality; badge de oferta **cerrada**; acción **Reabrir**
   (skip UI si PR `job-link-reopen` #47 aún no está en main — el link cerrado igual existe).
3. Abrir postulaciones: applied / in_process / closed; insights stale si hay app ≥11d.
4. `/buscar` con `FEATURE_SEARCH` + worker relay: openOnly, min/max salary (tras backfill del seed).
5. Comentario + know-someone (como Bob).
6. CV / encaje: skip si el seed omitió CV (MinIO) — subir uno a mano desde `/mi-cv`.

## Reseed

Volver a correr `ALLOW_DEMO_SEED=true pnpm nx run api:seed-demo` (idempotente).
Para partir de cero: `docker compose down -v` (borra volúmenes).
