## ADDED Requirements

### Requirement: Cola(s) de notificación

Los eventos de integración de notificación de este change SHALL declararse en el contrato compartido con cola propia,
schema zod y `jobId` determinista, igual que el resto de tipos del outbox. El relay SHALL publicarlos cuando esté
habilitado; con relay apagado SHALL permanecer pendientes en `outbox_events`.

#### Scenario: Tipo de notificación en el registro

- **WHEN** existe un evento pendiente de tipo de notificación de producto
- **THEN** el relay (encendido) SHALL publicarlo en su cola con `jobId` determinista
- **AND** un tipo desconocido seguirá la regla general de `failed` sin silencio
