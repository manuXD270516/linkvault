## MODIFIED Requirements

### Requirement: La oferta importada cae en la lista privada

`/mis-links` con `import=<slug>` SHALL pedir el preview público de ese `slug`, una sola vez por navegación, y actuar
según lo que reciba:

- **`200`**: SHALL guardar esa oferta **sin grupo**, SHALL quitar el parámetro de la URL sin dejar entrada en el
  historial —de modo que recargar la página NO SHALL volver a guardarla— y SHALL mostrar "Guardada en «Solo para mí».
  Compártela en un grupo cuando quieras." con la oferta en la lista. Si ya la tenía SHALL decir "Ya la tenías
  guardada", y si la tiene en algún grupo suyo SHALL decir en cuáles. Si el guardado falla SHALL decirlo sin perder la
  lista y SHALL ofrecer "Reintentar".
- **`404`**: SHALL mostrar "Ese enlace ya no está disponible", NO SHALL ofrecer "Reintentar" y SHALL quitar el
  parámetro de la URL.
- **`429`, `5xx` o fallo de red**: SHALL mostrar "No pudimos leer la oferta ahora" con "Reintentar" y SHALL
  **conservar** el parámetro `import` hasta que haya un intento que llegue a la API, de modo que recargar la página
  vuelva a intentarlo.

En todos los casos la lista privada SHALL seguir viéndose.

La oferta guardada así SHALL cumplir lo que prometió a quien la compartió —"no se verá el grupo ni tu nombre"— también
**después** de guardarla: su tarjeta y su formulario de edición NO SHALL mostrar el nombre de nadie con quien quien la
importa no comparta un grupo (regla de «Preview con procedencia por campo» de `links/enrichment`), y en su lugar
SHALL decir "Escrito por otra persona" o "Descripción pegada por otra persona".

#### Scenario: Oferta guardada

- **GIVEN** alguien con sesión que llega a `/mis-links?import=<slug>`
- **THEN** la oferta SHALL aparecer en su lista privada
- **AND** SHALL ver "Guardada en «Solo para mí». Compártela en un grupo cuando quieras."
- **AND** la URL SHALL quedarse sin el parámetro `import`

#### Scenario: Recargar no duplica

- **GIVEN** alguien que acaba de importar una oferta desde un enlace público
- **WHEN** recarga `/mis-links`
- **THEN** NO SHALL volver a llamarse al guardado
- **AND** la lista SHALL mostrar una sola vez esa oferta

#### Scenario: Ya la tenía

- **GIVEN** alguien que ya tiene esa vacante en su lista privada
- **WHEN** llega a `/mis-links?import=<slug>`
- **THEN** SHALL ver "Ya la tenías guardada" y una sola entrada de esa oferta

#### Scenario: Ya la tenía en un grupo

- **GIVEN** alguien que ya tiene esa vacante en "Backend Bolivia"
- **WHEN** llega a `/mis-links?import=<slug>`
- **THEN** SHALL ver que ya la tiene en "Backend Bolivia"

#### Scenario: Enlace despublicado entre medias

- **GIVEN** alguien que abrió la vista pública antes de que se despublicara
- **WHEN** pulsa "Guardar en LinkVault" y llega a `/mis-links?import=<slug>`, donde el preview responde `404`
- **THEN** SHALL ver "Ese enlace ya no está disponible" sin "Reintentar"
- **AND** la URL SHALL quedarse sin el parámetro `import`
- **AND** NO SHALL guardarse ninguna oferta

#### Scenario: La oferta no se pudo leer ahora

- **GIVEN** alguien que llega a `/mis-links?import=<slug>` y el preview responde `429`
- **WHEN** ve el mensaje
- **THEN** SHALL ver "No pudimos leer la oferta ahora" con "Reintentar"
- **AND** la URL SHALL conservar el parámetro `import`

#### Scenario: El guardado falla

- **GIVEN** alguien que llega a `/mis-links?import=<slug>`, el preview responde `200` y el guardado responde con un
  error
- **WHEN** ve el mensaje
- **THEN** SHALL poder pulsar "Reintentar" y guardar la oferta sin volver al enlace público
- **AND** su lista privada SHALL seguir viéndose

#### Scenario: Quien guarda desde el enlace público no ve el nombre de quien la escribió

- **GIVEN** Ana Quiroga, que completó a mano el puesto y la empresa de una oferta y la compartió en un grupo con enlace
  público, y Carla Benítez, que no es de ese grupo ni comparte ninguno con Ana
- **WHEN** Carla abre el enlace público, pulsa "Guardar en LinkVault", crea su cuenta y llega a `/mis-links`
- **THEN** la tarjeta de Carla SHALL mostrar el puesto y la empresa con "Escrito por otra persona"
- **AND** NO SHALL mostrar el nombre visible exacto de Ana ("Ana Quiroga") en ninguna parte de la página
- **AND** ninguna respuesta de la API que reciba Carla SHALL contener el `userId` de Ana

### Requirement: Interruptor del enlace público en la tarjeta del grupo

En `/grupos/:id`, la tarjeta de un link publicado SHALL mostrar a **cualquier miembro** una marca "Enlace público".
Quien compartió el link y el `owner` SHALL ver además, en el menú de la tarjeta:

- "Compartir con un enlace público" cuando no lo está;
- "Copiar enlace" y "Dejar de compartir" cuando lo está.

Encender el interruptor SHALL pedir confirmación diciendo el alcance: "Cualquiera con este enlace podrá ver la oferta
sin entrar en LinkVault. No se verá el grupo, ni tu nombre, ni los comentarios. Puedes dejar de compartirlo cuando
quieras." Apagarlo SHALL confirmar con "El enlace dejará de funcionar para todo el mundo, también para quien ya lo
tenga. Si vuelves a activarlo, se creará un enlace nuevo. Las vistas previas ya enviadas en un chat pueden seguir
viéndose ahí."

"Copiar enlace" SHALL avisar cuando la tarjeta **no tiene datos** —sin puesto—, y SHALL dejar copiar igualmente:
mientras la lectura está pendiente, con "Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin
datos"; si la lectura falló, con "No pudimos leer la oferta: si lo envías ahora, la tarjeta saldrá sin datos.
Complétala antes.". Si la tarjeta tiene datos —leídos, pegados o escritos a mano— SHALL verse "Enlace copiado". Es la
misma regla que el formulario de guardar (spec `web/links`, «Guardar un link desde el SPA»).

La tarjeta SHALL actualizarse sin recargar: al publicar SHALL mostrar el enlace devuelto y al despublicar SHALL
**borrar explícitamente** el enlace de la tarjeta, como ya hace al quitar la nota, sin esperar a recargar la lista. Un
`403` SHALL mostrar "Solo quien compartió la oferta o el propietario del grupo puede cambiar esto" sin cambiar la
tarjeta, y un `404` SHALL volver a pedir la lista. En `/mis-links` las tarjetas NO SHALL mostrar ni la marca ni el
interruptor.

#### Scenario: Compartir con un enlace público

- **GIVEN** Ana, que compartió un link en su grupo, con el enlace apagado
- **WHEN** lo enciende y confirma
- **THEN** la tarjeta SHALL mostrar "Enlace público" y "Copiar enlace" sin recargar

#### Scenario: El aviso dice el alcance

- **GIVEN** Ana en la tarjeta de un link suyo sin publicar
- **WHEN** pulsa "Compartir con un enlace público"
- **THEN** la confirmación SHALL decir que cualquiera con el enlace verá la oferta y que no se verá el grupo, su nombre
  ni los comentarios

#### Scenario: Dejar de compartir

- **GIVEN** un link publicado
- **WHEN** el `owner` pulsa "Dejar de compartir" y confirma
- **THEN** la confirmación SHALL avisar de que el enlace deja de funcionar para quien ya lo tenga
- **AND** la tarjeta SHALL dejar de mostrar "Enlace público"

#### Scenario: Cancelar

- **GIVEN** Ana en la confirmación de encender el enlace
- **WHEN** cancela
- **THEN** NO SHALL llamarse a la API y la tarjeta NO SHALL cambiar

#### Scenario: Miembro que solo mira

- **GIVEN** Carla, miembro sin ser owner, viendo un link publicado por Beto
- **WHEN** abre la tarjeta
- **THEN** SHALL ver "Enlace público"
- **AND** NO SHALL ver "Dejar de compartir"

#### Scenario: Sin enlace público en la lista privada

- **GIVEN** un usuario en `/mis-links`
- **WHEN** mira sus tarjetas
- **THEN** NO SHALL ver ninguna marca ni acción de enlace público

#### Scenario: Copiar el enlace

- **GIVEN** un link publicado y quien lo compartió mirándolo
- **WHEN** pulsa "Copiar enlace"
- **THEN** lo copiado SHALL ser una URL absoluta que contiene `/p/` y el `slug`
- **AND** SHALL verse "Enlace copiado"

#### Scenario: Copiar el enlace de una oferta sin leer

- **GIVEN** un link publicado cuya lectura aún no terminó
- **WHEN** quien lo compartió pulsa "Copiar enlace"
- **THEN** SHALL verse "Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos"
- **AND** el enlace SHALL copiarse igualmente

#### Scenario: Copiar el enlace de una oferta que no se pudo leer

- **GIVEN** un link publicado cuya lectura terminó en "No pudimos leer esta oferta", sin puesto
- **WHEN** quien lo compartió pulsa "Copiar enlace"
- **THEN** SHALL verse "No pudimos leer la oferta: si lo envías ahora, la tarjeta saldrá sin datos. Complétala antes."
- **AND** el enlace SHALL copiarse igualmente

#### Scenario: Copiar el enlace de una oferta completada a mano

- **GIVEN** un link publicado cuya lectura falló y al que alguien escribió a mano el puesto
- **WHEN** quien lo compartió pulsa "Copiar enlace"
- **THEN** SHALL verse "Enlace copiado" y ningún aviso de tarjeta sin datos

#### Scenario: La tarjeta se apaga sin recargar

- **GIVEN** un link publicado
- **WHEN** quien lo compartió deja de compartirlo y confirma
- **THEN** la tarjeta SHALL dejar de mostrar "Enlace público" y "Copiar enlace" en el momento
- **AND** NO SHALL hacer falta volver a pedir la lista para verlo

#### Scenario: Sin permiso para cambiarlo

- **GIVEN** un miembro que deja de ser owner desde otra pestaña
- **WHEN** intenta apagar el enlace y la API responde `403`
- **THEN** SHALL ver "Solo quien compartió la oferta o el propietario del grupo puede cambiar esto"
- **AND** la tarjeta NO SHALL cambiar
