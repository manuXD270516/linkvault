## Why

El owner decidió el 2026-10-29 (Q7 = (b) de `paste-fallback-honest`, ADR-060 §Consecuencias) que el pegado de la
descripción **deje de pedir el permiso de IA externa del Perfil**, que habla solo del CV, reclasificando la tarea
`extract-pasted-job` como no `personal`, **con `PiiRedactor` obligatorio sobre el texto pegado y `data_collection:
deny` en todo proveedor externo**, en un change propio con ADR. El owner pidió el 2026-11-04 adelantar esta
especificación en paralelo; no se aplica nada antes de resolver la Q1 (precedencia de la fila 35).

Lo que hay hoy, leído en `change/paste-fallback-honest` (`c9ea027`):

- `extract-pasted-job` declara `dataSensitivity: 'personal'` (`libs/ai/src/tasks/extract-pasted-job.task.ts`). Con
  `AI_CHAIN=openrouter` (staging, design D13 de `staging-host`), la política de routing descarta el único proveedor
  porque es externo y quien pega no dio el permiso (`libs/ai/src/domain/routing-policy.ts`, `selectEligible`). El
  permiso nace apagado, así que **todo invitado de 35b que pegue sin haber ido a Perfil** recibe `409
  ai_consent_required` y termina en «Completar a mano» (ADR-060 §5).
- Reclasificar a `public` no sirve: `personal` decide cinco cosas a la vez (consentimiento, redacción hacia externos,
  prohibición de cachear, registro de pendientes sin la entrada y grabación de fixtures solo contra el mock), y
  `public` apagaría las cinco (ADR-063, Contexto).
- `data_collection: deny` solo lo pide `OpenRouterProvider` con `dataCollection: 'deny'` (plataforma y BYOK `:free`).
  El BYOK de OpenRouter de pago (`omit`), el de OpenAI y el de Anthropic no lo piden, y hoy la política no puede
  distinguirlos: `ProviderCapabilities` solo dice `external`.

## What Changes

- **`libs/ai`: tercera sensibilidad, `incidental`** (ADR-063 §2, enmienda ADR-018 §11). Contenido que no es de quien
  ejecuta pero puede traer datos personales de otros: **sin** consentimiento, **con** redacción hacia externos, sin
  caché, sin la entrada en el registro de pendientes y con las mismas reglas de fixtures que `personal`. Las reglas
  pasan a predicados de `domain/task.ts`, con un test de guardia que impide comparar la sensibilidad en otro sitio.
- **`libs/ai`: los proveedores declaran si piden no recolectar los datos** (`dataCollectionDenied`, opcional, falso
  por defecto; ADR-063 §3, enmienda ADR-014). Solo OpenRouter con `deny` lo declara.
- **Routing:** una tarea `incidental` admite como externos **solo** a los que lo declaran, con o sin consentimiento, y
  `consentWouldEnable` es siempre `false` para ella.
- **`extract-pasted-job` pasa a `incidental`** (enmienda ADR-023 §2). El adaptador del pegado sigue pasando el
  consentimiento, que ya no decide su cadena. `409 ai_consent_required` queda como defensa sin camino.
- **Diálogo de pegado:** un aviso, antes de enviar, de que puede leerlo un proveedor de IA externo, sin enumerar lo
  que se sustituye ni prometer anonimato, comprobado con las promesas prohibidas de `privacy-text`; i18n ES/EN según
  ADR-050.
- **Documentación:** README («Pegar la descripción») y RUNBOOK (Paso 6 ter) dejan de decir que el pegado pide el
  consentimiento.
- **Sin cambios de prompts, modelos, fixtures ni golden:** el eval se corre como comprobación de no regresión, **sin**
  `--update-baseline` (design D8).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `ai/data-protection`: «Sensibilidad de datos por tarea» (tres valores y sus reglas).
- `ai/provider-routing`: «Filtrado por capacidades, consentimiento y circuitos abiertos» (filtro de las tareas
  `incidental`) y nuevo requirement «Declaración de no recolección de datos».
- `links/pasted-description`: «El texto pegado es un dato personal» (sin consentimiento; solo externos que piden no
  recolectar).
- `web/links`: nuevo requirement «Aviso de adónde va lo pegado».

## Impact

- `libs/ai`: `domain/task.ts`, `domain/routing-policy.ts`, `domain/ports/llm-provider.port.ts`,
  `application/run-task.usecase.ts`, `application/task-registry.ts`, `evals/recording/{record-fixtures,audit-personal-fixtures}.ts`,
  `infrastructure/providers/openrouter.provider.ts`, `tasks/extract-pasted-job.task.ts` y sus specs. Un test de
  guardia nuevo en `domain/`.
- `apps/api`: `links/infrastructure/run-task-pasted-extraction.ts` (solo comentario) y sus specs, que hoy simulan la
  regla vieja.
- `apps/web`: `paste-description.dialog.html` (un párrafo), su spec, `locale/privacy-text.ts` y su spec, y los
  catálogos `messages.xlf` / `messages.en.xlf`.
- Sin migraciones, sin cambios en el ledger, en la caché, en `libs/shared`, en prompts, en fixtures ni en el golden.
  `embedTexts` no cambia: su sensibilidad es siempre `personal` y no usa `DataSensitivity`.
- **Depende de `paste-fallback-honest`:** usa su `providerCondition` y sus códigos (`503 extraction_disabled`), toca
  los mismos ficheros del pegado y se fusiona después (design D9).
- Documentación: ADR-063 (nuevo, «Propuesto»), una línea en ADR-014, ADR-018 y ADR-023 §Enmiendas, y otra en ADR-060
  §Consecuencias. Con la Q1 respondida, una línea en ADR-048 §Consecuencias si hay excepción.
