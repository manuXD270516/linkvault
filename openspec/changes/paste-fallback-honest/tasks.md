## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos de los casos de test que el
implementador crea. Ninguna prueba llama a un proveedor real: `AI_CHAIN=mock` y `AI_MOCK_MODE=replay` en CI.

- [ ] 0.1 [infra] Q1 respondida por el owner y anotada con fecha:
  - en ADR-060 §1, en una línea que empiece por «Respuesta del owner (Q1), AAAA-MM-DD:»;
  - en `design.md`;
  - y, si la respuesta es (a) o (b), con una línea en ADR-048 §Consecuencias, como hicieron ADR-053 y ADR-055.

  Con (b), el change no pasa de aquí hasta archivar 35c. Con (c), se cierra sin aplicar. Verificar:
  `grep -cE "Respuesta del owner \(Q1\), 20[0-9]{2}-" docs/adr/ADR-060.md` devuelve `1` (antes de anotarla, `0`).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada. Verificar:
  `design.md` lleva la sección del debate de la última iteración, con «Convergencia: SI» y la fecha de la aprobación.

## 1. `libs/ai`: clase del fallo (design D1)

- [ ] 1.1 [ai] `domain/errors.ts`: `ProviderUnavailable` gana `kind` (derivado de `httpStatus`: `429` →
  `rate_limited`; `401`/`402`/`403`/`404` → `rejected`; resto o ausente → `unavailable`) y `resetAt?: Date`, que solo
  se admite con `rate_limited`. El mensaje sigue sin cuerpo ni credencial. Verificar en `domain/errors.spec.ts`
  (nuevo si no existe):
  - «429 is rate_limited»
  - «401, 402, 403 and 404 are rejected»
  - «5xx and missing status are unavailable»
  - «resetAt is dropped unless rate_limited»

  Falsación: mapear `404` a `unavailable` y ver caer el segundo; restaurar.
- [ ] 1.2 [ai] Comprobar que los demás proveedores heredan la clase sin cambios. Verificar con un caso por proveedor en
  `ollama.provider.spec.ts`, `openai.provider.spec.ts` y `anthropic.provider.spec.ts`: «a 429 answer throws
  rate_limited» y «a 404 answer throws rejected».

## 2. `libs/ai`: instante de reinicio, breaker y degradado (design D2-D4)

- [ ] 2.1 [ai] `domain/ports/circuit-breaker.port.ts`: el tipo `ProviderFailure`; `recordFailure(id, failure?)`, que
  sin argumento vale `{ kind: 'unavailable' }`; y `openConditions(): Promise<ReadonlyMap<string, ProviderFailure>>`.
  Lo implementa `InMemoryCircuitBreaker`:
  - `rate_limited` con `resetAt` abre hasta ese instante, sin contar en la ventana;
  - la clase recordada se borra con `recordSuccess`.

  Ajustar `RecordingNullCircuitBreaker` y `NullCircuitBreaker`. Verificar en `in-memory-circuit-breaker.spec.ts`:
  - «a rate limit with resetAt opens until that instant»
  - «a rate limit with resetAt does not count towards the failure window»
  - «half-open is granted when resetAt passes»
  - «a rate limit without resetAt counts as a failure»
  - «remembers the last failure kind of an open circuit»
  - «recordSuccess forgets the remembered kind»

  Falsación: contar el `rate_limited` con `resetAt` en la ventana y ver caer el segundo; restaurar.
- [ ] 2.2 [ai] `RedisCircuitBreaker`: lo mismo, con la pausa guardada con TTL igual al plazo y `openConditions()`
  fallando abierto. Verificar en `redis-circuit-breaker.spec.ts`:
  - «a rate limit with resetAt opens until that instant (shared)»
  - «remembers the last failure kind»
  - «openConditions returns an empty map when Redis fails»

  Falsación: lanzar en vez de devolver vacío y ver caer el tercero; restaurar.
- [ ] 2.3 [ai] `openrouter.provider.ts`: ante un `429`, el instante de reinicio sale de `Retry-After`, de
  `X-RateLimit-Reset` o de `error.metadata.headers["X-RateLimit-Reset"]` del cuerpo, leído con un schema zod que
  solo extrae ese número. Un instante pasado o a más de 48 h se descarta. Verificar en `openrouter.provider.spec.ts`
  (con `fetch` sustituido):
  - «429 with the reset in the body metadata throws rate_limited with that instant»
  - «429 with Retry-After seconds»
  - «429 with an HTTP-date Retry-After»
  - «429 with an absurd reset has no instant»
  - «429 with a non-JSON body has no instant and leaks nothing»
  - «404 no endpoints throws rejected»

  En el primero, `String(error)`, `error.cause` y lo que reciba el logger no contienen el prompt sembrado en el
  mensaje del cuerpo. Falsación: propagar el mensaje del cuerpo en `cause` y ver caer el primero; restaurar.
- [ ] 2.4 [ai] Documentar la forma del cuerpo usada en 2.3. Arriba del bloque de tests del spec, un comentario con la
  URL de la documentación de OpenRouter (límites de modelos gratuitos y errores) y la fecha de la consulta. Si la
  documentación no confirma que «no endpoints» es `404`, anotarlo como pendiente en el mismo comentario y en
  «Debate» de `design.md`. Verificar: `grep -n "openrouter.ai/docs" libs/ai/src/infrastructure/providers/openrouter.provider.spec.ts`
  devuelve al menos una línea.
- [ ] 2.5 [ai] `domain/ai-result.ts`: `AiDegraded.providerCondition?` (design D4). `run-task.usecase.ts`:
  - registra en el breaker la `ProviderFailure` de cada error;
  - calcula los proveedores afectados (intentados que fallaron, más los excluidos solo por circuito abierto,
    comparando `buildChain` con y sin `openIds`);
  - agrega la condición y la adjunta solo a `providers_failed` y a `no_providers`.

  Verificar en `run-task.usecase.spec.ts`:
  - «single provider 429 with reset degrades providers_failed with rate_limited and retryAt»
  - «next run with the provider paused degrades no_providers with the same condition and no request»
  - «404 gives a rejected condition»
  - «503 plus 429 aggregates to unavailable»
  - «two 429, one without reset, give rate_limited without retryAt»
  - «AI_CHAIN none gives no_providers without condition»
  - «quota_exceeded and consent_required never carry a provider condition»

  Falsación: adjuntar la condición también a `consent_required` y ver caer el último; restaurar.
- [ ] 2.6 [ai] La línea base del eval no se mueve. Verificar: `pnpm nx run ai:eval --provider=mock` pasa **sin**
  `--update-baseline`, y `git status --porcelain libs/ai/src/evals libs/ai/src/infrastructure/prompts libs/ai/src/infrastructure/fixtures`
  sale vacío.

## 3. API: errores del pegado (design D5)

- [ ] 3.1 [backend] `libs/shared/src/schemas/auth.schema.ts`: códigos `ai_capacity_exhausted`, `extraction_disabled` y
  `ai_consent_required`, cada uno con su comentario de estado y significado. `apps/api/src/presentation/http/api-error.ts`:
  estados `503`, `503` y `409`, y mensajes fijos en inglés sin datos. Verificar en `auth.schema.spec.ts`
  («accepts the paste error codes») y en el spec del filtro de errores («maps the new paste codes to 503, 503 and
  409»).
- [ ] 3.2 [backend] `links/domain/errors.ts`:
  - `CapacityExhausted`, con `retryAfterSeconds?`;
  - `ExtractionDisabled`;
  - `AiConsentRequired`;
  - `ExtractionUnavailable` sigue igual.

  `limits.ts`: `PASTE_SHORT_WAIT_SECONDS = 300`. El filtro HTTP pone `Retry-After` solo cuando el error lo trae.
  Verificar en `links.controller.pasted.spec.ts`: «CapacityExhausted without retryAfter answers 503 without
  Retry-After». Falsación: poner siempre `Retry-After: 60` y verlo caer; restaurar.
- [ ] 3.3 [backend] Puerto `PastedExtraction` y adaptador `RunTaskPastedExtraction` con la tabla de D5. Verificar en
  `run-task-pasted-extraction.spec.ts`, ampliando el `it.each` actual:
  - «consent_required is consent_required»
  - «rate_limited beyond 5 minutes is capacity_exhausted with retryAt»
  - «rate_limited without retryAt is capacity_exhausted without retryAt»
  - «rate_limited within 5 minutes is unavailable with that wait»
  - «rejected is disabled»
  - «no_providers without condition is disabled»
  - «unavailable condition is unavailable»
  - «quota_exceeded carries aiQuotaRetryAt»

  Falsación: mapear `consent_required` a `unavailable` (lo de hoy) y ver caer el primero; restaurar.
- [ ] 3.4 [backend] `PasteDescription.fieldsOf`:
  - cada `outcome` produce su error;
  - el intento se devuelve en `consent_required`, `capacity_exhausted`, `disabled` y `unavailable`;
  - `AiQuotaExceeded` usa `retryAt - now`, con mínimo 1 s y 24 h si falta el dato.

  Verificar en `paste-description.usecase.spec.ts`:
  - «quota exceeded announces the real wait, not 24 hours»
  - «capacity exhausted refunds the paste»
  - «disabled refunds the paste»
  - «consent required refunds the paste»
  - «no error carries the pasted text»

  Falsación: no devolver el intento en `capacity_exhausted` y ver caer el segundo; restaurar.
- [ ] 3.5 [backend] Integración HTTP en `links.controller.pasted.spec.ts`, con `runTask` doble que devuelve cada
  degradado:
  - «503 ai_capacity_exhausted with Retry-After until reset»
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
  - «503 ai_capacity_exhausted with Retry-After says Vuelven mañana a las 09:00» (reloj fijado a las 20:00)
  - «503 ai_capacity_exhausted without Retry-After says no sabemos cuándo vuelven»
  - «503 extraction_disabled says La lectura automática no está disponible»
  - «no message other than extraction_unavailable says en un rato»

  En el spec del ayudante: «today», «tomorrow» y «later date».
- [ ] 4.2 [frontend] `429` `ai_quota_exceeded` con su hora («Podrás volver a pegar hoy a las 13:00»). `409`
  `ai_consent_required` con «Dar permiso en Perfil», que navega a `/perfil` y cierra el diálogo. Verificar en
  `paste-description.dialog.spec.ts`:
  - «quota exceeded tells the real time, not mañana»
  - «consent required offers Dar permiso en Perfil and navigates to /perfil»
- [ ] 4.3 [frontend] i18n según ADR-050: `pnpm nx run web:extract-i18n`; traducciones y `source` en `messages.en.xlf`
  para los ids de D8, con `@@links.paste.quotaExceeded` actualizado. Verificar: `pnpm nx run web:i18n-check` en
  verde, y `git diff --stat apps/web/src/locale` solo toca los dos catálogos.

## 5. SPA: «Completar a mano» desde el pegado (design D7)

- [ ] 5.1 [frontend] `EditPreviewDialogData.reference?: { text; title?; company? }`. El título y la empresa de la
  referencia entran como valores modificados. El texto va en un panel plegable de solo lectura
  (`data-testid="edit-paste-reference"`). Verificar en `edit-preview.dialog.spec.ts`:
  - «reference title and company start as changed values»
  - «reference text is shown read-only»
  - «saving never sends the reference text»: la petición capturada por `HttpTestingController` no contiene una marca
    sembrada en el texto.

  Falsación: añadir el texto a la petición y ver caer el tercero; restaurar.
- [ ] 5.2 [frontend] Botón «Completar a mano» (`data-testid="paste-complete-by-hand"`) tras cualquier fallo. Cierra el
  diálogo y abre `EditPreviewDialog` con el link y la referencia (solo el título y la empresa cambiados, con la
  `changed()` de hoy). Verificar en `paste-description.dialog.spec.ts`:
  - «offers Completar a mano after ai_capacity_exhausted»
  - «offers Completar a mano after not_a_job_posting and when offline»
  - «Completar a mano opens the edit dialog with the pasted text and the changed company»
  - «the pasted text is not written to the links store»
- [ ] 5.3 [frontend] Comprobar que funciona desde todas las pantallas que abren el pegado. Verificar en
  `link-list.component.spec.ts`: «complete by hand from the paste dialog works in a group and in /mis-links».

## 6. Cierre

- [ ] 6.1 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar con su salida.
- [ ] 6.2 [infra] `node D:/projects/linkvault/node_modules/@fission-ai/openspec/bin/openspec.js validate paste-fallback-honest --strict --no-interactive`
  y `validate --all --strict --no-interactive` en verde, y `bash infra/ci/repo-checks.sh` con salida 0.

## 7. Documentación

- [ ] 7.1 [infra] ADR-060 pasa de «Propuesto» a «Aceptado» con la fecha de la aprobación de 0.2. Verificar: `head -3 docs/adr/ADR-060.md`.
- [ ] 7.2 [infra] Si cambia algo de lo que dice ADR-018 §Enmiendas (la línea de este change), actualizarla. Verificar: `grep -n "ADR-060" docs/adr/ADR-018.md`.
- [ ] 7.3 [infra] Tras fusionar, dejar en `openspec/changes/staging-host/design.md`, en la línea de riesgo
  «Cupo de OpenRouter», una nota de una línea: la degradación ahora distingue cupo, política y permiso
  (`paste-fallback-honest`), y la 8.1 de 35b confirma la forma real del `429` y del «no endpoints». Esta tarea solo
  toca esa línea. Verificar: `grep -n "paste-fallback-honest" openspec/changes/staging-host/design.md`.
