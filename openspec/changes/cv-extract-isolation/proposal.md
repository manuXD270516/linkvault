## Why

La auditoría de `critic` del 2026-10-28 encontró que la lectura del CV, el primer código del producto que abre un
archivo subido por una persona, corre **dentro del proceso del worker** y sobre un parser sin mantenimiento:

- **El PDF lo abre `pdf-parse` 1.1.4** (`package.json:102`), que trae embebido **pdf.js 1.10.100, de 2017**
  (`node_modules/pdf-parse/lib/pdf.js/v1.10.100`), y lo llama en el hilo principal
  (`apps/worker/src/modules/cv/infrastructure/extractors/pdf-text.extractor.ts:34`). Ese pdf.js no recibe correcciones
  desde hace ocho años: cualquier fallo de seguridad o de robustez publicado desde entonces sigue ahí, frente a
  ficheros que sube cualquiera con cuenta.
- **El plazo no corta nada.** `withDeadline` (`apps/worker/src/modules/cv/application/extract-cv.usecase.ts:142-158`)
  es un `Promise.race`: deja de *esperar* al parser, pero no lo detiene. El propio comentario lo admite («No cancela el
  parser —no hay forma de hacerlo—»).
- **Un PDF patológico bloquea el event loop entero.** Mientras el parser ejecuta trabajo síncrono no corre nada más del
  proceso: ni el enriquecimiento de links, ni las notificaciones, ni el encaje, ni la renovación del bloqueo de BullMQ,
  ni `GET /health`. Con el bloqueo sin renovar, BullMQ da el job por `stalled` y **lo reentrega**: el mismo archivo se
  vuelve a abrir. Si el plazo vence sin bloqueo total, el job termina pero el parser **sigue consumiendo CPU** y la
  concurrencia de la cola deja entrar al siguiente: los trabajos colgados se acumulan.
- **Nadie lo reinicia.** El compose de producción declara `restart: unless-stopped`, que solo reinicia un contenedor que
  **sale**; un proceso colgado no sale, y Docker no reinicia por `unhealthy`.
- **El DOCX tiene el mismo problema, por otra vía.** `mammoth` está mantenido, pero descomprime con `jszip` sin tope
  (un ZIP de 5 MiB puede inflar a gigabytes: memoria fuera del heap de V8) y parsea el XML de forma síncrona con
  `@xmldom/xmldom` en el hilo principal. No hay otros formatos: la API solo admite PDF y DOCX por sus bytes
  (`cv/documents`, «El tipo del archivo lo deciden sus bytes»), y la API no abre el archivo (ADR-028 §7).

ADR-028 aceptó este riesgo por escrito («El parseo bloquea el hilo del worker […] Si se midiera un problema, la palanca
siguiente es `worker_threads` o un proceso aparte»). Lo que cambia ahora es **quién sube los archivos**: 35b
(`staging-host`) invita a los primeros usuarios no-autor, y esos son los primeros archivos que el proyecto no controla.

## What Changes

- **La lectura corre aislada en un `worker_thread` nuevo por CV**, con `resourceLimits` (heap acotado), sin variables de
  entorno heredadas (el hilo no ve credenciales), con su salida estándar descartada y con un **plazo que corta**:
  vencido, el hilo se termina con `terminate()`, que interrumpe incluso un bucle síncrono. El event loop del worker queda
  libre durante toda la lectura (design D1, D2, D7).
- **Topes de contenido**: como mucho 50 páginas de PDF, 1.000.000 de caracteres de texto crudo, 64 MiB inflados y 2.000
  entradas por DOCX, y un vigía de memoria del proceso que termina el hilo si la memoria residente crece más de 512 MiB
  durante la lectura (lo que el heap acotado no ve: búferes y `ArrayBuffer`) (D4, D5).
- **El DOCX se descomprime con nuestro tope antes de dárselo a `mammoth`**: lectura del directorio central del ZIP e
  inflado con `node:zlib` y `maxOutputLength`, de modo que una cabecera que miente sobre su tamaño no sirve de nada (D4).
- **`pdf-parse` se sustituye por pdf.js mantenido** (`pdfjs-dist`, build `legacy` para Node, versión exacta), con
  `isEvalSupported: false` y sin fuentes del sistema; la elección se confirma con un spike medido (carga desde el bundle
  y la imagen, `arm64`, tamaño, licencias y paridad del texto sobre los fixtures) y tiene una alternativa escrita
  (`unpdf`) (D3).
- **Clasificación honesta del desenlace**: todo lo que causa el **contenido** (plazo, heap, vigía, excepción del
  parser, topes, hilo que muere) es `unreadable_file`, terminal y **sin reintento** (la regla de ADR-030 §6 aplicada a la
  lectura); lo que causa **nuestra maquinaria** (el hilo no arranca, no carga sus bibliotecas) es un fallo de
  infraestructura que se reintenta y, agotado, deja `internal_error` (D6).
- **Reentregas acotadas**: `maxStalledCount` explícito en 1, y un job que BullMQ da por perdido por `stalled` deja el CV
  en `failed` con `internal_error` en vez de en `pending` para siempre (hueco actual del oyente de `failed`) (D8).
- **Métricas y registros sin texto del CV**: contadores y duración por formato y causa en `/metrics` del worker, y una
  línea por hilo terminado con causa, duración y tamaño (D9).
- **Pruebas con archivos patológicos generados en el propio test** (bombas de páginas, de texto y de ZIP, anidamiento
  profundo, cabeceras que mienten, expansión de entidades) y pruebas del mecanismo con scripts de hilo generados
  (bucle infinito, heap, memoria externa, salida forzada). **Ninguna muestra maliciosa real entra al repositorio** (D10).
- **La imagen publicada demuestra que lee un CV**: entrada nueva del build (`cv-extract-probe.js`), ejecutada por
  `infra/ci/verify-artifact.sh` como ya se hace con `s3-probe.js` (D11).
- **Sin variables de entorno nuevas**: los topes son constantes del código y `CV_EXTRACTION_TIMEOUT_MS` conserva nombre,
  rango y valor por defecto; pasa a ser un plazo que corta. El compose y `.env.example` no cambian (D12).
- **Lo que ve la persona no cambia**: los mismos estados y motivos de `cv/extraction` (`unreadable_file`,
  `no_text`, `internal_error`) y los mismos textos de `/mi-cv` (Q2).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `cv/extraction`: la lectura aislada con plazo que corta, los topes de contenido, la clasificación del desenlace, el
  `stalled` agotado, las métricas y la comprobación en la imagen. Modifica «Consumo idempotente de la lectura del CV»,
  «Texto extraído, normalizado y acotado» y «La lectura tiene plazo y no monopoliza el worker»; añade cuatro
  requirements.

## Impact

- **Código** (solo en `/opsx:apply`, nada aquí): `apps/worker/src/modules/cv/infrastructure/` (aislamiento, hilo,
  extractores, consumidor), `apps/worker/src/modules/cv/application/extract-cv.usecase.ts` (red exterior del plazo),
  `apps/worker/src/modules/cv/cv.module.ts`, `apps/worker/webpack.config.js` (dos entradas nuevas: el hilo y la sonda),
  `apps/worker/src/presentation/http/metrics.controller.ts` (registro compartido), `eslint.config.mjs` (lista de
  parsers que el dominio no importa).
- **Puerto de dominio**: `CvTextExtractor.extract(bytes): Promise<ExtractionAttempt>` **no cambia**, ni sus dos
  desenlaces. Tampoco `CvRepository`.
- **Dependencias**: sale `pdf-parse` (y `@types/pdf-parse`); entra `pdfjs-dist` en versión exacta (o `unpdf`, si el
  spike lo decide). `mammoth` se queda.
- **CI**: una sección más en `infra/ci/verify-artifact.sh` y su línea gemela en `infra/README.md`. Ningún workflow, ningún compose, ningún `.env.example`,
  ningún requirement de `platform/*`.
- **Datos**: ninguna migración. Los CV ya leídos conservan su texto; nadie re-extrae nada.
- **Documentación**: ADR-058 (Propuesto), anotaciones de una línea en ADR-028; README y RUNBOOK donde nombran
  `pdf-parse` (en `/opsx:apply`).

## Encaje con la fila 35

La fila 35 (35a → 35b → 35c) tiene precedencia sobre cualquier otro change (ADR-048 §Consecuencias, extendida a la fila
entera por ADR-051 §1). 35a está archivada; 35b (`staging-host`) está activa y bloqueada por decisiones del owner (pago
por uso en Oracle, Brevo); 35c (`verify-reusable-workflow`) no ha empezado. **Este change necesita una excepción para
entrar antes de 35c**, como las de ADR-053 y ADR-055, y la decide el owner (**Q1, bloqueante para `/opsx:apply`**).

Argumento para la excepción, y para fusionar **antes de invitar en 35b** (antes de su 10.7):

1. **El riesgo nace exactamente en 35b.** Hasta hoy el único que sube CV es el autor. La 10.7 de 35b invita a 3-5
   personas que buscan empleo, y el flujo crítico que esas personas recorren (lote 1 de `e2e-suite`) incluye subir un
   CV. Esperar a 35c significa abrir el parser de 2017 a los primeros archivos ajenos.
2. **Un worker colgado en staging no se cura solo** (`restart: unless-stopped`), y el host de 35b no tiene vigilancia
   que lo note: el síntoma sería que «no llegan los avisos» o «no se lee la oferta», precisamente las señales que la
   medición de 35b quiere recoger.
3. **No compite con la fila**: no toca compose, workflows, `.env.example` ni requirements de `platform/*`. Los
   únicos ficheros compartidos son `infra/ci/verify-artifact.sh` (una sección nueva, en un tramo que 35c no edita; 35c
   cambia el `--wait-timeout`) e `infra/README.md` (la misma orden en el `up` documentado, que
   `check-docs-stack-up` exige idéntico al del script). Si el owner prefiere cero solape, la sonda de la imagen (D11)
   pasa a 35c y aquí queda solo su entrada del build.

Si la respuesta es **no**, el change entra **justo después de 35c** y antes de `golden-sets-reales`, que es donde está
en `openspec-changes.yaml` mientras Q1 no tenga respuesta: la posición conservadora respeta la precedencia vigente.

## Fuera de alcance

- **Textos nuevos en `/mi-cv`** o un motivo nuevo (p. ej. «archivo demasiado complejo»): exige tocar `libs/shared`,
  i18n y el SPA; se decide con datos de 35b (Q2).
- **Límite de memoria del contenedor** (`mem_limit` del `worker` en el compose de producción): toca el compose de 35b
  y 35c; candidato para después de la fila (Q5).
- **OCR**, antivirus y re-extracción de CV ya leídos (sigue vigente ADR-028 §Alternativas descartadas).
- **Golden sets de CV en PDF reales**: no existen (los de `libs/ai/src/evals/match-cv` son texto); llegan con
  `golden-sets-reales` (fila 36). La paridad de este change se mide sobre los fixtures generados.
- **Aislar otros parsers del worker** (HTML del enriquecimiento con `cheerio`): su entrada viene de la red y ya tiene
  tope de bytes y plazo propios (ADR-022); si se mide un problema, es otro change.
