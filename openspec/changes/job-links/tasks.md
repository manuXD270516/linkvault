## 1. Contratos y plataforma

- [x] 1.1 [backend] `libs/shared/src/schemas/link.schema.ts` con los schemas y tipos de D8 (incluidos `shared`, `displayUrl`, `listLinksQuerySchema` y `linkPageSchema` con `total`), los códigos `invalid_url`, `text_too_long` y `link_not_found` en `apiErrorCodeSchema` y sus entradas en `API_ERROR_STATUS`/`API_ERROR_MESSAGES`; verificar con tests de los schemas, incluido que los límites de negocio (2048 de URL y 20 000 de texto) **no** los rechaza zod —solo sus cotas de cordura— para que los códigos propios sean alcanzables, y `pnpm nx run-many -t typecheck -p shared api` en verde.
- [x] 1.2 [backend] `libs/shared/src/events/link-created.event.ts` con el contrato versionado del evento y su schema; verificar con un test que valida un evento completo y rechaza uno sin `linkId`.
- [x] 1.3 [infra] Añadir `@nestjs/schedule` como dependencia y las variables `OUTBOX_RELAY_ENABLED` y `OUTBOX_RELAY_INTERVAL_MS` a `api-config.schema.ts`, `.env.example` (`true`/`1000`) y `apiTestConfig` (`false`); verificar con los tests de configuración de api y el que valida `.env.example`.
- [x] 1.4 [infra] Módulo del relay que registra `ScheduleModule.forRoot()` y `BullModule.registerQueue` (con listener de `error` en la cola) y que `AppModule` solo importa cuando `OUTBOX_RELAY_ENABLED`; verificar que con el relay apagado `api` no crea ninguna `Queue` (`app.get(Queue, { optional: true })` es `undefined`) ni abre conexiones a Redis, y que la suite de integración de `api` sigue en verde sin ruido de reintentos.
- [ ] 1.5 [infra] Escribir `docs/adr/ADR-021.md` con las decisiones no triviales de este change: `dedupeKey` unificada como concreción de ADR-008 (en vez de índices parciales), relay del outbox dentro de `api` con backoff y agotamiento por tiempo, colección `user_links`, y cascada del borrado de grupo mediante `GroupDeletionHooks`; verificar que `openspec validate --all` pasa y que el proposal lo referencia.

## 2. Dominio de links

- [x] 2.1 [backend] `domain/url.ts` (normalización de identidad de D2, `urlHash` y `displayUrl`); verificar con "URL normalizada", "Esquema no soportado", una tabla de casos (mayúsculas, `www.`, fragmento, barra final, parámetros de campaña, orden de query) y que el hash es estable ante el orden de los parámetros.
- [x] 2.2 [backend] Canonicalizadores de LinkedIn e Indeed, el `generic` y el registro; verificar con "LinkedIn en sus tres formas", "Plataforma desconocida" y una tabla de URLs reales anonimizadas de cada uno.
- [x] 2.3 [backend] Canonicalizador de Computrabajo; verificar con "Computrabajo con slug variable" y su tabla de URLs reales.
- [x] 2.4 [backend] Canonicalizadores de Trabajopolis y Get on Board; verificar con su tabla de URLs reales por plataforma; si el formato de alguna resulta ambiguo, dejarla como `generic`, anotarlo en el informe y en el manifiesto.
- [x] 2.5 [backend] `domain/job-link.ts` (identidad, `dedupeKey`, estados de preview, `previewVersion` inicial 1, `displayUrl` inmutable, historial acotado a 20), `domain/limits.ts` (2048 de URL y 20 000 de texto, con sus errores) y `domain/errors.ts` con sus `code`; verificar con tests de la clave para plataforma reconocida y desconocida, del estado inicial `pending`, del recorte del historial y de que cada `code` existe en `apiErrorCodeSchema`.
- [x] 2.6 [backend] `domain/link-text.ts` (extracción de URLs de un texto); verificar con "Chat de WhatsApp pegado", "Texto sin URLs", "Enlace que no se puede leer", puntuación de cierre, URLs repetidas que normalizan igual y orden de aparición.

## 3. Persistencia

- [x] 3.1 [backend] Puertos (`JOB_LINK_REPOSITORY`, `GROUP_LINK_REPOSITORY`, `OUTBOX`, `GROUP_MEMBERSHIP`, `LINK_USER_DIRECTORY`, `LINKS_CLOCK`) y dobles en memoria en `application/testing/`; verificar con tests de los dobles (upsert por clave, relación única por grupo, lista privada, eventos acumulados, pertenencia y nombres).
- [x] 3.2 [backend] Schemas de `job_links`, `group_links` y `user_links` con los índices de D1, incluidos los compuestos con `_id` para la paginación; verificar con tests de integración de los índices (`Model.init()`), del único de `dedupeKey` y del único `(groupId, linkId)`.
- [x] 3.3 [backend] `MongoJobLinkRepository` con el upsert por `dedupeKey`, el historial acotado y el reintento de la transacción entera ante 11000 (D3); verificar con "Misma vacante con dos URLs", "Vacantes distintas de la misma plataforma", "Historial acotado" (incluido que `displayUrl` no cambia al recortar) y "Altas simultáneas de la misma URL" (dos peticiones a la vez dejan un documento y ninguna falla).
- [x] 3.4 [backend] `MongoGroupLinkRepository`: upsert de la relación, borrado por grupo y por link, y listado del grupo; verificar con "Dos miembros comparten la misma vacante", "El mismo link en dos grupos" y "Quitar no destruye la vacante".
- [x] 3.5 [backend] Repositorio de la lista privada (`user_links`) con sus mismas operaciones; verificar con tests de integración de alta idempotente, borrado y listado.
- [x] 3.6 [backend] Paginación por cursor opaco `(fecha, _id)` y `total` por conteo, compartidos por ambos listados; verificar con "Paginación sin saltos ni repetidos" (50 links en el mismo instante, páginas de 20), que `total` no depende del tamaño de página y que un cursor manipulado responde `400` con `fields: ['cursor']`.
- [x] 3.7 [backend] `groups-facade-membership.ts` (pertenencia y rol) y `users-facade-link-directory.ts` (nombres visibles), ampliando `GroupsFacade` con `membershipOf(groupId, userId)` y con `name` en `getGroupsOf`; verificar con tests de ambos adaptadores y que el lint entre módulos sigue en verde.

## 4. Outbox

- [x] 4.1 [backend] `infrastructure/outbox/`: schema `outbox_events`, puerto `OUTBOX_CLOCK`, índice parcial `(publishedAt, nextAttemptAt, createdAt)` y `MongoOutbox.append(event, session)` escribiendo explícitamente `publishedAt: null`, `failedAt: null`, `attempts: 0` y `nextAttemptAt: now`; verificar con "Alta con evento" y "Fallo al escribir el evento" en tests de integración con transacción real.
- [x] 4.2 [backend] `OutboxRelay` (intervalo configurable, apagable, publicación con `jobId` determinista, marcado tras publicar, retención de la cola de D6); verificar con "Publicación correcta", "Entrega idempotente" y "Cola caída al guardar".
- [x] 4.3 [backend] Backoff exponencial con `nextAttemptAt` y agotamiento a las 24 h; verificar con "Reintento tras un fallo de la cola", "Corte largo de la cola" y "Evento agotado" (con reloj movible, sin esperas reales).
- [x] 4.4 [backend] Verificar "Cola sin consumidor" de forma estructural: `apps/worker` no registra ningún `Worker` para `enrich-link` (test de arranque o de DI), el link sigue `pending` tras publicarse su evento, y actualizar el comentario de `BullmqConnectionModule`, que hoy dice que el primer job llega con este change.

## 5. Casos de uso y API

- [x] 5.1 [backend] `save-link` (normaliza, canonicaliza, resuelve el `JobLink`, comparte en grupo o en privado, distingue `created` de `shared`, escribe el evento en la misma transacción); verificar con "Guardar en un grupo", "Vacante conocida, nueva en mi grupo", "Guardar en privado", "URL no reconocida", "Compartir sin duplicar" y "Grupo ajeno".
- [x] 5.2 [backend] `alreadyInGroups` con una sola resolución de grupos del usuario (D4); verificar con "El link ya estaba en otro grupo propio", "El link está en un grupo ajeno" y un test que cuenta las consultas para descartar N+1.
- [x] 5.3 [backend] `import-links` (extraer → normalizar → deduplicar → descartar las ya presentes → cortar a 50, una transacción por link, resumen, texto nunca persistido); verificar con "Importar un chat", "Importar sin URLs", "Chat con más de 50 enlaces", "Segunda pasada del mismo chat", "Texto demasiado largo" y "Texto con datos personales".
- [x] 5.4 [backend] `list-group-links` y `list-my-links`; verificar con "Miembro ve los links del grupo", "Extraño no ve los links" y "Lista privada".
- [x] 5.5 [backend] `remove-group-link` y `remove-my-link` (autor u owner, solo la relación); verificar con "Quitar lo que no era una oferta", "El owner limpia el grupo", "Un miembro no quita lo de otro" y "Quitar no destruye la vacante".
- [x] 5.6 [backend] `LinksController` y `GroupLinksController` cableados en `LinksModule` y en `AppModule`, con pipe zod y `@CurrentUser()`; verificar `401` sin token en las seis rutas y que el test de DI de `api` sigue pasando.
- [x] 5.7 [backend] Integración HTTP de guardado e importación; verificar con "Guardar en un grupo", "Guardar en privado", "URL no reconocida", "Grupo ajeno" (cuerpos idénticos con id mal formado), "Importar un chat", "Chat con más de 50 enlaces" y "Texto demasiado largo".
- [x] 5.8 [backend] Integración HTTP de los listados; verificar con "Miembro ve los links del grupo", "Paginación sin saltos ni repetidos", "Extraño no ve los links" y "Lista privada", incluido `total`.
- [x] 5.9 [backend] Integración HTTP de los borrados y traducción de los códigos nuevos en el filtro; verificar con los cuatro escenarios de quitar y tests del filtro para `invalid_url`, `text_too_long` y `link_not_found`.

## 6. Borrado de grupo en cascada

- [x] 6.1 [backend] `GroupDeletionHooks` (clase provista y exportada por `GroupsModule`, con `register` y `runAll`) y su ejecución dentro de la transacción de `deleteGroup`, después de confirmar que el grupo existía (D7b), sin hooks registrados por defecto; verificar que los tests de borrado de `groups` siguen pasando y que un borrado que no encuentra el grupo no ejecuta ningún hook.
- [x] 6.2 [backend] Adaptador de `links` registrado con `register(...)` en el `onModuleInit` de `LinksModule` (que ya importa `GroupsModule`); verificar con "El borrado no destruye las vacantes" y que borrar un grupo deja 0 `group_links` suyos y el `JobLink` intacto.

## 7. Web

- [x] 7.1 [frontend] `core/links/links.api.ts` y `LinksStore` (lista por grupo y privada, paginación por cursor, recarga tras guardar, importar o quitar); verificar con tests de `HttpTestingController` y del store.
- [x] 7.2 [frontend] `link-list.component.ts` con la etiqueta derivada de la URL, el estado "Sin vista previa todavía", apertura en pestaña nueva con `rel="noopener noreferrer"` y los estados vacíos; verificar con "Grupo con links", "Grupo sin links", "Abrir una oferta" y el estado vacío de la vista privada.
- [x] 7.3 [frontend] Formulario de guardar un link con sus mensajes; verificar con "Link guardado", "URL inválida", "Aviso de link repetido", "El link ya estaba en este grupo" y "Vacante conocida compartida por primera vez".
- [x] 7.4 [frontend] Diálogo de importar con contador de caracteres y resumen con plurales; verificar con "Importación con repetidos", "Importación sin enlaces", "Importación recortada a 50" y "Texto demasiado largo".
- [x] 7.5 [frontend] Quitar un link con confirmación y permisos por rol; verificar con "Quitar un enlace que no era una oferta" y "Sin permiso para quitar".
- [x] 7.6 [frontend] Ruta `/mis-links` ("Solo para mí") y su enlace en la barra; verificar con "Vista privada", "Vista privada vacía" y el test de rutas lazy.
- [ ] 7.7 [frontend] Integrar la lista de links en `/grupos/:id` sustituyendo el aviso de links pendientes; verificar con "Grupo sin links todavía" (nuevo contenido) y que el resto de escenarios del detalle siguen pasando.
- [ ] 7.8 [frontend] Confirmación de borrado del grupo con el recuento de ofertas del `total` del listado, con sus plurales y el caso sin ofertas; verificar con "Borrado informado", "Borrado de un grupo en el que estás solo" y actualizar `apps/web-e2e/src/groups.spec.ts` y `group-detail.page.spec.ts`.
- [ ] 7.9 [frontend] Marcar los textos i18n de links, ejecutar `extract-i18n` y traducir `messages.en.xlf`; verificar con "Traducciones completas" y `pnpm nx build web`.

## 8. Cierre

- [ ] 8.1 [frontend] Smoke de navegador en `apps/web-e2e/src/links.spec.ts`: guardar un link en un grupo, abrirlo, pegar un chat con varias URLs y ver el resumen y la lista, quitar uno, y comprobar la vista privada; verificar con `pnpm nx e2e web-e2e` sobre los servidores locales.
- [ ] 8.2 [infra] Actualizar README (sección de links: endpoints, dedupe, importación, outbox y cola) y `openspec-changes.yaml`: en `link-enrichment`, implementar el consumidor (idempotente por sí mismo, no solo por `jobId`), el backfill de los links `pending` si hiciera falta, las plataformas que quedaran como `generic` y el uso de `displayUrl` para descargar; en `group-comments`, `comment`, `tags` y `pinned` de `group_links` y `settings.defaultVisibility`; en `applications-tracking`, la transferencia de propiedad como primera tarea (borrar un grupo ahora destruye ofertas de terceros) y el límite de intentos de `POST /groups/join`; y el rate limit de `POST /links/import`. Verificar que no quedan referencias al aviso "Pronto podrás guardar links en este grupo".
- [ ] 8.3 [infra] Ejecutar `pnpm nx affected -t lint,typecheck,test,build --base=main` con `AI_CHAIN=mock AI_MOCK_MODE=replay` y `pnpm exec openspec validate --all`; verificar que todo pasa en verde.
