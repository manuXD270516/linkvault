## Purpose

Define el seed de demostración local: datos fijos, idempotencia y límites de seguridad
para recorrer LinkVault en browser sin setup manual largo.

## ADDED Requirements

### Requirement: Seed de demostración idempotente

Con `ALLOW_DEMO_SEED=true`, entorno **no** producción, y `MONGODB_URI` cuyo host está en
la allowlist local (`localhost`, `127.0.0.1`, `mongo`, `host.docker.internal`), el comando
canónico `pnpm nx run api:seed-demo` SHALL crear o actualizar el dataset demo (Ana/Bob,
grupo, links abierto y cerrado `recheck`, apps incl. al menos una closed y una stale con
`statusChangedAt` ≥ 11 días atrás, preview con salary+modality+currency, comentario,
know-someone). SHALL ser idempotente por las claves del design (email, urls seed,
`(userId,linkId)`, etc.). SHALL imprimir credenciales fijas y URL del SPA.

SHALL fallar sin mutar si `NODE_ENV=production`, si falta `ALLOW_DEMO_SEED=true`, o si el
host de Mongo no está en la allowlist.

NO SHALL exponerse por HTTP. NO SHALL llamar al SDK/cliente Meili directamente; para
índice SHALL reutilizar el camino de backfill/outbox de search (`api:backfill-search` o
equivalente). CV en MinIO es best-effort (omitible con log).

#### Scenario: Primera corrida

- **GIVEN** Mongo local vacío de usuarios demo y guards OK
- **WHEN** se ejecuta `api:seed-demo`
- **THEN** SHALL existir Ana, Bob, grupo demo, link cerrado `recheck`, app closed, app stale
- **AND** la salida SHALL incluir `ana@demo.linkvault.local` y su password documentado

#### Scenario: Segunda corrida

- **GIVEN** el seed ya aplicado
- **WHEN** se vuelve a ejecutar `api:seed-demo`
- **THEN** NO SHALL duplicar usuarios, comments, know-someone ni applications seed
- **AND** el comando SHALL terminar en éxito

#### Scenario: Producción o URI remota bloqueada

- **GIVEN** `NODE_ENV=production` **o** `MONGODB_URI` con host fuera de la allowlist
- **WHEN** se intenta el seed
- **THEN** SHALL fallar sin mutar la base

#### Scenario: Sin Meili directo

- **GIVEN** `FEATURE_SEARCH=true`
- **WHEN** corre el seed
- **THEN** NO SHALL invocar el cliente Meili desde el proceso del seed
- **AND** SHALL encolar o ejecutar el backfill/outbox existente de `job_preview`
