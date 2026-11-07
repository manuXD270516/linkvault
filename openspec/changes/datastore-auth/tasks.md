## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos exactos de los tests (`it(...)`), en
inglés; cada escenario de los deltas tiene al menos una prueba o una verificación nombrada. La falsación de un guardia
se hace, se ve caer lo nombrado y se restaura en la misma tarea. **Ninguna verificación imprime un valor de
credencial**: se comparan longitudes, sumas o presencia con `node`, y todo fichero temporal con valores se borra en la
misma tarea. Los tests que comprueban que algo no se imprime usan usuario, contraseña y host **aleatorios** generados en
el propio test (design D10, F17). Las órdenes que tocan el host o un `.env` real las ejecuta el owner (design D5). Las
pilas locales del compose de producción parten del bloque de la pila local de `infra/README.md` (pasos 1-5), con su
propio `--env-file` y proyecto de compose, y se apagan con `down -v` al terminar cada tarea.

- [ ] 0.1 [infra] Q2-Q5 del design respondidas por el owner y anotadas con su fecha en «Respuestas del owner y
  aprobación» del design y, en una línea por pregunta, en ADR-065 («Respuesta del owner (Qn), AAAA-MM-DD:»). Q1 ya está
  cerrada por los hechos (design D1). Con Q5 = (b), el design vuelve a debate para sumar la autenticación en desarrollo
  antes de seguir. Con Q3 = (b), el design gana una D11. Con Q2 respondida, la fila en `docs/design-v0.2.md` §6 con el
  número que diga el owner. Verificar: `grep -cE "Respuesta del owner \(Q[2-5]\), 20" docs/adr/ADR-065.md` devuelve `4`
  (hoy `0`).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada en el
  design con su fecha. Verificar: la sección del debate de la última iteración dice «Convergencia: SI» y «Respuestas del
  owner y aprobación» tiene fecha.
- [ ] 0.3 [infra] Precondiciones (design D1, B1, B10):
  1. `verify-reusable-workflow` (35c), `staging-host` (35b) y `cv-extract-isolation` archivados.
  2. El requirement «La pila de staging separa la red de cada proceso y no deja datos sin credenciales» en
     `openspec/specs/platform/production-deploy/spec.md`.
  3. El requirement de aislamiento del hijo en `openspec/specs/cv/extraction/spec.md` y el test «the child sees none of
     the worker variables» en `apps/worker`.
  4. El `mongo` y el `redis` de `docker-compose.prod.yml` en `main` releídos contra «Lo que trae 35b» del design.
  5. Confirmación escrita del owner en el PR, sin valores: «las contraseñas de 35b cumplen D5».

  Verificar: `ls openspec/changes/archive | grep -c -E "staging-host|verify-reusable-workflow|cv-extract-isolation"`
  devuelve `3`; `grep -c "no deja datos sin credenciales" openspec/specs/platform/production-deploy/spec.md` devuelve
  `1`; `grep -rc "the child sees none of the worker variables" apps/worker/src` encuentra al menos una; la comparación
  punto por punto y la confirmación del owner quedan en el PR. Si algo difiere, el design vuelve a 0.2.

## 1. Herramientas previas, inventario y mediciones (design D2, D3, D8, D9)

- [ ] 1.0a [infra] Ayudante `infra/datastore/mongo-shell.sh -f <compose> --env-file <env>` (design D8, C5): `docker
  compose -f … --env-file … exec -T mongo mongosh` con el script por la entrada estándar; si el contenedor tiene
  `MONGO_INITDB_ROOT_USERNAME`, antepone dentro de `--eval` la autenticación como raíz leyendo `process.env`; si no, no
  autentica. Ningún argumento lleva valores. Añadido a `infra/deploy/config-files.txt`. Verificar: `bash -n` en verde;
  `echo 'print(db.getName())' | bash infra/datastore/mongo-shell.sh -f docker-compose.yml --env-file .env.example`
  responde `linkvault` contra la pila de desarrollo y lo mismo con `-f docker-compose.prod.yml` y el env file de una pila
  local de producción. Falsación: quitar la autenticación y ver que contra la pila de producción la orden falla con
  `Unauthorized`; restaurar.
- [ ] 1.0b [infra] Siembra y recuento versionados (design D8, C11, F22): `infra/datastore/seed-sample.mongosh.js` (tres
  colecciones de `linkvault` con un recuento conocido) e `infra/staging/counts.mongosh.js` (recuento por colección, de
  solo lectura). Verificar: `node infra/staging/assert-readonly.mjs infra/staging/counts.mongosh.js` pasa; sembrar por el
  ayudante en la pila de desarrollo y contar da exactamente el recuento conocido. Falsación: añadir un `updateOne` a
  `counts.mongosh.js` y ver que `assert-readonly.mjs` lo rechaza; restaurar.
- [ ] 1.1 [backend] Inventario de órdenes de MongoDB que exigen más que `readWrite`. Buscar en `apps/`, `libs/`,
  `tools/` e `infra/` (`runCommand`, `.command(`, `admin()`, `getSiblingDB`, `collMod`, `createCollection` con
  `validator`, `convertToCapped`, `renameCollection`, `$out`, `$merge` a otra base, `listDatabases`, `serverStatus`,
  `currentOp`, `killOp`, `createUser`, `grantRolesToUser`, `setFeatureCompatibilityVersion`, `syncIndexes`, `dropIndex`)
  y anotar en el PR cada uso con su fichero y si `readWrite@linkvault` lo cubre. Verificar: la lista queda en el PR; cada
  uso no cubierto tiene decisión escrita (rol propio con esa acción, nunca `dbAdmin` ni la raíz) antes de 2.2.
- [ ] 1.2 [backend] Prueba de integración con autenticación en `apps/api/src/infrastructure/persistence/
  mongo-app-user.integration.spec.ts`: un `MongoMemoryReplSet` con autenticación (opción `auth` de
  `mongodb-memory-server-core`), un usuario `linkvault_app` con `readWrite@linkvault` creado por la raíz del test, y
  tres tests: «app user commits a transaction and creates an index», «app user cannot create users, read admin or write
  another database» y «rejects an unauthenticated read». Si la versión del paquete no admite autenticación en replica
  set, se anota y los tres casos pasan a `check-auth.sh` (2.4a). Verificar: los tres en verde. Falsación: dar al usuario
  `read` en vez de `readWrite` y ver caer el primero; restaurar.
- [ ] 1.3a [infra] Medir el guion del healthcheck de design D3 sobre un **volumen vacío**, en una pila local del compose
  de producción: diez arranques seguidos (`down -v` y `up -d --wait` cada vez). Verificar, anotado en el PR: los diez
  sanos, `RestartCount` de `mongo` en `0` en cada uno (`docker inspect` leído con `node`), la duración de cada latido (si
  pasa de 5 s, se sube el `timeout` en 2.1a y se anota) y la salida guardada de los latidos sin ninguna de las tres
  contraseñas (`node`: 0 coincidencias).
- [ ] 1.3b [infra] Medir el guion sobre un **volumen con datos y raíz** (el estado de staging tras 35b): arrancar con el
  healthcheck de 35b, sembrar con `seed-sample.mongosh.js` por el ayudante y contar con `counts.mongosh.js`; cambiar al
  healthcheck nuevo. Verificar: el primer latido crea `linkvault_app`; los recuentos son iguales; el SHA-256 de
  `usersInfo({showCredentials: true})` (calculado dentro del contenedor; solo la huella sale) es igual antes y después de
  un segundo latido («Latido sin cambios»).
- [ ] 1.3c-i [infra] Preparar un **volumen con datos y sin usuarios** (C11): sobre un volumen nombrado nuevo, un
  contenedor `mongo:7.0.43` **sin autenticación** (`--replSet rs0`, `rs.initiate`), sembrar con
  `seed-sample.mongosh.js`, contar y pararlo. Verificar: el recuento conocido, anotado en el PR.
- [ ] 1.3c-ii [infra] Arrancar el compose de producción sobre ese volumen («Volumen con datos y sin usuarios»).
  Verificar: `mongo` no sano y la salida guardada del healthcheck es exactamente `AuthenticationFailed`; tras `down` (sin
  `-v`) y volver a arrancar el `mongo:7.0.43` sin autenticación, los recuentos son los mismos. Ejecutar una vez el
  procedimiento manual del README (`mongodump` desde la pila sin autenticación, volumen nuevo y
  `mongorestore --nsInclude 'linkvault.*'` como raíz en la pila de producción) y anotar que los recuentos coinciden.

## 2. Compose de producción (design D2, D3, D7, D8)

- [ ] 2.1a [infra] Healthcheck de `mongo`, pasos 1-3 y 5 de design D3 (`hello`, raíz con `MONGO_INITDB_ROOT_*`,
  replica set, primario escribible) con el tratamiento de errores: los códigos de reintento salen 1 sin imprimir;
  cualquier otro, 1 con solo `e.codeName ?? e.name`. **Provocar cada código de reintento** (10107, 11602 y 51003, por
  ejemplo con `rs.stepDown` o `replSetFreeze` durante un latido, o un `rs.reconfig` que fuerce una elección) y anotar en
  el PR cómo se provocó cada uno y qué devolvió; **51003 sale de la lista** si no se consigue provocarlo o su significado
  no es «reintentar» (design D3). Verificar: `mongo` sano con el env file de la pila local; con una
  `MONGO_ROOT_PASSWORD` cambiada solo en el entorno del contenedor, la salida guardada es exactamente
  `AuthenticationFailed`. Falsación: imprimir `e.message` en lugar del código y ver que la salida guardada deja de ser
  solo el código; restaurar.
- [ ] 2.1b [infra] Paso 4 de design D3: `MONGO_APP_PASSWORD: ${MONGO_APP_PASSWORD:?…}` en el entorno de `mongo`; crear
  o ajustar `linkvault_app` y comprobar su contraseña en una conexión aparte. Verificar «El healthcheck impone la
  contraseña del fichero de entorno sin mostrarla»: cambiar a mano la contraseña de `linkvault_app`, esperar un latido,
  y comprobar que autentica con la del env file y que `docker inspect` del estado de salud no contiene ninguna de las
  dos (`node`: 0 coincidencias); `usersInfo` muestra un solo rol `readWrite@linkvault`. Falsación: quitar la comprobación
  en conexión aparte y ver que, tras el cambio a mano, `api` no autentica; restaurar.
- [ ] 2.2 [infra] `MONGO_URI` de `api` y `worker` con `linkvault_app` (design D2) y sin credenciales de la raíz.
  Verificar con `docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env config --format json` volcado
  a fichero y leído con `node` («La raíz no llega a las aplicaciones»): ninguna clave `MONGO_ROOT_*` ni
  `MONGO_APP_PASSWORD` en `api` ni `worker` y su `MONGO_URI` nombra `linkvault_app`; la readiness de los dos con
  `checks.mongo` en `up`.
- [ ] 2.3 [infra] `infra/ci/verify.env` con `MONGO_APP_PASSWORD` de relleno (estilo de los de 35b en ese fichero,
  formato de D5), distinta de las otras dos. Verificar: `verify-artifact.sh` en verde en local y `grep -c
  "^MONGO_APP_PASSWORD=" infra/ci/verify.env` devuelve `1`.
- [ ] 2.4a [infra] `infra/deploy/check-auth.sh <compose-file> <env-file>`, parte de Mongo (design D10, C9): desde `api`,
  con `node -e` y el driver de la imagen, una lectura sin credenciales falla con `Unauthorized`; con la `MONGO_URI` del
  contenedor, escribir un documento en una colección de control y **borrar la colección entera** funciona (control);
  crear un usuario y leer `admin` fallan; ninguna clave `MONGO_ROOT_*` en `process.env` de `api` ni de `worker`. Cada
  fallo nombra servicio y comprobación, sin valores. Añadido a `infra/deploy/config-files.txt`. Verificar: en verde
  contra una pila local de producción, y la colección de control no existe al terminar. Falsación de «La raíz en el
  entorno del worker»: en una copia del compose, `MONGO_ROOT_PASSWORD` en `worker`; falla nombrando a `worker`;
  restaurar.
- [ ] 2.4b [infra] `check-auth.sh`, parte de Redis, y su llamada desde una sección nueva de `infra/ci/verify-artifact.sh`
  con el compose y `verify.env`: desde `worker`, con `net`, un `PING` sin `AUTH` responde `-NOAUTH`. Verificar: la
  sección en verde en el CI de la rama, y la readiness de `api` y `worker` de esa misma corrida cubre «La configuración
  de la verificación en CI arranca» (C8). Falsación de «Redis sin contraseña en la pila verificada»: en una copia del
  compose, Redis sin `requirepass`; la verificación falla nombrando a Redis; restaurar.
- [ ] 2.5 [infra] Ensayo de la vuelta atrás («Vuelta atrás tras migrar», design D8): sobre el volumen migrado de 1.3b,
  levantar el compose del commit anterior (el de 35b) con el mismo env file. Verificar: recuentos de `counts.mongosh.js`
  iguales a los de antes de migrar, readiness de `api` y `worker` con `mongo` y `redis` en `up`, y vuelta al compose
  nuevo otra vez sana con los mismos recuentos.

## 3. Desarrollo (design D4, Q5 (a))

- [ ] 3.1 [infra] Todos los `ports` de `docker-compose.yml` como `'127.0.0.1:${…_PORT:-…}:<puerto>'`, y una
  comprobación nueva de `tools/repo-checks` (agregada a `check`) que falla nombrando el servicio cuyo puerto publicado no
  lleva ese prefijo. Verificar «Puertos atados al equipo»: `docker compose --profile ai-local --profile search
  --profile demo config --format json` leído con `node`: cada `published` con `host_ip` `127.0.0.1`; «Las apps del host
  siguen conectando»: `pnpm infra:up` y `nx serve api`/`worker` con `/health` en `up`; `bash infra/ci/repo-checks.sh` en
  verde. Falsación de «Un puerto publicado en todas las interfaces»: quitar el prefijo a `mailpit` y ver fallar
  nombrándolo; restaurar.

## 4. Aplicaciones (design D7)

- [ ] 4.1a [backend] Regla compartida (un módulo de configuración que usan los dos esquemas, fuera del índice de
  `@linkvault/shared`, que llega al SPA): con `NODE_ENV=production`, `MONGO_URI` exige usuario y contraseña y
  `REDIS_URL` contraseña; sin comparar contra valores de relleno (design D7.1). Aplicada en `api-config.schema.ts`.
  Tests en `load-api-config.spec.ts`: «rejects a production MONGO_URI without credentials naming the variable»,
  «rejects a production REDIS_URL without password», «accepts URIs with credentials in production» y «accepts URIs
  without credentials outside production». Falsación: quitar la regla de Redis y ver caer el segundo; restaurar.
- [ ] 4.1b [backend] Test «never prints the URI when rejecting it» en `load-api-config.spec.ts`, con usuario, contraseña
  y host aleatorios: la salida de stderr capturada no contiene ninguno de los tres. Falsación: incluir el valor en el
  detalle del error y ver caer el test; restaurar.
- [ ] 4.2 [backend] La misma regla en `worker-config.schema.ts`, importada del módulo de 4.1a. Tests en
  `load-worker-config.spec.ts` con los cinco títulos de 4.1a y 4.1b. Verificar: los diez en verde y la regla definida una
  sola vez (los dos esquemas solo la importan).
- [ ] 4.3 [backend] Redactor (`logger-params.ts` de `api` y su gemelo de `worker`, si existe): `MONGO_URI`,
  `REDIS_URL`, `REDIS_PASSWORD`, `MONGO_ROOT_PASSWORD` y `MONGO_APP_PASSWORD`. Test «redacts MONGO_URI and REDIS_URL
  values» con valores aleatorios: ningún valor en la salida y las dos claves con `[Redacted]`. Falsación: quitar
  `REDIS_URL` de la lista y ver caer el test; restaurar.
- [ ] 4.4 [backend] Avisos de conexión con código (`mongo-initial-connect-retry.ts` y `redis-health-client.ts`, en
  `api` y `worker`): nombre del error y, de MongoDB, su `codeName`; de un `ReplyError` de Redis, solo el token de
  {`NOAUTH`, `WRONGPASS`} si el mensaje empieza por él, y nada más del mensaje. Tests: «logs the error code but not the
  URI when the initial MongoDB connection fails authentication» contra el replica set con autenticación de 1.2 o, si 1.2
  no lo admitió, contra un doble de `MongoServerError` con `codeName: 'AuthenticationFailed'` y un mensaje con usuario,
  contraseña y host aleatorios; y «logs only WRONGPASS from a Redis reply error» con un `ReplyError` cuyo mensaje lleva
  texto aleatorio tras el token. Falsación: registrar `error.message` y ver caer los dos; restaurar.

## 5. Herramientas (design D8, D9)

- [ ] 5.1 [backend] `withPort` de `apps/web-e2e/scripts/e2e-stack.ts` extraído a `scripts/lib/uri-port.ts` con una
  expresión que salta la parte de usuario y contraseña. Tests en `uri-port.spec.ts`: «keeps user and password when
  rewriting the port of a mongodb URI», «keeps the password when rewriting the port of a redis URI», «rewrites the port
  when the password starts with digits» y «leaves a URI without port unchanged». Falsación: volver a la expresión
  actual y ver caer el primero; restaurar.
- [ ] 5.2a [infra] RUNBOOK (C5): las 48 órdenes `docker compose exec mongo mongosh "mongodb://localhost:27017/…"` pasan
  a `bash infra/datastore/mongo-shell.sh -f <compose> --env-file <env>` con el script por la entrada estándar.
  `infra/staging/run.sh` y `infra/staging/seed-volume.sh` no se tocan (design D9, C4). Verificar: `grep -c 'mongosh
  "mongodb://localhost:27017' docs/RUNBOOK.md` devuelve `0` (hoy `48`) y `git diff --name-only` no incluye `run.sh` ni
  `seed-volume.sh`.
- [ ] 5.2b [infra] Verificación de las órdenes del RUNBOOK contra las dos pilas: tres órdenes de lectura del RUNBOOK
  (una de índices, una de búsqueda por email y una agregación) ejecutadas contra la pila de desarrollo (sin
  autenticación) y contra una pila local de producción (con autenticación), sembradas con `seed-sample.mongosh.js`.
  Verificar: las seis responden sin error, anotado en el PR sin datos personales.
- [ ] 5.3 [infra] Camino crítico e2e sin regresión con los puertos en `127.0.0.1`: `pnpm nx run web-e2e:e2e-stack --
  --project=chromium` en verde. Verificar: salida anotada en el PR; si el entorno de la sesión no ve los listeners, la
  corrida del workflow `e2e` con `target=local` en la rama.

## 6. Validación en el repositorio y antes del `up` (design D5, D7)

- [ ] 6.1 [infra] `infra/ci/check-env-file.mjs`: la regla de formato de 35b **extendida** a `MONGO_APP_PASSWORD` (misma
  función, no copiada); cada contraseña de la lista cerrada distinta de todo valor de relleno versionado (de
  `infra/ci/verify.env` y `.env.example`, como variables y como contraseña de `MONGO_URI`/`REDIS_URL` extraída con
  `new URL()`; si no se encuentran los ficheros, la comprobación falla) y distintas entre sí. Verificar con ficheros de
  prueba en el directorio temporal de la sesión, con valores aleatorios: uno correcto pasa; uno con la de relleno de
  `verify.env` («Un valor de relleno en el fichero de entorno del host»), uno con la de relleno de `.env.example`, uno
  con `/` en `MONGO_APP_PASSWORD` («Una contraseña que rompería la URI») y uno con dos iguales fallan cada uno nombrando
  su comprobación; la salida de los cinco, buscada con `node`, no contiene ningún valor. Ficheros borrados.
- [ ] 6.2 [infra] `.env.example` declara `MONGO_APP_PASSWORD` **con relleno** del estilo de 35b
  (`dev-only-mongo-app-password-not-a-secret-change-me`), junto a los de 35b, con un comentario que remite al README
  (C1); regla de `compose-env-contract`: cada variable de la lista cerrada usada por `docker-compose.prod.yml` está
  declarada en `.env.example`. Verificar: `bash infra/ci/repo-checks.sh` en verde. Falsación de «Una contraseña de la
  lista cerrada sin declarar en el ejemplo»: quitar `MONGO_APP_PASSWORD` de `.env.example` y ver fallar nombrándola;
  restaurar.
- [ ] 6.3a [infra] Reglas de `compose-env-contract` sobre `api` y `worker` (design D7.3): ninguna clave `MONGO_ROOT_*`
  ni `MONGO_APP_PASSWORD`; ningún valor con `${MONGO_ROOT_`; `${MONGO_APP_PASSWORD` solo dentro de `MONGO_URI`.
  Verificar: en verde. Falsación, una por regla, restaurando cada vez: `MONGO_ROOT_PASSWORD` como clave en `worker`;
  `${MONGO_ROOT_PASSWORD:?}` dentro del `MONGO_URI` de `api` (el estado de hoy); `${MONGO_APP_PASSWORD:?}` en otra
  variable de `worker`. Cada una falla nombrando servicio y regla.
- [ ] 6.3b [infra] Regla de `compose-env-contract` sobre la lista cerrada (design D7.3, F3): toda coincidencia de
  `(?<!\$)\$\{(REDIS_PASSWORD|MONGO_ROOT_PASSWORD|MONGO_APP_PASSWORD)` en `docker-compose.prod.yml` es `${VAR:?…}`;
  `MAIL_SMTP_PASSWORD` no está en la lista, como excepción nombrada en el propio check. Verificar: en verde, y la
  `$$REDIS_PASSWORD` del `command` de `redis` no cuenta. Falsación de «Una contraseña con valor por defecto en el
  compose de producción»: `${REDIS_PASSWORD:-x}` y ver fallar nombrando `REDIS_PASSWORD`; `${MONGO_APP_PASSWORD}` a
  secas y ver fallar nombrándola; restaurar.

## 7. Rotación y documentación (design D6, D8)

- [ ] 7.1a [infra] Ensayo de rotación del usuario de aplicación («Rotar la contraseña del usuario de aplicación») en
  una pila local de producción sembrada: recuentos y SHA-256 de `usersInfo({showCredentials: true})` antes; nueva
  `MONGO_APP_PASSWORD` en el env file y `up -d`. Verificar: recuentos iguales, huella distinta, `api` y `worker` sanos y
  la anterior no autentica; anotado en el PR sin valores.
- [ ] 7.1b [infra] Ensayo de rotación de Redis («Rotar la contraseña de Redis con un job pendiente») en la misma pila:
  con el worker parado, dejar un job `enrich-link` en espera **por el outbox** (un evento insertado por el ayudante en
  `outbox_events`, que el relay de `api` publica) o encolándolo con el ayudante, nunca por la API; nueva
  `REDIS_PASSWORD` y `up -d`. Verificar: el job se procesa y la anterior responde `WRONGPASS`; anotado en el PR.
- [ ] 7.1c [infra] Ensayo de la rotación de la raíz (C6), en 45 minutos o menos, siguiendo la sección del RUNBOOK en una
  pila local de producción: (1) la nueva en un temporal con modo 600; (2) `updateUser` con la actual del entorno del
  contenedor y la nueva por la entrada estándar; (3) env file, copia, borrar el temporal y `up -d mongo`. Verificar:
  tras el paso 2, la nueva autentica y la anterior no; tras el paso 3, `mongo` sano y `api` y `worker` en `up`; `stat`
  del temporal mostró `600` mientras existió. Anotar en el PR también el caso «el paso 2 falla» ensayado con una actual
  incorrecta: nada cambia y la actual sigue autenticando.
- [ ] 7.2 [infra] Documentación:
  - `docs/RUNBOOK.md`: la sección «Credenciales de Mongo y Redis» **reemplaza** la de Mongo de 35b, con la generación
    de D5 (agrega la línea sin mostrarla), dónde viven, la tabla de rotación de D6 con «cuándo», la rotación de la raíz
    en el orden de D6 con qué hacer si el paso 2 falla, el aviso de correr `check-env-file.mjs` tras cada rotación
    (R8), el healthcheck que impone la contraseña de la aplicación, que el `keyFile` no se rota y que `collMod` lo
    ejecuta el operador con la raíz por el ayudante.
  - `infra/README.md`: el párrafo «Un volumen de Mongo anterior a D18» pasa al procedimiento de D8 (`mongodump`, volumen
    nuevo, `mongorestore --nsInclude 'linkvault.*'`; o `down -v`, que pierde los datos); `MONGO_APP_PASSWORD` se suma a
    lo que vive solo en el host, con qué se pierde sin ella; y el anexo de secretos de la pila local (paso 2) genera
    también `MONGO_APP_PASSWORD`, con el mismo cambio en `verify-artifact.sh` (C2).

  Verificar: ejecutar los pasos 2 y 4 del bloque de la pila local del README (el `config` sale con 0);
  `bash infra/ci/repo-checks.sh` en verde (`docs-stack-up`); un `node -e` que encuentre en el RUNBOOK la sección, las
  tres variables, `mongodump`, `mongorestore --nsInclude`, `collMod`, `check-env-file` y «por evento», y que el README ya
  no diga que un volumen anterior se arregla con `down -v` sin más; y, para «El procedimiento de la raíz no pasa
  contraseñas por argumentos», que ninguna línea de código de esa sección contenga `--password`, `-p ` ni
  `$MONGO_ROOT_PASSWORD` como argumento.

## 8. Staging (design D8; las ejecuta el owner)

- [ ] 8.1 [infra] **[bloqueada: owner]** Antes de fusionar: el owner genera `MONGO_APP_PASSWORD` con la orden de D5
  (agrega la línea sin mostrarla) en `.env.staging` y en su copia fuera del host; ejecuta **en su máquina**
  `node infra/ci/check-env-file.mjs <copia>` desde el árbol del commit a desplegar y compara la suma de la copia con la
  del host (regla de 35b); hace `mongodump --archive` desde el contenedor `mongo` de staging y lo guarda fuera del host;
  y ejecuta `counts.mongosh.js` por `run.sh`. Verificar: confirmación escrita del owner en el PR, «8.1 hecha el
  AAAA-MM-DD: check-env-file PASS; sumas iguales; copia guardada fuera del host», con los recuentos y sin valores.
- [ ] 8.2 [infra] **[bloqueada: 8.1 y fusión en una ventana autorizada por el owner]** Tras el despliegue del push
  («Staging con la raíz de antes»): en el host, primero `counts.mongosh.js` por `run.sh` (los mismos recuentos que en
  8.1) y después `bash infra/deploy/check-auth.sh docker-compose.prod.yml .env.staging` en verde; la corrida dice
  «desplegado a staging». Si el `up` abortó por falta de la variable («Falta la contraseña nueva»), anotar que los
  contenedores conservaron su identificador, completar 8.1 y relanzar solo el job de despliegue. Verificar: salidas
  anotadas en el PR, sin credenciales.

## 9. Cierre

- [ ] 9.1 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar: salida anotada en el PR.
- [ ] 9.2 [infra] `pnpm exec openspec validate --all --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en
  verde. Verificar: salidas anotadas en el PR.
- [ ] 9.3 [infra] Al archivar: ADR-065 a «Aceptado» con fecha, PR y hash del merge; una línea que apunte a ADR-065 en
  ADR-051 (riesgo «Mongo de producción no tiene autenticación»: cerrado, las apps entran con mínimo privilegio), ADR-056
  §6 (punto «contraseñas en Redis y Mongo») y ADR-058 (riesgo «El hijo tiene red»: el hijo, con `env: {}`, sigue
  alcanzando Mongo y Redis por red pero ya no puede usarlos sin credenciales; la red sigue abierta hasta Node 26 LTS).
  Verificar: `grep -c "ADR-065"` devuelve al menos `1` en cada uno de los tres y `grep -n "^\*\*Estado:\*\* Aceptado"
  docs/adr/ADR-065.md` devuelve una línea.
- [ ] 9.4 [infra] Al archivar: la fila de `docs/design-v0.2.md` §6 (la de 0.1) con el estado «archivado» y la entrada
  de `openspec-changes.yaml` actualizada. Verificar: `grep -c "datastore-auth" docs/design-v0.2.md` devuelve al menos
  `1`.
- [ ] 9.5 [infra] Fuera de alcance comprobado (design Non-Goals): el change no toca el flag de red de Node.
  Verificar: `git diff origin/main...HEAD -- apps libs docker docker-compose.yml docker-compose.prod.yml | grep -c --
  "--allow-net"` devuelve `0`; si al aplicar el proyecto ya estuviera en Node 26 LTS, se anota en el PR y se avisa al
  owner para abrir aquel change, sin hacerlo aquí.
