## ADDED Requirements

### Requirement: Vista pública de una oferta

`/oferta/:slug` SHALL abrirse **sin sesión** y mostrar la oferta con su título —o la etiqueta legible derivada de su URL
cuando no lo tenga—, su empresa, su ubicación, su modalidad, su nivel, su salario formateado y sus fechas, cuando los
tenga, y un enlace "Ver la oferta original" que abre la URL original en otra pestaña sin pasar el referente.

NO SHALL mostrar quién compartió la oferta, a qué grupo pertenece, la nota, los comentarios, ninguna postulación, el
resumen, las habilidades ni el origen de ningún campo. Mientras la persona no tenga sesión, la página NO SHALL pedir a
la API nada más que el preview público.

Un `slug` inexistente o despublicado SHALL mostrar "Este enlace ya no está disponible" con las acciones de entrar y
registrarse, y SIN el CTA de guardar.

#### Scenario: Oferta pública con datos

- **GIVEN** un enlace público de una oferta con título, empresa, ubicación remota y salario
- **WHEN** alguien sin sesión abre `/oferta/:slug`
- **THEN** SHALL ver esos datos y "Ver la oferta original"
- **AND** NO SHALL ver ningún nombre de persona ni de grupo

#### Scenario: Oferta pública sin preview

- **GIVEN** un enlace público de un link cuya lectura aún no terminó
- **WHEN** alguien sin sesión lo abre
- **THEN** SHALL ver la etiqueta legible derivada de su URL y "Ver la oferta original"

#### Scenario: Enlace que ya no está

- **GIVEN** un `slug` despublicado
- **WHEN** alguien lo abre
- **THEN** SHALL ver "Este enlace ya no está disponible"
- **AND** NO SHALL ver "Guardar en LinkVault"

#### Scenario: La vista pública no pide la sesión

- **GIVEN** un navegador sin sesión
- **WHEN** abre `/oferta/:slug`
- **THEN** la única petición a la API SHALL ser la del preview público
- **AND** esa petición NO SHALL llevar `Authorization`

### Requirement: Guardar en LinkVault desde la vista pública

La vista pública SHALL ofrecer "Guardar en LinkVault" como acción principal.

- Sin sesión SHALL navegar a `/registro?import=<slug>`, y las páginas de registro y de login SHALL conservar ese
  parámetro en el enlace que llevan la una a la otra.
- Tras registrarse o entrar con un `import` que tiene forma de `slug`, el SPA SHALL navegar a
  `/mis-links?import=<slug>`; con cualquier otra forma SHALL ignorarlo y navegar al inicio.
- Con sesión, el CTA SHALL navegar directamente a `/mis-links?import=<slug>`.
- Quien abra `/registro?import=<slug>` teniendo sesión SHALL ser llevado a `/mis-links?import=<slug>`, no al inicio.

#### Scenario: Sin cuenta

- **GIVEN** alguien sin sesión en `/oferta/:slug`
- **WHEN** pulsa "Guardar en LinkVault"
- **THEN** SHALL llegar a `/registro` con `import` igual a ese `slug`

#### Scenario: Del registro al login sin perder la oferta

- **GIVEN** `/registro?import=<slug>`
- **WHEN** la persona pulsa "¿Ya tienes cuenta?"
- **THEN** SHALL llegar a `/login` con el mismo `import`

#### Scenario: Con cuenta recién creada

- **GIVEN** `/registro?import=<slug>`
- **WHEN** la persona se registra
- **THEN** SHALL llegar a `/mis-links` con ese `import`

#### Scenario: Con sesión abierta

- **GIVEN** alguien con sesión en `/oferta/:slug`
- **WHEN** pulsa "Guardar en LinkVault"
- **THEN** SHALL llegar a `/mis-links` con ese `import`

#### Scenario: Registro con sesión abierta

- **GIVEN** alguien con sesión
- **WHEN** abre `/registro?import=<slug>`
- **THEN** SHALL ser llevado a `/mis-links` con ese `import`, y no al inicio

#### Scenario: Import inventado

- **GIVEN** alguien que se registra desde `/registro?import=../otra-cosa`
- **WHEN** termina el registro
- **THEN** SHALL llegar al inicio y NO SHALL guardarse nada

### Requirement: La oferta importada cae en la lista privada

`/mis-links` con `import=<slug>` SHALL guardar esa oferta **sin grupo**, una sola vez por navegación, y SHALL quitar el
parámetro de la URL sin dejar entrada en el historial, de modo que recargar la página NO SHALL volver a guardarla.

Al terminar SHALL mostrar "Guardada en «Solo para mí». Compártela en un grupo cuando quieras." y la oferta en la lista.
Si ya la tenía SHALL decir "Ya la tenías guardada", y si la tiene en algún grupo suyo SHALL decir en cuáles. Si el
guardado falla SHALL decirlo sin perder la lista.

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
- **WHEN** pulsa "Guardar en LinkVault" y llega a `/mis-links?import=<slug>`
- **THEN** la oferta SHALL guardarse igual en su lista privada

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

La tarjeta SHALL actualizarse sin recargar. Un `403` SHALL mostrar "No puedes cambiar esto" sin cambiar la tarjeta, y un
`404` SHALL volver a pedir la lista. En `/mis-links` las tarjetas NO SHALL mostrar ni la marca ni el interruptor.

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

### Requirement: La tarjeta conserva su enlace público al actualizarse

Cuando el SPA sustituya una tarjeta por una versión nueva —porque llegó su enriquecimiento, porque se corrigió el
preview o porque se pegó su descripción—, SHALL conservar el enlace público que ya tenía si la versión nueva no lo trae.

#### Scenario: La lectura de la oferta no borra el enlace

- **GIVEN** una tarjeta de un link publicado
- **WHEN** llega el aviso de que su oferta ya se leyó
- **THEN** la tarjeta SHALL mostrar los datos nuevos y seguir mostrando "Enlace público"

### Requirement: Textos de la vista pública en español e inglés

Todos los textos visibles de la vista pública, del CTA, de la importación y del interruptor SHALL estar marcados para
i18n con español como idioma fuente y traducción al inglés. El HTML que sirve la API para `/p/:slug` NO SHALL pasar por
i18n: va siempre en español.

#### Scenario: Traducciones completas

- **WHEN** se comprueba `messages.en.xlf` tras extraer los mensajes
- **THEN** cada unidad de traducción SHALL tener `target`
