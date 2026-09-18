## Why

`job-links` dejó la vacante guardada y el trabajo encolado, pero la tarjeta no dice nada: un grupo lleno de links es
una lista de URLs con una etiqueta sacada del path y un "Sin vista previa todavía". La cola `enrich-link` acumula jobs
que nadie consume. Este change escribe ese consumidor y convierte cada link en una vacante legible —título, empresa,
salario, modalidad, seniority, skills— sin que nadie espere a un scraper y sin scrapear donde no se debe (ADR-003).

También cierra la promesa del preview: cuando la extracción no alcanza, la persona edita el campo a mano, se ve quién lo
escribió, se puede volver atrás y eso **no** se vuelve a pisar (ADR-010).

## What Changes

- **Consumidor de `enrich-link` en `apps/worker`**, idempotente por sí mismo y no solo por el `jobId` determinista: la
  retención de la cola olvida los jobs, y un evento republicado después vuelve a entrar.
- **Cadena de extracción lícita** (ADR-003): JSON-LD `JobPosting` → Open Graph y metadatos → `runTask('extract-job')` →
  hueco para headless, que queda apagado. La cadena para en cuanto los campos obligatorios están completos y **siempre
  descarga por `displayUrl`**, nunca por la URL normalizada, que es solo identidad.
- **Sin adaptadores por plataforma, con evidencia**: medimos los cinco `robots.txt` con nuestro `User-Agent` antes de
  escribir código. LinkedIn prohíbe todo su sitio, Indeed prohíbe `/viewjob`, Computrabajo nos responde `403`, y las dos
  que sí permiten leerse quedan cubiertas por JSON-LD (Trabajopolis) y Open Graph (Get on Board). El punto de extensión
  queda; cinco adaptadores de selectores contra sitios que no podemos visitar, no.
- **Motivos honestos**: `robots_disallowed`, `blocked` y `not_a_job` se dicen con sus palabras y no como un error
  nuestro, porque van a ser la mayoría de lo que se comparte de LinkedIn, Indeed y Computrabajo.
- **Cortesía con los sitios**: `robots.txt` respetado y cacheado por host, `Crawl-delay` obedecido, una descarga a la vez
  por dominio con un mutex en Redis, `User-Agent` identificable, tiempo y tamaño máximos, y solo respuestas HTML.
- **Preview con procedencia por campo** (ADR-010): cada campo guarda su valor, de dónde salió (leído de la página,
  deducido por la IA, o escrito por una persona con su nombre y su fecha) y el valor automático que una edición
  desplazó, para poder volver a él.
- **Estados reales del preview**: `pending → enriched | partial | failed | manual`, con `previewVersion` que sube en cada
  enriquecimiento **y en cada edición manual**, lo que impide que un trabajo en vuelo pise lo que alguien escribió.
- **`extract-job` como tarea de IA** `public` (ADR-018 §11), con salida validada que distingue una vacante de lo que no
  lo es, prompt versionado, entrada recortada a un límite fijo, plazo total por link y golden propio con línea base en
  replay (ADR-019).
- **Snapshot del HTML** en MinIO por link y versión, con expiración a 30 días, para poder construir después el golden
  real sin volver a pedirle nada al sitio.
- **SSE `link.enriched`**: el worker avisa, la API reparte el aviso **con el preview ya actualizado dentro**, y la
  tarjeta se actualiza sola en la pantalla abierta, con el progreso de lo que queda por leer.
- **Edición manual del preview** desde el SPA, con el origen de cada campo a la vista y vuelta atrás por campo.
- **Reintentar** una lectura que falló por algo transitorio, desde la tarjeta o desde el comando. El reintento no toca
  la cola: sube la versión del preview y escribe su evento en el outbox, como hace el alta.
- **Backfill manual** de los links que quedaron sin preview, como comando documentado.
- **Límite de importaciones** por usuario, que hasta ahora no hacía falta porque importar no encolaba trabajo real.

## Capabilities

### New Capabilities
- `links/enrichment`: consumo del trabajo encolado, cadena de extracción, merge por procedencia, estados y motivos,
  cortesía con los sitios, snapshot, edición manual, reintento y reencolado.
- `platform/realtime`: canal de eventos hacia el SPA con autenticación por cabecera y filtrado por lo que cada persona
  puede ver.

### Modified Capabilities
- `links/job-link`: "Estado del preview" pasa de "en este change solo se produce `pending`" a las transiciones reales y
  al papel de `previewVersion`.
- `links/sharing`: la importación gana un límite por usuario y ventana.
- `platform/outbox`: "El trabajo encolado no se pierde" pasa de "ningún consumidor" a un consumidor idempotente que no
  pierde ni duplica trabajo.
- `ai/deterministic-mock`: el modo replay anota las entradas sin fixture para poder grabarlas después (ADR-019 §5).
- `web/links`: la tarjeta muestra la vacante con su salario y sus fechas, dice su estado con honestidad, se actualiza en
  vivo y permite editar los campos a mano y deshacerlo.

## Impact

- **Código**: `apps/worker/src/modules/enrichment/` (dominio de la cadena, casos de uso, extractores) y
  `apps/worker/src/infrastructure/` (descarga con cortesía, robots, mutex por host, MinIO, aviso),
  `libs/ai/src/tasks/extract-job.task.ts` con su prompt y su golden, `apps/api/src/modules/links/` (preview en las
  respuestas, edición manual, reintento, backfill), `apps/api/src/infrastructure/limits/` (el limitador de intentos
  deja de ser privado de `auth`), `apps/api/src/presentation/http/events/` (SSE) y `apps/web/src/app/features/links/`.
- **API**: `PATCH /api/links/:id/preview`, `POST /api/links/:id/enrich` y `GET /api/events`. Los listados y el guardado
  incorporan el preview, sus orígenes y el motivo del último fallo.
- **Datos**: `job_links.preview` con procedencia por campo, `previewSources`, `previewRequestedAt`, `snapshotKey` y
  `lastEnrichmentError`; índices `{ linkId: 1 }` en `group_links` y `user_links` y `{ previewStatus: 1, _id: 1 }` en
  `job_links`; bucket de snapshots con expiración.
- **Cola**: `enrich-link` gana su consumidor, con concurrencia global, mutex por host, retención y reintentos.
- **IA**: tarea `extract-job` registrada como evaluable, con prompt `v1`, golden sintético, fixtures grabados contra
  Ollama local y línea base en replay.
- **Frontend**: tarjeta de vacante, estados honestos, canal de eventos, progreso de la importación y formulario de
  edición con el origen de cada campo.
- **ADRs**: implementa ADR-003, ADR-010 y ADR-014; hereda ADR-018, ADR-019 y ADR-021; las decisiones no triviales de
  este change se registran en **ADR-022**.
- **Fuera de alcance**: el adaptador headless real (queda el hueco, el flag sigue en `false`); el golden de 20+ vacantes
  reales anonimizadas; cualquier ejecución contra un proveedor de IA externo; y completar una oferta pegando su
  descripción, que es la salida lícita para las bolsas que no podemos leer y queda como pregunta abierta.
