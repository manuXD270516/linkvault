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
**creado**, **ya existía** o **error** (no silencioso). Las confirmaciones de
**creado** y **ya existía** SHALL referirse al destino al que se guardó: con
destino grupo SHALL nombrar el grupo (creado: se guardó en G; ya existía: ya
estaba en G); con destino privado, la de creado SHALL nombrar el destino
privado y la de ya existía SHALL decir que el usuario ya la tenía. Ese destino
SHALL ser el fijado al pulsar Guardar, no el que tenga el selector después. Si
el nombre del grupo ya no está disponible, SHALL referirse a «el grupo» sin
nombrarlo y SHALL NOT contener el texto del destino privado. Sin grupos o si
falla cargar grupos: SHALL ofrecer solo privado (y aviso no bloqueante si hubo
error de carga).

#### Scenario: Buscar y guardar privado (default)

- **GIVEN** Ana en `/descubrir` con discovery habilitado y destino Privado
- **WHEN** busca y pulsa Guardar en un hit
- **THEN** SHALL invocarse `POST /api/links` **sin** `groupId`
- **AND** SHALL mostrarse feedback de creado o ya existía
- **AND** si fue creado, la confirmación de creado SHALL nombrar el destino privado

#### Scenario: Guardar en un grupo

- **GIVEN** Ana eligió el grupo G como destino
- **WHEN** pulsa Guardar en un hit y la API responde creado
- **THEN** la petición SHALL incluir `groupId` de G
- **AND** la confirmación de creado SHALL nombrar G
- **AND** la confirmación de creado SHALL NOT contener el texto del destino privado

#### Scenario: Guardar en un grupo que ya la tenía

- **GIVEN** Ana eligió el grupo G como destino
- **WHEN** pulsa Guardar en un hit que ya estaba en G (`already_there`)
- **THEN** la confirmación de ya existía SHALL decir que ya estaba en G
- **AND** SHALL NOT decir que Ana ya la tenía guardada

#### Scenario: Cambiar el destino después de guardar

- **GIVEN** Ana guardó un hit en el grupo G y ve su confirmación de creado
- **WHEN** cambia el selector de destino a Privado
- **THEN** la confirmación de ese hit SHALL seguir nombrando G

#### Scenario: Grupo del guardado ya no disponible

- **GIVEN** Ana guardó un hit en el grupo G y ve su confirmación de creado
- **WHEN** la lista de grupos se recarga sin G
- **THEN** la confirmación de creado SHALL decir que se guardó en el grupo
- **AND** SHALL NOT contener el texto del destino privado
- **AND** si la API había respondido ya existía, la confirmación SHALL decir que ya estaba en el grupo y SHALL NOT
  decir que Ana ya la tenía guardada

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
