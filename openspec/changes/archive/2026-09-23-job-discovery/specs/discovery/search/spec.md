## Purpose

Permite buscar vacantes en bolsas con API pública (Get on Board, Remote OK) y obtener
hits listos para guardar en el vault, con degradación honesta si una bolsa falla.

## ADDED Requirements

### Requirement: Buscar vacantes en bolsas

Con `FEATURE_DISCOVERY=true`, una persona autenticada SHALL poder llamar
`GET /api/discovery/search` con:

- `q` (string; vacío permitido según D2 del design),
- `board` (`getonboard` | `remoteok` | `all`; default `all`),
- `page` (entero ≥ 1; default 1),
- `pageSize` (1..20; default 10; **cap de hits por board**).

El sistema SHALL consultar solo adapters registrados. Cada hit SHALL incluir
`board`, `title`, `url` (canónica para el registry de links). Si un board falla, hace
timeout o responde 429 upstream, SHALL devolver resultados parciales con `degraded[]` y
NO SHALL responder 500 solo por ese board. Sin autenticación: `401`. Flag off: `503`
`discovery_disabled`. Rate-limit usuario: `429` `too_many_attempts` + `Retry-After`.
NO SHALL usar headless ni scrape de boards robots-blocked.

Get on Board SHALL usar `GET https://www.getonbrd.com/api/v0/search/jobs` (API pública).
Remote OK SHALL usar `GET https://remoteok.com/api` con **cache Redis obligatoria** del
dump y limiter de egress; filtrar/paginar en proceso hasta `pageSize`.

#### Scenario: Búsqueda getonboard

- **GIVEN** `FEATURE_DISCOVERY=true` y Ana autenticada
- **WHEN** `GET /api/discovery/search?q=react&board=getonboard&page=1&pageSize=10`
- **THEN** SHALL devolver 200 con `results` (≤10) y `page`/`pageSize`

#### Scenario: Board degradado en all

- **GIVEN** remoteok timeout y getonboard OK
- **WHEN** `board=all`
- **THEN** SHALL incluir hits de getonboard y `degraded` nombrando remoteok

#### Scenario: Flag off

- **GIVEN** `FEATURE_DISCOVERY=false`
- **WHEN** Ana llama search
- **THEN** SHALL `503` `discovery_disabled`

#### Scenario: Sin auth

- **GIVEN** petición sin access token
- **WHEN** llama search
- **THEN** SHALL `401`

#### Scenario: Rate-limit

- **GIVEN** Ana excedió 30 req/min al board
- **WHEN** llama search
- **THEN** SHALL `429` `too_many_attempts` con `Retry-After`

### Requirement: Guardar desde discovery reusa links

El cliente SHALL guardar un hit vía `POST /api/links` con la `url` del hit. El servidor
de discovery NO SHALL exponer un endpoint de save propio.

#### Scenario: CTA guarda link

- **GIVEN** un hit con url getonboard canónica
- **WHEN** Ana confirma Guardar
- **THEN** SHALL crearse o deduplicarse el JobLink por el camino existente de save
