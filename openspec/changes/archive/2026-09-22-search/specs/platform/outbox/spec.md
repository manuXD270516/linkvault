## ADDED Requirements

### Requirement: Cola(s) de indexación de búsqueda

Los eventos de integración de indexación y borrado de búsqueda de este change SHALL declararse en el contrato compartido
con cola propia (o colas por familia documentadas), schema zod y `jobId` determinista basado en hash de contenido
indexable (`search:{docType}:{aggregateId}:{contentHash}`), igual que el resto de tipos del outbox. El relay SHALL
publicarlos cuando esté habilitado **y** `FEATURE_SEARCH=true` haya permitido su escritura; con relay apagado SHALL
permanecer pendientes en `outbox_events`. Un tipo desconocido seguirá la regla general de `failed` sin silencio.

#### Scenario: Tipo de indexación en el registro

- **WHEN** existe un evento pendiente de upsert o delete de búsqueda
- **THEN** el relay (encendido) SHALL publicarlo en su cola con `jobId` determinista por content hash
- **AND** un tipo desconocido seguirá la regla general de `failed` sin silencio

#### Scenario: Indexación no comparte cola con enrich

- **GIVEN** un evento de indexación y uno de enriquecimiento de link pendientes
- **WHEN** corre el relay
- **THEN** cada uno SHALL publicarse en la cola de su tipo
- **AND** el job de indexación NO SHALL aparecer en la cola de enrich-link
