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

- **GIVEN** Ana, que completó a mano el puesto y la empresa de una oferta y la compartió en un grupo con enlace público,
  y Carla, que no es de ese grupo ni comparte ninguno con Ana
- **WHEN** Carla abre el enlace público, pulsa "Guardar en LinkVault", crea su cuenta y llega a `/mis-links`
- **THEN** la tarjeta de Carla SHALL mostrar el puesto y la empresa con "Escrito por otra persona"
- **AND** NO SHALL mostrar "Ana" en ninguna parte de la página

