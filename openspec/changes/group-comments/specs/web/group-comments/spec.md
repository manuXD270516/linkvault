## ADDED Requirements

### Requirement: Nota y comentarios en la tarjeta del grupo

En `/grupos/:id`, cada tarjeta de link SHALL mostrar:
- la nota de quien lo compartió, si la tiene, con su nombre ("Nota de Ana");
- sus dos comentarios más recientes, el más antiguo arriba, cada uno con el nombre del autor, cuándo se escribió y su
  texto con los saltos de línea;
- una acción que abre el hilo y dice cuántos hay, con el plural correcto: "Comentar" sin comentarios, "Ver el
  comentario" con uno y "Ver los N comentarios" con más.

Un comentario cuyo autor ya no está en el grupo SHALL mostrar junto a su nombre "ya no está en el grupo". El texto de la
nota y de los comentarios SHALL pintarse como texto, nunca como HTML, y sus enlaces NO SHALL ser clicables. En
`/mis-links` las tarjetas NO SHALL mostrar ni nota ni comentarios.

#### Scenario: Tarjeta con nota y comentarios

- **GIVEN** un link compartido por Ana con la nota "Esta es la que te dije" y tres comentarios, el último de Carla
- **WHEN** un miembro abre el detalle del grupo
- **THEN** la tarjeta SHALL mostrar "Nota de Ana" con su texto, los dos últimos comentarios con el de Carla abajo y "Ver
  los 3 comentarios"

#### Scenario: Tarjeta sin comentarios

- **GIVEN** un link sin nota ni comentarios
- **WHEN** un miembro abre el detalle del grupo
- **THEN** la tarjeta SHALL mostrar "Comentar" y ninguna nota

#### Scenario: Autor que se fue

- **GIVEN** un comentario de Beto, que salió del grupo
- **WHEN** Ana abre el detalle
- **THEN** SHALL ver el comentario con "Beto" y "ya no está en el grupo"

#### Scenario: HTML como texto en pantalla

- **GIVEN** un comentario con el texto `<b>ojo</b>`
- **WHEN** un miembro lo ve en la tarjeta
- **THEN** SHALL leer `<b>ojo</b>` literalmente, sin negrita

#### Scenario: Sin comentarios en la lista privada

- **GIVEN** un link que está en la lista privada de un usuario y tiene comentarios en su grupo
- **WHEN** abre `/mis-links`
- **THEN** la tarjeta NO SHALL mostrar comentarios ni la acción de comentar

### Requirement: Hilo de comentarios

La acción de la tarjeta SHALL abrir un diálogo con el título "Comentarios" y la oferta a la que pertenecen. El diálogo
SHALL mostrar la primera página del hilo con el comentario más reciente abajo, y "Ver comentarios anteriores" arriba
mientras queden más, que carga la página siguiente sin perder lo que ya se ve. Sin comentarios SHALL mostrar "Todavía
nadie comentó esta oferta. Cuenta lo que sepas: requisitos, si ya cerró, a quién escribir.". Un `404` al abrirlo (el
link ya no está en el grupo o la persona ya no es miembro) SHALL cerrar el diálogo, decir "Esta oferta ya no está en el
grupo" y volver a pedir la lista del grupo.

#### Scenario: Hilo largo

- **GIVEN** un link con 25 comentarios en el grupo
- **WHEN** un miembro abre el hilo y pulsa "Ver comentarios anteriores"
- **THEN** SHALL ver primero los 20 más recientes y después los 25, sin repetidos y en orden

#### Scenario: Hilo vacío

- **WHEN** un miembro abre el hilo de un link sin comentarios
- **THEN** SHALL ver "Todavía nadie comentó esta oferta. Cuenta lo que sepas: requisitos, si ya cerró, a quién escribir."

#### Scenario: La oferta ya no está

- **GIVEN** un miembro con el detalle abierto de un link que otro acaba de quitar del grupo
- **WHEN** abre su hilo
- **THEN** SHALL ver "Esta oferta ya no está en el grupo" y la lista del grupo SHALL volver a pedirse

### Requirement: Escribir un comentario

El diálogo SHALL ofrecer un cuadro de texto con la indicación "Lo verán los miembros de este grupo." y un contador de
caracteres sobre 500. "Comentar" SHALL estar deshabilitado mientras el texto, sin espacios exteriores, esté vacío o pase
de 500, y mientras se envía, de modo que no se publique dos veces. Ctrl+Enter (Cmd+Enter en macOS) SHALL enviarlo. Al
publicarse, el comentario SHALL aparecer abajo del hilo y en la tarjeta, el contador de la tarjeta SHALL subir y el cuadro
SHALL vaciarse. Un `429` con `too_many_attempts` SHALL mostrar "Escribiste muchos comentarios seguidos. Vuelve a
intentarlo en N minutos", con N tomado de `Retry-After` en minutos redondeados hacia arriba y el plural correcto, o
"Escribiste muchos comentarios seguidos. Vuelve a intentarlo más tarde" sin `Retry-After`. Cualquier otro error SHALL
mostrar "No se pudo publicar el comentario. Inténtalo de nuevo.". En todos los errores SHALL conservarse lo escrito.

#### Scenario: Publicar

- **GIVEN** un miembro con el hilo abierto de un link con 2 comentarios
- **WHEN** escribe "Ya cerró" y pulsa "Comentar"
- **THEN** su comentario SHALL aparecer abajo del hilo y el cuadro SHALL quedar vacío
- **AND** la tarjeta SHALL mostrar "Ver los 3 comentarios" con "Ya cerró" como último

#### Scenario: Demasiado largo

- **GIVEN** un texto de 501 caracteres escrito en el cuadro
- **WHEN** el miembro lo mira
- **THEN** el contador SHALL avisar del máximo de 500 y "Comentar" SHALL estar deshabilitado

#### Scenario: Demasiados comentarios

- **WHEN** la API responde `429` con `too_many_attempts` y `Retry-After` 300
- **THEN** SHALL mostrarse "Escribiste muchos comentarios seguidos. Vuelve a intentarlo en 5 minutos"
- **AND** SHALL conservarse lo escrito

#### Scenario: Un solo envío

- **GIVEN** un comentario en curso de publicarse
- **WHEN** el miembro vuelve a pulsar "Comentar"
- **THEN** el SPA NO SHALL enviar una segunda petición

### Requirement: Borrar un comentario propio desde el SPA

Solo los comentarios propios SHALL ofrecer "Borrar", con la confirmación "¿Borrar tu comentario? No se puede
deshacer.". Al confirmarse, el comentario SHALL desaparecer del hilo y de la tarjeta, y el contador SHALL bajar. Un `404`
con `comment_not_found` SHALL tratarse como éxito, porque el comentario ya no existía. Mientras se borra, el botón SHALL
estar deshabilitado.

#### Scenario: Borrar el propio

- **GIVEN** Beto con el hilo abierto, donde hay un comentario suyo y otro de Ana
- **WHEN** pulsa "Borrar" en el suyo y confirma
- **THEN** su comentario SHALL desaparecer del hilo y de la tarjeta, y el contador SHALL bajar en uno

#### Scenario: Lo ajeno no se borra

- **GIVEN** la propietaria del grupo viendo un comentario de Beto
- **WHEN** mira el comentario
- **THEN** NO SHALL ver "Borrar"

#### Scenario: Ya estaba borrado

- **GIVEN** un comentario propio que se borró desde otra pestaña
- **WHEN** lo borra y la API responde `404` con `comment_not_found`
- **THEN** el comentario SHALL desaparecer sin mostrar ningún error

#### Scenario: Cancelar el borrado

- **WHEN** el autor pulsa "Borrar" y cancela la confirmación
- **THEN** el SPA NO SHALL llamar a la API y el comentario SHALL seguir

### Requirement: Comentarios en vivo

Mientras el detalle del grupo está abierto, el SPA SHALL escuchar `group-link.comments` y, para los avisos de ese grupo,
SHALL sustituir el resumen de la tarjeta del link avisado (contador y dos últimos) sin recargar ni pedir nada. Con el
hilo de ese link abierto:
- un comentario nuevo que viene en el resumen SHALL añadirse abajo, sin repetir el que ya estuviera;
- uno nuevo que no viene en el resumen (llegaron varios a la vez) SHALL mostrar "Hay comentarios nuevos", que al pulsarse
  vuelve a pedir la primera página;
- uno borrado SHALL desaparecer del hilo.

El aviso de un comentario propio NO SHALL duplicarlo. Un aviso de enriquecimiento (`link.enriched`) sobre un link del
grupo NO SHALL borrar de su tarjeta la nota ni los comentarios. Sin canal, la lista y el hilo SHALL seguir funcionando
con lo que devolvió la API, y la lista SHALL volver a pedirse al recuperar la pestaña el foco, como ya hace.

#### Scenario: Comentario que llega mientras miras

- **GIVEN** Ana viendo el detalle del grupo con un link que tiene 1 comentario
- **WHEN** Beto comenta ese link desde otro navegador
- **THEN** la tarjeta de Ana SHALL mostrar "Ver los 2 comentarios" y el de Beto como último, sin recargar

#### Scenario: Con el hilo abierto

- **GIVEN** Ana con el hilo de un link abierto
- **WHEN** Beto comenta ese link
- **THEN** el comentario de Beto SHALL aparecer abajo del hilo de Ana, una sola vez

#### Scenario: Borrado que llega mientras miras

- **GIVEN** Ana con el hilo abierto, donde está un comentario de Beto
- **WHEN** Beto lo borra
- **THEN** SHALL desaparecer del hilo y de la tarjeta de Ana

#### Scenario: La lectura de la oferta no borra los comentarios

- **GIVEN** una tarjeta del grupo con nota y dos comentarios, todavía sin preview
- **WHEN** llega `link.enriched` de ese link
- **THEN** la tarjeta SHALL mostrar el preview y SHALL conservar la nota y los dos comentarios

#### Scenario: Mi propio comentario, una vez

- **GIVEN** Ana, que acaba de publicar un comentario con el hilo abierto
- **WHEN** le llega el aviso de ese mismo comentario
- **THEN** el hilo SHALL mostrarlo una sola vez

### Requirement: Nota al compartir desde el SPA

En el detalle del grupo, el formulario de guardar un link SHALL ofrecer "Nota para el grupo (opcional)", con el ejemplo
"Por ejemplo: esta es la que te dije" y un contador sobre 280. En `/mis-links` y en la importación NO SHALL ofrecerse. Si
la respuesta trae `shared` `already_there` y la persona había escrito una nota, además de "Ya estaba aquí, lo compartió
<nombre>" SHALL mostrarse "Tu nota no se añadió porque la oferta ya estaba en el grupo." con la acción "Publicarla como
comentario", que la publica como comentario de ese link con un clic. Quien compartió el link SHALL ver en su tarjeta
"Editar la nota" (o "Añadir una nota" si no tiene), con el mismo campo y "Quitar la nota". Nadie más SHALL verlas.

#### Scenario: Compartir con nota

- **GIVEN** Ana en el detalle del grupo
- **WHEN** guarda una URL con la nota "Esta es la que te dije"
- **THEN** la tarjeta nueva SHALL mostrar "Nota de Ana" con ese texto

#### Scenario: La oferta ya estaba

- **GIVEN** un link que Ana ya compartió en el grupo
- **WHEN** Beto guarda la misma URL con la nota "Yo también la vi"
- **THEN** SHALL ver "Ya estaba aquí, lo compartió Ana" y "Tu nota no se añadió porque la oferta ya estaba en el grupo."
- **AND** al pulsar "Publicarla como comentario", la tarjeta SHALL mostrar "Yo también la vi" como último comentario de
  Beto

#### Scenario: Solo quien compartió edita la nota

- **GIVEN** un link con nota compartido por Ana
- **WHEN** Beto, miembro, mira la tarjeta
- **THEN** NO SHALL ver "Editar la nota" ni "Quitar la nota"

#### Scenario: Sin nota en la lista privada

- **WHEN** un usuario abre el formulario de guardar en `/mis-links`
- **THEN** NO SHALL ver el campo de nota

### Requirement: Textos de comentarios en español e inglés

Todos los textos visibles de la nota, los comentarios, el hilo, el formulario y sus mensajes de error SHALL estar
marcados para i18n con español como idioma fuente y traducción al inglés, con los plurales en ICU.

#### Scenario: Traducciones completas

- **WHEN** se comprueba `messages.en.xlf` tras extraer los mensajes
- **THEN** cada unidad de traducción SHALL tener `target`
