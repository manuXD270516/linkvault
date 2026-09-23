## MODIFIED Requirements

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

#### Scenario: Opt-out de digest

- **GIVEN** Ana autenticada
- **WHEN** hace `PATCH` con `groupWeeklyDigest` `false`
- **THEN** la respuesta `200` SHALL reflejar ese tipo deshabilitado
- **AND** un job de digest posterior NO SHALL enviar email a Ana
