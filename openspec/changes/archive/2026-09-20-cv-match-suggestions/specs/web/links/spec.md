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
