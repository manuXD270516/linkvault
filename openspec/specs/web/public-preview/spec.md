# web/public-preview Specification

## Purpose

None

## Requirements

### Requirement: Vista pública de una oferta

`/oferta/:slug` SHALL abrirse **sin sesión** y mostrar la oferta con su título —o la etiqueta legible derivada de su URL
cuando no lo tenga—, su empresa, su ubicación, su modalidad, su nivel, su salario formateado y sus fechas, cuando los
tenga, y un enlace "Ver la oferta original" que abre la URL original en otra pestaña sin pasar el referente.

NO SHALL mostrar quién compartió la oferta, a qué grupo pertenece, la nota, los comentarios, ninguna postulación, el
resumen, las habilidades ni el origen de ningún campo. Mientras la persona no tenga sesión, la página NO SHALL pedir a
la API nada más que el preview público.

Un `slug` inexistente o despublicado (`404`) SHALL mostrar "Este enlace ya no está disponible" y "Pídeselo de nuevo a
quien te lo envió", con las acciones de entrar y registrarse, y SIN el CTA de guardar.

La ruta `/oferta/:slug` NO SHALL indexarse: el SPA SHALL marcarla con `noindex` mientras esté abierta y su `robots.txt`
SHALL incluir `Disallow: /oferta/`. Es la misma regla que la página servida por la API: la oferta es de la bolsa que la
publicó y LinkVault no la duplica en los buscadores.

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
- **THEN** SHALL ver "Este enlace ya no está disponible" y "Pídeselo de nuevo a quien te lo envió"
- **AND** NO SHALL ver "Guardar en LinkVault"

#### Scenario: La vista pública no pide la sesión

- **GIVEN** un navegador sin sesión
- **WHEN** abre `/oferta/:slug`
- **THEN** la única petición a la API SHALL ser la del preview público
- **AND** esa petición NO SHALL llevar `Authorization`

#### Scenario: La vista pública no se indexa

- **WHEN** se abre `/oferta/:slug`
- **THEN** el documento SHALL llevar `noindex`
- **AND** el `robots.txt` del SPA SHALL incluir `Disallow: /oferta/`

### Requirement: Tarjeta de respaldo del SPA

El `index.html` del SPA SHALL llevar un juego mínimo de etiquetas Open Graph por defecto: `og:site_name`, un
`og:title` de marca, una `og:description` de marca y la **misma imagen** que usa la página pública de la API. Así, un
bot que siga el redirect de `/p/:slug` y acabe en el SPA compone una tarjeta genérica de LinkVault en lugar de una
vacía.

Estas etiquetas NO SHALL contener datos de ninguna oferta ni de ninguna persona: son fijas y las mismas para todas las
rutas del SPA.

#### Scenario: Tarjeta genérica en vez de tarjeta vacía

- **WHEN** se pide el `index.html` del SPA
- **THEN** SHALL contener `og:site_name`, `og:title`, `og:description` y `og:image`
- **AND** `og:image` SHALL ser la misma imagen que usa la página pública de la API

#### Scenario: La tarjeta de respaldo no dice nada de nadie

- **WHEN** se inspeccionan esas etiquetas
- **THEN** NO SHALL contener ningún título de oferta, empresa, nombre de persona ni `slug`

### Requirement: Una avería no es un enlace muerto

Cuando el preview público no se pueda cargar por un motivo que **no** sea `404` —un `429` por el límite, un `5xx` o un
fallo de red—, la vista pública SHALL mostrar "Ahora mismo no podemos mostrar esta oferta. Inténtalo en un momento."
con una acción "Reintentar" que vuelve a pedirlo, y SHALL **conservar** el CTA "Guardar en LinkVault", que funciona
igual porque no depende del preview para navegar.

NO SHALL decirse en ese caso que el enlace ya no está disponible: el enlace existe y decir lo contrario haría que la
persona lo descartara y se perdiera el alta. Solo el `404` significa "ya no está".

#### Scenario: Límite alcanzado

- **GIVEN** el preview público respondiendo `429`
- **WHEN** alguien sin sesión abre `/oferta/:slug`
- **THEN** SHALL ver "Ahora mismo no podemos mostrar esta oferta. Inténtalo en un momento." y "Reintentar"
- **AND** SHALL seguir viendo "Guardar en LinkVault"
- **AND** NO SHALL ver "Este enlace ya no está disponible"

#### Scenario: Error del servidor

- **GIVEN** el preview público respondiendo `500`
- **WHEN** alguien abre `/oferta/:slug`
- **THEN** SHALL ver el mismo mensaje con "Reintentar" y el CTA

#### Scenario: Reintentar funciona

- **GIVEN** la vista pública mostrando ese mensaje tras un `429`
- **WHEN** la persona pulsa "Reintentar" y la API responde `200`
- **THEN** SHALL ver la oferta con sus datos

#### Scenario: Guardar pese a la avería

- **GIVEN** la vista pública mostrando ese mensaje
- **WHEN** la persona pulsa "Guardar en LinkVault"
- **THEN** SHALL llegar a `/registro` con `import` igual a ese `slug`

### Requirement: Guardar en LinkVault desde la vista pública

La vista pública SHALL ofrecer "Guardar en LinkVault" como acción principal, con la línea "Guarda aquí las ofertas que
te pasan por WhatsApp y no las pierdas." debajo, para que quien no conoce LinkVault sepa qué gana al pulsar.

- SHALL navegar **siempre** a `/registro?import=<slug>`, haya sesión o no, **sin consultar la sesión ni esperar a
  ninguna petición**: el botón SHALL responder al instante aunque la API esté lenta o caída.
- Mientras la navegación esté en curso SHALL mostrarse en estado de pendiente y NO SHALL aceptar una segunda pulsación,
  para que quien no vea un cambio inmediato —porque el guard está restaurando la sesión— no lo pulse dos veces. El
  destino NO SHALL depender de ese estado.
- Quien abra `/registro?import=<slug>` teniendo sesión SHALL ser llevado a `/mis-links?import=<slug>`, no al inicio: es
  el guard de invitado, que ya restaura la sesión, quien lo decide.
- Las páginas de registro y de login SHALL conservar ese parámetro en el enlace que llevan la una a la otra.
- Tras registrarse o entrar con un `import` que tiene forma de `slug`, el SPA SHALL navegar a
  `/mis-links?import=<slug>`; con cualquier otra forma SHALL ignorarlo y navegar al inicio.

#### Scenario: Sin cuenta

- **GIVEN** alguien sin sesión en `/oferta/:slug`
- **WHEN** pulsa "Guardar en LinkVault"
- **THEN** SHALL llegar a `/registro` con `import` igual a ese `slug`

#### Scenario: El CTA dice para qué sirve

- **WHEN** alguien sin cuenta abre `/oferta/:slug`
- **THEN** bajo "Guardar en LinkVault" SHALL ver "Guarda aquí las ofertas que te pasan por WhatsApp y no las pierdas."

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
- **THEN** SHALL llegar a `/mis-links` con ese `import`, pasando por `/registro?import=<slug>` sin verlo

#### Scenario: El CTA no espera a la API

- **GIVEN** alguien en `/oferta/:slug` con la API de sesión sin responder
- **WHEN** pulsa "Guardar en LinkVault"
- **THEN** la navegación a `/registro?import=<slug>` SHALL ocurrir sin esperar a ninguna petición

#### Scenario: Doble pulsación del CTA

- **GIVEN** alguien en `/oferta/:slug` con el guard de invitado restaurando la sesión
- **WHEN** pulsa "Guardar en LinkVault" dos veces seguidas
- **THEN** el botón SHALL verse en estado de pendiente tras la primera
- **AND** SHALL acabar en `/mis-links` con ese `import` una sola vez

#### Scenario: Registro con sesión abierta

- **GIVEN** alguien con sesión
- **WHEN** abre `/registro?import=<slug>`
- **THEN** SHALL ser llevado a `/mis-links` con ese `import`, y no al inicio

#### Scenario: Import inventado

- **GIVEN** alguien que se registra desde `/registro?import=../otra-cosa`
- **WHEN** termina el registro
- **THEN** SHALL llegar al inicio y NO SHALL guardarse nada

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

"Copiar enlace" SHALL avisar, cuando la oferta todavía no se ha leído, con "Todavía estamos leyendo la oferta: si lo
envías ahora, la tarjeta saldrá sin datos", y SHALL dejar copiar igualmente.

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
