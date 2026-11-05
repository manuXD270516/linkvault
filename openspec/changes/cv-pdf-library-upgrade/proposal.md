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
  excluido de la instalación) y, si no cumple, `unpdf` como alternativa escrita. Una candidata se adopta si cumple
  cuatro condiciones:
  - (a) carga y lee dentro del hijo con sus flags, desde el bundle y desde la imagen;
  - (b) el crecimiento de la imagen del worker, medido después de la poda, no pasa el umbral de Q3;
  - (c) todas las licencias de su árbol son permisivas;
  - (d) pasa la paridad.

  **El tope es de 4 h por biblioteca**, partido en tareas de menos de una hora, con corte explícito. Si las dos fallan,
  `pdf-parse` 1.1.4 se queda aislado y la decisión vuelve al owner (D13).
- **Paridad** (D7):
  - igualdad exacta sobre los fixtures sintéticos;
  - recall de tokens ≥ 0,98 y el mismo orden de bloques sobre PDF de productores reales (una persona inventada,
    exportada desde Word, LibreOffice, Google Docs, LaTeX y una plantilla a dos columnas);
  - lo mismo sobre 5 o 6 CV reales que el owner pasa **en su máquina**. No se commitea nada y se anotan solo
    agregados.
  - Se decide `disableNormalization`, y la medición del owner se repite con la candidata adoptada (PO-03, PO-08).
- **Sustitución** (D4, D10):
  - `PdfTextSource` pasa a la biblioteca adoptada;
  - los dos módulos de pdf.js (el principal y el del «worker falso») se cargan **antes** de `ready`, así que una
    biblioteca que falta es un fallo de maquinaria y no un `unreadable_file`;
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
  en el texto guardado.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `cv/extraction`: se modifica «Texto extraído, normalizado y acotado», donde el PDF pasa a leerse con un pdf.js
  mantenido. Se añaden dos requirements: «La biblioteca de PDF es un pdf.js mantenido, fijado y sin evaluación de
  código», con el escenario «La dependencia vieja no vuelve», y «El cambio de biblioteca conserva el texto de los
  fixtures y no relee CV».
- `platform/workspace`: se modifica «Aislamiento de la capa de dominio». La lista cerrada nombra la biblioteca de PDF
  nueva, y el escenario «La infraestructura importa un extractor de documentos» pasa al directorio del hijo aislado,
  que es donde la regla de lint de `cv-extract-isolation` (commit `628923d`) ya los permite.

## Impact

- **Código** (`apps/worker`):
  - `infrastructure/isolation/child/pdf-extract.ts`: implementación nueva de `PdfTextSource`;
  - `child-command.ts`: `resolveNodeModulesRoot` busca la biblioteca nueva;
  - `cv-extract-child.bundle.spec.ts`: fija la versión de la biblioteca nueva;
  - `extractors/pdf-parse-lib.d.ts`: se borra;
  - `extractors/fixtures/expected-texts.ts`: nuevo;
  - un spec de paridad temporal, que se borra al sustituir;
  - `no-pdf-parse.spec.ts`: nuevo.
- **Configuración del workspace**:
  - `package.json` y `pnpm-lock.yaml`;
  - `pnpm-workspace.yaml`, para excluir `@napi-rs/canvas`;
  - `eslint.config.mjs`, con dos patrones;
  - `tools/workspace-rules/src/workspace-rules.spec.ts`;
  - `renovate.json`, si Q6 = sí.
- **Imagen**: `docker/worker.Dockerfile`, con la poda del paquete en la etapa `build` si hace falta para cumplir Q3. No
  cambian el `CMD`, el `ENV` ni la etapa `runner`.
- **Sin cambios**:
  - el puerto `CvTextExtractor`, `ExtractionAttempt`, los estados y motivos de `cv/extraction`, `libs/shared`, la API
    y el SPA;
  - las constantes de `extraction-limits.ts`, el protocolo del hijo y sus flags;
  - `verify-artifact.sh`, el compose y `.env.example`.
- **Documentación**:
  - `README.md` (§ de la extracción);
  - `docs/RUNBOOK.md` («Operar los CV»);
  - comentarios que nombran `pdf-parse` en `cv-fixtures.ts`, `apps/web-e2e/src/support/cv-files.ts`,
    `apps/web-e2e/src/cv.spec.ts`, `apps/web-e2e/src/match.spec.ts` y `cv-text-extractors.port.ts`;
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
