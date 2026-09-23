# web/links Specification

## Purpose

Da al SPA lo que convierte un grupo vacío en un repositorio de ofertas: guardar un link, pegar el chat entero, abrir lo
guardado y quitar lo que no era una oferta.

## Requirements

### Requirement: Links en el detalle del grupo

`/grupos/:id` SHALL mostrar los links del grupo. Un link con preview SHALL mostrarse con su título, su empresa, su
ubicación, su modalidad y su seniority cuando los tenga, su salario formateado cuando exista, cuándo se publicó y cuándo
cierra; uno sin preview SHALL mostrar una etiqueta legible derivada de su URL (último segmento del path sin guiones ni
extensión, o el dominio si no lo hay). Todos SHALL mostrar la plataforma, quién lo compartió y su estado. Sin links
SHALL mostrar "Todavía no hay ofertas aquí. Guarda un link o pega el chat donde las compartís."

El texto de estado SHALL derivarse de lo que la persona tiene delante, no del nombre interno del estado: un link cuya
lectura se pidió hace poco SHALL decir "Leyendo la oferta…"; uno sin datos cuya lectura se pidió hace tiempo y no ha
terminado, "Sin vista previa todavía"; uno al que le faltan campos, "Faltan datos de esta oferta"; y uno que no se pudo
leer, un texto según el motivo —"Esto no parece una oferta" o "No pudimos leer esta oferta"— con la acción de
completarla a mano y, cuando el motivo sea transitorio, la de reintentar. Cuando la bolsa no permite la lectura o nos
bloquea, y el link no tiene todavía título, el texto SHALL decir qué hacer —"<Plataforma> no nos deja leer sus ofertas.
Pega su descripción para completarla"— y "Pegar la descripción" SHALL ser la acción principal, visible sin abrir ningún
menú, con completarla a mano como secundaria.

Cada tarjeta de oferta SHALL ofrecer además la acción **"Analizar mi encaje"**, con ese mismo rótulo —el que define
`web/cv-match`— y a **cualquiera que pueda ver la oferta**, no solo a quien la compartió: lo que se analiza es el encaje
de quien mira. Pulsarla SHALL abrir sobre la lista el diálogo del análisis de encaje, sin sacar de la lista ni navegar a
ninguna ruta nueva, y **NO SHALL pedir ningún análisis por abrirse**: el diálogo dice primero qué va a pasar y espera a
que se lo pidan. Cerrarlo SHALL devolver a la lista tal como estaba.

- La acción SHALL ofrecerse **aunque quien mira no tenga ningún CV guardado**. La lista no sabe nada de los CV de nadie
  y averiguarlo por tarjeta sería una petición por oferta; quien no lo tenga SHALL encontrarlo dicho dentro del diálogo,
  con la salida que lleva a `/mi-cv`. Esconder la acción dejaría sin entrada justo a quien más la necesita.
- La acción NO SHALL ofrecerse en un link cuya lectura terminó en que lo compartido no era una oferta: ahí no hay
  vacante contra la que comparar y el único gesto útil es quitarlo.
- La tarjeta NO SHALL mostrar ninguna puntuación de encaje: ni badge, ni número, ni hueco reservado para ella. Abrir la
  lista NO SHALL pedir el análisis ni la puntuación de ninguna oferta, porque la puntuación se pide **por oferta** y una
  lista de veinte ofertas serían veinte peticiones, casi todas sin resultado. Dónde sí se ve el badge lo dicen
  `web/cv-match` (en el diálogo) y `web/applications` (en el tablero).
- Ninguna tarjeta SHALL mostrar el encaje de otro miembro del grupo.

#### Scenario: Grupo con links

- **GIVEN** un miembro de un grupo con dos links guardados hace tiempo y sin preview
- **WHEN** abre el detalle
- **THEN** SHALL ver los dos con su etiqueta, su plataforma, quién los compartió y "Sin vista previa todavía"

#### Scenario: Grupo sin links

- **GIVEN** un grupo recién creado
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver "Todavía no hay ofertas aquí. Guarda un link o pega el chat donde las compartís."

#### Scenario: Oferta enriquecida

- **GIVEN** un link `enriched` con título, empresa, ubicación, modalidad y seniority
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver esos datos en lugar de la etiqueta derivada de la URL

#### Scenario: Oferta recién guardada

- **GIVEN** un link cuya lectura se acaba de pedir
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver "Leyendo la oferta…"

#### Scenario: Lectura que nunca llegó

- **GIVEN** un link sin datos cuya lectura se pidió hace mucho
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver "Sin vista previa todavía"

#### Scenario: Oferta con salario y fechas

- **GIVEN** un link con salario en rango y fecha de cierre
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver el salario formateado y cuándo cierra la oferta

#### Scenario: Oferta que no se pudo leer

- **GIVEN** un link `failed` por un tiempo de espera agotado
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver "No pudimos leer esta oferta", la acción de completarla a mano y la de reintentar

#### Scenario: Bolsa que no permite la lectura

- **GIVEN** un link de LinkedIn, sin título, `failed` porque el sitio prohíbe la lectura automática
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver "LinkedIn no nos deja leer sus ofertas. Pega su descripción para completarla"
- **AND** "Pegar la descripción" SHALL ser la acción principal, visible sin abrir ningún menú
- **AND** NO SHALL ver la acción de reintentar

#### Scenario: Lo compartido no era una oferta

- **GIVEN** un link `failed` porque lo compartido no es una vacante
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver "Esto no parece una oferta" y la acción de quitarlo

#### Scenario: Analizar el encaje desde la tarjeta

- **GIVEN** un miembro viendo una oferta ya leída en el detalle de su grupo
- **WHEN** mira su tarjeta
- **THEN** SHALL ver la acción "Analizar mi encaje"
- **AND** al pulsarla SHALL abrirse el diálogo del análisis sobre la lista, sin salir de ella ni cambiar de ruta

#### Scenario: Abrir el diálogo no pide ningún análisis

- **GIVEN** un miembro que pulsa "Analizar mi encaje" en una oferta de su grupo
- **WHEN** el diálogo se abre
- **THEN** NO SHALL haberse pedido ningún análisis
- **AND** al cerrarlo SHALL volver a la lista tal como estaba

#### Scenario: Analizar sin tener ningún CV

- **GIVEN** Beto sin ningún CV guardado, viendo una oferta de su grupo
- **WHEN** mira su tarjeta
- **THEN** SHALL ver igualmente la acción "Analizar mi encaje"
- **AND** al pulsarla el diálogo SHALL decirle que necesita un CV guardado y ofrecerle ir a `/mi-cv`

#### Scenario: Lo que no es una oferta no se analiza

- **GIVEN** un link `failed` porque lo compartido no es una vacante
- **WHEN** un miembro mira su tarjeta
- **THEN** NO SHALL ver la acción "Analizar mi encaje"

#### Scenario: La lista sigue sin puntuaciones

- **GIVEN** un miembro con un análisis completo terminado sobre una oferta de su grupo
- **WHEN** abre el detalle del grupo
- **THEN** ninguna tarjeta SHALL mostrar un badge ni un número de encaje
- **AND** NO SHALL pedirse ningún análisis ni ninguna puntuación al cargar la lista

### Requirement: Abrir una oferta

Cada link de la lista SHALL abrirse en una pestaña nueva con `rel="noopener noreferrer"`, usando la URL tal como se
guardó (`displayUrl`), no la normalizada.

#### Scenario: Abrir una oferta

- **GIVEN** un miembro viendo la lista de links
- **WHEN** pulsa un link
- **THEN** SHALL abrirse `displayUrl` en una pestaña nueva con `rel="noopener noreferrer"`

### Requirement: Guardar un link desde el SPA

El detalle del grupo y la vista privada SHALL ofrecer guardar un link pegando su URL. Al guardarlo, la lista SHALL
actualizarse sin recargar. `invalid_url` SHALL mostrar "Eso no parece un enlace de una oferta". Si la respuesta
trae `alreadyInGroups`, SHALL mostrarse "Ya lo tienes en: <grupos>"; solo cuando `shared` es `already_there` SHALL
mostrarse "Ya estaba aquí, lo compartió <nombre>".

Cuando el link nazca con enlace público —porque el grupo comparte en público—, la confirmación SHALL decirlo en una
línea, "Cualquiera con este enlace verá la oferta; no se verá el grupo ni tu nombre", y SHALL ofrecer "Copiar enlace"
sobre el enlace que ya viene en la respuesta, sin pedir nada más a la API. Si la oferta todavía no se ha leído, copiar
SHALL avisar con "Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos" y SHALL dejar
copiar igualmente. Cuando el link no nazca publicado, NO SHALL mostrarse ni esa línea ni "Copiar enlace".

#### Scenario: Link guardado

- **GIVEN** un miembro en el detalle del grupo
- **WHEN** guarda una URL válida
- **THEN** el link SHALL aparecer en la lista sin recargar

#### Scenario: URL inválida

- **WHEN** la API responde `400` con `invalid_url`
- **THEN** SHALL mostrarse "Eso no parece un enlace de una oferta" y conservarse lo escrito

#### Scenario: Aviso de link repetido

- **WHEN** la respuesta trae `alreadyInGroups` con "Backend Bolivia"
- **THEN** SHALL mostrarse "Ya lo tienes en: Backend Bolivia"

#### Scenario: El link ya estaba en este grupo

- **WHEN** la respuesta trae `shared` `already_there`
- **THEN** SHALL mostrarse "Ya estaba aquí, lo compartió Ana"

#### Scenario: Vacante conocida compartida por primera vez

- **WHEN** la respuesta trae `created` `false` y `shared` `created`
- **THEN** el link SHALL aparecer en la lista y NO SHALL mostrarse ningún aviso de que ya estaba

#### Scenario: Guardado en un grupo que comparte en público

- **GIVEN** un miembro de un grupo con la visibilidad por defecto encendida
- **WHEN** guarda una URL válida
- **THEN** SHALL ver "Cualquiera con este enlace verá la oferta; no se verá el grupo ni tu nombre" y "Copiar enlace"
- **AND** lo copiado SHALL ser la URL pública que trajo la respuesta, sin otra petición a la API

#### Scenario: Guardado en un grupo que no comparte en público

- **GIVEN** un miembro de un grupo con la visibilidad por defecto apagada
- **WHEN** guarda una URL válida
- **THEN** NO SHALL ver "Copiar enlace" ni ninguna línea sobre el enlace público

#### Scenario: Copiar el enlace de una oferta recién guardada

- **GIVEN** un link recién guardado en un grupo que comparte en público, todavía sin leer
- **WHEN** el miembro pulsa "Copiar enlace"
- **THEN** SHALL ver "Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos"
- **AND** el enlace SHALL copiarse igualmente

### Requirement: Importar pegando el chat

El SPA SHALL ofrecer importar pegando texto, en un cuadro con la explicación "Pega aquí el chat: encontraremos los
enlaces de ofertas" y un contador que avisa antes de enviar cuando se superan los 20 000 caracteres ("Pega menos texto:
hasta 20 000 caracteres"). Al terminar SHALL mostrar el resumen "N guardadas, M ya estaban" con plurales correctos y, si
los hubo, "K enlaces no se pudieron leer" y "Nos quedamos en 50: vuelve a pegar el mismo texto para continuar". La lista SHALL
actualizarse con lo importado.

#### Scenario: Importación con repetidos

- **GIVEN** un miembro en el detalle del grupo
- **WHEN** pega un texto del que 2 links son nuevos y 1 ya estaba
- **THEN** SHALL ver "2 guardadas, 1 ya estaba" y los links nuevos en la lista

#### Scenario: Importación sin enlaces

- **WHEN** pega un texto sin enlaces
- **THEN** SHALL ver que no se encontró ninguna oferta y la lista NO SHALL cambiar

#### Scenario: Importación recortada a 50

- **WHEN** la respuesta trae `skipped` 10
- **THEN** SHALL ver "Nos quedamos en 50: vuelve a pegar el mismo texto para continuar"

#### Scenario: Texto demasiado largo

- **GIVEN** un texto de más de 20 000 caracteres pegado en el cuadro
- **WHEN** el usuario intenta importarlo
- **THEN** SHALL verse "Pega menos texto: hasta 20 000 caracteres" y NO SHALL llamarse a la API

### Requirement: Quitar un link desde el SPA

Cada link SHALL ofrecer quitarlo a quien lo compartió y al `owner` del grupo, con una confirmación que diga "Se quita de
este grupo; la oferta sigue disponible en otros grupos." cuando el link no tiene comentarios en el grupo. Si los tiene,
SHALL decir cuántos se borran con él, con el plural correcto: "Se quita de este grupo junto con su comentario; la oferta
sigue disponible en otros grupos." o "Se quita de este grupo junto con sus N comentarios; la oferta sigue disponible en
otros grupos.". El número SHALL salir del contador que trae el link, no de los comentarios que haya en pantalla. Si el
link tiene enlace público, la confirmación SHALL añadir "Su enlace público dejará de funcionar." En la
vista privada, cualquier link propio SHALL poder quitarse. Al confirmarse, la lista SHALL actualizarse sin recargar.

#### Scenario: Quitar un enlace que no era una oferta

- **GIVEN** un miembro que importó por error un enlace de un vídeo
- **WHEN** lo quita y confirma
- **THEN** el link SHALL desaparecer de la lista sin recargar

#### Scenario: Sin permiso para quitar

- **GIVEN** un miembro que no es owner viendo un link compartido por otra persona
- **WHEN** mira ese link
- **THEN** NO SHALL ver la acción de quitarlo

#### Scenario: Quitar un link con comentarios

- **GIVEN** un link del grupo con 4 comentarios, de los que la tarjeta muestra 2
- **WHEN** quien lo compartió pulsa quitarlo
- **THEN** la confirmación SHALL decir "Se quita de este grupo junto con sus 4 comentarios; la oferta sigue disponible
  en otros grupos."

#### Scenario: Quitar un link publicado

- **GIVEN** un link del grupo con enlace público y sin comentarios
- **WHEN** quien lo compartió pulsa quitarlo
- **THEN** la confirmación SHALL decir además que su enlace público dejará de funcionar

### Requirement: Lista privada de links

`/mis-links` SHALL mostrar, bajo el título "Solo para mí", los links guardados sin grupo, con las mismas acciones de
guardar, importar, abrir, analizar el encaje y quitar, y SHALL ser accesible desde la barra de navegación. Sin links
SHALL mostrar "Aquí guardas ofertas solo para ti. Las que compartiste están en tus grupos."

"Analizar mi encaje" SHALL ofrecerse aquí con el mismo rótulo, el mismo diálogo y las mismas reglas que en el detalle
del grupo, y esta lista tampoco SHALL mostrar ninguna puntuación de encaje ni pedirla al cargarse.

#### Scenario: Vista privada

- **GIVEN** un usuario con un link privado
- **WHEN** abre `/mis-links`
- **THEN** SHALL ver ese link y no los que guardó dentro de un grupo

#### Scenario: Vista privada vacía

- **GIVEN** un usuario que solo guardó links en grupos
- **WHEN** abre `/mis-links`
- **THEN** SHALL ver "Aquí guardas ofertas solo para ti. Las que compartiste están en tus grupos."

#### Scenario: Analizar el encaje de un link privado

- **GIVEN** un usuario con un link privado de una oferta ya leída
- **WHEN** abre `/mis-links`
- **THEN** SHALL ver en su tarjeta la acción "Analizar mi encaje"
- **AND** la tarjeta NO SHALL mostrar ningún badge de encaje

### Requirement: Textos en español e inglés

Todos los textos visibles de las listas, los formularios y los mensajes de error de links SHALL estar marcados para i18n
con español como idioma fuente y traducción al inglés.

#### Scenario: Traducciones completas

- **WHEN** se comprueba `messages.en.xlf` tras extraer los mensajes
- **THEN** cada unidad de traducción SHALL tener `target`

### Requirement: La tarjeta se actualiza sola

Mientras la lista está abierta, el SPA SHALL escuchar los avisos de enriquecimiento y SHALL actualizar la tarjeta del
link avisado sin recargar la página ni volver a pedir la lista entera. Mientras queden links por leer, SHALL mostrar
cuántos van listos del total que se está leyendo. Si el canal no está disponible, la lista SHALL seguir funcionando y
mostrando lo que devolvió la API, y SHALL volver a pedirla cuando la pestaña recupere el foco, para que la espera acabe
igual.

#### Scenario: Preview que llega mientras miras

- **GIVEN** un miembro viendo un link en "Sin vista previa todavía"
- **WHEN** llega el aviso de que ese link quedó enriquecido
- **THEN** su tarjeta SHALL mostrar el título y la empresa sin recargar

#### Scenario: Sin canal disponible

- **GIVEN** el canal de eventos que no se puede abrir
- **WHEN** el miembro abre la lista
- **THEN** SHALL ver los links tal como los devolvió la API, sin errores en pantalla
- **AND** al volver a la pestaña SHALL pedirse la lista de nuevo

#### Scenario: Progreso de una importación

- **GIVEN** un miembro que acaba de importar un chat con diez ofertas por leer
- **WHEN** llegan los avisos de las tres primeras
- **THEN** SHALL ver que van tres de diez listas

### Requirement: Editar la oferta a mano

Cada link SHALL ofrecer editar los campos de su preview a quien puede verlo, con un formulario que muestra el valor
actual de cada campo y de dónde salió, distinguiendo lo leído de la página ("Leído de la página"), lo deducido por la
IA ("Deducido por la IA"), lo sacado de un texto pegado ("Descripción pegada por <nombre>") y lo escrito por una persona
("Escrito por <nombre>"). Un campo que sustituyó a otro SHALL poder devolverse a lo que había ("Volver a lo anterior").
Al guardar, la tarjeta SHALL mostrar los valores nuevos y decir quién los escribió, porque el link es compartido y lo
que una persona corrige lo ven las demás. Un error de la API SHALL mostrarse sin perder lo escrito.

#### Scenario: Corregir el título

- **GIVEN** un miembro viendo un link con el título mal extraído
- **WHEN** lo corrige y guarda
- **THEN** la tarjeta SHALL mostrar el título nuevo marcado como escrito a mano

#### Scenario: Origen de cada campo

- **GIVEN** un link con el título escrito a mano, la empresa leída de la página y el salario deducido por la IA
- **WHEN** un miembro abre el formulario
- **THEN** SHALL ver "Escrito por" en el título, "Leído de la página" en la empresa y "Deducido por la IA" en el salario

#### Scenario: Quién lo escribió, en la tarjeta

- **GIVEN** un link cuyo título corrigió Ana
- **WHEN** otro miembro mira la tarjeta
- **THEN** SHALL ver que ese dato lo escribió Ana

#### Scenario: Volver a lo extraído

- **GIVEN** un campo corregido a mano
- **WHEN** un miembro pide volver a lo anterior
- **THEN** la tarjeta SHALL mostrar de nuevo el valor que traía la página

#### Scenario: Error al guardar

- **WHEN** la API responde con error al guardar la edición
- **THEN** SHALL mostrarse el mensaje y conservarse lo escrito

#### Scenario: Lo pegado se distingue

- **GIVEN** un link cuya empresa salió de un texto que pegó Beto
- **WHEN** un miembro abre el formulario
- **THEN** SHALL ver "Descripción pegada por Beto" en la empresa

#### Scenario: Volver a lo pegado

- **GIVEN** un campo pegado que después se corrigió a mano
- **WHEN** un miembro pide volver a lo anterior
- **THEN** la tarjeta SHALL mostrar de nuevo el valor pegado

### Requirement: Pegar la descripción de una oferta

Cada link SHALL ofrecer "Pegar la descripción" a quien puede verlo, en un diálogo que funcione igual desde cualquier
pantalla que muestre el link. El diálogo SHALL explicar "Pega el texto de la oferta tal como la ves: lo leemos para
completar la tarjeta y no lo guardamos", SHALL ofrecer además los campos de título y empresa precargados con lo que ya
tenga la tarjeta —porque lo que se copia desde la app del móvil casi nunca trae la cabecera—, y SHALL enviar solo los que
la persona haya cambiado. Mientras la API responde
SHALL mostrar "Leyendo… puede tardar unos segundos" sin permitir enviarlo dos veces. Al terminar, la tarjeta SHALL
actualizarse sin recargar, y ofrecer "Deshacer lo que pegó <nombre>", que devuelve de una vez todos los campos de ese
pegado. Un `422` SHALL mostrar "Eso no parece una oferta de trabajo. Copia la descripción de la
oferta, no la conversación"; un `503`, "No pudimos leerla ahora, inténtalo en un rato"; un `429` por límite de pegados,
"Pegaste demasiadas ofertas seguidas, espera un poco"; y un `429` por cuota de IA, "Llegaste al límite de lecturas de
hoy, vuelve mañana". En todos ellos SHALL conservarse lo pegado.

#### Scenario: Completar una oferta de LinkedIn

- **GIVEN** un miembro viendo un link de LinkedIn con "LinkedIn no nos deja leer sus ofertas. Pega su descripción para
  completarla"
- **WHEN** pulsa "Pegar la descripción", pega el texto, escribe el título y la empresa que ve en la app, y confirma
- **THEN** la tarjeta SHALL mostrar el título y la empresa sin recargar
- **AND** los demás campos SHALL decir que salieron de la descripción que pegó ese miembro

#### Scenario: Se pegó otra cosa

- **WHEN** la API responde `422` con `not_a_job_posting`
- **THEN** SHALL mostrarse "Eso no parece una oferta de trabajo. Copia la descripción de la oferta, no la conversación"
- **AND** SHALL conservarse lo pegado

#### Scenario: Leyendo lo pegado

- **GIVEN** un miembro que acaba de confirmar lo pegado
- **WHEN** la API todavía no ha respondido
- **THEN** el diálogo SHALL mostrar "Leyendo… puede tardar unos segundos"
- **AND** NO SHALL permitir enviarlo dos veces

#### Scenario: Límite de lecturas del día

- **WHEN** la API responde `429` con `ai_quota_exceeded`
- **THEN** SHALL mostrarse "Llegaste al límite de lecturas de hoy, vuelve mañana"
- **AND** SHALL conservarse lo pegado

### Requirement: La lista mostrada es la del ámbito abierto

La lista de links SHALL mostrar solo respuestas pedidas para el ámbito abierto (un grupo o `/mis-links`) y por la
última carga de esa lista. Una respuesta, un error o una página siguiente que llegue después de que el usuario cambie de
lista, la lista se cierre o se recargue SHALL descartarse sin tocar lo que se ve. La tarjeta devuelta por una edición
pedida desde otra lista SHALL no reemplazar a la de la lista abierta.

#### Scenario: Cambio rápido de grupo

- **GIVEN** un miembro de los grupos A y B
- **WHEN** abre el grupo A y, antes de que llegue su lista, abre el grupo B
- **AND** la lista de A llega antes que la de B
- **THEN** el grupo B SHALL no mostrar en ningún momento los links de A y SHALL seguir cargando
- **AND** al llegar la de B SHALL mostrar solo los links de B

#### Scenario: La lista vieja llega la última

- **GIVEN** un miembro que abre el grupo A y luego el grupo B
- **WHEN** la lista de B llega antes que la de A
- **THEN** el grupo B SHALL seguir mostrando solo los links de B

#### Scenario: Error tardío de otro grupo

- **GIVEN** un miembro que abre el grupo A y luego el grupo B
- **WHEN** la lista de A falla después de abrir B
- **THEN** el grupo B SHALL no mostrar ningún error y SHALL seguir cargando hasta que llegue su lista

#### Scenario: La lista abierta falla

- **GIVEN** un miembro que abre el grupo B
- **WHEN** la carga de la lista de B falla
- **THEN** el grupo B SHALL mostrar el error y dejar de cargar

#### Scenario: Salir del grupo antes de pedir su lista

- **GIVEN** un miembro que entra en el detalle del grupo A
- **WHEN** sale de la pantalla antes de que se sepa que el grupo existe
- **THEN** SHALL no pedirse la lista de A
- **AND** la pantalla siguiente SHALL no mostrar los links de A

#### Scenario: Página siguiente de otro grupo

- **GIVEN** un miembro que pidió "cargar más" en el grupo A
- **WHEN** abre el grupo B antes de que llegue esa página
- **THEN** la página de A SHALL no añadirse a la lista de B
- **AND** "cargar más" SHALL no quedar en curso en B

#### Scenario: Página siguiente de una lista recargada

- **GIVEN** un miembro que pidió "cargar más" en un grupo
- **WHEN** la lista se recarga (por ejemplo, al volver el foco a la pestaña) antes de que llegue esa página
- **THEN** la lista SHALL quedarse con la primera página recargada, sin links repetidos

#### Scenario: Lista cerrada antes de que llegue

- **GIVEN** un miembro que abre un grupo
- **WHEN** la lista se cierra (al entrar en el detalle de otro grupo) antes de que llegue su respuesta
- **THEN** la lista SHALL seguir vacía y sin carga en curso al llegar la respuesta

#### Scenario: Dos recargas de la misma lista

- **GIVEN** una lista con dos recargas en vuelo (por ejemplo, tras guardar y al volver el foco a la pestaña)
- **WHEN** la primera responde después de la segunda
- **THEN** la lista SHALL quedarse con la respuesta de la segunda

#### Scenario: Guardar, importar o quitar terminado en otra lista

- **GIVEN** un miembro que guarda un link, pega un chat o quita un link en el grupo A
- **WHEN** abre el grupo B antes de que responda la acción
- **THEN** el grupo B SHALL no recargarse por ella ni mostrar el contador de lecturas de esa importación
- **AND** lo guardado o importado SHALL quedar en el grupo A y verse al volver a él

#### Scenario: La acción responde tras volver a la lista

- **GIVEN** un miembro que pega un chat en el grupo A, abre el grupo B y vuelve al grupo A
- **WHEN** la importación responde con A abierto de nuevo
- **THEN** la lista de A SHALL recargarse y mostrar el contador de lecturas de esa importación

#### Scenario: Importación cuya recarga falla

- **GIVEN** un miembro que pega un chat en un grupo
- **WHEN** la importación responde pero la recarga de la lista falla
- **THEN** la lista SHALL mostrar el error y SHALL no mostrar un contador de lecturas que no avanzaría

#### Scenario: Edición que responde en otra lista

- **GIVEN** un link compartido en los grupos A y B, editado desde el grupo A
- **WHEN** el miembro abre el grupo B antes de que responda la edición
- **THEN** la tarjeta de ese link en B SHALL seguir mostrando quién lo compartió en B
- **AND** la corrección SHALL verse en la siguiente recarga de B o al volver a A

### Requirement: Indicador de oferta cerrada

Cuando un link trae cierre (`closedAt` / `closedReason`), la tarjeta y el detalle en listas de grupo
y lista privada SHALL mostrar un indicador claro de que la oferta cerró, distinguible del estado de
enriquecimiento (`failed` / “sin vista previa”). El copy SHALL estar en i18n ES/EN. NO SHALL
ocultarse el preview existente solo por estar cerrada.

#### Scenario: Badge en tarjeta

- **GIVEN** un miembro viendo un link cerrado con título enriquecido
- **WHEN** mira la tarjeta
- **THEN** SHALL ver el indicador de oferta cerrada junto al título
- **AND** SHALL seguir viendo título y empresa

#### Scenario: i18n

- **WHEN** se comprueba `messages.en.xlf` tras extraer mensajes de este indicador
- **THEN** cada unidad nueva SHALL tener `target`

### Requirement: Control know-someone en card de grupo

En la vista de links de un **grupo**, cada card SHALL mostrar un control para marcar/desmarcar
“conozco a alguien ahí” y, si `count > 0`, un indicador del conteo. La lista privada de links NO
SHALL mostrar el control. Copy i18n ES/EN. Al cambiar el control, la UI SHALL llamar al PUT de
know-someone y **fusionar localmente** `{ flaggedByMe, count }` en el ítem de la lista (sin
reemplazar toda la card ni perder note/comments/publicShare).

#### Scenario: Marcar desde la card

- **GIVEN** Ana en el detalle del grupo viendo un link
- **WHEN** activa “conozco a alguien ahí”
- **THEN** la petición SHALL enviar `flagged=true`
- **AND** la UI SHALL mostrar que ella lo marcó (y el conteo actualizado)

#### Scenario: Lista privada sin control

- **GIVEN** Ana en su lista privada de links
- **WHEN** ve una card
- **THEN** NO SHALL existir el control know-someone
