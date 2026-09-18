## Why

El dolor de origen es perder ofertas que pasaron por un chat: `groups` ya da el espacio compartido, pero está vacío.
Este change trae el contenido: guardar una URL de empleo, **pegar el chat entero de WhatsApp** y que cada oferta quede
una sola vez aunque varias personas la compartan con URLs distintas (ADR-002 y ADR-008). También deja encolado el trabajo
de enriquecimiento sin poder perderlo (ADR-009), que es lo que consumirá `link-enrichment`.

## What Changes

- **`JobLink` canónico**: una vacante, un documento. La clave de dedupe es `platform:externalJobId` cuando el
  canonicalizador la reconoce y `urlHash` de la URL normalizada cuando no, con un único índice único sobre esa clave
  (concreción de ADR-008, ADR-021). Se conservan las últimas URLs originales, y la primera es la que se abre.
- **Canonicalizadores** de LinkedIn, Computrabajo, Indeed, Trabajopolis y Get on Board, más el genérico por
  `urlHash` (normaliza esquema, host, barra final y quita parámetros de campaña).
- **`GroupLink`**: la relación link↔grupo con quién lo compartió y cuándo. Un link puede estar en varios grupos sin
  duplicarse. Al borrar un grupo, sus `GroupLink` se borran en la misma transacción; el `JobLink` nunca se borra.
- **`POST /links`** para una URL y **`POST /links/import`** para texto plano con varias URLs (el chat pegado), eligiendo
  al guardar si va a un grupo o queda privado.
- **Respuesta con `alreadyInGroups`** (B6): al guardar uno a uno, la API dice en qué otros grupos del usuario ya estaba.
- **Quitar un link** de un grupo (quien lo compartió o el owner) o de la lista privada: se borra la relación, nunca la
  vacante. Sin esto, un chat importado deja ruido irreversible en un espacio compartido.
- **Listados**: links de un grupo (para sus miembros) y links privados propios, con su estado de preview.
- **Outbox**: el alta escribe `job_links`, `group_links` y `outbox_events` en una transacción, y un relay publica a BullMQ
  con `jobId` determinista y reintentos con espera creciente (ADR-009). En este change **no** se registra consumidor: los
  jobs esperan en la cola para que `link-enrichment` los procese, en lugar de descartarse.
- **Frontend**: guardar un link, pegar texto para importar (con el resumen de creados, repetidos, ilegibles y los que no
  cupieron), abrir la oferta en una pestaña nueva, quitar lo que no era una oferta, y las listas del grupo y privada con
  el estado "Sin vista previa todavía".

## Capabilities

### New Capabilities
- `links/job-link`: identidad canónica de una vacante, canonicalización, dedupe y estado del preview.
- `links/sharing`: guardar e importar links en un grupo o en privado, `alreadyInGroups`, listados y quitar la relación.
- `platform/outbox`: escritura transaccional de eventos de integración y su publicación a la cola con entrega al menos
  una vez e idempotencia.
- `web/links`: guardar, importar, abrir, quitar y listar links en el SPA.

### Modified Capabilities
- `groups/group-management`: "Borrado por el owner" pasa a borrar también los `GroupLink` del grupo en la misma
  transacción, dejando intactos los `JobLink`.
- `web/groups`: el detalle deja de anunciar que los links llegan más adelante y muestra la lista; la confirmación de
  borrado dice cuántas ofertas se pierden.

## Impact

- **Código**: `apps/api/src/modules/links/` (domain, application, infrastructure, presentation),
  `apps/api/src/infrastructure/outbox/`, puerto de hooks de borrado en `apps/api/src/modules/groups/`,
  `apps/web/src/app/features/links/`, contratos zod y evento de integración en `libs/shared`.
- **API**: `POST /links`, `POST /links/import`, `GET /groups/:id/links`, `GET /links/mine`,
  `DELETE /groups/:id/links/:linkId`, `DELETE /links/mine/:linkId`.
- **Datos**: colecciones `job_links` (único por `dedupeKey`), `group_links` (único `(groupId, linkId)`), `user_links`
  (lista privada) y `outbox_events`.
- **Cola**: `enrich-link` en BullMQ con `jobId` determinista y retención configurada; sin consumidor todavía.
- **Frontend**: rutas de guardado e importación y listas dentro de `/grupos/:id` y de una vista privada.
- **Dependencias**: `@nestjs/schedule` para el relay; `BullModule` pasa a registrarse también en `api`.
- **ADRs**: implementa ADR-002, ADR-008 y ADR-009, y crea **ADR-021** (clave de dedupe unificada, relay en `api` con
  backoff, `user_links` y cascada del borrado de grupo por puerto de hooks); respeta ADR-012, ADR-017 y ADR-020.
- **Fuera de alcance**: extractores y enriquecimiento del preview y su consumidor (`link-enrichment`), comentarios
  (`group-comments`), postulaciones (`applications-tracking`), página pública (`public-preview-share`),
  `settings.defaultVisibility`, el límite de intentos de `POST /groups/join` y el rate limit de la importación; todo ello
  queda anotado en el manifiesto con la condición que lo dispara.
