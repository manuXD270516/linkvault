> **Condición previa:** rama `change/group-comments` rebasada sobre `main` antes de tocar `apiErrorCodeSchema`,
> `api-exception.filter.ts` o `messages.*.xlf` (tarea 1.1). Contrato primero (grupo 1): después, backend (grupos 2 a 5)
> y frontend (grupo 6) pueden ir en paralelo.

## 1. Contratos en `libs/shared`

- [ ] 1.1 [infra] Rebasar `change/group-comments` sobre `main` y comprobarlo con `git merge-base --is-ancestor main HEAD` antes de tocar `apiErrorCodeSchema`, `api-exception.filter.ts` o `messages.*.xlf`.
- [ ] 1.2 [backend] `libs/shared/src/text/comment-text.ts`: `normalizeCommentText` (`\r\n`/`\r` → `\n`, quita C0/C1 salvo `\n` y U+202A–U+202E/U+2066–U+2069, `trim`), `COMMENT_TEXT_MAX_LENGTH = 500` y `SHARE_NOTE_MAX_LENGTH = 280`, exportados desde `index.ts`; verificar con una tabla de casos (teléfono y email intactos, `<b>` intacto, nulo y U+202E fuera, idempotente).
- [ ] 1.3 [backend] `libs/shared/src/schemas/group-link-comment.schema.ts`: `commentTextSchema` (normaliza y exige 1–500 code points), `createCommentRequestSchema`, `listCommentsQuerySchema` (`limit` 20/50 y `cursor` como los links), `shareNoteSchema` y `updateShareNoteRequestSchema` (`text` cadena ≤ 280 o `null`); verificar con tests de 0, 500 y 501 caracteres, solo espacios y `null`.
- [ ] 1.4 [backend] Respuestas: `groupLinkCommentSchema` (`id`, `author` con `linkSharerSchema`, `authorLeft`, `text`, `createdAt`), `commentsSummarySchema` (`count`, `latest` 0–2), `createCommentResponseSchema`, `commentPageSchema` y `updateShareNoteResponseSchema`; verificar con tests de que `strictObject` rechaza un email en el autor y un `latest` de 3.
- [ ] 1.5 [backend] `link.schema.ts`: `saveLinkRequestSchema` con `note?` y el refinamiento "solo con `groupId`" que nombra `note`, y `jobLinkSummarySchema` con `note?` y `comments?`; verificar con tests ("Nota sin grupo", nota vacía tratada como ausente, 281 caracteres) y con los tests existentes de `link.schema` en verde.
- [ ] 1.6 [backend] `libs/shared/src/events/group-link-comments.event.ts`: `GROUP_LINK_COMMENTS_CHANNEL = 'events:group-link.comments'`, `GroupLinkCommentsChanged.v1` con payload estricto `{ groupId, linkId, commentId, change }`, `GROUP_LINK_COMMENTS_EVENT_NAME = 'group-link.comments'` y `groupLinkCommentsMessageSchema`; verificar con un test de contrato que además comprueba que el payload rechaza `text` y `authorId`.
- [ ] 1.7 [backend] Tras 1.1, `comment_not_found` (404) en `apiErrorCodeSchema`, `API_ERROR_STATUS` y `API_ERROR_MESSAGES`; verificar con `pnpm nx run-many -t typecheck -p shared api web`.

## 2. Dominio y persistencia en `links`

- [ ] 2.1 [backend] `links/domain/group-link-comment.ts` y `share-note.ts`: creación con texto normalizado y validado, `isAuthor`, `authorLeftGiven(memberIds)`; errores `CommentNotFound`, `CommentDeletionForbidden`, `InvalidCommentText` e `InvalidShareNote` (heredan de `LinksError`); `COMMENTS_PER_USER = 30` en `limits.ts`; verificar con unitarios y con el lint de dominio.
- [ ] 2.2 [backend] `infrastructure/group-link-comment.schemas.ts` (`group_link_comments`, índice `{ groupId, linkId, createdAt: -1, _id: -1 }`, `bufferCommands: false`) y `group_links` con `note?` (`text`, `updatedAt`) y `commentCount` (por defecto 0), sin cambiar sus índices; verificar con el test tabular de schemas, que comprueba además que los tres índices de `group_links` siguen iguales.
- [ ] 2.3 [backend] Puerto `GROUP_LINK_COMMENT_REPOSITORY` (`create`, `delete`, `page`, `latestByLinks`, `deleteByRelation`, `deleteByGroup`) y su repositorio en memoria, que exige la relación para crear y ajusta `commentCount`; `GroupLinkRepository` en memoria con `note` y `commentCount`; verificar con sus specs.
- [ ] 2.4 [backend] `MongoGroupLinkCommentRepository.create` y `delete`: transacción con `$inc` sobre la relación (alta: `matchedCount === 0` → aborta con `LinkNotFound`; borrado: `$inc: -1` solo si `deletedCount === 1`); verificar con integración: contador correcto tras altas y borrados, y alta sobre una relación inexistente sin dejar comentario.
- [ ] 2.5 [backend] `MongoGroupLinkCommentRepository.page` (cursor `(createdAt, _id)` de `link-cursor.ts`) y `latestByLinks(groupId, linkIds)` (una agregación con `$topN` n=2); verificar con integración: 45 comentarios en 20+20+5 sin saltos, los dos últimos por link, links sin comentarios ausentes y `explain` sobre el índice de 2.2.
- [ ] 2.6 [backend] `MongoGroupLinkRepository`: `share` guarda `note` solo al crear, `setNote`, `listByGroup` proyecta `note` y `commentCount`, y retirada con sesión junto a `deleteByRelation` en una transacción; verificar con integración de "La nota del primero se queda" y "Todo o nada" (borrado de comentarios forzado a fallar).
- [ ] 2.7 [backend] `GroupLinksDeletionHook` borra `group_link_comments` por `groupId` antes que las relaciones, con la sesión recibida; verificar con integración de "Grupo borrado sin comentarios huérfanos", "Los comentarios de otro grupo siguen" y "Si falla la limpieza no se borra nada".
- [ ] 2.8 [backend] Integración de la carrera "Comentar mientras se quita": 20 repeticiones de alta y retirada concurrentes, sin ningún comentario huérfano y con respuestas `201` o `404 link_not_found`.

## 3. Casos de uso en `links`

- [ ] 3.1 [backend] `LINK_LIMITER` con la clave `{ kind: 'comment', userId }` (`links:comment:<userId>`, 30 por 15 min, falla abierto) en `CounterLinkLimiter` y en su doble; verificar con unitarios de límite, `refund` y contador caído.
- [ ] 3.2 [backend] `PostGroupLinkComment`: pertenencia (`memberIdsOf`), validación, relación, límite contado tras validar y antes de escribir, alta, `refund` si la escritura falla y aviso tras confirmar; verificar con unitarios de "Comentar una oferta del grupo", "Extraño no comenta", "Link que no está en el grupo", "Lo rechazado no gasta" y "Redis caído al comentar".
- [ ] 3.3 [backend] `DeleteGroupLinkComment`: pertenencia, `comment_not_found` (inexistente, de otro link o grupo, mal formado), `forbidden` si no es el autor (también el owner), borrado y aviso; verificar con unitarios de "Borrar el propio", "El propietario no borra lo ajeno", "Borrar dos veces" y "Comentario de otro link".
- [ ] 3.4 [backend] `ListGroupLinkComments`: las 4 lecturas fijas de D7, `total` desde `commentCount` y `authorLeft` derivado; verificar con unitarios de "Cada grupo tiene su hilo", "Extraño no lee el hilo" y "Sale del grupo".
- [ ] 3.5 [backend] `ListGroupLinks` con `note` y `comments` (5 lecturas fijas: `memberIdsOf`, página, total, `latestByLinks`, nombres unidos en una llamada); verificar con unitarios de "Tarjeta con tres comentarios", "Link sin comentarios", "Expulsado" y "Lecturas fijas" (llamadas a los dobles contadas con páginas de 2 y 20 links).
- [ ] 3.6 [backend] `SaveLink` con `note`: solo al crear la relación y descartada en `already_there`; `ImportLinks` sin cambios; verificar con unitarios de "Guardar con una nota", "La nota del primero se queda" e "Importar no escribe notas".
- [ ] 3.7 [backend] `UpdateShareNote`: solo `sharedBy` (`forbidden` también para el owner), `null` o vacío la quitan, 280 como máximo nombrando `text`; verificar con unitarios de "Corregir la nota", "Quitar la nota" y "Solo quien compartió".
- [ ] 3.8 [backend] `RemoveGroupLink` sobre la retirada transaccional de 2.6; verificar con unitarios de "Quitar se lleva los comentarios de ese grupo", "Otro grupo no se entera" y "Volver a compartirla empieza de cero".

## 4. Aviso en vivo

- [ ] 4.1 [backend] Puerto `COMMENTS_CHANGED_PUBLISHER` y `RedisCommentsChangedPublisher` sobre `REDIS_APP_CLIENT` (nunca lanza, un `warn` por racha sin cuerpo); verificar con unitarios con un cliente doble que falla y con el contenido publicado (sin `text` ni `authorId`).
- [ ] 4.2 [backend] `RedisCommentNotices` sobre el cliente suscriptor compartido: filtra por canal, valida con el schema estricto, descarta sin registrar contenido y vuelve a pedir el canal en cada `ready`; verificar con unitarios con un suscriptor doble que recibe los dos canales.
- [ ] 4.3 [backend] `DeliverCommentsChanged`: sin lecturas si nadie escucha; si hay conexiones, `memberIdsOf`, relación, 2 últimos y nombres una vez, y envío solo a miembros actuales; verificar con unitarios de "Los miembros se enteran", "Quien ve el link por otro sitio no recibe nada", "Quien salió deja de recibir", "Borrar también avisa" y "Nadie escuchando".
- [ ] 4.4 [backend] `EventStreamBroadcaster` (o un broadcaster hermano) envía `group-link.comments`; `LinksModule` cablea publicador, suscripción y reparto sobre el mismo `REDIS_SUBSCRIBER_CLIENT`; verificar con `links.module.spec.ts` (una sola conexión de suscripción) y `dependency-injection.spec.ts`.
- [ ] 4.5 [backend] Integración con Redis real (patrón de `redis-enrichment-notices.integration.spec.ts`): publicar en una "instancia" llega a otra y el mensaje de Redis no contiene el texto ("El texto no viaja por Redis").

## 5. Presentación y HTTP

- [ ] 5.1 [backend] Tras 1.1, ramas en `api-exception.filter.ts` antes de `LinksError`: `InvalidCommentText` → `validation_error` con `['text']` e `InvalidShareNote` → con `['note']`; verificar con filas nuevas en `api-exception.filter.spec.ts`, más `CommentNotFound` (404) y `CommentDeletionForbidden` (403) por la rama existente.
- [ ] 5.2 [backend] `GroupLinkCommentsController` (`POST` y `GET groups/:id/links/:linkId/comments`), ids de la URL sin pasar por el pipe para el 404 uniforme; verificar por HTTP con integración de los escenarios de 3.2 y 3.4, "Comentario vacío", "Comentario demasiado largo", "Justo en el límite", "HTML como texto" e "Hilo paginado sin saltos ni repetidos".
- [ ] 5.3 [backend] `DELETE groups/:id/links/:linkId/comments/:commentId`; verificar por HTTP los escenarios de 3.3 y "Sin edición" (un `PATCH` responde 404 y no cambia nada).
- [ ] 5.4 [backend] `PATCH groups/:id/links/:linkId/note` en `GroupLinksController` y `note` en `POST /api/links`; verificar por HTTP "Corregir la nota", "Quitar la nota", "Solo quien compartió", "Guardar con una nota", "Nota sin grupo" y "Nota demasiado larga".
- [ ] 5.5 [backend] Integración de pertenencia: "Sale del grupo", "Expulsado", "Fuera del grupo no borra" y "Vuelve y borra", con los endpoints reales de `groups`.
- [ ] 5.6 [backend] Integración del límite: "Ventana agotada" (`429` con `Retry-After`), "Contador caído" (`201`) y "Borrar no cuenta"; y "El texto no se registra" con el capturador de logs de `logger-redaction.spec.ts`.

## 6. Frontend

- [ ] 6.1 [frontend] `core/links/links.api.ts`: `comments`, `postComment`, `deleteComment` y `updateNote`, y `note` en `save`, solo con tipos de `@linkvault/shared`; verificar con `HttpTestingController`.
- [ ] 6.2 [frontend] `EventsChannel` reparte `group-link.comments` por `groupLinkComments`, con una guarda de forma sin zod; verificar con `events.channel.spec.ts` (mensaje válido, malformado y de otro nombre).
- [ ] 6.3 [frontend] `LinksStore`: `note` y `comments` en los items, `applyCommentsChanged` (solo el grupo abierto y links cargados) y `applyEnriched` que conserva `note` y `comments`; verificar con TestBed: "Comentario que llega mientras miras" y "La lectura de la oferta no borra los comentarios".
- [ ] 6.4 [frontend] `LinkCard`: "Nota de <nombre>", 2 últimos (el más antiguo arriba, `pre-line`, fecha relativa), "ya no está en el grupo" y la acción con plural ICU, solo en grupo; verificar con "Tarjeta con nota y comentarios", "Tarjeta sin comentarios", "Autor que se fue", "HTML como texto en pantalla" y "Sin comentarios en la lista privada".
- [ ] 6.5 [frontend] `comments.dialog` (lectura): primera página, "Ver comentarios anteriores", orden cronológico, estado vacío y `404` al abrir; verificar con "Hilo largo", "Hilo vacío" y "La oferta ya no está".
- [ ] 6.6 [frontend] `comments.dialog` (escritura): `textarea` con contador, botón bloqueado, Ctrl/Cmd+Enter, mensajes de `429` y genérico, y lo escrito conservado; verificar con "Publicar", "Demasiado largo", "Demasiados comentarios" y "Un solo envío".
- [ ] 6.7 [frontend] `comments.dialog` (borrar): "Borrar" solo en lo propio, confirmación, `404 comment_not_found` como éxito y botón bloqueado; verificar con "Borrar el propio", "Lo ajeno no se borra", "Ya estaba borrado" y "Cancelar el borrado".
- [ ] 6.8 [frontend] `comments.dialog` en vivo: añade lo nuevo sin duplicar, "Hay comentarios nuevos" si no viene en `latest`, quita lo borrado; verificar con "Con el hilo abierto", "Borrado que llega mientras miras" y "Mi propio comentario, una vez".
- [ ] 6.9 [frontend] `save-link.form`: campo de nota solo en grupo, con contador de 280, y tras `already_there` con nota, "Tu nota no se añadió…" con "Publicarla como comentario"; verificar con "Compartir con nota", "La oferta ya estaba" y "Sin nota en la lista privada".
- [ ] 6.10 [frontend] Editar, añadir o quitar la nota desde la tarjeta, solo para quien compartió; verificar con "Solo quien compartió edita la nota" y un test de guardar y quitar.
- [ ] 6.11 [frontend] Confirmación de quitar un link con el número de comentarios de `comments.count` (plural ICU); verificar con "Quitar un link con comentarios" y los escenarios existentes de `web/links`.
- [ ] 6.12 [frontend] Tras 1.1, marcar todos los textos de D11 y traducirlos en `messages.en.xlf`; verificar con "Traducciones completas".

## 7. Cierre

- [ ] 7.1 [frontend] `JOB_ID_SLOTS.comments = 3` en `apps/web-e2e/src/support/job-ids.ts` y `apps/web-e2e/src/comments.spec.ts`: Ana comparte con nota, Beto la ve y comenta, y Ana ve el comentario y el contador sin recargar; verificar con `pnpm nx e2e web-e2e`.
- [ ] 7.2 [frontend] Ampliar `comments.spec.ts`: Beto borra su comentario y desaparece en la pantalla de Ana; Beto comenta de nuevo, sale del grupo, y Ana, al recargar, ve "ya no está en el grupo"; verificar con `pnpm nx e2e web-e2e`.
- [ ] 7.3 [infra] Revisar que `docs/adr/ADR-026.md` cubre lo implementado (módulo, `commentCount` y carrera, nota, permisos, texto sin reescribir, límite, lecturas fijas, ciclo de vida y aviso en vivo) y corregirlo si algo cambió al implementar; verificar que el proposal lo referencia.
- [ ] 7.4 [infra] `README.md`: comentarios y nota en la tarjeta del grupo, qué ven los miembros y qué pasa al salir; `docs/RUNBOOK.md`: colección `group_link_comments`, cómo recalcular `commentCount` con una agregación, cómo borrar a mano los comentarios de una persona hasta que exista el borrado de cuenta y el canal `events:group-link.comments`; verificar leyendo que las rutas y comandos citados existen.
- [ ] 7.5 [infra] `pnpm nx affected -t lint,typecheck,test --base=main` y `openspec validate --all` en verde; verificar con la salida en archivo.
