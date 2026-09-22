## ADDED Requirements

### Requirement: Bucket de CV cifrado en reposo en producción

En producción, el bucket de CV del almacén S3-compatible SHALL tener **cifrado en reposo** activado mediante SSE del
proveedor (SSE-S3 o equivalente documentado en MinIO/S3). La política de retención del CV SHALL quedar documentada en
`infra/README.md` o `docs/RUNBOOK.md`: por defecto **sin borrado automático** del objeto de CV (no lifecycle de
caducidad del archivo personal); el cifrado permanece activo. El aviso `/privacidad` MAY describir cifrado y esa
retención cuando el entorno los tenga.

#### Scenario: SSE en el bucket de CV de prod

- **GIVEN** el object store de producción aprovisionado según la documentación
- **WHEN** se sube un CV
- **THEN** el objeto SHALL almacenarse con cifrado en reposo SSE del proveedor
- **AND** la configuración documentada NO SHALL dejar el bucket de CV sin cifrado

#### Scenario: Sin caducidad automática del CV

- **GIVEN** la política de retención documentada para el bucket de CV
- **WHEN** un operador la revisa
- **THEN** NO SHALL exigirse un lifecycle que borre CVs a los N días por defecto
- **AND** SHALL constar que la retención por defecto es conservar el objeto hasta borrado de cuenta o eliminación
  explícita del CV

### Requirement: Retención de snapshots de enriquecimiento

El bucket (o prefijo) de snapshots de enriquecimiento en producción SHALL aplicar una retención de **30 días** (lifecycle
o TTL equivalente del proveedor), de modo que los objetos de snapshot caduquen sin intervención manual diaria.

#### Scenario: Snapshot caduca a los 30 días

- **GIVEN** un snapshot de enriquecimiento escrito hace más de 30 días
- **WHEN** corre la regla de lifecycle del bucket de snapshots
- **THEN** el objeto SHALL eliminarse o quedar marcado para eliminación según el proveedor
- **AND** un snapshot reciente (< 30 días) NO SHALL eliminarse por esa regla

### Requirement: Recogida de objetos huérfanos documentada

`docs/RUNBOOK.md` SHALL documentar el procedimiento para listar y borrar objetos huérfanos del bucket de CV (p. ej. bajo
un `userId/` sin documento `cv_documents` asociado, o restos tras un fallo parcial), incluyendo comandos o pasos del
cliente S3/MinIO compatibles. La recogida MAY ser manual; NO SHALL exigirse un job automático en este change.

#### Scenario: Operador limpia huérfanos

- **GIVEN** un objeto en el bucket de CV sin documento de CV que lo referencie
- **WHEN** el operador sigue el procedimiento del RUNBOOK
- **THEN** SHALL poder identificar el objeto huérfano
- **AND** SHALL poder eliminarlo del almacén sin afectar a CVs referenciados
