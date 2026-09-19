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
- **Fachadas.** `LinksFacade` y `GroupsFacade` (`membershipOf`, `memberIdsOf`) son las entradas públicas de sus módulos.
- **SPA.** `LinksStore.applyEnriched` **sustituye** la tarjeta entera con lo que trae `link.enriched`.

design-v0.2 §5.4 y ADR-015 fijan el alcance: `POST /groups/:g/links/:l/comments {text}`, la tarjeta con los 2 últimos y
el contador, sin hilos, sin reacciones y sin edición (solo borrar lo propio). docs/design.md no describe ninguna colección
`group_link_comments`; la define este change (D2).

Motivación y alcance: proposal.md; comportamiento: las specs; decisiones no triviales: **ADR-026**.

### Decisiones humanas previas (2026-09-19)

1. **`settings.defaultVisibility` sale de este change** y pasa a `public-preview-share`. Allí significa "los links de
   este grupo se comparten públicamente por defecto: sí/no" (design-v0.2 §5.5). `openspec-changes.yaml` lo refleja.
2. **De los campos heredados de `group_links` solo entra `comment`**: la nota que quien comparte escribe al compartir
   ("esta es la que te dije"), visible en la tarjeta. `tags` y `pinned` quedan fuera (Non-Goals).
3. **Los comentarios nuevos y los borrados aparecen en vivo** en las pantallas abiertas del grupo, por el canal de
   Redis/SSE que ya existe. La tarjeta actualiza el contador y los 2 últimos sin recargar. El aviso no lleva el texto si
   eso choca con una regla de privacidad del canal. Lo decide D9: el texto no viaja por Redis, pero sí en el mensaje SSE
   a los miembros actuales.
4. **Al salir o ser expulsado, los comentarios se quedan** con el nombre del autor y la marca "ya no está en el grupo".
   Qué puede hacer esa persona si vuelve y qué pasa al borrar el grupo: D8.

## Goals / Non-Goals

**Goals:**
- Que el contexto que hoy viaja en el chat ("piden C1", "ya cerró") quede pegado a la oferta, en el grupo donde se dijo.
- Que la tarjeta lo enseñe sin pedir nada más: la nota, los 2 últimos comentarios y el contador, con lecturas fijas por
  página.
- Que una conversación activa se vea en vivo, sin que el texto de nadie pase por Redis ni por los logs.
- Que ningún comentario quede huérfano: vive y muere con la relación link-grupo, también en las carreras.
- Que salir de un grupo no borre lo que otros ya leyeron y respondieron.

**Non-Goals:**
- `tags` y `pinned` de `group_links` (decisión humana 2): se añadirán cuando un uso los pida.
- `settings.defaultVisibility` (decisión humana 1): lo decide `public-preview-share`.
- Hilos, respuestas, reacciones, menciones y edición de comentarios (ADR-015).
- Moderación por el propietario (Open Questions).
- Notificaciones fuera de la pantalla abierta, como correo, push o un contador de "no leídos".
- Enlaces clicables, Markdown o vista previa de URLs dentro de un comentario.
- Aviso en vivo de un cambio de nota o de un link nuevo en el grupo. Hoy tampoco se avisa al compartir un link, y la
  nota se escribe justo en ese momento.
- La marca "ya no está en el grupo" sobre quien **compartió** un link (`sharedBy`). Solo la llevan los autores de
  comentarios (decisión humana 4). Extenderla cambia `linkSharerSchema`, que usan otras vistas.
- Mostrar comentarios o notas en la página pública `/p/:slug`. Ahí no deben aparecer nunca (D5, riesgo).
- Borrar comentarios al borrar la cuenta (Open Questions; lo hereda `deploy-prod`).

## Decisions

### D1 — Los comentarios viven dentro de `links`

Opciones, con la votación del debate y el desempate de arquitectura:

| Opción | A favor | En contra |
|--------|---------|-----------|
| **A. Dentro de `links`**, junto a `group_links` | Un comentario cuelga de un `GroupLink`, que es de `links` (ADR-002: "`GroupLink` como relación con metadatos (quién compartió, comentario)"). Quitar el link del grupo y borrar sus comentarios cabe en **una transacción** del mismo módulo. El hook de borrado de grupo ya existe y solo se amplía. El resumen de la tarjeta entra en `GET /api/groups/:id/links` sin otra petición. Se reutilizan el suscriptor de Redis, el reparto SSE y el limitador ya cableados. CLAUDE.md no lista `comments` entre los contextos. | `links` crece: ya es el módulo más grande. |
| B. Módulo nuevo `comments` | Módulo pequeño y enfocado. | Necesita que `links` le avise al quitar un link: o `links` depende de `comments` (lo inverso a la dirección natural), o un segundo registro de hooks en `links`, o comentarios huérfanos ocultos por derivación que reaparecen al volver a compartir. Pide una segunda petición por página para el resumen, o que `links` lo importe. Duplica el cableado del canal en vivo. |
| C. Dentro de `groups` | Pertenencia a mano. | `groups` pasaría a conocer links: invierte la dependencia `links` → `groups` que fija ADR-021 §6. |

Votación: consistencia transaccional → A; tiempo hasta el valor → A; tamaño de módulo → B. **Gana A**, 2 a 1. El
desempate de arquitectura confirma A. Un bounded context se define por su lenguaje y sus invariantes, no por el número de
archivos. El invariante aquí es "un comentario existe solo mientras su relación existe", y solo se protege sin
dependencias cruzadas si relación y comentario comparten módulo.

Estructura dentro de `links` (clean architecture, puertos por token):
- `domain/`: `group-link-comment.ts` (texto normalizado, autoría, `authorLeft` derivado), `share-note.ts`, límites
  nuevos en `limits.ts`, y errores `CommentNotFound`, `CommentDeletionForbidden`, `InvalidCommentText` e
  `InvalidShareNote`. Sin `@nestjs/*` ni `mongoose` (lint existente).
- `application/`:
  - el puerto `GROUP_LINK_COMMENT_REPOSITORY` y el puerto de aviso `COMMENTS_CHANGED_PUBLISHER`;
  - los casos de uso `PostGroupLinkComment`, `DeleteGroupLinkComment`, `ListGroupLinkComments`, `UpdateShareNote` y
    `DeliverCommentsChanged`;
  - cambian `ListGroupLinks`, `SaveLink` y `RemoveGroupLink`;
  - `testing/` con el repositorio en memoria.
- `infrastructure/`: `group-link-comment.schemas.ts`, `mongo-group-link-comment.repository.ts`,
  `redis-comments-changed-publisher.ts` y `redis-comment-notices.ts`. `GroupLinksDeletionHook` se amplía.
- `presentation/`: `group-link-comments.controller.ts` bajo `groups/:id/links/:linkId/comments`, más la ruta de la nota
  en `GroupLinksController`.

Entre módulos, solo lo que ya existe: `GroupsFacade` detrás de `GROUP_MEMBERSHIP` y `UsersFacade` detrás de
`LINK_USER_DIRECTORY`. `LinksFacade` no cambia: ningún otro módulo necesita los comentarios.

### D2 — Modelo y consistencia con la relación

**`group_link_comments`**: `{ _id, groupId, linkId, authorId, text, createdAt }`, con `bufferCommands: false` y
`strict`. Índice `{ groupId: 1, linkId: 1, createdAt: -1, _id: -1 }`. Sirve al hilo paginado, al resumen, al borrado por
relación (`groupId`, `linkId`) y al borrado por grupo, porque su prefijo es `groupId`. No hay índice por `authorId`
mientras nada busque por autor.

**`group_links`** suma dos campos y **no toca ningún índice**:
- `note?: { text, updatedAt }`. En docs/design.md se llama `comment`. Se renombra para que "comentario" signifique una
  sola cosa en la API, en la UI y en el código.
- `commentCount: number`. Si falta, se lee como 0.

**Por qué `commentCount` en la relación.** No es solo por rendimiento. Escribir comentario y contador en la **misma
transacción** convierte la carrera "comentar mientras se quita el link" en un conflicto de escritura sobre el documento
de la relación:
- **Alta.** `updateOne({ groupId, linkId }, { $inc: { commentCount: 1 } })` e `insertOne` del comentario, en una
  transacción. Si `matchedCount === 0`, el link ya no está: se aborta y se responde `404 link_not_found`.
- **Borrado.** `deleteOne({ _id, groupId, linkId, authorId })` y, solo si `deletedCount === 1`, `$inc: -1`, en una
  transacción.
- **Quitar el link.** `deleteOne` de la relación y `deleteMany({ groupId, linkId })` de los comentarios, en una
  transacción.

Como el alta y la retirada escriben el mismo documento, Mongo aborta una de las dos con `WriteConflict` y el driver la
reintenta (`withTransaction`). Al reintentarse ve el estado final, así que nunca queda un comentario sin relación. Sin el
`$inc`, las dos transacciones no chocarían y el comentario huérfano **reaparecería** al volver a compartir el link.
Contar con `countDocuments` en cada lectura da el mismo número, pero no cierra la carrera.

**Alternativas descartadas:** comentarios embebidos en `group_links` (documento sin techo y con conflictos de escritura
entre comentaristas); `countDocuments` en cada listado (una consulta más por página y la carrera abierta); derivar la
visibilidad y dejar huérfanos (reaparecen al volver a compartir).

### D3 — La nota de quien comparte

- **Quién y cuándo.** Solo quien crea la relación, al compartir con `POST /api/links { url, groupId, note? }`. Si la
  relación ya existía (`already_there`), la nota enviada se descarta sin error y la del primero no cambia: la nota es
  parte del acto de compartir, y ese acto fue del primero. El SPA ofrece "Publicarla como comentario" (D11), así nada de
  lo escrito se pierde sin que la persona lo decida.
- **Importar no admite nota.** Una sola nota para 50 links de un chat no diría nada de cada uno, y el chat mismo no se
  guarda (spec `links/sharing`). `importLinksRequestSchema` no gana el campo. Como es `z.object`, un `note` enviado se
  ignora.
- **Sin grupo, `400`.** En la lista privada no hay nadie a quien dirigirla. El refinamiento zod nombra `note`.
- **Editar o quitar.** `PATCH /api/groups/:id/links/:linkId/note { text: string | null }`, solo para `sharedBy`. El
  `owner` recibe `403`, igual que para los comentarios (D4): puede quitar el link entero, que es la moderación que ya
  existe.
- **Por qué la nota se edita y un comentario no.** La nota es un atributo de la relación, única por link y grupo, como
  el título de lo que se comparte. Un comentario es una intervención en una conversación: otros responden a él, y
  editarlo cambiaría lo que respondieron (ADR-015). La nota no guarda historial.
- **Longitud y texto.** Hasta 280 code points tras la misma normalización que los comentarios (D5). Es una línea de
  tarjeta, no un párrafo.
- **Diferencias con un comentario:** una por relación frente a muchas; se edita frente a solo se borra; va arriba en la
  tarjeta y no entra en el contador ni en el hilo; no cuenta para el límite; no se avisa en vivo; se borra con la
  relación.

**Alternativas descartadas:** la nota como primer comentario (un comentario no se edita, y los 2 últimos la sacarían de
la tarjeta); una nota por cada persona que comparte (la tarjeta se llenaría de notas; para eso están los comentarios);
dejar que un segundo que comparte sobrescriba la nota (pisaría en silencio lo que escribió otro).

### D4 — Permisos

| Acción | Quién | Si no |
|--------|-------|-------|
| Leer el hilo y el resumen | miembro **actual** del grupo | `404 group_not_found` |
| Comentar | miembro actual, con el link compartido **ahora** en el grupo | `404 group_not_found` / `404 link_not_found` |
| Borrar un comentario | su autor, siendo miembro actual | `403 forbidden` para otro miembro, **también el owner**; `404 comment_not_found` si no existe o es de otro link o grupo |
| Editar un comentario | nadie (no hay ruta) | `404` |
| Cambiar o quitar la nota | quien compartió el link, siendo miembro | `403 forbidden` |

- **Ver el link no basta para leer sus comentarios.** Quien lo tiene en su lista privada o en otro grupo no ve los
  comentarios de este. Los comentarios son contexto **del grupo**, y cada grupo tiene su hilo (spec "Cada grupo tiene su
  hilo").
- **`403` y no `404` al borrar lo ajeno.** Quien pide ya ve ese comentario en el hilo, así que no hay nada que ocultarle.
  Es el mismo criterio que `LinkRemovalForbidden`.
- **Moderación por el propietario.** Se descarta en este change: ADR-015 dice "solo borrar propio" y el owner ya puede
  quitar el link entero, lo que se lleva sus comentarios. Queda en Open Questions con recomendación.

**Alternativas descartadas:** leer con el permiso de lectura del link (`canRead`), que mezclaría las conversaciones de
grupos distintos; que el owner borre lo ajeno (no lo contempla ADR-015).

### D5 — Texto: normalizar sí, reescribir no

La función pura `normalizeCommentText` vive en `libs/shared/src/text/` y la usan el schema zod y el dominio. Hace:
1. `\r\n` y `\r` → `\n`;
2. quita los C0 y C1 salvo `\n`, y los de dirección U+202A–U+202E y U+2066–U+2069, que permiten falsear el orden visual;
3. `trim`.

Después se mide en code points, como zod 4 y `links/domain/limits.ts`: de 1 a 500 para un comentario y de 1 a 280 para
una nota. Una nota vacía equivale a "sin nota". El dominio vuelve a validar (`InvalidCommentText`, `InvalidShareNote`)
como defensa en profundidad, y el filtro los traduce a `400 validation_error` nombrando el campo.

**Emails y teléfonos: se respetan, no se pasa `scrubContactDetails`.** `paste-job-description` limpia el texto pegado por
tres motivos: va a una IA, es texto de un tercero que nadie eligió publicar, y no se guarda. Un comentario no cumple
ninguno: no va a la IA, lo escribe el miembro para su grupo sabiendo quién lo lee (la indicación del cuadro lo dice) y
se guarda para que el grupo lo lea. Borrar en silencio el teléfono de "escríbele a Juan al…" rompería el mensaje sin
avisar. Lo que protege al tercero es que el texto:
- solo lo leen los miembros actuales;
- nunca va a los logs ni a Redis (D9);
- nunca sale en la página pública;
- lo puede borrar su autor.

El riesgo queda escrito en Risks y en ADR-026.

**HTML: ni se sanea ni se rechaza.** Todo es texto plano. La API guarda y devuelve lo que llega, y el SPA lo pinta con
interpolación de Angular, que escapa, nunca con `[innerHTML]` y con `white-space: pre-line`. Sanear en el servidor
cambiaría lo que alguien escribió ("usa <T> en genéricos"). Rechazarlo castigaría un texto legítimo. La defensa
correcta está en el sitio que interpreta, y aquí nadie interpreta.

**Alternativas descartadas:** `scrubContactDetails` en el alta; aviso cuando se detecta un teléfono (fricción sin
protección real); sanear o rechazar etiquetas; Markdown.

### D6 — Límite por persona

`LINK_LIMITER` gana la clave `{ kind: 'comment', userId }`, con contador `links:comment:<userId>`,
`COMMENTS_PER_USER = 30` y la ventana de siempre, `LINK_LIMIT_WINDOW_MS` (15 min).
- **Falla abierto**, como la importación. Con el contador caído, lo que se permite de más es escribir en nuestra base y
  repartir a 50 conexiones como mucho; negarle a alguien el comentario por un Redis lento sería peor.
- **Se cuenta después de validar el cuerpo, la pertenencia y el link, y antes de escribir.** Un `400` o un `404` no
  gastan intento. Si la transacción falla después de contar, el intento se devuelve con `refund`.
- `TooManyLinkAttempts` ya tiene su rama en el filtro, con `Retry-After`.
- Borrar no cuenta: no produce contenido.

30 cada 15 minutos da para una conversación viva (2 por minuto sostenidos) y corta un bucle o un script.

**Alternativas descartadas:** límite por grupo o por link (un script cambia de destino); fallar cerrado (bloquearía la
conversación por un problema de infraestructura); ningún límite (el canal en vivo multiplica cada comentario por los
miembros conectados).

### D7 — Lecturas: el hilo y el resumen de la tarjeta sin N+1

**Hilo.** `GET /api/groups/:id/links/:linkId/comments?limit&cursor` lee por el índice de D2, ordenado por `createdAt`
y `_id` descendentes. El cursor opaco reutiliza el codificador de `link-cursor.ts`: `(fecha, _id)` y rechazo de uno
manipulado con `400` nombrando `cursor`. `total` sale de `commentCount`. Lecturas fijas por página:
1. `memberIdsOf([groupId])`, que dice si quien pide es miembro y da `authorLeft` para toda la página;
2. la relación (`find`), que da el 404 del link y `commentCount`;
3. la página de comentarios;
4. `displayNamesOf(autores)`.

**Resumen en `GET /api/groups/:id/links`.** `ListGroupLinks` pasa de 4 a 5 lecturas fijas por página:
1. `memberIdsOf([groupId])`, que sustituye a `membershipOf`;
2. la página de relaciones (`listByGroup`, que ya proyecta `note` y `commentCount`);
3. `countByGroup`;
4. **una** agregación sobre `group_link_comments`: `$match { groupId, linkId: { $in: ids de la página } }`, y
   `$group` por `linkId` con `$topN` (n = 2, `sortBy { createdAt: -1, _id: -1 }`), disponible desde Mongo 5.2 (el
   proyecto usa 7.0);
5. `displayNamesOf`, con quienes compartieron, quienes editaron el preview y los autores de los comentarios, en una
   sola llamada.

**Cómo se comprueba.** Un test unitario de `ListGroupLinks` cuenta las llamadas a los dobles de sus puertos con páginas
de 2 y de 20 links y distinto número de comentarios, y exige las mismas: una por puerto. El patrón es el de D6 de
`applications-tracking`. La integración de la agregación comprueba con `explain` que usa el índice de D2.

**Forma.** `jobLinkSummarySchema` suma `note?: { text, updatedAt }` y `comments?: { count, latest }`. Los dos son
opcionales y solo los rellena el listado del grupo; la lista privada y `link.enriched` no los llevan.

**Alternativas descartadas:** un endpoint aparte `GET /api/groups/:id/comments?linkIds=` (una petición más por página,
justificable entre módulos como en `applications`, no dentro del mismo); `$lookup` por link desde `group_links` dentro
de la consulta de página (acopla la consulta paginada a los comentarios y complica su `explain`); un contador
`countDocuments` por link (N+1).

### D8 — Ciclo de vida: salir, volver, quitar el link y borrar el grupo

- **Salir o ser expulsado no escribe nada.** `authorLeft` se **deriva** en cada lectura: el autor no está en
  `memberIdsOf(groupId)`. El nombre sale de `users` como siempre. Es la misma idea que la visibilidad derivada de
  ADR-024 §6, aplicada a una marca y no a la visibilidad. No hacen falta hooks de salida ni de expulsión, que no
  existen.
- **Mientras no es miembro**, esa persona no lee ni borra sus comentarios: todas las rutas exigen pertenencia actual.
  **Si vuelve**, la marca desaparece sola y puede borrarlos, porque siguen siendo suyos (`authorId`). Borrarlos sin
  volver a entrar queda en Open Questions.
- **Quitar el link del grupo** (`RemoveGroupLink`) pasa a hacerse en una transacción: relación, nota y comentarios.
  Hoy son dos llamadas sueltas (`find` y `remove`). El puerto gana `removeWithComments(groupId, linkId)`, o `remove` con
  sesión más `deleteByRelation` del repositorio de comentarios dentro de la misma sesión. Lo decide la implementación
  con el test "Todo o nada". Volver a compartir el link empieza con 0 comentarios.
- **Borrar el grupo.** `GroupLinksDeletionHook.deleteRelationsOf` borra también `group_link_comments` por `groupId`,
  **antes** que las relaciones, con la misma sesión. Es la vía de ADR-021 §6 que ADR-024 (Consecuencias) reserva a lo
  que guarda `groupId`. No hace falta registrar un hook nuevo: el de `links` ya corre dentro de la transacción de
  `groups`. Si falla, se deshace todo.

**Alternativas descartadas:**
- borrar los comentarios de quien sale: rompe la conversación que otros ya respondieron y contradice la decisión humana
  4;
- anonimizarlos al salir: escribe en otro módulo desde la salida, y la decisión humana pide conservar el nombre;
- conservar los comentarios de un link quitado y mostrarlos si vuelve: datos invisibles con resurrección sorpresa (D2);
- un hook nuevo en `GroupDeletionHooks` solo para comentarios: dos hooks del mismo módulo, sin ganar nada.

### D9 — Aviso en vivo

**Recorrido.**
1. El caso de uso confirma la transacción.
2. Llama a `COMMENTS_CHANGED_PUBLISHER.publish({ groupId, linkId, commentId, change })`.
   - El adaptador `RedisCommentsChangedPublisher` publica `GroupLinkCommentsChanged.v1` en `events:group-link.comments`
     con `REDIS_APP_CLIENT`.
   - Sigue el patrón de `RedisLinkEnrichedPublisher`: nunca lanza y deja un `warn` por racha, sin cuerpo.
3. Cada instancia de `api` lo recibe por `RedisCommentNotices`.
   - Comparte el cliente suscriptor del proceso: un cliente en modo suscripción admite varios canales.
   - Filtra por canal, valida con el schema estricto y descarta sin registrar contenido.
   - Pide su canal en cada `ready`, como `RedisEnrichmentNotices`.
4. `DeliverCommentsChanged` hace el reparto.
   - Si `EventStreamRegistry` no tiene conexiones, termina.
   - Si las tiene, lee una vez `memberIdsOf([groupId])`, la relación (`commentCount`), los 2 últimos y los nombres.
   - Envía el evento SSE `group-link.comments` a cada miembro **actual** con conexiones.

**Qué lleva cada tramo:**

| Tramo | Contenido | Por qué |
|-------|-----------|---------|
| Redis (`GroupLinkCommentsChanged.v1`) | `{ groupId, linkId, commentId, change: 'created' \| 'deleted' }` | El canal de Redis no sabe quién puede ver qué. Sus mensajes se ven con `MONITOR`, se pueden replicar y cualquier suscriptor los recibe todos. La regla del canal, desde `LinkEnriched.v1`, es un aviso mínimo sin contenido de usuario. Tampoco lleva el autor. |
| SSE (`group-link.comments`) | `{ groupId, linkId, change, commentId, comments: { count, latest } }` con texto, autor y `authorLeft` | Llega solo a miembros actuales de **ese** grupo, que ya pueden leer ese texto con un `GET`. Cumple "no lleva nada que esa persona no pueda ver ya" de `platform/realtime`. Sin el texto, cada comentario costaría un `GET` por miembro conectado, hasta 50. Es el mismo criterio que ADR-022 §7 aplicó al preview. |

**Solo miembros, y solo de ese grupo.** Los destinatarios salen de `memberIdsOf(groupId)`. No valen los de
`relationsOfLink` más las listas privadas, que son los destinatarios de `link.enriched`: esos incluirían a quien ve el
link por otro grupo o por su lista privada, y los comentarios son del grupo (D4). Quien salió deja de recibir en el
aviso siguiente, aunque tenga el canal abierto.

**Sin outbox.** ADR-009 existe para no perder **trabajo encolado** (un dual-write Mongo→BullMQ). Esto no es trabajo:
es un aviso de mejor esfuerzo sobre algo que ya está en Mongo y que el SPA vuelve a leer al recuperar el foco. Tiene el
mismo precedente que el aviso de un pegado (ADR-023 §5). Nada se encola en este change.

**Nombres.** Canal `events:group-link.comments`, tipo `GroupLinkCommentsChanged.v1` y evento SSE `group-link.comments`,
en `libs/shared/src/events/group-link-comments.event.ts`, junto a `link-enriched.event.ts`, con un test de contrato. El
evento no se llama `comment.created` porque el SPA sustituye un **resumen**: el cambio concreto viaja dentro.

**Relación con ADR-024 §9.** Este reparto "a los miembros actuales de un grupo" es el reutilizable que ADR-024 esperaba.
El aviso de los estados compartidos sigue diferido: reutilizarlo es una decisión de `applications`, no de este change.

**Alternativas descartadas:**
- texto en el mensaje de Redis;
- SSE solo con identificadores y un `GET` por aviso;
- `EventEmitter2` en el proceso, que no llega a las otras instancias de `api`;
- outbox y BullMQ;
- repartir a quien ve el link.

### D10 — Contratos en `libs/shared`

Se fijan **antes** que backend y frontend (grupo 1 de tareas), para que puedan avanzar en paralelo:
- `text/comment-text.ts`: `normalizeCommentText`, `COMMENT_TEXT_MAX_LENGTH = 500` y `SHARE_NOTE_MAX_LENGTH = 280`.
- `schemas/group-link-comment.schema.ts`:
  - de petición: `commentTextSchema`, `createCommentRequestSchema` y `listCommentsQuerySchema` (`limit` y `cursor`,
    como los links);
  - de respuesta: `groupLinkCommentSchema` (`id`, `author: linkSharerSchema`, `authorLeft`, `text`, `createdAt`),
    `commentsSummarySchema` (`count`, `latest` de 0 a 2), `createCommentResponseSchema` (`{ comment, comments }`) y
    `commentPageSchema` (`items`, `total`, `nextCursor?`);
  - de la nota: `shareNoteSchema` (`text` y `updatedAt`), `updateShareNoteRequestSchema` (`text` como cadena o `null`)
    y `updateShareNoteResponseSchema` (`{ note: shareNoteSchema | null }`).
- `schemas/link.schema.ts`:
  - `saveLinkRequestSchema` suma `note?`, con el refinamiento "solo con `groupId`" que nombra `note`;
  - `jobLinkSummarySchema` suma `note?` y `comments?`.
- `events/group-link-comments.event.ts`: `GROUP_LINK_COMMENTS_CHANNEL`, `GROUP_LINK_COMMENTS_EVENT_TYPE`,
  `groupLinkCommentsChangedEventSchema`, `GROUP_LINK_COMMENTS_EVENT_NAME` y `groupLinkCommentsMessageSchema`.
- `apiErrorCodeSchema` suma `comment_not_found` (404), con su entrada en `API_ERROR_STATUS` y `API_ERROR_MESSAGES` en
  la misma tarea.

**Filtro HTTP.** Dos ramas nuevas antes de la de `LinksError`, en el patrón de `InvalidApplicationField`:
`InvalidCommentText` → `validation_error` nombrando `text`, e `InvalidShareNote` → `validation_error` nombrando `note`.
En `PATCH …/note` el campo es `text`, así que el caso de uso lanza `InvalidCommentText` también ahí. `CommentNotFound`
(404) y `CommentDeletionForbidden` (`forbidden`, 403) heredan la rama de `LinksError`.

### D11 — Frontend

- **Datos.**
  - `core/links/links.api.ts` gana `comments`, `postComment`, `deleteComment` y `updateNote`.
  - `LinksStore` guarda `note` y `comments` en los items del listado del grupo. Gana `applyCommentsChanged(message)`:
    sustituye el resumen del link si el grupo abierto es el del aviso y el link está en la lista.
  - `applyEnriched` pasa a **conservar** `note` y `comments` de la tarjeta que tenía, porque `link.enriched` no los trae
    (spec "La lectura de la oferta no borra los comentarios").
  - `EventsChannel` reparte también `group-link.comments` por un segundo observable (`groupLinkComments`), con una
    guarda de forma sin zod, por el mismo motivo de bundle que `parseMessage`.
- **Tarjeta** (`LinkCard`). La tarjeta es presentacional: recibe los datos y emite `openComments`, `editNote` y
  `publishNoteAsComment` hacia `LinkList`. Muestra:
  - la nota, con "Nota de <nombre>";
  - los 2 últimos comentarios, el más antiguo arriba, con `white-space: pre-line` y fecha relativa;
  - "ya no está en el grupo" junto al autor que se fue;
  - la acción con el contador.
  Solo en el contexto de grupo; en `/mis-links`, nada.
- **Hilo** (`features/links/comments.dialog.ts`, `MatDialog`):
  - carga la primera página y ofrece "Ver comentarios anteriores";
  - se pinta en orden cronológico, lo más reciente abajo, con autoscroll al final al abrir y al publicar;
  - un `textarea` con `cdkTextareaAutosize`, contador `n/500`, Ctrl/Cmd+Enter y botón bloqueado en curso;
  - "Borrar" solo en lo propio, con confirmación;
  - los avisos en vivo del link abierto: añade lo nuevo que viene en `latest`, deduplicando por `id`; muestra "Hay
    comentarios nuevos" si no viene; quita lo borrado;
  - un `404` al abrir o al publicar (`group_not_found` o `link_not_found`) cierra el diálogo con "Esta oferta ya no está
    en el grupo" y recarga la lista.
- **Guardar con nota** (`save-link.form.ts`). El campo de nota aparece solo con ámbito de grupo. Tras `already_there`
  con nota escrita, el aviso ofrece "Publicarla como comentario" y la publica con `postComment`.
- **Quitar un link.** La confirmación usa `comments.count` (spec `web/links`).
- **Textos** (ES fuente, EN en `messages.en.xlf`, plurales ICU):

| ES | EN |
|----|----|
| Nota de {nombre} | Note from {name} |
| Comentar / Ver el comentario / Ver los {n} comentarios | Comment / View comment / View all {n} comments |
| ya no está en el grupo | no longer in the group |
| Comentarios | Comments |
| Todavía nadie comentó esta oferta. Cuenta lo que sepas: requisitos, si ya cerró, a quién escribir. | No comments yet. Share what you know: requirements, whether it has closed, who to contact. |
| Escribe un comentario | Write a comment |
| Lo verán los miembros de este grupo. | Members of this group will see it. |
| Máximo 500 caracteres | 500 characters max |
| Ver comentarios anteriores | Show earlier comments |
| Hay comentarios nuevos | New comments |
| Borrar | Delete |
| ¿Borrar tu comentario? No se puede deshacer. | Delete your comment? This can't be undone. |
| Escribiste muchos comentarios seguidos. Vuelve a intentarlo en {n} minutos / más tarde | You've posted a lot of comments in a row. Try again in {n} minutes / later |
| No se pudo publicar el comentario. Inténtalo de nuevo. | Couldn't post the comment. Please try again. |
| Esta oferta ya no está en el grupo | This job is no longer in the group |
| Nota para el grupo (opcional) | Note for the group (optional) |
| Por ejemplo: esta es la que te dije | E.g. this is the one I told you about |
| Tu nota no se añadió porque la oferta ya estaba en el grupo. | Your note wasn't added because the job was already in the group. |
| Publicarla como comentario | Post it as a comment |
| Añadir una nota / Editar la nota / Quitar la nota | Add a note / Edit note / Remove note |
| hace un momento / hace {n} min / hace {n} h / ayer / {fecha} | just now / {n} min ago / {n} h ago / yesterday / {date} |
| Se quita de este grupo junto con su comentario / sus {n} comentarios; la oferta sigue disponible en otros grupos. | It will be removed from this group along with its comment / its {n} comments; the job stays available in other groups. |

### D12 — Pruebas

- **Dominio y casos de uso.** Unitarios con repositorios en memoria (`links/application/testing/`). El repositorio en
  memoria de comentarios simula la condición "la relación existe" del alta. Se prueban:
  - `normalizeCommentText` con una tabla;
  - las lecturas fijas de D7, contando llamadas a los dobles;
  - la autoría del borrado;
  - `authorLeft` derivado;
  - el limitador que falla abierto;
  - `refund` si la transacción falla.
- **Integración.** `createApp` con `inject` sobre `mongodb-memory-server` en replica set. Cubre:
  - cada endpoint;
  - la carrera "comentar mientras se quita", con dos peticiones concurrentes repetidas;
  - la transacción de retirada con el borrado de comentarios forzado a fallar;
  - el hook de borrado de grupo;
  - salir, ser expulsado y volver;
  - el `explain` del hilo y de la agregación;
  - el `429` y el contador caído;
  - que ningún log contenga el texto, con el capturador de `logger-redaction.spec.ts`.
- **Tiempo real.** Unitarios de `DeliverCommentsChanged`: solo miembros actuales, sin lecturas si nadie escucha, y ni
  un extraño ni quien ve el link por otro grupo lo reciben. Integración del publicador y el suscriptor con Redis real,
  como `redis-enrichment-notices.integration.spec.ts`, comprobando que el mensaje de Redis no lleva el texto.
- **Web.** TestBed con `HttpTestingController` para la API, el store (`applyCommentsChanged`, que `applyEnriched`
  conserve), `EventsChannel`, la tarjeta, el diálogo, el formulario y la confirmación de quitar.
- **E2E Playwright** en `apps/web-e2e/src/comments.spec.ts`, con la franja nueva `comments: 3` en
  `JOB_ID_SLOTS`:
  1. Ana comparte con nota. Beto la ve, comenta, y Ana ve el comentario **sin recargar**.
  2. Beto borra el suyo y desaparece en la pantalla de Ana.
  3. Beto sale del grupo y Ana ve "ya no está en el grupo".

## Risks / Trade-offs

- **Datos de terceros en comentarios** (el teléfono de un reclutador). Se acepta con las salvaguardas de D5: solo
  miembros actuales, fuera de logs, de Redis y de la página pública, y lo borra su autor. Si pasa a ser un problema,
  la palanca es la moderación del propietario (Open Questions), no reescribir el texto.
- **Un miembro que se fue deja texto que ya no controla** hasta que vuelva. Es lo que pide la decisión humana 4, y el
  propietario puede quitar el link. El derecho a borrar sin volver queda en Open Questions.
- **`authorLeft` cuesta una lectura de miembros por página y por aviso.** Son 50 miembros como máximo, con un índice por
  grupo. Es aceptable.
- **La agregación `$topN` recorre todos los comentarios de los links de la página.** Con 20 links y decenas de
  comentarios cada uno son cientos de documentos por el índice. Si algún link pasa de unos miles, se cambia a un
  `$lookup` con `$limit: 2` por link, que sigue siendo una sola consulta.
- **`commentCount` puede desviarse** si alguien borra comentarios a mano en la base. El RUNBOOK documenta cómo
  recalcularlo con una agregación; el hilo sigue funcionando porque pagina sobre la colección.
- **Conflictos de escritura en la relación** cuando muchos comentan a la vez el mismo link. `withTransaction` los
  reintenta. Con el límite de D6 y 50 miembros, el pico está acotado.
- **Aviso perdido** con Redis caído o sin conexión. La tarjeta se actualiza al volver a la pestaña (recarga existente)
  o al reabrir el hilo, porque la verdad está en Mongo.
- **`links` crece.** Se mitiga con archivos por caso de uso y un controlador propio. Si el módulo sigue creciendo, la
  frontera natural para separar después sigue siendo "relaciones de grupo" frente a "vacante canónica".

## Migration Plan

Colección nueva sin datos previos. Los índices se construyen al arrancar `api` (`autoIndex`). `group_links` gana
`note?` y `commentCount`: los documentos existentes no los tienen y se leen como "sin nota" y 0, así que **no hay
backfill**. El primer `$inc` crea el campo. Ningún índice de `group_links` cambia. Para volver atrás basta con desplegar
la versión anterior: ignora los campos nuevos y la colección `group_link_comments`, que puede borrarse a mano (RUNBOOK).

## Open Questions

- **Moderación por el propietario.** ¿Puede el owner borrar un comentario ajeno, o la nota ajena, de su grupo? ADR-015
  no lo contempla, y hoy su única herramienta es quitar el link entero, que también borra lo valioso.
  **Recomendación:** sí, en un change pequeño posterior que actualice ADR-015. Solo borrar, nunca editar, con la marca
  "Borrado por el propietario" en lugar del texto, para que el hilo no pierda coherencia. No entra aquí porque cambia un
  ADR vigente.
- **Borrar lo propio sin volver al grupo.** Quien salió o fue expulsado no puede borrar sus comentarios sin volver a
  entrar, y si lo expulsaron quizá no pueda (código regenerado). **Recomendación:** resolverlo con el borrado de cuenta
  de `deploy-prod`, que debe borrar o anonimizar sus `group_link_comments`, y apuntar esa herencia en el manifiesto
  cuando se apruebe este change. Una vista "mis comentarios en grupos donde ya no estoy" no compensa hoy su coste.
- **Qué hace el borrado de cuenta con los comentarios**: ¿borrarlos (se pierde contexto de otros) o anonimizarlos
  ("Cuenta eliminada")? **Recomendación:** anonimizar el autor y conservar el texto solo si el titular no pide borrarlo;
  lo decide `deploy-prod` con su aviso de privacidad.
