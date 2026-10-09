## MODIFIED Requirements

### Requirement: Guardar un link desde el SPA

El detalle del grupo y la vista privada SHALL ofrecer guardar un link pegando su URL. Al guardarlo, la lista SHALL
actualizarse sin recargar. `invalid_url` SHALL mostrar "Eso no parece un enlace de una oferta". Si la respuesta
trae `alreadyInGroups`, SHALL mostrarse "Ya lo tienes en: <grupos>"; solo cuando `shared` es `already_there` SHALL
mostrarse "Ya estaba aquí, lo compartió <nombre>".

Cuando el link nazca con enlace público —porque el grupo comparte en público—, la confirmación SHALL decirlo en una
línea, "Cualquiera con este enlace verá la oferta; no se verá el grupo ni tu nombre", y SHALL ofrecer "Copiar enlace"
sobre el enlace que ya viene en la respuesta, sin pedir nada más a la API. Si la tarjeta de la oferta **no tiene
puesto**, copiar SHALL avisar y SHALL dejar copiar igualmente; el aviso SHALL depender solo de que no haya puesto, no
del nombre del estado de lectura:

- mientras la tarjeta aún dice "Leyendo la oferta…", con "Todavía estamos leyendo la oferta: si lo envías ahora, la
  tarjeta saldrá sin datos";
- si la lectura terminó en "Esto no parece una oferta", con "Esto no parece una oferta: si lo envías, la tarjeta saldrá
  sin datos";
- en cualquier otro caso sin puesto —lectura fallida, lectura parcial sin puesto, edición a mano sin puesto, o una
  lectura pendiente que ya no se espera—, con "La tarjeta todavía no tiene el puesto: si lo envías ahora, saldrá sin
  datos. Complétala antes desde la tarjeta".

Si la tarjeta tiene puesto —leído, pegado o escrito a mano— NO SHALL mostrarse ninguno de esos avisos. Ese estado SHALL evaluarse con
el link **actual** —el mismo que muestra su tarjeta y que actualizan los avisos en tiempo real, también cuando el link
no está en la lista cargada por los filtros—, no con el que traía la respuesta de guardar: el aviso SHALL cambiar o
desaparecer sin recargar, y una recarga de la lista que deje fuera el link NO SHALL devolver un aviso ya superado. El aviso SHALL reevaluarse cuando cambia el link; el paso del tiempo sin cambios no lo
reevalúa, igual que el estado de la tarjeta. Cuando el link no nazca publicado, NO SHALL mostrarse ni esa línea ni "Copiar enlace".

Tras un guardado correcto el formulario SHALL volver a su estado inicial: el campo de la URL vacío y **sin marca de
error**, como al abrir la página, conservando los avisos de esa respuesta ("Ya estaba aquí, lo compartió <nombre>",
"Ya lo tienes en: <grupos>"). La marca de error SHALL reservarse para un envío que falla o para un valor inválido
escrito por la persona.

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

#### Scenario: El aviso de lectura se va cuando la lectura termina

- **GIVEN** un link recién guardado en un grupo que comparte en público, con el formulario mostrando "Todavía estamos
  leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos"
- **WHEN** llega el aviso de que la lectura terminó con la oferta leída
- **THEN** el formulario NO SHALL seguir mostrando ese aviso, sin recargar

#### Scenario: Lectura fallida sin datos

- **GIVEN** un link recién guardado en un grupo que comparte en público, con el formulario mostrando "Todavía estamos
  leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos"
- **WHEN** llega el aviso de que la lectura terminó con "No pudimos leer esta oferta" y sin puesto
- **THEN** el formulario SHALL mostrar "La tarjeta todavía no tiene el puesto: si lo envías ahora, saldrá sin datos.
  Complétala antes desde la tarjeta" en lugar del aviso de lectura, sin recargar
- **AND** "Copiar enlace" SHALL seguir copiando el enlace

#### Scenario: Lectura parcial sin puesto

- **GIVEN** un link recién guardado y publicado cuya lectura terminó como parcial, con la empresa pero sin puesto
- **WHEN** el miembro mira el formulario de guardar
- **THEN** SHALL ver "La tarjeta todavía no tiene el puesto: si lo envías ahora, saldrá sin datos. Complétala antes
  desde la tarjeta"

#### Scenario: Una lectura pendiente que ya no se espera

- **GIVEN** un link publicado sin puesto que **llega ya caducado** al formulario: pendiente de lectura desde hace más
  tiempo del que la tarjeta sigue diciendo "Leyendo la oferta…" en el momento en que el formulario lo recibe (el paso
  del tiempo sin cambios en el link no reevalúa el aviso)
- **WHEN** el miembro mira el formulario de guardar
- **THEN** SHALL ver "La tarjeta todavía no tiene el puesto: si lo envías ahora, saldrá sin datos. Complétala antes
  desde la tarjeta"
- **AND** NO SHALL ver "Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos"

#### Scenario: No parece una oferta

- **GIVEN** un link recién guardado y publicado cuya lectura terminó en "Esto no parece una oferta", sin puesto
- **WHEN** el miembro mira el formulario de guardar
- **THEN** SHALL ver "Esto no parece una oferta: si lo envías, la tarjeta saldrá sin datos"
- **AND** NO SHALL ver "Complétala antes desde la tarjeta"

#### Scenario: Una recarga de la lista no devuelve el aviso de lectura

- **GIVEN** un link recién guardado y publicado cuyo aviso en tiempo real ya dijo que la lectura terminó con la oferta
  leída, y el formulario sin aviso
- **WHEN** la lista se recarga con unos filtros que dejan fuera ese link
- **THEN** el formulario NO SHALL volver a mostrar "Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta
  saldrá sin datos"

#### Scenario: Con filtros activos, el aviso también se actualiza

- **GIVEN** un link recién guardado y publicado que no aparece en la lista por los filtros activos, con el formulario
  mostrando "Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos"
- **WHEN** llega el aviso en tiempo real de que su lectura terminó con la oferta leída
- **THEN** el formulario NO SHALL seguir mostrando ese aviso

#### Scenario: Completada a mano, tampoco

- **GIVEN** un link publicado cuya lectura terminó en "No pudimos leer esta oferta" y que el miembro completó a mano
- **WHEN** mira el formulario de guardar
- **THEN** NO SHALL ver ni "Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos" ni "La
  tarjeta todavía no tiene el puesto: si lo envías ahora, saldrá sin datos. Complétala antes desde la tarjeta"

#### Scenario: El campo no queda en rojo tras guardar

- **GIVEN** un miembro que acaba de guardar una URL válida
- **WHEN** la API responde con éxito
- **THEN** el campo "Pega el enlace de una oferta" SHALL quedar vacío
- **AND** ni el campo ni su etiqueta SHALL mostrarse como error

#### Scenario: Un error sí marca el campo

- **GIVEN** un miembro que envía una URL y la API responde `400` con `invalid_url`
- **WHEN** ve la respuesta
- **THEN** SHALL conservarse lo escrito y SHALL mostrarse "Eso no parece un enlace de una oferta"

#### Scenario: El reinicio conserva el aviso de que ya estaba

- **GIVEN** un miembro que guarda una URL y la respuesta trae `shared` `already_there`
- **WHEN** el formulario vuelve a su estado inicial
- **THEN** SHALL seguir mostrándose "Ya estaba aquí, lo compartió Ana"
- **AND** el campo de la URL SHALL quedar vacío y sin marca de error

### Requirement: Editar la oferta a mano

Cada link SHALL ofrecer editar los campos de su preview a quien puede verlo, con un formulario que muestra el valor
actual de cada campo y de dónde salió, distinguiendo lo leído de la página ("Leído de la página"), lo deducido por la
IA ("Deducido por la IA"), lo sacado de un texto pegado ("Descripción pegada por <nombre>") y lo escrito por una persona
("Escrito por <nombre>"). Cuando la API devuelve el autor vacío —quien lee no comparte ningún grupo con esa persona,
spec `links/enrichment`—, SHALL decir "Escrito por otra persona" o "Descripción pegada por otra persona", sin ningún
nombre ni identificador; el tipo de origen SHALL seguir distinguiéndose igual. Un campo que sustituyó a otro SHALL
poder devolverse a lo que había ("Volver a lo anterior").
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

#### Scenario: Autor fuera de tus grupos

- **GIVEN** Carla, que no comparte ningún grupo con Ana, con un link de su lista privada cuyo título escribió Ana y
  cuya empresa salió de un texto que pegó Ana
- **WHEN** mira la tarjeta o abre el formulario
- **THEN** SHALL ver "Escrito por otra persona" en el título y "Descripción pegada por otra persona" en la empresa
- **AND** NO SHALL ver el nombre de Ana en ninguna parte de la tarjeta ni del formulario

#### Scenario: Un miembro ve la corrección de alguien de fuera como "Escrito por otra persona"

- **GIVEN** Beto en el detalle de "Backend Bolivia" con un link cuyo título corrigió Carla, que tiene esa vacante en su
  lista privada y no comparte ningún grupo con Beto
- **WHEN** Beto mira la tarjeta o abre el formulario
- **THEN** SHALL ver "Escrito por otra persona" en el título
- **AND** la procedencia de los campos NO SHALL mostrar el nombre de Carla

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
pegado; si la API devuelve vacío el autor del pegado, SHALL decir "Deshacer lo que pegó otra persona". Un `422` SHALL mostrar "Eso no parece una oferta de trabajo. Copia la descripción de la
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

#### Scenario: Deshacer un pegado de alguien fuera de tus grupos

- **GIVEN** Carla con un link cuyo último pegado es de Ana, con quien no comparte ningún grupo
- **WHEN** mira la tarjeta
- **THEN** SHALL ver "Deshacer lo que pegó otra persona"
- **AND** al pulsarlo SHALL devolverse de una vez todos los campos de ese pegado

