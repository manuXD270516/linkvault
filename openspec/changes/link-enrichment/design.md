## Context

`job-links` dejó todo lo de aguas arriba hecho: `job_links` con su `dedupeKey` única, `displayUrl` inmutable,
`previewStatus` `pending`, `previewVersion`, el outbox transaccional y un relay en `api` que publica `LinkCreated.v1` en
la cola `enrich-link` con `jobId` determinista `enrich:<linkId>:<previewVersion>`. Nadie consume esa cola. `apps/worker`
tiene `BullmqConnectionModule` y ningún `Worker` registrado. `libs/ai` tiene `runTask`, el mock determinista en replay y
synth, el eval harness con línea base estricta, el `PiiRedactor` y la degradación tipada; solo está registrada la tarea
`classify-skills`. MinIO está en el compose desde `bootstrap-monorepo` y ninguna app lo usa todavía.

Motivación y alcance: proposal.md; comportamiento: las specs. Decisiones humanas previas de este change: el golden de
`extract-job` entra ahora **sintético** y las vacantes reales se graban después con `/lv:golden`; el aviso al SPA es
**SSE completo**; el backfill es un **comando manual**; el headless queda como **hueco sin adaptador**; el smoke usa
**fixtures locales y además descargas reales** de las plataformas que lo permiten, y **no** se autoriza IA externa
(`--allow-external` queda fuera). Durante la ausencia del autor se autorizó `gh pr merge --auto --squash` en el PR de
este change y en el de su archivo, **solo con CI verde**; queda constancia aquí y en el cuerpo de cada PR.

### Lo que dicen los `robots.txt` de verdad (medido el 2026-09-17 con nuestro `User-Agent`)

| Plataforma | `robots.txt` | Una oferta | Datos estructurados |
|---|---|---|---|
| LinkedIn | `Disallow: /` para `*` | **prohibida** | — |
| Indeed | `/viewjob` prohibido para `*` | **prohibida** | — |
| Computrabajo | responde `403` al pedirlo | se asume permitido, pero el sitio **nos bloquea** (`403`) | — |
| Trabajopolis | permitido | `200`, 287 KB | **JSON-LD `JobPosting` completo** |
| Get on Board | permitido (sin reglas) | `200`, 198 KB | Open Graph rico; sin JSON-LD |

Esta medición decide dos cosas del diseño: no se escribe **ningún** adaptador de selectores por plataforma (D3), y el
rechazo por robots o por bloqueo del sitio tiene motivo y texto propios, distintos de un error nuestro (D5).

## Goals / Non-Goals

**Goals:**
- Que un link guardado se convierta solo en una vacante legible, sin que nadie espere a la descarga.
- Que reprocesar el mismo evento no duplique nada ni pise lo que una persona escribió.
- Que la extracción sea lícita y educada: robots, un dominio a la vez, agente identificable.
- Que la pantalla abierta se entere sin preguntar, y que lo que no se pudo leer se diga con honestidad.

**Non-Goals:**
- El adaptador headless real: queda el eslabón y el flag apagado.
- Adaptadores de selectores por plataforma: la medición demuestra que no hacen falta (D3).
- El golden de 20+ vacantes reales anonimizadas y cualquier ejecución contra un proveedor externo.
- Postulaciones, comentarios, página pública, reextracción periódica y caducidad de vacantes.

## Decisions

### D1 — El consumidor vive en `apps/worker`, con la plantilla de módulo

`apps/worker/src/modules/enrichment/{domain,application,infrastructure}`: el dominio tiene la cadena y el merge y no
conoce Nest, Mongo, BullMQ ni un parser de HTML; la aplicación orquesta con puertos (`LINK_REPOSITORY`, `PAGE_FETCHER`,
`ROBOTS`, `HOST_MUTEX`, `SNAPSHOT_STORE`, `ENRICHMENT_NOTIFIER`, `AI`); la infraestructura los implementa. El `Worker` de
BullMQ se registra en `enrichment.module.ts`.

### D2 — Idempotencia propia, no prestada del `jobId`

El job trae `{ linkId, previewVersion }`. El consumidor:

1. lee el link; si no existe, completa sin error;
2. si `link.previewVersion > job.previewVersion`, descarta: ese trabajo ya quedó viejo;
3. al escribir, usa `updateOne({ _id, previewVersion: leída }, { $set: …, $inc: { previewVersion: 1 } })`; si no modificó
   nada, otro ganó y el job termina sin reintento.

**La edición manual también incrementa `previewVersion`** (C3). Sin eso, la secuencia "worker lee v1 → persona edita a
mano en v1 → worker escribe contra v1" pisa en silencio lo que la persona escribió, que es justo lo que ADR-010
prohíbe. Con eso, el worker pierde la carrera y termina sin escribir.

### D3 — La cadena y su orden

`ExtractorStrategy { id, supports(page), extract(ctx): Promise<PreviewDraft> }`, ejecutados en orden fijo:

| # | Extractor | Qué aporta |
|---|---|---|
| 1 | `json-ld` | `JobPosting` de schema.org, incluido dentro de `@graph`: lo más fiable |
| 2 | `metadata` | Open Graph, `<title>`, `description`, `og:image` |
| 3 | `ai:extract-job` | `runTask` sobre el texto limpio de la página |
| 4 | `headless` | Hueco: `supports` devuelve `false` mientras `FEATURE_HEADLESS_EXTRACTION` sea `false` |

**Sin adaptadores por plataforma.** La medición del Context lo justifica: de las cinco bolsas del manifiesto, dos nos
prohíben leerlas, una nos bloquea, y las dos que sí se pueden leer quedan cubiertas por `json-ld` (Trabajopolis) y
`metadata` (Get on Board). El punto de extensión queda; el código, no. Escribir cinco adaptadores de selectores contra
sitios que no podemos visitar sería mantenimiento perpetuo de código muerto.

La cadena para en cuanto `title` y `company` están completos y **siempre descarga por `displayUrl`**. El parseo del HTML
vive en `infrastructure/html/`, que entrega al dominio un `PageContent { text, metaTags, jsonLdBlocks, title }`: así el
dominio sigue sin dependencias y el parser se puede cambiar sin tocar la cadena.

### D4 — Procedencia por campo (ADR-010)

```ts
type PreviewField<T> = {
  value: T;
  source: 'auto' | 'manual';
  extractor?: string;   // 'json-ld', 'metadata', 'ai:extract-job'… solo en 'auto'
  by?: string;          // userId, solo en 'manual'
  at: string;           // ISO
  replaced?: { value: T; extractor: string };  // lo automático que desplazó una edición manual
};
```

Dos reglas distintas, que C4 separó:

- **Dentro de una pasada**: gana la etapa anterior en el orden de D3. El orden es total, así que no hay empates.
- **Frente a lo ya guardado**: gana siempre lo nuevo automático, **salvo** que el campo guardado sea `manual`, que no se
  toca nunca. Sin esta segunda regla, un preview equivocado se volvería inmutable y la reextracción futura nacería rota.

Una edición manual guarda en `replaced` el valor automático que desplaza, para poder ofrecer "Volver a lo extraído".
Un campo ausente en la pasada nueva no borra el que ya había. Por la API, `by` sale resuelto como
`{ userId, displayName }` con el puerto `LINK_USER_DIRECTORY` que el mapper ya usa para `sharedBy`, en una sola
consulta: la tarjeta dice "Escrito por Ana", no un identificador.

**Desviación de ADR-010, registrada en ADR-022**: el campo `confidence` que ese ADR fija desaparece. El merge se decide
por el orden total de extractores (D3), que es explicable y comprobable; una confianza numérica por campo sería un
número inventado por nosotros que nadie sabría calibrar.

### D5 — Estados, motivos y honestidad

`enriched` si `title` y `company` están; `partial` si hay algo pero falta alguno; `failed` si no hay nada o no se pudo
descargar; `manual` en cuanto alguien edita. El fallo guarda `lastEnrichmentError: { reason, at }` con un motivo de una
lista cerrada:

| Motivo | Cuándo | Qué ve la persona |
|---|---|---|
| `robots_disallowed` | El `robots.txt` del sitio prohíbe esa ruta | "Esta bolsa no permite la lectura automática de sus ofertas" |
| `blocked` | El sitio responde `401`, `403` o `429` | "Esta bolsa no nos deja leer esta oferta" |
| `not_a_job` | La página se descargó y se parseó, no hay `JobPosting` en su JSON-LD y `extract-job` responde que no es una vacante | "Esto no parece una oferta" + quitar en un clic |
| `not_html`, `too_large`, `timeout`, `http_error`, `no_data` | Lo demás | "No pudimos leer esta oferta" |
| `deferred_too_long` | El link esperó su turno de host más veces de las permitidas | igual que el anterior |
| `retries_exhausted` | El job agotó sus reintentos | igual que el anterior |

`pending` significa dos cosas distintas para quien mira, así que el link guarda `previewRequestedAt`: la fecha en que se
pidió su lectura, escrita por `api` al crear el link y al reintentarlo. Un `pending` de menos de diez minutos se muestra
como "Leyendo la oferta…"; uno más viejo, como "Sin vista previa todavía". Sin ese dato, un link encolado con el relay
caído diría "Leyendo la oferta…" para siempre.

`no_data` es todo lo demás que termina sin campos: se pudo leer, no hay `JobPosting`, y la IA no llegó a responder o
respondió que sí era una vacante pero sin sacar título ni empresa. La diferencia entre los dos importa porque una lleva
a "quítalo" y la otra a "reintenta o complétalo".

Los tres primeros no son errores nuestros y no se cuentan como tales: `robots_disallowed` y `blocked` van a ser la
mayoría de LinkedIn, Indeed y Computrabajo, y decirlo así es la diferencia entre un producto honesto y uno que parece
roto. En ningún caso se registra el cuerpo de la respuesta ni la URL completa en los logs.

### D6 — Cortesía: robots, un host a la vez y límites

- `robots.txt` por host, cacheado en Redis (`enrich:robots:<host>`, 12 h), con el "prohibido" también cacheado. Si no se
  puede leer, se asume permitido. El grupo aplicable es el más específico que case con nuestro `User-Agent`, con
  respaldo en `*` (C16); un `robots.txt` que no es texto (una página de bloqueo, como la de Computrabajo) no se
  interpreta.
- Espera efectiva entre peticiones al mismo host = `max(ENRICH_DOMAIN_DELAY_MS, Crawl-delay del grupo aplicable)`.
- `User-Agent: LinkVaultBot/0.1 (+https://github.com/manuXD270516/linkvault)`.
- **Un host a la vez con un mutex en Redis**, no con los grupos de BullMQ: `group`/`groupKey` son de BullMQ Pro y no
  existen en la versión instalada. Una sola clave hace las dos cosas: el consumidor toma
  `SET enrich:host:<host> NX PX (ENRICH_FETCH_TIMEOUT_MS + espera efectiva)` y **no la borra al terminar**, de modo que
  su caducidad es a la vez la exclusión y la espera entre peticiones. Si no la consigue,
  `job.moveToDelayed(now + espera)`; un job que se aplaza más de `ENRICH_MAX_DEFERRALS` veces se da por
  `deferred_too_long`, para que un host caído no haga girar en vacío los slots del worker. **No** por `blocked`: el sitio
  no ha dicho nada, el que no llegó a tiempo fue nuestro turno, así que es un fallo transitorio y reintentable. El tope
  se cuenta en aplazamientos, no en minutos, y se fija para que una importación de 50 links del mismo host quepa entera. El `Worker` corre con `concurrency: 4` global. El host
  sale del link leído en Mongo, no del evento: `LinkCreated.v1` nunca lleva la URL del usuario.
- `ENRICH_FETCH_TIMEOUT_MS` (10 s), `ENRICH_MAX_BYTES` (2 MiB, cortando el flujo), solo `text/html`, máximo 3
  redirecciones, solo `http(s)`.
- `lockDuration` del `Worker` por encima de `ENRICH_DEADLINE_MS`, gzip asíncrono y recorte del HTML antes de parsear,
  para que un job no se dé por `stalled` y se reentregue (C18).

### D7 — `extract-job` como `AiTask`

`libs/ai/src/tasks/extract-job.task.ts` y `libs/ai/src/infrastructure/prompts/extract-job.v1.md`, que es donde
`FilePromptRegistry` los busca (C21). `dataSensitivity: 'public'`: la página es pública y no depende del consentimiento
de nadie. Salida `jobPreviewSchema`, `temperature 0`.

- **Entrada recortada a un límite fijo** de 24 000 caracteres declarado en el `inputSchema`, nunca al contexto del
  proveedor: la clave determinista se calcula antes del routing, así que un input que dependiera del proveedor haría
  inservibles los fixtures, la caché y la línea base (C6).
- **`ctx.userId = link.createdBy`**, que el worker ya tiene en el documento leído: sin eso, las cuotas por usuario y
  tarea de ADR-018 §9 no aplicarían nunca a `extract-job` y el ledger no diría de quién fue el gasto. No hace falta leer
  `users` para eso. La relectura que pide otra persona también se atribuye a quien guardó el link; queda dicho en
  ADR-022 para que no se lea como un error.
- **Salida propia de la tarea**: `{ isJobPosting: boolean, preview: jobPreviewSchema | null }`, no `jobPreviewSchema` a
  secas. Con un schema que exige `title`, un modelo a temperatura 0 inventa un título para un vídeo de YouTube; con el
  discriminador puede decir que eso no es una vacante, que es lo que el motivo `not_a_job` necesita para existir.
- **`outputLanguage` fijo `es`**, no el del perfil de quien guardó el link. El `JobLink` es canónico y compartido:
  el preview que produce lo ven todos los miembros de todos los grupos donde esté, así que no puede depender de las
  preferencias de una persona. El worker no necesita leer `users` y no cruza el límite de módulos.
- **Higiene del texto antes de enviarlo** (C17): los avisos de empleo llevan email y teléfono del reclutador, que son
  datos de un tercero. `infrastructure/html/` los quita al construir el texto limpio (`mailto:`, `tel:`, emails y
  teléfonos). No es redacción reversible; es no enviar lo que no hace falta, y además ahorra tokens.
- El plazo total por link (`ENRICH_DEADLINE_MS`, 45 s) se reparte: lo que quede al llegar a la etapa 3 es lo que recibe
  `ctx.signal`; si ya no queda, la etapa se salta. Una degradación no falla el job: el link queda `partial`.

### D8 — Golden sintético con línea base

`libs/ai/src/evals/extract-job/golden.jsonl` con casos fabricados por nosotros: Trabajopolis (JSON-LD), Get on Board
(solo Open Graph), una página de empresa genérica, una en inglés, una sin empresa, una con salario en rango y una
página de listado como trampa (`not_a_job`). `expected` con su schema propio; métricas de calidad `field_accuracy`
sobre `title`/`company`/`modality` y `skills_recall`/`skills_precision`. Los fixtures se graban con
`ai:record-fixtures --task=extract-job` contra **Ollama local** (ADR-019 §5 y §7): sin proveedor externo, que esta vez
no está autorizado. La línea base se graba en el mismo commit.

### D9 — SSE: el worker publica, la API reparte, el SPA lo lee con su token

El worker no habla con navegadores. Al terminar, publica en un canal de Redis (`events:link.enriched`) un aviso mínimo
`{ linkId, previewStatus, previewVersion }`. `api` mantiene una suscripción por proceso y, por cada aviso, resuelve
quién puede ver ese link y lo envía a las conexiones abiertas de esos usuarios.

**El SPA no usa `EventSource`**: el guard global solo lee `Authorization: Bearer` y la cookie de refresh tiene
`Path=/api/auth`, así que un `EventSource` nativo recibiría `401` siempre. El cliente abre `GET /api/events` con
`HttpClient` (`observe: 'events'`, `responseType: 'text'`, `reportProgress: true`), que entrega el cuerpo por trozos y
**sí pasa por el interceptor** que pone el access token y lo refresca; un `fetch` a pelo no lo haría, porque
`HttpInterceptorFn` solo corre para `HttpClient`. La reconexión la hace el propio servicio con espera creciente. Así no
hay tokens en URLs ni en logs de acceso, y una sesión caducada no consigue reabrir el canal: eso es lo que sustituye a
"cerrar el canal cuando la sesión deja de ser válida".

**El aviso lleva el preview dentro.** `api` ya lee el link para resolver destinatarios, así que envía en el mismo evento
el resumen actualizado (`preview`, `previewSources`, `previewStatus`, `previewVersion`, `lastEnrichmentError`). Sin eso
la tarjeta no tendría de dónde leerlo: no hay `GET /api/links/:id` y la spec prohíbe volver a pedir la lista entera.
Cuando ese endpoint haga falta de verdad —`applications-tracking` y `public-preview-share` lo van a pedir— se escribe
allí.

El reparto necesita índices `{ linkId: 1 }` en `group_links` y `user_links` (C8): los que hay son compuestos con el link
en segunda posición, y sin ellos cada aviso de una importación de 50 links serían escaneos completos.

### D10 — Reintentar y reencolar: por el outbox, nunca por la cola

Ni el endpoint `POST /api/links/:id/enrich` ni el comando de backfill tocan BullMQ. Los dos hacen lo mismo que el alta
de un link: en una transacción suben `previewVersion`, ponen `previewStatus: 'pending'`, limpian `lastEnrichmentError`,
apuntan `previewRequestedAt` y escriben `LinkCreated.v1` en `outbox_events`; el relay lo publica.

Esto resuelve tres cosas a la vez. La `Queue` de `enrich-link` vive dentro de `OutboxRelayModule` y solo existe con
`OUTBOX_RELAY_ENABLED` (ADR-021 §4), así que montar una segunda cola en `links` obligaría a la suite de integración de
`api` a tener Redis, que es justo lo que ese ADR evitó. El `jobId` determinista incluye `previewVersion`, así que subirla
produce un identificador nuevo y el job terminal retenido una semana deja de estorbar, sin tener que borrarlo —una
operación con carrera—. Y no hay dual-write: la verdad sigue siendo una transacción de Mongo.

`nx run api:backfill-enrichment -- --limit=500 [--status=pending|failed]` usa el índice `{ previewStatus: 1, _id: 1 }` y
no mira `outbox_events`. Con `--status=pending` no sube la versión (el trabajo sigue siendo el mismo y el `jobId` que ya
está en la cola lo deduplica); con `--status=failed` sí, y solo rescata los motivos transitorios: `timeout`,
`http_error`, `deferred_too_long` y `retries_exhausted`. `robots_disallowed`, `blocked` y `not_a_job` no se reintentan nunca —ni por botón ni
por comando—, porque volver a pedir lo que un sitio ya negó es exactamente el daño que ADR-003 quiere evitar.

### D11 — Contratos nuevos en `libs/shared`

`jobPreviewSchema` (design-v0.2 §4.7, estricto) es la salida de la IA dentro de
`extractJobOutputSchema = { isJobPosting, preview | null }`. Lo que se guarda y lo que sale por la API es
`storedPreviewSchema = jobPreviewSchema.partial()` más `image` —que solo pone el extractor `metadata` desde `og:image`,
nunca la IA, que inventaría URLs— con `previewSourcesSchema`: un preview `partial` no puede validar contra el estricto.
En `previewSources`, `by` se guarda como `userId` y sale por la API como `{ userId, displayName }`.

Además `updatePreviewRequestSchema`, el evento `LinkEnriched.v1`, los motivos de D5 y tres códigos de error:
`preview_field_unknown` (400), `too_many_attempts` (429, la importación) y `enrichment_not_retryable` (409, el
reintento de algo que no se puede reintentar).

**La forma de `preview` y `previewSources` se define una sola vez aquí** y los dos schemas de Mongoose —el de `api` y el
del worker— se derivan de ella, con un test tabular que compara sus claves: dos `strict: true` divergentes descartarían
campos en silencio.

### D12 — Snapshot en MinIO

`snapshots/<linkId>/<previewVersion>.html.gz`, escrito **después** de que la escritura condicionada gane la carrera, de
modo que el snapshot siempre corresponde al preview que lo acompaña; la perdedora no escribe. La clave va en
`job_links.snapshotKey` y **se lee de ahí, nunca se calcula** a partir de `previewVersion`: la versión también sube con
las ediciones manuales y con los reintentos, que no producen snapshot. Un fallo al guardarlo se registra y no impide el preview. El bucket lleva regla de expiración a
30 días: su única razón de existir es poder construir después el golden real sin volver a pedirle nada al sitio, y eso
no necesita historia infinita.

### D13 — Límite de la importación, con spec

El rate limit de `POST /api/links/import` (heredado del manifiesto) tiene requisito en `links/sharing`, no solo una
tarea (C13). El limitador de intentos deja de ser privado de `auth`: su implementación Redis se mueve a
`apps/api/src/infrastructure/limits/`, infraestructura de plataforma como el outbox, y `auth` y `links` la consumen por
su propio token. Así `links` no importa nada de `auth` y la regla de módulos de ADR-020 §6 se respeta.

## Risks / Trade-offs

- **Dos de las cinco plataformas no se pueden leer, y una nos bloquea.** Es el riesgo mayor del change y no lo resuelve
  ninguna decisión técnica: LinkedIn e Indeed prohíben la lectura automática. Lo que este change hace es decirlo con
  honestidad y dejar la edición manual a un clic. La salida lícita —que la persona pegue la descripción y `extract-job`
  la lea— es alcance nuevo y queda en Open Questions, sin decidir.
- **La red en los tests.** Ningún test toca internet: `PAGE_FETCHER`, `ROBOTS` y `HOST_MUTEX` son puertos con dobles y
  los HTML de prueba son fixtures. El smoke sí descarga de verdad, de las plataformas que lo permiten.
- **El golden sintético puede dar verde mientras la realidad falla.** Lo acota el smoke con páginas reales; el snapshot
  en MinIO es lo que hace el riesgo reversible, porque permite construir el golden real sin volver a pedir nada.
- **SSE con varias instancias de `api`.** Cada proceso se suscribe al canal y reparte a sus propias conexiones, así que
  escala; lo que no escala es el relay del outbox, ya anotado en ADR-021.
- **Merge por orden fijo en vez de por confianza numérica.** Más simple de explicar y de probar; si algún extractor
  resulta mejor que otro en un campo concreto, habrá que cambiar el orden o pesar por campo.

## Migration Plan

Los links ya guardados siguen en `pending` con un preview ausente, que se lee como vacío: no hace falta migrar
documentos. El comando de D10 los reencola cuando se quiera.

## Open Questions

- **Completar pegando la descripción.** Para LinkedIn, Indeed y Computrabajo es el único camino lícito que queda, y
  encaja con lo que la persona ya hace (pegar el chat). Son ~4 tareas y reutiliza `extract-job` y la edición manual,
  pero es alcance nuevo: se decide con el autor, no aquí.
- Reextracción periódica y caducidad de vacantes (`expiresAt` ya se guarda): fuera de este change.
- Si Computrabajo sigue bloqueándonos, decidir si se le da un texto propio distinto de `blocked` genérico.
