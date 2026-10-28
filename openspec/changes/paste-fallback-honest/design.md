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
| Caso de uso | `apps/api/src/modules/links/application/paste-description.usecase.ts:163-174` | `unavailable` da `503 extraction_unavailable` con `Retry-After: 60`. `quota_exceeded` da `429` con 24 h fijas. |
| Código | `libs/shared/src/schemas/auth.schema.ts:170-175`, `apps/api/src/presentation/http/api-error.ts:34-36` | Tres códigos: `not_a_job_posting`, `extraction_unavailable` y `ai_quota_exceeded`. |
| Diálogo | `apps/web/src/app/features/links/paste-description.dialog.{ts,html}` | «No pudimos leerla ahora, inténtalo en un rato». Solo ofrece reintentar o cancelar. Lo pegado se conserva mientras el diálogo esté abierto. |

## Goals / Non-Goals

**Goals:**

- Que cada error del pegado diga la verdad: cupo agotado (y hasta cuándo, si se sabe), fallo pasajero (reintentar),
  lectura no disponible por configuración o por política de datos, falta de permiso y texto rechazado.
- Que «Completar a mano» esté a un clic desde el error, sin perder lo pegado, que sirve como referencia.
- Hacerlo sin romper las garantías de `libs/ai`: cuatro motivos cerrados, ledger sin contenido, errores sin cuerpo y
  política de routing pura.

**Non-Goals:**

- Cambiar prompts, modelos, fixtures o el golden. No aplica `ai:eval --update-baseline` (D9).
- Elegir otro proveedor o pagar cupo. Es una decisión de coste del owner, abierta en 35b (pago por uso).
- Medir en el ledger la clase de fallo (Q6) y cambiar los textos de degradación de otras tareas (encaje, roadmap).
  Esas pantallas pueden leer la condición nueva en un change posterior.
- Tocar despliegue, workflows o `platform/*` (condición de la excepción, Q1).

## Decisions

### D1. La clase del fallo vive en `ProviderUnavailable` y sale del código HTTP

`ProviderUnavailable` gana `kind: 'rate_limited' | 'rejected' | 'unavailable'`, derivado de `httpStatus` en el
constructor:

- `429` es `rate_limited`, y puede llevar un `resetAt` opcional.
- `401`, `402`, `403` y `404` son `rejected`. Con esta credencial, este modelo o esta política de datos, el proveedor
  no va a atender, y reintentar en un minuto no lo cambia. «No endpoints found matching your data policy» llega como
  `404`, según la documentación de OpenRouter, que se confirma en la tarea 2.4. En Ollama, un `404` es un modelo sin
  descargar.
- Cualquier otro código, o la ausencia de código (red, cuerpo inválido, `200` con `{ error }`), es `unavailable`.

Como la regla está en un solo sitio, `openai`, `anthropic`, `ollama` y `openrouter-embedding` la heredan sin cambios.

*Alternativas descartadas:* clasificar en `runTask` por `httpStatus`, porque repartiría la regla entre quien lanza y
quien interpreta; y distinguir «no endpoints» por el texto del cuerpo, que es frágil y obliga a tratar el cuerpo como
dato, contra ADR-018 §12.

### D2. OpenRouter lee el instante de reinicio y nada más del cuerpo

Ante un `429`, el proveedor busca el instante de reinicio en este orden:

1. La cabecera `Retry-After`, en segundos o como fecha HTTP.
2. La cabecera `X-RateLimit-Reset`, en milisegundos epoch.
3. El campo `error.metadata.headers["X-RateLimit-Reset"]` del cuerpo JSON. OpenRouter repite ahí las cabeceras del
   límite de modelos gratuitos.

El cuerpo se parsea con un schema zod que **solo** extrae ese número. Si el parseo falla, no hay instante. Ni el cuerpo
ni el error de parseo se propagan, se registran ni entran en `cause`, igual que hoy. Un instante en el pasado o a más
de 48 h del reloj local se descarta, para no pausar un proveedor por un dato absurdo o por un desfase de reloj.

*Alternativa descartada:* no leer el cuerpo. Con el límite diario de modelos gratuitos el instante solo viaja ahí, y
sin él el diálogo no puede decir hasta cuándo.

### D3. El breaker pausa hasta el reinicio conocido y recuerda la clase del último fallo

- `recordFailure(providerId, failure)` recibe `ProviderFailure`, que es `{ kind: 'unavailable' | 'rejected' }` o
  `{ kind: 'rate_limited'; resetAt?: Date }`. Sin argumento vale `{ kind: 'unavailable' }`, así que `embedTexts` y
  los dobles existentes no cambian de comportamiento.
- Un `rate_limited` **con** `resetAt` abre el circuito de inmediato **hasta ese instante**. No cuenta en la ventana de
  5 fallos en 60 s, y al llegar el instante concede el permiso de prueba de half-open como hoy. Un `rate_limited`
  **sin** `resetAt`, un `rejected` y un `unavailable` cuentan como fallo, como hoy.
- Cada circuito guarda la clase de su último fallo, y `recordSuccess` la borra. `openConditions()` devuelve, por cada
  circuito abierto, esa clase y, si la hay, el instante de reapertura. Si Redis no responde, devuelve un mapa vacío,
  como `openIds()`: falla abierta.
- Tanto `InMemoryCircuitBreaker` como `RedisCircuitBreaker` (ADR-030 §8) lo implementan. En Redis, la pausa se
  guarda con TTL igual al plazo.

*Alternativas descartadas:*
- Un almacén de pausas aparte del breaker. Serían dos estados de disponibilidad que pueden contradecirse.
- No pausar y dejar que el breaker abra tras 5 fallos. Gasta 5 peticiones y 5 esperas de quien pega, y vuelve a
  probar cada 30 s contra un cupo que no vuelve hasta mañana.

### D4. El degradado lleva la condición agregada de los proveedores, sin motivo nuevo

`AiDegraded` gana un campo opcional `providerCondition`, que toma una de tres formas:
`{ kind: 'unavailable' }`, `{ kind: 'rate_limited'; retryAt?: string }` (ISO-8601 UTC) o `{ kind: 'rejected' }`.

- **Solo** puede acompañar a `providers_failed` y a `no_providers`. Nunca acompaña a `quota_exceeded` ni a
  `consent_required`, y `aiQuotaRetryAt` sigue siendo exclusivo de `quota_exceeded`.
- **Proveedores afectados** de una ejecución son los que la cadena intentó y fallaron, más los que el filtrado habría
  admitido de no estar su circuito abierto. Para obtenerlos se compone la cadena con y sin `openIds`; la política
  sigue siendo pura. Cada uno aporta una clase:
  - el fallo de este intento: un `schema_error` o una cancelación cuentan como `unavailable`;
  - o la condición recordada de su circuito: un circuito abierto sin condición cuenta como `unavailable`.
- **Agregación**, de la condición más esperanzadora a la menos:
  - si algún afectado es `unavailable`, la condición es `{ kind: 'unavailable' }`;
  - si no, y alguno es `rate_limited`, es `rate_limited`. Su `retryAt` es el más temprano de los conocidos, y solo
    se incluye si **todos** los `rate_limited` lo conocen. No se promete una hora que podría no cumplirse;
  - si no, es `rejected`.
- **Sin afectados**, el campo no aparece. Así un `no_providers` sin condición significa «no hay IA configurada o
  capaz para esto», algo que no cambia por esperar.

Los cuatro motivos, su precedencia, el ledger y la caché no cambian: un degradado no se cachea. Lo registra ADR-060,
que enmienda ADR-018 §1 y §7.

*Alternativas descartadas:* motivos nuevos en `DEGRADED_REASONS`, que rompen la lista cerrada, el `enum` del ledger y
cada `switch` de las tareas existentes; y un booleano «transitorio», que no sirve para decir hasta cuándo.

### D5. El pegado traduce cada caso a un error propio

El puerto `PastedExtraction` (`apps/api/src/modules/links/application/ports/pasted-extraction.port.ts`) amplía su
unión cerrada:

```
| { outcome: 'quota_exceeded'; retryAt?: Date }
| { outcome: 'consent_required' }
| { outcome: 'capacity_exhausted'; retryAt?: Date }
| { outcome: 'disabled' }
| { outcome: 'unavailable'; retryAfterSeconds?: number }
```

El adaptador decide la variante y el caso de uso, el error de dominio y la respuesta:

| Resultado de `runTask` | `outcome` | Respuesta | `Retry-After` | ¿Devuelve el pegado? |
| --- | --- | --- | --- | --- |
| `success` con `isJobPosting: false` | `not_a_job_posting` | `422 not_a_job_posting` | — | no (igual que hoy) |
| `quota_exceeded` | `quota_exceeded` | `429 ai_quota_exceeded` | hasta `aiQuotaRetryAt`; sin el dato, 24 h | no (igual que hoy) |
| `consent_required` | `consent_required` | `409 ai_consent_required` | — | **sí** |
| condición `rate_limited` con `retryAt` ≤ 5 min | `unavailable` | `503 extraction_unavailable` | hasta `retryAt` | sí |
| condición `rate_limited` con `retryAt` > 5 min, o sin `retryAt` | `capacity_exhausted` | `503 ai_capacity_exhausted` | hasta `retryAt`, solo si se conoce | sí |
| condición `rejected`, o `no_providers` sin condición | `disabled` | `503 extraction_disabled` | — | sí |
| condición `unavailable`, plazo agotado o consentimiento ilegible | `unavailable` | `503 extraction_unavailable` | 60 s | sí |

Notas de la tabla:

- Que el contador de pegados no responda sigue siendo `503 extraction_unavailable` y sigue sin llamar a la IA.
- **Umbral de 5 minutos.** Separa el límite por minuto del proveedor, que se resuelve esperando un poco, del cupo
  diario. Es una constante de `limits.ts`: `PASTE_SHORT_WAIT_SECONDS = 300` (Q3).
- **`409` para el consentimiento.** Es una precondición que la persona arregla, como `no_cv`, y no un fallo del
  servidor.
- **`503` sin `Retry-After`.** RFC 9110 permite omitirlo, y omitirlo es justo lo honesto cuando no se sabe cuándo
  vuelve.
- **El intento se devuelve** en todos los casos en que la IA no leyó el texto, salvo la cuota propia, que ya decide
  sin gastar IA y no tiene nada que devolver (igual que hoy).

*Alternativas descartadas:*
- Un solo `503` con un subcódigo en el cuerpo. `ApiErrorResponse` no lo admite, y el SPA ya traduce por código.
- `403` para el consentimiento. `forbidden` significa permiso sobre el recurso, y el SPA lo explica distinto.

### D6. El diálogo dice lo que pasa y hasta cuándo

Textos en ES. Las traducciones EN siguen D8.

| Caso | Texto |
| --- | --- |
| `extraction_unavailable` | «No pudimos leerla ahora, inténtalo en un rato» (sin cambio) |
| `ai_capacity_exhausted` con `Retry-After` | «Se agotaron las lecturas gratuitas de la IA. Vuelven {cuándo}» |
| `ai_capacity_exhausted` sin `Retry-After` | «Se agotaron por ahora las lecturas gratuitas de la IA y no sabemos cuándo vuelven» |
| `extraction_disabled` | «La lectura automática no está disponible» |
| `ai_consent_required` | «Para leerla con la IA hace falta tu permiso para enviar datos a proveedores externos» |
| `ai_quota_exceeded` | «Llegaste a tu límite de lecturas con IA. Podrás volver a pegar {cuándo}». Sustituye a «…vuelve mañana», que es falso cuando la ventana móvil se libera hoy. |
| `too_many_attempts`, `not_a_job_posting` | sin cambio |

- **{cuándo}** se calcula como el instante actual más el `Retry-After` de `RequestFailure`, que ya viene en minutos.
  Dice «hoy a las HH:mm» si cae hoy, «mañana a las HH:mm» si cae mañana y una fecha corta en otro caso, siempre con
  la hora local del navegador y el locale activo.
- Debajo del texto van las acciones de D7. Ante `ai_consent_required` se añade «Dar permiso en Perfil», que navega a
  `/perfil` y cierra el diálogo, como hace el diálogo de encaje (`match.dialog.ts:347-348`).

### D7. «Completar a mano» desde el mismo diálogo, con lo pegado como referencia

- El botón «Completar a mano» (`data-testid="paste-complete-by-hand"`) aparece tras **cualquier** fallo del envío,
  sea propio del pegado o común (sin conexión, error genérico). También tras `not_a_job_posting` (Q2): la IA puede
  equivocarse, y lo pegado sigue sirviendo de referencia.
- Al pulsarlo, el diálogo de pegado **se cierra y él mismo** abre `EditPreviewDialog` sobre el mismo link. Así
  funciona igual desde cualquier pantalla que lo abra, sin que cada pantalla tenga que reaccionar.
- `EditPreviewDialogData` gana `reference?: { text: string; title?: string; company?: string }`:
  - `title` y `company` son los que la persona **cambió** en el pegado, con la misma regla de `changed()` de hoy.
    Entran como valor inicial **modificado** del formulario: se enviarán como edición manual, que es lo que son.
  - `text` se muestra en un panel plegable de solo lectura: «Lo que pegaste (solo para consultar: no se guarda ni se
    envía)». Vive en la memoria del diálogo. No entra en el store, no viaja en la petición de edición y no se
    registra.
- La corrección a mano exige el mismo permiso que pegar (ver el link, `requireReadableLink` en
  `update-link-preview.usecase.ts`), así que ofrecerla no amplía permisos.

*Alternativas descartadas:*
- Incrustar el formulario de edición en el diálogo de pegado. Duplica un formulario con su procedencia, sus
  reversiones y sus validaciones.
- Devolver un resultado a quien abre el diálogo para que abra la edición. Cada pantalla tendría que hacerlo, y la
  spec pide que el diálogo funcione igual desde todas.
- Precargar campos a partir del texto con reglas. Sería una segunda extracción sin IA, fuera de alcance.

### D8. Textos e i18n (ADR-050)

- Cada texto nuevo lleva un `@@id` estable con el prefijo `links.paste.`: `capacityExhausted`,
  `capacityExhaustedUnknown`, `disabled`, `consentRequired`, `quotaExceededUntil`, `completeByHand`,
  `giveConsent`, `when.today`, `when.tomorrow`, `when.date` y `edit.reference`.
- `@@links.paste.quotaExceeded` cambia de texto y **conserva su id**.
- `messages.xlf` se regenera con `pnpm nx run web:extract-i18n`. `messages.en.xlf` recibe las traducciones y el
  `source` actualizado.
- `pnpm nx run web:i18n-check` verde.

### D9. Lo que no cambia, y por qué no hace falta `--update-baseline`

- Los cuatro motivos y su precedencia no cambian, ni el ledger, ni la caché, ni la redacción, ni el consentimiento,
  ni las cuotas.
- No se toca ningún prompt, modelo, fixture ni golden. El mock nunca lanza un `429`, así que las métricas del eval
  (`schema_validity_rate` y `degraded_rate`) no pueden moverse, y la línea base debe pasar **sin**
  `--update-baseline` (tarea 2.6). Si algún día este trabajo tocara un prompt o un fixture, la regla de CLAUDE.md
  exige `nx run ai:eval --provider=mock --update-baseline` en el mismo commit.
- `consent_required` ya existía en `runTask`. Lo nuevo es que el pegado deja de tratarlo como un fallo pasajero.

### D10. Cómo se verifica sin proveedores reales

- **Proveedor.** `openrouter.provider.spec.ts` sustituye `fetch` y prueba cada forma de `429` (cabecera, cuerpo con
  `metadata.headers`, sin dato), el `404`, el instante absurdo y que ni el cuerpo ni la credencial salen en el error.
  La forma del cuerpo se toma de la documentación de OpenRouter y se anota en el spec con la fecha de la consulta
  (tarea 2.4). La confirmación con una respuesta real queda en la tarea 8.1 de 35b, que ya registra «qué proveedor
  respondió o el error "no endpoints"». Si la forma real difiere, el resultado es el de hoy (`unavailable`) y no algo
  peor (ver Riesgos).
- **`runTask`.** Proveedores falsos (`fake-llm-provider.ts`) que lanzan `ProviderUnavailable` con cada código, y los
  breakers en memoria y Redis con su suite actual.
- **API.** Caso de uso con dobles; controlador con `runTask` doble (`links.controller.pasted.spec.ts`).
- **SPA.** Specs del diálogo con `HttpTestingController`.
- En CI: `AI_CHAIN=mock` y `AI_MOCK_MODE=replay`. Ninguna prueba llama a un proveedor real.

## Risks / Trade-offs

- **[La forma real del `429` o del «no endpoints» de OpenRouter difiere de la documentada]** → la clasificación cae
  a `unavailable`, que es el comportamiento de hoy. Se confirma con la llamada real de 35b (tarea 8.1 de
  `staging-host`); la tarea 7.3 de este change pide anotar el resultado.
- **[Un `404` pasajero se clasifica como `rejected`]** → el diálogo dice «no disponible» y ofrece completar a mano,
  pero el breaker sigue el umbral de siempre para `rejected` y se recupera en el half-open de 30 s. El coste es un
  mensaje pesimista durante segundos.
- **[La pausa de hasta 48 h deja a todos sin ese proveedor]** → es lo correcto: el cupo de la clave de plataforma es
  común a todos. Los BYOK tienen su propio id (`byok:<userId>:<vendor>`) y su propia pausa.
- **[El id `openrouter` lo comparten el chat y los embeddings]** → un `429` del chat también pausa los embeddings de
  plataforma. El breaker ya compartía id antes de este change, y staging no tiene cadena de embeddings (D13 de 35b).
  Se anota en ADR-060 §Consecuencias.
- **[Desfase de reloj entre el proveedor y el host]** → se descarta todo instante pasado o a más de 48 h. Un desfase
  de minutos solo mueve la hora anunciada.
- **[«{cuándo}» con la hora del navegador]** → la persona ve su hora local. El `Retry-After` es relativo, así que no
  depende de la zona del servidor.
- **[Precedencia de la fila 35]** → nada se aplica sin la Q1.

## Migration Plan

Sin datos ni migraciones. Orden de los PR dentro del change: `libs/ai` (grupo 2), después la API (grupo 3) y después
el SPA (grupos 4 y 5). Todo cabe en un PR. Rollback: revertir el PR. Los códigos nuevos solo los produce este change,
y un SPA viejo frente a una API nueva los mostraría con el texto genérico de `lv-request-error`.

## Open Questions

- **Q1 [bloqueante] Excepción a la precedencia de la fila 35.** ¿Se abre este change, y se aplica y fusiona, antes de
  cerrar la fila 35?
  - (a) Sí, y antes de invitar en 35b. Los invitados son quienes chocan con esto (D13 de 35b lo anota como riesgo) y
    el change no toca nada de 35b ni de 35c.
  - (b) Sí, pero solo spec hasta archivar 35c.
  - (c) No: se reabre tras la fila 35.

  **Recomendación: (a).** Se registra con fecha en ADR-060 §1 y con una línea en ADR-048 §Consecuencias, como
  ADR-053 y ADR-055.
- **Q2 [no bloqueante] ¿«Completar a mano» también tras `not_a_job_posting`?** (a) Sí. (b) No, solo tras los
  errores de lectura. **Recomendación: (a)**: la IA puede equivocarse, y lo pegado sirve de referencia igual.
- **Q3 [no bloqueante] Umbral entre espera corta y cupo agotado.** (a) 5 min. (b) 1 min. (c) 15 min.
  **Recomendación: (a)**: cubre el límite por minuto de OpenRouter con margen, y es una constante fácil de mover.
- **Q4 [no bloqueante] Textos de D6.** Son una propuesta; el owner puede reescribirlos sin cambiar el diseño.
  **Recomendación:** aceptarlos y revisarlos en el móvil, como pide la línea de riesgo de D13 de 35b («se comprueba
  en el móvil que se entiende»).
- **Q5 [no bloqueante] Lo pegado como referencia en la corrección a mano.**
  - (a) Panel plegable de solo lectura.
  - (b) No mostrarlo.
  - (c) Mostrarlo desplegado.

  **Recomendación: (a)**: ayuda a copiar el salario o la modalidad sin ocupar la pantalla del móvil, y no se envía
  ni se guarda.
- **Q6 [no bloqueante] ¿Registrar en el ledger la clase del fallo para medir el cupo en staging?** (a) No en este
  change: el log `AI provider error` ya lleva `httpStatus`. (b) Sí: un campo nuevo en `ai_usage`, con su
  migración de `enum`. **Recomendación: (a)**: (b) toca el ledger, que este change deja intacto a propósito.
