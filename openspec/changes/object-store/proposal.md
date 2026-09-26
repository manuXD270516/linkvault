## Why

El host de staging que eligió ADR-051 (Oracle Always Free, Ampere A1) es `arm64`, y la pila **no puede arrancar en
él**: MinIO community está archivado desde febrero de 2026, sin parches ni imágenes, y nuestro espejo
(`ghcr.io/manuxd270516/linkvault-minio`, ADR-048 §8) es solo `linux/amd64`. Además, todo lo que hoy se verifica es
`amd64`: verificar una arquitectura y desplegar otra es el defecto que ADR-048 cerró. Esta es la pieza **35a** de la
fila 35 (ADR-051 §1) y va primero porque es **precondición** de 35b (`staging-host`), no una mejora. Al terminarla,
`main` sigue en «verificado sin destino».

## What Changes

- **Comprobar primero que el corredor `arm64` existe** para este repositorio privado, ejecutándolo (Docker, `mongo` y
  la imagen `arm64` de cada candidato, y si consume minutos). Si no está disponible, el change se para y pregunta.
- **Sustituir MinIO** por un almacén S3 mantenido y multiarquitectura. El producto **no se elige en este documento**:
  sale de una **matriz de requisitos ejecutada** sobre **SeaweedFS, RustFS y Garage**, por fases con parada: el primer
  día, lo barato de los tres; después, el cribado del
  resto de lo barato, candidato a candidato en el orden de la lista, que se detiene cuando el puntero ya no puede
  cambiar; y lo caro (tests reales de la app, healthcheck, tiempos), solo en el candidato que
  señala la regla. Cada celda con su salida pegada: cifrado en reposo que **protege** (el disco no muestra el CV y sí un
  control distinto, otra clave no lo lee o el almacén no arranca con ella, y la clave no está en el disco), acceso
  anónimo rechazado como falta de autenticación (nunca un «no existe»), imágenes `amd64`/`arm64` sin
  credenciales con su digest, los tests reales de la app con el SDK actual y un healthcheck de solo lectura posible. La
  regla de parada da prioridad al **cifrado nativo** de los CV; es la lectura del motivo que dio el usuario, y este la
  **confirmó el 2026-09-26**, junto con que la retención de snapshots vaya siempre por barrido (así que la expiración
  del almacén no se mide). Un **punto de revisión** a los 7 días (o al cerrar el cribado)
  presenta el estado al usuario y solo detiene el change si nadie da cifrado nativo. La evidencia vive en
  `docs/object-store-matrix/`, una ruta que no se mueve al archivar. ADR-052 recoge ya las decisiones; su sección
  «Elección» se rellena con la evidencia.
- **Salidas escritas en la spec, no improvisadas:** solo si el SSE del almacén no se ha podido demostrar con las
  pruebas de la matriz, **SSE-C desde la app**, inyectado por un
  middleware de la fábrica del cliente S3, con la clave en `.env` junto a `AI_VAULT_KEY` (la spec dice qué garantía
  cambia).
- **Retención de snapshots por barrido diario en el `worker`, siempre** (decisión del usuario del 2026-09-26): la
  expiración del almacén no se mide ni se configura; el aprovisionamiento quita cualquier regla de ciclo de vida y la
  comprobación exige que no haya ninguna y ningún snapshot de más de 31 días.
- **Aprovisionamiento por la API S3**, con un script node de un solo uso incluido en la imagen de `api` (ya trae el SDK
  y es multiarquitectura), con plazos acotados y un modo que **comprueba sin escribir** y es estricto (ninguna regla
  de ciclo de vida ni snapshots de más de 31 días; un `404` anónimo es un fallo). Sin `mc` ni la CLI de ningún proveedor.
- **Healthcheck del almacén de solo lectura**: responde si está sano y no crea nada. Aprovisionar pasa a ser un paso
  aparte del arranque documentado. **BREAKING** para quien desarrolla: el arranque local cambia de orden y el volumen
  `minio-data` deja de usarse (no hay datos que migrar).
- **Comprobación de plataformas**: un script del repositorio compara las plataformas que ofrece el registro para cada
  imagen de la pila con la del destino, con la clasificación del error medida. Una arquitectura ausente es un **defecto
  del artefacto** (`artifact`), no una avería del registro, como la clasificaría hoy `infra/ci/verify-artifact.sh`.
- **Paso a `arm64`**: `build-verify-publish` de `cd-staging` pasa a `runs-on: ubuntu-24.04-arm`; construye, verifica y
  publica la misma imagen de una sola plataforma en el mismo daemon, con la identidad por digest intacta y su falsación
  repetida en `arm64`. La verificación del artefacto comprueba además que el `worker` alcanza el almacén. `cd-prod` no
  se toca (es de 35c).
- **Plazo de arranque**: el `--wait-timeout` de 360 s, que sale de los tiempos de MinIO, se recalcula con los del
  almacén nuevo **medidos** en el corredor `arm64`, y sigue viviendo en una sola línea de `verify-artifact.sh`, que
  35b lee.
- **`/privacidad`** dice, sin jerga y en cualquier caso, que el CV se guarda cifrado y que la clave la guarda
  LinkVault aparte de los datos.
- **Traslados ejecutados, no anotados:** este change edita ya lo que 35b y 35c tienen que hacer por él (orden del
  despliegue con aprovisionamiento, `docker buildx` en el host, ficheros que viajan, aviso a los invitados, texto de la
  clase `artifact`, y el `scope` de `cd-prod`), y una tarea comprueba que siguen ahí.
- **Documentación reducida a lo que protege los CV**: generar y copiar la clave, `verify` y el enlace a la matriz y a
  ADR-052. Se retiran `infra/minio/ensure-buckets.sh` y toda referencia al espejo.
- **Pasa a un change posterior** (sin fila todavía; se propondrá al usuario al archivar este): operar el almacén sin
  `mc` —los subcomandos `ls` y `rm`, la recogida de huérfanos, el borrado manual y la tabla de síntomas del RUNBOOK—. Hasta
  entonces esas secciones del RUNBOOK quedan marcadas como **pendientes y no aplicables al almacén nuevo**, y
  «Recogida de objetos huérfanos documentada» de `cv/documents` se modifica **solo** para decir que el procedimiento
  queda pendiente hasta ese change, de modo que no contradiga a `platform/object-store`. Motivo: sin usuarios nadie
  las ejecuta, y reescribirlas eran tres tareas que no protegen ningún CV.

## Capabilities

### New Capabilities

- `platform/object-store`: lo que LinkVault exige a su almacén de objetos sin nombrar un producto: uso solo por la API
  S3 para arrancar, desplegar y verificar, aprovisionamiento idempotente y acotado separado de la salud, modo de
  comprobación estricto, healthcheck de solo lectura, sin acceso anónimo, imagen mantenida, fijada y multiarquitectura,
  y elección justificada con evidencia ejecutada.

### Modified Capabilities

- `platform/production-deploy`: «Compose de producción» deja de decir «MinIO por defecto» y el arranque documentado
  incluye aprovisionar el almacén; **ADDED** «Las imágenes de la pila se pueden descargar en la arquitectura del
  destino», con su alcance (staging desde 35b, producción desde 35c).
- `platform/ci-pipeline`: «CD a staging en main» exige verificar en la arquitectura del destino, clasifica la
  arquitectura ausente como defecto del artefacto, verifica el almacén aprovisionado y que el `worker` lo alcanza. Orden
  de archivo **35a → 35c**: 35c redacta su MODIFIED sobre este texto.
- `platform/local-environment`: «Infraestructura con un comando» (almacén genérico, healthcheck de solo lectura y
  aprovisionamiento en el mismo comando) y «Meilisearch solo bajo el perfil search» (sin nombrar MinIO).
- `cv/documents`: «Bucket de CV cifrado en reposo en producción» (SSE del almacén o, como salida, SSE-C con la garantía
  que cambia escrita; la demostración incluye el control, otra clave y la búsqueda de la clave), «Retención de
  snapshots de enriquecimiento» (barrido diario del `worker`, siempre; una regla del almacén no se configura sin medir
  su expiración en un change posterior) y «Recogida
  de objetos huérfanos documentada» (el procedimiento queda pendiente hasta el change posterior de operación, con su
  sección del RUNBOOK marcada).
- `platform/demo-seed`: «Seed de demostración idempotente» deja de nombrar MinIO.

## Impact

- **Compose:** `docker-compose.yml` y `docker-compose.prod.yml` (servicio, imagen por variable, volumen, healthcheck,
  endpoint S3 de `api` y `worker`); se borra `infra/minio/ensure-buckets.sh`.
- **Código:** `apps/api` (fábrica del cliente S3, `s3-cv-file.store`, `s3-cv-user-prefix.deleter`, script
  `object-store` y su punto de entrada en el build, mensaje del seed), `apps/worker` (fábrica del cliente S3,
  `s3-cv-file.reader`, `s3-snapshot.store`, punto de entrada `s3-probe`), `apps/web` (texto de `/privacidad`);
  el barrido de snapshots en `worker` y, condicionalmente, el middleware SSE-C en las dos fábricas.
- **CI:** `.github/workflows/cd-staging.yml` (runner `arm64`, plataforma del destino), `infra/ci/verify-artifact.sh`
  (servicios, plataformas, aprovisionamiento, lectura del `worker`, plazo), `infra/ci/report-cd-outcome.sh` (texto de
  la clase `artifact`), `infra/ci/verify.env`, script nuevo `infra/deploy/check-image-platforms.sh` y la comprobación
  `docs-stack-up` de `tools/repo-checks`, que pasa a exigir también las órdenes de aprovisionamiento. Un workflow
  temporal de prueba del corredor `arm64`, que no queda en el repositorio.
- **Documentación:** `infra/README.md`, `docs/RUNBOOK.md` (comprobación con `verify` y secciones pendientes marcadas),
  `README.md`, `.env.example`, **`docs/object-store-matrix/`** (registro de la matriz y sus scripts, ruta estable),
  **ADR-052** (creado en el debate, con la «Elección» por rellenar) y anotaciones en ADR-006, ADR-022, ADR-028, ADR-033
  D5 y ADR-048 §8.
- **Otros changes (ya editados, y en el mismo PR):** `staging-host` (design D4, D5, D7 y D15; tareas 1.1, 2.1-2.2, 4.1,
  4.4, 5.3 y 9.10; su spec de `ci-pipeline` y su proposal), el `scope` de `object-store` y el de
  `verify-reusable-workflow` en `openspec-changes.yaml`, y la fila 35a de `docs/design-v0.2.md`. El PR tiene base en
  `main`, que ya contiene la planificación de `staging-host` (#65).
- **Dependencias:** ninguna nueva de npm; una imagen de terceros sustituye a otra. Los minutos de CI en `arm64`, si
  cuentan, salen del plan gratuito.
