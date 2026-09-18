## Context

`link-enrichment` dejó la cadena de lectura, el preview con procedencia por campo (`auto` | `manual`, con el valor
desplazado en `replaced`), la edición manual por `PATCH /api/links/:id/preview` con escritura condicionada a
`previewVersion`, el reintento por el outbox, el canal SSE y la tarea `extract-job`, que responde
`{ isJobPosting, preview | null }`. La IA solo corre en el worker: `apps/api` no importa `AiModule`. La higiene de
contactos y el filtro de valores vacíos del borrador viven en el dominio del worker. El limitador de plataforma está en
`apps/api/src/infrastructure/limits/`.

El smoke midió que de las cinco bolsas solo Get on Board se deja leer (REPORT.md §6 de `link-enrichment`). Y encontró un
link cuyo `displayUrl`, inmutable por ADR-021, llevaba `search_id`, que el `robots.txt` de Trabajopolis prohíbe, cuando
su historial `originalUrls` tenía la misma vacante sin él.

Motivación y alcance: proposal.md; comportamiento: las specs. Decisiones humanas previas de este change: el texto
pegado se lee **en la API, dentro de la petición**; la precedencia es **escrito a mano > pegado > leído de la página**;
y cuando `robots.txt` niega el `displayUrl` se **prueban las demás URLs del historial**.

## Goals / Non-Goals

**Goals:**
- Que una oferta de LinkedIn, Indeed, Computrabajo o Trabajopolis se pueda completar en un gesto, con lo que la persona
  ya tiene delante, y que la tarjeta bloqueada diga que esa es la salida.
- Que el texto de entrada no quede guardado en ningún sitio, y que lo que sí se guarda —los campos derivados— no lleve
  datos de contacto ni nombres de terceros.
- Que lo pegado no se pierda por una relectura, no pise lo escrito a mano, y que un pegado equivocado se pueda deshacer.
- Que ningún link se quede ilegible por el parámetro que tenía su primera URL.

**Non-Goals:**
- Crear un link a partir de un texto sin URL: no tendría clave de dedupe (ADR-008, ADR-021).
- Leer capturas de pantalla, PDFs o imágenes, o leer el portapapeles sin que la persona pegue.
- Sortear cualquier bloqueo de un sitio.
- Cambiar qué URL se abre al pulsar la tarjeta: sigue siendo `displayUrl`.
- Guardar una copia privada de la descripción para cuando la bolsa retire la oferta: es de `applications-tracking` o
  de `cv`, con su propio ADR.

## Decisions

### D1 — El texto se lee en la API, dentro de la petición

`POST /api/links/:id/pasted` recibe el texto, lo limpia, ejecuta la extracción y escribe el resultado, todo en la misma
petición. El texto de entrada solo existe en la memoria de ese proceso mientras dura. La alternativa natural —outbox,
cola, worker— se descartó porque dejaba el texto escrito en `outbox_events` y en los datos del job, retenido hasta una
semana si fallaba.

**Cómo monta `api` la IA**, en tres piezas:

- **Configuración**: `api` valida la de IA con el mismo `parseAiConfig` de `libs/ai` que usa el worker, al estilo de
  `loadWorkerConfigOrExit`, en vez de duplicar sus reglas en `api-config.schema.ts`.
- **Módulo**: `AppModule` construye `AiModule.forRootAsync` una vez y se lo pasa a `LinksModule.register(aiModule)`,
  que es quien necesita `RUN_TASK`; `AiModule` no es global, y así lo resuelve ya el worker. Los arranques de la suite
  de integración reciben su configuración de IA de test (`AI_CHAIN=mock`, `AI_MOCK_MODE=replay`).
- **Prompts**: el webpack de `api` copia `libs/ai/src/infrastructure/prompts` a sus assets, igual que el del worker:
  sin eso, una imagen de `api` que no arranque desde la raíz del repo falla al primer pegado.

`ctx.userId` es quien pega, `outputLanguage` fijo `es` (ADR-022 §6: el preview es compartido) y el plazo lo fija
`PASTE_EXTRACTION_TIMEOUT_MS` (20 s) en `ctx.signal`, que además **se aborta si el cliente cierra la conexión**: no se
gasta IA para un diálogo que ya nadie mira.

### D2 — Lo pegado se trata como dato personal, no como página pública

El texto pegado no es una página publicada: es lo que la persona copió, y puede traer el nombre del reclutador, trozos
del chat o mensajes de terceros. Por eso **no** se lee con `extract-job` (`public`) sino con **`extract-pasted-job`**,
una tarea registrada aparte con la misma salida, `dataSensitivity: 'personal'` (ADR-018 §11) y su propio prompt
`extract-pasted-job.v1.md`, derivado del de `extract-job` —tocar ese prompt obligaría a una `v2` y a regrabar los
fixtures y la línea base de las páginas, que no cambian—. No va a
un proveedor externo sin el consentimiento de quien pega, y si va, pasa por el `PiiRedactor`. Con la cadena de hoy
—mock o Ollama local— no cuesta nada; protege el día que se añada OpenRouter. Tiene su golden y su línea base propios,
que miden precisamente texto copiado de una app, y su clave determinista no se cruza con la de las páginas.

El prompt pide además no reproducir nombres de personas en `summary`, y el golden lo comprueba.

**La entrada** de la tarea es `{ text, knownTitle?, knownCompany? }`: el texto ya limpio más el título y la empresa que
la persona escribió aparte, como contexto, para que la IA no invente un título que el texto copiado del móvil no trae.
Forman parte de la clave determinista, como el resto de la entrada.

**El consentimiento** sale del perfil de quien pega. `links` no puede importar el dominio de `users` (ADR-020 §6), así
que el puerto de fachada que ya usa para los nombres gana `aiConsentOf(userId)`, resuelto por `UsersFacade`. Pasar un
`false` fijo cumpliría el escenario "sin consentimiento" por accidente y nunca leería el perfil.

Queda como **condición para añadir un proveedor externo**: si la cadena solo tiene proveedores externos y quien pega no
dio su consentimiento, hoy la respuesta sería `503` "inténtalo en un rato" para siempre. El día que se añada OpenRouter
hará falta un código propio (`ai_consent_required`) que lleve a dar ese permiso.

### D3 — Un tercer origen, una sola regla de precedencia

`previewSources[campo].source` admite `'auto' | 'pasted' | 'manual'`. `pasted` lleva `by`, `at` y
`extractor: 'ai:extract-pasted-job'`: la tarjeta dice "Descripción pegada por Beto" y el formulario puede recordar que lo
leyó la IA.

La precedencia es un orden total, `manual` > `pasted` > `auto`, y vive **una sola vez**, en `libs/shared`, como
función pura `mayOverwrite(previo, entrante)`. La usan el merge del worker y el pegado de `api`: si alguien cambia el
orden, cambia para los dos. Las reglas:

- Un merge **automático** no sustituye nada de rango superior.
- **Pegar** sustituye lo `auto` y lo `pasted` anterior (alguien pega una versión mejor) y **nunca toca un campo
  `manual`, ni su `replaced`**: "volver" en un campo escrito a mano devuelve a lo que había cuando se escribió.
- **Pegar solo escribe campos con valor.** Lo que la IA devuelve como `null`, `''`, `[]` o `'unknown'` no borra lo que
  la página ya había dado; si no, un pegado que no trae la empresa la dejaría en blanco para siempre, porque lo
  automático ya no puede pisar lo pegado. El filtro de valores vacíos del worker (`draftFrom`, `saysSomething`,
  `hasRequiredFields`) pasa a `libs/shared` y lo usan los dos.
- **Lo que sustituye una persona guarda lo desplazado.** Cuando se pega o se escribe a mano, `replaced` guarda la
  entrada desplazada completa —valor, origen, extractor, autor y fecha—, sin su propio `replaced`; una relectura
  automática que cambia un valor automático por otro no guarda nada, y la tarjeta no ofrece "volver" donde nadie
  actuó. Así un pegado equivocado se deshace ("Volver a lo anterior"),
  una corrección a mano sobre algo pegado vuelve a lo pegado, y la edición abierta a cualquiera que puede ver el link
  sigue siendo reversible, que es la condición con la que ADR-022 §9 la abrió. Un `replaced` antiguo sin `source` se
  lee como `auto`. Deshacer llega **un nivel** atrás: tres pegados seguidos pierden el primero, y se acepta.
- **Lo precargado no cambia de autor.** El título y la empresa escritos aparte solo cuentan como `manual` si difieren de
  lo que el link ya tenía: el SPA envía solo los que la persona cambió y la API ignora un valor igual al actual. Si no,
  cada pegado sobre un link con título lo atribuiría a quien pega, lo fijaría para siempre y dejaría el link en
  `manual`.
- **Vaciar es cosa de personas.** La regla de que un valor vacío no sustituye a uno lleno vale para los merges
  automáticos y para lo pegado; escribir a mano puede vaciar un campo, como hoy.

La tabla de casos de `@linkvault/testing` se amplía con los de `pasted`, pero lo que protege que las dos copias no
diverjan es que el orden sea una sola función compartida: la tabla modela `replaced`, y la regla de pegar solo la
aplica `api`. `applyManualField` del worker, que no tiene llamador en producción, pasa a ser un helper de test.

### D4 — La higiene pasa a `libs/shared`

`scrubContactDetails` es una función pura que ahora necesitan los dos procesos. Se mueve a `libs/shared`, importable
desde cualquier `domain/`. No cambia su comportamiento, aunque junte el texto en una línea: cambiarlo invalidaría los
fixtures de páginas. Por eso los inputs del golden de texto pegado se guardan **ya limpios**, que es exactamente lo que
recibe la tarea.

### D5 — Validación, límites y códigos

Orden real, porque el pipe valida antes que el caso de uso:

1. **400**: texto vacío o solo espacios (`validation_error`), más de 20 000 caracteres (`text_too_long`, el código que
   ya usa la importación).
2. **404** `link_not_found`: quien pide no puede ver el link.
3. **422** `not_a_job_posting`: el texto queda vacío tras la higiene (un pegado que solo tenía un teléfono), sin gastar
   límite ni IA.
4. **Límite de pegados**: 10 por usuario cada 15 min con el limitador de plataforma. Falla **cerrado**, pero con el
   contador caído responde **503** `extraction_unavailable`, no un 429 que diría "pegaste demasiadas" a quien no pegó
   ninguna. Superado, **429** `too_many_attempts` con `Retry-After`.
5. **IA**: `isJobPosting: false` → **422** `not_a_job_posting`; degradación o plazo agotado → **503**
   `extraction_unavailable` con `Retry-After`; cuota diaria de IA superada → **429** `ai_quota_exceeded` con
   `Retry-After` y un mensaje propio, porque "inténtalo en un rato" sería mentira cuando la ventana es de un día.

Un 503 **devuelve el intento** al contador —el puerto del limitador gana `refund`, que baja el contador sin pasar de
cero—: la persona no pierde uno de sus diez pegados porque el proveedor no respondió.

La cuota de IA se configura como cualquier otra en `AI_QUOTAS`, que pasa a conocer `extract-pasted-job`; vacía, que es
el valor por defecto, no limita. Como la política de cuotas solo responde sí o no, el `Retry-After` del `429
ai_quota_exceeded` es conservador y fijo: la ventana entera, 24 h, que es lo que dice el mensaje ("vuelve mañana"). La cuota de IA de `extract-pasted-job` es independiente de la de `extract-job`, porque son tareas distintas:
pegar no consume el presupuesto con el que se leen los links propios.

### D6 — Estado, escritura y aviso

- **Estado derivado de los campos cuando hay algo pegado**: `enriched` si están `title` y `company`, `partial` si no, y
  `manual` si además hay algún campo escrito a mano (la misma prioridad que ya usa el worker). El worker aplica la misma
  regla: una lectura fallida sobre un link con campos pegados **no** lo devuelve a `failed`.
- **Pegar no borra un motivo que no se puede reintentar.** Si el link estaba en `robots_disallowed` o `blocked`, el
  motivo se conserva: pegar no lo convierte en reintentable, y el botón de reintentar no reaparece.
- Escritura condicionada por `previewVersion`, que sube. Si pierde la carrera, se rehace **reutilizando la extracción
  ya hecha**, sin volver a llamar a la IA.
- Pegar sobre un link en `pending` hace que el enriquecimiento en vuelo pierda la carrera por versión y no escriba: los
  campos que habría traído de la página no llegan. Se acepta: lo pegado es de rango superior y la persona acaba de
  decir qué contiene la oferta.
- **El aviso SSE se publica en el canal de Redis** que ya existe, no se reparte solo en el proceso: llega a todas las
  instancias de `api`, incluida la propia. `PATCH` pasa a avisar igual, que hoy no lo hace. Como la suite de `api` no
  tiene Redis (ADR-021 §4), la publicación se prueba con un doble del puerto en el caso de uso, y el recorrido completo
  —dos pantallas, un pegado— en el e2e.

### D7 — Rescatar por el historial, con un disparador real

Dos piezas, y la segunda es la que hace que la primera sirva:

- **En la cadena**: si `robots.txt` niega el `displayUrl`, el worker prueba las demás URLs de `originalUrls` **del mismo
  host**, sin repetidas y sin la propia `displayUrl`, las más recientes primero, pidiendo permiso para cada una dentro
  del mismo turno de ese host. Una URL de otro host no se prueba: su turno y su `Crawl-delay` son otros. El worker
  necesita para eso `originalUrls` en su esquema y en su puerto.
- **El disparador**: un link nace con una sola URL en su historial, y `robots_disallowed` no se reintenta, así que sin
  más la cadena nueva no se ejecutaría nunca. Cuando alguien **vuelve a guardar la vacante con una URL nueva del mismo
  host** —las de otro host no se probarían, así que no piden nada— y el link
  está en `failed` por `robots_disallowed`, `saveOneLink` pide una lectura nueva en la misma transacción —sube la
  versión, pasa a `pending`, escribe en el outbox—, como hace el reintento. No se vuelve a pedir la URL prohibida: se
  prueba la nueva. Es exactamente el caso del smoke.

Sin interfaz propia y sin backfill: los links que ya estén así se rescatan pegando su descripción o volviendo a guardar
la URL limpia.

## Risks / Trade-offs

- **`api` gana la IA.** Es la dependencia más pesada que se le ha añadido, y una petición HTTP pasa a poder tardar lo que
  tarde un proveedor. Lo acotan el plazo de D1, el límite de D5 y que el endpoint lo usa una persona que acaba de pegar
  y está mirando.
- **Varias instancias de `api`** ejecutan IA cada una: las cuotas son por usuario sobre el ledger, así que siguen siendo
  globales; el breaker es por proceso (ADR-018 §7), como en el worker.
- **Lo copiado desde la app del móvil casi nunca trae la cabecera** —título y empresa—, y la salida exige título. Por
  eso el diálogo pide título y empresa aparte, precargados con lo que ya tiene la tarjeta: la persona los ve en la
  cabecera de la app y los escribe si faltan, y cuentan como escritos a mano.
- **Una persona puede pegar la oferta equivocada.** Se ve quién fue y se deshace con "Volver a lo anterior".
- **La descripción no se guarda**, así que cuando la bolsa retire la oferta se pierde el texto. Se acepta aquí.

## Migration Plan

Nada que migrar: `previewSources` admite un valor más en `source`, y un `replaced` sin `source` se lee como `auto`. Los
links que ya estén en `robots_disallowed` se rescatan pegando su descripción o volviendo a guardar una URL permitida.

## Open Questions

- Crear un link a partir de un texto sin URL exigirá una clave de dedupe que no sea una URL; fuera de este change.
