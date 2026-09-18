## Context

`job-links` dejó todo lo de aguas arriba hecho: `job_links` con su `dedupeKey` única, `displayUrl` inmutable,
`previewStatus` `pending`, `previewVersion`, el outbox transaccional y un relay en `api` que publica `LinkCreated.v1` en
la cola `enrich-link` con `jobId` determinista `enrich:<linkId>:<previewVersion>`. Nadie consume esa cola. `apps/worker`
tiene `BullmqConnectionModule` y ningún `Worker` registrado. `libs/ai` tiene `runTask`, el mock determinista en replay y
synth, el eval harness con línea base estricta, el `PiiRedactor` y la degradación tipada; solo está registrada la tarea
`classify-skills`. MinIO está en el compose desde `bootstrap-monorepo` y ninguna app lo usa todavía.

Motivación y alcance: proposal.md; comportamiento: las specs. Decisiones humanas previas de este change: el golden de
`extract-job` entra ahora **sintético** y las vacantes reales se graban después con `/lv:golden`; el aviso al SPA es
**SSE completo**; el backfill es un **comando manual**; el headless queda como **hueco sin adaptador**.

## Goals / Non-Goals

**Goals:**
- Que un link guardado se convierta solo en una vacante legible, sin que nadie espere a la descarga.
- Que reprocesar el mismo evento no duplique nada ni pise lo que una persona escribió.
- Que la extracción sea lícita y educada: robots, un dominio a la vez, agente identificable.
- Que la pantalla abierta se entere sin preguntar.

**Non-Goals:**
- El adaptador headless real: queda el eslabón y el flag apagado.
- El golden de 20+ vacantes reales anonimizadas y su línea base con proveedor real.
- Postulaciones, comentarios y página pública.
- Reextracción periódica o detección de vacantes caducadas.

## Decisions

### D1 — El consumidor vive en `apps/worker`, con la plantilla de módulo

`apps/worker/src/modules/enrichment/{domain,application,infrastructure}`: el dominio tiene la cadena y el merge y no
conoce Nest, Mongo ni BullMQ; la aplicación orquesta con puertos (`LINK_REPOSITORY`, `PAGE_FETCHER`, `ROBOTS`,
`SNAPSHOT_STORE`, `ENRICHMENT_NOTIFIER`, `AI`); la infraestructura los implementa. El `Worker` de BullMQ se registra
solo en `presentation`-equivalente del worker (`enrichment.module.ts`), igual que `api` registra sus controladores.

### D2 — Idempotencia propia, no prestada del `jobId`

El job trae `{ linkId, previewVersion }`. El consumidor:

1. lee el link; si no existe, completa sin error;
2. si `link.previewVersion > job.previewVersion`, descarta: ese trabajo ya quedó viejo;
3. si `link.previewStatus` es `manual` y ningún campo automático falta, no vuelve a descargar;
4. al escribir, usa `updateOne({ _id, previewVersion: leída }, { $set: …, $inc: { previewVersion: 1 } })`; si no
   modificó nada, otro ganó y el job termina sin reintento.

Así, un evento republicado tras expirar la retención de la cola no duplica ni pisa nada.

### D3 — La cadena y su orden

`ExtractorStrategy { id, supports(url, page), extract(ctx): Promise<PreviewDraft> }`, ejecutados en orden fijo:

| # | Extractor | Qué aporta |
|---|---|---|
| 1 | `json-ld` | `JobPosting` de schema.org: lo más fiable |
| 2 | `metadata` | Open Graph, `<title>`, `<meta name=description>`, microdatos sueltos |
| 3 | `platform:<id>` | Selectores por plataforma para las cinco conocidas, cuando las anteriores no bastan |
| 4 | `ai:extract-job` | `runTask` sobre el texto limpio de la página |
| 5 | `headless` | Hueco: `supports` devuelve `false` mientras `FEATURE_HEADLESS_EXTRACTION` sea `false` |

La cadena para en cuanto `title` y `company` están completos. Cada extractor devuelve campos sueltos, nunca un preview
entero, y el orquestador mezcla (D4).

### D4 — Procedencia por campo (ADR-010)

```ts
type PreviewField<T> = {
  value: T;
  source: 'auto' | 'manual';
  extractor?: string;   // 'json-ld', 'ai:extract-job'… solo en 'auto'
  by?: string;          // userId, solo en 'manual'
  at: string;           // ISO
  confidence: number;   // 0..1, fijo por extractor
};
```

El preview guardado es `Record<campo, PreviewField>`; el que sale por la API es el valor plano más un mapa de orígenes,
para que el SPA no tenga que desenvolver cada campo. Reglas del merge: un campo `manual` no se toca nunca; entre dos
`auto` gana el extractor anterior en el orden de D3 (empate imposible, el orden es total); un campo ausente no borra el
que ya había.

### D5 — Estados y errores

`enriched` si `title` y `company` están; `partial` si hay algo pero falta alguno; `failed` si no hay nada o la descarga
no se pudo hacer; `manual` en cuanto alguien edita. El fallo guarda `lastEnrichmentError: { reason, at }` con un motivo
de una lista cerrada (`robots_disallowed`, `not_html`, `too_large`, `timeout`, `http_error`, `no_data`), nunca el cuerpo
de la respuesta ni la URL completa en los logs.

### D6 — Cortesía: robots, un dominio a la vez y límites

- `robots.txt` por host, cacheado en Redis (`enrich:robots:<host>`, 12 h), con el resultado de "prohibido" también
  cacheado. Si no se puede leer, se asume permitido: un `robots.txt` caído no es una prohibición.
- `User-Agent: LinkVaultBot/0.1 (+https://github.com/manuXD270516/linkvault)`.
- Concurrencia por dominio con el `group` del `Worker` de BullMQ (concurrencia 1 por grupo, grupo = host) y espera
  mínima entre peticiones al mismo host (`ENRICH_DOMAIN_DELAY_MS`, 2 s).
- `ENRICH_FETCH_TIMEOUT_MS` (10 s), `ENRICH_MAX_BYTES` (2 MiB, cortando el flujo al superarlo), solo `text/html`, un
  máximo de 3 redirecciones y nada de esquemas que no sean `http(s)`.

### D7 — `extract-job` como `AiTask`

`dataSensitivity: 'public'` (ADR-018 §11): la página es pública y no depende del consentimiento de nadie. Salida
`jobPreviewSchema` de `libs/shared`, prompt `extract-job.v1.md`, `outputLanguage` del perfil de quien guardó el link,
`temperature 0`. La entrada es el texto de la página recortado al contexto del proveedor, más título y host. El plazo
total por link (`ENRICH_DEADLINE_MS`, 45 s) se reparte: lo que quede al llegar a la etapa 4 es lo que recibe `ctx.signal`;
si ya no queda, la etapa se salta. Una degradación no falla el job: el link queda `partial`.

### D8 — Golden sintético con línea base

`libs/ai/src/evals/extract-job/golden.jsonl` con casos fabricados por nosotros: una vacante por plataforma conocida,
una en inglés, una sin empresa, una con salario en rango, una con skills en lista y una trampa (página de listado en vez
de vacante). `expected` con su schema propio; métricas de calidad `field_accuracy` sobre `title`/`company`/`modality` y
`skills_recall`/`skills_precision`, sobre las bloqueantes que ya existen. Línea base grabada en replay en el mismo
commit. Las vacantes reales se añaden después con `/lv:golden`, sin tocar el corredor.

### D9 — SSE: el worker publica, la API reparte

El worker no habla con navegadores. Al terminar, publica en un canal de Redis (`events:link.enriched`) un aviso mínimo
`{ linkId, previewStatus, previewVersion }`. `api` mantiene una suscripción por proceso y, por cada aviso, resuelve
quién puede ver ese link (miembros de sus grupos + dueños de su entrada privada, con las consultas que ya existen) y lo
envía a las conexiones SSE de esos usuarios. `GET /api/events` usa el guard global; el flujo manda un latido cada 25 s;
al cerrarse la conexión se limpia el registro. Sin suscriptores, el aviso se descarta: la verdad está en Mongo y el
listado la trae.

### D10 — Backfill como comando

`nx run api:backfill-enrichment -- --limit=500`: busca links en `pending` cuyo evento del outbox esté publicado o
ausente, y encola con el mismo `jobId` determinista, que impide duplicar lo que siga en la cola. No corre al arrancar y
queda documentado en el RUNBOOK.

### D11 — Contratos nuevos en `libs/shared`

`jobPreviewSchema` (el de design-v0.2 §4.7), `previewSourceSchema`, `jobLinkSummarySchema` ampliado con `preview` y
`previewSources`, `updatePreviewRequestSchema`, el evento `LinkEnriched.v1` y el código de error `preview_field_unknown`.
`previewStatus` ya existe con sus cinco valores.

### D12 — Snapshot en MinIO

`snapshots/<linkId>/<previewVersion>.html.gz` en el bucket `snapshots`, escrito antes de guardar el preview; la clave va
en `job_links.snapshotKey`. Un fallo al guardarlo se registra y no impide el preview: el snapshot es una comodidad para
reextraer, no la fuente de verdad.

## Risks / Trade-offs

- **La red en los tests.** Ningún test toca internet: `PAGE_FETCHER` y `ROBOTS` son puertos con dobles, y los HTML de
  prueba viven en fixtures. El riesgo es que la realidad no se parezca a los fixtures; lo acota el smoke, que descarga
  de verdad unas pocas URLs conocidas.
- **SSE con varias instancias de `api`.** Cada proceso se suscribe al canal de Redis y reparte a sus propias
  conexiones, así que escala; lo que no escala es el relay del outbox (ya anotado en ADR-021).
- **Coste de la IA en importaciones grandes.** 50 links importados son hasta 50 ejecuciones. Lo acota el plazo por link
  (D7), que la cadena pare antes si los datos estructurados bastan, y el rate limit de `POST /api/links/import` que este
  change añade (heredado del manifiesto).
- **Merge por orden fijo en vez de por confianza numérica.** Es más simple de explicar y de probar; si algún día un
  extractor resulta mejor que otro en un campo concreto, habrá que cambiar el orden o añadir peso por campo.

## Migration Plan

Los links ya guardados siguen en `pending` con un preview vacío; el comando de D10 los reencola cuando se quiera. El
campo `preview` nace ausente y se lee como vacío, así que no hace falta migrar documentos.

## Open Questions

- Reextracción periódica y caducidad de vacantes (`expiresAt` ya viene en el schema): fuera de este change.
- Qué hacer cuando `robots.txt` prohíbe una plataforma entera: hoy queda `failed` y edición manual; si alguna de las
  cinco lo hiciera, habría que decidir si se avisa distinto en la tarjeta.
