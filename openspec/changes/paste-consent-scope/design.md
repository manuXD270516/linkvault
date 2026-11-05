## Context

La Q7 de `paste-fallback-honest`, respondida por el owner el 2026-10-29 con la (b), deja para este change que el
pegado de la descripción no pida el permiso de IA externa del Perfil, con `PiiRedactor` obligatorio sobre el texto
pegado y `data_collection: deny` en todo proveedor externo (ADR-060 §Consecuencias, fila `paste-consent-scope` de
`openspec-changes.yaml`). Este design parte de lo implementado en `change/paste-fallback-honest` (`c9ea027`).

Hoy la sensibilidad decide así el camino del pegado:

| Paso | Código | Qué hace con `extract-pasted-job` (`personal`) |
| --- | --- | --- |
| Tarea | `libs/ai/src/tasks/extract-pasted-job.task.ts` | `dataSensitivity: 'personal'`, `cacheable: false`. |
| Routing | `libs/ai/src/domain/routing-policy.ts` (`selectEligible`, `computeConsentWouldEnable`) | Sin el permiso, descarta todo proveedor `external`; con el permiso, admite todos, pidan o no que no se recolecten los datos. |
| Ejecución | `libs/ai/src/application/run-task.usecase.ts` (`attempt`, `recordPendingFixture`) | Redacta hacia externos; no anota la entrada en el registro de pendientes. |
| Registro | `libs/ai/src/application/task-registry.ts` | Impide declararla cacheable. |
| Fixtures | `libs/ai/src/evals/recording/record-fixtures.ts`, `audit-personal-fixtures.ts` | Solo se graba contra el mock; la auditoría la recorre. |
| Adaptador | `apps/api/src/modules/links/infrastructure/run-task-pasted-extraction.ts` | Lee el permiso del perfil y lo pasa en el contexto. |
| Proveedores | `infrastructure/providers/openrouter.provider.ts`, `byok-provider.factory.ts` | Solo OpenRouter con `dataCollection: 'deny'` (plataforma y BYOK `:free`) pide no recolectar. `ProviderCapabilities` no lo expone. |

Con `AI_CHAIN=openrouter` y el permiso apagado por defecto, quien pega recibe `409 ai_consent_required` (ADR-060 §5).

## Goals / Non-Goals

**Goals:**

- Que el pegado lea con IA externa sin el permiso de Perfil, solo con proveedores que piden no recolectar los datos y
  siempre con el texto redactado.
- Conservar todas las demás protecciones de `personal` para lo pegado: sin caché, sin la entrada en disco, fixtures
  solo contra el mock.
- Que la regla sirva para la próxima tarea que lea texto de terceros, sin excepciones por nombre de tarea.
- Que quien pega sepa, antes de enviar, que puede leerlo un proveedor externo.

**Non-Goals:**

- Cambiar el texto del permiso de Perfil o crear un permiso aparte (Q7 (a) y (c), descartadas por el owner). La Q4
  pregunta solo si conviene una nota fuera del texto versionado.
- Cambiar prompts, modelos, fixtures o el golden (D8).
- Quitar el código `409 ai_consent_required` o sus textos (D6).
- Tocar `embedTexts`, que es siempre `personal` y no usa `DataSensitivity`.
- Tocar despliegue, workflows o `platform/*`.

## Decisions

### D1. Precedencia de la fila 35: la decide el owner (Q1)

Mientras la fila 35 no termine, ningún change de otra fila la precede (ADR-048 §Consecuencias, ADR-051 §1). Este
change es **solo spec** hasta que el owner responda la Q1. Las dos salidas (esperar o pedir excepción propia) están
en la Q1 con su costo. Con una excepción, las reglas de fusión son las de D10.

### D2. `incidental`, un tercer valor de sensibilidad, y no `public`

`DataSensitivity = 'personal' | 'incidental' | 'public'`, con `personal` por defecto (ADR-018 §11 enmendado por
ADR-063 §2). `incidental` significa: el contenido no es de quien ejecuta, pero puede traer datos personales de otros
que nadie eligió enviar. Se comporta como `personal` en todo salvo dos cosas:

1. **No exige el consentimiento** de quien ejecuta para proveedores externos.
2. **Solo admite externos que piden no recolectar los datos** (D4, D5), con o sin consentimiento.

Conserva la redacción con `PiiRedactor` hacia externos, la prohibición de cachear, el registro de pendientes sin la
entrada y las reglas de fixtures (grabar solo contra el mock, auditoría con el redactor).

*Alternativas descartadas:*
- `public`: apaga la redacción, la caché prohibida, el registro sin entrada y las reglas de fixtures.
- Dos banderas independientes (`requiresConsent`, `redactForExternal`): admiten combinaciones sin sentido y obligan a
  tocar todas las tareas.
- Excepción por nombre de tarea en la política: la regla queda escondida y no la hereda la próxima tarea.

### D3. Las reglas viven en predicados de `domain/task.ts`, con un test de guardia

`domain/task.ts` exporta tres predicados puros sobre `dataSensitivityOf(task)`:

| Predicado | `personal` | `incidental` | `public` | Lo usan |
| --- | --- | --- | --- | --- |
| `requiresExternalConsent(task)` | `true` | `false` | `false` | `routing-policy.ts` (`selectEligible`, `computeConsentWouldEnable`) |
| `treatsInputAsPersonal(task)` | `true` | `true` | `false` | `run-task.usecase.ts` (`attempt`, `recordPendingFixture`), `task-registry.ts`, `record-fixtures.ts`, `audit-personal-fixtures.ts` |
| `requiresNoDataCollection(task)` | `false` | `true` | `false` | `routing-policy.ts` (`selectEligible`) |

Ningún fichero de `libs/ai/src` fuera de `domain/task.ts` (y de los `*.spec.ts`) compara la sensibilidad
directamente. Lo comprueba `domain/task-sensitivity.guard.spec.ts`: recorre los `.ts` de `libs/ai/src` que no son
specs y falla nombrando el fichero si encuentra `dataSensitivity` o `dataSensitivityOf(...)` seguido de `===` o `!==`,
o un `=== 'personal'` / `=== 'incidental'`. Hoy hay comparaciones sueltas en `routing-policy.ts` (`:75`, `:111`),
`run-task.usecase.ts` (`:479`, `:679`), `task-registry.ts` (`:53`), `record-fixtures.ts` (`:83`, `:136`) y
`audit-personal-fixtures.ts` (`:41`). Las tres de `evals/recording/` leen el campo crudo (`task.dataSensitivity ===
'personal'`), que con una tarea sin sensibilidad declarada (por defecto `personal`) da `false`: el paso a predicados
también corrige eso.

*Alternativa descartada:* una regla de ESLint `no-restricted-syntax`. Sirve igual, pero su selector es más frágil
frente a las dos formas (campo crudo y función) y su mensaje no nombra el predicado que hay que usar.

### D4. Los proveedores declaran `dataCollectionDenied`

`ProviderCapabilities` gana `dataCollectionDenied?: boolean`, con el mismo estatus que `external` y los costes: es
un dato de política, y `satisfies()` lo ignora. **Ausente vale `false`**, de modo que un proveedor nuevo que no lo
declare queda fuera de las tareas `incidental` (falla segura) y los dobles de test existentes compilan sin cambios.

- `OpenRouterProvider` declara `dataCollectionDenied: this.dataCollection === 'deny'`. Eso cubre el de plataforma
  (siempre `deny`) y el BYOK con modelo `:free` (`byok-provider.factory.ts:129`). El BYOK de pago (`omit`) declara
  `false`.
- `OpenAIProvider` y `AnthropicProvider` no lo declaran: no tienen una petición equivalente.
- Los proveedores locales (`mock`, `ollama`) no lo declaran. La bandera solo se consulta para `external: true`.
- `openrouter-embedding.provider.ts` no cambia: los embeddings no usan este puerto.

*Alternativa descartada:* deducirlo en la política por el id (`openrouter`, `byok:*:openrouter`). El id no dice si el
modelo es `:free`, y repetiría en la política una regla que ya vive en el proveedor.

### D5. El filtro de routing de las tareas `incidental`

En `selectEligible`, un proveedor se descarta por política si es `external` y además:

- la tarea exige consentimiento (`requiresExternalConsent`) y el contexto no lo trae, **como hoy**; o
- la tarea exige no recolectar (`requiresNoDataCollection`) y el proveedor no declara `dataCollectionDenied`, **con
  o sin consentimiento**.

Consecuencias:

- `consentWouldEnable` es `false` para toda tarea `incidental`, porque conceder el permiso no cambia su cadena. La
  regla vigente ya lo dice («solo si la tarea es `personal`»); el spec gana el escenario.
- La cadena hipotética de `paste-fallback-honest` (D4 de ese change; con el consentimiento supuesto) aplica el mismo
  filtro de no recolección, así que un externo que no lo pide **no** es un afectado de esa cadena y nunca produce
  `consent_missing`. Con una cadena hecha solo de externos que no lo piden, la ejecución degrada con `no_providers`
  **sin** `providerCondition`, y el pegado responde `503 extraction_disabled` (D5 de ese change): «La lectura
  automática no está disponible. Puedes completarla a mano». Es verdad, porque esperar no lo cambia.
- El orden de la cadena (ADR-018 §8) no cambia.

### D6. `extract-pasted-job` pasa a `incidental`; el adaptador no cambia de comportamiento

- La tarea declara `dataSensitivity: 'incidental'` y sigue con `cacheable: false`, `promptVersion: 'v1'` y la misma
  entrada. Su comentario de cabecera cambia para citar ADR-063.
- **El adaptador sigue leyendo el consentimiento del perfil y pasándolo** en `ctx.aiConsent`. `RunContext` lo exige,
  y ADR-023 descartó pasar un `false` fijo. Ese valor ya no cambia la cadena de esta tarea. Si la lectura del perfil
  falla, el pegado sigue respondiendo `503 extraction_unavailable`, como hoy: no se cambia el modo de fallo de la
  petición en un change de privacidad. Si la Q2 se respondiera con la (b), el adaptador ya tendría el dato.
- **`409 ai_consent_required` se conserva**, con su fila en el adaptador, su error de dominio y su texto en el SPA.
  Para esta tarea ya no hay camino que lo produzca (D5), pero quitarlo exigiría modificar requirements que
  `paste-fallback-honest` todavía no archivó, y el código protege a la próxima tarea del pegado que fuera `personal`.
  Sus tests con `runTask` doble siguen valiendo.
- Los tests del adaptador que simulan la regla vieja (`run-task-pasted-extraction.spec.ts`, bloque «consent of whoever
  pastes») se reescriben: ya no afirman qué proveedor se elige según el permiso, sino que el adaptador ejecuta la
  tarea `incidental` y sigue pasando el permiso del perfil. La regla de routing real se prueba con el `runTask` de
  verdad y proveedores falsos en `libs/ai/src/tasks/extract-pasted-job.task.spec.ts` (tarea 1.8): un doble de
  `runTask` en `apps/api` solo repetiría la regla que dice probar. La suite del controlador
  (`links.controller.pasted.spec.ts`, IA de la suite en `replay`) comprueba la respuesta HTTP (tarea 2.2).

### D7. El diálogo avisa, antes de enviar, adónde puede ir lo pegado

Debajo de la explicación vigente («Pega el texto de la oferta tal como la ves: lo leemos para completar la tarjeta y
no lo guardamos», que no cambia), un párrafo nuevo con `@@links.paste.externalNotice`:

- ES: «Puede leerla un proveedor de IA externo. Antes le quitamos los datos de contacto que detectamos y le pedimos que
  no la guarde, pero no podemos comprobarlo. No pegues datos personales que no sean parte de la oferta».
- EN: «An external AI provider may read it. We first remove the contact details we detect and ask it not to keep
  it, but we can't verify that. Don't paste personal details that aren't part of the job posting».

Reglas:

- El aviso **no enumera** tipos de dato («datos de contacto que detectamos» no es una lista), así que no entra en el
  inventario de enumeraciones de `ai/data-protection`, y **no promete anonimato**. Entra en la comprobación de
  promesas prohibidas (`apps/web/src/locale/privacy-text.ts`, `PRIVACY_UNIT_IDS`, bloque «forbidden promises»), con un
  caso que falla si el texto, en cualquiera de los dos idiomas, menciona anonimato o nombra uno de los tipos de
  `REDACTED_DATA_TYPES`.
- Es texto estático: dice «puede», que es verdad con cualquier cadena (con mock u Ollama no sale de la máquina).
- No añade ninguna acción ni casilla: no es un permiso.
- Es un requirement **nuevo** de `web/links` y no un MODIFIED de «Pegar la descripción de una oferta», porque ese
  requirement lo modifica `paste-fallback-honest`, que todavía no está archivado (D9).
- i18n según ADR-050: `messages.xlf` se re-extrae con `pnpm nx run web:extract-i18n` y `messages.en.xlf` recibe la
  traducción.

### D8. Sin cambios de prompts, fixtures ni golden: comprobación de no regresión

- El prompt `extract-pasted-job.v1.md` no cambia: ya dice que el texto llega sin emails ni teléfonos y que no se
  reproducen nombres. La clave determinista (ADR-018 §3) no incluye la sensibilidad, y el mock no es externo, así que
  no redacta: los fixtures y las métricas no pueden moverse.
- La auditoría y la grabación de fixtures pasan a `treatsInputAsPersonal`, que para esta tarea da lo mismo que antes.
- Por eso **no hace falta `--update-baseline`**. La tarea 1.9 corre `pnpm nx run ai:eval-ci` sin esa bandera, con
  salida 0 y `git status --porcelain` limpio. Si durante la aplicación hubiera que tocar el prompt o un fixture, la
  regla de `CLAUDE.md` exige `pnpm nx run ai:eval --provider=mock --update-baseline` en el mismo commit, y eso
  cambiaría el alcance: se para y se vuelve al debate.

### D9. Depende de `paste-fallback-honest`, y lo sigue

- **Código.** Usa `providerCondition` (ADR-060 §4), el `503 extraction_disabled` y el `409 ai_consent_required` del
  pegado (ADR-060 §5), y toca los mismos ficheros del adaptador y del diálogo. La rama de aplicación se corta de
  `main` **después** de que `paste-fallback-honest` esté fusionado (tarea 0.3).
- **Specs.** Ningún delta de este change toca un requirement que `paste-fallback-honest` modifica o añade: este
  modifica «Sensibilidad de datos por tarea», «Filtrado por capacidades, consentimiento y circuitos abiertos» y «El
  texto pegado es un dato personal», y añade «Declaración de no recolección de datos» y «Aviso de adónde va lo
  pegado». Aun así, los escenarios citan códigos que solo existen con `paste-fallback-honest`, así que **se archiva
  después** que él.
- **`web-error-copy-coverage`.** Este change no añade códigos de error, así que no toca `API_ERROR_COPY`.

### D10. Ventana de fusión, según la Q1

- **Con la Q1 = (a)** (esperar): se aplica después de archivar 35c (`verify-reusable-workflow`) y se fusiona como
  cualquier change, sin ventana propia.
- **Con la Q1 = (b)** (excepción propia): las tres clases de fusión de ADR-060 §1, con sus mismas reglas:
  1. **La fusión del change**, solo después de la 11.6 de 35b y antes de su 10.7, **y después de la fusión de
     `paste-fallback-honest`**; nunca con una corrida `e2e-remote` en curso; con la confirmación escrita del owner,
     fechada el día de la fusión, en la forma «11.6 hecha el AAAA-MM-DD; PR-2 de 35b = #NNN; 10.7 no hecha; sin
     `e2e-remote` hoy; `paste-fallback-honest` fusionado en #NNN». Después de fusionar y antes de la 10.7, la 9.4 de
     `e2e-suite` se repite sobre el commit desplegado con este change. Si la 6.4 de `paste-fallback-honest` se hace
     sobre un commit desplegado que ya contiene este change, esa repetición sirve para los dos, y se anota en los dos
     PR de archivo.
  2. **El PR de archivo**, después de la 10.7, y después del PR de archivo de `paste-fallback-honest` (D9).
  3. **Las vueltas atrás**, si las hay, y su vuelta.

  Las clases 2 y 3: nunca entre el PR-2 de 35b y su 11.6, nunca durante su 9.1-9.4, nunca los días 7 y 14 de la
  medición y nunca el día de una corrida `e2e-remote`. **Si el change no llega a fusionarse antes de la 10.7, no se
  fusiona durante la medición**: queda para después de archivar 35c, como en la (a).
- **Con la Q1 = (c)** (fusionar durante la medición), las reglas de la clase 2 valen también para la fusión del
  change, y la medición de 35b anota el día del cambio.

## Risks / Trade-offs

- **[Datos de terceros hacia un externo sin preguntar a nadie]** → lo pegado puede traer nombres de terceros, que el
  redactor no quita. Se acota con la petición de no recolectar, con el prompt que no reproduce nombres en el resumen y
  con el aviso de D7. La petición de no recolectar no puede comprobarse. Riesgo aceptado por el owner con la (b) de la
  Q7, registrado en ADR-063 §Riesgos aceptados.
- **[Datos propios pegados por descuido]** → antes, quien no había dado el permiso estaba cubierto por la falta de
  permiso; ahora lo cubre solo el aviso. Se acepta: el permiso tampoco hablaba del pegado.
- **[Una comparación suelta de la sensibilidad sobrevive al cambio]** → la tarea `incidental` caería en la rama de
  `public` en ese punto (por ejemplo, cacheable o con la entrada en disco). Lo impide el test de guardia de D3, con su
  falsación.
- **[Un proveedor externo nuevo que no declara la bandera]** → queda fuera del pegado y el pegado responde `503
  extraction_disabled`. Es visible y seguro; el riesgo contrario (que la declarara sin pedir no recolectar) lo cubre la
  revisión del proveedor, porque la bandera se declara en un solo sitio.
- **[BYOK con el permiso dado pierde su proveedor en el pegado]** → quien tiene BYOK de OpenAI, Anthropic u OpenRouter
  de pago pega con la IA de la plataforma, con una local o termina en `503 extraction_disabled`. El resto de sus tareas
  no cambia. Lo decide la Q2.
- **[Fusión en una ventana compartida]** → con la Q1 = (b), este PR se suma a los de `paste-fallback-honest` y a los
  de robustez entre la 11.6 y la 10.7. Si no cabe, espera a 35c (D10); nunca entra con prisa a mitad de la medición.
- **[Conflictos con `paste-fallback-honest`]** → la rama se corta después de su fusión (tarea 0.3), y sus specs no se
  pisan (D9).

## Migration Plan

Sin datos ni migraciones. Orden dentro del change: `libs/ai` (grupo 1), la API (grupo 2), el SPA (grupo 3) y la
documentación (grupo 4). Todo cabe en un PR. Rollback: revertir el PR (D10, clase 3), que devuelve la tarea a
`personal` y el pegado a la opción (d) de la Q7: sin permiso, «Completar a mano».

## Open Questions

- **Q1 [bloqueante] Precedencia de la fila 35.** ¿Se aplica y fusiona este change antes de cerrar la fila 35?
  - (a) **Esperar a la fila 35**: se aplica después de archivar 35c. *Costo:* durante toda la medición de 35b, el
    invitado que no fue a Perfil a dar un permiso que habla del CV (el permiso nace apagado) no lee con IA lo que pega,
    y el pegado es el camino principal; la medición del pegado mide «Completar a mano» y no la lectura. *A favor:*
    ningún PR más en la ventana de 35b y ningún riesgo para su secuencia.
  - (b) **Excepción propia**, como la de ADR-060 §1: se aplica en paralelo y se fusiona solo entre la 11.6 y la 10.7
    de 35b, después de `paste-fallback-honest`, con las tres clases de fusión de D10 y la 9.4 repetida. Si no llega a
    tiempo, espera a 35c. *Costo:* un PR más en una ventana que ya comparten `paste-fallback-honest` y los changes de
    robustez; una confirmación fechada más del owner; posiblemente una repetición más de la 9.4; y un change de
    privacidad que no puede deslizarse a la medición. *A favor:* los invitados leen con IA desde su primer pegado, y la
    medición mide el producto que se quiere medir.
  - (c) Excepción con la fusión después de la 10.7, fuera de los días 7 y 14. *Costo:* cambia el comportamiento a
    mitad de la medición, y las semanas antes y después dejan de ser comparables.

  **Recomendación: (b)**, con la caída a (a) si no entra antes de la 10.7. Es la misma lógica por la que se concedió la
  excepción de `paste-fallback-honest`: lo ven justo los 3 a 5 invitados, y sin este change su primer pegado con IA
  externa termina en un permiso que no describe lo que pasa. Se anota con fecha en ADR-063 §1 y, con (b) o (c), con
  una línea en ADR-048 §Consecuencias.

- **Q2 [no bloqueante] ¿Con el permiso de Perfil dado, el pegado puede ir también a externos que no piden no
  recolectar?** (BYOK de OpenAI, Anthropic u OpenRouter de pago.)
  - (a) No, nunca: es el alcance literal del owner («`data_collection: deny` en todo proveedor externo»).
  - (b) Sí: con el permiso, la cadena del pegado es la de hoy.

  **Recomendación: (a)**. La (b) usaría el permiso del CV para autorizar el pegado, que es la confusión que la Q7
  quiso quitar. Si el owner no responde, rige la (a), porque es su alcance literal; con la (b), D5 y el spec de
  `ai/provider-routing` cambian antes de aplicar.

- **Q3 [no bloqueante] Texto del aviso de D7.** **Recomendación:** aceptarlo y revisarlo en el móvil con la línea de
  riesgo de D13 de 35b. El owner puede reescribirlo sin cambiar el diseño, siempre que no enumere tipos de dato ni
  prometa anonimato.

- **Q4 [no bloqueante] ¿Perfil dice que el pegado no usa el permiso?**
  - (a) No se toca Perfil: su texto habla del CV y sigue siendo verdad.
  - (b) Una línea fuera del texto versionado, junto al permiso: «Pegar la descripción de una oferta no usa este
    permiso».

  **Recomendación: (a)**. El texto del permiso es versionado y comprobado (`ai/data-protection`), y una línea a su lado
  invita a leerla como parte de él. El aviso de D7 ya está donde se pega.

## Casos de prueba derivados de los escenarios

Los nombres entre comillas son los títulos que el implementador da a los tests (ver `tasks.md`).

| Escenario (spec) | Test | Fichero |
| --- | --- | --- |
| Tarea incidental sin consentimiento (`ai/data-protection`) | «incidental task reaches a no-data-collection external provider without consent, redacted» | `libs/ai/src/application/run-task.usecase.spec.ts` |
| Tarea incidental declarada cacheable | «Tarea incidental declarada cacheable» | `libs/ai/src/application/task-registry.spec.ts` |
| Entrada incidental sin fixture | «an incidental task without fixture is logged without its input» | `libs/ai/src/application/run-task.usecase.spec.ts` |
| Grabar fixtures de una tarea incidental | «an incidental task cannot be recorded against a real upstream» | `libs/ai/src/evals/recording/record-fixtures.spec.ts` |
| Auditoría de fixtures de una tarea incidental | «the audit also checks incidental tasks» | `libs/ai/src/evals/recording/audit-personal-fixtures.spec.ts` |
| Sensibilidad por defecto y predicados | «personal, incidental and public map to their rules» | `libs/ai/src/domain/task.spec.ts` |
| Sin comparaciones sueltas (D3) | «no file outside domain/task.ts compares data sensitivity» | `libs/ai/src/domain/task-sensitivity.guard.spec.ts` |
| Tarea incidental sin consentimiento (`ai/provider-routing`) | «Tarea incidental sin consentimiento» | `libs/ai/src/domain/routing-policy.spec.ts` |
| Ni con consentimiento entra un externo que no pide no recolectar | «Tarea incidental: el externo que no pide no recolectar queda fuera aun con permiso» | `libs/ai/src/domain/routing-policy.spec.ts` |
| El permiso nunca habilita una tarea incidental | «consentWouldEnable is false for an incidental task» | `libs/ai/src/domain/routing-policy.spec.ts` |
| Proveedor sin declaración | «a provider that does not declare dataCollectionDenied is treated as not denying» | `libs/ai/src/domain/routing-policy.spec.ts` |
| OpenRouter de plataforma / BYOK `:free` / BYOK de pago / OpenAI y Anthropic | «deny declares dataCollectionDenied», «omit does not declare dataCollectionDenied», «BYOK vendors declare dataCollectionDenied only for OpenRouter :free» | `openrouter.provider.spec.ts`, `byok-provider.factory.spec.ts` |
| Solo externos que no piden no recolectar → `no_providers` sin condición | «incidental task with only non-denying external providers degrades no_providers without condition» | `libs/ai/src/application/run-task.usecase.spec.ts` |
| Pegado sin permiso con un externo que pide no recolectar (`links/pasted-description`) | «Sin consentimiento, el externo que pide no recolectar lee lo pegado» | `libs/ai/src/tasks/extract-pasted-job.task.spec.ts` |
| Ni con permiso a un externo que no lo pide | «Ni con consentimiento va a un externo que no pide no recolectar» | `libs/ai/src/tasks/extract-pasted-job.task.spec.ts` |
| Solo hay externos que no lo piden | «Solo externos que no piden no recolectar: no_providers sin condición» (`libs/ai`) y «no_providers without condition answers 503 extraction_disabled» (ya de `paste-fallback-honest`, se comprueba que sigue) | `libs/ai/src/tasks/extract-pasted-job.task.spec.ts`, `apps/api/src/modules/links/infrastructure/run-task-pasted-extraction.spec.ts` |
| Sin permiso nunca 409 | «Sin consentimiento, el pegado nunca degrada por falta de permiso» (`libs/ai`, con una cadena solo de un externo que pide no recolectar y otra solo de uno que no lo pide) y «a paste without consent reads with the suite AI» (HTTP `200`) | `libs/ai/src/tasks/extract-pasted-job.task.spec.ts`, `apps/api/src/modules/links/presentation/links.controller.pasted.spec.ts` |
| Aviso visible antes de enviar (`web/links`) | «shows where the pasted text may go before sending» | `apps/web/src/app/features/links/paste-description.dialog.spec.ts` |
| El aviso no promete anonimato ni enumera | «El aviso del pegado no promete anonimato ni enumera lo que se sustituye» | `apps/web/src/locale/privacy-text.spec.ts` |
| Aviso en inglés | «the paste notice is translated» (cubierto por `web:i18n-check`) | `messages.en.xlf` |
