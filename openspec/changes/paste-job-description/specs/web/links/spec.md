## MODIFIED Requirements

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

## ADDED Requirements

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
