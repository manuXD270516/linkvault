> **Condición previa:** rama `change/group-comments` rebasada sobre `main` antes de tocar `apiErrorCodeSchema`,
> `api-exception.filter.ts` o `messages.*.xlf` (tarea 1.1). Contrato primero (grupo 1): después, backend (grupos 2 a 5)
> y frontend (grupo 6) pueden ir en paralelo.

## 1. Contratos en `libs/shared`

- [x] 1.1 [infra] Rebasar `change/group-comments` sobre `main` y comprobarlo con `git merge-base --is-ancestor main HEAD` antes de tocar `apiErrorCodeSchema`, `api-exception.filter.ts` o `messages.*.xlf`.
- [x] 1.2 [backend] `libs/shared/src/text/comment-text.ts`: `normalizeCommentText` (`\r\n`/`\r` → `\n`, quita C0/C1 salvo `\n` y U+202A–U+202E/U+2066–U+2069, `trim`), `COMMENT_TEXT_MAX_LENGTH = 500` y `SHARE_NOTE_MAX_LENGTH = 280`, exportados desde `index.ts`; verificar con una tabla de casos (teléfono y email intactos, `<b>` intacto, nulo y U+202E fuera, idempotente).
- [x] 1.3 [backend] `libs/shared/src/schemas/group-link-comment.schema.ts`: `commentTextSchema` (normaliza y exige 1–500 code points), `createCommentRequestSchema`, `listCommentsQuerySchema` (`limit` 20/50 y `cursor` como los links) y `shareNoteSchema` (`text`, `createdAt`); verificar con tests de 0, 500 y 501 caracteres y de solo espacios.
- [x] 1.4 [backend] Respuestas: `groupLinkCommentSchema` (`id`, `author` con `linkSharerSchema`, `authorLeft`, `text`, `createdAt`), `commentsSummarySchema` (`count`, `revision` entero ≥ 0, `sharedAt`, `latest` de 0 a 2), `createCommentResponseSchema`, `deleteCommentResponseSchema` (`{ comments }`) y `commentPageSchema`; verificar con tests de que `strictObject` rechaza un email en el autor, un `latest` de 3 y una `revision` negativa.
- [x] 1.5 [backend] `link.schema.ts`: `saveLinkRequestSchema` con `note?` que normaliza primero (vacía → ausente) y exige `groupId` si hay texto, nombrando `note`; `jobLinkSummarySchema` con `note?` y `comments?`; verificar con tests de "Nota sin grupo", "Nota vacía sin grupo" y 281 caracteres, con los tests existentes de `link.schema` en verde.
- [x] 1.6 [backend] `libs/shared/src/events/group-link-comments.event.ts`: `GROUP_LINK_COMMENTS_CHANNEL = 'events:group-link.comments'`, `GroupLinkCommentsChanged.v1` con payload estricto `{ groupId, linkId, commentId, change }`, `GROUP_LINK_COMMENTS_EVENT_NAME = 'group-link.comments'` y `groupLinkCommentsMessageSchema` (con `comments.revision` y `comments.sharedAt`); verificar con un test de contrato que además comprueba que el payload rechaza `text` y `authorId`.
- [x] 1.7 [backend] Tras 1.1, `comment_not_found` (404) en `apiErrorCodeSchema`, `API_ERROR_STATUS` y `API_ERROR_MESSAGES`; verificar con `pnpm nx run-many -t typecheck -p shared api web`.

## 2. Dominio y persistencia en `links`

- [ ] 2.1 [backend] `links/domain/group-link-comment.ts` y `share-note.ts`: creación con texto normalizado y validado, `mayDelete(requesterId, role)` (autor u owner), `authorLeftGiven(memberIds)`; errores `CommentNotFound`, `CommentDeletionForbidden`, `NoteRemovalForbidden`, `CommentsGroupNotFound` (`group_not_found`) y la base `InvalidLinkField` con `field` para `InvalidCommentText` e `InvalidShareNote`; `COMMENTS_PER_USER = 30` en `limits.ts`; verificar con unitarios y con el lint de dominio.
- [ ] 2.2 [backend] `infrastructure/group-link-comment.schemas.ts` (`group_link_comments`, índice `{ groupId, linkId, createdAt: -1, _id: -1 }`, `bufferCommands: false`) y `group_links` con `note?` (`text`, `createdAt`), `commentCount` y `commentsRevision` (por defecto 0), sin cambiar sus índices; verificar con el test tabular de schemas, que comprueba además que los tres índices de `group_links` siguen iguales.
- [ ] 2.3 [backend] Puertos:
  - `GROUP_LINK_COMMENT_REPOSITORY`: `insert`, `deleteOne`, `deleteByRelation` y `deleteByGroup` con sesión por parámetro; `find`, `page` y `latestByLinks`;
  - `GroupLinkRepository`: gana `addComment`, `removeComment`, `removeWithComments` y `clearNote`, y pierde `deleteByLink`;
  - `COMMENTS_CHANGED_PUBLISHER` y `COMMENTS_BROADCASTER`, con sus dobles grabadores en `application/testing/`.

  Verificar con `pnpm nx run api:typecheck` y con los tests de `deleteByLink` retirados junto al método.
- [ ] 2.4 [backend] Repositorios en memoria de comentarios y de relaciones, con el de relaciones como único dueño de `commentCount` y `commentsRevision` (alta sin relación → `null`, borrado sin comentario → `null`, retirada con comentarios, resumen con `sharedAt`); verificar con sus specs.
- [ ] 2.5 [backend] `MongoGroupLinkCommentRepository`: `insert`, `deleteOne`, `deleteByRelation` y `deleteByGroup` con la sesión recibida, y `find`; verificar con integración de cada uno dentro y fuera de una transacción abortada.
- [ ] 2.6 [backend] `MongoGroupLinkCommentRepository.page` (cursor `(createdAt, _id)` de `link-cursor.ts`) y `latestByLinks(groupId, linkIds)` (una agregación con `$topN` n=2); verificar con integración: 45 comentarios en 20+20+5 sin saltos, los dos últimos por link, links sin comentarios ausentes y `explain` sobre el índice de 2.2.
- [ ] 2.7 [backend] `MongoGroupLinkRepository.addComment` y `removeComment`: transacción con `$inc` de `commentCount` y `commentsRevision` (alta: `matchedCount === 0` → `null`; borrado: `$inc` solo si se borró uno, `null` si no), resumen con `sharedAt`, y el punto de espera solo de tests (gancho `protected` vacío) entre el `$inc` y el `insert`; verificar con integración: contador y revisión tras altas y borrados, y alta sobre una relación inexistente sin dejar comentario.
- [ ] 2.8 [backend] `MongoGroupLinkRepository`: `share` guarda `note` (`text`, `createdAt`) solo al crear, `clearNote` (con `false` si la relación no existe), y `listByGroup` proyecta `note`, `commentCount` y `commentsRevision`; verificar con integración de "La nota del primero se queda" y de quitar una nota inexistente.
- [ ] 2.9 [backend] `MongoGroupLinkRepository.removeWithComments` y `deleteByGroup`, que borra antes los comentarios con la misma sesión; verificar con integración de "Todo o nada" (borrado de comentarios forzado a fallar) y "Otro grupo no se entera".
- [ ] 2.10 [backend] Test determinista a) "Comentar mientras se quita": A hace el `$inc` y se detiene en el punto de espera, arranca B (`removeWithComments`), A confirma y B reintenta; comprobar 0 comentarios y que el alta devolvió el comentario.
- [ ] 2.11 [backend] Test determinista b) "Quitar mientras se comenta": B borra la relación sin confirmar, arranca `addComment`, B confirma y el reintento del alta no encuentra la relación; comprobar que el alta devuelve `null` y quedan 0 comentarios.
- [ ] 2.12 [backend] `GroupLinksDeletionHook` sobre `deleteByGroup`; verificar con integración de "Grupo borrado sin comentarios huérfanos", "Los comentarios de otro grupo siguen" y "Si falla la limpieza no se borra nada".

## 3. Casos de uso en `links`

- [ ] 3.1 [backend] `LINK_LIMITER` con la clave `{ kind: 'comment', userId }` (`links:comment:<userId>`, 30 por 15 min, falla abierto) en `CounterLinkLimiter` y en su doble; verificar con unitarios de límite, `refund` y contador caído.
- [ ] 3.2 [backend] `PostGroupLinkComment` en el orden de D6 (pertenencia, `consume` fuera de la transacción, `addComment`, `refund` ante cualquier error, `void publish` después); verificar con unitarios de "Comentar una oferta del grupo", "Extraño no comenta", "Link que no está en el grupo", "Lo rechazado no gasta", "Carrera que termina en 404 no gasta" y "Redis caído al comentar".
- [ ] 3.3 [backend] `DeleteGroupLinkComment`: pertenencia con rol, `comment_not_found`, `forbidden` salvo para el autor o el owner, `removeComment` (`null` → `404 comment_not_found` sin `publish`), `200 { comments }` y `void publish`; verificar con unitarios de "Borrar el propio", "El propietario borra un comentario ajeno", "Otro miembro no borra lo ajeno", "Borrar dos veces" y "Comentario de otro link".
- [ ] 3.4 [backend] `ListGroupLinkComments`: las 4 lecturas fijas de D7, `total` desde `commentCount` y `authorLeft` derivado; verificar con unitarios de "Cada grupo tiene su hilo", "Extraño no lee el hilo" y "Sale del grupo".
- [ ] 3.5 [backend] `ListGroupLinks` con `memberIdsOf` y el mapeo de `note` y `comments` (`count`, `revision`, `sharedAt`, `latest` con `authorLeft`); verificar con unitarios de "Tarjeta con tres comentarios", "Link sin comentarios", "La revisión crece con cada cambio" y "Expulsado".
- [ ] 3.6 [backend] `ListGroupLinks` con las 5 lecturas fijas (`latestByLinks` y nombres unidos en una llamada); verificar con el unitario "Lecturas fijas", que cuenta las llamadas a los dobles con páginas de 2 y 20 links.
- [ ] 3.7 [backend] `SaveLink` con `note`: solo al crear la relación y descartada en `already_there`; `ImportLinks` sin cambios; verificar con unitarios de "Guardar con una nota", "La nota del primero se queda" e "Importar no escribe notas".
- [ ] 3.8 [backend] `RemoveShareNote` en el orden pertenencia (404) → relación (`404 link_not_found`) → permiso (403, haya o no nota) → `clearNote` (204; `false` → `link_not_found`); verificar con unitarios de "Quien compartió quita su nota", "El propietario quita una nota ajena", "Otro miembro no la quita", "Quitar una nota que ya no está" y "Sin permiso aunque no haya nota".
- [ ] 3.9 [backend] `RemoveGroupLink` sobre `removeWithComments`; verificar con unitarios de "Quitar se lleva los comentarios de ese grupo" y "Volver a compartirla empieza de cero".

## 4. Aviso en vivo

- [ ] 4.1 [backend] `RedisCommentsChangedPublisher` sobre `REDIS_APP_CLIENT` (nunca lanza, un `warn` por racha sin cuerpo); verificar con unitarios con un cliente doble que falla y con el contenido publicado (sin `text` ni `authorId`).
- [ ] 4.2 [backend] `RedisCommentNotices` sobre el cliente suscriptor compartido: filtra por canal, valida con el schema estricto, descarta sin registrar contenido y vuelve a pedir el canal en cada `ready`; verificar con unitarios con un suscriptor doble que recibe los dos canales.
- [ ] 4.3 [backend] `DeliverCommentsChanged` sobre `COMMENTS_BROADCASTER`: sin lecturas si nadie escucha; nada si la relación ya no existe; si no, un resumen y envío solo a miembros actuales; verificar con unitarios de "Los miembros se enteran", "Quien ve el link por otro sitio no recibe nada", "Quien salió deja de recibir", "Borrar también avisa", "Link quitado antes de repartir" y "Nadie escuchando".
- [ ] 4.4 [backend] Adaptador de `COMMENTS_BROADCASTER` sobre `EventStreamRegistry` con `groupLinkCommentsMessage`; verificar con un unitario de nombre de evento y cuerpo.
- [ ] 4.5 [backend] `LinksModule`: publicador, broadcaster, suscripción y reparto sobre el mismo `REDIS_SUBSCRIBER_CLIENT`; verificar con `links.module.spec.ts` (una sola conexión de suscripción) y `dependency-injection.spec.ts`.
- [ ] 4.6 [backend] Integración con Redis real (patrón de `redis-enrichment-notices.integration.spec.ts`): publicar en una "instancia" llega a otra y el mensaje de Redis no contiene el texto ("El texto no viaja por Redis").

## 5. Presentación y HTTP

- [ ] 5.1 [backend] Tras 1.1, rama `InvalidLinkField` → `validation_error` con `[field]` antes de la de `LinksError` en `api-exception.filter.ts`; verificar con filas nuevas en `api-exception.filter.spec.ts` para `InvalidCommentText`, `InvalidShareNote`, `CommentNotFound`, `CommentDeletionForbidden`, `NoteRemovalForbidden` y `CommentsGroupNotFound`.
- [ ] 5.2 [backend] `POST groups/:id/links/:linkId/comments` en `GroupLinkCommentsController`, ids de la URL fuera del pipe para el 404 uniforme; verificar por HTTP los escenarios de 3.2, "Comentario vacío", "Comentario demasiado largo", "Justo en el límite", "HTML como texto" y "Caracteres invisibles fuera".
- [ ] 5.3 [backend] `GET groups/:id/links/:linkId/comments`; verificar por HTTP los escenarios de 3.4 e "Hilo paginado sin saltos ni repetidos", con cursor manipulado → `400` nombrando `cursor`.
- [ ] 5.4 [backend] `DELETE groups/:id/links/:linkId/comments/:commentId` con `200 { comments }`; verificar por HTTP los escenarios de 3.3 y "Sin edición".
- [ ] 5.5 [backend] `DELETE groups/:id/links/:linkId/note` y `note` en `POST /api/links`; verificar por HTTP los escenarios de 3.8, "La nota no se edita", "Guardar con una nota", "Nota sin grupo", "Nota vacía sin grupo" y "Nota demasiado larga".
- [ ] 5.6 [backend] Integración de pertenencia con los endpoints reales de `groups`: "Sale del grupo", "Expulsado", "Fuera del grupo no borra" y "Vuelve y borra".
- [ ] 5.7 [backend] Integración del límite y de los logs: "Ventana agotada" (`429` con `Retry-After`), "Contador caído", "Borrar no cuenta" y "El texto no se registra" (capturador de `logger-redaction.spec.ts`).
- [ ] 5.8 [backend] Humo HTTP concurrente de "Comentar mientras se quita": 20 repeticiones de alta y retirada a la vez, con ningún comentario huérfano y respuestas `201` o `404 link_not_found`.
- [ ] 5.9 [backend] Integración "Dos borrados a la vez": el autor y el owner borran el mismo comentario a la vez; una respuesta `200` y otra `404 comment_not_found`, `count` −1 y `revision` +1.

## 6. Frontend

- [x] 6.1 [frontend] `core/links/links.api.ts`: `comments`, `postComment`, `deleteComment` (con `{ comments }` en la respuesta) y `removeNote`, y `note` en `save`, solo con tipos de `@linkvault/shared`; verificar con `HttpTestingController`.
- [x] 6.2 [frontend] `EventsChannel` reparte `group-link.comments` por `groupLinkComments`, con una guarda de forma sin zod; verificar con `events.channel.spec.ts` (mensaje válido, malformado y de otro nombre).
- [x] 6.3 [frontend] `LinksStore`: `note` y `comments` en los items, y `replace` que los conserva si el link nuevo no los trae; verificar con TestBed: "La lectura de la oferta no borra los comentarios" y "Corregir el preview no borra los comentarios".
- [x] 6.4 [frontend] `LinksStore.applyCommentsChanged` y la aplicación de los resúmenes de `postComment` y del `200 { comments }` del borrado, comparando la pareja (`sharedAt`, `revision`); verificar con TestBed: "Comentario que llega mientras miras", "Un resumen viejo no pisa uno nuevo" y "Volver a compartir no congela la tarjeta".
- [ ] 6.5 [frontend] `LinkCard`: "Nota de <nombre>" con `line-clamp` de 2 líneas y "Quitar la nota" para quien compartió y el owner, con la confirmación propia o la ajena; verificar con "Quitar la nota" y con una tarjeta sin nota.
- [ ] 6.6 [frontend] `LinkCard`: 2 últimos comentarios (el más antiguo arriba, `line-clamp` de 2 líneas, fecha relativa, "ya no está en el grupo") y la acción "Comentar" / "Responder" / "Ver los N comentarios", solo en grupo; verificar con "Tarjeta con nota y comentarios", "Tarjeta sin comentarios", "Tarjeta con pocos comentarios", "Texto largo cortado en la tarjeta", "Autor que se fue", "HTML como texto en pantalla" y "Sin comentarios en la lista privada".
- [ ] 6.7 [frontend] `comments.dialog` (lectura): primera página, "Ver comentarios anteriores", orden cronológico, estado vacío y `404` al abrir; verificar con "Hilo largo", "Hilo vacío" y "La oferta ya no está".
- [ ] 6.8 [frontend] `comments.dialog` en móvil: pantalla completa por debajo de `sm` con `BreakpointObserver` y compositor en pie fijo por encima del teclado; verificar con "En el móvil" (TestBed con el breakpoint simulado).
- [ ] 6.9 [frontend] `comments.dialog` (escritura): indicación "Lo verán los miembros de este grupo y seguirá aquí aunque salgas.", contador, botón bloqueado, Ctrl/Cmd+Enter, mensajes de `429` y genérico, y lo escrito conservado; verificar con "Publicar", "La indicación dice qué pasa al salir", "Demasiado largo", "Demasiados comentarios" y "Un solo envío".
- [ ] 6.10 [frontend] `comments.dialog` (borrar): "Borrar" en lo propio y, para el owner, en todo, con sus dos confirmaciones, el resumen de la respuesta aplicado a la tarjeta, `404 comment_not_found` como éxito y botón bloqueado; verificar con "Borrar el propio", "El propietario borra lo ajeno", "Lo ajeno no se borra sin ser propietario", "Ya estaba borrado" y "Cancelar el borrado".
- [ ] 6.11 [frontend] `comments.dialog` en vivo (altas): añade lo que viene en `latest` sin duplicar; verificar con "Con el hilo abierto" y "Mi propio comentario, una vez".
- [ ] 6.12 [frontend] `comments.dialog` en vivo ("Ver comentarios nuevos" y bajas): botón cuando lo nuevo no viene en `latest`, y quitar lo borrado; verificar con "Varios a la vez" y "Borrado que llega mientras miras".
- [ ] 6.13 [frontend] `save-link.form`: campo de nota solo en grupo, con contador de 280, y tras `already_there` con nota, "Tu nota no se añadió…" dejando el texto en el campo; verificar con "Compartir con nota", "La oferta ya estaba" y "Sin nota en la lista privada".
- [ ] 6.14 [frontend] Confirmación de quitar un link con el número de comentarios de `comments.count` (plural ICU); verificar con "Quitar un link con comentarios" y los escenarios existentes de `web/links`.
- [ ] 6.15 [frontend] Tras 1.1, marcar todos los textos de D11 y traducirlos en `messages.en.xlf`; verificar con "Traducciones completas".

## 7. Cierre

- [ ] 7.1 [frontend] `JOB_ID_SLOTS.comments = 3` en `apps/web-e2e/src/support/job-ids.ts` y `apps/web-e2e/src/comments.spec.ts`: Ana comparte un link con nota y Beto, miembro, ve la nota en la tarjeta; verificar con `pnpm nx e2e web-e2e`.
- [ ] 7.2 [frontend] Ampliar `comments.spec.ts`: Beto comenta y Ana ve el comentario y "Responder" sin recargar; verificar con `pnpm nx e2e web-e2e`.
- [ ] 7.3 [frontend] Ampliar `comments.spec.ts`: Ana, propietaria, borra el comentario de Beto y desaparece en la pantalla de Beto sin recargar; verificar con `pnpm nx e2e web-e2e`.
- [ ] 7.4 [frontend] Ampliar `comments.spec.ts`: Beto comenta de nuevo y sale del grupo, y Ana, al recargar, ve "ya no está en el grupo"; verificar con `pnpm nx e2e web-e2e`.
- [ ] 7.5 [infra] Verificar que el `scope` de `deploy-prod` en `openspec-changes.yaml` contiene la herencia "el borrado de cuenta borra o anonimiza sus `group_link_comments` (ADR-026)", escrita durante el debate.
- [ ] 7.6 [infra] Revisar que `docs/adr/ADR-026.md` cubre lo implementado (módulo, dueño de contadores, revisión y `sharedAt`, carrera y sus dos tests, nota, permisos con moderación del owner, texto sin reescribir, límite y su orden, lecturas fijas, ciclo de vida y aviso en vivo) y corregirlo si algo cambió; verificar que el proposal lo referencia.
- [ ] 7.7 [infra] `README.md`: comentarios y nota en la tarjeta del grupo, qué ven los miembros, qué puede borrar el propietario y qué pasa al salir. `docs/RUNBOOK.md`: colección `group_link_comments`, cómo recalcular `commentCount` con una agregación, cómo borrar a mano los comentarios de una persona hasta que exista el borrado de cuenta, y el canal `events:group-link.comments`. Verificar leyendo que las rutas y comandos citados existen.
- [ ] 7.8 [infra] `pnpm nx affected -t lint,typecheck,test --base=main` y `openspec validate --all` en verde; verificar con la salida en archivo.
