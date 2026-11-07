## Why

`cv-extract-isolation` (ADR-058) sacó la lectura del CV del proceso del worker: cada CV se lee en un proceso hijo nuevo
sin variables de entorno, con el modelo de permisos de Node, sin generación de código desde cadenas, con plazos que
cortan y con topes de entrada y de memoria. Así quedaron cerradas la **disponibilidad** (event loop, `pending` eterno)
y los **secretos**. La **superficie** sigue abierta: el PDF lo sigue leyendo `pdf-parse` 1.1.4, que trae embebido
pdf.js **1.10.100, de 2017**, que nadie va a corregir. ADR-058 lo dejó escrito como riesgo aceptado («`pdf-parse` 1.1.4
sigue sin correcciones hasta `cv-pdf-library-upgrade`»), y la partición B2-01 del debate de `cv-extract-isolation`
(2026-10-28) trasladó aquí la sustitución, con su spike, su medición de tamaño y su paridad con CV reales.

Tres hechos hacen que valga la pena el change aunque el aislamiento ya acote el daño:

1. **Las versiones de pdf.js anteriores a las correcciones de 2024 tienen fallos publicados** (por ejemplo
   CVE-2024-4367). `--disallow-code-generation-from-strings` es hoy la llave que los acota en el hijo. Con una
   biblioteca mantenida, esa llave pasa a ser la segunda barrera y deja de ser la única.
2. **Las alertas de dependencias no ven el pdf.js de `pdf-parse`**, porque va copiado dentro del paquete: un aviso
   publicado contra pdf.js no salta en el repositorio. Con `pdfjs-dist` (o `unpdf`) como dependencia directa, las
   alertas sí llegan (Q6).
3. **El costo está acotado y es medible**: la costura `PdfTextSource` (un fichero dentro del hijo) ya existe, el runner
   no sabe qué biblioteca hay detrás y la sonda de la imagen (`cv-extract-probe.js`) comprueba en `arm64` que la
   lectura funciona dentro de la imagen publicada.

## What Changes

- **Spike con criterio de parada** (design D2-D3). Primero `pdfjs-dist` (build `legacy`, versión exacta,
  `isEvalSupported: false`, sin canvas ni `Worker` anidado, sin fuentes del sistema ni URL remota, `@napi-rs/canvas`
  excluido de la instalación, cargado solo por `require(esm)`) y, si falla en (a), (b) o (c), `unpdf` como alternativa
  escrita (adoptar `unpdf`, cuyas alertas no llegan, exige además un sí del owner a Q11). Un fallo de paridad no pasa a
  `unpdf`: vuelve al debate. Una candidata se adopta si cumple cuatro condiciones:
  - (a) carga y lee dentro del hijo con sus flags, desde el bundle y desde la imagen;
  - (b) el crecimiento de la imagen del worker, medido después de la poda, no pasa el umbral de Q3;
  - (c) todas las licencias de su árbol son permisivas;
  - (d) pasa la paridad.

  **El tope es de 4 h por biblioteca** (más 2 h de esperas de build), partido en tareas de menos de una hora, con
  corte explícito. Si las dos fallan,
  `pdf-parse` 1.1.4 se queda aislado y la decisión vuelve al owner (D13).
- **Paridad** (D7):
  - igualdad exacta sobre los fixtures sintéticos;
  - recall de tokens ≥ 0,98 y el mismo orden de bloques sobre cinco PDF de productores reales, medidos dentro del
    spike: una sola fuente inventada, commiteada en texto plano y sin metadatos, que el implementador exporta con
    contenedores públicos (LaTeX, LibreOffice, dos columnas) y el owner, antes del spike, desde Word y Google Docs;
  - lo mismo sobre 5 o 6 CV reales que el owner pasa **en su máquina**, desde una terminal de PowerShell propia y con
    una orden concreta. **Solo CV cuyo origen controla el owner** (los suyos o los que generó él), porque la paridad
    corre fuera del aislamiento; **nunca se descargan del almacén de staging ni de producción**. No se commitea nada y
    se anotan solo dos líneas de agregados.
  - Se decide `disableNormalization`, y la medición del owner se repite con la candidata adoptada (PO-03, PO-08).
  - **Sin la medición del owner no hay sustitución**; la fecha límite (14 días) queda en el PR y en el manifiesto, y
    si llega sin la medición el change queda «en pausa por la 3.1».
- **Sustitución** (D4, D10):
  - `PdfTextSource` pasa a la biblioteca adoptada;
  - los dos módulos de pdf.js (el principal y el del «worker falso») se cargan, y sus CMaps y fuentes estándar se
    comprueban, **antes** de `ready`, así que una biblioteca incompleta es un fallo de maquinaria y no un
    `unreadable_file`;
  - salen `pdf-parse`, `@types/pdf-parse` y `pdf-parse-lib.d.ts`;
  - se actualizan la regla de lint de la capa de dominio y la del hijo;
  - un test comprueba que la dependencia vieja no vuelve.

  La lista de `--allow-fs-read` **no crece** si el spike confirma que los CMaps y las fuentes estándar del paquete
  están bajo la raíz de `node_modules`, que ya está permitida (D6). Si hiciera falta otra ruta, el change vuelve al
  debate con un MODIFIED del requirement de aislamiento.
- **Arranque**: el hijo carga una biblioteca más grande, así que el arranque se vuelve a medir con el criterio de
  `cv-extract-isolation` (**p95 ≤ 1,5 s en `arm64`**). La corrida `arm64` sale de `cd-staging` en modo de prueba, que
  **dispara el owner**, y la segunda medición se toma en el host de staging tras desplegar (D9).
- **Renovate** (Q6): alertas de vulnerabilidad sin aprobación del Dashboard para la biblioteca adoptada, `mammoth`,
  `@xmldom/xmldom` y `jszip`, si el owner lo aprueba (D11).
- **Los CV ya leídos no se vuelven a leer** (R6, D12): dos CV iguales subidos antes y después del cambio pueden diferir
  en el texto guardado. Lo dice una oración del requirement y se revisa sobre el diff, sin escenario propio.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `cv/extraction`: se modifica «Texto extraído, normalizado y acotado», donde el PDF pasa a leerse con un pdf.js
  mantenido. Se añaden dos requirements: «La biblioteca de PDF es un pdf.js mantenido, fijado y sin evaluación de
  código», con los escenarios «La dependencia vieja no vuelve» y «Faltan los mapas de caracteres de pdf.js», y «El
  cambio de biblioteca conserva el texto de los fixtures y no relee CV».
- `platform/workspace`: se modifica «Aislamiento de la capa de dominio», **a partir del MODIFIED de
  `cv-extract-isolation`** (`7c1d475`), que ya admite los parsers solo en `isolation/child/`. Aquí solo se suman
  `pdfjs-dist` y `unpdf` a la lista cerrada y a esa regla, y los escenarios de extractores pasan a importar
  `pdfjs-dist`.

## Impact

- **Código** (`apps/worker`):
  - `infrastructure/isolation/child/pdf-extract.ts`: implementación nueva de `PdfTextSource`;
  - `child-command.ts`: `resolveNodeModulesRoot` busca la biblioteca nueva, y un test de que nunca concede
    `--allow-addons`;
  - `cv-extract-child.bundle.spec.ts`: fija la versión de la biblioteca nueva;
  - `extractors/pdf-parse-lib.d.ts`: se borra, y sale de `tsconfig.cv-child-test.json` si lo nombra;
  - `extractors/fixtures/expected-texts.ts`: nuevo;
  - un spec de paridad temporal, que se borra al sustituir;
  - `no-pdf-parse.spec.ts`: nuevo.
- **Configuración del workspace**:
  - `package.json` y `pnpm-lock.yaml`;
  - `pnpm-workspace.yaml`, para excluir `@napi-rs/canvas`;
  - `eslint.config.mjs`, con dos patrones;
  - `tools/workspace-rules/src/workspace-rules.spec.ts`;
  - `tools/cv-fixtures/parity-source/`: la fuente inventada del corpus de productores, en texto plano (nueva);
  - `renovate.json`, si Q6 = sí.
- **Imagen**: `docker/worker.Dockerfile`, con la poda del paquete en la etapa `build` si hace falta para cumplir Q3. No
  cambian el `CMD`, el `ENV` ni la etapa `runner`.
- **Sin cambios**:
  - el puerto `CvTextExtractor`, `ExtractionAttempt`, los estados y motivos de `cv/extraction`, `libs/shared`, la API
    y el SPA;
  - las constantes de `extraction-limits.ts`, el protocolo del hijo y sus flags;
  - la lógica de `verify-artifact.sh` (solo cambia su comentario), el compose y `.env.example`.
- **Documentación**:
  - `README.md` (§ de la extracción);
  - `docs/RUNBOOK.md` («Operar los CV», con una línea sobre cómo repetir la paridad);
  - `tools/cv-fixtures/README.md`;
  - comentarios que nombran `pdf-parse` en `cv-fixtures.ts`, `apps/web-e2e/src/support/cv-files.ts`,
    `apps/web-e2e/src/cv.spec.ts`, `apps/web-e2e/src/match.spec.ts`, `cv-text-extractors.port.ts` e
    `infra/ci/verify-artifact.sh`;
  - ADR-064 (nuevo, Propuesto) y anotaciones de una línea en ADR-058 (Decisión 7) y en ADR-028 (§Consecuencias,
    «Dependencias»).

## Cuándo entra

**Después de 35c (`verify-reusable-workflow`) y de archivar `cv-extract-isolation`, sin excepción a la precedencia de
la fila 35** (ADR-048 §Consecuencias, ADR-051 §1, `scope` del manifiesto). Esta especificación se adelanta solo como
spec, en la rama `spec/cv-pdf-library-upgrade`, por pedido del owner del 2026-11-04. No se aplica ni se fusiona código
antes de esa fecha.

**La única salvedad es la de su propio alcance** (B3-03 del debate de `cv-extract-isolation`, 2026-10-28): si se
publica un fallo de pdf.js ≤ 1.10 que los flags del hijo no acotan, el owner decide si este change se adelanta. Cómo se
vigila esa condición mientras tanto es Q9 (design D1).

## Fuera de alcance

- **Cambiar `mammoth`** o su inflado con tope: siguen como los dejó `cv-extract-isolation`.
- **Re-extraer CV ya leídos** con el parser nuevo (R6, D12; ADR-028 §Alternativas descartadas).
- **OCR** de PDF escaneados.
- **Cortar la red del hijo** (`--allow-net` al subir a Node 26 LTS, Q7 de `cv-extract-isolation`) y la autenticación de
  MongoDB y Redis (`datastore-auth`).
- **Un motivo nuevo en `/mi-cv`**: Q2 de `cv-extract-isolation` se reabre solo con su disparador de la medición de 35b
  (B3-02).
- **Commitear PDF de productores reales o CV reales**, ni sus textos, nombres, hashes o metadatos (D7).
