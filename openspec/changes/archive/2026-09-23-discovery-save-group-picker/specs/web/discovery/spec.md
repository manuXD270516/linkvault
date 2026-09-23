## MODIFIED Requirements

### Requirement: Página /descubrir

La SPA SHALL exponer `/descubrir` (lazy, auth) con búsqueda, selector de board
(getonboard / remoteok / todas), lista de resultados y acción Guardar por hit.
SHALL ofrecer un selector de **destino de página**: lista privada (default) o
un grupo del que el usuario es miembro. Copy i18n ES/EN, incluida cobertura
(“LinkedIn/Computrabajo no vía discovery”) y el destino actual. Si la API
devuelve `degraded`, SHALL mostrarlo. Con `503` discovery_disabled, SHALL empty
honesto. Guardar SHALL usar el cliente de links (`POST /api/links`) con `{ url }`
o `{ url, groupId }` según el destino, y SHALL mostrar confirmación de
**creado**, **ya existía** o **error** (no silencioso). Sin grupos o si falla
cargar grupos: SHALL ofrecer solo privado (y aviso no bloqueante si hubo error
de carga).

#### Scenario: Buscar y guardar privado (default)

- **GIVEN** Ana en `/descubrir` con discovery habilitado y destino Privado
- **WHEN** busca y pulsa Guardar en un hit
- **THEN** SHALL invocarse `POST /api/links` **sin** `groupId`
- **AND** SHALL mostrarse feedback de creado o ya existía

#### Scenario: Guardar en un grupo

- **GIVEN** Ana eligió el grupo G como destino
- **WHEN** pulsa Guardar en un hit
- **THEN** la petición SHALL incluir `groupId` de G
- **AND** SHALL mostrarse feedback de creado o ya existía

#### Scenario: Sin grupos

- **GIVEN** Ana no pertenece a ningún grupo
- **WHEN** ve el selector de destino
- **THEN** SHALL ofrecer solo Privado

#### Scenario: Falló listar grupos

- **GIVEN** la carga de grupos falla
- **WHEN** Ana ve el selector
- **THEN** SHALL ofrecer solo Privado
- **AND** SHALL mostrar aviso no bloqueante
- **AND** SHALL poder guardar en privado

#### Scenario: Grupo seleccionado ya no está en la lista

- **GIVEN** Ana tenía seleccionado el grupo G
- **WHEN** se recarga la lista y G no aparece
- **THEN** el destino SHALL resetear a Privado

#### Scenario: groupId inválido al guardar

- **GIVEN** destino con `groupId` que la API rechaza (`404 group_not_found`)
- **WHEN** Ana pulsa Guardar
- **THEN** SHALL mostrarse feedback de **error** (sin inventar éxito ni endpoint nuevo)

#### Scenario: Degradación visible

- **GIVEN** la API incluye `degraded`
- **WHEN** Ana ve resultados
- **THEN** SHALL ver aviso de bolsa no disponible además de los hits
