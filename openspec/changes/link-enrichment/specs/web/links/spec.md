## MODIFIED Requirements

### Requirement: Links en el detalle del grupo

`/grupos/:id` SHALL mostrar los links del grupo. Un link enriquecido SHALL mostrarse con su título, su empresa, su
ubicación, su modalidad y su seniority cuando los tenga; uno sin enriquecer SHALL mostrar una etiqueta legible derivada
de su URL (último segmento del path sin guiones ni extensión, o el dominio si no lo hay). Todos SHALL mostrar la
plataforma, quién lo compartió y su estado. Sin links SHALL mostrar "Todavía no hay ofertas aquí. Guarda un link o pega
el chat donde las compartís." Un link en `pending` SHALL indicarlo con "Sin vista previa todavía"; uno en `partial`, con
"Vista previa incompleta"; uno en `failed`, con "No pudimos leer esta oferta" y la acción de completarla a mano.

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

#### Scenario: Oferta que no se pudo leer

- **GIVEN** un link `failed`
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver "No pudimos leer esta oferta" y la acción de completarla a mano

## ADDED Requirements

### Requirement: La tarjeta se actualiza sola

Mientras la lista está abierta, el SPA SHALL escuchar los avisos de enriquecimiento y SHALL actualizar la tarjeta del
link avisado sin recargar la página ni volver a pedir la lista entera. Si el canal no está disponible, la lista SHALL
seguir funcionando y mostrando lo que devolvió la API.

#### Scenario: Preview que llega mientras miras

- **GIVEN** un miembro viendo un link en "Sin vista previa todavía"
- **WHEN** llega el aviso de que ese link quedó enriquecido
- **THEN** su tarjeta SHALL mostrar el título y la empresa sin recargar

#### Scenario: Sin canal disponible

- **GIVEN** el canal de eventos que no se puede abrir
- **WHEN** el miembro abre la lista
- **THEN** SHALL ver los links tal como los devolvió la API, sin errores en pantalla

### Requirement: Editar la oferta a mano

Cada link SHALL ofrecer editar los campos de su preview a quien puede verlo, con un formulario que muestra el valor
actual de cada campo y de dónde salió ("Extraído de la página", "Escrito por <nombre>"). Al guardar, la tarjeta SHALL
mostrar los valores nuevos y marcarlos como escritos a mano. Un error de la API SHALL mostrarse sin perder lo escrito.

#### Scenario: Corregir el título

- **GIVEN** un miembro viendo un link con el título mal extraído
- **WHEN** lo corrige y guarda
- **THEN** la tarjeta SHALL mostrar el título nuevo marcado como escrito a mano

#### Scenario: Origen de cada campo

- **GIVEN** un link con el título escrito a mano y la empresa extraída
- **WHEN** un miembro abre el formulario
- **THEN** SHALL ver "Escrito por" en el título y "Extraído de la página" en la empresa

#### Scenario: Error al guardar

- **WHEN** la API responde con error al guardar la edición
- **THEN** SHALL mostrarse el mensaje y conservarse lo escrito
