## Context

Motivación: ver `proposal.md`. Esta es la pieza **35a** de la fila 35 (ADR-051 §1). Aquí, solo el estado que condiciona
el cómo, leído en el repositorio el 2026-09-26:

- **Los dos composes** declaran `minio` con `image: ${MINIO_IMAGE:-ghcr.io/manuxd270516/linkvault-minio}:${MINIO_IMAGE_TAG:-RELEASE.2025-09-07T16-13-09Z}`,
  un espejo solo `linux/amd64` (ADR-048 §8). `api` y `worker` dependen de su `service_healthy`.
- **El healthcheck de MinIO aprovisiona.** En desarrollo, un `CMD-SHELL` con `mc mb` e `mc ilm rule import`; en
  producción, `sh /ensure-buckets.sh` (`infra/minio/ensure-buckets.sh`), que además hace `mc encrypt set sse-s3` con
  `MINIO_KMS_SECRET_KEY`. ADR-022 §10 lo decidió así porque, **medido entonces**, `docker compose up -d --wait` daba por
  fallido un contenedor de un solo uso que terminaba bien. En desarrollo el bucket de CV **no** se cifra hoy.
- **La readiness de `api` y `worker`** mira mongo y redis, no el almacén (`infra/ci/verify-artifact.sh`, cabecera): que
  los procesos sepan hablar con S3 no lo comprueba nada en CI.
- **Cuatro adaptadores crean su propio `S3Client`** con `forcePathStyle: true`, sin política de checksums y sin plazos:
  `apps/api/src/modules/cv/infrastructure/s3-cv-file.store.ts`,
  `apps/api/src/modules/users/infrastructure/s3-cv-user-prefix.deleter.ts` (lista y `DeleteObjects` por lotes de 1000),
  `apps/worker/src/modules/cv/infrastructure/storage/s3-cv-file.reader.ts` y
  `apps/worker/src/modules/enrichment/infrastructure/storage/s3-snapshot.store.ts`. El único test contra un almacén real
  es `s3-cv-file.local.spec.ts` del `worker`, encendido a mano con `CV_MINIO_LOCAL=1`. `@aws-sdk/client-s3` está en
  `^3.1134.0`.
- **`infra/ci/verify-artifact.sh`** levanta `mongo redis minio api worker web` con `--wait-timeout 360`, un número que
  sale de encadenar MinIO (20 + 12×10 = 140 s) con `api`/`worker` (60 + 12×10 = 180 s) más un 12 %. Descarga aparte las
  imágenes de terceros con tres reintentos y, si agota los intentos, falla con clase `environment` (líneas ~155-168):
  hoy una imagen sin la arquitectura del corredor («no matching manifest») se publicaría como **avería del registro**.
- **`tools/repo-checks`**: `compose-healthchecks` exige healthcheck en **todo** servicio de `docker-compose.prod.yml`, y
  `docs-stack-up` compara la línea `up` del bloque marcado de `infra/README.md` con la de `verify-artifact.sh`
  (fichero, servicios, `--wait`, `--wait-timeout` leído de `WAIT_TIMEOUT="${VERIFY_WAIT_TIMEOUT:-<n>}"`, `--pull never`).
- **`cd-staging` → `build-verify-publish`** corre en `ubuntu-24.04`, construye con `docker/build-push-action` (`load:
  true`, caché `gha` con `scope=api|worker|web`, los mismos que `cd-prod`), verifica con `verify-artifact.sh` y publica
  con `publish-artifact.sh` (identidad por digest, ADR-048 §4). `cd-prod` usa los mismos tres scripts.
- **El RUNBOOK y `infra/README.md` operan el almacén con `mc`** (`mc ls`, `mc anonymous get`, `mc ilm rule ls`, `mc
  find`, `mc rm --recursive`), igual que el comentario de `libs/shared/src/cv/cv-file-key.ts:11`, y
  `apps/api/src/seed/seed-demo.runner.ts` nombra MinIO en un mensaje (~142) y en un comentario (~401).
- **`/privacidad`** dice «cifrado en reposo del proveedor (SSE-S3 o equivalente)» (`privacy.cv.encryption`): jerga, y
  además falsa en cuanto el almacén deje de ser un proveedor.
- **35b (`staging-host`) da por hechos** (su design, «Lo que 35a entrega»): la pila sin MinIO con imagen `arm64`,
  `build-verify-publish` en `ubuntu-24.04-arm`, un script de comprobación de plataformas que su `deploy.sh` invoca desde
  el host (donde **no hay `node`**, solo Docker) y el plazo en la línea `WAIT_TIMEOUT=…` de `verify-artifact.sh`, que su
  corredor extrae con una expresión regular.
- **Corredores `arm64` en repositorios privados:** el anuncio de GitHub del 2026-01-29 dice que existen para
  repositorios privados. **No se ha ejecutado nada en ellos desde este repositorio**; la tarea 1.2 lo ejecuta antes de
  la matriz.

## Goals / Non-Goals

**Goals:**

- Que el almacén se elija **con salidas pegadas, no con opiniones**, y que la matriz no pueda aprobar algo que solo parece
  cumplir (ADR-048 §7: una comprobación que no puede fallar no es una comprobación).
- Que el cifrado de los CV se demuestre **protegiendo**, no solo «sin texto en claro»: sin la clave correcta, el CV no
  se lee.
- Que ningún paso del arranque, del despliegue ni de la verificación dependa de un producto de almacén concreto.
- Que `cd-staging` verifique y publique `linux/arm64` en un corredor nativo con la identidad por digest intacta, y que
  una arquitectura ausente se diga como lo que es.
- Que cada guardia permanente nuevo se vea caer una vez, y cada texto se compruebe con una orden de un solo uso.

**Non-Goals:**

- Elegir el producto en este documento (D1). La sección «Elección» de ADR-052 queda vacía hasta la tarea 6.1.
- Mantener el espejo de MinIO, migrar objetos (no hay usuarios) y el host (35b).
- **Operar el almacén sin `mc`** (listar, borrar un objeto o un prefijo, recoger huérfanos): pasa a un change posterior
  (D12). Aquí solo se garantiza que arrancar, desplegar y verificar no lo necesitan.
- `cd-prod`: su runner, su modo de corrida y su plazo literal son de 35c. Sí hereda, sin tocar su YAML, lo que cambia en
  los scripts compartidos (D9).
- Credenciales separadas para administrar el almacén y para la aplicación (hoy son las mismas; ver Riesgos).
- Cambiar el healthcheck de mongo, que también inicia el replica set: Q10 de `staging-host` decidió dejarlo.
- Subir la versión de `@aws-sdk/client-s3`: la matriz prueba **la que hay**.

## Decisions

### D1. El candidato lo elige una matriz ejecutada por fases, no este documento

Candidatos en este orden: **SeaweedFS → RustFS → Garage**. **MinIO** no es candidato ni se le pasa la matriz entera:
sirve de **control del arnés** (tareas 2.6-2.11). Con el cifrado configurado, es el caso en el que el método de C5
**tiene que** detectar cifrado; ese método falló dos veces en este debate, y un método que no se ha visto acertar sobre
un cifrado conocido no puede suspender a nadie. Su estado de archivado ya está citado en `proposal.md` y no se vuelve a
medir.

Pre-lectura: [`docs/object-store-matrix/prelectura.md`](../../../docs/object-store-matrix/prelectura.md) (documentación
oficial y código fuente de los tres, leídos el 2026-09-26) **ordena el cribado, no aprueba celdas**: anticipa qué celda
decidirá en cada candidato, pero toda celda sale de una orden ejecutada con su salida pegada.

| Celda | Qué se ejecuta | Tipo |
|---|---|---|
| **C1** Imágenes | `docker buildx imagetools inspect <img>:<tag>` muestra `linux/amd64` y `linux/arm64`; tras `docker logout <registro>`, `docker pull --platform linux/amd64` y `--platform linux/arm64` terminan bien. Se anota el digest del índice. | dura |
| **C2** Mantenido | la **API de la forja oficial** de cada proyecto: repositorio no archivado y una versión publicada en los últimos 12 meses; licencia anotada. SeaweedFS y RustFS: `gh api repos/<owner>/<repo>` (`archived: false`) y `gh api repos/<owner>/<repo>/releases/latest` (`published_at`). Garage (Forgejo): `curl -s https://git.deuxfleurs.fr/api/v1/repos/deuxfleurs/garage` (`archived`) y `curl -s 'https://git.deuxfleurs.fr/api/v1/repos/deuxfleurs/garage/releases?limit=1'` (`published_at`). | dura |
| **C3** Sin CLI del producto | juzga **solo credenciales, buckets y objetos por la API S3**: el contenedor arranca con credenciales **por variables**, sin fichero con secretos, `object-store provision` (D4) crea los buckets y los objetos se escriben y se leen, todo sin la CLI del producto ni su API de administración; si alguna de las tres cosas las exige, la celda falla. Un paso de CLI, de API de administración o un **proceso extra** que **solo** necesiten el cifrado por defecto o la expiración **no** la suspende: deja esa forma en `no disponible` (C5 pasa a SSE-C; la expiración del almacén no se usa), se anota con su salida y **nunca** entra en los composes. Si `PutBucketEncryption` se rechaza, o solo se puede poner con la CLI, C5 nativo queda `no disponible` y C3 no falla. | dura |
| **C4** Sin acceso anónimo | tras aprovisionar, `object-store verify` (D4) hace `GET` de objeto, listado y `PUT` **sin firmar** contra los dos buckets y exige en cada una un rechazo: `401` o `403`, o un `400` cuyo `<Code>` sea de la familia de autenticación (`AccessDenied`, `MissingSecurityHeader`, `AuthorizationHeaderMalformed`, `InvalidAccessKeyId`, `SignatureDoesNotMatch`), siempre sin bytes del objeto. Un `2xx`, un `404` o cualquier otra respuesta son fallo. Un `verify` que falla **solo** por el cifrado o por la configuración de ciclo de vida no cuenta contra C4. Además, `verify` se ejecuta contra el arranque **sin identidades** del candidato y **tiene que salir ≠0 nombrando el acceso anónimo** (si sale 0, el defecto es de `verify`); si el producto no tiene modo abierto, «no aplica». | dura |
| **C5** Cifrado que protege | ver D2. Forma nativa: `nativo` (cifrado por defecto del bucket con las tres pruebas de D2), o `no disponible`, `no concluyente` o `falla` (una prueba muestra que la clave no protege), que dejan la forma (1) de `cv/documents` sin demostrar y obligan a probar SSE-C. SSE-C: `salida` (con las mismas pruebas), `no concluyente`, `falla` o `falla (TLS)` (subtipo aparte, D2). C5 se corta en la primera prueba ejecutada que decide. | dura, con salida |
| **C6** Expiración | **No se mide** (decisión del usuario, 2026-09-26): la retención de snapshots va siempre por el barrido diario del `worker` (D7), que solo necesita listar y borrar, lo que ya cubre C7. En la matriz queda con «no medido: retención por barrido, decisión del usuario 2026-09-26», para no renumerar C7-C9. | no medida |
| **C7** Tests reales de la app | las suites de contrato de D3 contra el candidato, con el SDK instalado (versión anotada con `node -e "console.log(require('@aws-sdk/client-s3/package.json').version)"`), **primero con la política de checksums por defecto** y, si falla por checksums, con `WHEN_REQUIRED`. Incluye el borrado por prefijo con más de 1000 claves. | dura |
| **C8** Healthcheck de solo lectura | una orden disponible **dentro de la imagen** (shell con cliente HTTP, o un subcomando del binario en forma `CMD` sin shell) que sale 0 con el almacén sirviendo, sale ≠0 apuntada a un puerto sin servicio, y tras diez ejecuciones deja la lista de buckets igual (vacía). | dura |
| **C9** Tiempo hasta sano | tres arranques en frío, tiempo hasta `healthy` leído de `docker inspect --format '{{json .State.Health}}'`. Informa D8; no aprueba ni suspende. | medida |

**Ejecución por fases.** Las celdas baratas se ejecutan a los tres a la vez; las caras, solo donde la regla lo pide.

1. **Día 1:** C1 y C2 de los tres (tarea 1.4), con las versiones que fijó la 1.2 al probar el corredor `arm64` y el
   digest del índice de cada uno anotado.
2. **Arnés y control de MinIO (2.1-2.11)**; en los huecos (esperas de corredores y de CI, y la de la respuesta del
   usuario si la 4.1 bloquea), **lo que no depende del producto** (2.12-2.17: comprobación de los traslados, texto de
   `/privacidad`, medición y script de la comprobación de plataformas, texto de la clase `artifact` y comentarios de
   los workflows).
3. **Cribado C3-C5 candidato a candidato (grupo 3), en horas**, con el arnés del grupo 2 y el almacén en el `9000`, en
   el orden de la lista y **deteniéndose cuando el puntero ya no puede cambiar**: el primero que pasa C1-C4 con C5
   `nativo` fija el puntero, porque nadie que vaya detrás en la lista puede adelantarlo. Primero SeaweedFS (3.1 y 3.4);
   si pasa C1-C4 con C5 `nativo`, se va directo a C7-C9 (4.2-4.4) y las celdas C3-C5 de RustFS y Garage (3.2, 3.3, 3.5
   y 3.6) se cierran como «no ejecutado: puntero fijado en SeaweedFS». Solo si SeaweedFS cae se criban los demás, en el
   orden de la lista y con la misma regla; si el fijado cae después en C7 o C8, el cribado se reanuda con el siguiente.
   El compose de cada candidato se escribe en su propia tarea de C3-C4 (3.1, 3.2, 3.3), así que el de RustFS y el de
   Garage solo existen si el cribado llega a ellos.
4. **C7-C9 solo en el candidato que señala el puntero (grupo 4)**, pasando al siguiente solo si falla una celda dura.
5. **Veredicto de los tres en una tarea (5.3)**, en cuanto el candidato elegido tiene C7-C9. Lo que sigue no va en el
   orden de la numeración (Migration Plan): el modo de cifrado, el compose de desarrollo y C5 repetido sobre él van
   **antes** de escribir ADR-052 «Elección» y los traslados.

**Forma de los composes de la matriz** (`docs/object-store-matrix/<candidato>.compose.yml`, tareas 3.1-3.3, y el del
control de MinIO, 2.6). Servicio `object-store`, credenciales solo por variables, la clave del cifrado desde
`OBJECT_STORE_SSE_KEY` mapeada a la variable del producto, y **todo el estado del almacén en un solo volumen con
nombre**, sin `name:` explícito: ningún bind montado con escritura, y un fichero de configuración sin secretos, si
hace falta, montado solo
de lectura. Así el `tar` de C5 es todo lo que el almacén guarda, y (c) no puede pasar porque la clave viva en otro
sitio; `c5.sh` sale con 2 si `docker compose config` muestra en el servicio más de un volumen, un bind escribible o un
volumen con `name:` explícito (la copia de (b) seguiría montando el original).
Ningún paso que solo necesiten el cifrado o la expiración (C3) entra en ellos. Su servicio es el que se copia a los
composes de la pila (D2, «Lo que se entrega es lo que se midió»).

**Regla de parada** — *lectura del motivo que dio el usuario («el cifrado de los CV es lo último que conviene
rebajar»), **confirmada por el usuario el 2026-09-26** junto con la retención por barrido («Sí, adoptemos el
barrido»); la tarea 1.1 lo anota como precondición cumplida; ver Open Questions.*

- **Cumple todo** = pasa las celdas duras (C1-C4, C7, C8) **y C5 sale `nativo`**. La expiración de snapshots va
  **siempre** por el barrido del `worker` (D7), así que C6 no se mide: el motivo del usuario es el cifrado, no la
  expiración.
- **Puntero** (dónde se gastan C7-C9), entre los que pasan C1-C4: primero los de C5 `nativo`; después, el orden de la
  lista.
- El primero del puntero que **cumple todo** se elige y se deja de buscar.
- **C6 no interviene**: no se mide, así que no mueve el puntero, no decide la elección ni hace ejecutar ninguna celda
  en otro candidato. El desempate por C6 de la iteración 2 ya se había borrado en la iteración 3, y el modo de
  retención ya no depende del elegido.
- **La forma nativa de C5 en `no disponible`, `no concluyente` o `falla` obliga a probar SSE-C** (tarea 3.8) en ese
  candidato cuando el puntero llega a él: es la forma (2) de `cv/documents`, válida solo si la (1) no se ha podido
  demostrar con estas pruebas. Si SSE-C también sale `no concluyente`, el candidato queda **descartado**; si SSE-C se
  rechaza, C5 = `falla` y también. Un rechazo por falta de TLS se registra como **`falla (TLS)`**, un subtipo aparte
  que descarta igual pero que la 4.1 y la 5.3 presentan al usuario con su coste (D2, «SSE-C y TLS»).
- **Si ninguno cumple todo**, se elige el primer **apto con salida** (duras + C5 = `salida`) del puntero. **Si ninguno
  es apto**, el change **se detiene** y vuelve al usuario con la matriz: no se relaja una celda dura para que alguien
  pase.

**Punto de revisión (tarea 4.1).** A los **7 días naturales** desde que empieza la 2.1, o al quedar **fijado el
puntero** (3.7: en el primer candidato con C5 `nativo`, o tras cribar los que quedaban), lo que ocurra antes, se
presenta al usuario: quién da C5 `nativo` entre los cribados, qué cuesta SSE-C si hace falta (las tareas 8.1-8.4, la
clave que hay que custodiar y si la salida existe según la 2.9b), una fecha estimada de cierre y, si algún candidato
quedó en `falla (TLS)`, el coste de meter TLS interno como decisión suya. **Solo bloquea si ningún candidato da C5 `nativo`**: entonces
el change se para hasta su respuesta, y la espera se llena con 2.12-2.17 si quedan. Si alguno lo da, se informa y se
sigue.

**Peor caso en cifras** (días naturales desde la tarea 1.1, a unas seis tareas de ≤ 1 h por día de trabajo; **R** es lo
que tarde el usuario en responder al punto de revisión cuando bloquea):

| Hito | Peor caso | Por qué |
|---|---|---|
| Línea base, corredor `arm64` y C1-C2 de los tres (1.1-1.4) | día 1 | |
| Arnés y control de MinIO (2.1-2.11 y 2.9b, 12 tareas) | días 1-3 | empieza en el hueco del día 1 |
| Cribado C3-C5 de los tres, control positivo de SSE-C y SSE-C en los tres (3.1-3.8 y 3.7b, hasta 11 ejecuciones: el cribado no se detiene porque nadie da C5 `nativo`) | días 4-5 | |
| Punto de revisión (4.1), **bloqueante** porque nadie da C5 `nativo` | día 5, + R | |
| Lo que no depende del producto (2.12-2.17, 6 tareas) | día 6, dentro de R | en el peor caso no hay otro hueco; si R ≤ 1 día, lo llenan y R no suma |
| C7-C9 en los tres candidatos (fallo duro en los dos primeros, 9 ejecuciones) | días 7-8 | |
| **Veredicto (5.3)** | **día 8** | |
| Resto del change con todas las salidas (grupos 6-13, 37 tareas, con el barrido 8.5-8.7 siempre) | + 6 días | |
| **Cierre del change** | **unos 14 días naturales, + (R − 1) si R pasa de un día** | sin contar la espera de la ventana de fusión (13.4) |
| **Caso probable** (según `prelectura.md`, que no aprueba celdas): SeaweedFS con C5 `nativo` | **veredicto el día 4, cierre en unos 10-11 días** | el cribado se detiene en SeaweedFS (3.1 y 3.4), la 4.1 informa sin bloquear y C7-C9 van solo en él (unas 24 tareas hasta el veredicto); después, unas 32 tareas: el grupo 8 hace el barrido (8.5-8.7) y cierra 8.1-8.4 y 8.8 como «no aplica» |

Dejar de medir C6 no mueve el peor caso: la espera de la expiración nunca estuvo en su camino crítico, que pasa por el
cribado de los tres, la respuesta al punto de revisión y C7-C9 en los tres. Sí adelanta un día el veredicto del caso
probable, que antes esperaba a esa lectura aunque SeaweedFS hubiera cumplido todo el día 4. Sin salidas y con el primer
candidato cumpliendo todo: la 4.1 informa sin bloquear, veredicto el día 4 y cierre en unos 10-11 días (unas 32
tareas tras el veredicto, más 2.12-2.17 si no encontraron hueco antes). Adelantar 2.12-2.17 no acorta el total cuando
no hay huecos: los saca del tramo posterior al veredicto y llena la espera de R.

**Dónde queda la evidencia.** Cada orden y su salida, pegadas en `docs/object-store-matrix/matriz.md` (se crea en 1.1),
con los ficheros del arnés en el mismo directorio (un compose por candidato cribado, los del control de MinIO,
`find-plaintext.mjs`, `c5.sh` y `list-buckets.mjs`) y la pre-lectura (`prelectura.md`), que no es evidencia
de ninguna celda. `matriz.md` termina con la sección «Configuración entregada» (D2): la lista cerrada de claves, el digest
comprobado, la orden que genera la clave, las comparaciones de servicios y C5 repetido sobre `docker-compose.yml`; y con
la sección «Retención por barrido», con el barrido ejecutado contra el almacén elegido (tarea 8.7). Es una ruta **estable** desde el día 1: no vive bajo
`openspec/changes/object-store/`, que se mueve al archivar, así que el enlace de `infra/README.md` no se rompe. El
resultado y su porqué, en la sección «Elección» de **ADR-052**, creado en el debate con estas decisiones.
`infra/README.md` enlaza ambos (`platform/object-store`, «La elección del almacén se justifica con evidencia
ejecutada»).

*Alternativas descartadas:* elegir por documentación (la afirmación «soporta SSE» es la que hay que medir); evaluar los
tres enteros en paralelo (C7-C9 cuestan tareas que la regla puede no necesitar); evaluarlos en serie completos (C7-C9 en los tres aunque el primero cumpla todo); **medir la expiración del almacén (C6) y
usarla cuando se observara**: el usuario decidió el 2026-09-26 no medirla, porque el barrido cubre la retención sin
depender del producto y una regla sin medir sería una comprobación decorativa (ADR-048 §7).

### D2. La celda que se puede aprobar sin estar cumplida

**C5, cifrado.** Una respuesta de la API que dice «AES256» no demuestra que el disco esté cifrado, y un disco sin texto
en claro no demuestra que la clave proteja nada. El método, que valida primero el control de MinIO (tareas 2.9-2.10):

1. **Cuatro buffers aleatorios e independientes** (no comprimibles): **A1** (1 MiB) y **A2** (1 KiB) al bucket de CV;
   **B1** (1 MiB) y **B2** (1 KiB), **distintos** de los anteriores, al de snapshots, que no se cifra. El de 1 KiB
   existe porque hay almacenes que guardan los objetos pequeños **en línea, dentro de los metadatos**, por otro camino
   que los grandes: Garage lo hace por debajo de su `INLINE_THRESHOLD`, de unos 3 KiB (**a confirmar al medir**), así
   que un par de 4 KiB habría ido por el camino de los grandes y no habría probado nada. Los escribe la suite de contrato de `api` en modo C5 (`S3_CONTRACT_C5_DIR=<tmp>`): A1 y A2 con el
   **adaptador real** `s3-cv-file.store` **sin cabeceras SSE**, porque lo que se prueba es el cifrado por defecto del
   bucket, que es de lo que depende producción; B1 y B2 con el cliente de la fábrica. *(Desde D17, el adaptador manda
   `ServerSideEncryption` en cada subida, así que A1 y A2 van con el cliente de la fábrica, igualmente sin cabeceras
   SSE: lo que se prueba sigue siendo el cifrado por defecto del bucket.)* La suite vuelca los cuatro
   buffers a ficheros en `<tmp>`.
2. **`docker compose stop`** del almacén (cierra ficheros y vacía búferes) y copia del volumen fuera del contenedor:
   `docker run --rm -v <volumen>:/d:ro -v <tmp>:/out alpine tar -C /d -cf /out/vol.tar .`.
3. **`find-plaintext.mjs`** busca en el `tar` tres ventanas de 64 bytes de **cada** buffer, en desplazamientos
   distintos, e informa de cada uno **por separado** (`A1 0/3`, `B1 3/3`…). Busca también **los bytes de la clave**:
   la clave decodificada y su forma textual tal como va en el fichero de entorno. Se usa `node` y no `grep` porque el
   proxy de la shell altera la salida de `grep`.
4. **Lectura del disco:** B1 y B2 **tienen que aparecer** (3/3 cada uno); si alguno no aparece (fragmentación,
   compresión, codificación por borrado), el método no vale para ese producto y la celda queda **no concluyente**, que
   no es un aprobado. A1 y A2 **tienen que faltar** (0/3 cada uno); una ventana encontrada es texto en claro.

**C5 se corta en la primera prueba ejecutada que decide** (iteración 3): si el almacén rechaza el cifrado por defecto
del bucket (`PutBucketEncryption`), o solo lo acepta con su CLI, la forma nativa es `no disponible` sin ejecutar más; si
A1 o A2 aparecen en el disco, es `falla` sin ejecutar (a)-(c). **Siempre con la salida pegada, nunca por lo que diga
la documentación**, tampoco la de `prelectura.md`.

C5 = **`nativo`** exige, además de la lectura del disco, **tres pruebas de que la clave protege**:

- **(a) Con la clave en el entorno, el producto usa esa.** El compose la pasa desde `OBJECT_STORE_SSE_KEY` (o la
  variable equivalente del producto, mapeada en su bloque `environment`). Lo demuestran (b) y (c): si el producto
  cifrara con una clave propia e ignorara la del entorno, cambiar esta no cambiaría nada en (b), y la suya estaría en el
  volumen, donde la busca (c). Lo que el producto haga **sin** clave se anota como **observación**, no decide la celda:
  en producción ya lo impide el `${OBJECT_STORE_SSE_KEY:?…}` del compose (D6) y, en todos los entornos, el guardia de
  arranque del servicio (D16, decisión del usuario del 2026-09-27, tras medir en la 3.4 que SeaweedFS genera una clave
  propia en el volumen). Esa observación se hace sobre un **volumen vacío** nuevo, nunca sobre el de la prueba.
- **(b) Otra clave no lee el CV.** Siempre sobre una **copia** del volumen restaurada desde el `tar` del paso 2 (el
  volumen original no se toca: un almacén que reescriba sus metadatos al arrancar con otra clave no puede estropear la
  evidencia). Con otra clave **K2** sobre esa copia valen **dos** resultados:
  - **b1:** arranca; el `GET` de A1 se rechaza **sin devolver bytes** y el de B1 funciona; con la clave original **K1**
    sobre la misma copia, A1 vuelve idéntico por bytes.
  - **b2:** **no arranca**, y su log nombra un error de clave o de descifrado (se pega la línea); con **K1** sobre
    **esa misma copia**, arranca y A1 y B1 vuelven idénticos por bytes.

  Cualquier otro resultado es **`falla`** (A1 se lee con K2, o con K1 A1 o B1 no vuelven idénticos) o **`no
  concluyente`** (con K2 no arranca sin que el log nombre la clave, o arranca y B1 no se lee). En el control de MinIO
  se espera b2, y la tarea 2.10 solo se para si no sale ninguno de los dos.
- **(c) La clave no está en el disco.** `find-plaintext` no encuentra los bytes de la clave en el `tar`.

`docs/object-store-matrix/c5.sh <compose> <volumen>` encadena 1-4 y (b)-(c) para que cada candidato cueste una tarea.
Lee K1 del compose **resuelto** (`docker compose config --format json`), en la entrada de `environment` del servicio
`object-store` cuyo valor sin interpolar (`--no-interpolate`) referencia `OBJECT_STORE_SSE_KEY`, y sale con 2 si no
hay exactamente una o si queda vacía: la clave medida es la que el compose entrega, no la de la shell. Nombra siempre
ese servicio (`stop object-store`, `up -d --no-deps object-store`), así que en un compose de varios servicios, como
`docker-compose.yml`, no toca los demás; y sale con 2 si el volumen tiene `name:` explícito.

Si el cifrado por defecto no existe (`no disponible`: el almacén lo rechaza, solo se puede poner con su CLI o su API
de administración, o necesita un proceso extra; nada de eso suspende C3 ni entra en los composes, D1) o el resultado de
la forma nativa es `no concluyente` o `falla` —es decir, si la forma (1) de `cv/documents` no se ha podido demostrar
con estas pruebas—, se prueba **SSE-C** con el SDK contra el endpoint `http://` de la red interna (ver «SSE-C y TLS»,
abajo). SSE-C pasa por **las mismas pruebas**:
lectura del disco con A escrito con la clave; (a) la clave llega por `S3_CV_SSE_C_KEY`, validada al arrancar; (b) un
`GET` sin clave y otro con una clave distinta se rechazan, B1 se lee, y con la clave correcta A1 se lee; (c) ni la clave
de 32 bytes ni su base64 están en el `tar` (un almacén que guardara la clave del cliente no cifraría nada). Resultado
`salida`, `no concluyente`, `falla` o `falla (TLS)`.

**SSE-C y TLS** (iteración 3). Hay servidores que rechazan SSE-C sin TLS (MinIO lo exige) y clientes que se niegan a
enviarlo por `http://`, y la red interna del compose habla HTTP. Se mide el día 2, no cuando haga falta (tarea 2.9b):

- **(i)** la suite de contrato de `api` tiene un modo que escribe A1 y A2 **con SSE-C** y exige en la respuesta el eco
  de `SSECustomerKeyMD5`: un almacén que ignore las cabeceras no lo devuelve;
- **(ii)** `c5.sh --sse-c` encadena las pruebas de arriba y clasifica un rechazo del servidor que nombre TLS o una
  conexión segura como `falla: TLS del servidor`;
- **(iii)** contra el servidor HTTP en proceso de la tarea 2.5, un test dice si el SDK instalado **envía** SSE-C por
  `http://` o **lanza** sin enviar. Si lanza, la salida SSE-C **no existe para ningún candidato**, y la 4.1 lo sabe el
  día 2;
- **(iv)** contra el control de MinIO por `http://`, `c5.sh --sse-c` tiene que salir con `falla: TLS del servidor`:
  es el control negativo de la clasificación;
- **(v) control positivo, condicional** (tarea 3.7b): solo si la salida SSE-C va a medirse en un candidato (3.8), el
  mismo MinIO con TLS autofirmado (certificado generado con `openssl` en `alpine` y montado `:ro` en
  `/root/.minio/certs`) y `c5.sh --sse-c --ca <pem>` (con `NODE_EXTRA_CA_CERTS`) por `https://` tiene que salir
  `salida`: un método que solo se ha visto fallar no puede suspender a nadie.

Un rechazo por TLS (del servidor o del SDK) se registra como **`falla (TLS)`**, un subtipo aparte de `falla`. Descarta
igual, pero la 4.1 y la 5.3 lo presentan al usuario con el coste de meter TLS interno en la red del compose, como
**decisión suya**: no es relajar la celda, es **otra configuración**, que exigiría repetir C5 sobre ella. Si el elegido
es RustFS, su `RUSTFS_SSE_C_REQUIRE_TLS=false` se fija **de forma explícita** en su compose de la matriz y en los dos de
la pila, para que un cambio de su valor por defecto no cambie en silencio lo medido (la comparación de servicios de
abajo, que exige idénticos los valores de `environment` salvo una lista cerrada, lo comprueba). Y la lectura con la que
el `worker`
demuestra en la verificación del artefacto que alcanza el almacén (`s3-probe`, tarea 7.5) va al **bucket de CV** a
través de la fábrica, la que lleva el middleware SSE-C: un almacén que pase a exigir TLS rompe el CD, no la primera
lectura de un CV en staging.

**Lo que se entrega es lo que se midió** (iteración 3). Las pruebas de C5 salen de los composes de la matriz, y los
servicios de los composes de la pila se escriben después (tareas 7.1 y 7.3); `verify` solo puede mirar el cifrado por
la respuesta de la API, que es justo lo que este apartado dice que no demuestra nada (la issue #1397 de RustFS, «Data
is stored unencrypted on disk despite SSE», citada en `prelectura.md`, es ese caso). Por eso:

- el servicio `object-store` de `docker-compose.yml` se **copia** del compose de la matriz del elegido, y una
  comprobación de un solo uso (`node` sobre `docker compose config --format json` de los dos) compara el **objeto del
  servicio entero** tras quitar una **lista cerrada** de rutas que pueden diferir: `ports`, `healthcheck` (el compose
  de la matriz no tiene por qué llevar el de C8), `networks` (la red propia del almacén, D14: dónde se conecta el
  contenedor, no cómo se configura el producto), `entrypoint` (el guardia de arranque de D16, que se comprueba aparte:
  termina en `exec` del `Entrypoint` de la imagen con los mismos argumentos, y `command` sigue en la comparación
  estricta) y el origen del volumen con nombre; un fichero montado se compara por su contenido, no por su ruta. En `environment`, los **valores** tienen que ser idénticos salvo otra lista cerrada,
  escrita en la sección «Configuración entregada» de `matriz.md`: las claves mapeadas desde `S3_ACCESS_KEY`,
  `S3_SECRET_KEY` y `OBJECT_STORE_SSE_KEY` (comprobadas con `config --no-interpolate`). Cualquier otra diferencia
  falla nombrando su ruta. Antes, `docker buildx imagetools inspect` de la etiqueta por defecto tiene que dar el digest
  del índice anotado en C1: la etiqueta no se ha movido desde la medición (tarea 7.1);
- entre `docker-compose.yml` y `docker-compose.prod.yml` (tarea 7.3), la misma comparación con su propia lista
  cerrada: `ports`, `networks`, `depends_on`, `restart`, `logging` y el origen del volumen; el `healthcheck` **sí**
  tiene que ser igual. En producción, las claves de la lista se comprueban con
  `docker compose config --no-interpolate` como referencias `${VAR:?…}`, sin valor por defecto;
- con el modo `server`, con una `OBJECT_STORE_SSE_KEY` generada con la orden que se documentará (tarea 12.2) y
  exportada, tras `pnpm infra:up`, `c5.sh docker-compose.yml <volumen de desarrollo>` tiene que dar
  **`nativo` con (a), (b) y (c)**, pegado en la sección «Configuración entregada» de `matriz.md` (tarea 7.2b); con
  `customer-key`, la tarea 8.4 hace lo mismo con `c5.sh --sse-c` sobre `docker-compose.yml`. Si no sale, se para y se
  vuelve al usuario: la configuración entregada no es la medida. Todo esto va **antes** de escribir ADR-052
  «Elección» y los traslados (Migration Plan).

**C6, expiración: no se mide** (decisión del usuario, 2026-09-26). Una regla aceptada y listada no demuestra que se
aplique —es la comprobación decorativa que ADR-048 §7 encontró en `ensure-buckets.sh`—, y observarla ataba el
calendario a una espera que no se podía acelerar. En su lugar, la retención de snapshots va **siempre** por el barrido
del `worker` (D7): `provision` quita cualquier regla de ciclo de vida y `verify` exige que no haya ninguna (D4).
Configurar una regla del almacén exigiría medir su expiración en un change posterior (`cv/documents`, «Retención de
snapshots de enriquecimiento»).

### D3. El arnés es agnóstico y se queda en el repositorio

- **Una fábrica de `S3Client` por proceso**: `apps/api/src/infrastructure/storage/s3-client.factory.ts` y
  `apps/worker/src/infrastructure/storage/s3-client.factory.ts`, con endpoint, región, `forcePathStyle`, credenciales,
  la **política de checksums** (`requestChecksumCalculation` / `responseChecksumValidation`) y **plazos de conexión y
  de petición** (`connectionTimeout`, `requestTimeout` del manejador HTTP) en un solo sitio por proceso: sin plazos, un
  almacén que acepta la conexión y no responde cuelga el aprovisionamiento y la verificación del artefacto. Los cuatro
  adaptadores y el script de D4 la usan. Dos copias y no una en `libs/shared`: esa librería la consume `web`, y el SDK
  no debe entrar en su grafo. Una orden de un solo uso comprueba que no queda ningún `new S3Client(` fuera de las dos
  fábricas (con SSE-C pasa a ser un test permanente, D7).
- **Suites de contrato** (`*.s3-contract.spec.ts`), encendidas con `S3_CONTRACT=1` y apagadas por defecto (la suite
  normal no necesita contenedores): en `api`, subida del CV y borrado por prefijo con 1001 claves (dos lotes de
  `DeleteObjects`), y el **modo C5** de D2 (`S3_CONTRACT_C5_DIR`); en `worker`, lectura, borrado idempotente, objeto
  ausente distinguido de almacén caído, y escritura de un snapshot. Sustituyen a `s3-cv-file.local.spec.ts` y su
  `CV_MINIO_LOCAL`. `S3_CONTRACT_CHECKSUM=when_required` fuerza la política alternativa solo para la matriz.
- Se validan **primero contra el control de MinIO** (`docs/object-store-matrix/minio.compose.yml`, con cifrado): si no pasan ahí, el fallo
  es del arnés, no del candidato.

### D4. Aprovisionar es una orden aparte, con la imagen de `api` y por la API S3

Un script `object-store` en `apps/api/src/object-store.ts`, con dos subcomandos (`ls` y `rm` pasan al change posterior
de D12):

| Subcomando | Qué hace | Escribe |
|---|---|---|
| `provision` | crea los dos buckets (un `BucketAlreadyOwnedByYou` es éxito), **quita cualquier configuración de ciclo de vida de los dos buckets** con `DeleteBucketLifecycle` (un `NoSuchLifecycleConfiguration`, o un `NotImplemented`/`501` anotado, es éxito; nunca envía `PutBucketLifecycleConfiguration`: la retención es el barrido, D7), pone el cifrado por defecto del bucket de CV cuando el modo es `server` y quita cualquier política de bucket; cada bucket en su propio bloque, de modo que el fallo de uno no impide intentar el otro, y al final sale ≠0 nombrando lo que no quedó | sí |
| `verify` | lee y compara, sin escribir (salvo la excepción de la sonda): ver abajo | no |

**`verify` es estricto**, porque una comprobación laxa aprueba lo que no está:

- los dos buckets existen;
- en **ninguno** de los dos buckets hay regla de ciclo de vida: una regla en el de snapshots es un fallo que nombra
  bucket y regla **aunque sea de 30 días y esté habilitada** (la retención es el barrido, y una regla cuya expiración
  nadie ha medido no se deja puesta); un `NoSuchLifecycleConfiguration`, o un `NotImplemented`/`501` anotado, es «sin
  regla»;
- en el de CV hay cifrado por defecto cuando el modo es `server` (con `customer-key` lo dice: «cifrado por clave del
  cliente: no comprobable por bucket»);
- **acceso anónimo:** `GET` de objeto, listado y `PUT` **sin firmar** a cada bucket; cuenta como rechazo un `401` o un
  `403`, **o** un `400` cuyo `<Code>` sea de la familia de autenticación (`AccessDenied`, `MissingSecurityHeader`,
  `AuthorizationHeaderMalformed`, `InvalidAccessKeyId`, `SignatureDoesNotMatch`), que es como responden algunos
  almacenes a una petición sin firma; en los tres casos, **sin bytes del objeto** en el cuerpo. Un `2xx` es acceso
  concedido, un **`404` también es un fallo** (el `GET` de un objeto inexistente respondiendo 404 a un anónimo significa
  que el almacén lo dejó pasar a buscarlo) y cualquier otra respuesta, incluido un `400` con otro código, no cuenta como
  rechazo;
- **la sonda de escritura** va a `.verify-probe/<aleatorio>`; si el `PUT` anónimo se acepta, `verify` **borra ese objeto
  con firma**, informa del fallo y del borrado, y sale ≠0. Es la única escritura que hace, y solo existe si el almacén
  ya aceptó una escritura anónima (el escenario «El modo de comprobación no escribe» la lleva escrita);
- **lista los snapshots** y exige **cero** con `LastModified` de más de **31 días** (el barrido es diario; 31 da un día
  de margen). Un fallo nombra el bucket y la clave. Es también la única alarma de un `worker` que ha dejado de barrer:
  lo detecta en el siguiente despliegue o verificación del artefacto, no antes (Riesgos).

**`provision` es robusto:**

- un `NotImplemented` o un `501` en las API de políticas de bucket (`GetBucketPolicy`, `DeleteBucketPolicy`) se trata
  como «este almacén no tiene políticas de bucket», se anota en la salida y no es un fallo: el acceso anónimo lo
  garantiza `verify`, que lo comprueba con peticiones, no con políticas;
- hereda los plazos de la fábrica (D3) y tiene un **plazo global de 90 s**: pasado, sale ≠0 nombrando el paso en curso;
- `verify-artifact.sh` envuelve cada `dc run` en `timeout 180`.

Dónde corre:

- **En producción** corre con la **imagen de `api` ya publicada**, que trae el SDK y es de la arquitectura del host:
  `docker compose -f docker-compose.prod.yml --env-file <env> run --rm --no-deps api node object-store.js provision`
  (y `verify`), **después** del `up --wait`. Entra en la imagen como **punto de entrada adicional** del build de webpack
  de `api` (`dist/apps/api/object-store.js`). No importa `AppModule`: valida solo las `S3_*` con un fragmento del
  esquema de `api`, así que `run` no arranca Nest aunque herede el entorno del servicio.
- **En desarrollo**, el target `api:object-store` (`node apps/api/src/object-store.cjs`, el patrón de `seed-demo.cjs`),
  que lee el `.env` como cualquier target de Nx. El comando único de `platform/local-environment` pasa a ser `pnpm
  infra:up` = `docker compose up -d --wait && pnpm nx run api:object-store -- provision`, script del `package.json`
  raíz: funciona igual en `cmd`, PowerShell y bash.
- **Orden `up` → `provision` → `verify`.** La readiness de `api` y `worker` no necesita los buckets, así que no hace
  falta partir el `up` en dos. La ventana en que la pila corre sin buckets solo existe en el **primer** arranque de un
  volumen vacío, sin usuarios; el `worker` que intentara guardar un snapshot en ella lo registra y sigue (ADR-022 §10), y
  una subida de CV respondería `500` una vez. Se acepta a cambio de una sola línea `up` que `docs-stack-up` sigue
  sabiendo leer.

*Alternativas descartadas:*

- **Seguir aprovisionando en el healthcheck** (hoy): contesta «¿estás sano?» escribiendo, y ata el healthcheck a una
  herramienta que el producto puede no traer (la imagen de Garage es `scratch`).
- **Un servicio de un solo uso en el compose** con `depends_on: service_completed_successfully`. ADR-022 lo descartó
  **midiendo** que `up --wait` lo daba por fallido. No se vuelve a medir: aunque hoy funcionara, se descarta porque
  `compose-healthchecks` exige healthcheck en todo servicio y un contenedor que termina no tiene salud que declarar
  (eximirlo debilita un guardia permanente), y en desarrollo no existe la imagen de `api` en el compose.
- **Que `api` aprovisione al arrancar**: cada réplica y cada reinicio necesitaría permisos de administración del
  almacén, y el aprovisionamiento correría en paralelo consigo mismo.
- **`mc`, la CLI del producto o `aws-cli`**: los dos primeros atan la operación al producto; el tercero añade una imagen
  más con la misma política de checksums que hay que configurar aparte.

### D5. Healthcheck de solo lectura y los dos guardias de `repo-checks`

- El healthcheck es la orden que aprobó C8, en los dos composes, y **no** monta ningún script. Sus `start_period`,
  `interval` y `retries` salen de C9 y de la medición en `arm64` (D8).
- **`compose-healthchecks` no cambia:** aprovisionar es un `run` del servicio `api`, no un servicio nuevo sin
  healthcheck.
- **`docs-stack-up` sí cambia**, con dos comprobaciones:
  - **absoluta:** cada uno de los dos lados (el bloque marcado de `infra/README.md` y `verify-artifact.sh`) contiene,
    **después** de su `up`, la orden `docker compose … run --rm --no-deps api node object-store.js provision` y
    **después** la de `verify`. Comparar los dos lados entre sí no basta: si alguien quita las dos órdenes de los dos,
    siguen siendo iguales;
  - **relativa:** las dos listas de órdenes `run` son las mismas y en el mismo orden.

  Es un guardia permanente: se ve caer quitando las dos órdenes **de los dos lados** (la absoluta) y cambiando el orden
  en uno (la relativa).

### D6. Forma del almacén en los composes

- Servicio **`object-store`** (nombre genérico: el producto es un valor por defecto), imagen
  `${OBJECT_STORE_IMAGE:-<imagen elegida>}:${OBJECT_STORE_IMAGE_TAG:-<versión exacta>}` con **el mismo** valor por
  defecto en los dos composes, volumen `object-store-data` (sin `name:` explícito: `c5.sh` lo exige, D2) y, en los dos
  composes, **solo la red propia del almacén**, `object-store-net` (D14; en producción con `internal: true`).
- En desarrollo se publica `${OBJECT_STORE_PORT:-9000}:<puerto S3 del elegido>`, de modo que `S3_ENDPOINT=http://localhost:9000`
  de `.env.example` no cambia; es el **único** puerto publicado del almacén. Desaparecen `MINIO_PORT` y
  `MINIO_CONSOLE_PORT`.
- En producción, `api` y `worker` pasan a `S3_ENDPOINT: http://object-store:<puerto>` y a depender de
  `object-store: service_healthy`, y se unen a `object-store-net` **además** de su red `internal` (D14).
- Las credenciales siguen siendo `S3_ACCESS_KEY` / `S3_SECRET_KEY`, mapeadas a las variables del producto en su bloque
  `environment`. Si el SSE nativo necesita una clave del servidor, entra como `OBJECT_STORE_SSE_KEY` (formato del
  elegido, documentado), **obligatoria** en producción (`${OBJECT_STORE_SSE_KEY:?…}`: sin ella, el producto podría
  arrancar con una clave propia guardada en su volumen, que es lo que D2 (a) deja como observación porque esta línea ya
  lo impide) y sustituye a `MINIO_KMS_SECRET_KEY`. **Desarrollo cifra igual que producción**, con un valor de desarrollo
  por defecto, para que el aprovisionamiento sea uno solo. Como en desarrollo ese `:?` no existe, el servicio lleva
  además, en los dos composes, el **guardia de arranque** de D16, que se niega a arrancar con la clave vacía o mal
  formada o sobre un volumen donde el producto ya generó una clave propia.
- En **producción**, las credenciales y la clave son solo referencias obligatorias (`:?`), sin valor por defecto; el
  compose de **desarrollo** puede llevar valores de desarrollo por defecto (`${S3_SECRET_KEY:-linkvault-dev-secret}`),
  que no son secretos de ningún entorno real (`platform/object-store`, «Las credenciales del almacén no viven en el
  repositorio»).
- Se borra `infra/minio/ensure-buckets.sh` y su montaje. Si el elegido necesita un fichero de configuración, solo
  puede ser **sin secretos** (C3) y versionado; entonces es un fichero montado más, que 35b lleva al host (su tarea 4.1
  ya lo exige; la 6.3 de aquí le pone nombre).

### D7. La salida SSE-C, si la matriz la pide; el barrido y el texto de privacidad, siempre

**SSE-C (C5 = `salida`).** Variable `S3_CV_SSE_C_KEY` (base64 de 32 bytes, validada al arrancar; el error de zod nombra
la variable y **no** repite su valor) obligatoria en `api` y `worker`, documentada en `.env.example` y en
`infra/README.md` **junto a `AI_VAULT_KEY`**, con la advertencia de que perderla es perder los CV.

La clave no la añade cada adaptador, sino **un middleware de la fábrica** (`middlewareStack`, paso `initialize`): si el
`Bucket` del comando es `S3_BUCKET`, inyecta `SSECustomerAlgorithm`/`SSECustomerKey` en `PutObject`, `GetObject`,
`HeadObject`, `CopyObject`, `CreateMultipartUpload` y `UploadPart`, y **lanza** ante cualquier escritura al bucket de CV
cuando no hay clave configurada. Así un camino de escritura nuevo lleva la clave sin acordarse de ella, y el único modo
de saltársela es crear un cliente fuera de la fábrica. Pruebas:

- un test **por comando** de la lista (la clave llega) y uno de `DeleteObject(s)`/`ListObjectsV2` (no la necesitan);
- un test de **registros**: con el registro de peticiones del SDK activado, la clave no aparece en ninguna línea;
- el error de zod con un valor inválido no contiene el valor;
- un **test de inventario permanente** que falla si aparece `new S3Client(` en `apps/api/src` o `apps/worker/src` fuera
  de las dos fábricas (se ve caer añadiendo uno; los tests por comando se ven caer quitando el registro del
  middleware).

`provision` no pone cifrado por bucket y `verify` lo dice («cifrado por clave del cliente: no comprobable por bucket»).

**Barrido, siempre** (decisión del usuario, 2026-09-26). Un caso de uso del `worker` que lista el bucket de snapshots
y borra con `DeleteObjects` lo que tiene `LastModified` de más de 30 días, con reloj inyectable, y su programación
diaria con `@nestjs/schedule` (ya es dependencia). Se niega a arrancar si `S3_SNAPSHOTS_BUCKET` es igual a
`S3_BUCKET`. Un objeto ya borrado por otra réplica no es error. `provision` quita cualquier regla y `verify` exige que
no haya ninguna y cero snapshots de más de 31 días (D4). Se ejecuta una vez contra el almacén elegido y su salida
queda en `matriz.md` (tarea 8.7).

**Qué modo rige lo dice una constante, no el entorno.** `libs/shared/src/storage/object-store-modes.ts` exporta el modo
de cifrado del bucket de CV (`server` | `customer-key`), fijado por la matriz, y el de retención de snapshots, `sweep`,
su único valor (una regla del almacén exigiría medir su expiración en un change posterior); los leen el script de D4, las fábricas y el `worker`. No es una variable de entorno porque el producto es
el mismo en desarrollo, CI y producción, y un modo distinto por entorno sería verificar una configuración y desplegar
otra.

**`/privacidad` cambia en cualquier caso** (no depende de C5). El texto actual es jerga («SSE-S3 o equivalente»,
«proveedor») y deja de ser cierto sin proveedor. Texto nuevo con id nuevo (ADR-030 §12), ES y EN, del estilo de «Tu CV
se guarda cifrado en nuestro servidor; la clave la guardamos nosotros, aparte de los datos». Es cierto en los dos modos:
la clave vive en el fichero de entorno, no en el volumen del almacén (D2 (a) y (c)). La spec `web/privacy` no cambia: ya
exige no afirmar lo que el entorno no hace.

Sin salida en C5 no hay variable nueva: las tareas condicionales del grupo 8 (8.1-8.4 y 8.8) se cierran anotando «no
aplica» con la fila de la matriz que lo justifica. El barrido (8.5-8.7) se hace siempre.

### D8. El plazo de arranque se recalcula con tiempos medidos y sigue en una sola línea

- La fuente sigue siendo `WAIT_TIMEOUT="${VERIFY_WAIT_TIMEOUT:-<n>}"` en `infra/ci/verify-artifact.sh`, **con esa
  forma exacta**: la leen `docs-stack-up` y el corredor de 35b con una expresión regular.
- Los parámetros del healthcheck del almacén se fijan para que su ventana (`start_period + retries × interval`) sea al
  menos **tres veces** el peor tiempo hasta `healthy` medido: C9 en local y tres corridas en el corredor `arm64`.
- En el mismo corredor se mide el tiempo hasta `healthy` de `api` y `worker`; si alguno pasa de la mitad de su ventana
  (180 s), se amplía antes de calcular.
- Suelo = mayor ventana de las dependencias (mongo 90 s, redis 55 s, almacén) + mayor ventana de `api`/`worker`.
  Plazo = suelo × 1,10, redondeado **hacia arriba** a múltiplo de 30. El comentario del script muestra la tabla con los
  números nuevos y las mediciones.
- **Copias conocidas** del número, que no se tocan aquí: el `--wait-timeout 360` literal del paso de despliegue de
  `cd-staging.yml` (lo reescribe 35b, D4 de su design, leyendo esta línea) y el de `cd-prod.yml` (35c, anotado en su
  `scope`). Ninguno de los dos se ejecuta sin secretos. Los **comentarios** que citan «140 s» o `minio` en esos dos
  workflows sí se corrigen para que apunten al script sin repetir el número.

### D9. La plataforma se comprueba antes de descargar, y su ausencia es del artefacto

- **`infra/deploy/check-image-platforms.sh`**, en bash y con solo Docker (el host de 35b no tiene `node` ni `jq`).
  Recibe imágenes como argumentos o `--compose <f> --env-file <e>` (resuelve con `docker compose config --images`), y
  `--platform <os/arch>`; sin él, la del daemon (`docker version --format '{{.Server.Os}}/{{.Server.Arch}}'`). Por cada
  imagen consulta el registro con `docker buildx imagetools inspect` y una plantilla Go que lista las plataformas del
  índice o la del manifiesto único; ignora las entradas de atestación (`unknown/unknown`) y compara solo `os/arch`:
  **sin variantes** (una `--platform` con variante es uso incorrecto), que es lo único que pide un destino `arm64`.
  La plantilla exacta se mide antes de escribirla (tarea 2.14); si `imagetools` no distingue índice de manifiesto
  único, se usa `docker manifest inspect --verbose`.
- **Clasificación por el error medido, no supuesto** (la tarea 2.14 mide el stderr de un tag inexistente, un
  repositorio inexistente, un nombre que no resuelve y un `401`; el `429` no se mide con un registro falso: cae en el 4
  como todo lo no clasificado):
  - **0** todas presentes;
  - **3** «no existe para esa plataforma»: la plataforma falta en el índice, el manifiesto único es de otra, o el
    registro responde «manifest unknown»/`404` (un tag que no existe es un defecto del compose, del artefacto). Nombra
    imagen, plataforma pedida y las que existen;
  - **4** «no se pudo comprobar»: DNS, conexión, `401`, `429` y **cualquier error no clasificado** (lo desconocido no se
    atribuye a la imagen);
  - **2** uso incorrecto.

  Si la medición muestra que un registro responde a un repositorio inexistente igual que a un `401` (un registro que
  oculta la existencia de los privados), cae en 4 y se anota; no se inventa una distinción que el registro no da.
- **Por qué `imagetools` y no `docker manifest inspect`:** la plantilla Go da una línea `os/arch` por plataforma que bash
  lee sin `jq`; `docker manifest inspect` da JSON, y para un manifiesto único necesita `--verbose`. El plugin `buildx`
  viene en la instalación oficial de Docker Engine (`docker-buildx-plugin`), y la tarea 5.3 de 35b comprueba `docker
  buildx version` en el host (traslado ejecutado, ver «Traslados»).
- **En `verify-artifact.sh`**, antes del `pull` de terceros: si `TARGET_PLATFORM` está definida, el daemon tiene que ser
  de esa plataforma; **cada imagen propia** (cargada, aún no publicada, sin registro que consultar) se comprueba **en el
  daemon** con `docker image inspect --format '{{.Os}}/{{.Architecture}}'` contra `TARGET_PLATFORM` o, sin ella, contra
  la del daemon; las de terceros, con el script. Salida 3 o plataforma distinta → `fail … artifact`; salida 4 → entra en
  el mismo bucle de tres reintentos que el `pull` y, agotado, `fail … environment`.
- **El texto de la clase `artifact`** en `infra/ci/report-cd-outcome.sh` pasa a cubrir el caso, medido por caracteres y
  por bytes ≤ 140 como exige su cabecera. Propuesto: «El artefacto no se construyó, no arrancó o no existe para la
  arquitectura del destino: no se publicó ni desplegó nada.» (118 caracteres, 122 bytes; lo fija la tarea 2.16). No se
  crea una tercera clase: ADR-051 §3 la clasifica `artifact`. Las pruebas 2.1-2.2 de 35b esperan este texto (traslado
  ejecutado).
- **`cd-prod` lo hereda sin tocar su YAML**: corre el mismo `verify-artifact.sh` en `amd64` sin `TARGET_PLATFORM`, así
  que compara contra su propio corredor, y la imagen elegida es multiarquitectura por C1.
- **35b** lo coloca en su `deploy.sh` después del login y antes del `pull`, y lo lleva en su `config-files.txt`
  (traslados ejecutados). **35c** lo coloca en `deploy-prod` (su `scope`).

### D10. `build-verify-publish` de `cd-staging` pasa a `arm64`

- **Antes de nada, la tarea 1.2 comprueba que el corredor existe para este repositorio** y que Docker funciona en él:
  un workflow temporal en `ubuntu-24.04-arm` que imprime `uname -m`, `docker version` y `ls
  /proc/sys/fs/binfmt_misc` (un QEMU registrado significaría que un binario `amd64` arrancaría por emulación sin avisar;
  C11 del debate), arranca `mongo:7.0.43` y la imagen `arm64` de cada candidato con su healthcheck, y deja anotado si
  consume minutos y a qué ritmo. Si el corredor no se asigna o no entra en el plan, el change **se para y pregunta al
  usuario** antes de la matriz, con tres opciones: hacer público el repositorio, un corredor autoalojado en el host de
  Oracle, o QEMU con un ADR que enmiende ADR-051 §3.
- `runs-on: ubuntu-24.04-arm` y `env: TARGET_PLATFORM: linux/arm64` **a nivel de job**, única declaración de la
  arquitectura. Los tres `build-push-action` llevan `platforms: ${{ env.TARGET_PLATFORM }}` y `load: true`; el paso de
  verificación recibe `TARGET_PLATFORM`. Sin QEMU: si alguien devuelve el job a `amd64`, la verificación falla en la
  comprobación del daemon (D9), no construye por emulación.
- La caché `gha` pasa a `scope=api-arm64` (y `worker`, `web`): con el mismo `scope` que `cd-prod` en `amd64`, cada
  `mode=max` pisaría la caché del otro.
- `verify`, `preflight`, `deploy-staging` y `report` siguen en `ubuntu-24.04`: no ejecutan nada de la arquitectura del
  destino, y la caché de binarios de mongo del `verify` es de `x64`.
- `publish-artifact.sh` no cambia. La identidad por digest se comprueba en la corrida `arm64` y su falsación de ADR-048
  §4 (reconstruir antes de `docker push`) **se repite en `arm64`** (tarea 9.3), porque el comportamiento del almacén de
  imágenes del daemon que ADR-048 §7 advierte cambia con el corredor. La imagen no verificada que esa falsación deja en
  GHCR se borra en la misma tarea.
- Riesgo propio del build: dependencias nativas (`@node-rs/argon2`, `esbuild`) deben resolver su binario
  `linux-arm64-musl` desde el lockfile podado de Nx. El lockfile las declara; que la imagen **arranque** lo demuestra la
  propia verificación en `arm64`.

### D11. Los minutos de CI se miden, no se suponen

La tarea 1.2 dice si las corridas `arm64` de este repositorio consumen minutos del plan y a qué ritmo (`gh api
repos/{owner}/{repo}/actions/runs/<id>/timing`, campo `billable`). **Si no consumen**, no hay nada más que medir. **Si
consumen**, la tarea 9.4 da **una cifra**: minutos proyectados al mes (corridas de `cd-staging` y `ci` del último mes ×
minutos facturados por corrida en `arm64`) frente a los incluidos en el plan, leídos el día de la medición, anotada en
ADR-052. Por encima del **80 %**, pasa al usuario como decisión con el dato antes de archivar (ADR-051, «si no caben, se
decide con el dato»).

**Medido en el apply (2026-09-28):** `timing` devuelve `total_ms`/`billable` a 0 incluso en corridas que se
facturan, así que la 1.2 y la 9.4 leen el ritmo y el consumo de la facturación de la cuenta
(`users/<usuario>/settings/billing/usage`), y los incluidos del plan, de la cifra documentada del plan Free (ninguna API
los da). La cifra (95 % en septiembre) y la decisión del usuario están en ADR-052 «Elección» y en la tarea 9.4.

### D12. Arrancar, desplegar y verificar sin `mc`; operar, en un change posterior

- **Aquí:** ningún paso del arranque local, del arranque documentado de producción, de la verificación del artefacto ni
  del despliegue usa `mc` ni la CLI de ningún producto (`provision` y `verify`, D4). La comprobación de configuración
  del RUNBOOK («Operar los CV»: `mc anonymous get`, `mc ilm rule ls`) pasa a `object-store verify`.
- **Change posterior** (sin fila todavía; se propone al usuario al archivar este): `object-store ls|rm`, y con ellos la
  reescritura de la recogida de huérfanos (dos pasos con revisión humana, ADR-028), del borrado manual de lo de una
  persona y de la tabla de síntomas del RUNBOOK. Hasta entonces esas secciones quedan **marcadas como pendientes y no
  aplicables al almacén nuevo**, sin presentarse como operación válida. Hoy nadie las ejecuta (no hay usuarios), y
  hacerlo aquí eran tres tareas y un requirement que no protegen ningún CV.
- **«Recogida de objetos huérfanos documentada» (`cv/documents`) se modifica solo para decirlo:** el MODIFIED copia el
  requirement entero y añade que el procedimiento queda **pendiente** hasta el change posterior, con la sección del
  RUNBOOK marcada (tarea 12.1). Sin él, esa spec seguiría exigiendo un procedimiento válido que `platform/object-store`
  prohíbe presentar como válido, y las dos specs se contradirían.
- La búsqueda de un solo uso de `\bmc\b`, `minio` y `linkvault-minio` (tarea 12.4) se limita a **los dos composes,
  `README.md`, `infra/README.md` y `docs/RUNBOOK.md`**, con una lista cerrada de excepciones: las secciones del RUNBOOK
  marcadas como pendientes. El resto de referencias vivas las cubre la tarea 12.3 con su propia comprobación.

### D13. El espejo se retira de las referencias; el paquete, lo decide el usuario

Ninguna referencia a `ghcr.io/manuxd270516/linkvault-minio` queda en los composes ni en la documentación viva. El
paquete de GHCR **se usa una última vez** como imagen solo `amd64` en las comprobaciones del script de D9 (tareas 2.15
y 10.1) y queda, marcado como retirado en su descripción; borrarlo es irreversible y fuera del repositorio (Open Questions). ADR-048 §8 recibe una línea de
anotación que apunta a ADR-052.

### D14. El almacén vive en una red propia de Docker (decisión del usuario, 2026-09-27)

**El problema, medido** (`matriz.md`, 3.1 y «Punto de revisión (tarea 4.1)», pregunta (i)). `weed mini` 4.47 arranca,
además de la pasarela S3 (`8333`), el filer (`8888`), el maestro (`9333`), el volumen (`9340`), sus gRPC (`18888`,
`19333`, `19340`, `18333`) y el servidor de administración (`23646`, gRPC `33646`), todos en todas las interfaces. El
filer sirve los objetos **sin autenticación** a cualquier contenedor de la misma red (A1 vuelve cifrado, B1 idéntico) y
su log dice que su servicio IAM por gRPC no está autenticado. No hay forma de cerrarlo **dentro** del producto sin
cambiar su configuración: no existe enlace por componente; `-ip.bind=127.0.0.1` es global y cierra también la
pasarela S3 (`provision` sale 1 por tiempo); `-disableHttp` quita el HTTP del filer pero deja todo lo demás escuchando,
incluido el gRPC del filer; y la vía de `security.toml` con JWT es un fichero con un secreto montado, que la forma de
D1 y C3 no admiten. Así que lo que se cierra es **quién llega al contenedor**.

**Decisión.** El servicio `object-store` sale de las redes compartidas y vive en **una red de Docker propia,
`object-store-net`**, a la que solo pertenecen los procesos que usan el almacén:

- **Producción** (`docker-compose.prod.yml`): `object-store-net` con `internal: true` (sin salida ni puertos
  publicados; el almacén ya no publicaba ninguno), con **exactamente** `object-store`, `api` y `worker`. El almacén
  **deja** la red `internal`; `api` y `worker` **siguen** en `internal` (mongo, redis y Traefik) y se unen además a
  `object-store-net`, por la que resuelven `object-store`. Mongo, Redis, `web` y Traefik no están en ella: no resuelven
  el nombre ni alcanzan ningún puerto del almacén (`8333`, `8888`, `18888`, `9333`, `9340`, sus gRPC ni `23646`/`33646`).
- **Desarrollo** (`docker-compose.yml`): `object-store-net` **sin** `internal: true`, porque una red interna impide
  publicar puertos en el host, y en desarrollo `api` y `worker` corren en el host y llegan por
  `${OBJECT_STORE_PORT:-9000}` (el único puerto publicado; `8888`, `9333`, `9340` y los gRPC no se publican). Solo
  `object-store` pertenece a ella; sale de `default`, donde siguen Mongo, Redis, Mailpit, Ollama y Meilisearch.
- **CI:** no hay compose de verificación aparte: `verify-artifact.sh` levanta `docker-compose.prod.yml`, y sus `dc run
  --rm --no-deps api|worker …` heredan las redes del servicio, `object-store-net` incluida.

**No cambia la configuración del producto** (misma imagen, misma orden, mismo entorno, mismo volumen): las celdas
C3-C5 y C7-C9 **no se repiten por esto**. C3-C4 quedan cubiertas por la 7.2 (`provision` y `verify` sobre el compose
entregado) y C5 por la 7.2b, que repite C5 sobre la configuración entregada, red incluida; el healthcheck de C8 es el
mismo, y los tiempos de C9 se vuelven a medir en la 7.4 y la 11.1. En la comparación matriz ↔ desarrollo de la 7.1,
`networks` entra en la lista cerrada (D2); la de desarrollo ↔ producción ya la tenía. En su lugar, la tarea 7.3b lo
comprueba de forma explícita, con falsación: desde un contenedor efímero en la red de mongo y redis, `object-store:8888`
y `:8333` no se alcanzan; desde `api`, `verify` sale 0; y el mismo contenedor, unido a `object-store-net`, sí conecta
al `8888`.

**Lo que queda.** `api` y `worker` (y quien los comprometa) siguen alcanzando el filer sin autenticación; ya tienen las
credenciales raíz del almacén (Riesgos), así que no ganan nada que no tuvieran. En desarrollo, el puerto publicado
escucha en todas las interfaces del host, como con MinIO; no cambia aquí.

*Alternativas descartadas:* **aceptarlo en la red compartida** (cualquier contenedor comprometido de la pila —mongo,
redis, `web`— o cualquier servicio que se añada después leería los snapshots en claro y los CV cifrados por el filer,
y quizá escribiría: no medido); **`-ip.bind=127.0.0.1`** (cierra también la pasarela S3, medido); **`-disableHttp`**
(deja el gRPC del filer y el HTTP del maestro y del volumen escuchando, sin medir qué entregan, y es otra configuración
que obligaría a repetir C3-C5 y C7-C9); **`security.toml` con JWT** o **TLS interno** (otra configuración, y el primero
un fichero con secreto montado).

### D15. Un bucket de CV ausente es una avería reintentable, no un objeto ausente (decisión del usuario, 2026-09-27)

**El problema, medido en la 2.8.** `meansMissingObject` (`apps/worker/src/modules/cv/infrastructure/storage/s3-cv-file.reader.ts`)
cuenta como objeto ausente `NoSuchKey`, `NotFound`, `NoSuchBucket` **y cualquier respuesta `404`**. Con
`S3_BUCKET=no-existe`, el caso «objeto ausente (`null`)» de la suite de contrato del `worker` pasa. Y
`extract-cv.usecase.ts` resuelve un `null` como fallo definitivo sin reintento: con el bucket sin crear o mal nombrado,
**cada** CV subido quedaría `failed` con `internal_error` en silencio, en vez de reintentarse como con un almacén caído.
El borrado tiene el mismo defecto en el otro sentido: `remove` da por borrado un objeto de un bucket que no existe, y un
bucket mal nombrado dejaría el CV real sin borrar dando el borrado por hecho.

**Decisión.** Solo es «objeto ausente» un error de **objeto**: nombre `NoSuchKey` o `NotFound`. `NoSuchBucket`, y
cualquier `404` con otro nombre o sin él, **se relanzan**:

- en la **lectura**, el caso de uso de extracción lanza, el job usa los reintentos de BullMQ (tres intentos con espera
  creciente, `cv/extraction`) y, agotados, el consumidor deja el CV en `failed` con `internal_error` como hoy con el
  almacén caído; el aviso lleva solo el nombre del error (`CV file not read: NoSuchBucket`), nunca la clave;
- en el **borrado**, el job de `delete-cv-file` falla y se reintenta, y NO da el borrado por hecho.

Un `404` sin nombre reconocible que en realidad fuera de objeto pasa a reintentarse y termina igual (`failed` con
`internal_error`), solo más tarde: el error es hacia el lado seguro. **`api` no tiene esta lógica:** no lee CV (el
`worker` es el único lector; `s3-cv-file.store.ts` solo sube) y su borrado por prefijo no trata ningún `404` como
ausente; no cambia.

**Con la 7.5:** la sonda `s3-probe` lee una clave ausente de `.verify-probe/` y exige `null`; con el bucket presente
sigue valiendo, y con el bucket ausente la lectura ahora lanza y la sonda sale ≠0, que es lo que se quiere. Su
`HeadBucket` previo se mantiene: nombra el bucket en el fallo sin depender de cómo responda el producto a un `GetObject`
en un bucket inexistente.

*Alternativa descartada:* mantener `null` y apoyarse en la sonda de la 7.5 y en `verify`, que solo miran en cada
despliegue: un bucket borrado o mal nombrado entre dos despliegues marcaría fallidos todos los CV subidos en ese tiempo,
sin reintento posible.

### D16. El almacén se niega a arrancar sin su clave (decisión del usuario, 2026-09-27)

**El problema, medido en la 3.4** («Observación de (a)»). Sin `WEED_S3_SSE_KEK`, `weed mini` 4.47 **genera una KEK**,
la guarda en el volumen (`/data/.mini_sse_kek`, junto a `/data/.mini_kek_passphrase`), acepta el cifrado por defecto y
cifra con ella: `provision` y `verify` salen 0, y desde fuera no se distingue de la configuración medida, pero la clave
vive junto a los datos que cifra. En producción lo impide el `${OBJECT_STORE_SSE_KEY:?…}` (D6); en desarrollo la 7.1
da un valor por defecto, así que esa guarda no existe; y un volumen que arrancó **una vez** sin clave lo sigue
arrastrando aunque después se ponga. El usuario pidió **resolverlo, no solo documentarlo**.

**Decisión: un guardia de arranque en el propio servicio**, en los dos composes, idéntico (la comparación desarrollo ↔
producción de la 7.3 no quita `entrypoint`):

- `entrypoint: ['/bin/sh', '-c', '<guardia>', 'object-store-guard']`, con **`command` intacto**, la misma lista que
  midió la matriz (`mini -dir=/data -webdav=false …`). La imagen es Alpine y trae `/bin/sh` (4.3). El guardia termina en
  `exec <Entrypoint de la imagen> "$@"`, con el `Entrypoint` de la imagen fijada leído con `docker image inspect
  --format '{{json .Config.Entrypoint}}'` (tarea 7.1b): el proceso que queda es **el mismo** que en la matriz, con el
  mismo binario, los mismos argumentos y el mismo entorno. En el YAML, cada `$` del guardia se escribe `$$`; con uno
  solo, Compose lo interpolaría desde el entorno del host.
- **Se niega a arrancar** (sale ≠0 con una línea en stderr que nombra la variable o el fichero y remite al RUNBOOK, y
  **nunca** contiene el valor de la clave) si:
  1. `WEED_S3_SSE_KEK` no son **exactamente 64 caracteres `[0-9a-f]`**: vacía, más corta o más larga, o con otro
     carácter. Minúsculas, porque es lo que da la orden de generación documentada (`randomBytes(32).toString('hex')`) y
     lo único medido; salida 64;
  2. existe `/data/.mini_sse_kek` (o `/data/.mini_kek_passphrase`, si la 7.1b confirma que con clave tampoco se crea):
     el volumen arrancó alguna vez sin clave y puede tener objetos cifrados con la que el producto generó; salida 65.
- Si no, `exec`: sin proceso intermedio, las señales y el código de salida son los de `weed`.

**No cambia las flags de `weed` medidas** ni el entorno ni el volumen: la 7.2b, que repite C5 sobre la configuración
entregada, lo cubre (la K2 de `c5.sh` tiene el formato de K1 y pasa el guardia; el volumen restaurado desde el `tar`
no tiene `.mini_sse_kek`). El compose de la matriz **no se toca** (es la evidencia de lo medido): en la comparación
matriz ↔ desarrollo, `entrypoint` entra en la lista cerrada y se comprueba aparte (7.1b), y `command` sigue en la
estricta.

**Protección en profundidad:** el `:?` de producción (Compose no crea el contenedor sin la variable); el guardia (el
contenedor no arranca con la clave vacía o mal formada, en desarrollo, en CI y en producción, ni sobre un volumen que
ya arrancó sin clave); C5 sobre lo entregado (7.2b: la clave del entorno es la que protege); y la documentación
(12.1: qué significa el rechazo y qué hacer —**nunca** borrar el fichero sin saber con qué clave se cifraron los
objetos—; 12.2: la clave es obligatoria y con qué formato).

**Lo que queda.** El guardia es propio del producto (nombre de la variable y del fichero): sustituir el producto
repite la matriz y lo reescribe. El guardia comprueba forma y ausencia del fichero, no que `weed` use esa clave: eso lo
demuestra C5 (b) y (c).

*Alternativas descartadas:* **solo documentarlo** (el usuario lo descartó); **comprobarlo en `verify` o en el
despliegue** (la API S3 no ve el volumen, y mirarlo con `docker exec` ata el despliegue a un producto, contra
`platform/object-store`); **una imagen propia con el guardia dentro** (una imagen de terceros replicada que mantener y
publicar en dos arquitecturas, lo que ADR-048 §8 y `platform/object-store` evitan); **un script montado** (un fichero
más que 35b tendría que llevar al host en `config-files.txt`; en línea no hace falta).

### D17. Autocreación de buckets en SeaweedFS: la subida del CV pide el cifrado (decisión del usuario, 2026-09-27)

**El hallazgo, medido en la 7.5b** (`matriz.md`, «Configuración entregada», 7.5b). SeaweedFS 4.47 **crea el bucket**
cuando recibe un `PutObject` firmado a un bucket que no existe; `HeadBucket`, `GetObject` y `DeleteObject` no lo
crean (`NotFound` y `NoSuchBucket`, `404`). El bucket así creado **no tiene cifrado por defecto**
(`GetBucketEncryption` responde `ServerSideEncryptionConfigurationNotFoundError`) y el objeto se guarda sin
`ServerSideEncryption`. El `api` subía los CV sin cabecera SSE y dependía del cifrado por defecto que pone
`provision`: con el bucket de CV borrado o mal nombrado, la siguiente subida lo recrearía **sin cifrado** y los CV
quedarían en claro en el disco, sin que nada fallara. Para D15 significa además que un bucket de CV ausente deja de
estarlo en cuanto llega una subida.

**Decisión.**

- La `api` manda `ServerSideEncryption: 'AES256'` en **cada** `PutObject` del bucket de CV
  (`apps/api/src/modules/cv/infrastructure/s3-cv-file.store.ts`, su único camino de escritura), para que el cifrado del
  objeto no dependa del estado del bucket.
- `provision` sigue poniendo, y `verify` sigue exigiendo, el cifrado por defecto del bucket de CV: la cabecera se suma
  a él, no lo sustituye.
- No se desactiva la autocreación ni cambia la configuración medida de `weed mini` (orden, entorno y volumen): no se
  repite ninguna celda.
- **C5 sigue probando el cifrado por defecto del bucket.** El modo C5 de la suite de contrato de `api` escribe A1 y A2
  **sin cabeceras SSE** con el cliente de la fábrica, y ya no con el adaptador, que ahora la manda (D2, paso 1). La
  forma (1) de `cv/documents` exige que el almacén cifre «aunque el cliente no lo pida», y con la cabecera C5 aprobaría
  aunque faltara el cifrado por defecto. La 7.2b se midió antes de este cambio, sin cabecera, y sigue valiendo. *(Esto
  se deduce de la spec; no es una respuesta explícita del usuario.)*
- Con el modo `customer-key` (no aplica: C5 = `nativo`), la cabecera SSE-S3 no convive con las de SSE-C, y la 8.2
  tendría que revisarla.

**Verificación de la 7.5b.** Con la suite de contrato completa y un `S3_BUCKET` inexistente, el caso «objeto ausente
(`null`)» no puede fallar: el primer test sube un CV y SeaweedFS crea el bucket, así que el caso de `null` corre contra
un bucket ya creado. La 7.5b se verifica con **ese caso aislado** (`-t "missing object"`) y un bucket que nunca existió.

**Tarea 7.5c:** la cabecera con su test y su falsación, y la medición contra SeaweedFS: borrar `cvs`, subir con la
cabecera, ver el bucket autocreado sin cifrado por defecto y el objeto con `AES256` y **ausente en claro** del
volumen (el método de `c5.sh`); y, como falsación, la misma subida sin la cabecera, que sí aparece en claro.

*Alternativas descartadas:* **desactivar la autocreación** (el usuario lo descartó: cambia la configuración medida y
no está medido que el producto lo permita); **confiar solo en `verify`**, que mira en cada despliegue y no entre dos:
un bucket recreado entre medias guardaría en claro todo lo subido hasta el siguiente.

## Risks / Trade-offs

- [Con el barrido, un `worker` caído, o con el trabajo diario sin registrar, deja de borrar snapshots sin avisar] →
  `verify` exige cero de más de 31 días y corre en cada verificación del artefacto y en cada despliegue, así que lo
  detecta en el **siguiente** despliegue, no antes. Se acepta: los snapshots son páginas de ofertas, no CV. Lo dicen
  ADR-052 («Consecuencias») y el RUNBOOK (tarea 12.1).
- [El método de C5 vuelve a estar mal] → control positivo en MinIO con cifrado (2.9-2.10) antes de suspender a nadie, y
  controles independientes en cada lectura (B1, B2).
- [Un almacén que no arranca con otra clave, o que reescribe sus metadatos al intentarlo] → (b) se hace siempre sobre
  una copia restaurada desde el `tar`, y «no arranca nombrando la clave, y con la original vuelve todo» (b2) es un
  resultado válido, no un `no concluyente`.
- [El umbral de guardado en línea de un candidato no es el supuesto] → el par pequeño es de 1 KiB, por debajo del de
  Garage (unos 3 KiB, a confirmar al medir); si el cribado muestra otro umbral, la C5 de ese candidato se repite con
  un par por debajo de él y se anota.
- [SSE-C por la red interna sin TLS rechazado por el servidor o por el SDK] → se mide el día 2 (2.9b), con el control
  negativo de MinIO; si ocurre, C5 es `falla (TLS)` para ese candidato (o para todos, si es el SDK), y meter TLS interno
  se presenta al usuario como decisión sobre otra configuración que repetiría C5, en vez de montarlo dentro de este
  change sin medir.
- [La configuración que se entrega no es la que se midió] → el servicio de los composes de la pila se copia del de la
  matriz, se compara entero con una orden de un solo uso (solo una lista cerrada de rutas y de claves puede diferir),
  la etiqueta de la imagen tiene que resolver al digest medido y C5 se repite sobre `docker-compose.yml` (D2, «Lo que se entrega es
  lo que se midió»).
- [Con SSE-C la garantía pasa del almacén a la aplicación] → dicho en la spec; middleware en la fábrica, test por
  comando, test de inventario permanente y clave copiada con `AI_VAULT_KEY`.
- [Perder la clave del cifrado es perder los CV, con SSE nativo o con SSE-C] → la clave vive en el fichero de entorno,
  que ya se copia fuera del host por `AI_VAULT_KEY`; `infra/README.md` lo dice junto a su generación (12.2).
- [Checksums CRC32 del SDK rechazados por el servidor] → C7 corre primero con la política por defecto y la alternativa
  vive en la fábrica de D3; `DeleteObjects` (que exige checksum) está en la suite de contrato.
- [SeaweedFS abierto sin identidades] → C4 ejecuta `verify` contra el arranque sin identidades y exige que salga ≠0
  nombrando el acceso anónimo, y `verify` corre en **cada** verificación del artefacto: una configuración que se abra
  después rompe el CD.
- [Puertos internos de `weed mini` sin autenticación (filer, gRPC)] → red propia del almacén con solo `api` y `worker`
  (D14), comprobada con falsación en la 7.3b; `api` y `worker` ya tienen las credenciales raíz.
- [Sin clave, `weed mini` genera una propia en el volumen] → `:?` en producción y guardia de arranque en los dos
  composes (D16), con tres falsaciones en la 7.1b; el RUNBOOK dice qué hacer si se niega (12.1).
- [Bucket de CV ausente leído como «objeto ausente»] → error reintentable en el lector del `worker` (D15, 7.5b) y la
  sonda de la 7.5 en cada verificación del artefacto.
- [El producto elegido cambia de comportamiento en una versión] → versión exacta fijada, digest anotado y matriz
  obligatoria antes de subir la versión mayor (spec `platform/object-store`).
- [Ventana sin buckets en el primer arranque de un volumen vacío] → sin usuarios en ese momento; el `worker` ya tolera un
  snapshot no guardado; se documenta.
- [La aplicación usa las credenciales raíz del almacén] → igual que hoy con MinIO; separar credenciales de administración
  y de aplicación queda fuera y se anota en ADR-052.
- [Operar el almacén (huérfanos, borrado manual) queda sin procedimiento válido hasta un change posterior] → no hay
  usuarios; el borrado de cuenta del producto sigue borrando el prefijo del CV; las secciones del RUNBOOK lo dicen.
- [Binarios nativos que no resuelvan en `arm64` con el lockfile podado] → lo encuentra la verificación en `arm64`
  (la imagen no arrancaría), antes de publicar.
- [Corredores `arm64` no disponibles o de pago para este repositorio] → la tarea 1.2 lo ejecuta antes de la matriz y,
  si falla, para y pregunta (D10).
- [`cd-prod` hereda cambios de los scripts compartidos sin cambiar su YAML] → buscado a propósito (no queda atrás con
  MinIO); la comprobación de plataforma sin `TARGET_PLATFORM` compara contra su propio corredor.

## Migration Plan

1. Un PR (`change/object-store`) con **base en `main`, que ya contiene la #65** (la planificación de `staging-host`; el
   commit `2409bbb` es ancestro de `origin/main`), fusionado en una ventana autorizada por el usuario con el CI en verde.
   El PR lleva este change **y** los traslados editados en `openspec/changes/staging-host/` (design, tasks, proposal y
   su spec `platform/ci-pipeline`), además del `scope` de `openspec-changes.yaml`, la fila 35a de
   `docs/design-v0.2.md`, ADR-052 y `docs/object-store-matrix/`. Orden interno de las tareas: corredor `arm64` y C1-C2 →
   arnés y control de MinIO y, en los huecos, lo que no depende del producto (traslados,
   `/privacidad`, medición y script de plataformas, texto de la clase `artifact`, comentarios de los workflows) →
   cribado → punto de revisión (bloquea solo si nadie da C5 `nativo`) → celdas del candidato señalado → veredicto
   (5.3) → modo de cifrado (6.2), compose de desarrollo con su red propia y su guardia de arranque, aprovisionamiento
   y C5 sobre lo entregado (7.1, 7.1b, 7.2 y 7.2b o, con `customer-key`, 8.1-8.4) → ADR-052 «Elección» y traslados
   (6.1, 6.3, 6.4) → compose de producción y su aislamiento de red comprobado (7.3, 7.3b) → bucket de CV ausente como
   error reintentable (7.5b) → resto del grupo 7 con el CD aún en `amd64` → barrido (8.5-8.7) → paso a `arm64` → modo
   `--compose` del
   script, integración en la verificación y su falsación en `arm64` → plazo → documentación.
2. Para quien desarrolla: `docker compose down`, `docker volume rm linkvault_minio-data` (opcional; no hay nada que
   migrar) y `pnpm infra:up`.
3. Staging y producción: no hay despliegue ni datos. `main` queda en «verificado sin destino».
4. **Vuelta atrás:** revertir el PR. No hay datos en el almacén nuevo que conservar.
5. **Orden de archivo:** este change se archiva **antes** de `/opsx:apply` de 35b y antes de que 35c redacte su MODIFIED
   de «CD a staging en main».

## Traslados a `staging-host` y `verify-reusable-workflow`, ejecutados

En la iteración 1 del debate se decidió **editarlos ahora** (son spec, no `apps/**`) en vez de dejarlos anotados. La
tarea 2.12 comprueba con `node -e` que siguen ahí al aplicar, y se ve caer una vez contra `2409bbb`, nombrando los que
no existían en ese commit.

- **`staging-host` design D4 y tarea 4.4:** el orden del despliegue termina en `… up → run --rm --no-deps api node
  object-store.js provision → run … verify`, con el compose instalado, y el `docker` falso de la 4.4 lo registra. Su
  spec «El despliegue lleva al host la configuración del mismo commit…» dice ahora «arrancar y dejar el almacén
  aprovisionado y comprobado», y su proposal repite el orden.
- **`staging-host` tarea 4.4, comprobación de plataformas** (iteración 2): el `docker` falso contesta a `version
  --format`, `compose config --images` e `imagetools inspect` con el formato medido en la tarea 2.14 de aquí, y hay un
  caso de **plataforma ausente**: `deploy.sh` sale ≠0, sin `pull`, sin instalación y con `logout`.
- **`staging-host` design D5** (iteración 2): 35a **no** vuelve a medir `service_completed_successfully`; el
  aprovisionamiento es un `run` aparte (D4 de aquí, ADR-052 §4).
- **`staging-host` tarea 5.3 y D7:** el host comprueba `docker buildx version` (D9 elige `imagetools`).
- **`staging-host` tarea 1.1:** además de lo que ya pedía, comprueba que `object-store.js` sale del build de `api`, que
  existe `infra/deploy/check-image-platforms.sh` y que ADR-052 tiene «Elección» rellena, de la que sale el fichero
  montado por el almacén, si lo hay.
- **`staging-host` tarea 4.1 y D4:** `config-files.txt` incluye `infra/deploy/check-image-platforms.sh` por su nombre y
  el fichero que monte el almacén elegido (sin secretos, C3), según ADR-052.
- **`staging-host` tarea 9.10 y D15:** el aviso dice «si subes tu CV, se guarda cifrado; este entorno puede perderse sin
  copia; puedes borrarlo en Mi CV».
- **`staging-host` tareas 2.1-2.2:** los casos con clase `artifact` esperan el texto nuevo de D9, leído del script.
- **`staging-host` D3, D4 y tareas 1.1, 4.4 y 4.5, digest del almacén** (pasada extra del debate): el corredor lee de
  ADR-052 «Elección» la línea `Digest del índice: sha256:<64 hexadecimales>`, la valida y la pasa como tercer
  argumento de `deploy.sh`, que, antes del `pull`, la compara con el digest del índice resuelto para `object-store`
  (`docker compose … config --images object-store` e `imagetools inspect` con la plantilla medida en la 2.14 de aquí)
  y, si difiere, sale ≠0 sin `pull` ni instalación; la 4.4 tiene el caso de digest distinto con el `docker` falso y la
  1.1 comprueba la línea.
- **`openspec-changes.yaml`, `scope` de `verify-reusable-workflow`:** en `deploy-prod`, la comprobación de plataformas
  antes del `pull` y `provision` + `verify` tras el `up`; en `cd-prod`, el plazo leído de la línea `WAIT_TIMEOUT` en vez
  del literal.

## Choques con specs vigentes

- **`infra/ci/report-cd-outcome.sh` lo tocan los dos changes**: aquí solo el texto de la clase `artifact`; 35b añade
  `RUN_MODE`. Como 35a se archiva antes, las pruebas de 35b esperan el texto nuevo (traslado ejecutado).
- **El plazo:** la línea conserva su forma y un valor de 2 a 4 cifras, que es lo que valida el corredor de 35b
  (`^[0-9]{2,4}$`). El literal `360` de su paso de despliegue actual es el que 35b sustituye.
- **35c** redacta su MODIFIED de «CD a staging en main» sobre el texto de esta delta, y hereda el literal `360` del paso
  de despliegue de `cd-prod.yml`. La regla de arquitectura se escribió **solo para staging** porque «CD a producción…»
  dice «con el mismo criterio que el CD de staging»: sin esa acotación, `cd-prod` habría quedado incumpliendo una spec
  que no le toca hasta 35c, cuya release `arm64` tendrá que extenderla. Por lo mismo, el ADDED de plataformas de
  `production-deploy` dice a qué despliegue aplica y desde cuándo.
- **`cv/documents` «Recogida de objetos huérfanos documentada»** se modifica solo para decir que el procedimiento queda
  **pendiente** hasta el change posterior, con la sección del RUNBOOK marcada (D12). Sin ese MODIFIED, esa spec seguiría
  exigiendo un procedimiento válido que `platform/object-store` prohíbe presentar como válido.
- **`web/privacy`** no se modifica: es agnóstica y ya prohíbe afirmar lo que el entorno no cumple; lo que cambia es el
  texto de la página (D7).
- **ADR-022 §10** («el bucket y su regla los crea el healthcheck») y **ADR-028** (órdenes `mc`) quedan superados en ese
  punto y reciben una línea de anotación; **ADR-033 D5** pasa a «efectiva» según su propia enmienda (ADR-051).

## Open Questions

**Respondida por el usuario el 2026-09-28, tras el smoke local tipo producción** (`reports/smoke/object-store/REPORT.md`):

- **`api` y `worker` escuchan solo en loopback dentro del contenedor → se arregla dentro de 35a.** `app.listen(port)`
  sin host, con Fastify, escucha en `localhost`; Traefik recibe `ECONNREFUSED` en `http://api:3000` y
  `verify-artifact.sh` no lo ve porque pregunta desde dentro del contenedor. Es anterior a este change (también está
  en `main`), pero bloquea cualquier despliegue real, 35b incluido: los dos escuchan en `0.0.0.0` (tarea 7.9) y la
  verificación del artefacto pide su salud desde otro contenedor de la red `internal` (tarea 7.10); ADR-052,
  decisión 5; spec `platform/runtime-health`, «Liveness».

**Respondidas por el usuario el 2026-09-27, tras el punto de revisión** (las dos preguntas abiertas de la 4.1 en
`matriz.md` y el hallazgo de la 2.8 que dejaba abierto la 7.5b):

- **Filer y gRPC sin autenticación en la red del compose → aislar el almacén en una red de Docker propia**, con solo
  `object-store`, `api` y `worker` (D14; tareas 7.1, 7.3 y 7.3b).
- **Bucket de CV ausente al leer → error reintentable, no `null`** (D15; tarea 7.5b).
- **Autocreación del bucket sin cifrado (hallazgo de la 7.5b) → la subida del CV manda `ServerSideEncryption:
  'AES256'` en cada `PutObject`**, `verify` sigue exigiendo el cifrado por defecto, y la 7.5b se verifica con el caso
  aislado y un bucket que nunca existió (D17; tareas 7.5b y 7.5c).
- **KEK autogenerada sin clave → resolverlo y documentarlo**: guardia de arranque en el servicio (D16; tareas 7.1b,
  12.1 y 12.2).

**Respondidas por el usuario el 2026-09-26, antes del debate:**

- **Regla de parada → «no rebajar el cifrado de los CV por ganar días».** El usuario eligió no parar en el primer
  candidato con salidas, con este motivo: «el cifrado de los CV es lo último que conviene rebajar por ganar días de
  calendario».
  **Lectura de la iteración 1, confirmada por el usuario el 2026-09-26 junto con la retención por barrido** («Sí,
  adoptemos el barrido»; la tarea 1.1 lo anota como precondición cumplida): el motivo es el **cifrado**, no la
  expiración. Por eso «cumple todo» son las celdas duras + C5 `nativo`; la expiración de snapshots va **siempre** por
  el barrido del `worker` y C6 no se mide; el puntero es C5 `nativo` → orden de la lista (D1, iteración 2); y en la
  iteración 3 el cribado se detiene en el primero que pasa C1-C4 con C5 `nativo`. Con la regla anterior (C5 **y** C6
  `nativo`), un candidato con cifrado nativo y sin expiración obligaba a evaluar los otros dos enteros por una
  propiedad que el barrido cubre sin tocar ningún CV.
- **Paquete `linkvault-minio` → retirarlo sin borrarlo.** Se marca como retirado en su descripción tras su último uso en
  las comprobaciones de D9 (tareas 2.15 y 10.1); el borrado, irreversible, queda para más adelante.

Texto original de las dos preguntas, conservado como histórico:

- **Regla de parada.** Por defecto (D1), un candidato que necesita una salida no detiene la evaluación: se buscan los
  tres antes de aceptar una salida. Alternativa: parar en el primer candidato apto con salidas, que ahorra días de
  calendario y deja la garantía de CV en SSE-C sin mirar si otro la da nativa. No cambia las specs ni la lista de
  tareas (las de los candidatos 2 y 3 ya son condicionales); cambia cuántas se ejecutan.
- **El paquete `linkvault-minio` de GHCR.** Tras la falsación de D9 deja de tener uso. Opciones: borrarlo (irreversible)
  o dejarlo marcado como retirado en su descripción. Decide el usuario; no afecta a nada del repositorio.
