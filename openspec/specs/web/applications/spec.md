# web/applications Specification

## Purpose

Da al SPA el tablero donde cada persona ve en qué punto está de cada oferta que sigue, la forma de empezar a seguir una
desde su tarjeta, de contarlo a sus grupos o de dejar de seguirla, y en la tarjeta de grupo quién más está detrás de
esa vacante.

## Requirements

### Requirement: Nombres de los gestos y de los estados

Los gestos SHALL ir en primera persona: "Me interesa" y "Postulé". Los estados SHALL mostrarse con nombres neutros en
todo el SPA: "Guardada", "Interés", "Postulada", "En proceso", "Oferta", "Aceptada", "Rechazada", "Retirada" y
"Expirada". La fecha de postulación SHALL mostrarse como "Postulaste hoy", "Postulaste ayer" o "Postulaste hace N días",
con el plural correcto.

#### Scenario: Estado ajeno en tercera persona

- **GIVEN** Beto, que comparte que está en `applied`
- **WHEN** Carla ve su avatar en la tarjeta del grupo
- **THEN** la etiqueta accesible SHALL ser "Beto · postulación: Postulada"

#### Scenario: Fecha de postulación legible

- **GIVEN** tres postulaciones con `appliedAt` de hoy, de ayer y de hace 6 días
- **WHEN** el usuario abre `/postulaciones`
- **THEN** SHALL ver "Postulaste hoy", "Postulaste ayer" y "Postulaste hace 6 días"

### Requirement: Tablero de postulaciones

`/postulaciones` SHALL ser una ruta con sesión, cargada de forma diferida, accesible desde la barra de navegación con el
texto "Postulaciones". SHALL mostrar las postulaciones propias en columnas, en este orden: "Interés" (que incluye
también las que estén en `saved`), "Postuladas", "En proceso", "Con oferta", "Aceptadas" y "Cerradas", que reúne las
rechazadas, retiradas y expiradas con una etiqueta que dice cuál es cada una. NO SHALL haber columna de guardadas. Cada
tarjeta SHALL mostrar el título de la oferta (o la etiqueta derivada de su URL si no lo tiene), su empresa, su
plataforma, la etapa en "En proceso", la fecha de postulación cuando la haya, y una marca cuando se comparte con los
grupos. Sin postulaciones SHALL mostrar "Aquí verás las ofertas que sigues. Pulsa «Me interesa» o «Postulé» en
cualquier oferta de tus grupos o de tu lista." con enlaces a `/grupos` y a `/mis-links`.

#### Scenario: Tablero vacío

- **GIVEN** un usuario que no sigue ninguna oferta
- **WHEN** abre `/postulaciones`
- **THEN** SHALL ver "Aquí verás las ofertas que sigues. Pulsa «Me interesa» o «Postulé» en cualquier oferta de tus
  grupos o de tu lista."

#### Scenario: Una tarjeta por postulación, en su columna

- **GIVEN** un usuario con una postulación en `interested`, otra en `in_process` con la etapa "Prueba técnica", otra en
  `offer`, otra en `rejected` y otra en `saved`
- **WHEN** abre `/postulaciones`
- **THEN** SHALL ver en "Interés" la de `interested` y la de `saved`, en "En proceso" la de "Prueba técnica", en "Con
  oferta" la de `offer` y en "Cerradas" la rechazada con la etiqueta "Rechazada"
- **AND** NO SHALL ver ninguna columna de guardadas

#### Scenario: Ruta diferida

- **WHEN** se carga la aplicación en `/grupos`
- **THEN** el código del tablero NO SHALL haberse descargado hasta navegar a `/postulaciones`

### Requirement: Pregunta por la fecha de postulación

Cuando una postulación sin fecha de postulación entra en "Postulada", "En proceso", "Oferta" o "Aceptada" —desde la
tarjeta o desde el tablero—, el SPA SHALL preguntar "¿Cuándo postulaste?". "Hoy" SHALL ser el botón principal y tener
el foco; "Otro día" SHALL desplegar un selector de fecha que no admite días futuros. Con "Hoy" la petición NO SHALL
llevar `appliedAt`; con otro día SHALL llevarla como la medianoche local de ese día en formato ISO. Si la postulación ya
tiene fecha, NO SHALL preguntarse. Cancelar la pregunta SHALL cancelar el gesto o el movimiento.

#### Scenario: Hoy por defecto

- **GIVEN** la pregunta "¿Cuándo postulaste?" abierta
- **WHEN** el usuario pulsa Enter
- **THEN** SHALL responderse "Hoy" y la petición NO SHALL llevar `appliedAt`

#### Scenario: Otro día

- **GIVEN** la pregunta "¿Cuándo postulaste?" abierta
- **WHEN** el usuario pulsa "Otro día" y elige el día 12
- **THEN** la petición SHALL llevar `appliedAt` con la medianoche local del día 12 en formato ISO

#### Scenario: Con fecha previa no se pregunta

- **GIVEN** una tarjeta en "Postuladas" con fecha de postulación
- **WHEN** el usuario la mueve a "Con oferta"
- **THEN** NO SHALL preguntarse la fecha

### Requirement: Mover una postulación

Cada tarjeta SHALL poder moverse arrastrándola a otra columna y, sin ratón, con la acción "Mover a…", que ofrece todos
los estados salvo "Guardada". Soltar en "En proceso" SHALL pedir una etapa opcional, en el mismo diálogo que la fecha si
hay que preguntarla; soltar en "Cerradas" SHALL pedir cuál de los tres cierres es; entrar en "Postuladas", "Con oferta"
o "Aceptadas" SHALL preguntar la fecha según "Pregunta por la fecha de postulación". La tarjeta SHALL quedar en su
columna nueva cuando la API confirme el cambio; si falla o se cancela el diálogo, SHALL volver a donde estaba y, si
falló, mostrarse el error. Un `409` con `application_conflict` SHALL mostrar "Esta postulación cambió en otra pestaña.
La hemos actualizado; muévela de nuevo si hace falta." y volver a pedir las postulaciones.

#### Scenario: Arrastrar a "Postuladas"

- **GIVEN** una tarjeta en "Interés"
- **WHEN** el usuario la arrastra a "Postuladas" y responde "Hoy"
- **THEN** la tarjeta SHALL quedar en "Postuladas" con "Postulaste hoy"

#### Scenario: Postuladas hace días

- **GIVEN** una tarjeta en "Interés"
- **WHEN** el usuario la mueve a "Postuladas" y elige con "Otro día" una fecha de hace tres días
- **THEN** la tarjeta SHALL quedar en "Postuladas" con "Postulaste hace 3 días"

#### Scenario: De "Interés" a "En proceso" en un solo diálogo

- **GIVEN** una tarjeta en "Interés"
- **WHEN** el usuario la suelta en "En proceso"
- **THEN** un solo diálogo SHALL pedir la etapa opcional y "¿Cuándo postulaste?"

#### Scenario: Mover sin ratón a "En proceso"

- **GIVEN** una tarjeta en "Postuladas" con fecha de postulación
- **WHEN** el usuario elige "Mover a…" → "En proceso" y escribe la etapa "Entrevista"
- **THEN** la tarjeta SHALL quedar en "En proceso" mostrando "Entrevista"

#### Scenario: Cerrar como rechazada

- **GIVEN** una tarjeta en "En proceso"
- **WHEN** el usuario la suelta en "Cerradas" y elige "Rechazada"
- **THEN** la tarjeta SHALL quedar en "Cerradas" con la etiqueta "Rechazada"

#### Scenario: El cambio falla

- **GIVEN** una tarjeta en "Interés"
- **WHEN** el usuario la arrastra a "Postuladas", responde "Hoy" y la API responde con un error
- **THEN** la tarjeta SHALL volver a "Interés" y mostrarse el error

#### Scenario: Cambió en otra pestaña

- **WHEN** mover una tarjeta responde `409` con `application_conflict`
- **THEN** SHALL mostrarse "Esta postulación cambió en otra pestaña. La hemos actualizado; muévela de nuevo si hace
  falta."
- **AND** la tarjeta SHALL mostrarse en la columna que devuelve la API

### Requirement: Detalle, historial, notas y compartir

Al abrir una tarjeta SHALL mostrarse un panel con la oferta (que se abre en una pestaña nueva con
`rel="noopener noreferrer"`), su estado y su etapa editables, el historial del más antiguo al más reciente con la fecha
de cada cambio, las notas con su botón de guardar, y el interruptor "Compartir mi estado con mis grupos" con la
explicación "Te verán los miembros de tus grupos donde esté esta oferta, ahora o más adelante, incluidos quienes se unan
después. Verán tu nombre y tu estado, también cuando cambie (por ejemplo, «Rechazada»). Nunca la etapa, las notas ni el
historial. Puedes dejar de compartir cuando quieras.". Los errores SHALL mostrarse sin perder lo escrito.

#### Scenario: Historial legible

- **GIVEN** una postulación creada con "Me interesa", pasada a "Postulada" y a "En proceso" con la etapa "Entrevista"
- **WHEN** el usuario abre su tarjeta
- **THEN** SHALL ver tres entradas en ese orden, la última "En proceso · Entrevista", cada una con su fecha

#### Scenario: Compartir con los grupos

- **GIVEN** una postulación privada
- **WHEN** el usuario abre su panel
- **THEN** SHALL ver junto al interruptor "Te verán los miembros de tus grupos donde esté esta oferta, ahora o más
  adelante, incluidos quienes se unan después. Verán tu nombre y tu estado, también cuando cambie (por ejemplo,
  «Rechazada»). Nunca la etapa, las notas ni el historial. Puedes dejar de compartir cuando quieras."
- **AND** al activar "Compartir mi estado con mis grupos", la tarjeta del tablero SHALL mostrar la marca de compartida

#### Scenario: Nota que no se guardó

- **WHEN** guardar la nota responde con error
- **THEN** SHALL mostrarse el mensaje y conservarse la nota escrita

### Requirement: Dejar de seguir desde el panel

El panel SHALL ofrecer "Dejar de seguir", que pide confirmación con "Dejarás de seguir esta oferta: se borrarán tu
estado, tus notas y tu historial de esta oferta. Tus grupos dejarán de verte en ella. No se puede deshacer." antes de
llamar a la API. Mientras la petición esté en curso, el botón SHALL estar deshabilitado. Un `204` o un `404` con
`application_not_found` SHALL tratarse como éxito: SHALL cerrarse el panel, la tarjeta SHALL desaparecer del tablero y
la tarjeta de la oferta SHALL volver a ofrecer "Me interesa" y "Postulé".

#### Scenario: Dejar de seguir

- **GIVEN** un usuario con el panel de una postulación abierto
- **WHEN** pulsa "Dejar de seguir" y confirma
- **THEN** el panel SHALL cerrarse y la tarjeta NO SHALL aparecer en `/postulaciones`
- **AND** en el detalle del grupo, esa oferta SHALL volver a ofrecer "Me interesa" y "Postulé"

#### Scenario: Ya no existía

- **GIVEN** un usuario con el panel de una postulación que ya se dejó de seguir en otra pestaña
- **WHEN** pulsa "Dejar de seguir", confirma y la API responde `404` con `application_not_found`
- **THEN** el panel SHALL cerrarse sin mostrar ningún error

#### Scenario: Un solo borrado por doble clic

- **GIVEN** la confirmación de "Dejar de seguir" aceptada y la petición en curso
- **WHEN** el usuario vuelve a pulsar "Dejar de seguir"
- **THEN** el SPA NO SHALL enviar una segunda petición

#### Scenario: Cancelar dejar de seguir

- **GIVEN** un usuario con el panel de una postulación abierto
- **WHEN** pulsa "Dejar de seguir" y cancela la confirmación
- **THEN** el SPA NO SHALL llamar a la API y el panel SHALL seguir abierto

### Requirement: Seguir desde la tarjeta de la oferta

En el detalle del grupo y en `/mis-links`, una tarjeta que el usuario no sigue SHALL ofrecer "Me interesa" y "Postulé";
una que ya sigue SHALL mostrar el nombre de su estado propio con un enlace a `/postulaciones`, y "Postulé" mientras esté
en "Guardada" o "Interés". "Postulé" SHALL preguntar la fecha según "Pregunta por la fecha de postulación". Pulsar un
gesto SHALL actualizar la tarjeta sin recargar la lista; si la respuesta dice que ya la seguía, SHALL mostrarse su
estado real con "Ya la seguías".

#### Scenario: Postulé desde el grupo

- **GIVEN** un miembro viendo una tarjeta que no sigue
- **WHEN** pulsa "Postulé" y responde "Hoy"
- **THEN** la tarjeta SHALL mostrar "Postulada" como su estado y el enlace al tablero
- **AND** la oferta SHALL aparecer en la columna "Postuladas" de `/postulaciones`

#### Scenario: De "Interés" a "Postulé"

- **GIVEN** una tarjeta que el usuario sigue en "Interés"
- **WHEN** pulsa "Postulé" y responde "Hoy"
- **THEN** la tarjeta SHALL mostrar "Postulada" como su estado

#### Scenario: Ya la seguía en otra pestaña

- **GIVEN** una tarjeta que el usuario empezó a seguir en `in_process` desde otra pestaña
- **WHEN** pulsa "Me interesa" en esta
- **THEN** la tarjeta SHALL mostrar "En proceso" con "Ya la seguías"

### Requirement: Invitación a compartir tras el gesto

En el detalle de un grupo, tras "Me interesa" o "Postulé", si la postulación resultante es privada, SHALL mostrarse un
aviso que dice el alcance: tras "Postulé", "¿Que tus grupos vean que postulaste a esta oferta? También quien entre
después."; tras "Me interesa", "¿Que tus grupos vean que te interesa esta oferta? También quien entre después.". SHALL
ofrecer "Compartir", que activa la visibilidad `group`, y "Qué verán", que muestra la misma explicación que el
interruptor del panel. Tras compartir SHALL mostrarse "Compartido · Deshacer", y "Deshacer" SHALL volver a `private`.
Las dos acciones SHALL actuar sobre la postulación del gesto que abrió el aviso; si la API responde `404` con
`application_not_found`, NO SHALL mostrarse ningún error. Los avisos SHALL anunciarse a los lectores de pantalla y NO
SHALL cerrarse antes de 10 segundos ni mientras tengan el foco. Si no se pulsa "Compartir", la postulación SHALL seguir
privada. En `/mis-links` NO SHALL mostrarse el aviso.

#### Scenario: Compartir tras el gesto

- **GIVEN** un miembro en el detalle de un grupo con una tarjeta que no sigue
- **WHEN** pulsa "Me interesa"
- **THEN** SHALL ver "¿Que tus grupos vean que te interesa esta oferta? También quien entre después." con "Compartir" y
  "Qué verán"
- **AND** al pulsar "Compartir", la postulación SHALL quedar con visibilidad `group` y SHALL verse "Compartido ·
  Deshacer"

#### Scenario: Deshacer compartir

- **GIVEN** un miembro que acaba de pulsar "Compartir" en el aviso
- **WHEN** pulsa "Deshacer" en "Compartido · Deshacer"
- **THEN** la postulación SHALL volver a visibilidad `private`
- **AND** su avatar NO SHALL verse en la tarjeta del grupo

#### Scenario: Texto tras "Postulé"

- **GIVEN** un miembro en el detalle de un grupo con una tarjeta que no sigue
- **WHEN** pulsa "Postulé" y responde "Hoy"
- **THEN** SHALL ver "¿Que tus grupos vean que postulaste a esta oferta? También quien entre después."

#### Scenario: El aviso espera

- **GIVEN** el aviso de compartir visible con el foco en "Compartir"
- **WHEN** pasan 15 segundos
- **THEN** el aviso SHALL seguir visible

#### Scenario: Se dejó de seguir entretanto

- **GIVEN** el aviso de compartir visible y la postulación ya dejada de seguir en otra pestaña
- **WHEN** el usuario pulsa "Compartir" y la API responde `404` con `application_not_found`
- **THEN** NO SHALL mostrarse ningún error y la tarjeta SHALL volver a ofrecer "Me interesa" y "Postulé"

#### Scenario: Sin pulsar, sigue privada

- **GIVEN** un miembro en el detalle de un grupo con una tarjeta que no sigue
- **WHEN** pulsa "Postulé", responde "Hoy" y deja que el aviso desaparezca
- **THEN** la postulación SHALL seguir privada

#### Scenario: En Mis links no se ofrece

- **GIVEN** un usuario en `/mis-links` con una tarjeta que no sigue
- **WHEN** pulsa "Me interesa"
- **THEN** NO SHALL mostrarse el aviso de compartir

#### Scenario: Ya estaba compartida

- **GIVEN** una tarjeta que el usuario sigue con visibilidad `group` en "Interés"
- **WHEN** pulsa "Postulé" y responde "Hoy"
- **THEN** NO SHALL mostrarse el aviso

### Requirement: Estados de la página, por bloques y de la sesión actual

El estado propio de las tarjetas cargadas SHALL pedirse por bloques de hasta 50 links, no una vez por tarjeta: uno por
cada página cargada y otro por los links que se añadan al guardar o importar. Una carga por links SHALL sustituir lo que
el SPA tenía de esos links, de modo que una postulación que ya no existe deje de mostrarse. Un `404` con
`application_not_found` en cualquier operación sobre una postulación propia SHALL quitarla de lo que el SPA muestra, sin
mensaje de error. Todo lo que el SPA guarda de postulaciones SHALL descartarse cuando cambie el usuario de la sesión.

#### Scenario: Una petición por página

- **GIVEN** un miembro que abre un grupo con 20 ofertas
- **WHEN** se pinta la lista
- **THEN** el SPA SHALL hacer una sola petición de estados propios para esas 20

#### Scenario: Links recién guardados

- **GIVEN** un miembro en el detalle de un grupo
- **WHEN** importa un chat que añade 3 ofertas a la lista
- **THEN** el SPA SHALL pedir los estados de esas 3 en una sola petición

#### Scenario: Dejó de seguirla en otra pestaña

- **GIVEN** una tarjeta que el SPA muestra como seguida en "Interés"
- **WHEN** se recarga el estado propio de esa página y la respuesta ya no la trae
- **THEN** la tarjeta SHALL volver a ofrecer "Me interesa" y "Postulé"

#### Scenario: Postulación que ya no existe

- **GIVEN** una tarjeta del tablero cuya postulación se dejó de seguir en otra pestaña
- **WHEN** el usuario la mueve y la API responde `404` con `application_not_found`
- **THEN** la tarjeta SHALL desaparecer del tablero sin mostrar ningún error

#### Scenario: Cambio de usuario

- **GIVEN** Ana, con postulaciones cargadas en el SPA, que cierra sesión
- **WHEN** Beto inicia sesión en la misma pestaña y abre `/postulaciones` y un grupo
- **THEN** NO SHALL verse ninguna postulación ni ningún estado de Ana guardado de la sesión anterior

### Requirement: Quién más sigue esta oferta

En el detalle del grupo, cada tarjeta SHALL mostrar a los miembros que comparten su estado sobre esa oferta como avatares
con sus iniciales, hasta cinco y después "+N", cada uno con la etiqueta accesible "<nombre> · postulación: <estado>".
Los estados compartidos de las tarjetas cargadas SHALL pedirse por bloques de hasta 50 links: uno por página cargada,
uno por los links añadidos al guardar o importar y, cuando la pestaña recupere el foco, uno por cada bloque de hasta 50
de los links cargados. Compartir, dejar de compartir y dejar de seguir SHALL mostrar u ocultar el avatar propio al
momento, sin otra petición de estados compartidos. `/mis-links` NO SHALL mostrar avatares.

#### Scenario: Avatares en la tarjeta

- **GIVEN** una oferta del grupo donde Ana comparte `in_process` y Beto `applied`
- **WHEN** Carla abre el detalle del grupo
- **THEN** la tarjeta SHALL mostrar los avatares de Ana y Beto con "Ana · postulación: En proceso" y "Beto · postulación:
  Postulada"

#### Scenario: Más de cinco

- **GIVEN** una oferta con siete miembros que comparten su estado
- **WHEN** un miembro abre el detalle del grupo
- **THEN** la tarjeta SHALL mostrar cinco avatares y "+2"

#### Scenario: Mi avatar al momento

- **GIVEN** Ana en el detalle de un grupo, con una postulación privada sobre una de sus ofertas
- **WHEN** activa compartir y después deja de seguirla
- **THEN** su avatar SHALL aparecer en esa tarjeta y después desaparecer
- **AND** el SPA NO SHALL pedir los estados compartidos del grupo para ello

#### Scenario: Volver a la pestaña

- **GIVEN** un miembro con el detalle del grupo abierto en una pestaña en segundo plano y 120 ofertas cargadas
- **WHEN** Ana comparte su estado en otra sesión y el miembro vuelve a la pestaña
- **THEN** el SPA SHALL pedir de nuevo los estados compartidos en tres peticiones, de 50, 50 y 20 links
- **AND** SHALL mostrar a Ana

### Requirement: Textos en español e inglés

Todos los textos visibles del tablero, el panel, los gestos, los avisos, los diálogos, los nombres de los estados y los
mensajes de error de postulaciones SHALL estar marcados para i18n con español como idioma fuente y traducción al inglés.

#### Scenario: Traducciones completas

- **WHEN** se comprueba `messages.en.xlf` tras extraer los mensajes
- **THEN** cada unidad de traducción SHALL tener `target`
