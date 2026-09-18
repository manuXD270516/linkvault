## Context

`link-enrichment` dejó la cadena de lectura, el preview con procedencia por campo (`auto` | `manual`, con el valor
desplazado en `replaced`), la edición manual por `PATCH /api/links/:id/preview` con escritura condicionada a
`previewVersion`, el reintento por el outbox, el canal SSE y la tarea `extract-job`, que responde
`{ isJobPosting, preview | null }`. La IA solo corre en el worker: `apps/api` no importa `AiModule`. La higiene de
contactos (`scrubContactDetails`) vive en el dominio del worker. El limitador de plataforma está en
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
  ya tiene delante.
- Que el texto de un tercero no quede guardado en ningún sitio.
- Que lo pegado no se pierda por una relectura ni pise lo que alguien escribió a mano.
- Que ningún link se quede ilegible por el parámetro que tenía su primera URL.

**Non-Goals:**
- Crear un link a partir de un texto sin URL: no tendría clave de dedupe (ADR-008, ADR-021).
- Leer capturas de pantalla, PDFs o imágenes.
- Sortear cualquier bloqueo de un sitio.
- Cambiar qué URL se abre al pulsar la tarjeta: sigue siendo `displayUrl`.

## Decisions

### D1 — El texto se lee en la API, dentro de la petición

`POST /api/links/:id/pasted` recibe el texto, lo pasa por la higiene de contactos, ejecuta `runTask('extract-job')` y
escribe el resultado, todo en la misma petición. El texto solo existe en la memoria de ese proceso mientras dura.

La alternativa natural —el camino del enriquecimiento: outbox, cola, worker— se descartó porque deja el texto escrito
en `outbox_events` y en los datos del job, retenido hasta una semana si falla; "no se guarda" pasaría a ser "se guarda un
rato y se borra". Un canal directo api→worker sin persistencia evitaría las dos cosas, pero a costa de un mecanismo de
petición-respuesta entre procesos que hoy no existe.

**`api` monta `AiModule`** igual que el worker (`AiModule.forRootAsync` con la conexión Mongoose por defecto para el
ledger y `REDIS_URL` para la caché): mismo ledger, mismas cuotas por usuario y tarea (ADR-018 §9), misma cadena de
proveedores y el mismo `AI_CHAIN`. La tarea sigue siendo `public`: el texto es de una oferta publicada, no un dato de la
persona que lo pega. `ctx.userId` es quien pega, que es a quien se atribuye la ejecución y contra quien cuenta su cuota.
`outputLanguage` sigue fijo en `es`, por la misma razón que en ADR-022: el preview es compartido.

El plazo de la ejecución lo fija `PASTE_EXTRACTION_TIMEOUT_MS` (20 s por defecto), pasado en `ctx.signal`. Una
degradación, un plazo agotado o una cuota superada responden `503 extraction_unavailable` sin tocar el link: la persona
conserva lo pegado en el diálogo y puede reintentar.

### D2 — Un tercer origen: `pasted`

`previewSources[campo].source` admite `'auto' | 'pasted' | 'manual'`. `pasted` lleva `by` y `at` como `manual`, y además
`extractor: 'ai:extract-job'`, porque la interpretación la hizo la IA: la tarjeta dice "Pegado por Beto", y el
formulario puede recordar que lo leyó la IA.

La **precedencia** es un orden total: `manual` (3) > `pasted` (2) > `auto` (1). Las reglas de ADR-022 se generalizan:

- Un merge **automático** (el del worker) no sustituye nada de rango superior: ni `manual` ni `pasted`.
- **Pegar** sustituye lo `auto`, sustituye lo `pasted` anterior (una persona pega una versión mejor), y no toca lo
  `manual`.
- **Editar a mano** lo sustituye todo.
- Cuando una edición desplaza un valor de rango inferior, `replaced` guarda el valor **y su origen**:
  `{ value, source: 'auto', extractor }` o `{ value, source: 'pasted', by, at }`. Por eso "volver a" devuelve al valor
  pegado cuando lo hubo, y no a lo que dijo la página antes de pegar: lo pegado era mejor que lo leído, o no se habría
  pegado.

`replaced` gana un campo (`source`) y deja de suponer que lo desplazado era automático. Los documentos existentes, sin
`source` en `replaced`, se leen como `auto`, que es lo único que podían ser: no hace falta migrar.

### D3 — Las dos copias de la regla se mueven juntas

La regla de merge vive duplicada a propósito en `apps/worker/.../domain/merge.ts` y `apps/api/.../domain/preview-edit.ts`
(ADR-022), con la tabla de casos compartida en `@linkvault/testing` que los dos specs recorren. Este change amplía esa
tabla con los casos de `pasted` —relectura sobre pegado, pegado sobre manual, manual sobre pegado, volver a lo pegado— y
toca las dos implementaciones a la vez. Si solo cambiara una, la tabla dejaría el spec de la otra en rojo, que es para
lo que existe.

La regla nueva de **pegar** solo la aplica `api`: el worker no pega. Pero el worker necesita saber que `pasted` existe
y que no lo puede sustituir.

### D4 — La higiene de contactos pasa a `libs/shared`

`scrubContactDetails` es una función pura sobre texto, sin dependencias, que ahora necesitan los dos procesos. Se mueve
de `apps/worker/.../domain/contact-scrub.ts` a `libs/shared`, que es donde viven las reglas que comparten ambos, y el
worker la importa de ahí. Copiarla en `api` sería la tercera regla duplicada de este módulo, y esta sí se puede
compartir sin cruzar ningún límite: `libs/shared` es importable desde cualquier `domain/`.

### D5 — Límites: tamaño, frecuencia y fallo cerrado

- El texto se acepta hasta **20 000 caracteres**, como la importación de `job-links`, y `extract-job` lo recorta a sus
  24 000 declarados; un texto más largo responde `400` antes de gastar nada.
- **10 pegados por usuario cada 15 minutos**, con el limitador de `apps/api/src/infrastructure/limits/`.
- El límite **falla cerrado**, como el de reintentos: cada pegado es una ejecución de IA, y lo que se permitiría sin
  contador es gastar sin techo.
- El orden de comprobaciones es: permiso de lectura del link (404) → texto válido (400) → límite (429) → IA. Así un
  `404` o un `400` no consumen cuota.

### D6 — Escritura y aviso

El resultado se escribe con la misma escritura condicionada por `previewVersion` que la edición manual (ADR-022 §1), y
sube la versión, de modo que un enriquecimiento en vuelo no pise lo pegado. Si pierde la carrera se rehace sobre lo que
el otro escribió, como hace `PATCH`. El estado queda `enriched` si están `title` y `company` y `partial` si no; se limpia
`lastEnrichmentError`. La respuesta es el resumen del link, y como el cambio lo hace `api`, el aviso a las demás
pantallas abiertas sale por el mismo reparto de SSE que ya existe, sin pasar por Redis.

Lo que `extract-job` devuelve con `isJobPosting: false` responde `422 not_a_job_posting` y no escribe nada: el link
no cambia porque alguien pegó la conversación en vez de la oferta.

### D7 — Probar el historial cuando `robots.txt` niega

En `ExtractPreviewService`, si `robots.decide(displayUrl)` niega, se recorren las demás URLs de `originalUrls` en orden
—las más recientes primero, que son las que tienen más probabilidades de seguir vivas—, pidiendo permiso para cada una
dentro del mismo turno del host, y se descarga la primera permitida. Si ninguna lo está, `robots_disallowed` como hoy.
La `displayUrl` no cambia: sigue siendo lo que la persona escribió y lo que se abre. El historial solo tiene URLs de la
misma vacante (ADR-021), así que probarlas no es leer algo distinto.

## Risks / Trade-offs

- **`api` gana la IA.** Es la dependencia más pesada que se le ha añadido, y una petición HTTP pasa a poder tardar lo que
  tarde un proveedor. Lo acotan el plazo de D1, el límite de D5 y que el endpoint solo lo usa una persona que acaba de
  pegar algo y está mirando.
- **Varias instancias de `api`** ejecutan IA cada una: las cuotas son por usuario sobre el ledger, así que siguen
  siendo globales; el breaker es por proceso (ADR-018 §7), como en el worker.
- **Lo pegado puede estar mal interpretado.** Por eso es un origen distinto de lo escrito a mano, se puede corregir
  encima y se puede volver a él.
- **Una persona puede pegar el texto de otra oferta** en la tarjeta equivocada. La autoría visible y la edición
  reversible lo hacen visible y reparable, igual que la edición manual (ADR-022 §9).

## Migration Plan

Nada que migrar: `previewSources` admite un valor más en `source`, y un `replaced` sin `source` se lee como `auto`.

El rescate por historial (D7) vale para las lecturas que ocurran a partir de ahora. Los links que **ya** quedaron
`failed` con `robots_disallowed` no se reintentan solos: ese motivo no es reintentable ni por el botón ni por el
backfill (ADR-022 §4), a propósito, porque volver a pedir lo que un sitio prohibió es lo que ADR-003 evita. Esos links
se completan pegando su descripción, que es justo lo que este change añade.

## Open Questions

- Si en algún momento se quiere crear un link a partir de un texto sin URL, hará falta una clave de dedupe que no sea
  una URL; queda fuera de este change.
