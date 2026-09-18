## 1. Contratos y plataforma

- [ ] 1.1 [backend] En `libs/shared/src/schemas/preview.schema.ts`, el origen `pasted` en `previewSourcesSchema` y en su forma resuelta (`by` como `{ userId, displayName }`), `replaced` con su propio `source` (`auto` con `extractor`, o `pasted` con `by` y `at`), y la lectura de un `replaced` sin `source` como `auto`; verificar con tests de los schemas, incluido un `replaced` antiguo sin `source`.
- [ ] 1.2 [backend] `pastedDescriptionRequestSchema` (texto de 1 a 20 000 caracteres, sin `trim` que cambie lo medido) y los códigos `not_a_job_posting` (422) y `extraction_unavailable` (503) en `apiErrorCodeSchema` con sus entradas en `API_ERROR_STATUS`/`API_ERROR_MESSAGES`; verificar con los tests del filtro de errores y `pnpm nx run-many -t typecheck -p shared api worker web`.
- [ ] 1.3 [backend] Mover `scrubContactDetails` de `apps/worker/src/modules/enrichment/domain/contact-scrub.ts` a `libs/shared` con sus tests, y que el worker la importe de ahí; verificar que la suite del worker sigue en verde sin cambios de comportamiento y que el fichero antiguo ya no existe.
- [ ] 1.4 [infra] `PASTE_EXTRACTION_TIMEOUT_MS` (20000) y las variables de IA que `api` pasa a necesitar (`AI_CHAIN`, `AI_MOCK_MODE`, `AI_PROMPTS_DIR`, `AI_FIXTURES_DIR`, `AI_CACHE_TTL_SECONDS`, `AI_QUOTAS` y las de Ollama/OpenRouter) en `api-config.schema.ts`, `.env.example` y `apiTestConfig`, con el mismo rango y significado que en el worker; verificar con los tests de configuración de `api` y el que valida `.env.example`.
- [ ] 1.5 [infra] Escribir `docs/adr/ADR-023.md` con las decisiones no triviales: la IA dentro de `api` y por qué no por la cola (D1), el origen `pasted` y la precedencia de tres niveles con `replaced` que guarda su origen (D2), la regla que se mueve en sus dos copias a la vez (D3), el fallo cerrado del límite de pegados (D5) y el rescate por historial cuando `robots.txt` niega (D7); verificar que `openspec validate --all` pasa y que el proposal lo referencia.

## 2. La regla de precedencia, en sus dos copias

- [ ] 2.1 [backend] Ampliar la tabla de casos de `@linkvault/testing` (`tools/testing/src/links/manual-edit-cases.ts`) con los casos de `pasted`: relectura sobre pegado, pegado sobre automático, pegado sobre pegado, pegado sobre manual, manual sobre pegado y volver a lo pegado; verificar que los dos specs que la recorren fallan con las implementaciones actuales.
- [ ] 2.2 [backend] Precedencia en el worker (`apps/worker/src/modules/enrichment/domain/merge.ts`): el merge automático no sustituye `manual` ni `pasted`, y `applyManualField` guarda en `replaced` el origen de lo que desplaza; verificar con "Una relectura no pisa lo pegado", "Lo manual no se pisa" y la tabla de 2.1.
- [ ] 2.3 [backend] Precedencia en `api` (`apps/api/src/modules/links/domain/preview-edit.ts`): la edición manual guarda el origen de lo desplazado y "volver" recupera un valor pegado con su autor; verificar con "Volver a lo pegado" y la tabla de 2.1.
- [ ] 2.4 [backend] `applyPastedPreview` en el dominio de `api`: pegar sustituye lo `auto` y lo `pasted` anterior y no toca lo `manual`; verificar con "Pegar no pisa lo escrito a mano" y los casos de pegado de la tabla.

## 3. La IA en `api`

- [ ] 3.1 [backend] `api` monta `AiModule` con `forRootAsync`, igual que el worker (ledger en la conexión por defecto, caché en `REDIS_URL`), y la suite de integración sigue arrancando con `AI_CHAIN=mock` y `AI_MOCK_MODE=replay`; verificar que `app.get(RUN_TASK)` existe y que la suite de `api` no abre conexiones nuevas en los tests.
- [ ] 3.2 [backend] Puerto `PASTED_EXTRACTION` en `links/application` y su adaptador sobre `runTask('extract-job')`, con la higiene de contactos aplicada antes, `ctx.userId` de quien pega, `outputLanguage` fijo `es` y el plazo de `PASTE_EXTRACTION_TIMEOUT_MS`; verificar que la entrada que recibe la tarea no lleva el email ni el teléfono sembrados, y que degradación, plazo agotado y cuota superada se convierten en un resultado de "no disponible" sin excepción.

## 4. El caso de uso y el endpoint

- [ ] 4.1 [backend] Caso de uso `paste-description`: permiso de lectura (404) → texto (400) → límite (429, fallo cerrado) → extracción → escritura condicionada por `previewVersion` con reintento si pierde la carrera, estado `enriched`/`partial` y `lastEnrichmentError` limpio; verificar con "Oferta de LinkedIn completada pegando su texto", "Texto que solo da el título", "Link que no se puede ver", "Ventana agotada" y "El contador no responde".
- [ ] 4.2 [backend] Los dos no: `isJobPosting: false` → `422 not_a_job_posting` y la IA no disponible → `503 extraction_unavailable`, sin tocar el link; verificar con "Se pegó otra cosa", "Texto vacío" y "La IA no está disponible".
- [ ] 4.3 [backend] `POST /api/links/:id/pasted` en el controlador de links, con su pipe zod, y el aviso por el canal SSE a las demás pantallas abiertas con el reparto que ya existe; verificar con los escenarios anteriores por HTTP y con un aviso recibido por otro miembro.
- [ ] 4.4 [backend] Prueba de que el texto no se guarda: tras pegar, ni `job_links`, ni `outbox_events`, ni `ai_usage`, ni la caché de IA, ni el registro de fixtures pendientes, ni los logs contienen el texto, el email ni el teléfono sembrados; verificar con "Texto con datos de contacto".

## 5. Rescate por historial

- [ ] 5.1 [backend] En `ExtractPreviewService`, cuando `robots.txt` niega la `displayUrl`, probar las demás URLs de `originalUrls` —las más recientes primero— pidiendo permiso para cada una dentro del mismo turno del host, y descargar la primera permitida, sin cambiar la `displayUrl`; verificar con "El historial tiene la misma vacante sin el parámetro prohibido" y "Todo el historial está prohibido", y que no se pide ninguna URL prohibida.

## 6. La tarea de IA

- [ ] 6.1 [ai] Casos de texto pegado en `libs/ai/src/evals/extract-job/golden.jsonl` —una oferta de LinkedIn copiada de la app, una con ruido de chat alrededor, una en inglés, y una conversación que espera `isJobPosting: false`— sin tocar los siete de páginas; verificar que el golden parsea y cada `expected` valida.
- [ ] 6.2 [ai] Grabar los fixtures de los casos nuevos con `nx run ai:record-fixtures --task=extract-job` contra **Ollama local** y actualizar la línea base en replay en el mismo commit; verificar con `nx run ai:eval-ci`. Si Ollama no tiene el modelo disponible, detenerse y reportarlo.

## 7. Frontend

- [ ] 7.1 [frontend] `LinksApi.pasteDescription` y `LinksStore.pasteDescription`, que reemplaza el link en la lista con la respuesta; verificar con los tests del store.
- [ ] 7.2 [frontend] Diálogo "Pegar la descripción" con la explicación, estado de lectura que impide el doble envío y los tres mensajes de error conservando lo pegado; verificar con "Completar una oferta de LinkedIn", "Se pegó otra cosa" y "Leyendo lo pegado".
- [ ] 7.3 [frontend] La acción en la tarjeta, destacada cuando el motivo es `robots_disallowed` o `blocked`; y el origen "Pegado por <nombre>" en la tarjeta y en el formulario de edición, con "Volver a lo pegado"; verificar con "Lo pegado se distingue" y "Volver a lo pegado".
- [ ] 7.4 [frontend] Marcar los textos i18n nuevos y traducirlos en `messages.en.xlf`; verificar con "Traducciones completas".

## 8. Cierre

- [ ] 8.1 [frontend] Ampliar `apps/web-e2e/src/links.spec.ts` con pegar la descripción en un link de LinkedIn y ver la tarjeta completarse; verificar con `pnpm nx e2e web-e2e` en verde.
- [ ] 8.2 [infra] Documentar en `README.md` y `docs/RUNBOOK.md` el pegado, las variables de IA que ahora lee `api`, el límite y el rescate por historial; verificar leyendo que los comandos y variables citados existen.
- [ ] 8.3 [infra] `pnpm nx run-many -t lint,typecheck,test,build -p api web worker shared ai` y `openspec validate --all` en verde, con tres pasadas de la suite; verificar con la salida en archivo.
