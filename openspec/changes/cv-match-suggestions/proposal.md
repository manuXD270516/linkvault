## Why

LinkVault ya sabe todo de la vacante (`link-enrichment`) y ya guarda y lee el CV (`cv-upload-extract`), pero nadie ha
puesto las dos mitades una al lado de la otra. Este change entrega la pregunta que justifica todo lo anterior: **¿encajo
en esta oferta, y qué me falta?**

Y entrega algo más incómodo. `cv-upload-extract` fue explícito: "Tu CV solo lo ves tú y **hoy no lo lee ninguna IA**. No
saldrá de LinkVault sin tu autorización." Este es el change en que esa frase deja de describir el producto, así que es
también el que tiene que **construir la autorización de la que habla**. Por decisión humana registrada en ADR-029 entran
dos proveedores —**Ollama** en local y **OpenRouter** limitado a modelos `:free` con `data_collection: "deny"`— y el
alcance original se parte: aquí van el análisis y **toda la privacidad**; el bucle de juez y la revisión humana de las
sugerencias van en `cv-suggestions-review`.

## What Changes

- **Análisis de encaje** (`POST /api/links/:linkId/match`, con el CV marcado por defecto): la tarea `match-cv` de
  `libs/ai` devuelve un `MatchReport` —`score`, `matchedSkills`, `missingSkills` y hasta 12 `suggestions`— y se guarda en
  `ai_analyses`. **Cada sugerencia SHALL llevar su `evidence`**: el requisito de la vacante que la motiva y el fragmento
  del CV al que se refiere. Una sugerencia sin de dónde sale es indistinguible de una invención, y este es el change en
  el que el producto empieza a opinar sobre la vida laboral de alguien.
- **Degradación honesta**, no silencio: si la cadena se agota o no hay consentimiento, `RuleBasedMatcher` cruza skills
  por diccionario y devuelve un `MatchReport` con `degraded: true` y **sin `suggestions`**. La pantalla lo dice —"Análisis
  básico"— en vez de disfrazarlo de análisis completo.
- **El consentimiento existe de verdad, en `/perfil`**: un interruptor con texto honesto —qué dato se envía, a quién, qué
  se redacta antes y que es revocable— que guarda **`consentedAt` y la versión del texto aceptado**. Sin consentimiento,
  ninguna tarea `personal` puede elegir un proveedor `external`: se queda en Ollama o degrada. Con él llegan el idioma de
  salida y la redacción del nombre propio.
- **El `PiiRedactor` aprende lo que le faltaba para un CV**: dirección postal y documento de identidad (CI con extensión
  departamental, DNI, cédula), que ADR-018 §13 difirió hasta "el primer change con CVs". Este lo es.
- **La redacción se mide, no se promete**: el eval harness suma dos métricas sobre un golden de CVs anonimizados —*skills
  ocultadas por la redacción* (sobre-redacción) y *PII anotada que no se redacta* (falso negativo)—, que son exactamente
  los dos errores que ADR-018 aceptó sin cuantificar.
- **`Application.fitScore` deja de estar reservado** y se rellena con el `score` del último análisis de esa oferta.
- **La espera se ve por dentro**, preguntando: el análisis devuelve el paso alcanzado, y la pantalla lo consulta mientras
  dura. El aviso en vivo por SSE **se difiere a `cv-suggestions-review`** (ADR-030): había tres mecanismos para contar
  una espera de unos cuarenta segundos, y el canal era además una superficie nueva por la que algo del CV podría
  escaparse.
- **La línea de privacidad de `/mi-cv` se completa**: ya puede nombrar dónde se autoriza y qué se redacta, porque por fin
  existen.

## Capabilities

### New Capabilities

- `cv/match`: el análisis de encaje entre un CV y una oferta — quién puede pedirlo, qué CV usa, el `MatchReport` con su
  evidencia obligatoria, la degradación honesta, qué se guarda en `ai_analyses`, la cuota por persona y tarea, y qué no
  sale nunca en la respuesta.
- `web/cv-match`: la pantalla del análisis — pedirlo desde una oferta, seguir sus pasos mientras dura, leer el informe, el
  badge de fit, y qué se ve cuando está degradado o cuando falta el consentimiento.

### Modified Capabilities

- `ai/data-protection`: detectores de dirección postal y documento de identidad; el consentimiento pasa a tener fecha y
  versión del texto aceptado, y se define qué ocurre con los análisis ya hechos cuando se revoca.
- `ai/eval-harness`: dos métricas nuevas de redacción sobre el golden de CVs, con su línea base.
- `users/profile`: `aiConsent` gana `consentedAt` y `textVersion`; activar y revocar quedan definidos.
- `applications/tracking`: "Puntuación de encaje reservada" pasa a ser una puntuación **derivada en lectura** del último
  análisis, sin que nadie la escriba ni tenga que limpiarla.
- `ai/task-execution`: la caché de resultados se acota a las tareas cuyo resultado puede cachearse; el de una tarea
  `personal` nunca lo es.
- `ai/deterministic-mock`: grabar fixtures de una tarea `personal` contra un upstream real pasa a rechazarse.
- `cv/documents`: cada CV del listado trae cuántos análisis de encaje se borrarían con él.
- `web/auth`: `/perfil` suma los tres controles de IA con su texto honesto.
- `web/cv`: la línea de privacidad de `/mi-cv` se completa, con sus tres estados, y la confirmación de borrado dice qué
  se lleva por delante.
- `web/applications`: la tarjeta de `/postulaciones` muestra el encaje con la misma regla que el resto.

## Impact

- **`libs/ai`**: tarea `match-cv` con su prompt versionado, su `sample` para el modo `synth` y su `degrade`; detectores
  nuevos en `PiiRedactor`; métricas nuevas en el eval harness. Ningún SDK de proveedor sale de
  `libs/ai/infrastructure/providers`.
- **`libs/shared`**: `MatchReport` y el contrato del análisis.
- **`apps/api`**: módulo `ai-analysis` (o ampliación del existente) con el endpoint, la cuota y `ai_analyses`; `users`
  gana los campos de consentimiento; `applications` consume el `fitScore`.
- **`apps/worker`**: el análisis corre fuera de la petición HTTP, disparado por outbox, y va dejando escrito el paso que
  alcanza para que la pantalla pueda preguntarlo.
- **`apps/web`**: la pantalla del análisis, el badge en las listas y los controles de `/perfil`.
- **Operación**: `deploy-prod` hereda la clave de OpenRouter, el aviso de privacidad actualizado y qué hacer con
  `ai_analyses` al borrar una cuenta.
- **Riesgo aceptado (ADR-029)**: los modelos `:free` de OpenRouter cambian de disponibilidad sin aviso; el breaker y la
  degradación cubren la caída, no una bajada silenciosa de calidad.
