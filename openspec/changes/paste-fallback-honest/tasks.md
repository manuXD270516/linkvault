## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos de los casos de test que el
implementador crea. Ninguna prueba llama a un proveedor real: `AI_CHAIN=mock` y `AI_MOCK_MODE=replay` en CI.

- [ ] 0.1 [infra] Q1 respondida por el owner y anotada con fecha:
  - en ADR-060 §1, en una línea que empiece por «Respuesta del owner (Q1), AAAA-MM-DD:»;
  - en `design.md`;
  - y, si la respuesta es (a), (b) o (d), con una línea en ADR-048 §Consecuencias, como hicieron ADR-053 y ADR-055.
    Con (d), la línea nombra la excepción a «Entre PR-1 y PR-2 no se fusiona nada a `main`» de 35b.

  Con (b), el change no pasa de aquí hasta archivar 35c. Con (c), se cierra sin aplicar. Verificar:
  `grep -cE "Respuesta del owner \(Q1\), 20[0-9]{2}-" docs/adr/ADR-060.md` devuelve `1` (antes de anotarla, `0`).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada. Verificar:
  `design.md` lleva la sección del debate de la última iteración, con «Convergencia: SI» y la fecha de la aprobación.

## 1. `libs/ai`: clase del fallo (design D1)

- [ ] 1.1 [ai] `domain/errors.ts`: `ProviderUnavailable` gana `kind`, derivado de `httpStatus`: `429` →
  `rate_limited`; `401`/`402`/`403`/`404` → `rejected`; resto o ausente → `unavailable`. El mensaje sigue sin cuerpo
  ni credencial. Verificar en `domain/errors.spec.ts` (nuevo si no existe):
  - «429 is rate_limited»
  - «401, 402, 403 and 404 are rejected»
  - «5xx and missing status are unavailable»

  Falsación: mapear `404` a `unavailable` y ver caer el segundo; restaurar.
- [ ] 1.2 [ai] Comprobar que los demás proveedores heredan la clase sin cambios. Verificar con un caso por proveedor en
  `ollama.provider.spec.ts`, `openai.provider.spec.ts` y `anthropic.provider.spec.ts`: «a 429 answer throws
  rate_limited» y «a 404 answer throws rejected».

## 2. `libs/ai`: breaker y degradado (design D3, D4)

- [ ] 2.1 [ai] `domain/ports/circuit-breaker.port.ts`: el tipo `ProviderFailure`; `recordFailure(id, failure?)`, que
  sin argumento vale `{ kind: 'unavailable' }`; y `openConditions(): Promise<ReadonlyMap<string, ProviderFailure>>`.
  Lo implementa `InMemoryCircuitBreaker`: todas las clases cuentan igual en la ventana, se recuerda la última y
  `recordSuccess` la borra. Ajustar `RecordingNullCircuitBreaker`, `NullCircuitBreaker` y los dobles de
  `in-memory-ports.ts` y `eval-ports.ts`. Verificar en `in-memory-circuit-breaker.spec.ts`:
  - «five 429 open the circuit like any failure»
  - «remembers the last failure kind of an open circuit»
  - «recordSuccess forgets the remembered kind»
  - «a closed circuit has no condition»

  Falsación: no contar el `rate_limited` en la ventana y ver caer el primero; restaurar.
- [ ] 2.2a [ai] `RedisCircuitBreaker`: guardar la clase del último fallo junto al estado del circuito, con su mismo TTL,
  y borrarla en `recordSuccess`. Verificar en `redis-circuit-breaker.spec.ts`:
  - «remembers the last failure kind (shared between instances)»
  - «recordSuccess forgets the remembered kind»
  - «the kind does not change when the circuit opens»
- [ ] 2.2b [ai] `RedisCircuitBreaker.openConditions()`: lee las clases de los circuitos abiertos y falla abierto.
  Verificar en `redis-circuit-breaker.spec.ts`:
  - «openConditions returns the kind of each open circuit»
  - «openConditions returns an empty map when Redis fails»

  Falsación: lanzar en vez de devolver vacío y ver caer el segundo; restaurar.
- [ ] 2.3 [ai] `openrouter.provider.spec.ts` (sin cambios en `openrouter.provider.ts`): con `fetch` sustituido,
  - «429 throws rate_limited without the body»: el cuerpo repite un prompt sembrado, y ni `String(error)`, ni
    `error.cause`, ni lo que reciba el logger lo contienen;
  - «404 no endpoints throws rejected».

  Falsación: propagar el texto del cuerpo en `cause` y ver caer el primero; restaurar.
- [ ] 2.4 [ai] Documentar en `openrouter.provider.spec.ts`, arriba del bloque de 2.3, la URL de la documentación de
  errores de OpenRouter y la fecha de la consulta, con lo que dice de `429` y del «no endpoints» (`404`). Si no
  confirma el `404`, anotarlo como pendiente en el mismo comentario y en el debate de `design.md`. Verificar:
  `grep -n "openrouter.ai/docs" libs/ai/src/infrastructure/providers/openrouter.provider.spec.ts` devuelve al menos
  una línea.
- [ ] 2.5a [ai] `domain/ai-result.ts`: `AiDegraded.providerCondition?: { kind: 'consent_required' | 'unavailable' |
  'rate_limited' | 'rejected' }`. En `domain/`, una función pura `aggregateProviderCondition(reason, affected)` con la
  agregación de D4. Verificar en `domain/provider-condition.spec.ts`:
  - «unavailable wins over rate_limited and rejected»
  - «rate_limited wins over rejected»
  - «consent wins with no_providers»
  - «consent does not count with providers_failed»
  - «no affected providers give no condition»

  Falsación: dejar que `consent_required` gane también con `providers_failed` y ver caer el cuarto; restaurar.
- [ ] 2.5b [ai] `run-task.usecase.ts`: registrar en el breaker la `ProviderFailure` de cada error, y anotar por
  proveedor de la ejecución su resultado (fallido con clase, `schema_error`/cancelación como `unavailable`, saltado por
  `tryAcquire` como `unavailable`). Verificar en `run-task.usecase.spec.ts`:
  - «a 429 records a rate_limited failure in the breaker»
  - «a provider skipped by tryAcquire is an affected unavailable»
  - «a schema error counts as unavailable»
- [ ] 2.5c [ai] `run-task.usecase.ts`: componer la cadena hipotética (mismo universo, `openIds` vacío, consentimiento
  supuesto), calcular los afectados con `openConditions()` y adjuntar la condición solo a `providers_failed` y a
  `no_providers`. Verificar en `run-task.usecase.spec.ts`:
  - «single provider 429 degrades providers_failed with rate_limited»
  - «next run with the circuit open degrades no_providers with rate_limited and no request»
  - «404 gives a rejected condition»
  - «503 plus 429 aggregates to unavailable»
  - «open external circuit without consent gives no_providers with consent_required»
  - «a local 503 without consent gives providers_failed with unavailable»
  - «AI_CHAIN none gives no_providers without condition»
  - «quota_exceeded and consent_required never carry a provider condition»

  Falsación: adjuntar la condición también a `consent_required` y ver caer el último; restaurar.
- [ ] 2.6 [ai] **No regresión del eval** (D9): no se toca prompt, modelo, fixture ni golden. Verificar:
  `pnpm nx run ai:eval-ci` (o `pnpm nx run ai:eval --all --provider=mock`) **sin** `--update-baseline` sale con código
  0, y `git status --porcelain` sale vacío después.

## 3. API: errores del pegado (design D5)

- [ ] 3.1 [backend] `libs/shared/src/schemas/auth.schema.ts`: códigos `ai_capacity_exhausted`, `extraction_disabled` y
  `ai_consent_required`, cada uno con su comentario de estado y significado. `apps/api/src/presentation/http/api-error.ts`:
  estados `503`, `503` y `409`, y mensajes fijos en inglés sin datos. Verificar en `auth.schema.spec.ts`
  («accepts the paste error codes») y en el spec del filtro de errores («maps the new paste codes to 503, 503 and
  409»).
- [ ] 3.2 [backend] `links/domain/errors.ts`: `CapacityExhausted`, `ExtractionDisabled` y `AiConsentRequired`, ninguno
  con `Retry-After`; `ExtractionUnavailable` sigue igual. El filtro HTTP pone `Retry-After` solo cuando el error lo
  trae. Verificar en `links.controller.pasted.spec.ts`: «CapacityExhausted answers 503 without Retry-After».
  Falsación: poner siempre `Retry-After: 60` y verlo caer; restaurar.
- [ ] 3.3 [backend] Puerto `PastedExtraction` y adaptador `RunTaskPastedExtraction` con la tabla de D5. Verificar en
  `run-task-pasted-extraction.spec.ts`, ampliando el `it.each` actual:
  - «consent_required is consent_required»
  - «no_providers with consent_required condition is consent_required»
  - «rate_limited is capacity_exhausted»
  - «rejected is disabled»
  - «no_providers without condition is disabled»
  - «unavailable condition is unavailable»
  - «providers_failed without condition is unavailable»
  - «quota_exceeded carries aiQuotaRetryAt»

  Falsación: mapear `consent_required` a `unavailable` (lo de hoy) y ver caer el primero; restaurar.
- [ ] 3.4 [backend] `PasteDescription.fieldsOf`:
  - cada `outcome` produce su error;
  - el intento se devuelve en `quota_exceeded`, `consent_required`, `capacity_exhausted`, `disabled` y `unavailable`;
  - `AiQuotaExceeded` usa `retryAt - now`, con mínimo 1 s y 24 h si falta el dato.

  Verificar en `paste-description.usecase.spec.ts`:
  - «quota exceeded announces the real wait, not 24 hours»
  - «quota exceeded refunds the paste»
  - «capacity exhausted refunds the paste»
  - «disabled refunds the paste»
  - «consent required refunds the paste»
  - «not a job posting does not refund the paste»
  - «no error carries the pasted text»

  Falsación: no devolver el intento en `quota_exceeded` (lo de hoy) y ver caer el segundo; restaurar.
- [ ] 3.5 [backend] Integración HTTP en `links.controller.pasted.spec.ts`, con `runTask` doble que devuelve cada
  degradado:
  - «503 ai_capacity_exhausted without Retry-After»
  - «503 extraction_disabled without Retry-After»
  - «409 ai_consent_required»
  - «429 ai_quota_exceeded with the real Retry-After»
  - «the link is unchanged after each of them»

  Verificar con `pnpm nx run api:test` y `--include` del fichero.

## 4. SPA: textos verdaderos (design D6, D8)

- [ ] 4.1 [frontend] `paste-description.dialog.ts`: `problem()` distingue `capacityExhausted`,
  `capacityExhaustedUnknown`, `disabled` y `consentRequired`, además de los de hoy. Un ayudante puro `whenText(now,
  retryAfterMinutes, locale)` decide entre «hoy a las HH:mm», «mañana a las HH:mm» y la fecha corta. Verificar en
  `paste-description.dialog.spec.ts`:
  - «503 ai_capacity_exhausted without Retry-After says no sabemos cuándo vuelve»
  - «503 ai_capacity_exhausted with Retry-After says Vuelve mañana a las 09:00» (reloj fijado a las 20:00)
  - «503 extraction_disabled says Puedes completarla a mano»
  - «409 ai_consent_required says permiso de IA externa and offers no link to /perfil»
  - «no message other than extraction_unavailable says en un rato»

  En el spec del ayudante: «today», «tomorrow» y «later date».
- [ ] 4.2 [frontend] `429` `ai_quota_exceeded` con su hora («Podrás volver a pegar hoy a las 13:00»). Verificar en
  `paste-description.dialog.spec.ts`: «quota exceeded tells the real time, not mañana».
- [ ] 4.3 [frontend] i18n según ADR-050: `pnpm nx run web:extract-i18n`; traducciones y `source` en `messages.en.xlf`
  para los ids de D8, con `@@links.paste.quotaExceeded` actualizado. Verificar: `pnpm nx run web:i18n-check` en
  verde, y `git diff --stat apps/web/src/locale` solo toca los dos catálogos.

## 5. SPA: «Completar a mano» desde el pegado (design D6, D7)

- [ ] 5.1 [frontend] `EditPreviewDialogData.reference?: { text; title?; company? }`. El título y la empresa de la
  referencia entran como valores modificados. El texto va en un panel plegable (`data-testid="edit-paste-reference"`)
  como texto plano o `<textarea readonly>`, **nunca** `disabled`, para que se pueda seleccionar y copiar (B4).
  Verificar en `edit-preview.dialog.spec.ts`:
  - «reference title and company start as changed values»
  - «reference text is selectable and never disabled»: el elemento no tiene el atributo `disabled` y, si es un campo,
    tiene `readonly`
  - «saving never sends the reference text»: la petición capturada por `HttpTestingController` no contiene una marca
    sembrada en el texto.

  Falsación: renderizar el texto en un `<textarea disabled>` y ver caer el segundo; restaurar. Añadir el texto a la
  petición y ver caer el tercero; restaurar.
- [ ] 5.2 [frontend] Botón «Completar a mano» (`data-testid="paste-complete-by-hand"`) tras cualquier fallo. Cierra el
  diálogo y abre `EditPreviewDialog` con el link y la referencia (solo el título y la empresa cambiados, con la
  `changed()` de hoy). Verificar en `paste-description.dialog.spec.ts`:
  - «offers Completar a mano after not_a_job_posting and when offline»
  - «Completar a mano opens the edit dialog with the pasted text and the changed company»
  - «the pasted text is not written to the links store»
- [ ] 5.3 [frontend] Jerarquía de acciones (B5): con `ai_capacity_exhausted`, «Completar a mano» es la principal y
  reenviar la secundaria; con `extraction_disabled` y `ai_consent_required`, «Completar a mano» es la principal y
  reenviar no se ofrece; con el resto, reenviar sigue siendo la principal. Verificar en
  `paste-description.dialog.spec.ts`:
  - «capacity exhausted makes Completar a mano primary and keeps resend secondary»
  - «disabled and consent required hide resend»
  - «extraction_unavailable keeps resend primary»

  Falsación: mostrar reenviar con `extraction_disabled` y ver caer el segundo; restaurar.
- [ ] 5.4 [frontend] Comprobar que funciona desde la lista de links. Verificar en `link-list.component.spec.ts`:
  «complete by hand from the paste dialog works in a group and in /mis-links».
- [ ] 5.5 [frontend] Comprobar que funciona desde el encaje (C9). Verificar en `match.dialog.spec.ts`: «complete by
  hand from the paste dialog opened in the match dialog».

## 6. Cierre

- [ ] 6.1 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar con su salida.
- [ ] 6.2 [infra] `node D:/projects/linkvault/node_modules/@fission-ai/openspec/bin/openspec.js validate paste-fallback-honest --strict --no-interactive`
  y `validate --all --strict --no-interactive` en verde, y `bash infra/ci/repo-checks.sh` con salida 0.
- [ ] 6.3 [infra] **Ventana de fusión** (design D11), justo antes de fusionar el PR. Verificar:
  - con (a): en `openspec/changes/staging-host/tasks.md` (o en su archivo, si 35b ya se archivó) la 11.6 está marcada
    `[x]` y la 10.7 sigue `[ ]`; `git log --oneline origin/main` contiene el merge del PR-2 de 35b; y la 9.4 de `e2e-suite` está anotada de nuevo sobre el commit desplegado con este change;
  - el día de la fusión no es el día 7 ni el día 14 de la medición de 35b (contados desde la invitación anotada en su
    RUNBOOK);
  - con (d): la autorización expresa del owner está anotada con fecha en ADR-060 §1 y ADR-048 §Consecuencias, y
    `git log --oneline origin/main` confirma la posición del PR-1 de 35b (#86) respecto de este merge.

  Si nada de eso se cumple, el PR no se fusiona.

## 7. Documentación

- [ ] 7.1 [infra] ADR-060 pasa de «Propuesto» a «Aceptado» con la fecha de la aprobación de 0.2. Verificar: `head -3 docs/adr/ADR-060.md`.
- [ ] 7.2 [infra] Si cambia algo de lo que dice ADR-018 §Enmiendas (la línea de este change), actualizarla. Verificar: `grep -n "ADR-060" docs/adr/ADR-018.md`.
