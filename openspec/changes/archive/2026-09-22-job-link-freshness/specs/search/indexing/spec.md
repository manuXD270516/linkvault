## ADDED Requirements

### Requirement: Reindexación tras cierre de vacante y auto-expire

Con `FEATURE_SEARCH=true`, al cerrar un JobLink y al auto-expirar postulaciones, el sistema SHALL
dejar el índice eventualmente consistente:

- el documento `job_preview` SHALL incluir el campo indexado `closedAt` (ISO datetime) cuando la
  vacante está cerrada, y NO SHALL afirmar cierre cuando está abierta (campo ausente o nulo según
  el esquema del índice);
- cada `application` afectada SHALL reflejar `status` `expired`.

El fingerprint del upsert SHALL incorporar `closedAt` / status. Con `FEATURE_SEARCH=false`, NO
SHALL exigirse escritura Search. Sin dual-write síncrono a Meili en la txn de cierre.

#### Scenario: Preview cerrado se reindexa con closedAt

- **GIVEN** `FEATURE_SEARCH=true` y un `job_preview` indexado abierto
- **WHEN** el link se cierra
- **THEN** tras el upsert el documento SHALL llevar `closedAt` con el instante de cierre

#### Scenario: Application expired se reindexa

- **GIVEN** `FEATURE_SEARCH=true` y una postulación indexada en `applied`
- **WHEN** se auto-expira por cierre de vacante
- **THEN** tras el upsert el documento `application` SHALL tener status `expired`

#### Scenario: Flag search apagado

- **GIVEN** `FEATURE_SEARCH=false`
- **WHEN** un link se cierra
- **THEN** NO SHALL exigirse ningún evento Search*
