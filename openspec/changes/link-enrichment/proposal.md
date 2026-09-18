## Why

`job-links` dejó la vacante guardada y el trabajo encolado, pero la tarjeta no dice nada: un grupo lleno de links es
una lista de URLs con una etiqueta sacada del path y un "Sin vista previa todavía". La cola `enrich-link` acumula jobs
que nadie consume. Este change escribe ese consumidor y convierte cada link en una vacante legible —título, empresa,
modalidad, seniority, skills— sin que nadie espere a un scraper y sin scrapear donde no se debe (ADR-003).

También cierra la promesa del preview: cuando la extracción no alcanza, la persona edita el campo a mano y eso **no**
se vuelve a pisar (ADR-010).

## What Changes

- **Consumidor de `enrich-link` en `apps/worker`**, idempotente por sí mismo y no solo por el `jobId` determinista: la
  retención de la cola olvida los jobs, y un evento republicado después vuelve a entrar.
- **Cadena de extracción lícita** (ADR-003): JSON-LD `JobPosting` → Open Graph y metadatos → adaptador por plataforma →
  `runTask('extract-job')` → hueco para headless, que queda apagado. La cadena para en cuanto los campos obligatorios
  están completos y **siempre descarga por `displayUrl`**, nunca por la URL normalizada, que es solo identidad.
- **Cortesía con los sitios**: `robots.txt` respetado y cacheado por host, una descarga a la vez por dominio con espera
  entre peticiones, `User-Agent` identificable, tiempo y tamaño máximos, y solo respuestas HTML.
- **Preview con procedencia por campo** (ADR-010): cada campo guarda su valor, de dónde salió (`auto` con el extractor
  que lo produjo, o `manual` con quién y cuándo) y su confianza. El merge automático nunca sobrescribe lo manual.
- **Estados reales del preview**: `pending → enriched | partial | failed | manual`, con `previewVersion` que sube en
  cada enriquecimiento y sirve de control de concurrencia.
- **`extract-job` como tarea de IA** `public` (ADR-018 §11), con salida `JobPreview` validada, prompt versionado, plazo
  total por link en `ctx.signal` para que una importación de 50 no espere los timeouts de toda la cadena, y golden
  propio con línea base en replay (ADR-019).
- **Snapshot del HTML** en MinIO por link y versión, para poder reextraer sin volver a pedirle nada al sitio.
- **SSE `link.enriched`**: el worker avisa, la API reparte y la tarjeta se actualiza sola en la pantalla abierta.
- **Edición manual del preview** desde el SPA, con el origen de cada campo a la vista.
- **Backfill manual** de los links que quedaron en `pending` sin job vivo, como comando documentado.

## Capabilities

### New Capabilities
- `links/enrichment`: consumo del trabajo encolado, cadena de extracción, merge por procedencia, estados del preview,
  cortesía con los sitios, snapshot y edición manual.
- `platform/realtime`: canal de eventos hacia el SPA con autenticación y filtrado por lo que cada persona puede ver.

### Modified Capabilities
- `links/job-link`: "Estado del preview" pasa de "en este change solo se produce `pending`" a las transiciones reales y
  al papel de `previewVersion`.
- `platform/outbox`: "El trabajo encolado no se pierde" pasa de "ningún consumidor" a un consumidor idempotente que no
  pierde ni duplica trabajo.
- `ai/deterministic-mock`: el modo replay anota las entradas sin fixture para poder grabarlas después (ADR-019 §5).
- `web/links`: la tarjeta muestra la vacante y su estado, se actualiza en vivo y permite editar los campos a mano.

## Impact

- **Código**: `apps/worker/src/modules/enrichment/` (dominio de la cadena, casos de uso, extractores, adaptadores),
  `apps/worker/src/infrastructure/` (descarga HTTP con cortesía, robots, MinIO, publicación del aviso),
  `libs/ai/src/tasks/extract-job/` con su prompt y su golden, `apps/api/src/modules/links/` (preview en las respuestas,
  edición manual, backfill) y `apps/api/src/presentation/http/events/` (SSE), `apps/web/src/app/features/links/`.
- **API**: `PATCH /api/links/:id/preview` (edición manual) y `GET /api/events` (SSE). Los listados y el guardado
  incorporan el preview a su respuesta.
- **Datos**: `job_links.preview` con procedencia por campo, `previewVersion`, `previewStatus`, `snapshotKey` y
  `lastEnrichmentError`; bucket de snapshots en MinIO.
- **Cola**: `enrich-link` gana su consumidor, con concurrencia por dominio y retención explícita.
- **IA**: tarea `extract-job` registrada como evaluable, con prompt `v1`, golden y línea base.
- **Frontend**: tarjeta de vacante, formulario de edición con el origen de cada campo y actualización en vivo.
- **ADRs**: implementa ADR-003, ADR-010 y ADR-014; hereda ADR-018, ADR-019 y ADR-021; las decisiones no triviales de
  este change (idempotencia del consumidor, forma del preview con procedencia, política de cortesía, canal SSE) se
  registran en **ADR-022**.
- **Fuera de alcance**: el adaptador headless real (queda el hueco, el flag sigue en `false`); el golden de 20+ vacantes
  reales anonimizadas, que se genera con `/lv:golden` cuando haya URLs reales aprobadas; postulaciones
  (`applications-tracking`), comentarios (`group-comments`) y la página pública (`public-preview-share`).
