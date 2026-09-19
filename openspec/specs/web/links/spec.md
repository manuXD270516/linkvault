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

### Requirement: Abrir una oferta

Cada link de la lista SHALL abrirse en una pestaña nueva con `rel="noopener noreferrer"`, usando la URL tal como se
guardó (`displayUrl`), no la normalizada.

#### Scenario: Abrir una oferta

- **GIVEN** un miembro viendo la lista de links
- **WHEN** pulsa un link
- **THEN** SHALL abrirse `displayUrl` en una pestaña nueva con `rel="noopener noreferrer"`

### Requirement: Guardar un link desde el SPA

El detalle del grupo y la vista privada SHALL ofrecer guardar un link pegando su URL. Al guardarlo, la lista SHALL
actualizarse sin recargar la página. `invalid_url` SHALL mostrar "Eso no parece un enlace de una oferta". Si la respuesta
trae `alreadyInGroups`, SHALL mostrarse "Ya lo tienes en: <grupos>"; solo cuando `shared` es `already_there` SHALL
mostrarse "Ya estaba aquí, lo compartió <nombre>".

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

Cada link SHALL ofrecer quitarlo a quien lo compartió y al `owner` del grupo, con confirmación que diga "Se quita de este
grupo; la oferta sigue disponible en otros grupos." En la vista privada, cualquier link propio SHALL poder quitarse. Al
confirmarse, la lista SHALL actualizarse sin recargar.

#### Scenario: Quitar un enlace que no era una oferta

- **GIVEN** un miembro que importó por error un enlace de un vídeo
- **WHEN** lo quita y confirma
- **THEN** el link SHALL desaparecer de la lista sin recargar

#### Scenario: Sin permiso para quitar

- **GIVEN** un miembro que no es owner viendo un link compartido por otra persona
- **WHEN** mira ese link
- **THEN** NO SHALL ver la acción de quitarlo

### Requirement: Lista privada de links

`/mis-links` SHALL mostrar, bajo el título "Solo para mí", los links guardados sin grupo, con las mismas acciones de
guardar, importar, abrir y quitar, y SHALL ser accesible desde la barra de navegación. Sin links SHALL mostrar "Aquí
guardas ofertas solo para ti. Las que compartiste están en tus grupos."

#### Scenario: Vista privada

- **GIVEN** un usuario con un link privado
- **WHEN** abre `/mis-links`
- **THEN** SHALL ver ese link y no los que guardó dentro de un grupo

#### Scenario: Vista privada vacía

- **GIVEN** un usuario que solo guardó links en grupos
- **WHEN** abre `/mis-links`
- **THEN** SHALL ver "Aquí guardas ofertas solo para ti. Las que compartiste están en tus grupos."

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
