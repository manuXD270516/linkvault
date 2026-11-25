## Purpose

Tarjeta «Tu semana» del SPA: muestra arriba del tablero de postulaciones las acciones del plan semanal con su motivo,
deja marcarlas y ofrece un borrador de seguimiento copiable, sin actuar nunca hacia fuera.

## ADDED Requirements

### Requirement: Tarjeta «Tu semana» en el tablero

Cuando el tablero de `/postulaciones` tiene al menos una postulación, el SPA SHALL mostrar encima de las columnas, a todo
el ancho y también en pantallas móviles, la tarjeta «Tu semana» con las acciones de `GET /api/applications/weekly-plan`.
Cada acción SHALL mostrar el nombre de la oferta (título, o `displayUrl` sin título) y su motivo en una sola línea en
lenguaje llano construido desde `reason`, y los botones «Abrir», «Hecho», «Descartar» y «La semana que viene», cada uno
con un área táctil de al menos 44 px de alto. La tarjeta SHALL tener estado de carga, estado vacío («No hay nada urgente
esta semana.», con «Hiciste N esta semana.» si `doneThisWeek` > 0) y estado de error con «Reintentar»; un error del
plan NO SHALL impedir usar el tablero. Con el tablero vacío la tarjeta NO SHALL mostrarse. Todos los textos SHALL estar
en el catálogo i18n en español e inglés.

#### Scenario: Tres acciones visibles

- **GIVEN** Ana con un plan de tres acciones
- **WHEN** abre `/postulaciones`
- **THEN** SHALL ver la tarjeta «Tu semana» encima de las columnas con tres acciones, cada una con su motivo

#### Scenario: Vacío honesto

- **GIVEN** Ana con postulaciones y un plan sin acciones
- **WHEN** abre `/postulaciones`
- **THEN** la tarjeta SHALL decir «No hay nada urgente esta semana.»

#### Scenario: Error del plan

- **GIVEN** `GET /api/applications/weekly-plan` responde `500`
- **WHEN** Ana abre `/postulaciones`
- **THEN** la tarjeta SHALL mostrar «No pudimos armar tu semana.» y «Reintentar»
- **AND** las columnas del tablero SHALL mostrarse y permitir mover postulaciones

#### Scenario: Móvil

- **GIVEN** un viewport de 390 px de ancho
- **WHEN** Ana abre `/postulaciones` con un plan de tres acciones
- **THEN** la tarjeta SHALL estar encima de las columnas y cada botón de acción SHALL medir al menos 44 px de alto

### Requirement: Acciones de la tarjeta

«Hecho», «Descartar» y «La semana que viene» SHALL enviar `POST /api/applications/weekly-plan/decisions` con
`done`, `dismissed` y `snoozed` respectivamente, deshabilitar los botones de esa acción mientras la petición viaja y
reemplazar el plan por el de la respuesta. «Abrir» SHALL abrir el detalle de la postulación en el tablero, salvo en
`ask_know_someone`, donde SHALL navegar a `/grupos/:groupId`. Ningún botón SHALL abrir la oferta externa, enviar
mensajes ni cambiar el estado de una postulación.

#### Scenario: Marcar hecho

- **GIVEN** la tarjeta con tres acciones
- **WHEN** Ana pulsa «Hecho» en la primera
- **THEN** el SPA SHALL enviar la decisión `done` con su `candidateId`
- **AND** la tarjeta SHALL mostrar el plan de la respuesta, sin esa acción

#### Scenario: Abrir quien conoce a alguien

- **GIVEN** una acción `ask_know_someone` con `groupId` G
- **WHEN** Ana pulsa «Abrir»
- **THEN** el SPA SHALL navegar a `/grupos/G`

### Requirement: Borrador de seguimiento por plantilla

En una acción `follow_up` el SPA SHALL ofrecer «Preparar seguimiento», que muestra un borrador de 3 a 4 líneas en el
idioma de la interfaz, armado localmente con el título, la empresa y la fecha de postulación (o los días desde el último
cambio) de la acción, y un botón «Copiar» que lo copia al portapapeles. Sin título ni empresa SHALL usar expresiones
genéricas. El SPA NO SHALL llamar a la IA, NO SHALL proponer destinatario ni enlace `mailto` y NO SHALL guardar el
borrador.

#### Scenario: Copiar el borrador

- **GIVEN** una acción `follow_up` de «Mobile Developer» en «Startup Andes»
- **WHEN** Ana pulsa «Preparar seguimiento» y después «Copiar»
- **THEN** el portapapeles SHALL contener un texto que nombra «Mobile Developer» y «Startup Andes»
- **AND** NO SHALL haberse hecho ninguna petición HTTP por esa acción
