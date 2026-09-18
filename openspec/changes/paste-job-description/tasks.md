## 1. Contratos y plataforma

- [ ] 1.1 [backend] En `libs/shared/src/schemas/preview.schema.ts`, el origen `pasted` (con `by`, `at` y `extractor`) en `previewSourcesSchema` y en su forma resuelta, y `replaced` como la entrada desplazada completa sin su propio `replaced`, leyendo un `replaced` antiguo sin `source` como `auto`; verificar con tests de los schemas, incluido un `replaced` antiguo, y actualizar el comentario que dice que `extractor` y `by` no conviven.
- [ ] 1.2 [backend] En `libs/shared`, la precedencia como función pura `mayOverwrite(previo, entrante)` (`manual` > `pasted` > `auto`) y el filtro de valores vacíos del worker (`draftFrom`, `saysSomething`, `hasRequiredFields`) movido desde `apps/worker/.../domain/preview-draft.ts`, que pasa a importarlos; verificar con una tabla de todos los pares de orígenes y con la suite del worker sin cambios de comportamiento.
- [ ] 1.3 [backend] Mover `scrubContactDetails` de `apps/worker/.../domain/contact-scrub.ts` a `libs/shared` con sus tests, sin cambiar su comportamiento; verificar que la suite del worker sigue en verde y que el fichero antiguo ya no existe.
- [ ] 1.4 [backend] `pastedDescriptionRequestSchema` (texto no vacío tras `trim`, hasta 20 000 caracteres con `text_too_long`, y `title`/`company` opcionales) y los códigos `not_a_job_posting` (422), `extraction_unavailable` (503) y `ai_quota_exceeded` (429) en `apiErrorCodeSchema` con sus entradas en `API_ERROR_STATUS`/`API_ERROR_MESSAGES`; verificar con los tests del filtro y `pnpm nx run-many -t typecheck -p shared api worker web`.
- [ ] 1.5 [infra] Configuración de IA de `api` validada con `parseAiConfig` de `libs/ai` al estilo de `loadWorkerConfigOrExit`, más `PASTE_EXTRACTION_TIMEOUT_MS` (20000), en `.env.example` y en la configuración de test (`AI_CHAIN=mock`, `AI_MOCK_MODE=replay`); verificar con los tests de configuración de `api` y el que valida `.env.example`.
- [ ] 1.6 [infra] El webpack de `api` copia `libs/ai/src/infrastructure/prompts` a sus assets como el del worker; verificar arrancando `dist/apps/api/main.js` desde fuera de la raíz del repo con `AI_PROMPTS_DIR` apuntando a los assets.
- [ ] 1.7 [infra] Escribir `docs/adr/ADR-023.md` con las decisiones no triviales: la IA dentro de `api` y por qué no por la cola (D1), el texto pegado como dato personal con su propia tarea (D2), la precedencia de tres niveles en una sola función y `replaced` como entrada completa (D3), códigos, límite y devolución del intento (D5), estado derivado de los campos y motivo conservado (D6), y el rescate por historial con su disparador (D7); verificar que `openspec validate --all` pasa y que el proposal lo referencia.

## 2. Persistencia del origen nuevo

- [ ] 2.1 [backend] Los dos esquemas de Mongoose de `job_links` (`apps/api/.../preview.schemas.ts` y `apps/worker/.../persistence/preview.schemas.ts`) admiten el origen `pasted` y el `replaced` completo, con `PREVIEW_REPLACED_KEYS` actualizado; verificar con los dos tests tabulares y con un test de integración que guarda "manual sobre pegado" y lo lee sin perder `source`, `by` ni `at`.
- [ ] 2.2 [backend] El mapper resuelve a `{ userId, displayName }` el `by` de lo pegado y el de `replaced`, en la misma consulta única de nombres; verificar que listar 20 links con campos pegados y manuales hace una sola consulta al directorio.
- [ ] 2.3 [backend] El worker conoce `originalUrls`: en su esquema, en su puerto y en el link que la cadena recibe; verificar con los tests del repositorio del worker.

## 3. La regla de precedencia

- [ ] 3.1 [backend] Ampliar la tabla de `@linkvault/testing` (`tools/testing/src/links/manual-edit-cases.ts`) con los casos de `replaced` que traen los orígenes nuevos: manual sobre pegado, pegado sobre pegado, pegado sobre automático, y volver a cada uno; verificar que los specs que la recorren fallan con el código actual.
- [ ] 3.2 [backend] El merge del worker usa `mayOverwrite` y no sustituye `manual` ni `pasted`; una lectura fallida sobre un preview con campos pegados o manuales deriva el estado de los campos y registra el motivo; `applyManualField` pasa a helper de test; verificar con "Una relectura no pisa lo pegado", "Lo manual no se pisa" y "Una lectura fallida no borra lo pegado".
- [ ] 3.3 [backend] La edición manual de `api` guarda en `replaced` la entrada desplazada completa y "volver" la recupera con su origen y autor; verificar con "Volver a lo pegado", "Volver a lo extraído" y la tabla de 3.1.
- [ ] 3.4 [backend] `applyPastedPreview` en el dominio de `api`: solo escribe campos con valor, usa `mayOverwrite`, no toca un campo `manual` ni su `replaced`, y guarda lo desplazado; verificar con "Pegar no pisa lo escrito a mano", "Pegar no deja huecos", "La oferta equivocada, deshecha" y "Volver a lo leído de la página".

## 4. La tarea de IA

- [ ] 4.1 [ai] `libs/ai/src/tasks/extract-pasted-job.task.ts` y `libs/ai/src/infrastructure/prompts/extract-pasted-job.v1.md` (derivado del de `extract-job`, con la regla de no reproducir nombres de personas en `summary`), con `dataSensitivity: 'personal'`, la misma salida que `extract-job` y `sample` para synth; verificar con los tests de la tarea y con que una cadena con un proveedor externo sin consentimiento no lo elige.
- [ ] 4.2 [ai] Registrar `extract-pasted-job` como evaluable y crear su golden con los inputs **ya pasados por `scrubContactDetails`**: cuerpo copiado de la app de LinkedIn sin título ni empresa, con ruido de la app ("Solicitud sencilla", "hace 2 semanas", "X solicitantes") y el nombre del reclutador; una oferta con ruido de chat alrededor; una en inglés con `expected` en español; y una conversación que espera `isJobPosting: false`; con una métrica que falle si `summary` contiene un nombre de persona sembrado; verificar que el golden parsea y cada `expected` valida.
- [ ] 4.3 [ai] Grabar sus fixtures con `nx run ai:record-fixtures --task=extract-pasted-job` contra **Ollama local** y su línea base en replay, en el **mismo commit** que el golden; verificar con `nx run ai:eval-ci`. Si Ollama no tiene el modelo disponible, detenerse y reportarlo.

## 5. La IA en `api`

- [ ] 5.1 [backend] `AppModule` construye `AiModule.forRootAsync` una vez y se lo pasa a `LinksModule.register(aiModule)`; los arranques de la suite de integración reciben su configuración de IA de test; verificar que `RUN_TASK` se resuelve en `LinksModule` y que la suite de `api` no abre conexiones nuevas.
- [ ] 5.2 [backend] Puerto `PASTED_EXTRACTION` y su adaptador sobre `runTask('extract-pasted-job')`: higiene antes, `ctx.userId` de quien pega, `outputLanguage` fijo `es`, plazo de `PASTE_EXTRACTION_TIMEOUT_MS` y aborto si el cliente cierra la conexión; degradación y plazo agotado → "no disponible", cuota superada → "cuota agotada", sin excepción; verificar con dobles de `RUN_TASK` para cada resultado.
- [ ] 5.3 [backend] Fixtures de replay para los textos pegados de la suite de `api`: correrla para llenar el registro de pendientes y grabarlos con `ai:record-fixtures --from-pending` contra **Ollama local**; el escenario de degradación usa un `RUN_TASK` sustituido, nunca `synth`; verificar que la suite de `api` pasa en `replay`. Si Ollama no está, detenerse y reportarlo.

## 6. El caso de uso y el endpoint

- [ ] 6.1 [backend] Caso de uso `paste-description` con el orden de D5: permiso de lectura (404) → texto vacío tras la higiene (422) → límite (503 si el contador no responde, 429 si se agotó) → extracción; `isJobPosting: false` → 422 sin escribir; verificar con "Link que no se puede ver", "Solo había un teléfono", "Ventana agotada", "El contador no responde" y "Se pegó otra cosa".
- [ ] 6.2 [backend] Escritura del pegado: condicionada por `previewVersion`, que sube, rehecha **reutilizando la extracción** si pierde la carrera; estado derivado de los campos; motivo no reintentable conservado; y devolución del intento en un 503; verificar con "Oferta de LinkedIn completada pegando su texto", "Cuerpo sin cabecera, con título y empresa escritos aparte", "Estado tras completar con título y empresa", "El motivo de la bolsa se conserva", "La IA no está disponible", "Cuota de IA agotada" y "Un fallo de la IA no gasta un pegado".
- [ ] 6.3 [backend] `POST /api/links/:id/pasted` en el controlador de links, con su pipe zod y `Retry-After` en 503 y 429; verificar los escenarios de 6.1 y 6.2 por HTTP y "Texto vacío".
- [ ] 6.4 [backend] El pegado y el `PATCH` publican `LinkEnriched` en el canal de Redis que ya existe, sin esperar a que se publique para responder; verificar con "Lo que pega otro miembro también llega" y "Una corrección a mano también llega", y que un Redis caído no hace fallar la respuesta.
- [ ] 6.5 [backend] Prueba de que el texto no se guarda, con una marca única sembrada que ningún fixture reproduce: tras pegar, ni `job_links`, ni `outbox_events`, ni `ai_usage`, ni el registro de pendientes, ni los logs contienen el texto, la marca, el email ni el teléfono, y `summary` no contiene el nombre del reclutador; verificar con "Texto con datos de contacto".

## 7. Rescate por historial

- [ ] 7.1 [backend] En `ExtractPreviewService`, cuando `robots.txt` niega la `displayUrl`, probar las URLs del historial **del mismo host**, sin repetidas y las más recientes primero, dentro del mismo turno, y leer la primera permitida; verificar con "El historial tiene la misma vacante sin el parámetro prohibido", "Todo el historial está prohibido" y "URL del historial en otro host".
- [ ] 7.2 [backend] `saveOneLink`: cuando se guarda una vacante existente con una URL nueva y el link está en `failed` por `robots_disallowed`, pedir una lectura nueva en la misma transacción (versión, `pending`, outbox), como el reintento; verificar con "Se vuelve a guardar la vacante con otra URL" y que guardar la misma URL otra vez no pide nada.

## 8. Frontend

- [ ] 8.1 [frontend] La tarjeta bloqueada sin título dice "<Plataforma> no nos deja leer sus ofertas. Pega su descripción para completarla", con "Pegar la descripción" como acción principal visible y "completar a mano" como secundaria; verificar con "Bolsa que no permite la lectura".
- [ ] 8.2 [frontend] Diálogo de pegado reutilizable que recibe el link: explicación, título y empresa precargados, "Leyendo… puede tardar unos segundos" sin doble envío, y los cuatro mensajes de error conservando lo pegado; verificar con "Completar una oferta de LinkedIn", "Se pegó otra cosa", "Leyendo lo pegado" y "Límite de lecturas del día".
- [ ] 8.3 [frontend] `LinksApi.pasteDescription` y `LinksStore.pasteDescription`, que actualiza el link en cualquier vista; el origen "Descripción pegada por <nombre>" y "Volver a lo anterior" en la tarjeta y en el formulario; verificar con "Lo pegado se distingue" y "Volver a lo pegado".
- [ ] 8.4 [frontend] Marcar los textos i18n nuevos y traducirlos en `messages.en.xlf`; verificar con "Traducciones completas".

## 9. Cierre

- [ ] 9.1 [frontend] Ampliar `apps/web-e2e/src/links.spec.ts` con pegar la descripción en un link de LinkedIn bloqueado y ver la tarjeta completarse, y deshacer un pegado; verificar con `pnpm nx e2e web-e2e` en verde.
- [ ] 9.2 [infra] Documentar en `README.md` y `docs/RUNBOOK.md` el pegado, la IA que ahora ejecuta `api` y sus variables, el límite, la cuota propia de `extract-pasted-job` y el rescate por historial; verificar leyendo que los comandos y variables citados existen.
- [ ] 9.3 [infra] `pnpm nx run-many -t lint,typecheck,test,build -p api web worker shared ai` y `openspec validate --all` en verde, con tres pasadas de la suite; verificar con la salida en archivo.
