## Context

El pegado de la descripción (`links/pasted-description`, `web/links`) es el camino principal para completar una oferta:
cuatro de cinco bolsas no se dejan leer (business, 2026-10-28). En staging, la única IA es OpenRouter `:free` con
`data_collection: deny` (`AI_CHAIN=openrouter`, design D13 de `staging-host`), cuyo cupo diario es pequeño y variable.
La verificación de la hipótesis (lectura de `main` `5b92d28`, 2026-10-28) está en `proposal.md`, «Why», con
fichero y línea. En resumen, el camino del fallo es este:

| Paso | Código | Qué hace con un `429`/`404` de OpenRouter o con falta de consentimiento |
| --- | --- | --- |
| Proveedor | `libs/ai/src/infrastructure/providers/openrouter.provider.ts:122-125` | Cualquier no-2xx da `ProviderUnavailable(id, status)`, sin cuerpo. |
| `runTask` | `libs/ai/src/application/run-task.usecase.ts:461-478`, `:240-245`, `:188-197` | Registra `provider_error`, cuenta un fallo en el breaker y degrada con `providers_failed`. Con el circuito abierto, `no_providers`. Sin consentimiento y cadena solo externa, `consent_required`. |
| Adaptador | `apps/api/src/modules/links/infrastructure/run-task-pasted-extraction.ts:78-81` | Todo lo que no es `quota_exceeded` se convierte en `unavailable`. |
| Caso de uso | `apps/api/src/modules/links/application/paste-description.usecase.ts:163-174` | `unavailable` da `503 extraction_unavailable` con `Retry-After: 60`. `quota_exceeded` da `429` con 24 h fijas y **no** devuelve el intento, aunque el contador se consumió antes de llamar a la IA (`:124-131`). |
| Código | `libs/shared/src/schemas/auth.schema.ts:170-175`, `apps/api/src/presentation/http/api-error.ts:34-36` | Tres códigos: `not_a_job_posting`, `extraction_unavailable` y `ai_quota_exceeded`. |
| Diálogo | `apps/web/src/app/features/links/paste-description.dialog.{ts,html}` | «No pudimos leerla ahora, inténtalo en un rato». Solo ofrece reintentar o cancelar. Lo pegado se conserva mientras el diálogo esté abierto. Lo abren `link-list.component.ts` y `match.dialog.ts`. |

## Goals / Non-Goals

**Goals:**

- Que cada error del pegado diga la verdad: cupo de la IA agotado, fallo pasajero (reintentar), lectura no disponible
  por configuración o por política de datos, falta de permiso, cuota propia (con su hora real) y texto rechazado.
- Que «Completar a mano» esté a un clic desde el error, sin perder lo pegado, que sirve como referencia copiable.
- Hacerlo sin romper las garantías de `libs/ai`: cuatro motivos cerrados, ledger sin contenido, errores sin cuerpo,
  política de routing pura y un breaker que abre y cierra exactamente como hoy.

**Non-Goals:**

- **Decir hasta cuándo dura el cupo del proveedor** (B3, diferido): leer el reinicio del cupo de las cabeceras o del
  cuerpo de OpenRouter, pausar el breaker hasta ese instante (en memoria y en Redis), el umbral entre espera corta y cupo
  agotado, y el tope de 48 h. Se retoma en un change posterior, cuando la tarea 8.1 de 35b haya confirmado la forma real
  del `429`.
- Cambiar prompts, modelos, fixtures o el golden (D9).
- Elegir otro proveedor o pagar cupo. Es una decisión de coste del owner, abierta en 35b (pago por uso).
- Medir en el ledger la clase de fallo (Q6) y cambiar los textos de degradación de otras tareas (encaje, roadmap).
- Decidir si `extract-pasted-job` debe pedir consentimiento, o si el texto del permiso de Perfil debe mencionar el
  pegado (Q7, del owner).
- Tocar despliegue, workflows o `platform/*` (condición de la excepción, Q1).

## Decisions

### D1. La clase del fallo vive en `ProviderUnavailable` y sale del código HTTP

`ProviderUnavailable` gana `kind: 'rate_limited' | 'rejected' | 'unavailable'`, derivado de `httpStatus` en el
constructor:

- `429` es `rate_limited`.
- `401`, `402`, `403` y `404` son `rejected`. Con esta credencial, este modelo o esta política de datos, el proveedor
  no va a atender, y reintentar en un minuto no lo cambia. «No endpoints found matching your data policy» llega como
  `404`, según la documentación de OpenRouter, que se cita en la tarea 2.4. En Ollama, un `404` es un modelo sin
  descargar.
- Cualquier otro código, o la ausencia de código (red, cuerpo inválido, `200` con `{ error }`), es `unavailable`.

Como la regla está en un solo sitio, `openrouter`, `openai`, `anthropic`, `ollama` y `openrouter-embedding` la heredan
sin cambiar su código. Ningún proveedor lee el cuerpo del error: ADR-018 §12 queda igual.

*Alternativas descartadas:* clasificar en `runTask` por `httpStatus`, porque repartiría la regla entre quien lanza y
quien interpreta; y distinguir «no endpoints» por el texto del cuerpo, que es frágil y obliga a tratar el cuerpo como
dato, contra ADR-018 §12.

### D2. Leer el instante de reinicio del cupo — **diferida** (B3)

La versión anterior leía el reinicio de `Retry-After`, de `X-RateLimit-Reset` o de
`error.metadata.headers["X-RateLimit-Reset"]` del cuerpo. Sale de este change: la forma real del `429` de OpenRouter
no está confirmada (la 8.1 de 35b lo hará), y leer el cuerpo era lo único que tocaba ADR-018 §12. Se retoma en un
change posterior, con la forma real.

### D3. El breaker recuerda la clase dominante de su ventana, sin pausa

- `recordFailure(providerId, failure?)` recibe `ProviderFailure = { kind: 'rate_limited' | 'rejected' | 'unavailable' }`.
  Sin argumento vale `{ kind: 'unavailable' }`, así que los dobles existentes siguen compilando. **`runTask` y
  `embedTexts` pasan la clase** del `ProviderUnavailable` capturado (`recordFailure(id, { kind })`); cualquier otro
  error cuenta como `unavailable` (N6).
- **Todas las clases cuentan igual** en la ventana de 5 fallos en 60 s. La apertura, el half-open de 30 s y el cierre
  no cambian: la clase solo se recuerda.
- **Clase dominante, no la última (N4).** Con el circuito cerrado, cada fallo de la ventana guarda su clase junto a su
  instante, y los que salen de la ventana se descartan juntos. Al abrirse, el circuito guarda la **clase dominante** de
  la ventana con la precedencia de D4 (`unavailable` > `rate_limited` > `rejected`). Si la prueba de half-open falla,
  la clase pasa a ser la de ese fallo: es el único de la ventana del nuevo período abierto. Así, cuatro `429` detrás de
  un `503` no esconden la caída.
- **Dónde se escribe y dónde se borra (N5).**
  - La clase vive **en el mismo JSON** del circuito (`StoredCircuit` en `redis-circuit-breaker.ts`, y su equivalente
    en memoria): las clases de la ventana van en paralelo a `failures`, y la del circuito abierto, junto a `openedAt`.
    Un JSON anterior sin esos campos se lee como `unavailable`.
  - Solo se escribe en los fallos que **hoy cambian el estado**: los que cuentan en la ventana con el circuito cerrado y
    el de la prueba de half-open. Un fallo con el circuito abierto y sin prueba en curso sigue sin escribir nada.
  - Solo se borra **donde hoy se borra el circuito**: cuando la prueba recibe respuesta (`recordSuccess` con el
    circuito abierto) y cuando el circuito queda vacío (`save` → `clear`).
  - `recordSuccess` con el circuito cerrado **no toca `failures`** ni sus clases, igual que hoy.
  - En Redis no hay TTL nuevo: la clave de estado sigue sin caducidad, y la del permiso de prueba conserva su `PX`.
- `openConditions()` devuelve, por cada circuito abierto según la misma regla de `snapshotOpenIds()`, su clase. Si
  Redis no responde, devuelve un mapa vacío, como `openIds()`: falla abierta.
- Lo implementan `InMemoryCircuitBreaker` y `RedisCircuitBreaker` (ADR-030 §8).

**Efecto en el encaje (C5).** La vigencia de un degradado del encaje (`cv/match`) se decide con
`ProviderEligibility`, que solo consulta `snapshotOpenIds()`. Como la clase no cambia cuándo un circuito está abierto,
la vigencia, el reintento y el ledger del encaje se comportan exactamente igual que hoy. El encaje recibe
`providerCondition` en su `AiDegraded` y no la lee ni la guarda.

*Diferido (B3):* la pausa del circuito hasta el reinicio conocido de un `429`.

### D4. El degradado lleva la condición agregada de los proveedores, sin motivo nuevo

`AiDegraded` gana un campo opcional `providerCondition: { kind: 'consent_missing' | 'unavailable' | 'rate_limited' |
'rejected' }`, **sin instante**. `consent_missing` significa «falta el permiso de quien ejecuta y ese permiso es
necesario para al menos un proveedor de la cadena hipotética». **No implica `consentWouldEnable`** ni el motivo
`consent_required`: puede acompañar a un `no_providers` cuya cadena compuesta no estaba vacía (N2). El nombre distinto
evita confundirla con el motivo.

- **Solo** puede acompañar a `providers_failed` y a `no_providers`. Nunca acompaña a `quota_exceeded` ni al motivo
  `consent_required`, y `aiQuotaRetryAt` sigue siendo exclusivo de `quota_exceeded`.
- **Cadena hipotética (C3).** Se compone con `buildChain` sobre el **mismo universo** de la ejecución (el restringido a
  BYOK si la cuota lo restringió), con `openIds` vacío y con el consentimiento supuesto. La política sigue siendo pura:
  es otra llamada a la misma función.
- **Proveedores afectados** son los de la cadena hipotética que no dieron salida válida, cada uno con su clase; vale
  la primera regla que le aplica:
  - excluido por falta de consentimiento (tenga o no el circuito abierto): `consent_missing`. La clase recordada del
    circuito de ese proveedor no cuenta (N1);
  - intentado y fallido: la clase de su error. Un `schema_error` o una cancelación cuentan como `unavailable`;
  - elegible según la instantánea de circuitos pero saltado porque `tryAcquire` no concedió el permiso (otra ejecución
    tomó la prueba entre `openIds()` y `tryAcquire()`): `unavailable` (N3);
  - excluido por circuito abierto: la clase recordada por el breaker, o `unavailable` si no hay. Un half-open con la
    prueba en curso cuando se toma la instantánea es abierto para ella y cuenta con su clase recordada (N3).
- **Agregación**, en este orden:
  1. con `no_providers`, si algún afectado es `consent_missing`, la condición es `consent_missing`: el permiso es lo
     primero que la persona puede arreglar. Cubre el caso que hoy cae fuera de `consentWouldEnable` porque ese
     proveedor externo además tiene el circuito abierto, y el de la carrera de `tryAcquire` con un local y un externo
     sin permiso. Con `providers_failed`, los `consent_missing` no cuentan, igual que en «Degradación tipada»: hubo una
     avería y eso es lo que se dice;
  2. si no, `unavailable` si algún afectado lo es;
  3. si no, `rate_limited` si alguno lo es;
  4. si no, `rejected`.
- **Sin afectados** (la cadena hipotética está vacía), el campo no aparece. Así un `no_providers` sin condición
  significa «no hay IA configurada o capaz para esto», algo que no cambia por esperar.

Los cuatro motivos, su precedencia, `consentWouldEnable`, el ledger y la caché no cambian: un degradado no se cachea.
Lo registra ADR-060, que enmienda ADR-018 §1 y §7.

*Alternativas descartadas:*
- Motivos nuevos en `DEGRADED_REASONS`: rompen la lista cerrada, el `enum` del ledger y cada `switch` de las tareas.
- Cambiar `consentWouldEnable` para que ignore los circuitos abiertos: movería el motivo de `no_providers` a
  `consent_required` en el encaje, que decide la vigencia por motivo, y eso sí cambiaría su comportamiento.
- Un booleano «transitorio»: no distingue cupo de política.

### D5. El pegado traduce cada caso a un error propio

El puerto `PastedExtraction` (`apps/api/src/modules/links/application/ports/pasted-extraction.port.ts`) amplía su
unión cerrada:

```
| { outcome: 'quota_exceeded'; retryAt?: Date }
| { outcome: 'consent_required' }
| { outcome: 'capacity_exhausted' }
| { outcome: 'disabled' }
| { outcome: 'unavailable' }
```

El adaptador decide la variante, y el caso de uso, el error de dominio y la respuesta:

| Resultado de `runTask` | `outcome` | Respuesta | `Retry-After` | ¿Devuelve el intento? |
| --- | --- | --- | --- | --- |
| `success` con `isJobPosting: false` | `not_a_job_posting` | `422 not_a_job_posting` | — | no (igual que hoy: la IA leyó) |
| `quota_exceeded` | `quota_exceeded` | `429 ai_quota_exceeded` | hasta `aiQuotaRetryAt`, mínimo 1 s; sin el dato, 24 h | **sí** (C10) |
| motivo `consent_required` | `consent_required` | `409 ai_consent_required` | — | sí |
| `no_providers` con condición `consent_missing` | `consent_required` | `409 ai_consent_required` | — | sí |
| condición `rate_limited` | `capacity_exhausted` | `503 ai_capacity_exhausted` | — | sí |
| condición `rejected` | `disabled` | `503 extraction_disabled` | — | sí |
| `no_providers` sin condición | `disabled` | `503 extraction_disabled` | — | sí |
| condición `unavailable` | `unavailable` | `503 extraction_unavailable` | 60 s | sí |
| **cualquier otro degradado** (p. ej. `providers_failed` sin condición), plazo agotado o consentimiento ilegible | `unavailable` | `503 extraction_unavailable` | 60 s | sí |

Notas de la tabla:

- `disabled` queda **solo** para `rejected` y para «no hay proveedores capaces» sin otra causa. Todo degradado que no
  tenga fila propia va a `unavailable` (C3): ante la duda, el mensaje que invita a reintentar es el menos dañino.
- Que el contador de pegados no responda sigue siendo `503 extraction_unavailable` y sigue sin llamar a la IA.
- **`409` para el consentimiento.** Es una precondición que la persona arregla, como `no_cv`, y no un fallo del
  servidor.
- **`503` sin `Retry-After`.** RFC 9110 permite omitirlo, y omitirlo es justo lo honesto cuando no se sabe cuándo
  vuelve. En este change `ai_capacity_exhausted` nunca lo lleva, y el SPA lo ignora si llegara (D2 diferida, N7).
- **El intento se devuelve** en todos los casos en que la IA no leyó el texto, incluida la cuota propia (C10): el
  contador se consume antes de llamar a la IA (`paste-description.usecase.ts:124-131`), así que la cuota agotada
  también gastaba un pegado.

*Alternativas descartadas:*
- Un solo `503` con un subcódigo en el cuerpo. `ApiErrorResponse` no lo admite, y el SPA ya traduce por código.
- `403` para el consentimiento. `forbidden` significa permiso sobre el recurso, y el SPA lo explica distinto.

### D6. El diálogo dice lo que pasa, y qué hacer

Textos en ES. Las traducciones EN siguen D8.

| Caso | Texto | Acción principal | Volver a enviar |
| --- | --- | --- | --- |
| `extraction_unavailable` | «No pudimos leerla ahora, inténtalo en un rato» (sin cambio) | Enviar | principal |
| `ai_capacity_exhausted` (con o sin `Retry-After`) | «La IA no admite más lecturas por ahora y no sabemos cuándo vuelve» | Completar a mano | secundaria |
| `extraction_disabled` | «La lectura automática no está disponible. Puedes completarla a mano» | Completar a mano | no se ofrece |
| `ai_consent_required` | «Tu cuenta no permite leerla con IA externa. Puedes completarla a mano» | Completar a mano | no se ofrece |
| `ai_quota_exceeded` | «Llegaste a tu límite de lecturas con IA. Podrás volver a pegar {cuándo}». Sustituye a «…vuelve mañana», que es falso cuando la ventana móvil se libera hoy. | Completar a mano | secundaria |
| `too_many_attempts`, `not_a_job_posting`, errores comunes | sin cambio | Enviar | principal |

- **Sin «Dar permiso en Perfil» (B1).** El permiso de Perfil habla solo del CV
  (`apps/web/src/app/features/profile/profile.page.html:147,154`): llevar allí a quien pega lo haría aceptar un texto
  que no describe lo que va a pasar. Qué hacer con eso es la Q7.
- **Sin variante con hora para `ai_capacity_exhausted` (N7).** El SPA siempre dice «no sabemos cuándo vuelve» e
  ignora el `Retry-After` de esa respuesta. La variante con hora se reintroduce con D2, cuando la API sepa la hora.
- **{cuándo}** solo existe para `ai_quota_exceeded`. `whenText(now, retryAfterMinutes, locale)` suma al instante actual
  el `Retry-After` de `RequestFailure` (ya en minutos, redondeado hacia arriba) y **redondea el resultado hacia arriba
  al minuto siguiente** si tiene segundos (N8b): nunca anuncia una hora anterior a la real. Dice «hoy a las HH:mm» si
  cae hoy, «mañana a las HH:mm» si cae mañana y una fecha corta en otro caso, con la hora local del navegador y el
  locale activo.
- «Completar a mano» es la acción principal (botón relleno) donde reenviar no arregla nada o casi seguro vuelve a
  fallar (B5): cupo de la IA, cuota propia (B2-8), lectura no disponible y permiso. En el resto aparece como acción
  secundaria.
- **Orden de las acciones (B2-10):** principal, secundaria si la hay, y cancelar, también a 360 px de ancho.
- **Texto del cupo (N8a, B2-11).** «No admite más lecturas por ahora» no culpa a nadie: vale tanto para el cupo de la
  cuenta de OpenRouter como para la saturación del proveedor de origen del modelo `:free`, que también llega como `429`.

### D7. «Completar a mano» desde el mismo diálogo, con lo pegado como referencia copiable

- El botón «Completar a mano» (`data-testid="paste-complete-by-hand"`) aparece tras **cualquier** fallo del envío,
  sea propio del pegado o común (sin conexión, error genérico). También tras `not_a_job_posting` (Q2): la IA puede
  equivocarse, y lo pegado sigue sirviendo de referencia.
- Al pulsarlo, el diálogo de pegado **se cierra y él mismo** abre `EditPreviewDialog` sobre el mismo link. Así
  funciona igual desde la lista de links y desde el diálogo de encaje (`match.dialog.ts`, C9), sin que cada pantalla
  tenga que reaccionar.
- `EditPreviewDialogData` gana `reference?: { text: string; title?: string; company?: string }`:
  - `title` y `company` son los que la persona **cambió** en el pegado, con la misma regla de `changed()` de hoy.
    Entran como valor inicial **modificado** del formulario: se enviarán como edición manual, que es lo que son.
  - `text` se muestra en un panel plegable: «Lo que pegaste (solo para consultar: no se guarda ni se envía)». Es
    **texto seleccionable y copiable** (B4): un `<pre>`/párrafo con `white-space: pre-wrap` o un `<textarea readonly>`,
    **nunca** `disabled`, que en varios navegadores impide seleccionar. Vive en la memoria del diálogo. No entra en el
    store, no viaja en la petición de edición y no se registra.
- La corrección a mano exige el mismo permiso que pegar (ver el link, `requireReadableLink` en
  `update-link-preview.usecase.ts`), así que ofrecerla no amplía permisos.

*Alternativas descartadas:*
- Incrustar el formulario de edición en el diálogo de pegado. Duplica un formulario con su procedencia, sus
  reversiones y sus validaciones.
- Devolver un resultado a quien abre el diálogo para que abra la edición. Cada pantalla tendría que hacerlo, y la
  spec pide que el diálogo funcione igual desde todas.
- Precargar campos a partir del texto con reglas. Sería una segunda extracción sin IA, fuera de alcance.

### D8. Textos e i18n (ADR-050)

- Cada texto nuevo lleva un `@@id` estable con el prefijo `links.paste.`: `capacityExhausted`
  (un solo texto, sin variante con hora: N7), `disabled`, `consentRequired`, `quotaExceededUntil`, `completeByHand`, `when.today`,
  `when.tomorrow`, `when.date` y `edit.reference`.
- `@@links.paste.quotaExceeded` cambia de texto y **conserva su id**.
- `messages.xlf` se regenera con `pnpm nx run web:extract-i18n`. `messages.en.xlf` recibe las traducciones y el
  `source` actualizado.
- `pnpm nx run web:i18n-check` verde.

### D9. Lo que no cambia, y la comprobación de no regresión del eval

- Los cuatro motivos y su precedencia no cambian, ni el ledger, ni la caché, ni la redacción, ni el consentimiento,
  ni las cuotas, ni cuándo se abre o se cierra un circuito.
- No se toca ningún prompt, modelo, fixture ni golden. El mock nunca lanza un `429`, así que las métricas del eval no
  pueden moverse. La tarea 2.6 es una **comprobación de no regresión** (C6): `pnpm nx run ai:eval-ci` (o
  `ai:eval --all --provider=mock`) **sin** `--update-baseline`, con salida 0 y `git status --porcelain` limpio. Si algún
  día este trabajo tocara un prompt o un fixture, la regla de CLAUDE.md exige `--update-baseline` en el mismo commit.
- `consent_required` ya existía en `runTask`. Lo nuevo es que el pegado deja de tratarlo como un fallo pasajero.

### D10. Cómo se verifica sin proveedores reales

- **Proveedor.** `openrouter.provider.spec.ts` sustituye `fetch` y prueba el `429` y el `404`, y que ni el cuerpo ni la
  credencial salen en el error. La relación «no endpoints» = `404` se toma de la documentación de OpenRouter y se
  anota con la fecha de la consulta (tarea 2.4). La confirmación con una respuesta real queda en la 8.1 de 35b, que
  ya registra «qué proveedor respondió o el error "no endpoints"»; reflect se la comunica a esa sesión (C7). Si la
  forma real difiere, el resultado es el de hoy (`unavailable`) y no algo peor (ver Riesgos).
- **`runTask`.** Proveedores falsos (`fake-llm-provider.ts`) que lanzan `ProviderUnavailable` con cada código, y los
  breakers en memoria y Redis con su suite actual.
- **API.** Caso de uso con dobles; controlador con `runTask` doble (`links.controller.pasted.spec.ts`).
- **SPA.** Specs del diálogo con `HttpTestingController`, incluido el pegado abierto desde el encaje.
- En CI: `AI_CHAIN=mock` y `AI_MOCK_MODE=replay`. Ninguna prueba llama a un proveedor real.

### D11. Ventana de fusión y fusiones cubiertas por la excepción

Aun con la Q1 concedida, ninguna fusión del change puede romper a 35b ni a `e2e-suite`:

- `openspec/changes/staging-host/tasks.md`: «Entre PR-1 y PR-2 no se fusiona nada a `main`». El PR-1 de 35b ya está en
  `main` (#86).
- D15 de `e2e-suite`: nada se fusiona entre el PR-2 de 35b y su 11.6.

**La excepción que firma el owner (Q1) cubre las tres clases de fusión del change**, no solo la primera:

1. **La fusión del change**, solo dentro de la ventana (a): **después de la 11.6 de 35b y antes de su 10.7** (la
   invitación). Aquí no hace falta la cláusula «nunca los días 7 y 14»: la ventana termina antes de la 10.7 y la
   medición empieza con ella, así que esos días nunca caen dentro. Después de fusionar, y antes de la 10.7, se repite la
   9.4 de `e2e-suite` sobre el commit desplegado con este change (la precondición de invitar se anota sobre el commit
   que se despliega).
2. **El PR de archivo.** Lleva las anotaciones posteriores a la fusión (la repetición de la 9.4, las casillas de la 6.x
   y la 7.x) y se fusiona **después de la 10.7**.
3. **Las fusiones de vuelta atrás**, si las hay (revertir este change), y la vuelta de esa vuelta atrás.

Las clases 2 y 3 tienen sus propias reglas: **nunca** entre el PR-2 de 35b y su 11.6, **nunca** durante su 9.1-9.4,
**nunca** los días 7 y 14 de la medición y **nunca** el día de una corrida `e2e-remote`.

**De dónde sale el estado (ajuste común a todos los changes).** La casilla de la 10.7 se marca recién en el PR de
archivo de 35b, después de invitar, así que no sirve para saber si ya se invitó. Cada fusión toma el estado de la 11.6,
de la 9.1-9.4 y de la 10.7 de 35b de una **confirmación escrita y fechada del owner en el PR** (por ejemplo, «11.6 hecha
el AAAA-MM-DD; 10.7 no hecha»). Las casillas de `staging-host/tasks.md` son solo apoyo. El PR-2 de 35b se identifica
**por su número**. Los días 7 y 14 se cuentan desde la fecha de la 10.7 que confirma el owner. Si el owner declara la
10.7 hecha, la fusión del change está fuera de ventana y no se fusiona. Las tareas 6.3 (fusión del change), 7.3 (PR de
archivo) y 7.4 (vueltas atrás) lo comprueban, y la 7.3 verifica en `main` cada fusión de este change.

## Risks / Trade-offs

- **[La forma real del `429` o del «no endpoints» de OpenRouter difiere de la documentada]** → la clasificación cae
  a `unavailable`, que es el comportamiento de hoy. Lo confirma la 8.1 de 35b, y queda anotado como pendiente en
  ADR-060 §Consecuencias.
- **[Un `429` pasajero se anuncia como «no admite más lecturas por ahora»]** → sin el instante de reinicio (D2
  diferida), tres causas distintas llegan igual como `429`: el cupo diario de la cuenta de OpenRouter, el límite de
  20 peticiones por minuto y la **saturación del proveedor de origen** del modelo `:free`, que a veces se libera en
  segundos (N8a, B2-11). «Por ahora» y «no sabemos cuándo vuelve» son verdad en los tres casos, y reenviar queda como
  acción secundaria. Se afina en el change que retome D2.
- **[Un `404` pasajero se clasifica como `rejected`]** → el diálogo dice «no disponible» y ofrece completar a mano,
  pero el breaker sigue el umbral de siempre y se recupera en el half-open de 30 s. El coste es un mensaje pesimista
  durante segundos.
- **[Quien no dio el permiso no tiene un camino para darlo desde el pegado]** → a propósito (B1): el permiso de Perfil
  habla solo del CV. La Q7 decide si hace falta.
- **[«{cuándo}» con la hora del navegador]** → la persona ve su hora local. El `Retry-After` es relativo, así que no
  depende de la zona del servidor.
- **[Precedencia de la fila 35 y ventana de fusión]** → nada se aplica sin la Q1, y ninguna de las tres clases de
  fusión de D11 se hace fuera de sus reglas. El estado de la 10.7 sale de la confirmación del owner, no de una casilla
  que se marca después de invitar.
- **[Clase dominante y JSON anterior]** → un estado de Redis escrito antes del despliegue no trae clases; se lee como
  `unavailable`, que es el mensaje de hoy. El formato de `failures` no cambia, así que una versión anterior que lea un
  estado nuevo ignora los campos añadidos.

## Migration Plan

Sin datos ni migraciones. Orden dentro del change: `libs/ai` (grupos 1 y 2), después la API (grupo 3) y después el SPA
(grupos 4 y 5). Todo cabe en un PR, que se fusiona solo en la ventana de D11; las anotaciones posteriores van en el PR de archivo.
Rollback: revertir el PR, con las reglas de las vueltas atrás de D11 (clase 3). Los códigos
nuevos solo los produce este change, y un SPA viejo frente a una API nueva los mostraría con el texto genérico de
`lv-request-error`.

## Open Questions

- **Q1 [bloqueante] Excepción a la precedencia de la fila 35.** ¿Se abre este change, y se aplica y fusiona, antes de
  cerrar la fila 35?
  - (a) Sí, aplicarlo ya, con una excepción que cubre **las tres clases de fusión de D11**: la fusión del change
    solo después de la 11.6 de 35b y antes de su 10.7 (según confirmación escrita y fechada del owner en el PR),
    repitiendo la 9.4 de `e2e-suite` sobre el commit desplegado; el PR de archivo, después de la 10.7; y las vueltas
    atrás, si las hay, y su vuelta. El PR de archivo y las vueltas atrás nunca entre el PR-2 de 35b y su 11.6, nunca
    durante su 9.1-9.4, nunca los días 7 y 14 de la medición y nunca el día de una corrida `e2e-remote`. Los invitados
    son quienes chocan con esto (D13 de 35b lo anota como riesgo) y el change no toca nada de 35b ni de 35c.
  - (b) Sí, pero solo spec hasta archivar 35c.
  - (c) No: se reabre tras la fila 35.
  - (d) Sí, y el owner autoriza **expresamente** una excepción a la regla «Entre PR-1 y PR-2 no se fusiona nada a
    `main`» de 35b, para fusionarlo antes. Riesgo para la 6.3 de 35b (primer despliegue real, que relanza el
    `preflight` de la corrida del push de PR-1): con otro commit en `main`, el merge de este change dispara su propia
    corrida y el primer despliegue deja de ser el del commit ensayado, o compite con él; además obliga a repetir la
    9.4 de `e2e-suite`.

  **Recomendación: (a).** Llega a tiempo para los invitados sin tocar la secuencia de 35b. Se registra con fecha en
  ADR-060 §1 y con una línea en ADR-048 §Consecuencias, como ADR-053 y ADR-055.
- **Q2 [no bloqueante] ¿«Completar a mano» también tras `not_a_job_posting`?** (a) Sí. (b) No, solo tras los
  errores de lectura. **Recomendación: (a)**: la IA puede equivocarse, y lo pegado sirve de referencia igual.
- **Q3 [sin objeto]** Umbral entre espera corta y cupo agotado. Se difiere con D2 (B3).
- **Q4 [no bloqueante] Textos de D6.** Los cambió reflect tras business (B1, B2, B6); el owner puede reescribirlos sin
  cambiar el diseño. **Recomendación:** aceptarlos y revisarlos en el móvil, como pide la línea de riesgo de D13 de
  35b («se comprueba en el móvil que se entiende»).
- **Q5 [no bloqueante] Lo pegado como referencia en la corrección a mano.**
  - (a) Panel plegable con texto copiable.
  - (b) No mostrarlo.
  - (c) Mostrarlo desplegado.

  **Recomendación: (a)**: ayuda a copiar el salario o la modalidad sin ocupar la pantalla del móvil, y no se envía
  ni se guarda.
- **Q6 [no bloqueante] ¿Registrar en el ledger la clase del fallo para medir el cupo en staging?** (a) No en este
  change: el log `AI provider error` ya lleva `httpStatus`. (b) Sí: un campo nuevo en `ai_usage`, con su
  migración de `enum`. **Recomendación: (a)**: (b) toca el ledger, que este change deja intacto a propósito.
- **Q7 [no bloqueante para este change; decisión del owner] Consentimiento y pegado.** `extract-pasted-job` es
  `personal`, así que con `AI_CHAIN=openrouter` exige el permiso de IA externa, pero el permiso de Perfil
  («Permitir que un proveedor de IA externo analice mi CV», `profile.page.html:147,154`) solo habla del CV. Una oferta
  pública no lleva datos personales de quien pega, aunque el texto pegado puede traer datos de terceros (recruiter)
  que `PiiRedactor` quita.
  - (a) Dejar `extract-pasted-job` como `personal` y ampliar el texto del permiso de Perfil para que mencione la
    descripción de las ofertas que pegas (nueva versión del texto: quien ya lo dio tiene que aceptarlo de nuevo).
  - (b) Reclasificar `extract-pasted-job` como no `personal`: el pegado deja de pedir el permiso, siempre con
    `PiiRedactor` y `data_collection: deny`. Requiere ADR (enmienda ADR-014/ADR-018 sobre sensibilidad).
  - (c) Un permiso aparte para el pegado.
  - (d) Dejarlo como está: el pegado sin permiso termina en «Completar a mano».

  **Recomendación: (b)**: lo que se envía es una oferta pública, ya pasa por `PiiRedactor` y por `data_collection:
  deny`, y pedir un permiso que habla del CV para leer una oferta confunde justo a quien más usa el pegado. Es un
  change propio, con su ADR.

  **Voto de business (iteración 2, 2026-10-28):** (b) en un change propio con ADR, con `PiiRedactor` obligatorio y
  `data_collection: deny`, planificado **antes de la 10.7 de 35b**; mientras tanto, (d). Es un voto: Q7 sigue siendo
  decisión del owner.

## Debate — iteración 1

Resultado de la iteración 1: critic P0 0 / P1 11 (C1-C11); business V0 1 (B1-B6). Decisiones de reflect (sesión
principal), 2026-10-28.

| Id | Origen | Decisión | Motivo |
| --- | --- | --- | --- |
| B1 | business (V0) | Aceptado | Sin «Dar permiso en Perfil»: ese permiso habla solo del CV; texto nuevo del `409` y Q7 al owner. |
| B2 | business | Aceptado | El texto de cupo no dice «gratuitas» y tiene sujeto claro: «La IA llegó a su límite de lecturas…». |
| B3 | business | Aceptado (recorte) | Se difieren D2, la pausa de D3, el umbral de 5 min y las 48 h hasta confirmar el `429` real (8.1 de 35b). |
| B4 | business | Aceptado | La referencia es texto seleccionable y copiable (`readonly` o texto plano, nunca `disabled`). |
| B5 | business | Aceptado | Con cupo, lectura no disponible o permiso, «Completar a mano» es la principal; reenviar, secundaria o fuera. |
| B6 | business | Aceptado | «La lectura automática no está disponible. Puedes completarla a mano». |
| C1 | critic | Sin objeto | Su objeto (lectura del reinicio o pausa del breaker) sale del change con el recorte de B3. |
| C2 | critic | Sin objeto | Su objeto (lectura del reinicio o pausa del breaker) sale del change con el recorte de B3. |
| C3 | critic | Aceptado | Afectados sobre la cadena hipotética (sin `openIds`, permiso supuesto); `tryAcquire` = `unavailable`; sin fila = `unavailable`. |
| C4 | critic | Sin objeto | Su objeto (pausa, umbral o tope de 48 h) sale del change con el recorte de B3. |
| C5 | critic | Sin objeto (frase corregida) | Sin pausa, la clase no cambia `snapshotOpenIds`: la vigencia del encaje no cambia; ADR-060 lo dice exacto. |
| C6 | critic | Aceptado | La 2.6 es no regresión: `ai:eval-ci` sin `--update-baseline`, salida 0 y `git status --porcelain` limpio. |
| C7 | critic | Aceptado | Fuera la 7.3; el pendiente del `429` real va a ADR-060 §Consecuencias y reflect avisa a 35b. |
| C8 | critic | Aceptado | Tareas de más de 1 h partidas: 2.5 en a/b/c y 2.2 en a/b. |
| C9 | critic | Aceptado | Caso en `match.dialog.spec.ts` para completar a mano desde el pegado abierto en el encaje. |
| C10 | critic | Aceptado | `quota_exceeded` también devuelve el intento: el contador se consume antes de llamar a la IA. |
| C11 | critic | Sin objeto | En lo que tocaba la lectura del cuerpo del `429`, diferida por B3; ningún proveedor lee el cuerpo. |
| P0 (otro change) | critic vía reflect | Aceptado | Ventana de fusión: solo tras la 11.6 de 35b y antes de su 10.7, repitiendo la 9.4 de `e2e-suite` (D11, Q1 (a)/(d)). |

Interpretación del arquitecto, a confirmar por reflect en la iteración 2: «si el permiso habría habilitado alguno, gana
`consent_required`» se aplica solo con `no_providers`, mediante la condición `consent_required`. Con `providers_failed`
manda la regla vigente de «Degradación tipada» (la avería gana), y `consentWouldEnable` no cambia para no mover la
vigencia del encaje (D4).

Convergencia: NO (pendiente de la iteración 2).

## Debate — iteración 2

Resultado de la iteración 2: critic P0 0 / P1 8 (N1-N8); business V0 0 (B2-7 a B2-11 y un voto en Q7). Decisiones de
reflect (sesión principal), 2026-10-28. Confirma la interpretación de la iteración 1: la condición de permiso gana solo
con `no_providers`, y `consentWouldEnable` no cambia.

| Id | Origen | Decisión | Motivo |
| --- | --- | --- | --- |
| N1 | critic | Aceptado | Un proveedor excluido por falta de consentimiento cuenta como `consent_missing` tenga o no el circuito abierto; su clase recordada no cuenta (D4, ADR-060 §4). |
| N2 | critic | Aceptado | La condición se llama `consent_missing` («falta el permiso y es necesario») y no implica `consentWouldEnable`; escenario de la carrera de `tryAcquire` con un externo sin permiso. |
| N3 | critic | Aceptado | El saltado es el que la instantánea daba elegible y perdió la prueba antes de enviar (breaker doble que cambia entre `openIds()` y `tryAcquire()`); escenario «prueba de half-open en curso → clase recordada». |
| N4 | critic | Aceptado | El breaker guarda la clase dominante de la ventana (`unavailable` > `rate_limited` > `rejected`), no la del último fallo; un test en cada breaker. |
| N5 | critic | Aceptado | La clase vive en `StoredCircuit`; se escribe solo en los fallos que cambian el estado y se borra solo donde se borra el circuito; un éxito no toca `failures`; sin TTL nuevo (D3, 2.1, 2.2a). |
| N6 | critic | Aceptado | `embedTexts` también pasa la clase (`recordFailure(id, { kind })`), con su test (2.5d). |
| N7 | critic | Aceptado | Sin variante con hora de `ai_capacity_exhausted` en spec, D6, D8 ni 4.1; el SPA ignora `Retry-After` en ese código. Vuelve con D2. Cubre B2-9. |
| N8 | critic | Aceptado | (a) «La IA no admite más lecturas por ahora y no sabemos cuándo vuelve» y riesgo ampliado a la saturación del proveedor de origen (cubre B2-11). (b) `whenText` redondea al minuto siguiente. |
| B2-7 | business | Aceptado | `409`: «Tu cuenta no permite leerla con IA externa. Puedes completarla a mano». |
| B2-8 | business | Aceptado | Con `ai_quota_exceeded`, «Completar a mano» principal y reenviar secundaria (regla y escenario). |
| B2-9 | business | Cubierto por N7 | Sin hora inventada para el cupo del proveedor. |
| B2-10 | business | Aceptado | Tarea 5.6: orden principal, secundaria, cancelar, comprobado a 360 px. |
| B2-11 | business | Cubierto por N8a | Texto del cupo sin atribuir la causa. |
| Q7 | business (voto) | Registrado | (b) en change propio con ADR, `PiiRedactor` obligatorio y `data_collection: deny`, antes de la 10.7 de 35b; mientras tanto (d). Decide el owner. |
| Ventana | reflect (común a todos los changes) | Aceptado | El estado de la 11.6 y la 10.7 sale de una confirmación escrita y fechada del owner en el PR; PR-2 de 35b por número; falsación «owner declara 10.7 hecha → fuera de ventana»; anotaciones posteriores en el PR de archivo. |
| Excepción | reflect (P0 de critic en otro change, común a todos) | Aceptado | La excepción de Q1 cubre las tres clases de fusión: la del change (ventana (a), sin cláusula de días 7 y 14), el PR de archivo y las vueltas atrás, estas dos con sus reglas propias (D11, ADR-060 §1, 6.3, 7.3, 7.4). |

Q1 sigue pendiente del owner.

Convergencia: pendiente de la confirmación de critic y business sobre esta iteración.
