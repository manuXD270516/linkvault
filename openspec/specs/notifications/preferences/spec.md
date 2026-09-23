# notifications/preferences Specification

## Purpose

Define preferencias de notificación por usuario: opt-out por tipo de aviso y si se reciben avisos de las propias
acciones, con defaults seguros tras verificar el email.

## Requirements

### Requirement: Tipos y defaults

El sistema SHALL persistir por usuario preferencias para los tipos `group_new_link`,
`application_status_group`, `application_stale` y **`group_weekly_digest`**, cada uno habilitado
por defecto (`true`), el flag `notifyOwnActions` con default `true`, y el campo opcional
`applicationStatusGroupId` (`string` de grupo o ausente/null = sin acotar). Ausencia de documento
SHALL equivaler a esos defaults.

#### Scenario: Sin documento = todo ON

- **GIVEN** un usuario verificado sin fila de preferencias
- **WHEN** se evalúa si recibe `group_new_link`
- **THEN** SHALL tratarse como habilitado
- **AND** `notifyOwnActions` SHALL tratarse como `true`
- **AND** `applicationStatusGroupId` SHALL tratarse como no acotado
- **AND** `group_weekly_digest` SHALL tratarse como habilitado

### Requirement: Lectura y actualización autenticadas

`GET /api/notifications/preferences` SHALL devolver las preferencias efectivas del usuario
autenticado (`200`), **incluyendo** `groupWeeklyDigest`. `PATCH /api/notifications/preferences`
SHALL aceptar un subconjunto de campos (tipos existentes, **`groupWeeklyDigest`**,
`notifyOwnActions` y/o `applicationStatusGroupId`), validar con zod y responder `200` con el
estado resultante. Sin sesión SHALL responder `401`. NO SHALL exponerse ni mutarse vía
`PATCH /api/users/me`.

#### Scenario: Opt-out de un tipo

- **GIVEN** Ana autenticada
- **WHEN** hace `PATCH` con `group_new_link` `false`
- **THEN** la respuesta `200` SHALL reflejar ese tipo deshabilitado
- **AND** un fan-out posterior de nuevo link NO SHALL incluir a Ana

#### Scenario: Opt-out de digest

- **GIVEN** Ana autenticada
- **WHEN** hace `PATCH` con `groupWeeklyDigest` `false`
- **THEN** la respuesta `200` SHALL reflejar ese tipo deshabilitado
- **AND** un job de digest posterior NO SHALL enviar email a Ana

#### Scenario: Configurar groupId de alcance

- **GIVEN** Ana autenticada y miembro del grupo G
- **WHEN** hace `PATCH` con `applicationStatusGroupId` = G
- **THEN** la respuesta `200` SHALL reflejar ese id
- **AND** un `application_status_group` sin `groupId` de evento SHALL acotarse a G

#### Scenario: groupId de preferencia no miembro

- **GIVEN** Ana no es miembro del grupo X
- **WHEN** hace `PATCH` con `applicationStatusGroupId` = X
- **THEN** la API SHALL rechazar con error tipado
- **AND** NO SHALL persistirse X

#### Scenario: Sin sesión

- **WHEN** un cliente llama `GET /api/notifications/preferences` sin `Authorization`
- **THEN** la respuesta SHALL ser `401` con código `unauthorized`

### Requirement: Email de producto exige verificación

Aunque un tipo esté habilitado, el canal **email** de notificaciones de producto NO SHALL enviarse si
`emailVerified` es `false`. El opt-out y el push se evalúan aparte (ver `notifications/dispatch` y
`notifications/web-push`).

#### Scenario: No verificado no recibe email de grupo

- **GIVEN** Ana con email no verificado y preferencias por defecto
- **WHEN** ocurre un `group_new_link` hacia Ana
- **THEN** NO SHALL enviarse email de ese aviso a Ana
