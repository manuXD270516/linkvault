## Context

design.md F3 discovery; ADR-022 (enrichment HTML). Public Get on Board Search API
documentada; Remote OK dump JSON. Reflect iter1: anclar contratos, caps, rate-limit,
feedback de guardado.

## Goals / Non-Goals

**Goals:** buscar getonboard + remoteok; mock CI; SPA `/descubrir` con confirmación de
guardado; `POST /api/links`; flag; ADR-043; fila plan.

**Non-Goals:** boards robots-blocked; headless; auto-apply; ranking ML.

## Decisions

### D1 — Módulo

Bounded context Nest `discovery` en api: `domain/` / `application/` /
`infrastructure/adapters/` / `presentation/`. Domain sin Nest/HTTP.

### D2 — Contrato `GET /api/discovery/search`

Query:

| Param | Regla |
|---|---|
| `q` | string; vacío → getonboard: `query` omitido (listado página); remoteok: filtrar dump localmente con match vacío = primeros N tras metadata |
| `board` | `getonboard` \| `remoteok` \| `all` (default `all`) |
| `page` | entero ≥1, default 1 |
| `pageSize` | entero 1..20, default **10** (cap duro de hits **por board** en la respuesta) |

Respuesta: `{ results: DiscoveryHit[], degraded?: { board, reason }[], page, pageSize }`.

`DiscoveryHit`: `{ board, title, company?, location?, url, externalJobId?, salaryText? }`.
`url` SHALL ser canónica para el registry de links (round-trip canonicalize).

Sin auth → `401`. Flag off → `503` `discovery_disabled`. Rate-limit usuario excedido →
`429` `too_many_attempts` + `Retry-After` (**fail-open** si Redis cae, como ADR-020 §5:
aviso en log, no bloquear a todos). Egress Remote OK: **fail-closed** (proteger tercero).

`board=all` consume el bucket de rate-limit **`userId:discovery`** (30/min), no doble
conteo por board.

Merge `all`: concatenar getonboard luego remoteok (hasta `pageSize` cada uno); orden
estable. Timeout por board **8s**. `degraded.reason` enum cerrado:
`timeout` | `upstream_429` | `upstream_5xx` | `egress_limited` | `network`.

### D3 — Adapters (contratos anclados)

#### getonboard

- **Base:** `https://www.getonbrd.com`
- **Endpoint:** `GET /api/v0/search/jobs` (API pública, sin auth; docs:
  https://www.getonbrd.com/user-manual/get-on-board-s-api y
  https://api-doc.getonbrd.com)
- **Query enviada:** `query`←`q`, `page`, `per_page`←`pageSize`, `lang`← es|en del perfil
  si existe / default `es`
- **Map:** JSON:API `data[]` → title, company (expand o attributes), url
  `https://www.getonbrd.com/jobs/{slug}` (o atributo public_url si viene), externalJobId=slug
- **429/5xx/timeout** → `degraded` sin reintentos agresivos

#### remoteok

- **Endpoint:** `GET https://remoteok.com/api` (dump JSON; 1er elemento suele ser metadata)
- **Obligatorio:** cache Redis TTL **15 min** del dump crudo (clave global) con
  **single-flight** (`SET NX`) en miss; si egress bloqueado y hay stale, servir stale;
  si no, `degraded` (no 500). Filtrar/paginar en proceso tras cache; cap `pageSize` hits.
- **Limiter egress:** Redis por board `remoteok` (p.ej. 1 fetch dump / 60s global además
  del per-user)
- **UA** identificable; atribuir Remote OK en UI (copy “vía Remote OK”)
- **429 upstream** → `degraded`, no martillar
- **URL canónica:** `https://remoteok.com/remote-jobs/{id}-…` parseable por canonicalizer

#### mock

Fixtures in-repo; `DISCOVERY_CHAIN=mock` en CI.

### D4 — Guardar + feedback (V0)

CTA → `POST /api/links` (privado default; picker de grupo **opcional V1** — v1 SPA:
**solo privado** + copy “guardar en mis links”). UI SHALL mostrar resultado:
creado / ya existía (`alreadyInGroups` o id existente) / error. NO `MAY` silencioso.

### D5 — SPA

`/descubrir` lazy auth; board select; degraded visible; cobertura copy (“LinkedIn y
Computrabajo no están disponibles vía discovery”); i18n; nav shell.

### D6 — Rate-limit

Por `userId+board`: **30/min**. Además egress global remoteok (D3). Fail-closed → 429.

### D7 — Config

`FEATURE_DISCOVERY` default false; `DISCOVERY_CHAIN=mock|live`; timeouts.

### D8 — Plan

Fila **28** `job-discovery`. **ADR-043**. design.md F3: discovery en plan activo.

## Risks / Trade-offs

- [Cambio API GoB] → versionar adapter + degraded.
- [Dump RemoteOK] → cache + egress limiter obligatorios.

## Migration Plan

Flag off. Rollback: nav + flag.

## Open Questions

Ninguna.

## Reflect (iteración 1)

| Hallazgo | Origen | Decisión | Motivo |
|---|---|---|---|
| GoB sin contrato | P0 critic | Aceptado D3 | Endpoint público anclado |
| RemoteOK dump | P0 critic | Aceptado D3 | Cache + egress + cap |
| page/cap/429 ausentes | P0 critic | Aceptado D2 | Spec completa |
| Feedback guardar | V0 business | Aceptado D4 | Loop discovery→vault |
| groupId picker | V1 | Diferido | Solo privado en v1 |
| url canónica | P1 | Aceptado D2/D3 | Round-trip registry |
