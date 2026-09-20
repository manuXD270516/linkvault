## ADDED Requirements

### Requirement: Enlace público de un link compartido

Cada link compartido en un grupo SHALL poder tener como mucho un enlace público, identificado por un `slug` de 12
caracteres del alfabeto `23456789abcdefghjkmnpqrstvwxyz`, generado al azar y único entre todos los enlaces públicos. El
`slug` NO SHALL derivarse del título, de la empresa, del grupo ni del identificador del link, y su comparación SHALL ser
exacta: un `slug` con otra caja o con un carácter fuera del alfabeto SHALL tratarse como inexistente.

La unicidad SHALL estar garantizada por un índice. Cuando la generación choque con un `slug` existente, SHALL
generarse otro y volver a intentarse, y SHALL responderse `500` solo si los intentos se agotan. Publicar desde el
interruptor SHALL reintentar hasta 5 veces; publicar al compartir un link SHALL reintentar junto con la escritura
completa del alta, con los intentos que esa escritura ya tiene, porque una colisión aborta su transacción.

El enlace público pertenece a la relación entre el link y **ese** grupo: el mismo link en otro grupo SHALL tener su
propio interruptor y su propio `slug`, y la lista privada NO SHALL tener enlace público.

#### Scenario: Enlace público opaco

- **GIVEN** un link de "Backend Senior" compartido en "Backend Bolivia"
- **WHEN** se publica
- **THEN** el `slug` SHALL tener 12 caracteres del alfabeto
- **AND** NO SHALL contener el título, la empresa, el nombre del grupo ni el identificador del link

#### Scenario: Dos grupos, dos enlaces

- **GIVEN** la misma vacante compartida en los grupos A y B
- **WHEN** se publica en los dos
- **THEN** SHALL haber dos `slug` distintos
- **AND** despublicar el de A NO SHALL afectar al de B

#### Scenario: Slug con otra caja

- **GIVEN** un enlace público con `slug` `k7m2p9r4t6vw`
- **WHEN** se pide la página con `K7M2P9R4T6VW`
- **THEN** la respuesta SHALL ser `404`

#### Scenario: Dos publicaciones a la vez

- **GIVEN** un link compartido en un grupo, sin publicar
- **WHEN** quien lo compartió y el `owner` lo publican a la vez
- **THEN** las dos respuestas SHALL traer el mismo `slug`
- **AND** SHALL existir un solo enlace público para esa relación

#### Scenario: Slug repetido al publicar

- **GIVEN** un generador que devuelve un `slug` ya usado antes de devolver uno libre
- **WHEN** quien compartió un link lo publica
- **THEN** la respuesta SHALL ser `200` con el `slug` libre

#### Scenario: Slug repetido al compartir

- **GIVEN** un generador que devuelve un `slug` ya usado antes de devolver uno libre
- **WHEN** un miembro guarda una URL en un grupo que comparte en público
- **THEN** la respuesta SHALL ser `201` con un enlace público de `slug` libre
- **AND** SHALL existir una sola relación para ese link y ese grupo

### Requirement: Publicar y despublicar

`PUT /api/groups/:id/links/:linkId/public` SHALL comprobar, en este orden:

1. la pertenencia: quien no es miembro SHALL recibir `404` con código `group_not_found`;
2. la relación: un link que no está en el grupo SHALL recibir `404` con código `link_not_found`;
3. el permiso: quien no compartió el link y no es `owner` SHALL recibir `403` con código `forbidden`, esté publicado o
   no;
4. la publicación: si ya estaba publicado SHALL responder `200` con el mismo `slug`, sin generar otro; si no, SHALL
   generarlo y responder `200` con `slug`, la URL pública absoluta y `publishedAt`. Si al escribir la relación ya no
   existe, SHALL responder `404` con código `link_not_found`.

`DELETE /api/groups/:id/links/:linkId/public` SHALL hacer las mismas tres comprobaciones y después quitar el enlace,
respondiendo `204` estuviera publicado o no.

Despublicar SHALL **quemar** el `slug`: quien tenga esa URL SHALL recibir `404` desde ese momento, y volver a publicar
SHALL generar un `slug` distinto del anterior.

Cualquier miembro del grupo SHALL poder ver en el listado que un link está publicado y cuál es su URL; solo quien lo
compartió y el `owner` SHALL poder cambiar el interruptor.

#### Scenario: Quien compartió publica

- **GIVEN** Ana, que compartió un link en su grupo
- **WHEN** lo publica
- **THEN** la respuesta SHALL ser `200` con un `slug` y su URL pública
- **AND** la página pública de ese `slug` SHALL responder `200`

#### Scenario: El propietario publica un link ajeno

- **GIVEN** un link compartido por Beto en un grupo cuya propietaria es Ana
- **WHEN** Ana lo publica
- **THEN** la respuesta SHALL ser `200` con un `slug`

#### Scenario: Otro miembro no publica

- **GIVEN** un link compartido por Beto
- **WHEN** Carla, miembro sin ser owner, intenta publicarlo
- **THEN** la respuesta SHALL ser `403` con código `forbidden`
- **AND** el link NO SHALL quedar publicado

#### Scenario: Sin permiso aunque ya esté publicado

- **GIVEN** un link publicado por Beto
- **WHEN** Carla, miembro sin ser owner, pide publicarlo y después despublicarlo
- **THEN** las dos respuestas SHALL ser `403` con código `forbidden`
- **AND** el enlace público SHALL seguir funcionando

#### Scenario: Publicar dos veces no cambia el enlace

- **GIVEN** un link ya publicado con el `slug` S
- **WHEN** quien lo compartió vuelve a publicarlo
- **THEN** la respuesta SHALL ser `200` con el mismo `slug` S

#### Scenario: Despublicar quema el enlace

- **GIVEN** un link publicado con el `slug` S
- **WHEN** quien lo compartió lo despublica y vuelve a publicarlo
- **THEN** la respuesta del despublicado SHALL ser `204`
- **AND** la página de S SHALL responder `404`
- **AND** el `slug` nuevo SHALL ser distinto de S

#### Scenario: Despublicar lo que no estaba publicado

- **GIVEN** un link compartido y sin publicar
- **WHEN** quien lo compartió lo despublica
- **THEN** la respuesta SHALL ser `204`

#### Scenario: Extraño no toca el interruptor

- **GIVEN** un usuario que no es miembro del grupo
- **WHEN** intenta publicar un link del grupo y otro con un identificador mal formado
- **THEN** ambas respuestas SHALL ser `404` con código `group_not_found` y cuerpos idénticos

### Requirement: Visibilidad por defecto del grupo al compartir

Un link que **entra** en un grupo SHALL nacer publicado si la visibilidad por defecto del grupo es `public`, y sin
publicar si es `private`. SHALL aplicarse igual al guardar un link uno a uno y al importar un chat, y **solo** cuando la
relación es nueva: un link que ya estaba en el grupo NO SHALL cambiar su estado público.

Cambiar la visibilidad por defecto del grupo NO SHALL publicar ni despublicar ningún link ya compartido, ni en ese
momento ni después.

#### Scenario: Grupo que comparte en público

- **GIVEN** un grupo con la visibilidad por defecto en `public`
- **WHEN** un miembro guarda una URL en él
- **THEN** la respuesta SHALL traer el enlace público del link
- **AND** su página pública SHALL responder `200`

#### Scenario: Grupo que no comparte en público

- **GIVEN** un grupo con la visibilidad por defecto en `private`
- **WHEN** un miembro guarda una URL en él
- **THEN** el link NO SHALL traer enlace público

#### Scenario: Importar hereda la visibilidad

- **GIVEN** un grupo con la visibilidad por defecto en `public`
- **WHEN** un miembro importa un chat con tres URLs nuevas
- **THEN** los tres links SHALL tener enlace público, cada uno con un `slug` distinto

#### Scenario: El link que ya estaba no cambia

- **GIVEN** un link compartido en un grupo y despublicado a mano
- **WHEN** otro miembro guarda la misma vacante en ese grupo, que tiene la visibilidad por defecto en `public`
- **THEN** la respuesta SHALL ser `201` con `shared` `already_there`
- **AND** el link SHALL seguir sin enlace público

#### Scenario: Cambiar el ajuste no toca lo compartido

- **GIVEN** un grupo con tres links publicados y dos sin publicar
- **WHEN** el `owner` pone la visibilidad por defecto en `private` y la vuelve a poner en `public`
- **THEN** los tres SHALL seguir publicados con el mismo `slug`
- **AND** los dos SHALL seguir sin publicar

### Requirement: Página pública servida por la API

`GET /p/:slug` SHALL servirse fuera del prefijo `/api` y sin sesión, y SHALL responder `200` con
`Content-Type: text/html; charset=utf-8` y un documento HTML que contenga:

- las etiquetas Open Graph y Twitter de la oferta;
- `<html lang="es">` y `<meta name="robots" content="noindex">`;
- un redirect a la vista pública del SPA con `<meta http-equiv="refresh" content="0; …">` y un enlace visible de
  respaldo;
- el CTA "Guardar en LinkVault" y, bajo él, "Guarda aquí las ofertas que te pasan por WhatsApp y no las pierdas.".

El documento NO SHALL contener ninguna etiqueta `<script>` ni ejecutar JavaScript.

SHALL devolverse **la misma respuesta a todo el mundo**: NO SHALL mirarse el `User-Agent` ni el `Accept`, y la respuesta
NO SHALL llevar `Vary`. Todo valor que entre en el HTML SHALL escaparse, y la URL de la oferta original SHALL admitirse
solo si es `http` o `https`.

Las respuestas `200`, `404` y `429` de esta ruta SHALL llevar `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff` y una `Content-Security-Policy` cuyo `default-src` sea `'none'`, sin ninguna
excepción para scripts ni para imágenes.

La petición SHALL resolverse en este orden: primero el formato del `slug`, después el consumo de los contadores y solo
al final las lecturas. Un `slug` mal formado NO SHALL consumir ningún contador, y una petición rechazada por el límite
NO SHALL hacer ninguna lectura.

Esta ruta NUNCA SHALL responder `application/json`, tampoco ante un error inesperado, tampoco cuando el `slug` falta
(`/p/`) o llega con segmentos de más (`/p/a/b`).

Cada petición SHALL dejar en el log estructurado `{ slug, status }` y nada más: ni la dirección de origen, ni el
`User-Agent`, ni el referente, ni ningún dato de la oferta.

#### Scenario: Un bot pide la página

- **GIVEN** un enlace público de una oferta enriquecida
- **WHEN** un cliente sin JavaScript pide `/p/:slug`
- **THEN** la respuesta SHALL ser `200` de tipo `text/html`
- **AND** SHALL contener las etiquetas Open Graph con el título y la empresa

#### Scenario: Una persona pide la página

- **GIVEN** el mismo enlace público
- **WHEN** lo abre un navegador
- **THEN** la respuesta SHALL ser la misma que recibe el bot
- **AND** SHALL contener el redirect a la vista pública del SPA y un enlace visible a ella

#### Scenario: La respuesta no depende de quién pide

- **WHEN** se pide `/p/:slug` con el `User-Agent` de WhatsApp y con el de un navegador
- **THEN** los dos cuerpos SHALL ser idénticos
- **AND** ninguna respuesta SHALL llevar la cabecera `Vary`

#### Scenario: Título con HTML dentro

- **GIVEN** una oferta cuyo título es `</title><script>alert(1)</script>`
- **WHEN** se pide su página pública
- **THEN** el HTML NO SHALL contener una etiqueta `<script>` con ese contenido
- **AND** el título SHALL verse escapado

#### Scenario: Oferta sin preview todavía

- **GIVEN** un link publicado cuya lectura aún no terminó
- **WHEN** se pide su página pública
- **THEN** la respuesta SHALL ser `200`
- **AND** el título SHALL ser la etiqueta legible derivada de su URL

#### Scenario: La página nunca devuelve JSON

- **WHEN** se pide `/p/:slug` con un `slug` válido, con uno inexistente, con uno mal formado, sin `slug` (`/p/`) y con
  segmentos de más (`/p/a/b`)
- **THEN** ninguna respuesta SHALL tener `Content-Type` `application/json`

#### Scenario: Cabeceras de seguridad

- **WHEN** se piden una página que existe, una de un `slug` quemado y una que supera el límite
- **THEN** las tres SHALL llevar `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` y una
  `Content-Security-Policy` con `default-src 'none'`, sin excepción para scripts ni para imágenes

#### Scenario: La página no ejecuta JavaScript

- **WHEN** se pide una página pública
- **THEN** el documento NO SHALL contener ninguna etiqueta `<script>`
- **AND** el salto a la vista del SPA SHALL hacerse con `<meta http-equiv="refresh" content="0; …">`

#### Scenario: Un slug mal formado no gasta la ventana

- **WHEN** se piden 100 páginas con `slug` mal formados y después una con un `slug` válido
- **THEN** las 100 SHALL ser `404`
- **AND** la última SHALL ser `200`

#### Scenario: El log no dice quién pidió

- **WHEN** se pide una página pública
- **THEN** el log SHALL contener el `slug` y el código de respuesta
- **AND** NO SHALL contener la dirección de origen, el `User-Agent` ni el referente

### Requirement: Etiquetas Open Graph de la oferta

La página pública SHALL incluir `og:site_name`, `og:type` `website`, `og:locale` `es_ES`, `og:url` con la URL absoluta
de la propia página, `og:title`, `og:description`, `og:image` con una imagen fija de LinkVault y sus medidas, y
`twitter:card` `summary_large_image` con su título y su descripción.

`og:title` SHALL ser el título del preview o, si no lo hay, la etiqueta legible derivada de la URL, cortado a 100 code
points. `og:description` SHALL componerse con los campos publicables que existan, **en este orden**: empresa,
ubicación, salario, modalidad, nivel y cuándo cierra, unidos por un separador y cortado a 200 code points; si no hay
ninguno, SHALL usarse un texto de respaldo. El salario va antes que la modalidad y el nivel porque es lo que más
decide si alguien abre la oferta y lo primero que se pierde cuando una app recorta la descripción. Los cortes SHALL
hacerse en un límite de palabra y terminar con puntos suspensivos.

`og:url` SHALL construirse con la URL pública configurada, NUNCA con la cabecera `Host` de la petición.

#### Scenario: Descripción con los datos de la oferta

- **GIVEN** una oferta con empresa, ubicación, salario, modalidad remota y nivel senior
- **WHEN** se pide su página pública
- **THEN** `og:description` SHALL nombrar la empresa, la ubicación, el salario, la modalidad y el nivel
- **AND** el salario SHALL aparecer antes que la modalidad y que el nivel

#### Scenario: Descripción de respaldo

- **GIVEN** un link publicado sin ningún campo del preview
- **WHEN** se pide su página pública
- **THEN** `og:description` SHALL ser el texto de respaldo, no una cadena vacía

#### Scenario: Título demasiado largo

- **GIVEN** una oferta con un título de 300 caracteres
- **WHEN** se pide su página pública
- **THEN** `og:title` SHALL tener como mucho 100 code points y terminar en puntos suspensivos

#### Scenario: Host falsificado

- **WHEN** se pide `/p/:slug` con la cabecera `Host` de otro dominio
- **THEN** `og:url` SHALL usar la URL pública configurada y NO SHALL contener ese dominio

### Requirement: Qué no sale nunca en la página pública

La página pública y el endpoint público SHALL exponer únicamente: la plataforma, la URL de la oferta original, el
título, la empresa, la ubicación, la modalidad, el nivel, el salario, la fecha de publicación y la de cierre.

La URL de la oferta original SHALL publicarse **saneada**: solo `http` o `https`, sin usuario ni contraseña embebidos y
sin los parámetros de campaña y seguimiento que ya descarta la normalización de URL (spec `links/job-link`), de la misma
lista cerrada. SHALL **conservar el fragmento**, porque hay bolsas que ponen la ruta de la oferta en él y quitarlo
llevaría a la portada. El resto de parámetros SHALL conservarse: son los que identifican la vacante. Una URL que no sea
`http(s)` NO SHALL publicarse y la página SHALL mostrarse sin enlace a la oferta original.

NO SHALL exponer, en ningún caso: el resumen (`summary`), las habilidades, los idiomas, la procedencia por campo, el
estado ni la versión del preview, el motivo del último fallo, quién compartió el link, cuándo se compartió, el grupo o
su nombre, la nota, los comentarios, ninguna postulación, ni el identificador interno del link o de la relación.

Un preview cuyos campos escribió o pegó una persona SHALL publicarse igual, sin decir quién los puso.

#### Scenario: Oferta con resumen y habilidades

- **GIVEN** una oferta publicada cuyo preview tiene `summary`, habilidades, idiomas y procedencia por campo
- **WHEN** se pide su página pública y su endpoint público
- **THEN** ninguna de las dos respuestas SHALL contener el resumen, las habilidades, los idiomas ni ningún nombre de
  persona

#### Scenario: La página no dice de qué grupo viene

- **GIVEN** una oferta publicada en "Backend Bolivia" por Ana, con nota y dos comentarios
- **WHEN** se pide su página pública
- **THEN** la respuesta NO SHALL contener "Backend Bolivia", ni "Ana", ni la nota, ni ningún comentario

#### Scenario: URL original con credenciales y rastro

- **GIVEN** un link publicado cuyo `displayUrl` es
  `https://ana:secreto@bolsa.example/ofertas?jk=42&utm_source=mail&mc_eid=ana%40example.com#detalle`
- **WHEN** se piden su página pública y su endpoint público
- **THEN** el enlace a la oferta original SHALL ser `https://bolsa.example/ofertas?jk=42#detalle`
- **AND** ninguna respuesta SHALL contener `ana`, `secreto`, `utm_source` ni `mc_eid`

#### Scenario: URL original que no se puede publicar

- **GIVEN** un link publicado cuyo `displayUrl` no es `http` ni `https`
- **WHEN** se pide su página pública
- **THEN** la respuesta SHALL ser `200` con la oferta
- **AND** NO SHALL mostrarse ningún enlace a la oferta original

#### Scenario: Preview escrito a mano

- **GIVEN** una oferta publicada cuyo título y empresa escribió Ana a mano
- **WHEN** se pide su página pública
- **THEN** SHALL verse el título y la empresa
- **AND** NO SHALL verse que los escribió Ana

### Requirement: Enlace inexistente, quemado o mal formado

Un `slug` que no existe, uno que se despublicó, uno cuyo link se quitó del grupo, uno cuyo grupo se borró y uno con
formato inválido SHALL responder todos `404`, con **el mismo cuerpo HTML**: una página útil que dice "Este enlace ya no
está disponible" y "Pídeselo de nuevo a quien te lo envió", con un enlace a LinkVault, sin etiquetas Open Graph y sin
redirect. NO SHALL responderse con un cuerpo JSON.

#### Scenario: Enlace que ya no está

- **WHEN** se pide `/p/` con un `slug` inexistente, con uno despublicado y con `no-es-un-slug`
- **THEN** las tres respuestas SHALL ser `404` de tipo `text/html` con cuerpos idénticos
- **AND** SHALL decir que el enlace ya no está disponible y que se lo pida de nuevo a quien se lo envió

#### Scenario: El link sale del grupo

- **GIVEN** un link publicado en un grupo
- **WHEN** quien lo compartió lo quita del grupo
- **THEN** su página pública SHALL responder `404`

#### Scenario: El grupo se borra

- **GIVEN** un grupo con dos links publicados
- **WHEN** el `owner` borra el grupo
- **THEN** las dos páginas públicas SHALL responder `404`

### Requirement: Vista pública para el SPA

`GET /api/public/previews/:slug` SHALL responder sin sesión, con `200` y `{ slug, link }`, donde `link` lleva
exactamente los campos publicables. Un `slug` inexistente, quemado o mal formado SHALL responder `404` con código
`link_not_found` y el mismo cuerpo en los tres casos.

Solo las rutas bajo `/api/public/` SHALL poder responder sin `Authorization`, además de las de sesión.

Cada petición SHALL dejar en el log estructurado `{ slug, status }`, como la página, y nada más. Con eso y con el log
que `POST /api/links` ya deja, SHALL poder contarse cuántas páginas públicas se sirven y cuántas altas las siguen, sin
guardar ningún dato de quien visita y sin ninguna escritura.

#### Scenario: Preview público sin sesión

- **GIVEN** un enlace público de una oferta enriquecida
- **WHEN** se pide `GET /api/public/previews/:slug` sin `Authorization`
- **THEN** la respuesta SHALL ser `200` con el título, la empresa y la URL de la oferta original

#### Scenario: Preview público de un enlace quemado

- **WHEN** se pide el preview de un `slug` despublicado y de uno mal formado
- **THEN** ambas respuestas SHALL ser `404` con código `link_not_found` y cuerpos idénticos

#### Scenario: El endpoint público también se registra

- **WHEN** se pide el preview de un `slug`
- **THEN** el log SHALL contener ese `slug` y el código de respuesta
- **AND** NO SHALL contener ningún dato de quien pidió

### Requirement: Límite global de las rutas públicas

`GET /p/:slug` y `GET /api/public/previews/:slug` SHALL tener cada uno un contador **global de la ruta** por ventana de
tiempo, con umbrales altos, y `GET /p/:slug` SHALL tener además un contador **por `slug`**, con un umbral menor. Ningún
contador SHALL distinguir clientes: no SHALL usarse la dirección de origen, ni ninguna cabecera que envíe el cliente, ni
ningún identificador derivado de ellas. El `slug` es parte de la ruta, no del cliente.

Los contadores SHALL consumirse **antes** de cualquier lectura, de modo que superar el límite no cueste ninguna
consulta. Al superarse cualquiera de ellos, `/p/:slug` SHALL responder `429` **en HTML** con `Retry-After`, y el
endpoint JSON `429` con código `too_many_attempts` y `Retry-After`. Los contadores SHALL ser independientes: agotar uno
NO SHALL afectar a los demás, y agotar el de un `slug` NO SHALL impedir servir otro.

Los contadores SHALL fallar abiertos: si el almacén de contadores no responde, las dos rutas SHALL servirse
normalmente.

#### Scenario: Ventana agotada en la página

- **GIVEN** el contador de la página pública agotado
- **WHEN** alguien pide una página pública
- **THEN** la respuesta SHALL ser `429` de tipo `text/html` con `Retry-After`
- **AND** NO SHALL hacerse ninguna lectura en la base de datos

#### Scenario: Ventana agotada en el endpoint

- **GIVEN** el contador del endpoint público agotado
- **WHEN** el SPA pide el preview de un `slug`
- **THEN** la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After`

#### Scenario: Los contadores son independientes

- **GIVEN** el contador de la página pública agotado
- **WHEN** el SPA pide el preview de un `slug`
- **THEN** la respuesta SHALL ser `200`

#### Scenario: Un enlace agota solo lo suyo

- **GIVEN** dos enlaces públicos A y B, con el contador de A agotado
- **WHEN** se piden las páginas de A y de B
- **THEN** la de A SHALL ser `429` y la de B SHALL ser `200`
- **AND** el `429` de A NO SHALL hacer ninguna lectura

#### Scenario: El contador no responde

- **GIVEN** el almacén de contadores caído
- **WHEN** se piden la página pública y el preview
- **THEN** las dos respuestas SHALL ser `200` con la oferta

#### Scenario: El límite no depende de quién pide

- **WHEN** se piden páginas públicas con cabeceras `X-Forwarded-For` distintas
- **THEN** todas SHALL contar contra el mismo contador
- **AND** ninguna clave de contador SHALL derivarse de una cabecera de la petición

### Requirement: La página pública no dispara trabajo

Atender `GET /p/:slug` SHALL hacer exactamente dos lecturas indexadas —la relación por su `slug` y la vacante— y
**ninguna escritura**. NO SHALL pedir el enriquecimiento del link aunque esté sin leer o haya fallado, NO SHALL llamar a
ningún proveedor de IA, NO SHALL escribir en el outbox, NO SHALL publicar ningún aviso y NO SHALL resolver nombres de
usuario.

La respuesta `200` SHALL llevar `Cache-Control` público de corta duración; las respuestas `404` y `429` NO SHALL
cachearse.

#### Scenario: Mil peticiones no leen la bolsa

- **GIVEN** un link publicado en estado `failed`
- **WHEN** se piden 50 veces seguidas su página pública
- **THEN** NO SHALL encolarse ningún trabajo de enriquecimiento
- **AND** NO SHALL escribirse nada en la base de datos

#### Scenario: Cabeceras de caché

- **WHEN** se pide una página pública que existe y otra de un `slug` quemado
- **THEN** la primera SHALL llevar `Cache-Control` público con una duración de minutos
- **AND** la segunda NO SHALL permitir que se cachee

### Requirement: El enlace público vive con la relación

Quitar el link del grupo, borrar el grupo y volver a compartir el link SHALL comportarse así:

- quitar el link del grupo SHALL borrar su enlace público en la misma transacción que la relación, la nota y los
  comentarios;
- borrar el grupo SHALL borrar los enlaces públicos de todos sus links, en la misma transacción que el borrado;
- volver a compartir un link que se quitó SHALL empezar sin enlace público o con uno nuevo, según la visibilidad por
  defecto del grupo, y NUNCA SHALL recuperar el `slug` anterior.

#### Scenario: Volver a compartir no resucita el enlace

- **GIVEN** un link publicado con el `slug` S, quitado después del grupo
- **WHEN** alguien vuelve a compartirlo en ese grupo, que tiene la visibilidad por defecto en `public`
- **THEN** SHALL tener un enlace público con un `slug` distinto de S
- **AND** la página de S SHALL seguir respondiendo `404`
