## 1. Contratos y configuración

- [ ] 1.1 [backend] `libs/shared/src/schemas/preview.schema.ts` con `jobPreviewSchema` (design-v0.2 §4.7), `previewSourceSchema`, `updatePreviewRequestSchema` y el código `preview_field_unknown` en `apiErrorCodeSchema` con sus entradas en `API_ERROR_STATUS`/`API_ERROR_MESSAGES`; verificar con tests de los schemas (modalidad y seniority fuera del enum, `skills` de 41, `summary` de 601, salario con rango invertido) y `pnpm nx run-many -t typecheck -p shared api worker` en verde.
- [ ] 1.2 [backend] Ampliar `jobLinkSummarySchema` con `preview` y `previewSources` opcionales y `libs/shared/src/events/link-enriched.event.ts` con `LinkEnriched.v1`; verificar con un test que un link sin preview sigue validando y que el evento rechaza un `previewVersion` de 0.
- [ ] 1.3 [infra] Variables del enriquecimiento en `worker-config.schema.ts`, `.env.example` y `workerTestConfig`: `ENRICH_FETCH_TIMEOUT_MS` (10000), `ENRICH_MAX_BYTES` (2097152), `ENRICH_DOMAIN_DELAY_MS` (2000), `ENRICH_DEADLINE_MS` (45000), `ENRICH_ROBOTS_TTL_SECONDS` (43200) y `ENRICH_USER_AGENT`; verificar con los tests de configuración del worker y el que valida `.env.example`.
- [ ] 1.4 [infra] Bucket `snapshots` en el `docker-compose.yml` (creación idempotente al arrancar MinIO) y variables `S3_*` leídas por el worker; verificar que `docker compose up -d --wait` deja el bucket creado y que el worker arranca con ellas.
- [ ] 1.5 [infra] Escribir `docs/adr/ADR-022.md` con las decisiones no triviales: idempotencia propia del consumidor por `previewVersion` (D2), preview con procedencia por campo y merge por orden fijo (D4), política de cortesía (D6) y canal SSE publicado por el worker y repartido por `api` (D9); verificar que `openspec validate --all` pasa y que el proposal lo referencia.

## 2. Descarga educada

- [ ] 2.1 [backend] Puerto `ROBOTS` y su implementación con caché en Redis por host y TTL, asumiendo permitido cuando el `robots.txt` no se puede leer; verificar con "robots.txt prohíbe la ruta", "robots.txt cacheado" y un `robots.txt` que responde 500.
- [ ] 2.2 [backend] Puerto `PAGE_FETCHER` y su implementación con `User-Agent` identificable, timeout, tamaño máximo cortando el flujo, máximo de redirecciones y solo `text/html`; verificar con "Respuesta que no es HTML", "Página demasiado grande o demasiado lenta" y una redirección a otro host.
- [ ] 2.3 [backend] Espera mínima entre peticiones al mismo host y concurrencia 1 por dominio con el `group` del `Worker`; verificar con "Una descarga a la vez por dominio" (diez links del mismo dominio) y que dos dominios distintos sí van en paralelo.

## 3. Cadena de extracción

- [ ] 3.1 [backend] `domain/preview-draft.ts` (campos sueltos con su extractor y confianza) y `domain/merge.ts` con las reglas de D4; verificar con "Lo manual no se pisa", "Gana la etapa más fiable" y una tabla de merges (campo ausente, campo vacío, dos automáticos, uno manual y uno automático).
- [ ] 3.2 [backend] `domain/page.ts`: texto limpio de la página, título y host a partir del HTML, sin dependencias de Nest; verificar con fixtures de HTML (con y sin `<main>`, con scripts y estilos que no deben aparecer).
- [ ] 3.3 [backend] Extractor `json-ld` (`JobPosting` de schema.org, incluido dentro de `@graph`); verificar con "La página trae JSON-LD" y fixtures de las plataformas que lo publican.
- [ ] 3.4 [backend] Extractor `metadata` (Open Graph, `<title>`, `description`); verificar con "La página solo trae Open Graph".
- [ ] 3.5 [backend] Extractores por plataforma para las cinco conocidas, con fixtures de HTML anonimizado; verificar que cada uno solo declara `supports` para su plataforma y que ninguno se aplica a una página genérica.
- [ ] 3.6 [backend] Orquestador de la cadena con parada temprana al completar `title` y `company`, el hueco `headless` que no se ejecuta con el flag apagado, y el reparto del plazo por link; verificar con "Headless apagado", "Se descarga lo que escribió la persona" y que la IA no se llama cuando JSON-LD bastó.

## 4. La tarea de IA

- [ ] 4.1 [ai] `libs/ai/src/tasks/extract-job/` con la `AiTask` (`dataSensitivity: 'public'`, salida `jobPreviewSchema`, `sample` para synth) y el prompt `extract-job.v1.md` con front-matter y Mustache; verificar con los tests de la tarea (salida válida, salida que no valida y se repara, y `sample` determinista).
- [ ] 4.2 [ai] Registrar `extract-job` como tarea evaluable y crear `libs/ai/src/evals/extract-job/golden.jsonl` sintético (una por plataforma, una en inglés, una sin empresa, una con salario en rango, una con skills en lista y una página de listado como trampa) con su schema de `expected` y sus métricas de calidad; verificar con el test que exige golden para cada tarea registrada y `nx run ai:eval --task=extract-job --provider=mock` en verde.
- [ ] 4.3 [ai] Grabar la línea base en replay en el mismo commit y comprobar que una métrica bloqueante distinta la hace fallar; verificar con `nx run ai:eval-ci`.
- [ ] 4.4 [ai] Registro de entradas pendientes de fixture del mock en replay (ADR-019 §5), deduplicado, solo en tests, con exclusión para los tests que esperan la ausencia, y `ai:record-fixtures --from-pending`; verificar con los cuatro escenarios de `ai/deterministic-mock`.
- [ ] 4.5 [backend] Extractor `ai:extract-job` que llama a `runTask` con el plazo restante y degrada sin fallar; verificar con "Salida validada", "IA degradada" y "Plazo agotado".

## 5. El consumidor

- [ ] 5.1 [backend] Puerto `LINK_REPOSITORY` del worker (leer link por id, escribir preview condicionado a `previewVersion`) y su implementación en Mongo; verificar con "Dos enriquecimientos a la vez" y que una escritura sobre una versión vieja no modifica nada.
- [ ] 5.2 [backend] Puerto `SNAPSHOT_STORE` y su implementación en MinIO (`snapshots/<linkId>/<previewVersion>.html.gz`); verificar con "Snapshot guardado" y "Almacenamiento caído".
- [ ] 5.3 [backend] Caso de uso `enrich-link` con la idempotencia de D2, los estados de D5 y el motivo de fallo de la lista cerrada; verificar con "Job procesado", "El mismo evento dos veces", "Job de una versión vieja", "Link borrado", "Enriquecido", "Parcial" y "Fallido".
- [ ] 5.4 [backend] `EnrichmentModule` del worker que registra el `Worker` de BullMQ con su retención y sus reintentos, y lo apaga en los tests; verificar con "Job consumido", "Evento republicado tras la retención", "Job que agota sus reintentos" y que la suite del worker no abre Redis.
- [ ] 5.5 [backend] Actualizar el comentario de `BullmqConnectionModule` y el test estructural de `job-links` que afirmaba que no hay consumidor de `enrich-link`; verificar que la suite del worker queda coherente con el escenario nuevo.

## 6. API: preview, edición y eventos

- [ ] 6.1 [backend] Devolver `preview` y `previewSources` en los listados y en el guardado, sin romper los contratos existentes; verificar con "Oferta enriquecida" desde HTTP y que un link `pending` sigue respondiendo igual que antes.
- [ ] 6.2 [backend] `PATCH /api/links/:id/preview` con permiso de lectura del link, origen `manual` y paso a `previewStatus` `manual`; verificar con "Corregir el título", "Link que no se puede ver" y "Campo desconocido".
- [ ] 6.3 [backend] Publicación del aviso en Redis desde el worker y suscripción única por proceso en `api`; verificar con un doble de Redis que el worker publica al terminar y que `api` recibe y resuelve destinatarios.
- [ ] 6.4 [backend] `GET /api/events` (SSE) con el guard global, latido y limpieza al cerrar; verificar con "Suscripción con sesión", "Sin sesión" y "Latido".
- [ ] 6.5 [backend] Reparto por destinatario (miembros del grupo y dueños de la entrada privada); verificar con "Miembro del grupo avisado", "Extraño no avisado", "La tarjeta se entera", "Nadie escuchando" y "El aviso no reemplaza a la base de datos".
- [ ] 6.6 [backend] Comando `api:backfill-enrichment` con límite por ejecución y `jobId` determinista; verificar con "Pendientes reencolados" y "No se duplica lo que ya está en la cola".
- [ ] 6.7 [backend] Rate limit de `POST /api/links/import` por usuario con el mecanismo de `auth` (ventana fija en Redis, `429` con `Retry-After`), heredado del manifiesto; verificar con un test que agota la ventana y otro que comprueba que el límite falla abierto si Redis no responde.

## 7. Frontend

- [ ] 7.1 [frontend] Tarjeta de vacante en `link-list.component` con título, empresa, ubicación, modalidad y seniority cuando los hay, y la etiqueta derivada de la URL cuando no; verificar con "Grupo con links", "Oferta enriquecida" y "Grupo sin links".
- [ ] 7.2 [frontend] Textos de estado: "Sin vista previa todavía", "Vista previa incompleta" y "No pudimos leer esta oferta" con su acción; verificar con "Oferta que no se pudo leer".
- [ ] 7.3 [frontend] Servicio del canal de eventos (`EventSource` con reconexión y apagado al destruirse) y actualización de la tarjeta avisada en `LinksStore`; verificar con "Preview que llega mientras miras" y "Sin canal disponible".
- [ ] 7.4 [frontend] Formulario de edición del preview con el origen de cada campo; verificar con "Corregir el título", "Origen de cada campo" y "Error al guardar".
- [ ] 7.5 [frontend] Marcar los textos i18n nuevos y traducirlos en `messages.en.xlf`; verificar con "Traducciones completas".

## 8. Cierre

- [ ] 8.1 [frontend] Ampliar `apps/web-e2e/src/links.spec.ts` con el preview enriquecido y la edición manual, sirviendo la extracción desde un doble; verificar con `pnpm nx e2e web-e2e` en verde.
- [ ] 8.2 [infra] Documentar en `README.md` y `docs/RUNBOOK.md` el enriquecimiento, las variables nuevas, el comando de backfill y cómo se graban los fixtures pendientes; verificar leyendo que los comandos citados existen.
- [ ] 8.3 [infra] `pnpm nx run-many -t lint,typecheck,test,build -p api web worker shared ai` y `openspec validate --all` en verde, con tres pasadas de la suite para descartar inestabilidad; verificar con la salida en archivo.
