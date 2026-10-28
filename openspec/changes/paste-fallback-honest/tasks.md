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
  Lo implementa `InMemoryCircuitBreaker` (D3): todas las clases cuentan igual en la ventana; cada fallo de la ventana
  guarda su clase; al abrir se recuerda la **dominante** (`unavailable` > `rate_limited` > `rejected`); la prueba
  fallida deja la clase de ese fallo; la clase se borra solo donde hoy se borra el circuito; un éxito con el circuito
  cerrado no toca la ventana. Ajustar `RecordingNullCircuitBreaker`, `NullCircuitBreaker` y los dobles de
  `in-memory-ports.ts` y `eval-ports.ts`. Verificar en `in-memory-circuit-breaker.spec.ts`:
  - «five 429 open the circuit like any failure»
  - «remembers the dominant kind of the window, not the last» (un `503` y cuatro `429` → `unavailable`)
  - «a failure outside the window does not count for the kind»
  - «a failed half-open probe remembers the probe kind»
  - «recordSuccess on an open circuit forgets the remembered kind»
  - «a success on a closed circuit keeps the failure window»
  - «a closed circuit has no condition»

  Falsación: guardar la clase del último fallo y ver caer el segundo; restaurar. No contar el `rate_limited` en la
  ventana y ver caer el primero; restaurar.
- [ ] 2.2a [ai] `RedisCircuitBreaker` (D3, N5): las clases van **en el mismo JSON** (`StoredCircuit`): las de la
  ventana en paralelo a `failures` y la del circuito abierto junto a `openedAt`. Se escriben solo en los fallos que hoy
  cambian el estado (cerrado y prueba de half-open) y se borran solo en `clear` (éxito de la prueba o circuito vacío).
  `recordSuccess` con el circuito cerrado no toca `failures`. Sin TTL nuevo. Un JSON sin clases se lee como
  `unavailable`. Verificar en `redis-circuit-breaker.spec.ts`:
  - «remembers the dominant kind of the window (shared between instances)»
  - «a failed half-open probe remembers the probe kind»
  - «recordSuccess on an open circuit forgets the remembered kind»
  - «a success on a closed circuit keeps the failure window»
  - «a stored circuit without kinds reads as unavailable»
  - «no new key gets an expiry»: el doble de Redis no recibe `set` con `PX` salvo para la clave del permiso de prueba

  Falsación: guardar la clase del último fallo y ver caer el primero; restaurar.
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
- [ ] 2.5a [ai] `domain/ai-result.ts`: `AiDegraded.providerCondition?: { kind: 'consent_missing' | 'unavailable' |
  'rate_limited' | 'rejected' }`, con un comentario que diga que `consent_missing` es «falta el permiso y es
  necesario» y no implica `consentWouldEnable`. En `domain/`, una función pura `aggregateProviderCondition(reason, affected)` con la
  agregación de D4. Verificar en `domain/provider-condition.spec.ts`:
  - «unavailable wins over rate_limited and rejected»
  - «rate_limited wins over rejected»
  - «consent_missing wins with no_providers»
  - «consent_missing does not count with providers_failed»
  - «no affected providers give no condition»

  Falsación: dejar que `consent_missing` gane también con `providers_failed` y ver caer el cuarto; restaurar.
- [ ] 2.5b [ai] `run-task.usecase.ts`: registrar en el breaker la `ProviderFailure` de cada error
  (`recordFailure(id, { kind })`), y anotar por proveedor de la ejecución su resultado (fallido con clase,
  `schema_error`/cancelación como `unavailable`, saltado por `tryAcquire` como `unavailable`). Verificar en
  `run-task.usecase.spec.ts`, con un breaker doble que **cambia de estado entre `openIds()` y `tryAcquire()`** (N3):
  - «a 429 records a rate_limited failure in the breaker»
  - «a provider eligible in the snapshot but skipped by tryAcquire is an affected unavailable»
  - «a schema error counts as unavailable»
- [ ] 2.5c [ai] `run-task.usecase.ts`: componer la cadena hipotética (mismo universo, `openIds` vacío, consentimiento
  supuesto), calcular los afectados con `openConditions()` y adjuntar la condición solo a `providers_failed` y a
  `no_providers`. Verificar en `run-task.usecase.spec.ts`:
  - «single provider 429 degrades providers_failed with rate_limited»
  - «next run with the circuit open degrades no_providers with rate_limited and no request»
  - «404 gives a rejected condition»
  - «503 plus 429 aggregates to unavailable»
  - «open external circuit without consent gives no_providers with consent_missing» (la clase `rate_limited` del
    circuito no cuenta: N1)
  - «a half-open probe in flight counts with its remembered kind» (N3)
  - «tryAcquire race with an external without consent gives no_providers with consent_missing» (motivo
    `no_providers`, no `consent_required`: N2)
  - «a local 503 without consent gives providers_failed with unavailable»
  - «AI_CHAIN none gives no_providers without condition»
  - «quota_exceeded and consent_required never carry a provider condition»

  Falsación: adjuntar la condición también a `consent_required` y ver caer el último; restaurar.
- [ ] 2.5d [ai] `embed-texts.usecase.ts` (N6): pasar la clase del `ProviderUnavailable` capturado
  (`recordFailure(id, { kind })`); cualquier otro error, `unavailable`. Verificar en `embed-texts.usecase.spec.ts`:
  «an embedding 429 records a rate_limited failure in the breaker». Falsación: llamar a `recordFailure(id)` sin clase
  y ver caer el caso; restaurar.
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
  - «no_providers with consent_missing condition is consent_required»
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

- [ ] 4.1 [frontend] `paste-description.dialog.ts`: `problem()` distingue `capacityExhausted`, `disabled` y
  `consentRequired`, además de los de hoy. `ai_capacity_exhausted` tiene un solo texto e **ignora `Retry-After`** (N7).
  Un ayudante puro `whenText(now, retryAfterMinutes, locale)`, usado **solo** con `ai_quota_exceeded`, redondea hacia
  arriba al minuto siguiente y decide entre «hoy a las HH:mm», «mañana a las HH:mm» y la fecha corta. Verificar en
  `paste-description.dialog.spec.ts`:
  - «503 ai_capacity_exhausted says no admite más lecturas por ahora y no sabemos cuándo vuelve»
  - «503 ai_capacity_exhausted ignores Retry-After» (con `Retry-After: 46800`, ninguna hora en el texto)
  - «503 extraction_disabled says Puedes completarla a mano»
  - «409 ai_consent_required says Tu cuenta no permite leerla con IA externa and offers no link to /perfil»
  - «no message other than extraction_unavailable says en un rato»

  En el spec del ayudante: «today», «tomorrow», «later date» y «rounds up to the next minute» (10:00:30 más 180
  minutos → «hoy a las 13:01»). Falsación: truncar en vez de redondear y ver caer el último; restaurar.
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
- [ ] 5.3 [frontend] Jerarquía de acciones (B5, B2-8): con `ai_capacity_exhausted` y `ai_quota_exceeded`, «Completar
  a mano» es la principal y reenviar la secundaria; con `extraction_disabled` y `ai_consent_required`, «Completar a
  mano» es la principal y reenviar no se ofrece; con el resto, reenviar sigue siendo la principal. Verificar en
  `paste-description.dialog.spec.ts`:
  - «capacity exhausted makes Completar a mano primary and keeps resend secondary»
  - «quota exceeded makes Completar a mano primary and keeps resend secondary»
  - «disabled and consent required hide resend»
  - «extraction_unavailable keeps resend primary»

  Falsación: mostrar reenviar con `extraction_disabled` y ver caer el segundo; restaurar.
- [ ] 5.4 [frontend] Comprobar que funciona desde la lista de links. Verificar en `link-list.component.spec.ts`:
  «complete by hand from the paste dialog works in a group and in /mis-links».
- [ ] 5.5 [frontend] Comprobar que funciona desde el encaje (C9). Verificar en `match.dialog.spec.ts`: «complete by
  hand from the paste dialog opened in the match dialog».
- [ ] 5.6 [frontend] Orden de las acciones (B2-10): principal, secundaria si la hay, y cancelar. Verificar:
  - en `paste-description.dialog.spec.ts`, «actions are ordered primary, secondary, cancel» con `it.each` sobre
    `ai_capacity_exhausted`, `ai_quota_exceeded`, `extraction_disabled` y `extraction_unavailable`, leyendo el orden de
    los botones en el DOM;
  - a 360 px: en `apps/web-e2e`, un caso «paste error actions fit and keep their order at 360 px» con
    `page.setViewportSize({ width: 360, height: 740 })` y `page.route` que responde `503` `ai_capacity_exhausted` al
    pegado; comprueba que los tres botones son visibles, que sus cajas siguen el orden de lectura y que
    `document.documentElement.scrollWidth <= 360`.

  Falsación: poner cancelar antes que la secundaria y ver caer el primero; restaurar.

## 6. Cierre

- [ ] 6.1 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar con su salida.
- [ ] 6.2 [infra] `node D:/projects/linkvault/node_modules/@fission-ai/openspec/bin/openspec.js validate paste-fallback-honest --strict --no-interactive`
  y `validate --all --strict --no-interactive` en verde, y `bash infra/ci/repo-checks.sh` con salida 0.
- [ ] 6.3 [infra] **Fusión del change** (design D11, clase 1), justo antes de fusionar el PR. Verificar:
  - con (a): el PR lleva una confirmación escrita y fechada del owner con el estado de 35b, en la forma «11.6 hecha el
    AAAA-MM-DD; 10.7 no hecha». Las casillas de `openspec/changes/staging-host/tasks.md` (o de su archivo) son solo
    apoyo: la de la 10.7 se marca en el PR de archivo de 35b, después de invitar;
  - `git log --oneline origin/main` contiene el merge del PR-2 de 35b, identificado por su número (`Merge pull request
    #NNN`);
  - con (d): la autorización expresa del owner está anotada con fecha en ADR-060 §1 y ADR-048 §Consecuencias, y
    `git log --oneline origin/main` confirma la posición del PR-1 de 35b (#86) respecto de este merge.

  Falsación: si la confirmación del owner declara la 10.7 hecha, el PR queda **fuera de ventana** y no se fusiona. Si
  falta la confirmación, tampoco.
- [ ] 6.4 [infra] Tras fusionar, y antes de la 10.7 de 35b: repetir la 9.4 de `e2e-suite` sobre el commit desplegado
  con este change. Verificar: su resultado, con el SHA del commit desplegado, queda anotado en el PR de archivo (7.3).

## 7. Documentación

- [ ] 7.1 [infra] ADR-060 pasa de «Propuesto» a «Aceptado» con la fecha de la aprobación de 0.2. Verificar: `head -3 docs/adr/ADR-060.md`.
- [ ] 7.2 [infra] Si cambia algo de lo que dice ADR-018 §Enmiendas (la línea de este change), actualizarla. Verificar: `grep -n "ADR-060" docs/adr/ADR-018.md`.
- [ ] 7.3 [infra] **PR de archivo** (design D11, clase 2): lleva las anotaciones posteriores a la fusión (6.4 y
  casillas). Se fusiona **después de la 10.7** de 35b, nunca entre el PR-2 de 35b y su 11.6, nunca durante su 9.1-9.4,
  nunca los días 7 y 14 de la medición y nunca el día de una corrida `e2e-remote`. Verificar, justo antes de fusionar:
  - el PR lleva una confirmación escrita y fechada del owner («10.7 hecha el AAAA-MM-DD; 9.1-9.4 no en curso»), y el día
    de la fusión, contado desde esa fecha, no es el 7 ni el 14;
  - ninguna corrida `e2e-remote` lleva la fecha del día (`gh run list --workflow e2e-remote` o el nombre del workflow
    vigente);
  - **cada fusión de este change en `main`** respetó su regla: `git log --oneline --merges origin/main` lista el merge
    del change (6.3), los de vuelta atrás y su vuelta si los hubo (7.4), y cada uno tiene su confirmación del owner en
    su PR.

  Falsación: si el owner declara la 10.7 no hecha, o el día es el 7 o el 14, el PR de archivo no se fusiona.
- [ ] 7.4 [infra] **Vueltas atrás** (design D11, clase 3), solo si hacen falta: revertir este change, y la vuelta de esa
  vuelta atrás, siguen las reglas de la 7.3 (nunca entre el PR-2 de 35b y su 11.6, nunca durante su 9.1-9.4, nunca los
  días 7 y 14, nunca el día de una corrida `e2e-remote`), con la confirmación fechada del owner en el PR. Verificar:
  el PR de la vuelta atrás lleva esa confirmación y aparece en la lista de la 7.3. Falsación: un revert propuesto el
  día 7 de la medición no se fusiona.

