## MODIFIED Requirements

### Requirement: Links en el detalle del grupo

`/grupos/:id` SHALL mostrar los links del grupo. Un link con preview SHALL mostrarse con su título, su empresa, su
ubicación, su modalidad y su seniority cuando los tenga, su salario formateado cuando exista, cuándo se publicó y cuándo
cierra; uno sin preview SHALL mostrar una etiqueta legible derivada de su URL (último segmento del path sin guiones ni
extensión, o el dominio si no lo hay). Todos SHALL mostrar la plataforma, quién lo compartió y su estado. Sin links
SHALL mostrar "Todavía no hay ofertas aquí. Guarda un link o pega el chat donde las compartís."

El texto de estado SHALL derivarse de lo que la persona tiene delante, no del nombre interno del estado: mientras haya
lectura en curso SHALL decir "Leyendo la oferta…"; un link sin datos que ya no se está leyendo, "Sin vista previa
todavía"; uno al que le faltan campos, "Faltan datos de esta oferta"; y uno que no se pudo leer, un texto según el
motivo —"Esta bolsa no permite la lectura automática de sus ofertas", "Esta bolsa no nos deja leer esta oferta", "Esto
no parece una oferta" o "No pudimos leer esta oferta"— con la acción de completarla a mano y, cuando el motivo sea
transitorio, la de reintentar.

#### Scenario: Grupo con links

- **GIVEN** un miembro de un grupo con dos links
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

#### Scenario: Oferta con salario y fechas

- **GIVEN** un link con salario en rango y fecha de cierre
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver el salario formateado y cuándo cierra la oferta

#### Scenario: Oferta que no se pudo leer

- **GIVEN** un link `failed` por un tiempo de espera agotado
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver "No pudimos leer esta oferta", la acción de completarla a mano y la de reintentar

#### Scenario: Bolsa que no permite la lectura

- **GIVEN** un link `failed` porque el sitio prohíbe la lectura automática
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver "Esta bolsa no permite la lectura automática de sus ofertas"
- **AND** NO SHALL ver la acción de reintentar

#### Scenario: Lo compartido no era una oferta

- **GIVEN** un link `failed` porque lo compartido no es una vacante
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver "Esto no parece una oferta" y la acción de quitarlo

## ADDED Requirements

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
actual de cada campo y de dónde salió, distinguiendo lo leído de la página ("Leído de la página") de lo deducido por la
IA ("Deducido por la IA") y de lo escrito por una persona ("Escrito por <nombre>"). Un campo editado a mano SHALL poder
devolverse a su valor anterior ("Volver a lo extraído"). Al guardar, la tarjeta SHALL mostrar los valores nuevos y decir
quién los escribió, porque el link es compartido y lo que una persona corrige lo ven las demás. Un error de la API SHALL
mostrarse sin perder lo escrito.

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
- **WHEN** un miembro pide volver a lo extraído
- **THEN** la tarjeta SHALL mostrar de nuevo el valor que traía la página

#### Scenario: Error al guardar

- **WHEN** la API responde con error al guardar la edición
- **THEN** SHALL mostrarse el mensaje y conservarse lo escrito
