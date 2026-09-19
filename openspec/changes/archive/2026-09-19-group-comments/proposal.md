## Why

Un grupo de LinkVault es hoy una carpeta compartida: guarda las ofertas que circulan por WhatsApp, las lee y deja ver
quién postula. Le falta lo que da valor al grupo, **el contexto humano** que en el chat viaja junto al enlace: "piden
inglés C1", "ya cerró", "esta es la que te dije" (design-v0.2 B3, §5.4). Sin ese contexto, cada miembro tiene que volver
al chat para saber qué opina el resto. ADR-015 fijó comentarios **planos** (texto, autor, fecha) sin hilos ni
reacciones. design-v0.2 §5.4 añadía "sin edición (solo borrar propio)". Este change los entrega (design-v0.2 §6, orden 9)
con una enmienda de la decisión humana del 2026-09-19: el propietario también puede borrar lo ajeno de su grupo (ADR-026).

De la herencia de `job-links` sobre `group_links` solo entra `comment`, que aquí se llama **nota**: una línea que escribe
quien comparte ("esta es la que te dije") y que la tarjeta enseña. `tags` y `pinned` quedan fuera hasta que algo los use.
`settings.defaultVisibility` sale a `public-preview-share`, donde tiene sentido (decisiones humanas del 2026-09-19).

## What Changes

- **Comentarios planos por link y grupo** (`GroupLinkComment`): texto de 1 a 500 caracteres tras normalizar, autor y
  fecha. Solo los miembros actuales del grupo los escriben y los leen. Los borra su autor o el propietario del grupo, sin
  dejar marca. Nadie los edita. Un comentario es del grupo donde se escribió: el mismo link en otro grupo tiene su propio
  hilo.
- **Texto tal como lo escribe el miembro**: no se tocan emails ni teléfonos, porque ese texto no va a la IA ni sale del
  grupo. Se trata siempre como texto plano (el HTML se ve tal cual) y se quitan solo los caracteres de control y los de
  dirección de texto. Nunca va a los logs ni al canal de Redis.
- **La tarjeta del grupo** muestra la nota de quien compartió y los 2 últimos comentarios, cada uno cortado a 2 líneas.
  Su acción dice "Comentar", "Responder" o "Ver los N comentarios", según cuántos haya. El resumen llega dentro de `GET /api/groups/:id/links`, con un
  número fijo de consultas por página, sin N+1. Lleva una `revision` que crece con cada cambio y el `sharedAt` de la
  relación, para ordenar los resúmenes. Borrar un comentario responde con el resumen nuevo. El hilo completo se
  pagina con cursor en `GET /api/groups/:id/links/:linkId/comments`.
- **En vivo**: publicar o borrar un comentario avisa a las pantallas abiertas de los miembros actuales del grupo por el
  canal de Redis/SSE que ya existe. El evento es `group-link.comments`:
  - el aviso interno de Redis lleva solo identificadores;
  - el mensaje SSE lleva el resumen nuevo;
  - el SPA descarta los resúmenes más viejos que el que ya tiene.
  Si el aviso no sale, el comentario se guarda igual.
- **Límite**: 30 comentarios por persona cada 15 min, con el contador de plataforma (`429 too_many_attempts` con
  `Retry-After`). Falla abierto, y se devuelve el intento si el comentario no llega a guardarse. Borrar no cuenta.
- **Ciclo de vida**:
  - Al salir del grupo o ser expulsado, los comentarios se quedan con el nombre del autor y la marca "ya no está en el
    grupo". Si la persona vuelve, desaparece la marca y puede borrarlos.
  - Quitar el link del grupo borra sus comentarios y su nota en la misma transacción.
  - Borrar el grupo también los borra, desde el hook de `links` en `GroupDeletionHooks` (ADR-021 §6).
- **Nota al compartir** (`group_links.note`): opcional, de hasta 280 caracteres. Solo entra con `POST /api/links` y
  `groupId`, y solo si la relación es nueva; importar un chat no admite nota. No se edita: la quitan quien compartió o el
  propietario (`DELETE /api/groups/:id/links/:linkId/note`).
- **Frontend**:
  - nota y comentarios en la tarjeta del detalle de grupo;
  - un diálogo con el hilo (escribir, ver anteriores, borrar), a pantalla completa en móvil;
  - la actualización en vivo;
  - el campo de nota al guardar y el aviso "Tu nota no se añadió…" cuando el link ya estaba;
  - "Quitar la nota".

  Textos en ES y EN.

## Capabilities

### New Capabilities
- `links/group-comments`: comentar, leer el hilo paginado, borrar (el autor o el propietario), sin edición,
  normalización del texto, límite por persona, resumen de la tarjeta con su revisión y sin N+1, autores que ya no están, y
  qué pasa con los comentarios cuando el link sale del grupo.
- `web/group-comments`: nota y comentarios en la tarjeta, el hilo, escribir y borrar, la actualización en vivo, la nota
  al compartir y su retirada, y sus textos.

### Modified Capabilities
- `links/sharing`:
  - cambian "Guardar un link" (nota, normalizada primero), "Compartir sin duplicar" (la nota del primero no cambia),
    "Listado de links de un grupo" (nota y resumen de comentarios), "Listado de links privados" (sin nota ni
    comentarios) y "Quitar un link de un grupo o de la lista privada" (se lleva sus comentarios);
  - se añade el requisito "Nota de quien comparte".
- `groups/group-management`: se añade el requisito "El borrado se lleva los comentarios".
- `platform/realtime`:
  - cambia "Cada quien recibe solo lo suyo" (remite a los destinatarios más estrictos de los comentarios);
  - se añade el requisito "Aviso de comentarios de un link en un grupo".
- `web/links`: cambia "Quitar un link desde el SPA" (la confirmación nombra los comentarios).

## Impact

- **Código**:
  - `apps/api/src/modules/links/`: dominio, casos de uso, repositorio y controlador de comentarios; nota y contadores en
    `group_links`; retirada transaccional; hook de borrado ampliado; publicador y suscriptor del aviso nuevo.
  - `apps/api/src/presentation/http/api-exception.filter.ts`.
  - `libs/shared/src/`: contratos de comentarios y nota, evento `GroupLinkCommentsChanged.v1`, normalización del texto y
    `comment_not_found`.
  - SPA: `apps/web/src/app/core/links/`, `core/events/`, `features/links/`, `features/groups/` y `messages.*.xlf`.
- **API**:
  - nuevos: `POST|GET /api/groups/:id/links/:linkId/comments`,
    `DELETE /api/groups/:id/links/:linkId/comments/:commentId` y `DELETE /api/groups/:id/links/:linkId/note`;
  - cambian: `POST /api/links` (acepta `note`) y `GET /api/groups/:id/links` (`note` y `comments`).
- **Datos**:
  - colección nueva `group_link_comments`, con índice `{ groupId, linkId, createdAt: -1, _id: -1 }`;
  - `group_links` suma `note?`, `commentCount` y `commentsRevision`, sin tocar sus índices;
  - no hay migración: un documento sin esos campos se lee como "sin nota, 0 comentarios, revisión 0".
- **Tiempo real**: canal de Redis `events:group-link.comments` y evento SSE `group-link.comments`. Nada pasa por el
  outbox, porque este change no encola trabajo (ADR-009).
- **ADRs**:
  - implementa ADR-015 en su parte de comentarios;
  - enmienda design-v0.2 §5.4 (el propietario borra lo ajeno) y se aparta del nombre `comment` de docs/design.md;
  - cumple ADR-021 §6 y ADR-024 (Consecuencias);
  - **ADR-026** registra las decisiones no triviales.
- **Manifiesto** (`openspec-changes.yaml`):
  - `group-comments`: `adrs: [015, 026]`; `settings.defaultVisibility` sale de su alcance y pasa a
    `public-preview-share`;
  - `deploy-prod`: hereda que el borrado de cuenta borre o anonimice sus `group_link_comments`. Ya está escrito en su
    `scope`; la tarea 7.5 lo verifica.
- **Fuera de alcance**:
  - `tags`, `pinned` y `settings.defaultVisibility`;
  - hilos, respuestas, reacciones y menciones;
  - editar comentarios o notas, o dejar marca de un borrado;
  - ordenar el grupo por actividad;
  - notificaciones;
  - enlaces clicables en el texto;
  - el aviso en vivo de la nota y de los links nuevos del grupo;
  - mostrar comentarios en la página pública.
