## 1. Contratos y plataforma

- [ ] 1.1 [backend] `libs/shared/src/schemas/preview.schema.ts` con `jobPreviewSchema` (design-v0.2 §4.7, estricto) y `storedPreviewSchema` (`.partial()`) más `previewSourcesSchema` y los motivos de fallo de D5; verificar con tests de los schemas (modalidad y seniority fuera del enum, `skills` de 41, `summary` de 601, un preview solo con `title` que valida contra el guardado y NO contra el estricto).
- [ ] 1.2 [backend] Códigos `preview_field_unknown` y `enrichment_not_retryable` en `apiErrorCodeSchema` con sus entradas en `API_ERROR_STATUS`/`API_ERROR_MESSAGES`, y `updatePreviewRequestSchema`; verificar con los tests del filtro de errores y `pnpm nx run-many -t typecheck -p shared api worker` en verde.
- [ ] 1.3 [backend] Ampliar `jobLinkSummarySchema` con `preview`, `previewSources` y `lastEnrichmentError` opcionales y crear `libs/shared/src/events/link-enriched.event.ts` con `LinkEnriched.v1`; verificar que un link sin preview sigue validando y que el evento rechaza un `previewVersion` de 0.
- [ ] 1.4 [infra] Variables del enriquecimiento en `worker-config.schema.ts`, `.env.example` y `workerTestConfig`: `ENRICH_FETCH_TIMEOUT_MS` (10000), `ENRICH_MAX_BYTES` (2097152), `ENRICH_DOMAIN_DELAY_MS` (2000), `ENRICH_DEADLINE_MS` (45000), `ENRICH_ROBOTS_TTL_SECONDS` (43200), `ENRICH_USER_AGENT` y `ENRICH_CONCURRENCY` (4); verificar con los tests de configuración del worker y el que valida `.env.example`.
- [ ] 1.5 [infra] Dependencias del enriquecimiento con su versión y su motivo: parser de HTML para `infrastructure/html/`, parser de `robots.txt` y cliente de objetos para MinIO; verificar que `pnpm install` deja el lockfile limpio, que ninguna entra en `domain/` y que `nx run-many -t build` sigue en verde.
- [ ] 1.6 [infra] Bucket `snapshots` creado de forma idempotente al levantar MinIO, con regla de expiración a 30 días, y sus `S3_*` leídas por el worker; verificar que `docker compose up -d --wait` deja el bucket con su regla y que el worker arranca con ellas.
- [ ] 1.7 [infra] Escribir `docs/adr/ADR-022.md` con las decisiones no triviales de este change: idempotencia por `previewVersion` incluida la edición manual (D2), procedencia por campo con dos reglas de merge y valor desplazado (D4), motivos honestos y la medición de `robots.txt` que deja fuera los adaptadores por plataforma (D3/D5), cortesía con mutex por host en Redis en vez de los grupos de BullMQ Pro (D6), `outputLanguage` fijo por ser el preview compartido (D7), SSE leído con `fetch` en vez de `EventSource` (D9), quién puede editar el preview y por qué el snapshot se conserva 30 días; verificar que `openspec validate --all` pasa y que el proposal lo referencia.

## 2. Descarga educada

- [ ] 2.1 [backend] Puerto `ROBOTS` y su implementación con caché en Redis por host, grupo aplicable con respaldo en `*`, `Crawl-delay` y "permitido" por defecto cuando no se puede leer; verificar con "robots.txt prohíbe la ruta", "robots.txt cacheado", "robots.txt que no es texto" y un `robots.txt` que responde 500.
- [ ] 2.2 [backend] Puerto `PAGE_FETCHER` y su implementación con `User-Agent` identificable, timeout, tamaño máximo cortando el flujo, máximo de redirecciones y solo `text/html`; verificar con "Respuesta que no es HTML", "Página demasiado grande o demasiado lenta" y una redirección a otro host.
- [ ] 2.3 [backend] Puerto `HOST_MUTEX` sobre Redis (`SET NX PX`) y espera efectiva `max(configurada, Crawl-delay)`, con `job.moveToDelayed` cuando el host está ocupado; verificar con "Una descarga a la vez por dominio" (diez links del mismo dominio), "El sitio pide más espera de la configurada" y que dos dominios distintos sí van en paralelo.

## 3. Cadena de extracción

- [ ] 3.1 [backend] `infrastructure/html/page-content.ts`: del HTML a `PageContent { title, text, metaTags, jsonLdBlocks }`, con el texto limpio ya sin `mailto:`, `tel:`, emails ni teléfonos (D7); verificar con fixtures de HTML (con y sin `<main>`, scripts y estilos fuera, atributos en cualquier orden) y un test que comprueba que el texto no contiene el email ni el teléfono del aviso.
- [ ] 3.2 [backend] `domain/preview-draft.ts` (campos sueltos con su extractor) y `domain/merge.ts` con las dos reglas de D4 y el valor desplazado; verificar con "Lo manual no se pisa", "Gana la etapa más fiable", "Reenriquecimiento con datos nuevos", "Se guarda lo que la edición desplazó" y una tabla de merges (campo ausente, campo vacío, dos automáticos, manual contra automático).
- [ ] 3.3 [backend] Extractor `json-ld` (`JobPosting` de schema.org, incluido dentro de `@graph`); verificar con "La página trae JSON-LD" y un fixture real anonimizado de Trabajopolis.
- [ ] 3.4 [backend] Extractor `metadata` (Open Graph, `<title>`, `description`, `og:image`); verificar con "La página solo trae Open Graph" y un fixture real anonimizado de Get on Board.
- [ ] 3.5 [backend] Orquestador de la cadena con parada temprana al completar `title` y `company`, el hueco `headless` que no se ejecuta con el flag apagado y el reparto del plazo por link; verificar con "Headless apagado", "Se descarga lo que escribió la persona", "Hace falta la IA" y que la IA no se llama cuando JSON-LD bastó.

## 4. La tarea de IA

- [ ] 4.1 [ai] `libs/ai/src/tasks/extract-job.task.ts` y `libs/ai/src/infrastructure/prompts/extract-job.v1.md`, con `dataSensitivity: 'public'`, salida `jobPreviewSchema`, entrada recortada a 24 000 caracteres en su `inputSchema`, `outputLanguage` fijo `es` y `sample` para synth; verificar con los tests de la tarea (salida válida, salida que no valida y se repara, `sample` determinista) y con `source-tree.spec.ts` en verde.
- [ ] 4.2 [ai] Registrar `extract-job` como tarea evaluable con su schema de `expected` y sus métricas (`field_accuracy` de `title`/`company`/`modality`, `skills_recall`, `skills_precision`); verificar con el test que exige golden para cada tarea registrada y viceversa.
- [ ] 4.3 [ai] `libs/ai/src/evals/extract-job/golden.jsonl` con los siete casos de D8 (Trabajopolis, Get on Board, empresa genérica, uno en inglés, uno sin empresa, uno con salario en rango y una página de listado como `not_a_job`); verificar que el golden parsea y que cada caso tiene `expected` válido.
- [ ] 4.4 [ai] Grabar los fixtures del golden con `nx run ai:record-fixtures --task=extract-job` contra **Ollama local** (nunca un proveedor externo, no autorizado en este change); verificar que `libs/ai/src/infrastructure/fixtures/extract-job/` tiene un fichero por caso. Si Ollama no tiene el modelo disponible, detenerse y reportarlo en vez de improvisar.
- [ ] 4.5 [ai] Grabar la línea base en replay en el mismo commit y comprobar que una métrica bloqueante distinta la hace fallar; verificar con `nx run ai:eval --task=extract-job --provider=mock` y `nx run ai:eval-ci`.
- [ ] 4.6 [ai] Registro de entradas pendientes de fixture escrito por `runTask` (no por el mock, que no conoce el idioma), en JSONL append-only, deduplicado al consumir, solo en tests, con exclusión para los tests que esperan la ausencia y redacción para tareas `personal`; verificar con los cuatro escenarios de `ai/deterministic-mock` y con dos archivos de test en paralelo.
- [ ] 4.7 [ai] `ai:record-fixtures --from-pending` que graba lo anotado; verificar con un registro de dos entradas y un proveedor doble.
- [ ] 4.8 [backend] Extractor `ai:extract-job` que llama a `runTask` con el plazo restante y degrada sin fallar; verificar con "Salida validada", "IA degradada" y "Plazo agotado".

## 5. El consumidor

- [ ] 5.1 [backend] Forma única de `preview`/`previewSources` derivada de `libs/shared` para los dos schemas de Mongoose (el de `api` y el del worker), con test tabular que compara sus claves; verificar que añadir un campo en `libs/shared` rompe el test si solo se refleja en uno.
- [ ] 5.2 [backend] Puerto `LINK_REPOSITORY` del worker (leer link por id, escribir preview condicionado a `previewVersion`) y su implementación en Mongo; verificar con "Dos enriquecimientos a la vez" y que una escritura sobre una versión vieja no modifica nada.
- [ ] 5.3 [backend] Puerto `SNAPSHOT_STORE` y su implementación en MinIO, escribiendo **después** de ganar la escritura condicionada; verificar con "Snapshot guardado", "Almacenamiento caído" y que la ejecución perdedora no deja objeto.
- [ ] 5.4 [backend] Caso de uso `enrich-link`: idempotencia de D2; verificar con "Job procesado", "El mismo evento dos veces", "Job de una versión vieja", "Link borrado" y "Edición durante un enriquecimiento".
- [ ] 5.5 [backend] Estados y motivos de D5 en el caso de uso; verificar con "Enriquecido", "Parcial", "Fallido", "La bolsa prohíbe la lectura", "La bolsa nos bloquea" y "Lo compartido no era una oferta".
- [ ] 5.6 [backend] `EnrichmentModule` del worker: `Worker` con `ENRICH_CONCURRENCY`, `lockDuration` por encima de `ENRICH_DEADLINE_MS`, gzip asíncrono, retención y reintentos, apagado en los tests; verificar con "Job consumido", "Cola sin consumidor" (worker apagado, job esperando, procesado al arrancar) y que la suite del worker no abre Redis.
- [ ] 5.7 [backend] Listener `failed` que, agotados los reintentos, deja el link en `failed` con el motivo de reintentos agotados; verificar con "Job que agota sus reintentos" y "Evento republicado tras la retención".
- [ ] 5.8 [backend] Actualizar los comentarios que este change vuelve falsos: `BullmqConnectionModule`, `enrich-link-queue.ts`, el comentario de `previewStatus` en `libs/shared/src/schemas/link.schema.ts` y el test estructural `no-enrich-link-consumer.spec.ts`; verificar que la suite del worker queda coherente con el escenario nuevo.

## 6. API: preview, edición, eventos y límites

- [ ] 6.1 [backend] Índices `{ linkId: 1 }` en `group_links` y `user_links` y `{ previewStatus: 1, _id: 1 }` en `job_links`, con su test de índices; verificar que las consultas del reparto y del backfill los usan (`explain` sin COLLSCAN).
- [ ] 6.2 [backend] Devolver `preview`, `previewSources` y `lastEnrichmentError` en los listados y en el guardado; verificar con "Oferta enriquecida" desde HTTP y que un link `pending` sigue respondiendo como antes.
- [ ] 6.3 [backend] `PATCH /api/links/:id/preview` con permiso de lectura del link, origen `manual`, valor desplazado, incremento de `previewVersion` y vuelta atrás por campo; verificar con "Corregir el título", "Link que no se puede ver", "Campo desconocido" y "Volver a lo extraído".
- [ ] 6.4 [backend] `POST /api/links/:id/enrich` con su acotación por link y ventana, y el rechazo de los motivos no reintentables; verificar con "Reintento aceptado", "Reintento inútil" y "Demasiados reintentos".
- [ ] 6.5 [backend] Mover la implementación del limitador de intentos a `apps/api/src/infrastructure/limits/` y que `auth` lo consuma desde allí por su token; verificar que la suite de `auth` pasa sin cambios de comportamiento y que el lint de módulos sigue en verde.
- [ ] 6.6 [backend] Límite de `POST /api/links/import` por usuario con ese limitador; verificar con "Ventana agotada", "El contador no responde" y "Guardar uno a uno no cuenta".
- [ ] 6.7 [backend] Publicación del aviso en Redis desde el worker y suscripción única por proceso en `api`; verificar con un doble de Redis que el worker publica al terminar y que `api` recibe y resuelve destinatarios.
- [ ] 6.8 [backend] `GET /api/events` (SSE) autenticado por cabecera, con latido y limpieza al cerrar; verificar con "Suscripción con sesión", "Sin sesión", "Latido", "Credenciales fuera de la URL" y "Sesión caducada al reconectar".
- [ ] 6.9 [backend] Reparto por destinatario; verificar con "Miembro del grupo avisado", "Extraño no avisado", "La tarjeta se entera", "Nadie escuchando" y "El aviso no reemplaza a la base de datos".
- [ ] 6.10 [backend] Comando `api:backfill-enrichment` con `--limit` y `--status`, cola propia, borrado del job terminal antes de reencolar y exclusión de los motivos no reintentables; verificar con "Pendientes reencolados", "No se duplica lo que ya está en la cola", "Job terminal que estorba" y "Rescate de los transitorios".

## 7. Frontend

- [ ] 7.1 [frontend] Tarjeta de vacante con título, empresa, ubicación, modalidad y seniority cuando los hay, y la etiqueta derivada de la URL cuando no; verificar con "Grupo con links", "Oferta enriquecida" y "Grupo sin links".
- [ ] 7.2 [frontend] Salario formateado, "Publicada hace N días" y "Cierra el <fecha>", sin destacar el salario cuando su origen es la IA; verificar con "Oferta con salario y fechas".
- [ ] 7.3 [frontend] Textos de estado derivados de los campos y del motivo, con las acciones que corresponden a cada uno; verificar con "Oferta que no se pudo leer", "Bolsa que no permite la lectura" y "Lo compartido no era una oferta".
- [ ] 7.4 [frontend] Servicio del canal de eventos con `fetch` + `ReadableStream`, el token del interceptor, reconexión con espera creciente y apagado al destruirse; verificar con "Preview que llega mientras miras" y "Sin canal disponible".
- [ ] 7.5 [frontend] Actualización de la tarjeta avisada en `LinksStore`, contador "N de M listas" y recarga al recuperar el foco de la pestaña; verificar con "Progreso de una importación" y que la recarga no duplica items.
- [ ] 7.6 [frontend] Formulario de edición con el origen de cada campo y "Volver a lo extraído"; verificar con "Corregir el título", "Origen de cada campo", "Volver a lo extraído" y "Error al guardar".
- [ ] 7.7 [frontend] Quién escribió cada dato en la tarjeta y acción de reintentar en los motivos transitorios; verificar con "Quién lo escribió, en la tarjeta" y "Reintento aceptado" desde la UI.
- [ ] 7.8 [frontend] Marcar los textos i18n nuevos y traducirlos en `messages.en.xlf`; verificar con "Traducciones completas".

## 8. Cierre

- [ ] 8.1 [frontend] Ampliar `apps/web-e2e/src/links.spec.ts` con el preview enriquecido, la edición manual y el reintento, sirviendo la extracción desde un doble; verificar con `pnpm nx e2e web-e2e` en verde.
- [ ] 8.2 [infra] Documentar en `README.md` y `docs/RUNBOOK.md` el enriquecimiento, las variables nuevas, el comando de backfill, la grabación de fixtures pendientes y qué bolsas no permiten la lectura automática; verificar leyendo que los comandos citados existen.
- [ ] 8.3 [infra] `pnpm nx run-many -t lint,typecheck,test,build -p api web worker shared ai` y `openspec validate --all` en verde, con tres pasadas de la suite para descartar inestabilidad; verificar con la salida en archivo.
