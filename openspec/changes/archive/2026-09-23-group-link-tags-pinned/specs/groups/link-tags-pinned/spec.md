## Purpose

Organizar links del grupo con etiquetas libres acotadas y un flag de fijado,
más filtros de listado, sin reordenar el cursor existente.

## ADDED Requirements

### Requirement: Tags en group_links

Un miembro del grupo SHALL poder reemplazar el conjunto de tags de un link en
ese grupo vía `PUT /api/groups/:groupId/links/:linkId/tags` con body
`{ tags: string[] }` (schema shared). El servidor SHALL normalizar (trim,
lowercase, colapsar espacios, descartar vacíos, dedupe) y aplicar caps: máximo
8 tags; cada tag tras normalizar MUST cumplir
`^[a-z0-9][a-z0-9\- ]{0,31}$`. Body o tag inválido → `400`. No miembro / grupo
inválido → `404 group_not_found`. Relación ausente → `404 link_not_found`.
Respuesta `200` slim `{ tags: string[] }` (ya normalizados). Array vacío (o
solo vacíos) SHALL borrar todos los tags. Mutación SIN outbox.

#### Scenario: Reemplazar tags

- **GIVEN** Ana miembro de G y link L en G
- **WHEN** Ana envía `tags: ["Remote", " remote ", "Backend"]`
- **THEN** la respuesta SHALL ser `200` con `tags` conteniendo exactamente
  `["remote", "backend"]` (orden de primera aparición)

#### Scenario: Caps excedidos

- **GIVEN** Ana miembro y L en G
- **WHEN** envía más de 8 tags distintos tras normalizar
- **THEN** SHALL responder `400` y el documento NO SHALL cambiar

#### Scenario: No miembro

- **GIVEN** Luis no es miembro de G
- **WHEN** intenta el PUT de tags
- **THEN** SHALL responder `404` con código `group_not_found`

### Requirement: Pinned en group_links

Un miembro del grupo SHALL poder fijar o desfijar un link vía
`PUT /api/groups/:groupId/links/:linkId/pinned` con body `{ pinned: boolean }`.
Mismas reglas ACL que tags (`404 group_not_found` / `link_not_found`).
Respuesta `200` slim `{ pinned: boolean }`. Default de lectura si ausente:
`false`.

#### Scenario: Fijar

- **GIVEN** Ana miembro y L en G con `pinned=false`
- **WHEN** envía `pinned=true`
- **THEN** `200` con `pinned=true`

#### Scenario: Relación inexistente

- **GIVEN** Ana miembro y L no está en G
- **WHEN** intenta el PUT de pinned
- **THEN** SHALL responder `404` con código `link_not_found`

### Requirement: Visibilidad y filtros en listado de grupo

Cada ítem de `GET /api/groups/:id/links` SHALL incluir `tags: string[]` y
`pinned: boolean`. La lista privada y respuestas de guardado privado NO SHALL
incluir esos campos. El listado SHALL seguir orden `(sharedAt DESC, _id)`
(pin NO reordena). Query opcional `pinned=true|false` y `tag=<valor>` (un tag
normalizado) SHALL filtrar en servidor; `total`/count SHALL usar el mismo
match. Valor de query inválido → `400`.

#### Scenario: Campos en listado

- **GIVEN** L en G con tags `["backend"]` y `pinned=true`
- **WHEN** un miembro lista el grupo
- **THEN** el ítem SHALL exponer esos `tags` y `pinned`

#### Scenario: Filtro solo fijados

- **GIVEN** dos links en G, uno pinned
- **WHEN** se lista con `pinned=true`
- **THEN** la página SHALL contener solo el fijado y el total SHALL ser 1

#### Scenario: Filtro por tag

- **GIVEN** un link con tag `remote` y otro sin él
- **WHEN** se lista con `tag=Remote`
- **THEN** solo el primero SHALL aparecer (match tras normalizar)

#### Scenario: Sin pin-to-top

- **GIVEN** el link más antiguo está pinned y hay uno más reciente no pinned
- **WHEN** se lista sin filtro
- **THEN** el más reciente SHALL aparecer antes (orden por `sharedAt`)

### Requirement: Sin fuga a superficies no-grupo

Tags y pinned de `group_links` NO SHALL aparecer en `/p/:slug`, en el digest
semanal, ni en índices Meili. Las mutaciones NO SHALL encolar outbox/SearchUpsert.

#### Scenario: Preview pública

- **GIVEN** un link de grupo con tags y pinned
- **WHEN** se obtiene el preview público
- **THEN** la respuesta NO SHALL incluir `tags` ni `pinned` de grupo
