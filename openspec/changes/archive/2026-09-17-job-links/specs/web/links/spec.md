## Purpose

Da al SPA lo que convierte un grupo vacío en un repositorio de ofertas: guardar un link, pegar el chat entero, abrir lo
guardado y quitar lo que no era una oferta.

## ADDED Requirements

### Requirement: Links en el detalle del grupo

`/grupos/:id` SHALL mostrar los links del grupo con una etiqueta legible derivada de su URL (último segmento del path sin
guiones ni extensión, o el dominio si no lo hay), la plataforma, quién lo compartió y su estado, sustituyendo al aviso de
que los links llegan más adelante. Sin links SHALL mostrar "Todavía no hay ofertas aquí. Guarda un link o pega el chat
donde las compartís." Un link sin vista previa SHALL indicarlo con el texto "Sin vista previa todavía".

#### Scenario: Grupo con links

- **GIVEN** un miembro de un grupo con dos links
- **WHEN** abre el detalle
- **THEN** SHALL ver los dos con su etiqueta, su plataforma, quién los compartió y "Sin vista previa todavía"

#### Scenario: Grupo sin links

- **GIVEN** un grupo recién creado
- **WHEN** un miembro abre el detalle
- **THEN** SHALL ver "Todavía no hay ofertas aquí. Guarda un link o pega el chat donde las compartís."

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
