## Why

Business (2026-10-28) observó que cuatro de cinco bolsas no se dejan leer, de modo que casi todo link real termina en
«Pegar la descripción» o en «Completar a mano». En staging, pegar usa la IA gratuita (OpenRouter `:free` con
`data_collection: deny`, `AI_CHAIN=openrouter`; design D13 de `staging-host`), y ese design ya anotó como riesgo el
cupo diario «pequeño y variable» y el error «no endpoints». La hipótesis era que en esos casos el pegado miente. Se
verificó leyendo el código de `main` (`5b92d28`) y **es cierta en parte**:

**Cierto.**

- **El cupo del proveedor se presenta como un fallo pasajero.** OpenRouter responde `429` cuando se agota el cupo
  gratuito y, según la documentación, `404` cuando ningún proveedor del modelo acepta `data_collection: deny`. El
  proveedor convierte cualquier estado no-2xx en `ProviderUnavailable(id, status)` y descarta el cuerpo
  (`libs/ai/src/infrastructure/providers/openrouter.provider.ts:122-125`). `runTask` lo registra como
  `provider_error` y cuenta un fallo en el breaker (`libs/ai/src/application/run-task.usecase.ts:461-478`), y la
  ejecución degrada con `providers_failed` (`:240-245`). Después de 5 fallos el circuito se abre y la ejecución
  siguiente degrada con `no_providers` sin llamar a nadie (`:188-197`). En los dos casos el adaptador del pegado
  devuelve `unavailable` (`apps/api/src/modules/links/infrastructure/run-task-pasted-extraction.ts:78-81`), el caso de
  uso responde `503 extraction_unavailable` con `Retry-After: 60`
  (`apps/api/src/modules/links/application/paste-description.usecase.ts:170-173`,
  `apps/api/src/modules/links/domain/limits.ts:75`), y el diálogo dice «No pudimos leerla ahora, inténtalo en un rato»
  (`apps/web/src/app/features/links/paste-description.dialog.html:69-72`). Si el cupo no vuelve hasta mañana, o si la
  política de datos no la acepta ningún proveedor, ese texto es falso: reintentar en un rato vuelve a fallar.
- **Falta de consentimiento, mismo texto falso (hallazgo nuevo).** Con `AI_CHAIN=openrouter`, el único proveedor es
  externo, y la tarea `extract-pasted-job` es `personal`. Para quien no dio el permiso en Perfil, `runTask` degrada con
  `consent_required` (`run-task.usecase.ts:191-196`), y el adaptador lo mapea también a `unavailable`, porque solo
  distingue `quota_exceeded` (`run-task-pasted-extraction.ts:79`; el test solo cubre `providers_failed` y
  `no_providers`, `run-task-pasted-extraction.spec.ts:161-164`). A esa persona se le dice «inténtalo en un rato», y
  no le funcionará nunca.
- **El error no lleva a «Completar a mano».** El diálogo solo ofrece «Cancelar» y volver a enviar
  (`paste-description.dialog.html:92-111`). La persona tiene que cerrarlo y encontrar el otro botón de la tarjeta, y
  lo que pegó se pierde al cerrar.

**Falso o ya resuelto.**

- **El texto pegado ya se conserva** ante cualquier error, porque el diálogo no se cierra
  (`paste-description.dialog.ts:32-33`, `paste-description.dialog.html:59`). Lo exige `web/links` («En todos ellos
  SHALL conservarse lo pegado»). Ese texto se pierde solo al cerrar el diálogo, que hoy es el único camino a
  «Completar a mano».
- **La cuota diaria propia de LinkVault ya se distingue**: `429 ai_quota_exceeded`, «Llegaste al límite de lecturas de
  hoy, vuelve mañana» (`run-task-pasted-extraction.ts:79-80`, `paste-description.usecase.ts:168-169`,
  `paste-description.dialog.ts:83-84`). Pero el `Retry-After` es fijo en 24 h (`limits.ts:81`) y descarta el instante
  real que `runTask` ya calcula (`aiQuotaRetryAt`, `libs/ai/src/domain/ai-result.ts:44`). La ventana es móvil, así
  que el instante puede caer hoy mismo, y entonces «vuelve mañana» también es inexacto. Además no devuelve el intento
  de pegado, que se consumió antes de llamar a la IA (`paste-description.usecase.ts:124-131`).

**Excepción a la precedencia de la fila 35.** ADR-048 §Consecuencias, extendida a la fila entera por ADR-051 §1,
impide que un change de otra fila preceda a la fila 35 mientras no termine. 35b (`staging-host`) y 35c siguen
abiertas. Este change **pide** una excepción como las de `e2e-suite` (ADR-053) y `usage-guide-fixes` (ADR-055 §1),
porque lo van a ver justo las 3 a 5 personas que 35b invita, y con la IA de staging (D13) es el error más probable
de su primer uso. **El owner no lo decidió todavía**: es la **Q1** de `design.md`, bloqueante para `/opsx:apply`.
Mientras tanto, este change solo existe como spec. Si se aprueba, la excepción no cambia el orden de la fila
(35b → 35c), no libera la precedencia para ningún otro change y no toca ficheros de despliegue, workflows ni
requirements de `platform/*`. Y aun aprobada, el PR solo se fusiona **después de la 11.6 de 35b y antes de su 10.7**,
repitiendo la 9.4 de `e2e-suite` y nunca los días 7 y 14 de la medición (design D11), salvo que el owner autorice
expresamente fusionar entre el PR-1 y el PR-2 de 35b (Q1 (d)).

## What Changes

- **`libs/ai`: un fallo de proveedor lleva su clase.** `ProviderUnavailable` pasa a distinguir tres clases, por el
  código HTTP: `rate_limited` (`429`), `rejected` (`401`, `402`, `403` y `404`: con esta configuración no va a
  atender, y reintentar no lo cambia) y `unavailable` (el resto: red, `5xx`, plazo). Ningún proveedor lee el cuerpo
  del error (ADR-018 §12 se mantiene).
- **El breaker recuerda la clase del último fallo.** Todas las clases cuentan igual en la ventana de 5 fallos: el
  circuito abre y cierra exactamente como hoy.
- **El degradado dice por qué falló el proveedor.** Cuando el motivo es `providers_failed` o `no_providers`, el
  resultado puede traer la condición agregada de los proveedores afectados (`consent_required`, `unavailable`,
  `rate_limited` o `rejected`, sin instante). Los cuatro motivos no cambian, el ledger tampoco y `aiQuotaRetryAt` sigue
  siendo solo de `quota_exceeded` (ADR-060).
- **Errores del pegado distintos y verdaderos** (API, `libs/shared`):
  - `503 extraction_unavailable`, con `Retry-After: 60`: fallo pasajero, y todo degradado sin caso propio. Se mantiene.
  - `503 ai_capacity_exhausted`: nuevo, para el cupo del proveedor agotado. Sin `Retry-After`: en este change no se
    sabe cuándo vuelve.
  - `503 extraction_disabled`: nuevo, para la lectura automática no disponible por configuración o por política de
    datos. Sin `Retry-After`.
  - `409 ai_consent_required`: nuevo, para quien no dio el permiso, cuando el permiso es lo primero que falta.
  - `429 ai_quota_exceeded`: pasa a llevar el `Retry-After` real.
  - `422 not_a_job_posting`: sin cambios.

  Todos los que no llegaron a leer el texto devuelven el intento de pegado, también la cuota propia.
- **Diálogo de pegado (SPA):** un texto por caso. **«Completar a mano»** se ofrece en el mismo diálogo tras cualquier
  error, y es la acción principal ante el cupo agotado, la lectura no disponible y la falta de permiso. Al pulsarlo se
  abre la corrección a mano del link, con el puesto y la empresa que se escribieron y **lo pegado como referencia
  copiable**, que no se envía ni se guarda. No se ofrece ir al permiso de Perfil, que habla solo del CV (Q7).
- **i18n** ES/EN según ADR-050: textos nuevos con `@@id` estable, `messages.xlf` re-extraído y `messages.en.xlf`
  traducido.
- Tests en cada capa (ver `tasks.md`). **Sin cambios de prompts, modelos ni fixtures**: la tarea 2.6 es una
  comprobación de no regresión del eval sin `--update-baseline`.
- **Fuera de este change (B3), para uno posterior** con la forma real del `429` confirmada por la 8.1 de 35b: leer el
  reinicio del cupo de OpenRouter, pausar el breaker hasta ese instante, el umbral de 5 min y el tope de 48 h.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `ai/provider-routing`: nuevo requirement «Clase del fallo de proveedor» y «Circuit breaker por proveedor» (clase del
  último fallo, sin cambiar cuándo abre).
- `ai/task-execution`: nuevo requirement «Condición del proveedor en la degradación». «Degradación tipada» no cambia.
- `links/pasted-description`: «Lo pegado tiene que parecer una oferta» (errores distintos) y «Límite de pegados»
  (qué devuelve el intento).
- `web/links`: «Pegar la descripción de una oferta» (textos verdaderos y jerarquía de acciones) y nuevo requirement
  «Completar a mano desde el pegado».

## Impact

- `libs/ai`: `domain/errors.ts`, `domain/ai-result.ts`, una función pura de agregación en `domain/`,
  `domain/ports/circuit-breaker.port.ts`, `infrastructure/resilience/{in-memory,redis}-circuit-breaker.ts` y
  `application/run-task.usecase.ts`. Los proveedores no cambian: heredan la clase de `ProviderUnavailable` (design
  D1). `embedTexts` comparte el breaker y no cambia de comportamiento, porque la clase no altera cuándo abre.
- `libs/shared`: tres códigos nuevos en `ApiErrorCode`.
- `apps/api`: `links` (puerto `PastedExtraction`, adaptador, caso de uso, errores de dominio) y
  `presentation/http/api-error.ts`. El encaje (`match`) no cambia: su vigencia depende de `snapshotOpenIds()`, que
  responde igual.
- `apps/web`: `paste-description.dialog`, `edit-preview.dialog` (dato opcional de referencia), specs de
  `link-list.component` y `match.dialog`, y los catálogos `messages.xlf` / `messages.en.xlf`.
- Sin migraciones, sin cambios en el ledger, en la caché, en prompts, en fixtures ni en el golden.
- Documentación: ADR-060 (nuevo) y una línea en ADR-018 §Enmiendas. Nada de `staging-host`: el pendiente de confirmar
  la forma real del `429` queda en ADR-060 §Consecuencias.
