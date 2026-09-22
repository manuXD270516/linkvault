## RENAMED Requirements

- FROM: `### Requirement: Postulación estancada, solo modelada`
- TO: `### Requirement: Postulación estancada con productor`

## MODIFIED Requirements

### Requirement: Postulación estancada con productor

`libs/shared` SHALL exportar el evento de integración versionado `ApplicationStale.v1`, con el identificador de la
postulación, su dueño, su link, su estado, la fecha de su último cambio de estado (`statusChangedAt`) y el umbral de
días (10) que lo define, validado con zod. El **worker** SHALL producir este evento según
`notifications/stale-applications` y el dueño MAY recibir aviso email/push según preferencias. NO SHALL usarse
`updatedAt` para el umbral.

#### Scenario: El contrato existe

- **WHEN** se valida un evento `ApplicationStale.v1` con todos sus campos
- **THEN** el schema SHALL aceptarlo
- **AND** SHALL rechazar el mismo evento con otro tipo o sin el identificador de la postulación

#### Scenario: Se produce en F2

- **GIVEN** una postulación activa elegible por antigüedad de `statusChangedAt`
- **WHEN** corre el detector de estancamiento
- **THEN** SHALL emitirse `ApplicationStale.v1` hacia el pipeline de notificaciones

## ADDED Requirements

### Requirement: Cambio de estado visible encola aviso de grupo

Cuando una postulación con `visibility` `group` cambie de **estado canónico**, el caso de uso SHALL escribir en la
misma unidad de commit un evento outbox `ApplicationStatusNotify.v1` (fan-out `application_status_group`). El request
MAY incluir `groupId` opcional (contexto de UI de un grupo) que viaja en el evento y acota el fan-out. Si se envía
`groupId`, la api SHALL aceptarlo solo si existe relación del `linkId` con ese grupo y el actor es miembro; si no,
SHALL responder `400`/`422` con error tipado y NO SHALL encolar. Un cambio solo de `stageLabel` NO SHALL encolar. Si la
visibilidad es `private`, NO SHALL encolarse.

#### Scenario: Cambio compartido

- **GIVEN** Ana con postulación `visibility` `group`
- **WHEN** cambia el estado canónico
- **THEN** SHALL quedar evento de notificación pendiente en `outbox_events`

#### Scenario: Cambio privado

- **GIVEN** Ana con postulación `private`
- **WHEN** cambia el estado
- **THEN** NO SHALL encolarse fan-out `application_status_group`

#### Scenario: Solo stageLabel

- **GIVEN** Ana con postulación `visibility` `group`
- **WHEN** cambia solo `stageLabel`
- **THEN** NO SHALL encolarse `application_status_group`

#### Scenario: Cambio acotado a un grupo

- **GIVEN** Ana cambia estado desde el contexto del grupo A (`groupId` en el request) y es miembro con el link en A
- **WHEN** se escribe el outbox
- **THEN** el evento SHALL incluir `groupId` A

#### Scenario: groupId ajeno rechazado

- **GIVEN** Ana intenta enviar `groupId` de un grupo donde el link no está o ella no es miembro
- **WHEN** cambia el estado
- **THEN** la API SHALL responder error de validación/negocio
- **AND** NO SHALL quedar evento de notificación pendiente
