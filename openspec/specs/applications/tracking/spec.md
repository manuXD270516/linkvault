# applications/tracking Specification

## Purpose

Deja que cada persona siga sus procesos de selección sobre las ofertas que ve en LinkVault: una postulación por oferta,
con los estados canónicos de ADR-004, una etapa libre mientras está en proceso, un historial de cada cambio y notas
propias, sin que dos pestañas se pisen, y la posibilidad de dejar de seguirla del todo.

## Requirements

### Requirement: Seguir una oferta

`POST /api/applications` SHALL aceptar `linkId`, `status` (uno de los estados canónicos), `stageLabel` (solo con
`in_process`) y `appliedAt` (opcional, según "Fecha de postulación"), y crear la postulación de quien pide sobre ese link con
`visibility` `private`, `version` 1 y un primer evento de historial sin estado de origen. SHALL responder `201` con
`{ application, created: true }`. Si esa persona ya seguía ese link, SHALL responder `201` con
`{ application, created: false }` y la postulación existente **sin cambiarla**. Solo SHALL poder seguirse un link que
esa persona puede ver —en su lista privada o en un grupo del que es miembro—; cualquier otro, o un `linkId` mal formado,
SHALL responder `404` con código `link_not_found` y el mismo cuerpo en todos los casos. Guardar, importar o compartir un
link NO SHALL crear ninguna postulación.

#### Scenario: "Postulé" desde la tarjeta

- **GIVEN** un miembro de un grupo que ve un link compartido allí y no lo sigue
- **WHEN** pide seguirlo con `status` `applied`
- **THEN** la respuesta SHALL ser `201` con `created` `true`, `status` `applied`, `visibility` `private` y `version` 1
- **AND** su historial SHALL tener un único evento, sin estado de origen y con destino `applied`

#### Scenario: "Me interesa" desde la lista privada

- **GIVEN** un usuario con un link en su lista privada
- **WHEN** pide seguirlo con `status` `interested`
- **THEN** la respuesta SHALL ser `201` con `status` `interested`

#### Scenario: Guardar no es seguir

- **GIVEN** un usuario que acaba de guardar un link en un grupo y de importar un chat en su lista privada
- **WHEN** consulta sus postulaciones
- **THEN** la lista SHALL estar vacía

#### Scenario: Oferta que no se puede ver

- **WHEN** un usuario pide seguir un link que no está en su lista privada ni en ningún grupo suyo, otro que no existe y
  otro con el identificador `no-es-un-id`
- **THEN** las tres respuestas SHALL ser `404` con código `link_not_found` y cuerpos idénticos
- **AND** NO SHALL crearse ninguna postulación

#### Scenario: Ya la seguía

- **GIVEN** un usuario que sigue un link con `status` `in_process`
- **WHEN** vuelve a pedir seguirlo con `status` `interested`
- **THEN** la respuesta SHALL ser `201` con `created` `false` y `status` `in_process`
- **AND** su historial NO SHALL ganar ningún evento

### Requirement: Una postulación por persona y oferta

Cada persona SHALL tener como máximo una postulación por link, garantizado por un índice único sobre `(userId, linkId)`,
también ante peticiones simultáneas. Si un alta choca con ese índice y, al releer, la postulación ya no existe porque se
acaba de dejar de seguir, el alta SHALL repetirse una vez en lugar de fallar. El mismo link SHALL poder tener
postulaciones de muchas personas a la vez.

#### Scenario: Dos pestañas pulsan a la vez

- **GIVEN** un usuario que no sigue un link
- **WHEN** llegan a la vez una petición para seguirlo con `interested` y otra con `applied`
- **THEN** una respuesta SHALL tener `created` `true` y la otra `created` `false` con el estado de la primera
- **AND** SHALL existir una sola postulación con un solo evento de creación

#### Scenario: Seguir mientras otra pestaña deja de seguir

- **GIVEN** Ana, que sigue un link, y un alta suya sobre ese link que choca con el índice único
- **WHEN** antes de que esa alta relea la postulación existente, otra pestaña de Ana deja de seguirla
- **THEN** el alta SHALL repetirse y responder `201` con `created` `true`
- **AND** SHALL existir una sola postulación de Ana para ese link, con un solo evento

#### Scenario: Muchas personas, una oferta

- **GIVEN** un link compartido en un grupo con tres miembros
- **WHEN** los tres lo siguen
- **THEN** SHALL existir tres postulaciones de ese link, una por persona

### Requirement: Estados y transiciones

Los estados SHALL ser los canónicos de ADR-004: `saved`, `interested`, `applied`, `in_process`, `offer` y `accepted`,
y los de cierre `rejected`, `withdrawn` y `expired`. `PATCH /api/applications/:id/status` SHALL aceptar `status`,
`stageLabel`, `appliedAt` (opcional, según "Fecha de postulación") y la `version` que tiene quien pide, y SHALL permitir, desde
cualquier estado, pasar a cualquier otro: avanzar saltando etapas, retroceder para corregir un error, cerrar desde
cualquier estado y reabrir uno cerrado. Cada cambio efectivo SHALL subir `version` en 1 y escribir **exactamente un**
evento de historial con el estado de origen, el de destino, las etapas de ambos si las había y la fecha, **en la misma
escritura atómica** que el cambio: nunca SHALL quedar una postulación cambiada sin su evento ni un evento sin su cambio.
Una petición que deja el estado y la etapa como ya están SHALL responder `200` con la postulación sin escribir nada,
**sea cual sea la `version` enviada** y aunque traiga `appliedAt`. Un `status` desconocido SHALL responder `400` con
código `validation_error` nombrando `status`. La respuesta de un cambio SHALL ser `200` con la postulación actualizada.

#### Scenario: Saltar etapas

- **GIVEN** una postulación en `interested` con `version` 1
- **WHEN** su dueño la pasa a `in_process` con `version` 1
- **THEN** la respuesta SHALL ser `200` con `status` `in_process` y `version` 2
- **AND** el historial SHALL ganar un evento de `interested` a `in_process`

#### Scenario: Retroceder para corregir

- **GIVEN** una postulación en `applied`
- **WHEN** su dueño la devuelve a `interested`
- **THEN** la respuesta SHALL ser `200` con `status` `interested`
- **AND** el historial SHALL conservar el evento anterior y ganar uno de `applied` a `interested`

#### Scenario: Cerrar desde cualquier estado

- **GIVEN** una postulación en `interested`
- **WHEN** su dueño la pasa a `rejected`
- **THEN** la respuesta SHALL ser `200` con `status` `rejected`

#### Scenario: Reabrir una cerrada

- **GIVEN** una postulación en `rejected`
- **WHEN** su dueño la pasa a `in_process`
- **THEN** la respuesta SHALL ser `200` con `status` `in_process`

#### Scenario: Corregir un cierre

- **GIVEN** una postulación en `rejected`
- **WHEN** su dueño la pasa a `withdrawn`
- **THEN** la respuesta SHALL ser `200` con `status` `withdrawn`

#### Scenario: El mismo estado dos veces

- **GIVEN** una postulación en `applied` con `version` 3
- **WHEN** su dueño pide `applied` con `version` 3
- **THEN** la respuesta SHALL ser `200` con `version` 3
- **AND** el historial NO SHALL ganar ningún evento

#### Scenario: Sin cambios desde una pestaña vieja

- **GIVEN** una postulación en `applied` con `version` 4
- **WHEN** su dueño pide `applied` con `version` 2
- **THEN** la respuesta SHALL ser `200` con `status` `applied` y `version` 4
- **AND** el historial NO SHALL ganar ningún evento

#### Scenario: Estado desconocido

- **WHEN** se pide el estado `hired`
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `status`

#### Scenario: Cambio y evento, juntos o ninguno

- **GIVEN** que la escritura del evento de historial falla
- **WHEN** termina la petición de cambio de estado
- **THEN** la postulación SHALL conservar su estado y su versión anteriores

### Requirement: Etapa libre solo en "En proceso"

`stageLabel` SHALL ser un texto libre de 1 a 60 caracteres tras quitar los espacios exteriores, o `null`. Con texto
SHALL admitirse solo con `status` `in_process`; enviarlo con otro estado SHALL responder `400` con código
`validation_error` nombrando `stageLabel`. Pidiendo `in_process` sobre una postulación que ya está en `in_process`,
omitir `stageLabel` SHALL conservar la etapa y `null` SHALL borrarla. Cambiar la etapa sin cambiar de estado SHALL
contar como un cambio, con su evento y su versión. Al salir de `in_process` la etapa SHALL borrarse de la postulación,
pero su historial SHALL conservarla en el evento de salida. Entrar en `in_process` desde otro estado sin etapa SHALL
dejarla vacía.

#### Scenario: Etapa propia

- **GIVEN** una postulación en `applied`
- **WHEN** su dueño la pasa a `in_process` con la etapa "  Prueba técnica "
- **THEN** la postulación SHALL quedar en `in_process` con la etapa "Prueba técnica"

#### Scenario: Cambiar de etapa sin cambiar de estado

- **GIVEN** una postulación en `in_process` con la etapa "Prueba técnica"
- **WHEN** su dueño cambia la etapa a "Entrevista con el equipo"
- **THEN** `version` SHALL subir en 1
- **AND** el historial SHALL ganar un evento de `in_process` a `in_process` con las dos etapas

#### Scenario: Omitir la etapa la conserva

- **GIVEN** una postulación en `in_process` con la etapa "Prueba técnica" y `version` 5
- **WHEN** su dueño pide `in_process` sin `stageLabel`
- **THEN** la respuesta SHALL ser `200` con la etapa "Prueba técnica" y `version` 5
- **AND** el historial NO SHALL ganar ningún evento

#### Scenario: Borrar la etapa con null

- **GIVEN** una postulación en `in_process` con la etapa "Prueba técnica"
- **WHEN** su dueño pide `in_process` con `stageLabel` `null`
- **THEN** la postulación SHALL seguir en `in_process` sin etapa y con `version` 1 más alta
- **AND** el historial SHALL ganar un evento con "Prueba técnica" como etapa de origen y sin etapa de destino

#### Scenario: Etapa fuera de "En proceso"

- **WHEN** se pide `applied` con la etapa "Entrevista"
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `stageLabel`

#### Scenario: Salir de "En proceso"

- **GIVEN** una postulación en `in_process` con la etapa "Entrevista final"
- **WHEN** su dueño la pasa a `offer`
- **THEN** la postulación NO SHALL tener etapa
- **AND** el evento de ese cambio SHALL conservar "Entrevista final" como etapa de origen

### Requirement: Fecha de postulación

`appliedAt` SHALL decidirse por el estado de destino, sin depender del de origen. Al crear o al pasar a `applied`,
`in_process`, `offer` o `accepted`, la petición SHALL poder traer `appliedAt`: si la postulación no tiene fecha, SHALL
fijarse con la enviada o, si no se envía, con la fecha del cambio; si ya la tiene, SHALL conservarse y la enviada SHALL
ignorarse. Al entrar en `saved` o `interested` SHALL borrarse; al entrar en `rejected`, `withdrawn` o `expired` NO SHALL
cambiar. `appliedAt` con cualquier otro estado SHALL responder `400` con código `validation_error` nombrando
`appliedAt`, y una fecha posterior en más de 24 horas al momento de la petición también.

#### Scenario: Postular fija la fecha

- **GIVEN** una postulación en `interested`
- **WHEN** su dueño la pasa a `applied` sin `appliedAt`
- **THEN** `appliedAt` SHALL ser la fecha de ese cambio

#### Scenario: Postulé hace unos días

- **GIVEN** un usuario que no sigue un link y postuló a esa oferta hace cuatro días
- **WHEN** pide seguirlo con `status` `applied` y `appliedAt` de hace cuatro días
- **THEN** la postulación SHALL tener esa `appliedAt`

#### Scenario: Saltar a "En proceso" con fecha

- **GIVEN** una postulación en `interested`, sin `appliedAt`
- **WHEN** su dueño la pasa a `in_process` con `appliedAt` de hace una semana
- **THEN** la postulación SHALL tener esa `appliedAt`

#### Scenario: Con fecha previa, la enviada se ignora

- **GIVEN** una postulación en `applied` con `appliedAt` del día 3
- **WHEN** su dueño la pasa a `offer` con `appliedAt` del día 5
- **THEN** `appliedAt` SHALL seguir siendo la del día 3

#### Scenario: Fecha futura

- **WHEN** se pide `applied` con `appliedAt` dentro de dos días
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `appliedAt`

#### Scenario: Hoy con el reloj del cliente adelantado

- **GIVEN** una postulación en `interested`, sin `appliedAt`, y un cliente cuyo reloj o zona horaria va por delante del
  servidor
- **WHEN** su dueño la pasa a `applied` con una `appliedAt` 3 horas posterior al momento de la petición en el servidor
- **THEN** la respuesta SHALL ser `200` con esa `appliedAt`

#### Scenario: Fecha con un estado que no la admite

- **WHEN** se pide `interested` con una `appliedAt`
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `appliedAt`

#### Scenario: Deshacer un "Postulé" por error

- **GIVEN** una postulación en `applied` con `appliedAt`
- **WHEN** su dueño la devuelve a `interested`
- **THEN** la postulación NO SHALL tener `appliedAt`

#### Scenario: Cerrar conserva la fecha

- **GIVEN** una postulación en `in_process` con `appliedAt`
- **WHEN** su dueño la pasa a `rejected`
- **THEN** `appliedAt` SHALL seguir siendo el mismo

#### Scenario: Reabrir sin fecha

- **GIVEN** una postulación creada en `interested` y cerrada como `rejected`, sin `appliedAt`
- **WHEN** su dueño la pasa a `in_process` sin `appliedAt`
- **THEN** `appliedAt` SHALL ser la fecha de ese cambio

### Requirement: Fecha del último cambio de estado

Cada postulación SHALL tener `statusChangedAt`, fijada al crearla y en cada cambio efectivo de estado o de etapa.
Editar las notas o la visibilidad NO SHALL cambiarla.

#### Scenario: Una nota no es un avance

- **GIVEN** una postulación cuyo último cambio de estado fue hace cinco días
- **WHEN** su dueño edita la nota y activa compartir
- **THEN** `statusChangedAt` SHALL seguir siendo la de hace cinco días

#### Scenario: Cambiar de etapa cuenta

- **GIVEN** una postulación en `in_process` con la etapa "Prueba técnica"
- **WHEN** su dueño cambia la etapa a "Entrevista final"
- **THEN** `statusChangedAt` SHALL ser la fecha de ese cambio

### Requirement: Dos pestañas no se pisan

Un cambio efectivo de estado o de etapa pedido con una `version` distinta de la actual SHALL responder `409` con código
`application_conflict`, sin cambiar la postulación ni escribir ningún evento. Las notas y la visibilidad NO SHALL usar
ni subir `version`: la versión protege solo el estado y la etapa.

#### Scenario: Cambio desde una pestaña vieja

- **GIVEN** una postulación en `interested` con `version` 1 abierta en dos pestañas
- **WHEN** la primera la pasa a `applied` con `version` 1 y después la segunda la pasa a `rejected` con `version` 1
- **THEN** la segunda respuesta SHALL ser `409` con código `application_conflict`
- **AND** la postulación SHALL seguir en `applied` con un solo evento nuevo

#### Scenario: Editar notas no invalida un cambio de estado

- **GIVEN** una postulación con `version` 2
- **WHEN** su dueño edita las notas y después cambia el estado con `version` 2
- **THEN** el cambio de estado SHALL responder `200`

### Requirement: Notas privadas

`PATCH /api/applications/:id` SHALL aceptar `notes` (hasta 2000 caracteres; una cadena vacía las borra) y responder `200`
con la postulación. Editar las notas NO SHALL escribir ningún evento de historial. Más de 2000 caracteres SHALL
responder `400` con código `validation_error` nombrando `notes`.

#### Scenario: Apuntar algo

- **GIVEN** una postulación propia
- **WHEN** su dueño guarda la nota "Piden inglés C1; escribir a RR. HH. el lunes"
- **THEN** la respuesta SHALL ser `200` con esa nota
- **AND** su historial NO SHALL cambiar

#### Scenario: Nota demasiado larga

- **WHEN** se guarda una nota de 2001 caracteres
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `notes`

### Requirement: Historial de la postulación

`GET /api/applications/:id/events` SHALL devolver a su dueño los eventos de esa postulación del más antiguo al más
reciente, cada uno con el estado de origen (ausente en el primero), el de destino, las etapas de ambos si las había y su
fecha.

#### Scenario: Historial completo

- **GIVEN** una postulación creada en `interested`, pasada a `applied` y después a `in_process` con la etapa "Entrevista"
- **WHEN** su dueño consulta el historial
- **THEN** la respuesta SHALL ser `200` con tres eventos en ese orden, el último con destino `in_process` y la etapa
  "Entrevista"

### Requirement: Dejar de seguir

`DELETE /api/applications/:id` SHALL borrar, solo para su dueño, la postulación y todos sus eventos de historial en una
sola escritura atómica y responder `204`. Después NO SHALL aparecer en sus postulaciones ni en los estados compartidos de
ningún grupo, y su historial NO SHALL poder consultarse. Volver a seguir esa oferta SHALL crear una postulación nueva,
con `version` 1 y un historial que empieza de cero.

#### Scenario: Dejar de seguir una oferta

- **GIVEN** Ana, que sigue un link en `interested` con dos eventos en su historial
- **WHEN** deja de seguirlo
- **THEN** la respuesta SHALL ser `204`
- **AND** sus postulaciones NO SHALL incluirla y NO SHALL quedar ningún evento de esa postulación

#### Scenario: Deja de verse en el grupo

- **GIVEN** Ana, que comparte su estado sobre un link del grupo G
- **WHEN** deja de seguirlo
- **THEN** los estados compartidos de ese link en G NO SHALL incluir a Ana

#### Scenario: Volver a seguirla

- **GIVEN** Ana, que dejó de seguir un link
- **WHEN** vuelve a seguirlo con `status` `interested`
- **THEN** la respuesta SHALL ser `201` con `created` `true` y `version` 1
- **AND** su historial SHALL tener un único evento

#### Scenario: Cambiar una postulación que ya no existe

- **GIVEN** una postulación abierta en dos pestañas
- **WHEN** en la primera se deja de seguir y en la segunda se cambia su estado
- **THEN** el cambio de estado SHALL responder `404` con código `application_not_found`
- **AND** NO SHALL quedar ningún evento de esa postulación

### Requirement: Mis postulaciones

`GET /api/applications` SHALL devolver todas las postulaciones de quien pide, de la cambiada más recientemente a la más
antigua, cada una con su identificador, su estado, su etapa, su visibilidad, sus notas, `appliedAt`, `statusChangedAt`,
`version`, su fecha de cambio y una ficha de su link —identificador, `displayUrl`, plataforma, estado del preview,
título y empresa si los tiene—. Con `linkIds` (hasta 50 identificadores separados por comas) SHALL devolver solo las de
esos links; un identificador mal formado o de un link no seguido simplemente no aporta nada, y más de 50 SHALL
responder `400` con código `validation_error` nombrando `linkIds`. NUNCA SHALL incluir postulaciones de otra persona.
Una postulación SHALL seguir apareciendo, con la ficha de su link, aunque su dueño ya no vea ese link por ningún grupo
ni por su lista privada.

#### Scenario: Tablero con lo que sigo

- **GIVEN** un usuario que sigue dos ofertas y un compañero de grupo que sigue otra
- **WHEN** consulta sus postulaciones
- **THEN** la respuesta SHALL ser `200` con sus dos postulaciones, la última que cambió primero, cada una con el título de
  su oferta

#### Scenario: Estado propio de una página de tarjetas

- **GIVEN** un usuario que sigue uno de los tres links de la página que está viendo
- **WHEN** consulta sus postulaciones con los tres `linkIds`
- **THEN** la respuesta SHALL traer solo la postulación de ese link

#### Scenario: Se fue del grupo, conserva su proceso

- **GIVEN** un usuario que sigue un link que solo veía en un grupo
- **WHEN** sale de ese grupo y consulta sus postulaciones
- **THEN** la postulación SHALL seguir apareciendo con su estado, su historial y la ficha de la oferta

### Requirement: Cada postulación es solo de su dueño

Consultar, cambiar, editar, borrar o ver el historial de una postulación de otra persona, de una que no existe o con un
identificador mal formado SHALL responder `404` con código `application_not_found` y el mismo cuerpo en todos los casos.

#### Scenario: Postulación ajena

- **GIVEN** una postulación de Ana
- **WHEN** Beto intenta cambiar su estado, ver su historial, editar sus notas y dejar de seguirla
- **THEN** las cuatro respuestas SHALL ser `404` con código `application_not_found`
- **AND** la postulación de Ana NO SHALL cambiar

### Requirement: Puntuación de encaje reservada

La postulación SHALL exponer un `fitScoreDegraded` (booleano) y, **solo cuando ese análisis no vino degradado**, un
`fitScore` (entero de 0 a 100), los dos **derivados en el momento de responder** del **último análisis de encaje** de
esa persona sobre ese link. La postulación **NO SHALL guardar ninguna puntuación propia**: ninguna operación SHALL escribirla, ninguna SHALL editarla a mano y ninguna SHALL
tener que borrarla.

- **El último análisis** SHALL ser el de **fecha de finalización más reciente entre los que terminaron en `done`**, con
  esa misma definición y ninguna otra. Los análisis **en curso, los fallidos y los que se dieron por vencidos NO SHALL
  contar** para derivar la puntuación: un fallo nuestro no cambia el encaje que la persona ya conocía, así que un
  `failed` posterior NO SHALL borrar ni sustituir la puntuación del último análisis que sí terminó.
- **Derivar al leer, no copiar**, es lo que hace imposible la desincronización: no existe ningún instante en el que la
  postulación diga una puntuación y el análisis diga otra, porque solo hay un número y vive en el análisis. Terminar un
  análisis NO SHALL escribir nada en la postulación, y entre terminarlo y verlo NO SHALL haber ninguna ventana en la que
  la respuesta esté atrasada.
- **Sin ningún análisis terminado en `done`** de esa persona sobre ese link, la postulación SHALL responder **sin
  `fitScore` y sin `fitScoreDegraded`**. La ausencia SHALL representarse como campo ausente o nulo, **nunca como `0`**:
  "todavía no lo analizaste" y "no encajas nada" no pueden verse igual.
- **Si deja de quedar ningún análisis** —porque se borró el CV con el que se hicieron—, la postulación SHALL volver a
  responder sin `fitScore` ni `fitScoreDegraded` **sin que ninguna operación tenga que limpiarla**: al no haber de dónde
  derivarla, deja de haberla. Ningún proceso SHALL quedar encargado de ir a borrar puntuaciones huérfanas.
- **Un análisis degradado NO entrega número**: cuando el último análisis vino degradado, la respuesta SHALL traer
  `fitScoreDegraded` `true` y **ningún `fitScore`**. Ese número sale de un cruce por diccionario, ninguna pantalla del
  producto lo muestra —el badge de un análisis básico enseña solo su etiqueta— y entregarlo sería dejar suelto un dato
  sin consumidor esperando a que alguien lo pinte por error.
- En consecuencia, ninguna respuesta SHALL entregar `fitScore` sin `fitScoreDegraded`, y **ninguna SHALL entregar
  `fitScore` junto a `fitScoreDegraded` `true`**. `fitScoreDegraded` `true` sin `fitScore` SHALL ser una combinación
  válida y SHALL significar "lo analizaste, pero el análisis fue básico"; la ausencia de los dos SHALL seguir
  significando "no lo analizaste".
- **Rehacer el análisis SHALL cambiar la puntuación** por la del análisis nuevo, aunque sea más baja. Si el análisis
  nuevo viene degradado, el `fitScore` anterior SHALL **desaparecer** y quedar solo `fitScoreDegraded` `true`: sigue al
  último análisis, no al mejor, y no se queda enseñando un número que ya no corresponde a ningún análisis vigente.
- **Seguir una oferta ya analizada** SHALL responder desde el primer momento con la puntuación del último análisis que
  ya existía, sin pedir uno nuevo y sin copiar nada a la postulación recién creada.
- **La puntuación NO es un cambio de estado**: aparecer, cambiar o desaparecer NO SHALL subir `version`, NO SHALL tocar
  `statusChangedAt` y NO SHALL escribir ningún evento de historial, de modo que un análisis que termina mientras alguien
  tiene la pantalla abierta nunca SHALL provocar un `409 application_conflict`.
- La postulación SHALL llevar **solo el número y su procedencia**: NO SHALL incluir el informe, sus `suggestions`, sus
  `matchedSkills` ni `missingSkills`, ningún fragmento del CV ni ningún dato del proveedor que lo produjo.
- Solo SHALL derivarse de los análisis **de su dueño**: el análisis de otra persona sobre el mismo link NO SHALL puntuar
  nunca una postulación ajena.

Toda respuesta de la API que devuelva una postulación SHALL incluir `fitScoreDegraded` cuando lo haya, y `fitScore`
cuando además corresponda, junto a los demás campos de la postulación.

#### Scenario: La puntuación aparece tras el análisis

- **GIVEN** una postulación de Ana sobre una oferta, sin puntuación
- **WHEN** termina un análisis de encaje de Ana sobre esa oferta con `score` 78 y sin degradación y Ana consulta su
  postulación
- **THEN** la respuesta SHALL traer `fitScore` 78 y `fitScoreDegraded` `false`

#### Scenario: La respuesta no lleva la puntuación

- **GIVEN** una postulación de alguien que nunca analizó esa oferta
- **WHEN** se convierte a su representación en la API
- **THEN** la representación NO SHALL contener `fitScore` ni `fitScoreDegraded`
- **AND** NO SHALL contener `fitScore` con valor `0`

#### Scenario: Nadie escribe la puntuación

- **GIVEN** una postulación de Ana sobre una oferta
- **WHEN** termina un análisis de encaje de Ana sobre esa oferta
- **THEN** el documento guardado de la postulación NO SHALL haber cambiado
- **AND** su `version`, su `statusChangedAt` y su historial SHALL ser los mismos que antes del análisis

#### Scenario: Un análisis básico puntúa y lo dice

- **GIVEN** Ana sin consentimiento para proveedores externos y con el proveedor local caído
- **WHEN** termina un análisis degradado con `score` 41 sobre una oferta que sigue
- **THEN** su postulación SHALL responder con `fitScoreDegraded` `true` y **sin** `fitScore`
- **AND** el número 41 NO SHALL aparecer en ninguna respuesta de la postulación

#### Scenario: Rehacer el análisis manda

- **GIVEN** una postulación cuyo `fitScore` 78 procede de un análisis completo
- **WHEN** Ana vuelve a analizar esa oferta y el análisis nuevo devuelve `score` 63 sin degradación
- **THEN** su postulación SHALL responder con `fitScore` 63

#### Scenario: El análisis nuevo sale básico y el número anterior desaparece

- **GIVEN** una postulación cuyo `fitScore` 78 procede de un análisis completo
- **WHEN** Ana vuelve a analizar esa oferta y el análisis nuevo termina degradado
- **THEN** su postulación SHALL responder con `fitScoreDegraded` `true` y sin ningún `fitScore`
- **AND** NO SHALL seguir respondiendo 78

#### Scenario: Un análisis fallido no borra la puntuación anterior

- **GIVEN** una postulación cuyo `fitScore` 78 procede de un análisis terminado
- **WHEN** Ana pide otro análisis de esa oferta y termina en `failed`
- **THEN** su postulación SHALL seguir respondiendo `fitScore` 78 y `fitScoreDegraded` `false`
- **AND** un análisis todavía en curso tampoco SHALL cambiar lo que responde

#### Scenario: Seguir una oferta ya analizada

- **GIVEN** Ana con un análisis terminado y no degradado sobre una oferta que todavía no sigue
- **WHEN** pide seguirla con `status` `interested`
- **THEN** la respuesta SHALL ser `201` con el `fitScore` de ese análisis

#### Scenario: Sin análisis, sin nada que limpiar

- **GIVEN** una postulación de Ana que responde con `fitScore` 78 derivado de su único análisis sobre ese link
- **WHEN** Ana borra el CV con el que se hizo y sus análisis desaparecen
- **THEN** la postulación SHALL responder otra vez sin `fitScore` ni `fitScoreDegraded`
- **AND** su `version` SHALL ser la misma, sin que ninguna operación haya tenido que tocarla

#### Scenario: La puntuación no pisa a las pestañas abiertas

- **GIVEN** una postulación en `interested` con `version` 1 abierta en una pestaña
- **WHEN** termina un análisis de esa oferta y después su dueña la pasa a `applied` con `version` 1
- **THEN** el cambio de estado SHALL responder `200` con `version` 2
- **AND** el historial SHALL tener un único evento nuevo, el del cambio de estado

#### Scenario: La postulación no lleva el informe

- **GIVEN** un análisis terminado y no degradado con `score`, `matchedSkills`, `missingSkills` y sugerencias
- **WHEN** se consulta la postulación de esa oferta
- **THEN** la respuesta SHALL contener `fitScore` y `fitScoreDegraded`
- **AND** NO SHALL contener ninguna sugerencia, ninguna lista de skills ni ningún fragmento del CV

#### Scenario: La puntuación no se hereda de otra persona

- **GIVEN** Ana y Beto siguiendo el mismo link, con un análisis terminado solo de Ana
- **WHEN** Beto consulta su postulación
- **THEN** NO SHALL traer `fitScore` ni `fitScoreDegraded`

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

### Requirement: Expiración automática al cerrar la vacante

Cuando el sistema marca un JobLink como cerrado, SHALL actualizar las postulaciones de ese link
según `links/freshness`: estados abiertos (no `accepted`) → `expired` con historial atómico
idempotente (sin segundo evento si ya estaba `expired`). NO SHALL exigirse `version` del cliente.
El historial V0 conserva su forma actual (origen, destino, etapas, fecha) **sin** campo actor
nuevo. Reabrir después sigue siendo decisión humana vía `PATCH` existente.

#### Scenario: Auto-expire sin versión del SPA

- **GIVEN** una postulación en `applied` con `version` 3
- **WHEN** su link se cierra por frescura
- **THEN** SHALL quedar `expired` con `version` 4 y un evento `applied` → `expired`
- **AND** NO SHALL haber fallado por conflicto de versión de cliente

#### Scenario: Humano puede reabrir

- **GIVEN** una postulación auto-expirada
- **WHEN** su dueño la pasa a `interested` con la versión actual
- **THEN** la respuesta SHALL ser `200` con `status` `interested`
