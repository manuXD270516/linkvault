## Purpose

Deja que cada persona siga sus procesos de selección sobre las ofertas que ve en LinkVault: una postulación por oferta,
con los estados canónicos de ADR-004, una etapa libre mientras está en proceso, un historial de cada cambio y notas
propias, sin que dos pestañas se pisen.

## ADDED Requirements

### Requirement: Seguir una oferta

`POST /api/applications` SHALL aceptar `linkId`, `status` (uno de los estados canónicos) y, solo con `in_process`,
`stageLabel`, y crear la postulación de quien pide sobre ese link con `visibility` `private`, `version` 1 y un primer
evento de historial sin estado de origen. SHALL responder `201` con `{ application, created: true }`. Si esa persona ya
seguía ese link, SHALL responder `201` con `{ application, created: false }` y la postulación existente **sin
cambiarla**. Solo SHALL poder seguirse un link que esa persona puede ver —en su lista privada o en un grupo del que es
miembro—; cualquier otro, o un `linkId` mal formado, SHALL responder `404` con código `link_not_found` y el mismo cuerpo
en todos los casos. Guardar, importar o compartir un link NO SHALL crear ninguna postulación.

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
también ante peticiones simultáneas. El mismo link SHALL poder tener postulaciones de muchas personas a la vez.

#### Scenario: Dos pestañas pulsan a la vez

- **GIVEN** un usuario que no sigue un link
- **WHEN** llegan a la vez una petición para seguirlo con `interested` y otra con `applied`
- **THEN** una respuesta SHALL tener `created` `true` y la otra `created` `false` con el estado de la primera
- **AND** SHALL existir una sola postulación con un solo evento de creación

#### Scenario: Muchas personas, una oferta

- **GIVEN** un link compartido en un grupo con tres miembros
- **WHEN** los tres lo siguen
- **THEN** SHALL existir tres postulaciones de ese link, una por persona

### Requirement: Estados y transiciones

Los estados SHALL ser los canónicos de ADR-004: `saved`, `interested`, `applied`, `in_process`, `offer` y `accepted`,
y los de cierre `rejected`, `withdrawn` y `expired`. `PATCH /api/applications/:id/status` SHALL aceptar `status`,
`stageLabel` (solo con `in_process`) y la `version` que tiene quien pide, y SHALL permitir, desde cualquier estado,
pasar a cualquier otro: avanzar saltando etapas, retroceder para corregir un error, cerrar desde cualquier estado y
reabrir uno cerrado. Cada cambio efectivo SHALL subir `version` en 1 y escribir **exactamente un** evento de historial
con el estado de origen, el de destino, las etapas de ambos si las había y la fecha, **en la misma escritura atómica**
que el cambio: nunca SHALL quedar una postulación cambiada sin su evento ni un evento sin su cambio. Pedir el estado y
la etapa que ya tiene SHALL responder `200` con la postulación sin escribir nada. Un `status` desconocido SHALL
responder `400` con código `validation_error` nombrando `status`. La respuesta de un cambio SHALL ser `200` con la
postulación actualizada.

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

#### Scenario: Estado desconocido

- **WHEN** se pide el estado `hired`
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `status`

#### Scenario: Cambio y evento, juntos o ninguno

- **GIVEN** que la escritura del evento de historial falla
- **WHEN** termina la petición de cambio de estado
- **THEN** la postulación SHALL conservar su estado y su versión anteriores

### Requirement: Etapa libre solo en "En proceso"

`stageLabel` SHALL ser un texto libre de 1 a 60 caracteres tras quitar los espacios exteriores, y SHALL admitirse solo
con `status` `in_process`; enviarlo con otro estado SHALL responder `400` con código `validation_error` nombrando
`stageLabel`. Cambiar la etapa sin cambiar de estado SHALL contar como un cambio, con su evento y su versión. Al salir de
`in_process` la etapa SHALL borrarse de la postulación, pero su historial SHALL conservarla en el evento de salida.
Volver a `in_process` sin etapa SHALL dejarla vacía.

#### Scenario: Etapa propia

- **GIVEN** una postulación en `applied`
- **WHEN** su dueño la pasa a `in_process` con la etapa "  Prueba técnica "
- **THEN** la postulación SHALL quedar en `in_process` con la etapa "Prueba técnica"

#### Scenario: Cambiar de etapa sin cambiar de estado

- **GIVEN** una postulación en `in_process` con la etapa "Prueba técnica"
- **WHEN** su dueño cambia la etapa a "Entrevista con el equipo"
- **THEN** `version` SHALL subir en 1
- **AND** el historial SHALL ganar un evento de `in_process` a `in_process` con las dos etapas

#### Scenario: Etapa fuera de "En proceso"

- **WHEN** se pide `applied` con la etapa "Entrevista"
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `stageLabel`

#### Scenario: Salir de "En proceso"

- **GIVEN** una postulación en `in_process` con la etapa "Entrevista final"
- **WHEN** su dueño la pasa a `offer`
- **THEN** la postulación NO SHALL tener etapa
- **AND** el evento de ese cambio SHALL conservar "Entrevista final" como etapa de origen

### Requirement: Fecha de postulación

`appliedAt` SHALL fijarse con la fecha del cambio cuando la postulación entra en `applied`, `in_process`, `offer` o
`accepted` desde `saved`, `interested` o desde su creación, SHALL conservarse al moverse entre esos estados o al cerrar,
y SHALL borrarse al volver a `saved` o `interested`.

#### Scenario: Postular fija la fecha

- **GIVEN** una postulación en `interested`
- **WHEN** su dueño la pasa a `applied`
- **THEN** `appliedAt` SHALL ser la fecha de ese cambio

#### Scenario: Deshacer un "Postulé" por error

- **GIVEN** una postulación en `applied` con `appliedAt`
- **WHEN** su dueño la devuelve a `interested`
- **THEN** la postulación NO SHALL tener `appliedAt`

#### Scenario: Cerrar conserva la fecha

- **GIVEN** una postulación en `in_process` con `appliedAt`
- **WHEN** su dueño la pasa a `rejected`
- **THEN** `appliedAt` SHALL seguir siendo el mismo

### Requirement: Dos pestañas no se pisan

Un cambio de estado o de etapa pedido con una `version` distinta de la actual SHALL responder `409` con código
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

### Requirement: Mis postulaciones

`GET /api/applications` SHALL devolver todas las postulaciones de quien pide, de la cambiada más recientemente a la más
antigua, cada una con su identificador, su estado, su etapa, su visibilidad, sus notas, `appliedAt`, `version`, su
fecha de cambio y una ficha de su link —identificador, `displayUrl`, plataforma, estado del preview, título y empresa
si los tiene—. Con `linkIds` (hasta 50 identificadores separados por comas) SHALL devolver solo las de esos links; un
identificador mal formado o de un link no seguido simplemente no aporta nada, y más de 50 SHALL responder `400` con
código `validation_error` nombrando `linkIds`. NUNCA SHALL incluir postulaciones de otra persona. Una postulación SHALL
seguir apareciendo, con la ficha de su link, aunque su dueño ya no vea ese link por ningún grupo ni por su lista privada.

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

Consultar, cambiar, editar o ver el historial de una postulación de otra persona, de una que no existe o con un
identificador mal formado SHALL responder `404` con código `application_not_found` y el mismo cuerpo en todos los casos.

#### Scenario: Postulación ajena

- **GIVEN** una postulación de Ana
- **WHEN** Beto intenta cambiar su estado, ver su historial y editar sus notas
- **THEN** las tres respuestas SHALL ser `404` con código `application_not_found`
- **AND** la postulación de Ana NO SHALL cambiar

### Requirement: Puntuación de encaje reservada

La postulación SHALL reservar en su modelo un campo opcional `fitScore` (0 a 100) para `cv-match-suggestions`. En este
change ninguna operación SHALL escribirlo y ninguna respuesta de la API SHALL incluirlo.

#### Scenario: Nadie escribe la puntuación

- **GIVEN** una postulación creada, cambiada de estado, con notas y compartida
- **WHEN** se lee su documento guardado y su representación en la API
- **THEN** ninguno de los dos SHALL contener `fitScore`

### Requirement: Postulación estancada, solo modelada

`libs/shared` SHALL exportar el evento de integración versionado `ApplicationStale.v1`, con el identificador de la
postulación, su dueño, su link, su estado, la fecha de su último cambio y el umbral de días (10) que lo define, validado
con zod. En este change ningún proceso SHALL producirlo, publicarlo ni consumirlo, y ninguna persona SHALL recibir por
ello ningún aviso.

#### Scenario: El contrato existe

- **WHEN** se valida un evento `ApplicationStale.v1` con todos sus campos
- **THEN** el schema SHALL aceptarlo
- **AND** SHALL rechazar el mismo evento con otro tipo o sin el identificador de la postulación

#### Scenario: Nada lo publica

- **GIVEN** una postulación en `applied` sin cambios desde hace 30 días
- **WHEN** pasa el tiempo con `api` y `worker` en marcha
- **THEN** NO SHALL publicarse ningún `ApplicationStale.v1` ni enviarse ningún aviso
