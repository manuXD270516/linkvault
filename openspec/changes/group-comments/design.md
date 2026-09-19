## Context

`job-links` dejó `group_links` como `{ groupId, linkId, sharedBy, sharedAt }`. Tiene un índice único `(groupId, linkId)`,
el del listado `(groupId, sharedAt, _id)` y el del reparto `{ linkId: 1 }`. docs/design.md describía además
`comment`, `tags[]` y `pinned`, que no se crearon porque nada los usaba. `GroupDeletionHooks` (ADR-021 §6) ya ejecuta
`GroupLinksDeletionHook` de `links` dentro de la transacción del borrado de grupo. ADR-024 (Consecuencias) añade que un
módulo que guarde algo **con** `groupId`, como los comentarios, se limpia por ese mecanismo.

Lo que ya existe y este change aprovecha:
- **Canal en vivo.** `link-enrichment` y `paste-job-description` montaron un canal de Redis (`events:link.enriched`) con
  un cliente suscriptor por proceso (`REDIS_SUBSCRIBER_CLIENT`) y un publicador sobre el cliente de aplicación
  (`RedisLinkEnrichedPublisher`). El reparto usa `DeliverLinkEnriched` y `EventStreamRegistry`, y el SPA lee
  `GET /api/events` con `HttpClient` (`EventsChannel`).
- **Límites.** `FIXED_WINDOW_COUNTER` de plataforma está detrás de `LINK_LIMITER` (`CounterLinkLimiter`). El filtro HTTP
  ya traduce `TooManyLinkAttempts` a `429 too_many_attempts` con `Retry-After`.
- **Higiene de texto.** `scrubContactDetails` vive en `libs/shared` y se aplica al texto pegado antes de la IA (ADR-023
  §2).
- **Fachadas y transacciones.** `LinksFacade` y `GroupsFacade` (`membershipOf`, `memberIdsOf`) son las entradas públicas
  de sus módulos. En `links`, las transacciones las abre un adaptador de repositorio y reparte una `TransactionSession`
  opaca.
- **SPA.** `LinksStore` **sustituye** la tarjeta entera con lo que trae `link.enriched` y con las respuestas de editar el
  preview o de pegar.

**Alcance.** ADR-015 fija comentarios planos: texto, autor y fecha, sin hilos ni reacciones. design-v0.2 §5.4 fija la
ruta `POST /groups/:g/links/:l/comments {text}`, la tarjeta con los 2 últimos y el contador, y "sin edición (solo borrar
propio)". Esa última regla es de design-v0.2 y no de ADR-015. La decisión humana 5 la enmienda. docs/design.md no
describe ninguna colección `group_link_comments`: la define este change (D2).

Motivación y alcance: proposal.md; comportamiento: las specs; decisiones no triviales: **ADR-026**.

### Decisiones humanas previas (2026-09-19)

1. **`settings.defaultVisibility` sale de este change** y pasa a `public-preview-share`. Allí significa "los links de
   este grupo se comparten públicamente por defecto: sí/no" (design-v0.2 §5.5). `openspec-changes.yaml` lo refleja.
2. **De los campos heredados de `group_links` solo entra `comment`**: la nota que quien comparte escribe al compartir
   ("esta es la que te dije"), visible en la tarjeta. `tags` y `pinned` quedan fuera (Non-Goals).
3. **Los comentarios nuevos y los borrados aparecen en vivo** en las pantallas abiertas del grupo, por el canal de
   Redis/SSE que ya existe. La tarjeta actualiza el contador y los 2 últimos sin recargar. El aviso no lleva el texto si
   eso choca con una regla de privacidad del canal. Lo resuelve D9: el texto no viaja por Redis, pero sí en el mensaje
   SSE a los miembros actuales.
4. **Al salir o ser expulsado, los comentarios se quedan** con el nombre del autor y la marca "ya no está en el grupo".
   D8 fija qué puede hacer esa persona si vuelve y qué pasa al borrar el grupo.
5. **El propietario puede borrar cualquier comentario ajeno de su grupo, y también la nota.** Decisión tomada tras el
   debate, iteración 1. Nunca puede editarlos. No queda marca: el comentario simplemente desaparece. Enmienda el
   "solo borrar propio" de design-v0.2 §5.4 (ADR-026) y cierra la Open Question de moderación.

## Goals / Non-Goals

**Goals:**
- Que el contexto que hoy viaja en el chat ("piden C1", "ya cerró") quede pegado a la oferta, en el grupo donde se dijo.
- Que la tarjeta lo enseñe sin pedir nada más (la nota, los 2 últimos comentarios y el contador), con lecturas fijas por
  página.
- Que una conversación activa se vea en vivo, sin que el texto de nadie pase por Redis ni por los logs, y sin que un
  aviso atrasado pise uno nuevo.
- Que ningún comentario quede huérfano: vive y muere con la relación link-grupo, también en las carreras.
- Que salir de un grupo no borre lo que otros ya leyeron y respondieron, y que el propietario pueda limpiar su grupo.

**Non-Goals:**
- `tags` y `pinned` de `group_links` (decisión humana 2): se añadirán cuando un uso los pida.
- `settings.defaultVisibility` (decisión humana 1): lo decide `public-preview-share`.
- Hilos, respuestas, reacciones y menciones (ADR-015).
- Editar comentarios o notas, y dejar marca de un borrado (decisión humana 5; business 4).
- **Ordenar el grupo por actividad** (business 8, diferido). El listado sigue ordenado por `sharedAt`. El camino futuro
  es un `lastCommentAt` en `group_links`, escrito en la misma transacción que `commentsRevision`, con su propio índice.
- Notificaciones fuera de la pantalla abierta, como correo, push o un contador de "no leídos".
- Enlaces clicables, Markdown o vista previa de URLs dentro de un comentario.
- Aviso en vivo de un cambio de nota o de un link nuevo en el grupo. Hoy tampoco se avisa al compartir un link, y la
  nota se escribe justo en ese momento.
- La marca "ya no está en el grupo" sobre quien **compartió** un link (`sharedBy`). Solo la llevan los autores de
  comentarios (decisión humana 4). Extenderla cambia `linkSharerSchema`, que usan otras vistas.
- Mostrar comentarios o notas en la página pública `/p/:slug`. Ahí no deben aparecer nunca (D5).
- Borrar comentarios al borrar la cuenta: lo hereda `deploy-prod`, ya escrito en su `scope` del manifiesto (lo verifica
  la tarea 7.5).

## Decisions

### D1 — Los comentarios viven dentro de `links`

Opciones, con la votación del debate y el desempate de arquitectura:

| Opción | A favor | En contra |
|--------|---------|-----------|
| **A. Dentro de `links`**, junto a `group_links` | Un comentario cuelga de un `GroupLink`, que es de `links` (ADR-002: "`GroupLink` como relación con metadatos (quién compartió, comentario)"). Quitar el link del grupo y borrar sus comentarios cabe en **una transacción** del mismo módulo. El hook de borrado de grupo ya existe y solo se amplía. El resumen de la tarjeta entra en `GET /api/groups/:id/links` sin otra petición. Se reutilizan el suscriptor de Redis, el reparto SSE y el limitador. CLAUDE.md no lista `comments` entre los contextos. | `links` crece: ya es el módulo más grande. |
| B. Módulo nuevo `comments` | Módulo pequeño y enfocado. | Necesita que `links` le avise al quitar un link: o `links` depende de `comments`, o un segundo registro de hooks, o huérfanos ocultos que reaparecen al volver a compartir. Pide una segunda petición por página para el resumen. Duplica el cableado del canal en vivo. |
| C. Dentro de `groups` | Pertenencia a mano. | `groups` pasaría a conocer links: invierte la dependencia `links` → `groups` (ADR-021 §6). |

Votación: consistencia transaccional → A; tiempo hasta el valor → A; tamaño de módulo → B. **Gana A**, 2 a 1. El
desempate de arquitectura confirma A: un bounded context se define por su lenguaje y sus invariantes, no por su número
de archivos. El invariante es "un comentario existe solo mientras su relación existe", y solo se protege sin dependencias
cruzadas si relación y comentario comparten módulo. Critic y business no lo objetaron en la iteración 1.

Estructura dentro de `links` (clean architecture, puertos por token):
- **`domain/`** (sin `@nestjs/*` ni `mongoose`; lint existente):
  - `group-link-comment.ts`: texto normalizado, `mayDelete(requesterId, role)` y `authorLeft` derivado;
  - `share-note.ts` y límites nuevos en `limits.ts`;
  - errores `CommentNotFound`, `CommentDeletionForbidden`, `NoteRemovalForbidden` y `CommentsGroupNotFound` (critic 16,
    código `group_not_found`, propio de `links`);
  - errores de campo `InvalidCommentText` e `InvalidShareNote`, sobre una base `InvalidLinkField` con `field`
    (critic 13).
- **`application/`**:
  - puertos `GROUP_LINK_COMMENT_REPOSITORY`, `COMMENTS_CHANGED_PUBLISHER` y `COMMENTS_BROADCASTER` (el reparto a las
    conexiones, como `ENRICHMENT_BROADCASTER`; critic 7, iteración 2);
  - casos de uso nuevos: `PostGroupLinkComment`, `DeleteGroupLinkComment`, `ListGroupLinkComments`, `RemoveShareNote`
    y `DeliverCommentsChanged`;
  - cambian: `ListGroupLinks`, `SaveLink` y `RemoveGroupLink`;
  - `testing/`: repositorios en memoria y el doble del publicador.
- **`infrastructure/`**: `group-link-comment.schemas.ts`, `mongo-group-link-comment.repository.ts`,
  `redis-comments-changed-publisher.ts` y `redis-comment-notices.ts`. Se amplían `MongoGroupLinkRepository` y
  `GroupLinksDeletionHook`.
- **`presentation/`**: `group-link-comments.controller.ts` bajo `groups/:id/links/:linkId/comments`, más la ruta de la
  nota en `GroupLinksController`.

**Entre módulos**, solo lo que ya existe: `GroupsFacade` detrás de `GROUP_MEMBERSHIP` y `UsersFacade` detrás de
`LINK_USER_DIRECTORY`. `LinksFacade` no cambia. Los casos de uso nuevos **no** importan `GroupNotFound` de `groups`
(critic 16). Los cuatro que ya lo hacen (`SaveLink`, `ImportLinks`, `ListGroupLinks` y `RemoveGroupLink`) quedan como
deuda heredada de `job-links` (Risks).

### D2 — Modelo, dueño de los contadores y consistencia con la relación

**`group_link_comments`**: `{ _id, groupId, linkId, authorId, text, createdAt }`, con `bufferCommands: false` y
`strict`. Índice `{ groupId: 1, linkId: 1, createdAt: -1, _id: -1 }`. Sirve al hilo paginado, al resumen, al borrado por
relación y al borrado por grupo, porque su prefijo es `groupId`.

**`group_links`** suma tres campos y **no toca ningún índice**:
- `note?: { text, createdAt }`. En docs/design.md se llama `comment`. Se renombra para que "comentario" signifique una
  sola cosa (ADR-026, "Se aparta de"). La fecha es `createdAt` porque la nota nunca se edita (critic 6, iteración 2).
- `commentCount: number`. Si falta, se lee como 0.
- `commentsRevision: number` (critic 4). Si falta, se lee como 0. Sube 1 con cada alta y con cada borrado de un
  comentario, y nunca retrocede **mientras dure la relación**: al quitar el link y volver a compartirlo, la relación es
  otra y empieza en 0.
  - Viaja en `comments.revision` junto a `comments.sharedAt`, el `sharedAt` de la relación, que distingue cada vez que
    el link se compartió.
  - El SPA compara la pareja (`sharedAt`, `revision`): un `sharedAt` distinto gana siempre; con el mismo, descarta la
    revisión menor (critic 2, iteración 2).
  - `count` no sirve para eso: un alta seguida de un borrado deja el mismo `count` con distinto contenido.

**Dueño único** (critic 2). `GroupLinkRepository` es el único que escribe `commentCount` y `commentsRevision`, y el único
que abre transacciones que tocan comentarios. `GroupLinkCommentRepository` solo lee, o escribe con la sesión que recibe
por parámetro. La `TransactionSession` sigue opaca para `application`. Operaciones de `GroupLinkRepository`:
- **`addComment(comment)`.** En una transacción:
  1. `updateOne({ groupId, linkId }, { $inc: { commentCount: 1, commentsRevision: 1 } })`;
  2. si `matchedCount === 0`, se aborta y devuelve `null` (el caso de uso responde `404 link_not_found`);
  3. si no, `comments.insert(comment, session)`.

  Devuelve `{ count, revision, sharedAt }`. Entre el paso 1 y el 3 hay un **punto de espera que solo existe en los
  tests** (un gancho `protected` que el adaptador de producción deja vacío), para detener el alta a mitad en las pruebas
  deterministas de la carrera.
- **`removeComment(groupId, linkId, commentId)`.** En una transacción:
  1. `comments.deleteOne(groupId, linkId, commentId, session)`;
  2. solo si borró uno, `$inc: { commentCount: -1, commentsRevision: 1 }`.

  Devuelve el resumen nuevo, o `null` si no había nada.
- **`removeWithComments(groupId, linkId)`.** En una transacción: `deleteOne` de la relación (con su nota) y
  `comments.deleteByRelation(groupId, linkId, session)`. Devuelve si la relación existía.
- **`deleteByGroup(groupId, session)`**, que usa el hook: borra antes `comments.deleteByGroup(groupId, session)`.
- **`clearNote(groupId, linkId)`**: `$unset: { note: 1 }`. Devuelve `false` si la relación ya no existe.

`deleteByLink` sale del puerto `GroupLinkRepository` (critic 9): ningún código de producción lo usa, solo sus tests, y
dejarlo sería una puerta para borrar relaciones sin sus comentarios.

**Por qué el `$inc` cierra la carrera.** El alta y la retirada escriben el **mismo documento** de relación. Mongo aborta
una de las dos con `WriteConflict`, y `withTransaction` la reintenta viendo el estado final. Nunca queda un comentario sin
relación que **reaparezca** al volver a compartir. Lo prueban dos tests deterministas de repositorio (critic 3 de la
iteración 1 y critic 1 de la iteración 2; tareas 2.10 y 2.11), con el punto de espera del alta:
- **a) El alta va primero.**
  1. A hace el `$inc` sin confirmar y se detiene.
  2. Arranca B (`removeWithComments`) y choca.
  3. A inserta y confirma; B reintenta y borra.

  Resultado: 0 comentarios, y el alta devolvió el comentario.
- **b) La retirada va primero.**
  1. B borra la relación sin confirmar.
  2. Arranca `addComment`.
  3. B confirma; el reintento del alta no encuentra la relación.

  Resultado: el alta devuelve `null` y quedan 0 comentarios.

La prueba HTTP concurrente se queda como humo (tarea 5.8).

**Alternativas descartadas:** comentarios embebidos en `group_links` (documento sin techo y conflictos entre
comentaristas); `countDocuments` en cada lectura (una consulta más y la carrera abierta); que cada repositorio abra su
propia transacción (dos dueños de la misma invariante).

### D3 — La nota de quien comparte

- **Quién y cuándo.** Solo quien crea la relación, al compartir con `POST /api/links { url, groupId, note? }`.
  - Si la relación ya existía (`already_there`), la nota enviada se descarta sin error y la del primero no cambia.
  - El SPA avisa "Tu nota no se añadió…" y deja el texto en el campo (business 5). La persona decide qué hacer con él,
    por ejemplo comentarlo.
- **Primero se normaliza** (critic 12a). Una nota vacía tras normalizar equivale a no enviarla, también sin `groupId`,
  que da `201`. Con texto y sin `groupId`: `400` nombrando `note`.
- **Importar no admite nota.** Una sola nota para 50 links de un chat no diría nada de cada uno. Como
  `importLinksRequestSchema` es `z.object`, un `note` enviado se ignora.
- **No se edita; solo se quita** (business 4). Pueden quitarla quien compartió y el **propietario** (decisión humana 5).
  No hay `PATCH`: la nota es lo que se dijo al compartir; si estaba mal, se quita y se comenta.
  `DELETE /api/groups/:id/links/:linkId/note` comprueba en este orden (critic 5, iteración 2):
  1. pertenencia: si no es miembro, `404 group_not_found`;
  2. relación (`find`): si no existe, `404 link_not_found`;
  3. permiso: si no compartió el link y no es owner, `403 forbidden`, **haya o no nota**;
  4. `clearNote`: `204`, hubiera o no nota; si en ese momento la relación ya no existe, `404 link_not_found`.

  El orden hace que la respuesta no revele si el link tenía nota a quien no puede quitarla.
- **Longitud y texto.** Hasta 280 code points, con la misma normalización que los comentarios (D5). Es una línea de
  tarjeta, no un párrafo.
- **Diferencias con un comentario:**

| | Nota | Comentario |
|--|------|------------|
| Cuántas | una por relación | muchas |
| Posición en la tarjeta | arriba | en los 2 últimos y el contador |
| Hilo | no aparece | sí |
| Límite por persona | no cuenta | sí |
| Aviso en vivo | no | sí |
| Borrado | con la relación, o por quien compartió o el propietario | con la relación, o por su autor o el propietario |
| Edición | no | no |

**Alternativas descartadas:**
- la nota como primer comentario: los 2 últimos la sacarían de la tarjeta;
- una nota por cada persona que comparte: la tarjeta se llenaría de notas;
- que un segundo que comparte sobrescriba la del primero;
- editar la nota (business 4);
- "Publicarla como comentario" cuando el link ya estaba (business 5: un botón que publica sin que la persona lo relea).

### D4 — Permisos

| Acción | Quién | Si no |
|--------|-------|-------|
| Leer el hilo y el resumen | miembro **actual** del grupo | `404 group_not_found` |
| Comentar | miembro actual, con el link compartido **ahora** en el grupo | `404 group_not_found` / `404 link_not_found` |
| Borrar un comentario | miembro actual que es su **autor** o el **owner** del grupo | `403 forbidden` para otro miembro; `404 comment_not_found` si no existe o es de otro link o grupo |
| Editar un comentario o una nota | nadie (no hay ruta) | `404` |
| Quitar la nota | quien compartió el link o el **owner**, siendo miembros | `403 forbidden` |

- **Ver el link no basta para leer sus comentarios.** Quien lo tiene en su lista privada o en otro grupo no ve los de
  este. Los comentarios son contexto **del grupo**, y cada grupo tiene su hilo.
- **El propietario modera borrando** (decisión humana 5). El comentario desaparece sin marca. El rol se lee con
  `membershipOf`, que ya distingue `owner`. Así su única herramienta deja de ser quitar el link entero, que borraba
  también lo valioso.
- **`403` y no `404` al borrar lo ajeno.** Quien pide ya ve ese comentario, así que no hay nada que ocultarle (mismo
  criterio que `LinkRemovalForbidden`).

**Alternativas descartadas:** leer con el permiso de lectura del link (`canRead`), que mezclaría las conversaciones de
grupos distintos; que el propietario deje una marca "Borrado por el propietario" (decisión humana 5: sin marca); que el
propietario edite (nunca).

### D5 — Texto: normalizar sí, reescribir no

La función pura `normalizeCommentText` vive en `libs/shared/src/text/`. La usan el schema zod y el dominio, y hace:
1. `\r\n` y `\r` → `\n`;
2. quita los C0 y C1 salvo `\n`, y los de dirección U+202A–U+202E y U+2066–U+2069, que permiten falsear el orden visual;
3. `trim`.

Después se mide en code points: de 1 a 500 para un comentario y de 1 a 280 para una nota. El dominio vuelve a validar
(`InvalidCommentText` con `field: 'text'`, `InvalidShareNote` con `field: 'note'`).

**Emails y teléfonos: se respetan, no se pasa `scrubContactDetails`.** `paste-job-description` limpia el texto pegado
porque va a una IA, es texto de un tercero que nadie eligió publicar y no se guarda. Un comentario no cumple ninguna de
las tres: no va a la IA, lo escribe el miembro para su grupo sabiendo quién lo lee (lo dice la indicación del cuadro) y
se guarda para que el grupo lo lea. Borrar en silencio el teléfono de "escríbele a Juan al…" rompería el mensaje sin
avisar. Lo que protege al tercero:
- solo lo leen los miembros actuales;
- nunca va a los logs ni a Redis (D9);
- nunca sale en la página pública;
- lo borran su autor o el propietario.

**HTML: ni se sanea ni se rechaza.** Todo es texto plano: la API guarda y devuelve lo que llega, y el SPA lo pinta con
interpolación de Angular (que escapa), nunca con `[innerHTML]`. La defensa correcta está donde se interpreta, y aquí
nadie interpreta.

**Alternativas descartadas:** `scrubContactDetails` en el alta; un aviso al detectar un teléfono (fricción sin
protección real); sanear o rechazar etiquetas; Markdown.

### D6 — Límite por persona, y el orden alrededor de la transacción

`LINK_LIMITER` gana la clave `{ kind: 'comment', userId }`, con contador `links:comment:<userId>` y
`COMMENTS_PER_USER = 30` en `LINK_LIMIT_WINDOW_MS` (15 min). **Falla abierto**, como la importación: lo que se permite
de más es escribir en nuestra base y repartir a 50 conexiones como mucho.

Orden en `PostGroupLinkComment` (critic 10 y 11):
1. El pipe valida el cuerpo (`400` sin contar).
2. `memberIdsOf([groupId])`, que da `404 group_not_found` sin contar.
3. `consume`, **antes y fuera** de la transacción; si rechaza, `429` con `Retry-After`.
4. `groupLinks.addComment(…)`, que abre y cierra la transacción dentro.
5. Ante **cualquier** error de 4, `refund` y se relanza. Eso incluye `null` → `404 link_not_found`, que es la "carrera
   que termina en 404 no gasta".
6. Con éxito, `void publisher.publish(…)` **después y fuera** de la transacción, sin esperar: la respuesta no depende del
   aviso.

`DeleteGroupLinkComment` sigue el mismo patrón sin límite (critic 3 y 4, iteración 2):
1. `membershipOf` (rol);
2. `find` del comentario, con `404 comment_not_found` si no está;
3. `mayDelete` (`403`);
4. `removeComment`. Si devuelve `null`, responde `404 comment_not_found` **sin `publish`**. Si no, responde
   `200 { comments }` con el resumen nuevo y hace `void publish`.

Dos borrados concurrentes del mismo comentario terminan con uno `200` y otro `404`, el contador baja 1 y la revisión
sube 1 (integración, tarea 5.9).

**Ventana aceptada por escrito.** El rol se lee antes de la transacción. Un owner que acaba de transferir la propiedad
puede borrar un comentario ajeno en ese instante, igual que una expulsión en curso. Se acepta: es la misma ventana que
ya tienen `RemoveGroupLink` y el resto de permisos por rol de `links`, y el efecto es borrar algo que un momento antes
podía borrar.

**Alternativas descartadas:** límite por grupo o por link (un script cambia de destino); fallar cerrado; ningún límite
(el canal en vivo multiplica cada comentario); contar dentro del callback de `withTransaction` (un reintento por
`WriteConflict` contaría dos veces).

### D7 — Lecturas: el hilo y el resumen de la tarjeta sin N+1

**Hilo.** `GET /api/groups/:id/links/:linkId/comments?limit&cursor` lee por el índice de D2, ordenado por `createdAt` y
`_id` descendentes. El cursor opaco reutiliza `link-cursor.ts`. `total` sale de `commentCount`. Hace 4 lecturas fijas:
1. `memberIdsOf([groupId])`;
2. la relación (`find`);
3. la página;
4. `displayNamesOf`.

**Resumen en `GET /api/groups/:id/links`.** `ListGroupLinks` hace 5 lecturas fijas por página:
1. `memberIdsOf([groupId])`, en lugar de `membershipOf`: da la pertenencia y `authorLeft` para toda la página;
2. `listByGroup`, que ya proyecta `note`, `commentCount` y `commentsRevision`;
3. `countByGroup`;
4. **una** agregación sobre `group_link_comments`: `$match { groupId, linkId: { $in } }` y `$group` por `linkId` con
   `$topN` (n = 2, `sortBy { createdAt: -1, _id: -1 }`). `$topN` existe desde Mongo 5.2 y el proyecto usa 7.0;
5. `displayNamesOf`, con quienes compartieron, quienes editaron el preview y los autores, en una sola llamada.

**Cómo se comprueba.** Un test unitario cuenta las llamadas a los dobles de los puertos con páginas de 2 y de 20 links y
exige las mismas. La integración comprueba el uso del índice con `explain`.

**Forma.** `jobLinkSummarySchema` suma `note?: { text, createdAt }` y `comments?: { count, revision, sharedAt, latest }`. Los dos
son opcionales y solo los rellena el listado del grupo; la lista privada no los lleva (spec "Listado de links privados",
critic 14).

**Alternativas descartadas:** un endpoint aparte para el resumen (una petición más por página dentro del mismo módulo);
un `$lookup` dentro de la consulta paginada; `countDocuments` por link (N+1).

### D8 — Ciclo de vida: salir, volver, quitar el link y borrar el grupo

- **Salir o ser expulsado no escribe nada.** `authorLeft` se **deriva** en cada lectura: el autor no está en
  `memberIdsOf(groupId)`. No hacen falta hooks de salida ni de expulsión, que no existen.
- **Mientras no es miembro**, esa persona no lee ni borra sus comentarios. **Si vuelve**, la marca desaparece sola y
  puede borrarlos, porque siguen siendo suyos. Mientras está fuera, el propietario puede borrarlos (decisión humana 5).
  El borrado de cuenta lo hereda `deploy-prod` (manifiesto; tarea 7.5).
- **Quitar el link del grupo.** `RemoveGroupLink` comprueba los permisos y llama a
  `groupLinks.removeWithComments(groupId, linkId)` (D2), que borra relación, nota y comentarios en una transacción.
  Volver a compartir el link empieza con 0 comentarios y la revisión en 0. El SPA tiene su tarjeta quitada, así que no
  compara con la vieja.
- **Borrar el grupo.** `GroupLinksDeletionHook` llama a `groupLinks.deleteByGroup(groupId, session)`, que borra antes los
  comentarios, con la misma sesión de `groups`. Es la vía de ADR-021 §6 que ADR-024 (Consecuencias) reserva a lo que
  guarda `groupId`. No hace falta un hook nuevo. Si falla, se deshace todo.

**Alternativas descartadas:**
- borrar o anonimizar los comentarios de quien sale: contradice la decisión humana 4;
- conservar los comentarios de un link quitado: huérfanos que resucitan;
- un hook nuevo solo para comentarios: dos hooks del mismo módulo sin ganar nada.

### D9 — Aviso en vivo

**Recorrido.**
1. El caso de uso confirma la escritura.
2. Llama a `void COMMENTS_CHANGED_PUBLISHER.publish({ groupId, linkId, commentId, change })`.
   - El adaptador `RedisCommentsChangedPublisher` publica `GroupLinkCommentsChanged.v1` en `events:group-link.comments`
     con `REDIS_APP_CLIENT`.
   - Nunca lanza y deja un `warn` por racha, sin cuerpo.
3. Cada instancia de `api` lo recibe por `RedisCommentNotices`.
   - Comparte el cliente suscriptor del proceso.
   - Filtra por canal, valida con el schema estricto y descarta sin registrar contenido.
   - Pide su canal en cada `ready`.
4. `DeliverCommentsChanged` hace el reparto.
   - Si `EventStreamRegistry` no tiene conexiones, termina.
   - Si las tiene, lee `memberIdsOf([groupId])` y la relación. **Si la relación ya no existe, no envía nada**
     (critic 17).
   - Después lee los 2 últimos y los nombres, y envía `group-link.comments` a cada miembro **actual** con conexiones.

**Qué lleva cada tramo:**

| Tramo | Contenido | Por qué |
|-------|-----------|---------|
| Redis (`GroupLinkCommentsChanged.v1`) | `{ groupId, linkId, commentId, change: 'created' \| 'deleted' }` | El canal de Redis no sabe quién puede ver qué, sus mensajes se ven con `MONITOR` y cualquier suscriptor los recibe todos. La regla del canal, desde `LinkEnriched.v1`, es un aviso mínimo sin contenido de usuario. |
| SSE (`group-link.comments`) | `{ groupId, linkId, change, commentId, comments: { count, revision, sharedAt, latest } }` con texto, autor y `authorLeft` | Solo a miembros actuales de **ese** grupo, que ya pueden leerlo con un `GET` (`platform/realtime`: nada que no pueda ver ya). Sin el texto, cada comentario costaría un `GET` por miembro conectado. Es el mismo criterio que ADR-022 §7. |

**Solo miembros, y solo de ese grupo.** Los destinatarios salen de `memberIdsOf(groupId)`, no de quienes ven el link
(que son los de `link.enriched`). Con critic 14, "Cada quien recibe solo lo suyo" remite a este requisito más estricto.

**Carreras aceptadas por escrito** (critic 17):
- Quien sale del grupo entre la lectura de miembros y el envío puede recibir un último aviso. Es contenido que podía ver
  un instante antes.
- Un `authorLeft` puede ir con un instante de retraso.

La siguiente lectura lo corrige y no se escribe nada.

**Sin outbox.** ADR-009 existe para no perder trabajo encolado. Esto es un aviso de mejor esfuerzo sobre algo que ya está
en Mongo y que el SPA relee al recuperar el foco (mismo criterio que ADR-023 §5).

**Nombres.** Canal `events:group-link.comments`, tipo `GroupLinkCommentsChanged.v1` y evento SSE `group-link.comments`,
en `libs/shared/src/events/group-link-comments.event.ts`, con un test de contrato.

**Relación con ADR-024 §9.** El reparto "a los miembros actuales de un grupo" es el patrón reutilizable que ADR-024
esperaba; el aviso de estados compartidos sigue siendo decisión de `applications`.

**Alternativas descartadas:**
- texto en el mensaje de Redis;
- SSE solo con identificadores;
- `EventEmitter2` en el proceso;
- outbox;
- repartir a todo el que ve el link;
- esperar a que se publique el aviso antes de responder (critic 11).

### D10 — Contratos en `libs/shared`

Se fijan **antes** que backend y frontend (grupo 1):
- **`text/comment-text.ts`**: `normalizeCommentText`, `COMMENT_TEXT_MAX_LENGTH = 500` y `SHARE_NOTE_MAX_LENGTH = 280`.
- **`schemas/group-link-comment.schema.ts`**:
  - petición: `commentTextSchema`, `createCommentRequestSchema` y `listCommentsQuerySchema`;
  - respuesta: `groupLinkCommentSchema` (`id`, `author` con `linkSharerSchema`, `authorLeft`, `text`, `createdAt`),
    `commentsSummarySchema` (`count`, `revision`, `latest` de 0 a 2), `createCommentResponseSchema`
    (`{ comment, comments }`) y `commentPageSchema` (`items`, `total`, `nextCursor?`);
  - `commentsSummarySchema` lleva además `sharedAt`, y hay un `deleteCommentResponseSchema` (`{ comments }`, critic 3 de
    la iteración 2);
  - nota: `shareNoteSchema` (`text` y `createdAt`).
- **`schemas/link.schema.ts`**: `saveLinkRequestSchema` suma `note?`, que normaliza primero y después exige `groupId` si
  hay texto, nombrando `note`. `jobLinkSummarySchema` suma `note?` y `comments?`.
- **`events/group-link-comments.event.ts`**: canal, tipo, schema del evento interno, nombre SSE y schema del mensaje.
- **`apiErrorCodeSchema`** suma `comment_not_found` (404).

**Filtro HTTP.** Una rama nueva antes de la de `LinksError`: `InvalidLinkField` → `validation_error` nombrando su
`field`. Cubre `InvalidCommentText` (`text`) e `InvalidShareNote` (`note`), en el patrón de `InvalidApplicationField`.
Por la rama existente de `LinksError`:
- `CommentNotFound` → `404`;
- `CommentDeletionForbidden` y `NoteRemovalForbidden` → `forbidden` (`403`);
- `CommentsGroupNotFound` → `group_not_found` (`404`), con el mismo cuerpo que da `groups`.

### D11 — Frontend

- **Datos:**
  - `core/links/links.api.ts` gana `comments`, `postComment`, `deleteComment` y `removeNote`, y `note` en `save`.
  - `LinksStore`:
    - guarda `note` y `comments` en los items del grupo;
    - `applyCommentsChanged(message)` sustituye el resumen según la pareja (`sharedAt`, `revision`). Un `sharedAt`
      distinto gana siempre; con el mismo, solo si `revision` es mayor o igual que la que tiene (critic 4 de la
      iteración 1 y critic 2 de la iteración 2). La misma regla vale para el resumen de la respuesta de `postComment` y
      para el `200 { comments }` del borrado;
    - **toda sustitución** de una tarjeta (`replace`: `link.enriched`, editar el preview, pegar) conserva `note` y
      `comments` cuando el link nuevo no los trae (critic 1).
  - `EventsChannel` reparte `group-link.comments` por `groupLinkComments`, con una guarda de forma sin zod.
- **Tarjeta** (`LinkCard`, presentacional). Emite `openComments` y `removeNote`. Muestra:
  - "Nota de <nombre>";
  - los 2 últimos comentarios, el más antiguo arriba, con fecha relativa y "ya no está en el grupo" cuando toca;
  - la nota y cada comentario con `line-clamp: 2`, que corta a dos líneas (business 2);
  - la acción "Comentar" con 0, "Responder" con 1 o 2, y "Ver los N comentarios" con más (business 6 de la iteración
    1 y business 4 de la iteración 2);
  - "Quitar la nota" para quien compartió y para el propietario, con una confirmación distinta si la nota es ajena
    (business 5, iteración 2).
  Solo en el contexto de grupo.
- **Hilo** (`features/links/comments.dialog.ts`, `MatDialog`):
  - Por debajo de `sm` usa pantalla completa (`BreakpointObserver`, business 9). El compositor va en un pie fijo dentro
    del diálogo y se desplaza con el viewport visual, para que "Comentar" quede por encima del teclado.
  - Carga la primera página y ofrece "Ver comentarios anteriores"; pinta en orden cronológico con autoscroll al final.
  - `textarea` con `cdkTextareaAutosize`, contador `n/500`, Ctrl/Cmd+Enter y botón bloqueado en curso.
  - "Borrar" en lo propio y, para el propietario, en todo, con su confirmación.
  - En vivo:
    - lo nuevo que viene en `latest` se añade, deduplicado por `id`;
    - si no viene, aparece "Ver comentarios nuevos" (business 11);
    - lo borrado se quita.
  - Un `404` al abrir o al publicar (`group_not_found` o `link_not_found`) cierra con "Esta oferta ya no está en el
    grupo" y recarga.
- **Guardar con nota** (`save-link.form.ts`). El campo aparece solo con ámbito de grupo. Tras `already_there` con nota
  escrita, muestra el aviso y deja el texto en el campo (business 5).
- **Quitar un link.** La confirmación usa `comments.count` (spec `web/links`).
- **Textos** (ES fuente, EN en `messages.en.xlf`, plurales ICU):

| ES | EN |
|----|----|
| Nota de {nombre} | Note from {name} |
| Comentar / Responder / Ver los {n} comentarios | Comment / Reply / View all {n} comments |
| ya no está en el grupo | no longer in the group |
| Comentarios | Comments |
| Todavía nadie comentó esta oferta. Cuenta lo que sepas: requisitos, si ya cerró, a quién escribir. | No comments yet. Share what you know: requirements, whether it has closed, who to contact. |
| Escribe un comentario | Write a comment |
| Lo verán los miembros de este grupo y seguirá aquí aunque salgas. | Members of this group will see it, and it will stay here even if you leave. |
| Comentar | Post |
| Máximo 500 caracteres | 500 characters max |
| Ver comentarios anteriores | Show earlier comments |
| Ver comentarios nuevos | Show new comments |
| Borrar | Delete |
| ¿Borrar tu comentario? No se puede deshacer. | Delete your comment? This can't be undone. |
| ¿Borrar el comentario de {nombre}? Desaparecerá para todo el grupo y no se puede deshacer. | Delete {name}'s comment? It will disappear for the whole group and can't be undone. |
| Escribiste muchos comentarios seguidos. Vuelve a intentarlo en {n} minutos / más tarde | You've posted a lot of comments in a row. Try again in {n} minutes / later |
| No se pudo publicar el comentario. Inténtalo de nuevo. | Couldn't post the comment. Please try again. |
| Esta oferta ya no está en el grupo | This job is no longer in the group |
| Nota para el grupo (opcional) | Note for the group (optional) |
| Por ejemplo: esta es la que te dije | E.g. this is the one I told you about |
| Tu nota no se añadió porque la oferta ya estaba en el grupo. | Your note wasn't added because the job was already in the group. |
| Quitar la nota / ¿Quitar la nota? No se puede deshacer. | Remove note / Remove the note? This can't be undone. |
| ¿Quitar la nota de {nombre}? Desaparecerá para todo el grupo y no se puede deshacer. | Remove {name}'s note? It will disappear for the whole group and can't be undone. |
| hace un momento / hace {n} min / hace {n} h / ayer / {fecha} | just now / {n} min ago / {n} h ago / yesterday / {date} |
| Se quita de este grupo junto con su comentario / sus {n} comentarios; la oferta sigue disponible en otros grupos. | It will be removed from this group along with its comment / its {n} comments; the job stays available in other groups. |

### D12 — Pruebas

- **Dominio y casos de uso.** Unitarios con repositorios en memoria. `GroupLinkRepository` en memoria es dueño de los
  contadores, igual que en Mongo. Se prueban:
  - `normalizeCommentText` con una tabla;
  - las lecturas fijas de D7, contando llamadas;
  - `mayDelete` (autor, owner, otro);
  - `authorLeft` derivado;
  - el orden de D6: `consume` antes, `refund` ante cualquier error, `publish` después y sin esperar;
  - el reparto que no envía nada sin relación.
- **Integración.** `createApp` con `inject` sobre `mongodb-memory-server` en replica set. Cubre:
  - cada endpoint;
  - los dos tests deterministas de la carrera (alta primero y retirada primero) y la humo HTTP concurrente;
  - dos borrados concurrentes del mismo comentario (`200` y `404`, contador −1 y revisión +1);
  - el orden de comprobaciones del `DELETE` de la nota;
  - la retirada con el borrado de comentarios forzado a fallar;
  - el hook de borrado de grupo;
  - salir, ser expulsado y volver;
  - el `explain` del hilo y de la agregación;
  - el `429` y el contador caído;
  - que ningún log contenga el texto.
- **Tiempo real.** Unitarios de `DeliverCommentsChanged` e integración con Redis real de publicador y suscriptor,
  comprobando que el mensaje de Redis no lleva el texto.
- **Web.** TestBed con `HttpTestingController` para la API, el store (revisión, conservar en `replace`),
  `EventsChannel`, la tarjeta (`line-clamp` y rótulos), el diálogo (también en móvil), el formulario y las
  confirmaciones.
- **E2E Playwright** en `apps/web-e2e/src/comments.spec.ts`, con la franja `comments: 3` en `JOB_ID_SLOTS`.

## Risks / Trade-offs

- **Datos de terceros en comentarios** (el teléfono de un reclutador). Se acepta con las salvaguardas de D5. Si hace
  falta, la palanca es que el propietario lo borre, no reescribir el texto.
- **El propietario puede borrar lo que otros escribieron sin dejar rastro** (decisión humana 5). Es su grupo. La
  confirmación dice que desaparece para todos, y no hay historial que reconstruir.
- **Un miembro que se fue deja texto que no puede borrar hasta volver.** Lo pide la decisión humana 4. El propietario
  puede borrarlo, y el borrado de cuenta lo hereda `deploy-prod`.
- **`authorLeft` y los destinatarios pueden ir un instante atrasados** respecto a la pertenencia (D9, critic 17).
  Aceptado.
- **`authorLeft` cuesta una lectura de miembros por página y por aviso.** Son 50 miembros como máximo, con un índice por
  grupo.
- **La agregación `$topN` recorre los comentarios de los links de la página.** Si algún link pasa de unos miles, se
  cambia a un `$lookup` con `$limit: 2`, que sigue siendo una sola consulta.
- **`commentCount` puede desviarse** si alguien toca la base a mano. El RUNBOOK dice cómo recalcularlo. La revisión solo
  necesita crecer, así que no hace falta recalcularla.
- **Conflictos de escritura en la relación** cuando muchos comentan a la vez el mismo link. `withTransaction` los
  reintenta. El límite de D6 y los 50 miembros acotan el pico.
- **Aviso perdido** con Redis caído: la tarjeta se actualiza al volver a la pestaña o al reabrir el hilo.
- **Deuda heredada** (critic 16): `SaveLink`, `ImportLinks`, `ListGroupLinks` y `RemoveGroupLink` importan `GroupNotFound`
  del dominio de `groups`. Lo nuevo no lo hace. La corrección de esos cuatro queda para un change de mantenimiento; no
  cambia ningún comportamiento observable.
- **`links` crece.** La frontera para separarlo más adelante sería "relaciones de grupo" frente a "vacante canónica".

## Migration Plan

La colección `group_link_comments` es nueva y no tiene datos. Sus índices se construyen al arrancar `api` (`autoIndex`).

`group_links` gana `note?`, `commentCount` y `commentsRevision`:
- los documentos existentes se leen como "sin nota", 0 y 0, así que **no hay backfill**;
- el primer `$inc` crea los campos;
- ningún índice de `group_links` cambia.

Para volver atrás basta con desplegar la versión anterior: ignora los campos nuevos y la colección, que puede borrarse a
mano (RUNBOOK).

## Open Questions

- **Borrar lo propio sin volver al grupo.** Quien salió o fue expulsado no puede borrar sus comentarios sin volver a
  entrar. Con la decisión humana 5, el propietario sí puede hacerlo por él.
  - **Recomendación:** no añadir nada aquí. El borrado de cuenta de `deploy-prod` cubre el caso extremo (manifiesto; tarea 7.5).
- **Borrado de cuenta: ¿borrar o anonimizar los comentarios?**
  - **Recomendación:** que lo decida `deploy-prod` con su aviso de privacidad. La herencia queda escrita en el
    manifiesto con las dos opciones.

La Open Question de moderación queda **cerrada** por la decisión humana 5.

## Debate (iteración 1)

Critic: 0 P0. Business: 3 V0. Tras aplicar esta tabla no queda ningún P0/V0 abierto.

| # | Hallazgo | Decisión | Motivo |
|---|----------|----------|--------|
| business 1 | La atribución "ADR-015 dice solo borrar propio" era falsa, y el propietario no tenía cómo moderar | Aceptado con la decisión humana 5: el owner borra comentarios y notas ajenos, sin marca y nunca edita; ADR-026 enmienda design-v0.2 §5.4 y corrige la atribución (D4) | La regla era de design-v0.2 §5.4; limpiar el grupo no debe exigir quitar la oferta |
| business 2 (V0) | Comentarios y notas largos desbordaban la tarjeta | Aceptado: `line-clamp` de 2 líneas y texto completo en el hilo (D11) | La tarjeta es un resumen |
| business 3 (V0) | Nadie heredaba qué pasa con los comentarios al borrar la cuenta | Aceptado: herencia en el `scope` de `deploy-prod` (= critic 5); desde la iteración 2 ya escrita y verificada en la tarea 7.5 | Datos personales sin dueño en el plan |
| business 4 | Editar la nota abría una segunda superficie sin demanda | Aceptado: sin `PATCH` ni `UpdateShareNote`; solo `DELETE …/note` para quien compartió o el owner (D3) | La nota es lo que se dijo al compartir |
| business 5 | "Publicarla como comentario" publicaba sin releer | Aceptado: solo el aviso, con el texto en el campo (D3, D11); cierra critic 12b | Que la persona decida |
| business 6 | "Comentar" / "Ver el comentario" confundía cuando la tarjeta ya los mostraba | Aceptado: "Responder" con 2 o menos, "Ver los N comentarios" con más | Rótulo según lo que falta por ver |
| business 7 | La indicación no decía que el comentario sobrevive a la salida | Aceptado: "Lo verán los miembros de este grupo y seguirá aquí aunque salgas." | Consentimiento informado (decisión humana 4) |
| business 8 | Ordenar el grupo por actividad | Diferido: Non-Goals, con `lastCommentAt` como camino | Cambia el listado paginado y su índice |
| business 9 | El diálogo era incómodo en el móvil | Aceptado: pantalla completa por debajo de `sm`, botón por encima del teclado (D11) | El uso principal es desde el móvil |
| business 10, 12, 13 | — | Sin cambios | — |
| business 11 | "Hay comentarios nuevos" no decía qué hacer | Aceptado: "Ver comentarios nuevos" | Un botón nombra su acción |
| critic 1 | `replace` en el store borraba nota y comentarios al corregir el preview o pegar | Aceptado: toda sustitución conserva `note` y `comments` si no vienen; escenario "Corregir el preview no borra los comentarios" | No solo `link.enriched` sustituye tarjetas |
| critic 2 | Dos repositorios escribían los contadores y abrían transacciones | Aceptado: `GroupLinkRepository` único dueño, con `addComment`, `removeComment` y `removeWithComments`; el de comentarios recibe la sesión (D2, D8) | Un invariante, un dueño |
| critic 3 | La carrera solo se probaba con HTTP concurrente, no determinista | Aceptado: test de repositorio con `WriteConflict` forzado; la HTTP queda como humo (D2, tarea 2.10) | Un test que puede no reproducir la carrera no la prueba |
| critic 4 | Un aviso atrasado podía pisar un resumen más nuevo | Aceptado: `commentsRevision` con `$inc` en cada alta y borrado; el SPA descarta revisiones menores (D2, D11) | `count` no ordena los cambios |
| critic 5 | Herencia a `deploy-prod` y ADRs del manifiesto | Aceptado: herencia en el manifiesto (tarea 7.5) y `adrs: [015, 026]` | Trazabilidad |
| critic 6 | Moderación sin resolver | Resuelto por la decisión humana 5 | — |
| critic 7 | Tareas de más de 1 h (2.6, 3.5, 4.4, 5.2, 6.4, 6.8, 7.1) | Aceptado: partidas | Tareas verificables en menos de una hora |
| critic 8 | El puerto del publicador llegaba tarde a las tareas | Aceptado: puerto y doble en la 2.3 | Los casos de uso del grupo 3 lo necesitan |
| critic 9 | `deleteByLink` borraba relaciones sin sus comentarios | Aceptado: sale del puerto, porque nada de producción lo usa (D2) | Puerta trasera al invariante |
| critic 10 | El orden de límite, transacción y aviso no estaba fijado; un `404` en carrera gastaba intento | Aceptado: `consume` antes y `publish` después, fuera del callback; `refund` ante cualquier error; escenario "Carrera que termina en 404 no gasta" (D6) | Un reintento por `WriteConflict` contaría dos veces |
| critic 11 | Esperar al aviso retrasaba la respuesta | Aceptado: `void publish` (D6, D9) | La respuesta no depende de Redis |
| critic 12a | Una nota vacía sin grupo daba `400` | Aceptado: se normaliza primero y da `201` | "Vacía" es "no enviada" |
| critic 12b | "Publicarla como comentario" duplicaba lógica | Cerrado por business 5 | — |
| critic 13 | `InvalidShareNote` no nombraba su campo | Aceptado: base `InvalidLinkField` con `field` y una rama en el filtro (D10) | El SPA marca el campo |
| critic 14 | La lista privada y la regla general de destinatarios no decían nada de los comentarios | Aceptado: MODIFIED "Listado de links privados" y "Cada quien recibe solo lo suyo" | Specs coherentes entre sí |
| critic 15 | El renombrado `comment` → `note` no estaba registrado | Aceptado: "Se aparta de: docs/design.md" en ADR-026 | Un ADR gana a design.md |
| critic 16 | Casos de uso de `links` que importan `GroupNotFound` de `groups` | Aceptado: error propio `CommentsGroupNotFound`; los cuatro existentes quedan como deuda anotada (D1, Risks) | Límites entre módulos |
| critic 17 | El reparto podía avisar de un link ya quitado; la carrera de pertenencia no estaba escrita | Aceptado: sin relación no se envía nada, con test; la carrera de pertenencia se acepta por escrito (D9) | Aviso fiel al estado |

## Debate (iteración 2)

Convergió con 0 P0 y 0 V0. Solo retoques.

| # | Hallazgo | Decisión | Motivo |
|---|----------|----------|--------|
| critic 1 | Un solo test determinista cubría un orden de la carrera; no había forma de detener el alta a mitad | Aceptado: dos tests (alta primero → 0 comentarios y el alta devuelve el comentario; retirada primero → `null` y 0 comentarios) con un punto de espera solo de tests entre el `$inc` y el `insert` (D2, tareas 2.10 y 2.11); escenario "Quitar mientras se comenta" | Los dos órdenes tienen resultados distintos |
| critic 2 | Al volver a compartir un link, la revisión vuelve a 0 y el SPA descartaría todo como viejo | Aceptado: `sharedAt` viaja en `comments` y el SPA compara (`sharedAt`, `revision`); "nunca retrocede mientras dure la relación"; escenario "Volver a compartir no congela la tarjeta" (D2, D11) | La revisión es de la relación, no del link |
| critic 3 | El `204` del borrado obligaba al SPA a adivinar el resumen | Opción a): `200 { comments }`, como el `POST` (spec, D6, D10, D11, tarea 6.4) | Una sola forma de actualizar la tarjeta |
| critic 4 | Un `null` de `removeComment` no tenía respuesta fijada, ni prueba de dos borrados a la vez | Aceptado: `null` → `404 comment_not_found` sin `publish`; integración de dos borrados concurrentes (tarea 5.9); ventana del rol aceptada por escrito (D6) | Un borrado que no ocurrió no avisa |
| critic 5 | El orden de comprobaciones del `DELETE` de la nota no estaba fijado | Aceptado: pertenencia → relación → permiso → `$unset`, con `link_not_found` si la relación desaparece; escenarios "Quitar una nota que ya no está" y "Sin permiso aunque no haya nota" (D3, tarea 5.5) | No revelar si había nota a quien no puede quitarla |
| critic 6 | `note.updatedAt` sugería edición | Aceptado: `note.createdAt` | La nota no se edita |
| critic 7 | El reparto SSE no tenía puerto propio | Aceptado: `COMMENTS_BROADCASTER` y su doble en la 2.3 | Casos de uso sin infraestructura |
| critic 8 | La 5.7 y la 7.3 pasaban de 1 h | Aceptado: la humo concurrente sale a la 5.8; la 7.3 se parte en 7.3 y 7.4 | Tareas de menos de una hora |
| business 3 | La herencia a `deploy-prod` quedaba para más tarde | Aceptado: escrita ya en el manifiesto; la tarea 7.5 solo verifica que está | Que no dependa de acordarse |
| business 4 | "Responder" sin ningún comentario no tenía sentido | Aceptado: "Comentar" con 0, "Responder" con 1 o 2, "Ver los N comentarios" con más; recuperado "Tarjeta sin comentarios" | No se responde a nadie |
| business 5 | Quitar una nota ajena no decía que desaparece para todos | Aceptado: "¿Quitar la nota de {nombre}? Desaparecerá para todo el grupo y no se puede deshacer." | Igual que el borrado de un comentario ajeno |
| business 6 y 7 | — | Sin cambios | — |

## Decisiones de implementación

Decisiones tomadas al implementar que el diseño no fijaba. Se eligió lo más conservador y coherente con D1–D12.

| # | Tarea | Decisión | Motivo |
|---|-------|----------|--------|
| I1 | 1.2 | `normalizeCommentText` quita también el tabulador (es C0) y DEL (U+007F, categoría `Cc` como C0 y C1). | D5 dice "C0 y C1 salvo `\n`"; DEL tampoco se ve. |
| I2 | 1.3, 1.5 | Cotas de cordura antes de normalizar: 5000 caracteres para un comentario y 2800 para una nota (diez veces el límite). | Mismo patrón que la URL y el texto importado: no recorrer cadenas arbitrarias. |
| I3 | 1.4 | `linkSharerSchema` pasa a `schemas/link-sharer.schema.ts` y `link.schema.ts` lo reexporta. | Los contratos de comentarios lo usan y `link.schema.ts` usa el resumen de comentarios: sin moverlo habría un import circular. |
| I4 | 1.5 | `saveLinkRequestSchema` sigue siendo un `z.object` (el SPA usa `.shape.url`): una nota vacía tras normalizar sale como `note: undefined`, y la regla "con texto exige `groupId`" es un `superRefine` que nombra `note`. | Equivale a "no enviada" sin romper al SPA. |
| I5 | 1.7 | Al añadir `comment_not_found` se corrigen dos comentarios de `auth.schema.ts` que `applications-tracking` dejó en Latin-1 (el archivo pasa a ser UTF-8 entero). | Un archivo con dos codificaciones no se puede editar sin romperlo. |
| I6 | 2.3 | `GroupLinkRepository.remove` también sale del puerto, sustituido por `removeWithComments` (misma respuesta `boolean`). `RemoveGroupLink` pasa a usarlo ya en el grupo 2. | Igual que `deleteByLink` (critic 9): dejarlo sería una puerta para quitar una relación sin sus comentarios. |
| I7 | 2.3 | Puerto `COMMENT_NOTICES` (gemelo de `ENRICHMENT_NOTICES`) para que la suscripción dependa de un puerto y no del adaptador de Redis. | Mismo patrón que el aviso de enriquecimiento. |
| I8 | 2.3, 2.8 | `ListedLink` gana `inGroup?: { note?, commentCount, commentsRevision }`, que solo rellena el listado de un grupo. | La lista privada no tiene nota ni comentarios (critic 14). |
| I9 | 2.7 | El alta hace el `$inc` con `findOneAndUpdate` (`returnDocument: 'after'`) en vez de `updateOne` + `matchedCount`: un solo comando da a la vez "la relación no existe" (`null`) y los contadores con `sharedAt`. | Una lectura menos dentro de la transacción; el comportamiento es el de D2. |
| I10 | 2.10, 2.11 | Los tests de la carrera esperan al `WriteConflict` de la otra transacción en los eventos de comando del driver (`monitorCommands`) antes de soltar el alta. En b) la retirada sin confirmar se hace a mano con una sesión, porque el punto de espera solo existe en el alta. | Deterministas sin `setTimeout`. |
