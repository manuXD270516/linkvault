## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos de los casos de test que el
implementador crea. Ninguna prueba llama a un proveedor real: `AI_CHAIN=mock` y `AI_MOCK_MODE=replay` en CI.

- [x] 0.1 [infra] Q1 respondida por el owner y anotada con fecha:
  - en ADR-060 §1, en una línea que empiece por «Respuesta del owner (Q1), AAAA-MM-DD:»;
  - en `design.md`;
  - y, si la respuesta es (a), (b) o (d), con una línea en ADR-048 §Consecuencias, como hicieron ADR-053 y ADR-055.
    Con (d), la línea nombra la excepción a «Entre PR-1 y PR-2 no se fusiona nada a `main`» de 35b.

  Con (b), el change no pasa de aquí hasta archivar 35c. Con (c), se cierra sin aplicar. Verificar:
  `grep -cE "Respuesta del owner \(Q1\), 20[0-9]{2}-" docs/adr/ADR-060.md` devuelve `1` (antes de anotarla, `0`).

  **Estado (2026-10-29):** hecha. Q1 = (a) («Toma las recomendaciones»), anotada en ADR-060 §1, en `design.md` (Open
  Questions, con Q2, Q4, Q5, Q6 y Q7) y en ADR-048 §Consecuencias («Excepción de ADR-060 (2026-10-29)»); fila «∥ 35b»
  en `docs/design-v0.2.md` §6. Salida de la verificación: `1`.
- [x] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada. Verificar:
  `design.md` lleva la sección del debate de la última iteración, con «Convergencia: SI» y la fecha de la aprobación.

  **Estado (2026-10-29):** hecha. Iteración 3 con «Convergencia: SI» (critic P0 0, business V0 0) y sección «Aprobación
  humana (2026-10-29)» con los cambios posteriores (0.3 y C4 de `web-error-copy-coverage`, fila de Q7). Salida de
  `grep -n "^Convergencia: SI\|^## Aprobación humana" design.md`: `562:Convergencia: SI (…)` y
  `564:## Aprobación humana (2026-10-29)`.

## 1. `libs/ai`: clase del fallo (design D1)

- [x] 1.1 [ai] `domain/errors.ts`: `ProviderUnavailable` gana `kind`, derivado de `httpStatus`: `429` →
  `rate_limited`; `401`/`402`/`403`/`404` → `rejected`; resto o ausente → `unavailable`. El mensaje sigue sin cuerpo
  ni credencial. Verificar en `domain/errors.spec.ts` (nuevo si no existe):
  - «429 is rate_limited»
  - «401, 402, 403 and 404 are rejected»
  - «5xx and missing status are unavailable»

  Falsación: mapear `404` a `unavailable` y ver caer el segundo; restaurar.

  **Estado (2026-10-30):** hecha. `providerFailureKindOf` y `ProviderUnavailable.kind` en `domain/errors.ts`; `errors.spec.ts` (3 casos del enunciado más el del mensaje sin cuerpo). Falsación ejecutada: quitar el `404` de `rejected` hizo caer «401, 402, 403 and 404 are rejected» y los tres «a 404 answer throws rejected» de los proveedores; restaurado.
- [x] 1.2 [ai] Comprobar que los demás proveedores heredan la clase sin cambios. Verificar con un caso por proveedor en
  `ollama.provider.spec.ts`, `openai.provider.spec.ts` y `anthropic.provider.spec.ts`: «a 429 answer throws
  rate_limited» y «a 404 answer throws rejected».

  **Estado (2026-10-30):** hecha. Casos «a 429 answer throws rate_limited» y «a 404 answer throws rejected» en `ollama`, `openai` y `anthropic` (`*.provider.spec.ts`), sin tocar ningún proveedor: `pnpm nx run ai:test -- errors.spec provider.spec` 8 ficheros, 63 tests en verde.

## 2. `libs/ai`: breaker y degradado (design D3, D4)

- [x] 2.1a [ai] Contrato y dobles (D3, P1-10). `domain/ports/circuit-breaker.port.ts`: el tipo `ProviderFailure`;
  `recordFailure(id, failure?)`, que sin argumento vale `{ kind: 'unavailable' }`; y
  `openConditions(): Promise<ReadonlyMap<string, ProviderFailure>>`. Ajustar, sin cambiar lo que ya afirman, todos los
  que implementan `CircuitBreaker`:
  - `RecordingNullCircuitBreaker` (`application/testing/in-memory-ports.ts:108`): `failures` sigue siendo `string[]`
    (los tests actuales comparan ids) y gana `failureKinds: ProviderFailure[]` en paralelo; `openConditions()` devuelve
    un mapa vacío;
  - `NullCircuitBreaker` (`evals/runner/eval-ports.ts:61`): `openConditions()` vacío;
  - el literal `breakerWith` de `application/provider-eligibility.spec.ts:32-43` (su objeto empieza en la línea 34):
    gana `openConditions: async () => new Map()`;
  - los dobles de `application/run-task.usecase.spec.ts`: el `RecordingNullCircuitBreaker` de su `setup` (`:95`) y
    cualquier breaker que se le pase por la opción `breaker?: CircuitBreaker` (`:86`), incluidos los
    `InMemoryCircuitBreaker` de los casos de half-open (`:554`, `:577`, `:1578`, `:1625`, `:1645`, `:1672`, `:1790`).

  `InMemoryCircuitBreaker` y `RedisCircuitBreaker` reciben aquí solo el método con un mapa vacío; su lógica es de la 2.1b,
  la 2.1c y la 2.2a. Verificar: `pnpm nx run ai:typecheck` y `pnpm nx run ai:test` en verde sin tocar ninguna
  aserción existente.

  **Estado (2026-10-30):** hecha. `ProviderFailure`, `recordFailure(id, failure?)` y `openConditions()` en `circuit-breaker.port.ts`; dobles ajustados (`RecordingNullCircuitBreaker` con `failureKinds` en paralelo, `NullCircuitBreaker`, `breakerWith` de `provider-eligibility.spec.ts`; los de `run-task.usecase.spec.ts` usan el recording y los `InMemoryCircuitBreaker` reales). `ai:typecheck` y `ai:test` en verde. Nota: varias aserciones `toEqual` de degradados que fallan por avería (`run-task.usecase.spec.ts`, `openrouter.run-task.spec.ts`, `run-cases.spec.ts`) ganaron `providerCondition: { kind: 'unavailable' | … }`, porque el resultado ahora la lleva; no cambió ninguna otra afirmación.
- [x] 2.1b [ai] `InMemoryCircuitBreaker`: la ventana con clases y la apertura (D3, N4). Todas las clases cuentan igual;
  cada fallo de la ventana guarda su clase junto a su instante; los que salen de la ventana se descartan con su clase;
  al abrir se recuerda la **dominante** (`unavailable` > `rate_limited` > `rejected`). Verificar en
  `in-memory-circuit-breaker.spec.ts`:
  - «five 429 open the circuit like any failure»
  - «remembers the dominant kind of the window, not the last» (un `503` y cuatro `429` → `unavailable`)
  - «a failure outside the window does not count for the kind»

  Falsación: guardar la clase del último fallo y ver caer el segundo; restaurar. No contar el `rate_limited` en la
  ventana y ver caer el primero; restaurar.

  **Estado (2026-10-30):** hecha. Ventana con clases y clase dominante en `InMemoryCircuitBreaker`; tres casos del enunciado más «remembers the dominant…» etc. en `in-memory-circuit-breaker.spec.ts`. Falsaciones ejecutadas: guardar la clase del último fallo hizo caer «remembers the dominant kind of the window, not the last»; no contar el `rate_limited` en la ventana hizo caer 5 casos (entre ellos «five 429 open the circuit like any failure»); restaurado.
- [x] 2.1c [ai] `InMemoryCircuitBreaker`: half-open, borrado y `openConditions()` (D3, N5). La prueba fallida deja la
  clase de ese fallo; la clase se borra solo donde hoy se borra el circuito; un éxito con el circuito cerrado no toca la
  ventana; `openConditions()` devuelve la clase de cada circuito abierto según la regla de `snapshotOpenIds()`.
  Verificar en `in-memory-circuit-breaker.spec.ts`:
  - «a failed half-open probe remembers the probe kind»
  - «recordSuccess on an open circuit forgets the remembered kind»
  - «a success on a closed circuit keeps the failure window»
  - «a closed circuit has no condition»
  - «openConditions returns the kind of each open circuit»

  Falsación: borrar la ventana en `recordSuccess` con el circuito cerrado y ver caer el tercero; restaurar.

  **Estado (2026-10-30):** hecha. Half-open, borrado y `openConditions()` en memoria; los cinco casos del enunciado en `in-memory-circuit-breaker.spec.ts`. Falsación ejecutada: borrar el circuito en `recordSuccess` también con el circuito cerrado hizo caer «a success on a closed circuit keeps the failure window»; restaurado.
- [x] 2.2a [ai] `RedisCircuitBreaker` (D3, N5, P1-1): las clases van **en el mismo JSON** (`StoredCircuit`): las de la
  ventana en paralelo a `failures` y la del circuito abierto junto a `openedAt`. Se escriben solo en los fallos que hoy
  cambian el estado (cerrado y prueba de half-open) y se borran solo en `clear` (éxito de la prueba o circuito vacío).
  En `load`, el filtro que descarta un instante que no es número descarta también su clase; al podar la ventana o al
  abrir, las clases se vacían junto con `failures`; si los largos no coinciden, las clases que faltan se completan con
  `unavailable` **desde el principio**. `recordSuccess` con el circuito cerrado no toca `failures`. Sin TTL nuevo. Un
  JSON sin clases se lee como `unavailable`. Verificar en `redis-circuit-breaker.spec.ts`:
  - «remembers the dominant kind of the window (shared between instances)»
  - «a failed half-open probe remembers the probe kind»
  - «recordSuccess on an open circuit forgets the remembered kind»
  - «a success on a closed circuit keeps the failure window»
  - «a stored circuit without kinds reads as unavailable»
  - «kinds shorter than failures are padded as unavailable»: un JSON sembrado con cuatro instantes en la ventana y
    dos clases `rate_limited`; se adelanta el reloj hasta que salen los dos más antiguos y se registran tres `404`: el
    circuito abre con clase `rate_limited` (las dos clases guardadas eran las de los fallos más recientes)
  - «no new key gets an expiry»: el doble de Redis no recibe `set` con `PX` salvo para la clave del permiso de prueba

  Falsación: guardar la clase del último fallo y ver caer el primero; restaurar. Completar las clases que faltan por
  el final y ver caer «kinds shorter than failures are padded as unavailable»; restaurar.

  **Estado (2026-10-30):** hecha. `StoredCircuit` con `failureKinds` y `openKind` en el mismo JSON, relleno desde el principio con `unavailable` si faltan clases, sin TTL nuevo; los siete casos del enunciado en `redis-circuit-breaker.spec.ts`. Falsaciones ejecutadas: guardar la clase del último fallo hizo caer 3 casos (dominante, entre instancias y relleno); completar las clases que faltan por el final hizo caer «kinds shorter than failures are padded as unavailable»; restaurado.
- [x] 2.2b [ai] `RedisCircuitBreaker.openConditions()`: lee las clases de los circuitos abiertos y falla abierto.
  Verificar en `redis-circuit-breaker.spec.ts`:
  - «openConditions returns the kind of each open circuit»
  - «openConditions returns an empty map when Redis fails»

  Falsación: lanzar en vez de devolver vacío y ver caer el segundo; restaurar.

  **Estado (2026-10-30):** hecha. `RedisCircuitBreaker.openConditions()` falla abierto; «openConditions returns the kind of each open circuit» y «openConditions returns an empty map when Redis fails». Falsación ejecutada: lanzar en vez de devolver vacío hizo caer el segundo; restaurado.
- [x] 2.3 [ai] `openrouter.provider.spec.ts` (sin cambios en `openrouter.provider.ts`): con `fetch` sustituido,
  - «429 throws rate_limited without the body»: el cuerpo repite un prompt sembrado, y ni `String(error)`, ni
    `error.cause`, ni lo que reciba el logger lo contienen;
  - «404 no endpoints throws rejected».

  Falsación: propagar el texto del cuerpo en `cause` y ver caer el primero; restaurar.

  **Estado (2026-10-30):** hecha. «429 throws rate_limited without the body» (cuerpo con el prompt sembrado; ni `String(error)`, ni `inspect`, ni `cause` lo contienen) y «404 no endpoints throws rejected» en `openrouter.provider.spec.ts`, sin tocar `openrouter.provider.ts`. Falsación ejecutada: propagar el texto del cuerpo en `cause` hizo caer el primero y «Error de la API»; restaurado.
- [x] 2.4 [ai] Documentar en `openrouter.provider.spec.ts`, arriba del bloque de 2.3, la URL de la documentación de
  errores de OpenRouter y la fecha de la consulta, con lo que dice de `429` y del «no endpoints» (`404`). Si no
  confirma el `404`, anotarlo como pendiente en el mismo comentario y en el debate de `design.md`. Verificar:
  `grep -n "openrouter.ai/docs" libs/ai/src/infrastructure/providers/openrouter.provider.spec.ts` devuelve al menos
  una línea.

  **Estado (2026-10-30):** hecha, con un hallazgo pendiente. Comentario en `openrouter.provider.spec.ts` con la URL y la fecha de la consulta (2026-10-30). La documentación confirma el `429` (límite de ritmo, con `Retry-After`) y los `401/402/403`, pero NO confirma que «No endpoints found matching your data policy» llegue como `404`: solo lista «There is no available model provider that meets your routing requirements» (código numérico ausente del texto de la página). Anotado como pendiente en el comentario y en `design.md` (sección «Hallazgos de la implementación»); lo confirma la 8.1 de 35b. `grep -n "openrouter.ai/docs" libs/ai/src/infrastructure/providers/openrouter.provider.spec.ts` devuelve 1 línea.
- [x] 2.5a [ai] `domain/ai-result.ts`: `AiDegraded.providerCondition?: { kind: 'consent_missing' | 'unavailable' |
  'rate_limited' | 'rejected' }`, con un comentario que diga que `consent_missing` es «falta el permiso y es
  necesario» y no implica `consentWouldEnable`. En `domain/`, una función pura `aggregateProviderCondition(reason, affected)` con la
  agregación de D4. Verificar en `domain/provider-condition.spec.ts`:
  - «unavailable wins over rate_limited and rejected»
  - «rate_limited wins over rejected»
  - «consent_missing wins with no_providers»
  - «consent_missing does not count with providers_failed»
  - «no affected providers give no condition»

  Falsación: dejar que `consent_missing` gane también con `providers_failed` y ver caer el cuarto; restaurar.

  **Estado (2026-10-30):** hecha. `AiDegraded.providerCondition`, `ProviderCondition` y `domain/provider-condition.ts` (`aggregateProviderCondition`, `dominantFailureKind`); `provider-condition.spec.ts` con los cinco casos del enunciado. Falsación ejecutada: dejar que `consent_missing` gane también con `providers_failed` hizo caer «consent_missing does not count with providers_failed» y dos casos de `run-task`; restaurado.
- [x] 2.5b [ai] `run-task.usecase.ts`: registrar en el breaker la `ProviderFailure` de cada error
  (`recordFailure(id, { kind })`), y anotar por proveedor de la ejecución su resultado (fallido con clase,
  `schema_error`/cancelación como `unavailable`, saltado por `tryAcquire` como `unavailable`). Verificar en
  `run-task.usecase.spec.ts`, con un breaker doble que **cambia de estado entre `openIds()` y `tryAcquire()`** (N3):
  - «a 429 records a rate_limited failure in the breaker»
  - «a provider eligible in the snapshot but skipped by tryAcquire is an affected unavailable»
  - «a schema error counts as unavailable»

  **Estado (2026-10-30):** hecha. `runTask` registra `recordFailure(id, { kind })` y anota por proveedor su resultado; casos «a 429 records a rate_limited failure in the breaker», «a provider eligible in the snapshot but skipped by tryAcquire is an affected unavailable» (con un `ScriptedBreaker` que cambia entre `openIds()` y `tryAcquire()`) y «a schema error counts as unavailable» en `run-task.usecase.spec.ts`.
- [x] 2.5c-i [ai] `run-task.usecase.ts`: cadena hipotética y afectados (D4, P1-2, P1-3, P1-4). Componer la cadena
  hipotética con `buildChain` (mismo universo, `openIds` vacío y el mismo `ctx` salvo `aiConsent`, que se supone dado:
  `excludeProviderIds` se conserva). Afectados = los de la hipotética sin salida válida **más** todo proveedor intentado
  o saltado en la cadena real; no cuentan los que no se intentaron porque la ejecución se canceló. Llamar a
  `openConditions()` **solo** en el camino que degrada con `providers_failed` o `no_providers`, después de recorrer la
  cadena, y adjuntar la condición solo a esos dos motivos. Verificar en `run-task.usecase.spec.ts`:
  - «single provider 429 degrades providers_failed with rate_limited»
  - «next run with the circuit open degrades no_providers with rate_limited and no request»
  - «404 gives a rejected condition»
  - «503 plus 429 aggregates to unavailable»
  - «the hypothetical chain keeps excludeProviderIds» (un excluido con circuito abierto `unavailable` y otro que
    responde `429` → `rate_limited`)
  - «providers not attempted after a cancellation do not count» (`429` del primero y cancelación antes del segundo →
    `rate_limited`)
  - «a cancellation before the first attempt gives no condition»
  - «success path never calls openConditions»: con un breaker espía, un `429` del primero y una salida válida del
    segundo, `openConditions` se llama 0 veces
  - «AI_CHAIN none gives no_providers without condition»
  - «quota_exceeded and consent_required never carry a provider condition»

  Falsación: quitar `excludeProviderIds` del `ctx` de la cadena hipotética y ver caer el quinto; restaurar. Llamar a
  `openConditions()` antes del bucle y ver caer «success path never calls openConditions»; restaurar. Adjuntar la
  condición también a `consent_required` y ver caer el último; restaurar.

  **Estado (2026-10-30):** hecha. Cadena hipotética y afectados en `run-task.usecase.ts` (`providerConditionOf`), con `openConditions()` solo en el camino que degrada con `providers_failed` o `no_providers`; los diez casos del enunciado en `run-task.usecase.spec.ts`. Falsaciones ejecutadas: quitar `excludeProviderIds` del `ctx` de la hipotética hizo caer «the hypothetical chain keeps excludeProviderIds»; llamar a `openConditions()` antes del bucle hizo caer «success path never calls openConditions»; adjuntar la condición también a `consent_required` hizo caer «quota_exceeded and consent_required never carry a provider condition» (y cuatro más); restaurado.
- [x] 2.5c-ii [ai] `run-task.usecase.ts`: consentimiento y carreras (D4, N1, N2, N3). Verificar en
  `run-task.usecase.spec.ts`, con el breaker doble de la 2.5b que cambia de estado entre `openIds()` y `tryAcquire()`:
  - «open external circuit without consent gives no_providers with consent_missing» (la clase `rate_limited` del
    circuito no cuenta: N1)
  - «a half-open probe in flight counts with its remembered kind» (N3)
  - «tryAcquire race with an external without consent gives no_providers with consent_missing» (motivo
    `no_providers`, no `consent_required`: N2)
  - «a local 503 without consent gives providers_failed with unavailable»

  Falsación: dejar que la clase recordada de un excluido por consentimiento cuente y ver caer el primero; restaurar.
  Dejar que `consent_missing` gane con `providers_failed` y ver caer el último; restaurar.

  **Estado (2026-10-30):** hecha. Los cuatro casos del enunciado en `run-task.usecase.spec.ts`. Falsaciones ejecutadas: dejar que la clase recordada de un excluido por consentimiento cuente hizo caer «open external circuit without consent gives no_providers with consent_missing»; dejar que `consent_missing` gane con `providers_failed` hizo caer «a local 503 without consent gives providers_failed with unavailable»; restaurado.
- [x] 2.5d [ai] `embed-texts.usecase.ts` (N6): pasar la clase del `ProviderUnavailable` capturado
  (`recordFailure(id, { kind })`); cualquier otro error, `unavailable`. Verificar en `embed-texts.usecase.spec.ts`:
  «an embedding 429 records a rate_limited failure in the breaker». Falsación: llamar a `recordFailure(id)` sin clase
  y ver caer el caso; restaurar.

  **Estado (2026-10-30):** hecha. `embed-texts.usecase.ts` pasa la clase del `ProviderUnavailable` capturado; «an embedding 429 records a rate_limited failure in the breaker» en `embed-texts.usecase.spec.ts`. Falsación ejecutada: registrar con clase fija `unavailable` hizo caer el caso; restaurado.
- [x] 2.6 [ai] **No regresión del eval** (D9): no se toca prompt, modelo, fixture ni golden. Verificar:
  `pnpm nx run ai:eval-ci` (o `pnpm nx run ai:eval --all --provider=mock`) **sin** `--update-baseline` sale con código
  0, y `git status --porcelain` sale vacío después.

  **Estado (2026-10-30):** hecha. `pnpm nx run ai:eval-ci` sale con código 0 sin `--update-baseline`; `git status --porcelain` no muestra ningún cambio fuera de `libs/ai/src` (ningún prompt, fixture ni golden tocado). `pnpm nx run-many -t lint,typecheck,test -p ai --skip-nx-cache` en verde (84 ficheros, 953 tests).

## 3. API: errores del pegado (design D5)

- [x] 3.1 [backend] `libs/shared/src/schemas/auth.schema.ts`: códigos `ai_capacity_exhausted`, `extraction_disabled` y
  `ai_consent_required`, cada uno con su comentario de estado y significado. `apps/api/src/presentation/http/api-error.ts`:
  estados `503`, `503` y `409`, y mensajes fijos en inglés sin datos. Verificar en `auth.schema.spec.ts`
  («accepts the paste error codes») y en el spec del filtro de errores («maps the new paste codes to 503, 503 and
  409»).

  **Estado (2026-10-30):** hecha. Códigos `ai_consent_required` (409), `ai_capacity_exhausted` (503) y `extraction_disabled` (503) en `libs/shared/src/schemas/auth.schema.ts`, con `API_ERROR_STATUS` y `API_ERROR_MESSAGES` (mensajes fijos en inglés, sin datos) en `api-error.ts`. Verificado: «accepts the paste error codes» en `auth.schema.spec.ts` (`pnpm nx run shared:test -- auth.schema`, 36 tests en verde), la tabla de estados en `api-error.spec.ts` y «maps the new paste codes to 503, 503 and 409» en `api-exception.filter.spec.ts`. No se tocó el SPA: `API_ERROR_COPY` (`apps/web/src/app/shared/ui/api-error-copy.ts`) no existe todavía en esta rama (lo cubre la 4.1).
- [x] 3.2 [backend] `links/domain/errors.ts`: `CapacityExhausted`, `ExtractionDisabled` y `AiConsentRequired`, ninguno
  con `Retry-After`; `ExtractionUnavailable` sigue igual. El filtro HTTP pone `Retry-After` solo cuando el error lo
  trae. Verificar en `links.controller.pasted.spec.ts`: «CapacityExhausted answers 503 without Retry-After».
  Falsación: poner siempre `Retry-After: 60` y verlo caer; restaurar.

  **Estado (2026-10-30):** hecha. `AiConsentRequired`, `CapacityExhausted` y `ExtractionDisabled` en `links/domain/errors.ts`, sin `retryAfterSeconds`; el filtro ya pone `Retry-After` solo en los errores que lo traen (las tres caen en la rama de `LinksError`). Verificado: «CapacityExhausted answers 503 without Retry-After» en `links.controller.pasted.spec.ts` y el `it.each` del filtro con `retry-after` indefinido. Falsación ejecutada: poner siempre `Retry-After: 60` en la rama de `LinksError` hizo caer 20 casos (los tres códigos nuevos, el de la controladora y los de errores sin cabecera); restaurado.
- [x] 3.3 [backend] Puerto `PastedExtraction` y adaptador `RunTaskPastedExtraction` con la tabla de D5. Verificar en
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

  **Estado (2026-10-30):** hecha. Variantes `consent_required`, `capacity_exhausted` y `disabled` (y `retryAt?` en `quota_exceeded`) en `pasted-extraction.port.ts`, y la tabla de D5 en `RunTaskPastedExtraction.degradedOutcome`. Verificado en `run-task-pasted-extraction.spec.ts`: los siete casos del enunciado más «rate_limited with the circuit open is capacity_exhausted», «quota_exceeded carries aiQuotaRetryAt» y su caso sin instante. Falsación ejecutada: mapear `consent_required` a `unavailable` hizo caer «consent_required is consent_required» y dos casos HTTP; restaurado.
- [x] 3.4 [backend] `PasteDescription.fieldsOf`:
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

  **Estado (2026-10-30):** hecha. `PasteDescription.fieldsOf` traduce cada `outcome` a su error y devuelve el intento en `quota_exceeded`, `consent_required`, `capacity_exhausted`, `disabled` y `unavailable`; `AiQuotaExceeded` usa `retryAt - now` (mínimo 1 s; 24 h si falta). Verificado en `paste-description.usecase.spec.ts`: los siete casos del enunciado (más «quota exceeded never announces less than one second»); el caso antiguo «Cuota de IA agotada» ya no afirma que el intento no se devuelve (se invirtió esa afirmación, que es lo que cambia C10). Falsación ejecutada: no devolver el intento en `quota_exceeded` hizo caer «quota exceeded refunds the paste» y, por HTTP, «ni el cupo, ni la cuota, ni la falta de permiso gastan un pegado»; restaurado.
- [x] 3.5 [backend] Integración HTTP en `links.controller.pasted.spec.ts`, con `runTask` doble que devuelve cada
  degradado:
  - «503 ai_capacity_exhausted without Retry-After»
  - «503 extraction_disabled without Retry-After»
  - «409 ai_consent_required»
  - «429 ai_quota_exceeded with the real Retry-After»
  - «the link is unchanged after each of them»

  Verificar con `pnpm nx run api:test` y `--include` del fichero.

  **Estado (2026-10-30):** hecha. En `links.controller.pasted.spec.ts` (app completa, `RUN_TASK` doble que devuelve cada degradado): `it.each` con «503 ai_capacity_exhausted without Retry-After», «503 extraction_disabled without Retry-After» (con condición `rejected` y con `no_providers` sin condición), «409 ai_consent_required» (motivo `consent_required` y `no_providers` con condición `consent_missing`), «429 ai_quota_exceeded with the real Retry-After» (3 h, no 24) y, en cada uno, el link sin cambios; más «ni el cupo, ni la cuota, ni la falta de permiso gastan un pegado» (48 pegados sin llegar a `too_many_attempts`). `pnpm nx run api:test -- api-exception.filter api-error run-task-pasted-extraction paste-description links/domain/errors links.controller.pasted`: 6 ficheros, 226 tests en verde.

## 4. SPA: textos verdaderos (design D6, D8)

- [ ] 4.1 [frontend] `paste-description.dialog.ts`: `problem()` distingue `capacityExhausted`, `disabled` y
  `consentRequired`, además de los de hoy, con los textos de D6 (B3-1, B3-4). `ai_capacity_exhausted` tiene un solo
  texto e **ignora `Retry-After`** (N7). Un ayudante puro `whenText(now, retryAfterMinutes, locale)`, usado **solo** con
  `ai_quota_exceeded`, redondea hacia arriba al minuto siguiente si el instante no cae en un minuto exacto (segundos o
  milisegundos, P1-5) y decide entre «hoy a las HH:mm» y «mañana a las HH:mm»; **sin rama de fecha** (B3-5). Si el
  instante cae más allá de mañana, o no hay `Retry-After`, devuelve `null` y el diálogo usa el texto sin hora
  (`@@links.paste.quotaExceeded`). Verificar en `paste-description.dialog.spec.ts`:
  - «503 ai_capacity_exhausted says no sabemos cuándo vuelve and Puedes completarla a mano»
  - «503 ai_capacity_exhausted ignores Retry-After» (con `Retry-After: 46800`, ninguna hora en el texto)
  - «503 extraction_disabled says Puedes completarla a mano»
  - «409 ai_consent_required says falta tu permiso and offers no link to /perfil»
  - «no message other than extraction_unavailable says en un rato»

  En el spec del ayudante (reloj falso con la hora local fijada):
  - «today» y «tomorrow»
  - «an exact minute is not rounded» (10:00:00.000 más 180 minutos → «hoy a las 13:00»)
  - «rounds up to the next minute» (10:00:30.000 más 180 minutos → «hoy a las 13:01»)
  - «milliseconds alone round up» (10:00:00.001 más 180 minutos → «hoy a las 13:01»)
  - «past tomorrow gives no time» (23:59:30 más 1440 minutos → `null`)
  - «no Retry-After gives no time» (`null` → `null`)

  Falsación: truncar en vez de redondear y ver caer «rounds up to the next minute»; restaurar. Redondear solo por
  segundos y ver caer «milliseconds alone round up»; restaurar.

  Coordinación con `web-error-copy-coverage` (su 0.3, forma (a); cambio posterior a la aprobación, con la conformidad
  del owner del 2026-10-29): si `apps/web/src/app/shared/ui/api-error-copy.ts` existe en `main`, añadir a
  `API_ERROR_COPY` (de `web-error-copy-coverage`) las entradas `local` de `ai_consent_required`,
  `ai_capacity_exhausted` y `extraction_disabled` con `features/links/paste-description.dialog.ts` (ADR-062 §3); si
  `web-error-copy-coverage` todavía no está en `main`, las añade ese change. Antes de fusionar, actualizar la cabeza
  del PR y esperar CI verde si `main` cambió `apps/web/src/locale/messages.xlf`, `libs/shared/src/schemas/auth.schema.ts`
  o `apps/web/src/app/shared/ui/api-error-copy.ts` desde la última corrida. Verificar, si el fichero existe:
  `pnpm nx run web:typecheck` y `pnpm nx run web:test --include="**/api-error-copy.spec.ts" --skip-nx-cache` en verde, y
  `grep -c "paste-description.dialog.ts" apps/web/src/app/shared/ui/api-error-copy.ts` devuelve al menos `3`.
- [ ] 4.2 [frontend] `429` `ai_quota_exceeded` con su hora («Podrás volver a pegar hoy a las 13:00», con el reloj en
  10:00:00.000) y sin ella. Verificar en `paste-description.dialog.spec.ts`:
  - «quota exceeded tells the real time, not mañana»
  - «quota exceeded past tomorrow says en 24 horas como mucho» (23:59:30 y `Retry-After: 86400`)
- [ ] 4.3 [frontend] i18n según ADR-050: `pnpm nx run web:extract-i18n`; traducciones y `source` en `messages.en.xlf`
  para los ids de D8 (con las traducciones EN previstas allí), con `@@links.paste.quotaExceeded` actualizado y sin
  `links.paste.when.date`. Verificar: `pnpm nx run web:i18n-check` en verde, `grep -c "links.paste.when.date"
  apps/web/src/locale/messages.xlf` devuelve `0`, y `git diff --stat apps/web/src/locale` solo toca los dos catálogos.

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
- [ ] 5.3 [frontend] Jerarquía de acciones (B5, B3-2, B3-3): con los cuatro errores de D6 («Completar a mano»
  principal), reenviar solo se ofrece ante `ai_capacity_exhausted`, como secundaria y con el texto «Reintentar»
  (`data-testid="paste-retry"`, `@@links.paste.retry`); con el resto de errores, reenviar sigue siendo la principal.
  Verificar en `paste-description.dialog.spec.ts`:
  - «capacity exhausted makes Completar a mano primary and Reintentar secondary»
  - «quota exceeded, disabled and consent required hide resend» (`it.each` sobre los tres códigos)
  - «extraction_unavailable keeps resend primary»

  Falsación: mostrar reenviar con `ai_quota_exceeded` (lo de la iteración 2) y ver caer el segundo; restaurar.
- [ ] 5.4 [frontend] Comprobar que funciona desde la lista de links. Verificar en `link-list.component.spec.ts`:
  «complete by hand from the paste dialog works in a group and in /mis-links».
- [ ] 5.5 [frontend] Comprobar que funciona desde el encaje (C9). Verificar en `match.dialog.spec.ts`: «complete by
  hand from the paste dialog opened in the match dialog».
- [ ] 5.6a [frontend] Orden de las acciones en el DOM (B2-10, B3-2). Verificar en `paste-description.dialog.spec.ts`:
  «actions are ordered primary, secondary, cancel», con `it.each` sobre `ai_capacity_exhausted` («Completar a mano»,
  «Reintentar», «Cancelar»), `ai_quota_exceeded` («Completar a mano», «Cancelar»), `extraction_disabled` («Completar a
  mano», «Cancelar») y `extraction_unavailable` («Completar la oferta», «Completar a mano», «Cancelar»), leyendo los
  nombres accesibles de los botones en orden de DOM. Falsación: poner «Cancelar» antes que «Reintentar» y ver caer el
  primer caso; restaurar.
- [ ] 5.6b [frontend] 360 px en la suite reproducible (P1-9, design D10). En `apps/web-e2e/src/links.spec.ts`, un caso
  nuevo «paste error actions fit and keep their order at 360 px» con `{ tag: ['@lot1', '@paste-actions'] }` y **sin**
  `@remote-safe` (solo perfil `local`). Usa solo lo que admite la suite: origen y API de `support/profile.ts`, sin
  `localhost` escrito a mano, sin `MongoClient`, sin `docker` ni `resetRegisterLimit`, sin esperas fijas. Registra una
  cuenta, crea un link por la API, fija `page.setViewportSize({ width: 360, height: 740 })` y responde al pegado con
  `page.route` (`503` `ai_capacity_exhausted`); comprueba que «Completar a mano», «Reintentar» y «Cancelar» son
  visibles, que sus cajas siguen ese orden de lectura y que `document.documentElement.scrollWidth <= 360`. Los demás
  casos de `links.spec.ts` siguen sin `@lot1`. Verificar:
  - `pnpm nx run web-e2e:e2e-stack -- --project=chromium --grep @paste-actions` en verde, con un solo caso ejecutado;
  - `pnpm exec playwright test -c apps/web-e2e/playwright.config.mts --list --grep "(?=.*@lot1)(?=.*@remote-safe)"`
    no lista el caso (el perfil `remote` no lo toma).

  Falsación: poner «Cancelar» antes que «Reintentar» en la plantilla y ver caer el caso; restaurar.
- [ ] 5.6c [infra] Admisión del caso y presupuesto de registro (README de `apps/web-e2e`, «Cómo admitir una prueba»).
  Admitirlo con carga en `chromium` y perfil `local` (el `mobile` solo ejecuta `critical-path.spec.ts` y el caso no es
  `@remote-safe`): `pnpm nx run web-e2e:e2e-stack -- --project=chromium --repeat-each=5 --grep @paste-actions`, cinco de
  cinco, sin `429` de registro en `stack-logs/api.log`. En el README: anotar la admisión con fecha en «Admisiones»;
  subir en uno los intentos de `e2e-stack` (perfil `local`: 5; con `--rehearse-remote`: 6) en «Presupuesto de intentos
  de registro»; y añadir `--grep @critical-path` a la orden de readmisión del camino crítico con `--repeat-each=5`, que
  si no pasaría de 10. Verificar: `grep -n "@paste-actions" apps/web-e2e/README.md` devuelve la línea de la admisión, y
  `pnpm nx run web-e2e:e2e-stack` completo (sin `--grep`) en verde, sin `429` de registro.

## 6. Cierre

- [ ] 6.1 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar con su salida.
- [ ] 6.2 [infra] `node D:/projects/linkvault/node_modules/@fission-ai/openspec/bin/openspec.js validate paste-fallback-honest --strict --no-interactive`
  y `validate --all --strict --no-interactive` en verde, y `bash infra/ci/repo-checks.sh` con salida 0.
- [ ] 6.3 [infra] **Fusión del change** (design D11, clase 1), justo antes de fusionar el PR. Verificar:
  - con (a): el PR lleva una confirmación escrita del owner **con la fecha del día de la fusión** (P1-8), en la forma
    «11.6 hecha el AAAA-MM-DD; PR-2 de 35b = #NNN; 10.7 no hecha; sin `e2e-remote` hoy». Si la confirmación es de un
    día anterior, se pide de nuevo. Las casillas de `openspec/changes/staging-host/tasks.md` (o de su archivo) son solo
    apoyo: la de la 10.7 se marca en el PR de archivo de 35b, después de invitar;
  - **ninguna corrida `e2e-remote` en curso** (P1-6): el owner lo declara en esa confirmación («sin `e2e-remote`
    hoy», local ni en CI), y `gh run list --workflow e2e.yml --status in_progress` no lista ninguna corrida cuyo job
    `e2e-remote (staging)` esté en marcha;
  - `git log --oneline origin/main` contiene el merge del PR-2 de 35b con el número que da la confirmación (`Merge pull
    request #NNN`);
  - cabeza del PR actualizada y CI en verde sobre ella si `main` cambió `apps/web/src/locale/messages.xlf`,
    `libs/shared/src/schemas/auth.schema.ts` o `apps/web/src/app/shared/ui/api-error-copy.ts` desde la última corrida
    (C4 de `web-error-copy-coverage`, ADR-050 §5; cambio posterior a la aprobación, conformidad del owner del 2026-10-29);
  - con (d): la autorización expresa del owner está anotada con fecha en ADR-060 §1 y ADR-048 §Consecuencias, y
    `git log --oneline origin/main` confirma la posición del PR-1 de 35b (#86) respecto de este merge.

  Falsación: si la confirmación del owner declara la 10.7 hecha, el PR queda **fuera de ventana** y no se fusiona. Si
  falta la confirmación, si es de otro día o si hay una corrida `e2e-remote` en curso, tampoco.
- [ ] 6.4 [infra] Tras fusionar, y antes de la 10.7 de 35b: repetir la 9.4 de `e2e-suite` sobre el commit desplegado
  con este change. Verificar: su resultado, con el SHA del commit desplegado, queda anotado en el PR de archivo (7.3).

## 7. Documentación

- [ ] 7.1 [infra] ADR-060 pasa de «Propuesto» a «Aceptado» con la fecha de la aprobación de 0.2. Verificar: `head -3 docs/adr/ADR-060.md`.
- [ ] 7.2 [infra] Si cambia algo de lo que dice ADR-018 §Enmiendas (la línea de este change), actualizarla. Verificar: `grep -n "ADR-060" docs/adr/ADR-018.md`.
- [ ] 7.3 [infra] **PR de archivo** (design D11, clase 2): lleva las anotaciones posteriores a la fusión (6.4 y
  casillas). Se fusiona **después de la 10.7** de 35b, nunca entre el PR-2 de 35b y su 11.6, nunca durante su 9.1-9.4,
  nunca los días 7 y 14 de la medición y nunca el día de una corrida `e2e-remote`. Verificar, justo antes de fusionar:
  - el PR lleva una confirmación escrita del owner con la fecha del día de la fusión (P1-8), en la forma «10.7 hecha el
    AAAA-MM-DD; PR-2 de 35b = #NNN; 9.1-9.4 no en curso; sin `e2e-remote` hoy» (P1-7: ni local ni en CI). Si es de un día
    anterior, se pide de nuevo. El día de la fusión, contado desde la fecha de la 10.7, no es el 7 ni el 14;
  - ninguna corrida de CI de `e2e-remote` lleva la fecha del día: `gh run list --workflow e2e.yml --created
    <AAAA-MM-DD> --json databaseId` y, por cada corrida, `gh run view <id> --json jobs --jq '.jobs[] | select(.name |
    startswith("e2e-remote")) | .conclusion'` sale vacío o `skipped`. Las corridas locales las cubre la declaración del
    owner;
  - **cada fusión de este change en `main`** respetó su regla: `git log --oneline --merges origin/main` lista el merge
    del change (6.3), los de vuelta atrás y su vuelta si los hubo (7.4), y cada uno tiene su confirmación del owner,
    fechada el día de su fusión, en su PR.

  Falsación: si el owner declara la 10.7 no hecha, si el día es el 7 o el 14, si la confirmación es de otro día o si
  `gh run list` muestra una corrida `e2e-remote` del día, el PR de archivo no se fusiona.
- [ ] 7.4 [infra] **Vueltas atrás** (design D11, clase 3), solo si hacen falta: revertir este change, y la vuelta de esa
  vuelta atrás, siguen las reglas de la 7.3 (nunca entre el PR-2 de 35b y su 11.6, nunca durante su 9.1-9.4, nunca los
  días 7 y 14, nunca el día de una corrida `e2e-remote`), con la confirmación del owner fechada el día de la fusión en el
  PR: la forma de la 7.3 si la 10.7 ya se hizo, y la de la 6.3 si no. Verificar: el PR de la vuelta atrás lleva esa
  confirmación, la comprobación de `gh run list` de la 7.3 sale limpia para ese día, y el PR aparece en la lista de la
  7.3. Falsación: un revert propuesto el día 7 de la medición no se fusiona.
