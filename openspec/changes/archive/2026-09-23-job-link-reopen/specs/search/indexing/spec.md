## MODIFIED Requirements

### Requirement: Reindexación tras cierre de vacante y auto-expire

Con `FEATURE_SEARCH=true`, al cerrar un JobLink, al **reabrir** uno, y al auto-expirar
postulaciones, el sistema SHALL dejar el índice eventualmente consistente:

- el documento `job_preview` SHALL incluir `closedAt` (ISO datetime) cuando la vacante está
  **cerrada**;
- cuando la vacante está **abierta** (incluido tras reopen), el documento indexado SHALL
  llevar **`closedAt: null`** (clear de merge parcial Meili; `openOnly` → `closedAt IS NULL`);
- cada `application` afectada por auto-expire SHALL reflejar `status` `expired`.

El fingerprint del upsert SHALL incorporar `closedAt` / status (y un sufijo distinto en reopen).
Con `FEATURE_SEARCH=false`, NO SHALL exigirse escritura Search. Sin dual-write síncrono a Meili
en la txn de cierre/reopen.

#### Scenario: Preview cerrado se reindexa con closedAt

- **GIVEN** `FEATURE_SEARCH=true` y un `job_preview` indexado abierto
- **WHEN** el link se cierra
- **THEN** tras el upsert el documento SHALL llevar `closedAt` con el instante de cierre

#### Scenario: Preview reabierto limpia closedAt en el índice

- **GIVEN** `FEATURE_SEARCH=true` y un `job_preview` con `closedAt` ISO
- **WHEN** el link se reabre
- **THEN** tras el upsert el documento SHALL tener `closedAt: null`
- **AND** una query `openOnly=true` SHALL poder devolver ese hit

#### Scenario: Application expired se reindexa

- **GIVEN** `FEATURE_SEARCH=true` y una postulación indexada en `applied`
- **WHEN** se auto-expira por cierre de vacante
- **THEN** tras el upsert el documento `application` SHALL tener status `expired`

#### Scenario: Flag search apagado

- **GIVEN** `FEATURE_SEARCH=false`
- **WHEN** un link se cierra o se reabre
- **THEN** NO SHALL exigirse ningún evento Search*
