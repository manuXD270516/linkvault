## ADDED Requirements

### Requirement: Nota y comentarios en la tarjeta del grupo

En `/grupos/:id`, cada tarjeta de link SHALL mostrar:
- la nota de quien lo compartió, si la tiene, con su nombre ("Nota de Ana");
- sus dos comentarios más recientes, el más antiguo arriba, cada uno con el nombre del autor, cuándo se escribió y su
  texto con los saltos de línea;
- una acción que abre el hilo: "Comentar" cuando el link no tiene comentarios, "Responder" cuando tiene 1 o 2, y "Ver
  los N comentarios" cuando tiene más.

En la tarjeta, la nota y cada comentario SHALL cortarse a 2 líneas; el texto completo está en el hilo. Un comentario cuyo
autor ya no está en el grupo SHALL mostrar junto a su nombre "ya no está en el grupo". El texto de la nota y de los
comentarios SHALL pintarse como texto, nunca como HTML, y sus enlaces NO SHALL ser clicables. Quien compartió el link y
el propietario del grupo SHALL ver "Quitar la nota" sobre ella, con una confirmación que depende de quién la quita:
- la propia: "¿Quitar la nota? No se puede deshacer.";
- la ajena: "¿Quitar la nota de <nombre>? Desaparecerá para todo el grupo y no se puede deshacer.".

Nadie SHALL ver una acción para editarla. En `/mis-links` las tarjetas NO SHALL mostrar ni nota ni
comentarios.

#### Scenario: Tarjeta con nota y comentarios

- **GIVEN** un link compartido por Ana con la nota "Esta es la que te dije" y tres comentarios, el último de Carla
- **WHEN** un miembro abre el detalle del grupo
- **THEN** la tarjeta SHALL mostrar "Nota de Ana" con su texto, los dos últimos comentarios con el de Carla abajo y "Ver
  los 3 comentarios"

#### Scenario: Tarjeta sin comentarios

- **GIVEN** un link sin nota ni comentarios
- **WHEN** un miembro abre el detalle del grupo
- **THEN** la tarjeta SHALL mostrar "Comentar" y ninguna nota

#### Scenario: Tarjeta con pocos comentarios

- **GIVEN** un link sin nota y con un comentario
- **WHEN** un miembro abre el detalle del grupo
- **THEN** la tarjeta SHALL mostrar el comentario y "Responder"

#### Scenario: Texto largo cortado en la tarjeta

- **GIVEN** un comentario de 400 caracteres y una nota de 280
- **WHEN** un miembro mira la tarjeta
- **THEN** cada uno SHALL verse cortado a 2 líneas
- **AND** al abrir el hilo, el comentario SHALL verse entero

#### Scenario: Autor que se fue

- **GIVEN** un comentario de Beto, que salió del grupo
- **WHEN** Ana abre el detalle
- **THEN** SHALL ver el comentario con "Beto" y "ya no está en el grupo"

#### Scenario: HTML como texto en pantalla

- **GIVEN** un comentario con el texto `<b>ojo</b>`
- **WHEN** un miembro lo ve en la tarjeta
- **THEN** SHALL leer `<b>ojo</b>` literalmente, sin negrita

#### Scenario: Quitar la nota

- **GIVEN** un link con nota compartido por Beto en un grupo cuya propietaria es Ana
- **WHEN** Ana pulsa "Quitar la nota"
- **THEN** SHALL ver "¿Quitar la nota de Beto? Desaparecerá para todo el grupo y no se puede deshacer."
- **AND** al confirmar, la tarjeta SHALL dejar de mostrar la nota sin recargar
- **AND** Carla, miembro sin ser owner, NO SHALL ver "Quitar la nota"

#### Scenario: Sin comentarios en la lista privada

- **GIVEN** un link que está en la lista privada de un usuario y tiene comentarios en su grupo
- **WHEN** abre `/mis-links`
- **THEN** la tarjeta NO SHALL mostrar comentarios ni la acción de responder

### Requirement: Hilo de comentarios

La acción de la tarjeta SHALL abrir un diálogo con el título "Comentarios" y la oferta a la que pertenecen.
- En pantallas por debajo del punto de corte `sm`, el diálogo SHALL ocupar la pantalla completa.
- SHALL mostrar la primera página del hilo, con el comentario más reciente abajo.
- Mientras queden más, SHALL mostrar arriba "Ver comentarios anteriores", que carga la página siguiente sin perder lo
  que ya se ve.
- Sin comentarios SHALL mostrar "Todavía nadie comentó esta oferta. Cuenta lo que sepas: requisitos, si ya cerró, a
  quién escribir.".
- Un `404` al abrirlo (el link ya no está en el grupo o la persona ya no es miembro) SHALL cerrar el diálogo, decir
  "Esta oferta ya no está en el grupo" y volver a pedir la lista del grupo.

#### Scenario: Hilo largo

- **GIVEN** un link con 25 comentarios en el grupo
- **WHEN** un miembro abre el hilo y pulsa "Ver comentarios anteriores"
- **THEN** SHALL ver primero los 20 más recientes y después los 25, sin repetidos y en orden

#### Scenario: Hilo vacío

- **WHEN** un miembro abre el hilo de un link sin comentarios
- **THEN** SHALL ver "Todavía nadie comentó esta oferta. Cuenta lo que sepas: requisitos, si ya cerró, a quién escribir."

#### Scenario: En el móvil

- **GIVEN** una pantalla más estrecha que el punto de corte `sm`
- **WHEN** un miembro abre el hilo y enfoca el cuadro de texto
- **THEN** el diálogo SHALL ocupar la pantalla completa
- **AND** "Comentar" SHALL seguir visible por encima del teclado

#### Scenario: La oferta ya no está

- **GIVEN** un miembro con el detalle abierto de un link que otro acaba de quitar del grupo
- **WHEN** abre su hilo
- **THEN** SHALL ver "Esta oferta ya no está en el grupo" y la lista del grupo SHALL volver a pedirse

### Requirement: Escribir un comentario

El diálogo SHALL ofrecer un cuadro de texto con la indicación "Lo verán los miembros de este grupo y seguirá aquí aunque
salgas." y un contador de caracteres sobre 500.
- "Comentar" SHALL estar deshabilitado mientras el texto, sin espacios exteriores, esté vacío o pase de 500, y mientras se
  envía, para que no se publique dos veces.
- Ctrl+Enter (Cmd+Enter en macOS) SHALL enviarlo.
- Al publicarse, el comentario SHALL aparecer abajo del hilo y en la tarjeta, el contador de la tarjeta SHALL subir y el
  cuadro SHALL vaciarse.
- Un `429` con `too_many_attempts` SHALL mostrar "Escribiste muchos comentarios seguidos. Vuelve a intentarlo en N
  minutos". N sale de `Retry-After` en minutos, redondeado hacia arriba y con el plural correcto. Sin `Retry-After`, el
  texto SHALL ser "Escribiste muchos comentarios seguidos. Vuelve a intentarlo más tarde".
- Cualquier otro error SHALL mostrar "No se pudo publicar el comentario. Inténtalo de nuevo.".
- En todos los errores SHALL conservarse lo escrito.

#### Scenario: Publicar

- **GIVEN** un miembro con el hilo abierto de un link con 2 comentarios
- **WHEN** escribe "Ya cerró" y pulsa "Comentar"
- **THEN** su comentario SHALL aparecer abajo del hilo y el cuadro SHALL quedar vacío
- **AND** la tarjeta SHALL mostrar "Ver los 3 comentarios" con "Ya cerró" como último

#### Scenario: La indicación dice qué pasa al salir

- **WHEN** un miembro abre el hilo
- **THEN** SHALL ver "Lo verán los miembros de este grupo y seguirá aquí aunque salgas."

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

### Requirement: Borrar un comentario desde el SPA

Los comentarios propios, y todos los del grupo cuando quien mira es el propietario, SHALL ofrecer "Borrar". Al pulsarlo
SHALL pedir confirmación:
- en lo propio, "¿Borrar tu comentario? No se puede deshacer.";
- en lo ajeno, "¿Borrar el comentario de <nombre>? Desaparecerá para todo el grupo y no se puede deshacer.".

Al confirmarse, el comentario SHALL desaparecer del hilo, y la tarjeta SHALL pintar el resumen que devuelve la
respuesta, sin dejar marca y con el contador ya bajado. Un
`404` con `comment_not_found` SHALL tratarse como éxito, porque el comentario ya no existía. Mientras se borra, el botón
SHALL estar deshabilitado.

#### Scenario: Borrar el propio

- **GIVEN** Beto con el hilo abierto, donde hay un comentario suyo y otro de Ana
- **WHEN** pulsa "Borrar" en el suyo y confirma
- **THEN** su comentario SHALL desaparecer del hilo y de la tarjeta, y el contador SHALL bajar en uno

#### Scenario: El propietario borra lo ajeno

- **GIVEN** Ana, propietaria del grupo, con el hilo abierto, donde hay un comentario de Beto
- **WHEN** pulsa "Borrar" en él
- **THEN** SHALL ver "¿Borrar el comentario de Beto? Desaparecerá para todo el grupo y no se puede deshacer."
- **AND** al confirmar, el comentario SHALL desaparecer sin dejar marca

#### Scenario: Lo ajeno no se borra sin ser propietario

- **GIVEN** Carla, miembro sin ser owner, viendo un comentario de Beto
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

Mientras el detalle del grupo está abierto, el SPA SHALL escuchar `group-link.comments`. Con los avisos de ese grupo
SHALL sustituir, sin recargar ni pedir nada, el resumen de la tarjeta del link avisado (contador y dos últimos). Para
decidir si un resumen es más nuevo, el SPA SHALL comparar la pareja (`sharedAt`, `revision`):
- un `sharedAt` distinto del que tiene la tarjeta SHALL ganar siempre, porque el link se volvió a compartir y su
  revisión empezó de nuevo;
- con el mismo `sharedAt`, un resumen con una `revision` menor SHALL descartarse.

Esto vale para los avisos y para las respuestas de publicar y de borrar.

Con el hilo de ese link abierto:
- un comentario nuevo que viene en el resumen SHALL añadirse abajo, sin repetir el que ya estuviera;
- uno nuevo que no viene en el resumen (llegaron varios a la vez) SHALL mostrar "Ver comentarios nuevos", que al
  pulsarse vuelve a pedir la primera página;
- uno borrado SHALL desaparecer del hilo.

El aviso de un comentario propio NO SHALL duplicarlo. Cuando el SPA sustituye una tarjeta del grupo con un link que no
trae `note` ni `comments` (un aviso `link.enriched`, una corrección del preview, un pegado), SHALL conservar la nota y los
comentarios que tenía. Sin canal, la lista y el hilo SHALL seguir funcionando con lo que devolvió la API, y la lista SHALL
volver a pedirse al recuperar la pestaña el foco, como ya hace.

#### Scenario: Comentario que llega mientras miras

- **GIVEN** Ana viendo el detalle del grupo con un link que tiene 2 comentarios
- **WHEN** Beto comenta ese link desde otro navegador
- **THEN** la tarjeta de Ana SHALL mostrar "Ver los 3 comentarios" y el de Beto como último, sin recargar

#### Scenario: Un resumen viejo no pisa uno nuevo

- **GIVEN** una tarjeta con el resumen de `revision` 7
- **WHEN** llega tarde un aviso con el mismo `sharedAt` y `revision` 6
- **THEN** la tarjeta SHALL seguir mostrando el resumen de `revision` 7

#### Scenario: Volver a compartir no congela la tarjeta

- **GIVEN** una tarjeta con el resumen de `revision` 7, cuyo link se quitó y se volvió a compartir en el grupo
- **WHEN** llega un aviso con un `sharedAt` nuevo y `revision` 1
- **THEN** la tarjeta SHALL mostrar el resumen nuevo

#### Scenario: Con el hilo abierto

- **GIVEN** Ana con el hilo de un link abierto
- **WHEN** Beto comenta ese link
- **THEN** el comentario de Beto SHALL aparecer abajo del hilo de Ana, una sola vez

#### Scenario: Varios a la vez

- **GIVEN** Ana con el hilo abierto
- **WHEN** llega un aviso cuyo comentario nuevo no viene entre los dos últimos del resumen
- **THEN** SHALL ver "Ver comentarios nuevos" y, al pulsarlo, la primera página actualizada

#### Scenario: Borrado que llega mientras miras

- **GIVEN** Ana con el hilo abierto, donde está un comentario de Beto
- **WHEN** Beto lo borra
- **THEN** SHALL desaparecer del hilo y de la tarjeta de Ana

#### Scenario: La lectura de la oferta no borra los comentarios

- **GIVEN** una tarjeta del grupo con nota y dos comentarios, todavía sin preview
- **WHEN** llega `link.enriched` de ese link
- **THEN** la tarjeta SHALL mostrar el preview y SHALL conservar la nota y los dos comentarios

#### Scenario: Corregir el preview no borra los comentarios

- **GIVEN** una tarjeta del grupo con nota y dos comentarios
- **WHEN** un miembro corrige el título a mano y la tarjeta se sustituye con la respuesta
- **THEN** la tarjeta SHALL mostrar el título nuevo y SHALL conservar la nota y los dos comentarios

#### Scenario: Mi propio comentario, una vez

- **GIVEN** Ana, que acaba de publicar un comentario con el hilo abierto
- **WHEN** le llega el aviso de ese mismo comentario
- **THEN** el hilo SHALL mostrarlo una sola vez

### Requirement: Nota al compartir desde el SPA

En el detalle del grupo, el formulario de guardar un link SHALL ofrecer "Nota para el grupo (opcional)", con el ejemplo
"Por ejemplo: esta es la que te dije" y un contador sobre 280. En `/mis-links` y en la importación NO SHALL ofrecerse.
Si la respuesta trae `shared` `already_there` y la persona había escrito una nota, además de "Ya estaba aquí, lo
compartió <nombre>" SHALL mostrarse "Tu nota no se añadió porque la oferta ya estaba en el grupo.", y el texto SHALL
quedarse en el campo.

#### Scenario: Compartir con nota

- **GIVEN** Ana en el detalle del grupo
- **WHEN** guarda una URL con la nota "Esta es la que te dije"
- **THEN** la tarjeta nueva SHALL mostrar "Nota de Ana" con ese texto

#### Scenario: La oferta ya estaba

- **GIVEN** un link que Ana ya compartió en el grupo
- **WHEN** Beto guarda la misma URL con la nota "Yo también la vi"
- **THEN** SHALL ver "Ya estaba aquí, lo compartió Ana" y "Tu nota no se añadió porque la oferta ya estaba en el grupo."
- **AND** "Yo también la vi" SHALL seguir escrito en el campo de nota

#### Scenario: Sin nota en la lista privada

- **WHEN** un usuario abre el formulario de guardar en `/mis-links`
- **THEN** NO SHALL ver el campo de nota

### Requirement: Textos de comentarios en español e inglés

Todos los textos visibles de la nota, los comentarios, el hilo, el formulario y sus mensajes de error SHALL estar
marcados para i18n con español como idioma fuente y traducción al inglés, con los plurales en ICU.

#### Scenario: Traducciones completas

- **WHEN** se comprueba `messages.en.xlf` tras extraer los mensajes
- **THEN** cada unidad de traducción SHALL tener `target`
