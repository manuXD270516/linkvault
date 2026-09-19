## Purpose

Da al SPA el tablero donde cada persona ve en qué punto está de cada oferta que sigue, la forma de empezar a seguir una
desde su tarjeta, y en la tarjeta de grupo quién más está detrás de esa vacante.

## ADDED Requirements

### Requirement: Tablero de postulaciones

`/postulaciones` SHALL ser una ruta con sesión, cargada de forma diferida, accesible desde la barra de navegación con el
texto "Postulaciones". SHALL mostrar las postulaciones propias en columnas, en este orden: "Guardadas" (solo si tiene
alguna), "Me interesan", "Postulé", "En proceso", "Oferta", "Aceptada" y "Cerradas", que reúne las rechazadas, retiradas
y expiradas con una etiqueta que dice cuál es cada una. Cada tarjeta SHALL mostrar el título de la oferta (o la etiqueta
derivada de su URL si no lo tiene), su empresa, su plataforma, la etapa en "En proceso", "Postulaste hace N días" cuando
haya fecha de postulación, y una marca cuando se comparte con los grupos. Sin postulaciones SHALL mostrar "Aquí verás
las ofertas que sigues. Pulsa «Me interesa» o «Postulé» en cualquier oferta de tus grupos o de tu lista." con enlaces a
`/grupos` y a `/mis-links`.

#### Scenario: Tablero vacío

- **GIVEN** un usuario que no sigue ninguna oferta
- **WHEN** abre `/postulaciones`
- **THEN** SHALL ver "Aquí verás las ofertas que sigues. Pulsa «Me interesa» o «Postulé» en cualquier oferta de tus
  grupos o de tu lista."

#### Scenario: Una tarjeta por postulación, en su columna

- **GIVEN** un usuario con una postulación en `interested`, otra en `in_process` con la etapa "Prueba técnica" y otra en
  `rejected`
- **WHEN** abre `/postulaciones`
- **THEN** SHALL verlas en "Me interesan", "En proceso" (con "Prueba técnica") y "Cerradas" (con la etiqueta
  "Rechazada") respectivamente
- **AND** NO SHALL ver la columna "Guardadas"

#### Scenario: Ruta diferida

- **WHEN** se carga la aplicación en `/grupos`
- **THEN** el código del tablero NO SHALL haberse descargado hasta navegar a `/postulaciones`

### Requirement: Mover una postulación

Cada tarjeta SHALL poder moverse arrastrándola a otra columna y, sin ratón, con la acción "Mover a…", que ofrece todos
los estados. Soltar en "En proceso" SHALL pedir una etapa opcional; soltar en "Cerradas" SHALL pedir cuál de los tres
cierres es. La tarjeta SHALL quedar en su columna nueva cuando la API confirme el cambio; si falla, SHALL volver a donde
estaba y mostrarse el error. Un `409` con `application_conflict` SHALL mostrar "Esta postulación cambió en otra pestaña.
La hemos actualizado; muévela de nuevo si hace falta." y volver a pedir las postulaciones.

#### Scenario: Arrastrar a "Postulé"

- **GIVEN** una tarjeta en "Me interesan"
- **WHEN** el usuario la arrastra a "Postulé"
- **THEN** la tarjeta SHALL quedar en "Postulé" con "Postulaste hace 0 días"

#### Scenario: Mover sin ratón a "En proceso"

- **GIVEN** una tarjeta en "Postulé"
- **WHEN** el usuario elige "Mover a…" → "En proceso" y escribe la etapa "Entrevista"
- **THEN** la tarjeta SHALL quedar en "En proceso" mostrando "Entrevista"

#### Scenario: Cerrar como rechazada

- **GIVEN** una tarjeta en "En proceso"
- **WHEN** el usuario la suelta en "Cerradas" y elige "Rechazada"
- **THEN** la tarjeta SHALL quedar en "Cerradas" con la etiqueta "Rechazada"

#### Scenario: Cambió en otra pestaña

- **WHEN** mover una tarjeta responde `409` con `application_conflict`
- **THEN** SHALL mostrarse "Esta postulación cambió en otra pestaña. La hemos actualizado; muévela de nuevo si hace
  falta."
- **AND** la tarjeta SHALL mostrarse en la columna que devuelve la API

### Requirement: Detalle, historial, notas y compartir

Al abrir una tarjeta SHALL mostrarse un panel con la oferta (que se abre en una pestaña nueva con
`rel="noopener noreferrer"`), su estado y su etapa editables, el historial del más antiguo al más reciente con la fecha
de cada cambio, las notas con su botón de guardar, y el interruptor "Compartir mi estado con mis grupos" con la
explicación "Tus grupos verán tu nombre y el estado en esta oferta. Nunca la etapa, las notas ni el historial.". Los
errores SHALL mostrarse sin perder lo escrito.

#### Scenario: Historial legible

- **GIVEN** una postulación creada en "Me interesa", pasada a "Postulé" y a "En proceso" con la etapa "Entrevista"
- **WHEN** el usuario abre su tarjeta
- **THEN** SHALL ver tres entradas en ese orden, la última "En proceso · Entrevista", cada una con su fecha

#### Scenario: Compartir con los grupos

- **GIVEN** una postulación privada
- **WHEN** el usuario activa "Compartir mi estado con mis grupos"
- **THEN** la tarjeta del tablero SHALL mostrar la marca de compartida

#### Scenario: Nota que no se guardó

- **WHEN** guardar la nota responde con error
- **THEN** SHALL mostrarse el mensaje y conservarse la nota escrita

### Requirement: Seguir desde la tarjeta de la oferta

En el detalle del grupo y en `/mis-links`, una tarjeta que el usuario no sigue SHALL ofrecer "Me interesa" y "Postulé";
una que ya sigue SHALL mostrar su estado propio con un enlace a `/postulaciones`, y "Postulé" mientras esté en
"Guardada" o "Me interesa". El estado propio de todas las tarjetas cargadas SHALL pedirse en una sola petición por
página, no una por tarjeta. Pulsar un gesto SHALL actualizar la tarjeta sin recargar la lista; si la respuesta dice que
ya la seguía, SHALL mostrarse su estado real con "Ya la seguías".

#### Scenario: Postulé desde el grupo

- **GIVEN** un miembro viendo una tarjeta que no sigue
- **WHEN** pulsa "Postulé"
- **THEN** la tarjeta SHALL mostrar "Postulé" como su estado y el enlace al tablero
- **AND** la oferta SHALL aparecer en la columna "Postulé" de `/postulaciones`

#### Scenario: De "Me interesa" a "Postulé"

- **GIVEN** una tarjeta que el usuario sigue en "Me interesa"
- **WHEN** pulsa "Postulé"
- **THEN** la tarjeta SHALL mostrar "Postulé" como su estado

#### Scenario: Una petición por página

- **GIVEN** un miembro que abre un grupo con 20 ofertas
- **WHEN** se pinta la lista
- **THEN** el SPA SHALL hacer una sola petición de estados propios para esas 20

### Requirement: Quién más sigue esta oferta

En el detalle del grupo, cada tarjeta SHALL mostrar a los miembros que comparten su estado sobre esa oferta como avatares
con sus iniciales, hasta cinco y después "+N", cada uno con la etiqueta accesible "<nombre> · <estado>". Los estados
compartidos de todas las tarjetas cargadas SHALL pedirse en una sola petición por página, y SHALL volver a pedirse
cuando la pestaña recupere el foco. `/mis-links` NO SHALL mostrar avatares.

#### Scenario: Avatares en la tarjeta

- **GIVEN** una oferta del grupo donde Ana comparte "En proceso" y Beto "Postulé"
- **WHEN** Carla abre el detalle del grupo
- **THEN** la tarjeta SHALL mostrar los avatares de Ana y Beto con "Ana · En proceso" y "Beto · Postulé"

#### Scenario: Más de cinco

- **GIVEN** una oferta con siete miembros que comparten su estado
- **WHEN** un miembro abre el detalle del grupo
- **THEN** la tarjeta SHALL mostrar cinco avatares y "+2"

#### Scenario: Volver a la pestaña

- **GIVEN** un miembro con el detalle del grupo abierto en una pestaña en segundo plano
- **WHEN** Ana comparte su estado en otra sesión y el miembro vuelve a la pestaña
- **THEN** el SPA SHALL pedir de nuevo los estados compartidos y mostrar a Ana

### Requirement: Textos en español e inglés

Todos los textos visibles del tablero, el panel, los gestos, los nombres de los estados y los mensajes de error de
postulaciones SHALL estar marcados para i18n con español como idioma fuente y traducción al inglés.

#### Scenario: Traducciones completas

- **WHEN** se comprueba `messages.en.xlf` tras extraer los mensajes
- **THEN** cada unidad de traducción SHALL tener `target`
