# groups/know-someone Specification

## Purpose

Flag por miembro “conozco a alguien ahí” en links compartidos a un grupo (B11), con conteo
visible y sin exponer identidades en V0.

## Requirements

### Requirement: Flag know-someone por miembro

Un miembro del grupo SHALL poder marcar o desmarcar que conoce a alguien en la vacante del link
en ese grupo. Persistencia en `group_links.knowSomeoneUserIds` sin duplicados, vía actualización
atómica (`$addToSet` / `$pull`). `PUT /api/groups/:groupId/links/:linkId/know-someone` con body
`{ flagged: boolean }` SHALL responder `200` con `{ flaggedByMe: boolean, count: number }`
(schema shared). No miembro / grupo inválido: `404 group_not_found`. Relación ausente:
`404 link_not_found`.

#### Scenario: Marcar

- **GIVEN** Ana miembro de G y link L en G sin su flag
- **WHEN** Ana envía `flagged=true`
- **THEN** la respuesta SHALL ser `200` con `flaggedByMe=true` y `count` ≥ 1

#### Scenario: Desmarcar

- **GIVEN** Ana ya marcada en G/L
- **WHEN** Ana envía `flagged=false`
- **THEN** `flaggedByMe` SHALL ser `false` y su id NO SHALL permanecer en el conjunto

#### Scenario: No miembro

- **GIVEN** Luis no es miembro de G
- **WHEN** intenta el PUT
- **THEN** SHALL responder `404` con código `group_not_found`
- **AND** el conjunto NO SHALL cambiar

#### Scenario: Relación inexistente

- **GIVEN** Ana miembro de G y L no está en G
- **WHEN** intenta el PUT
- **THEN** SHALL responder `404` con código `link_not_found`

### Requirement: Visibilidad en listado de grupo

Cada ítem de `GET /api/groups/:id/links` SHALL incluir `knowSomeone: { count, flaggedByMe }`.
La lista privada y respuestas de guardado privado NO SHALL incluir `knowSomeone`. V0 NO SHALL
exponer userIds ni displayNames de quienes marcaron.

#### Scenario: Conteo visible

- **GIVEN** dos miembros marcaron el flag
- **WHEN** un tercero lista el grupo
- **THEN** el ítem SHALL tener `count` = 2 y `flaggedByMe` = false
