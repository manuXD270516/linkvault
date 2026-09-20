## MODIFIED Requirements

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
