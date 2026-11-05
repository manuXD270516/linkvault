## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos exactos de los tests (`it(...)`), en
inglés; cada escenario de los deltas tiene al menos una prueba o una verificación nombrada. La falsación de un guardia
se hace, se ve caer lo nombrado y se restaura en la misma tarea. **Ninguna verificación imprime un valor de
credencial**: se comparan longitudes, sumas o presencia con `node`, y todo fichero temporal con valores se borra en la
misma tarea. Los tests que comprueban que algo no se imprime usan usuario, contraseña y host **aleatorios** generados en
el propio test (design D10, F17). Las órdenes que tocan el host o un `.env` real las ejecuta el owner (design D5).

- [ ] 0.1 [infra] Q1-Q5 del design respondidas por el owner y anotadas con su fecha en «Respuestas del owner y
  aprobación» del design y, en una línea por pregunta, en ADR-065 («Respuesta del owner (Qn), AAAA-MM-DD:»). Con
  Q1 = (b), se activan 2.0a y 2.0b; con Q1 = (c), el change vuelve a `/lv:debate` para fundirse con `staging-host`. Con
  Q5 = (b), el design vuelve a debate para sumar la autenticación en desarrollo antes de seguir. Con Q3 = (b), el design
  gana una D11. Con Q2 respondida, la fila en `docs/design-v0.2.md` §6 con el número que diga el owner. Verificar:
  `grep -cE "Respuesta del owner \(Q[1-5]\), 20" docs/adr/ADR-065.md` devuelve `5` (hoy `0`).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada en el
  design con su fecha. Verificar: la sección del debate de la última iteración dice «Convergencia: SI».
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

## 1. Inventario y mediciones (design D2, D3, D9)

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
- [ ] 1.3a [infra] Medir el guion del healthcheck de design D3 sobre un **volumen vacío**, en una pila propia del compose
  de producción con `infra/ci/verify.env`: diez arranques seguidos (`down -v` y `up -d --wait` cada vez). Verificar,
  anotado en el PR: los diez sanos, `RestartCount` de `mongo` en `0` en cada uno (`docker inspect` leído con `node`), la
  duración de cada latido (si pasa de 5 s, se sube el `timeout` en 2.1a y se anota) y la salida guardada de los latidos
  sin ninguna de las tres contraseñas (`node`: 0 coincidencias). Pila apagada con `down -v`.
- [ ] 1.3b [infra] Medir el guion sobre un **volumen con datos y raíz** (el estado de staging tras 35b): arrancar con el
  healthcheck de 35b, sembrar tres colecciones y contar con `counts.mongosh.js` (5.3); cambiar al healthcheck nuevo.
  Verificar: el primer latido crea `linkvault_app`; los recuentos son iguales; el SHA-256 de
  `usersInfo({showCredentials: true})` (calculado dentro del contenedor, solo la huella sale) es igual antes y después de
  un segundo latido («Latido sin cambios»). Pila apagada con `down -v`.
- [ ] 1.3c [infra] Medir el guion sobre un **volumen con datos y sin usuarios** («Volumen con datos y sin usuarios»):
  sembrar sin autenticación, contar, arrancar con el compose de producción. Verificar: `mongo` no sano, la salida del
  healthcheck es exactamente `AuthenticationFailed`, y tras `down` (sin `-v`) y arrancar sin autenticación los recuentos
  son los mismos. El procedimiento manual del README (`mongodump`/`mongorestore`, o `down -v` + `api:seed-demo`) se
  ejecuta una vez y se anota. Pila apagada con `down -v`.

## 2. Compose de producción (design D1, D2, D3, D7, D8)

- [ ] 2.0a [infra] **Solo con Q1 = (b).** Redis con `requirepass` en `docker-compose.prod.yml` según 35b D18 medida 3.
  Verificar como la 12.4 de 35b: `docker top` de `redis` sin la contraseña; sin `REDISCLI_AUTH` el healthcheck da
  `NOAUTH` y `unhealthy`, con ella `PONG`.
- [ ] 2.0b [infra] **Solo con Q1 = (b).** Mongo con autenticación según 35b D18 medida 3 (raíz, `keyFile` generado en el
  contenedor, uid 999, modo 400). Verificar como la 12.5 de 35b, con `docker top` de `mongo` sin la contraseña.
- [ ] 2.1a [infra] Healthcheck de `mongo`, pasos 1-3 y 5 de design D3 (`hello`, raíz, replica set, primario
  escribible) con el tratamiento de errores: 51003, 10107 y 11602 salen 1 sin imprimir; cualquier otro, 1 con solo su
  `codeName`. Verificar: `mongo` sano con `verify.env`; con una `MONGO_ROOT_PASSWORD` cambiada solo en el entorno del
  contenedor, la salida guardada es exactamente `AuthenticationFailed`. Falsación: imprimir `e.message` en lugar de
  `codeName` y ver que la salida guardada ya no es solo el código; restaurar.
- [ ] 2.1b [infra] Paso 4 de design D3: `MONGO_APP_PASSWORD: ${MONGO_APP_PASSWORD:?…}` en el entorno de `mongo`;
  crear o ajustar `linkvault_app` y comprobar su contraseña en una conexión aparte. Verificar «El healthcheck impone la
  contraseña del fichero de entorno sin mostrarla»: cambiar a mano la contraseña de `linkvault_app`, esperar un latido,
  y comprobar que autentica con la del `.env` y que `docker inspect` del estado de salud no contiene ninguna de las dos
  (`node`: 0 coincidencias); `usersInfo` muestra un solo rol `readWrite@linkvault`. Falsación: quitar la comprobación en
  conexión aparte y ver que, tras el cambio a mano, `api` no autentica; restaurar.
- [ ] 2.2 [infra] `MONGO_URI` de `api` y `worker` con `linkvault_app` (design D2) y sin `MONGO_ROOT_*` en su entorno.
  Verificar con `docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env config --format json` volcado
  a fichero y leído con `node` («La raíz no llega a las aplicaciones»): ninguna clave `MONGO_ROOT_*` ni
  `MONGO_APP_PASSWORD` en `api` ni `worker` y su `MONGO_URI` nombra `linkvault_app`; la readiness de los dos con
  `checks.mongo` en `up`.
- [ ] 2.3 [infra] `infra/ci/verify.env` con `MONGO_APP_PASSWORD` de relleno (prefijo `linkvault-ci-`, formato de D5),
  distinta de las otras dos. Verificar: `verify-artifact.sh` en verde en local y `grep -c "^MONGO_APP_PASSWORD="
  infra/ci/verify.env` devuelve `1`.
- [ ] 2.4a [infra] `infra/deploy/check-auth.sh`, parte de Mongo (design D10): desde `api`, con `node -e` y el driver de
  la imagen, una lectura sin credenciales falla con `Unauthorized`; con la `MONGO_URI` del contenedor, escribir y
  borrar un documento en una colección de prueba funciona (control); crear un usuario y leer `admin` fallan; ninguna
  clave `MONGO_ROOT_*` en `process.env` de `api` ni de `worker`. Cada fallo con un mensaje que nombra servicio y
  comprobación, sin valores. Añadido a `infra/deploy/config-files.txt`. Verificar: en verde contra la pila local de
  producción. Falsación de «La raíz en el entorno del worker»: en una copia del compose, `MONGO_ROOT_PASSWORD` en
  `worker`; falla nombrando a `worker`; restaurar.
- [ ] 2.4b [infra] `check-auth.sh`, parte de Redis, y su llamada desde una sección nueva de `infra/ci/verify-artifact.sh`:
  desde `worker`, con `net`, un `PING` sin `AUTH` responde `-NOAUTH`. Verificar: la sección en verde en el CI de la rama.
  Falsación de «Redis sin contraseña en la pila verificada»: en una copia del compose, Redis sin `requirepass`; la
  verificación falla nombrando a Redis; restaurar.
- [ ] 2.5 [infra] Ensayo de la vuelta atrás («Vuelta atrás tras migrar», design D8): sobre el volumen migrado de 1.3b,
  levantar el compose del commit anterior (el de 35b) con el mismo `--env-file`. Verificar: recuentos de
  `counts.mongosh.js` iguales a los de antes de migrar, readiness de `api` y `worker` con `mongo` y `redis` en `up`, y
  vuelta al compose nuevo otra vez sana con los mismos recuentos. Pila apagada con `down -v`.

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
  «rejects a production REDIS_URL without password», «accepts the verify.env URIs in production» (lee
  `infra/ci/verify.env`) y «accepts URIs without credentials outside production». Falsación: quitar la regla de Redis y
  ver caer el segundo; restaurar.
- [ ] 4.1b [backend] Test «never prints the URI when rejecting it» en `load-api-config.spec.ts`, con usuario, contraseña
  y host aleatorios: la salida de stderr capturada no contiene ninguno de los tres. Falsación: incluir el valor en el
  detalle del error y ver caer el test; restaurar.
- [ ] 4.2 [backend] La misma regla en `worker-config.schema.ts`, importada del módulo de 4.1a. Tests en
  `load-worker-config.spec.ts` con los cinco títulos de 4.1a y 4.1b. Verificar: los diez en verde y la regla definida
  una sola vez (`grep -rc` de su nombre de función en `apps/*/src/infrastructure/config/*.schema.ts` devuelve solo
  importaciones).
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
- [ ] 5.2a [infra] Ayudante `infra/datastore/mongo-shell.sh`: `docker compose … exec -T mongo mongosh` autenticado como
  raíz dentro de `--eval` desde el entorno del contenedor, con el script por la entrada estándar; sin argumentos con
  valores. Añadido a `infra/deploy/config-files.txt` (design D8). Verificar: con la pila local de producción, `echo
  'printjson(db.getName())' | bash infra/datastore/mongo-shell.sh` responde `linkvault`; `bash -n` en verde.
- [ ] 5.2b [infra] Las órdenes `mongosh` del RUNBOOK y `infra/staging/run.sh` usan el ayudante (o la misma
  autenticación en `--eval`); `infra/staging/seed-volume.sh` autentica solo si el contenedor de destino tiene
  `MONGO_ROOT_USER` en su entorno (design D9). Verificar: `grep -c 'mongosh "mongodb://localhost:27017' docs/RUNBOOK.md`
  devuelve `0`; una orden del RUNBOOK ejecutada contra la pila local de producción responde; `seed-volume.sh` siembra
  igual contra la pila de desarrollo (sin autenticación) y contra la de producción local; `run.sh` sigue aplicando
  `assert-readonly.mjs` (falsación: un script con `insertOne` rechazado antes de conectar).
- [ ] 5.3 [infra] `infra/staging/counts.mongosh.js`: recuento de documentos por colección de `linkvault`, de solo lectura,
  ejecutado por `run.sh` (design D8, F22). Verificar: `node infra/staging/assert-readonly.mjs
  infra/staging/counts.mongosh.js` pasa y su salida contra la pila local coincide con `countDocuments` hecho a mano en
  dos colecciones. Falsación: añadir un `updateOne` y ver que `assert-readonly.mjs` lo rechaza; restaurar.
- [ ] 5.4 [infra] Camino crítico e2e sin regresión con los puertos en `127.0.0.1`: `pnpm nx run web-e2e:e2e-stack --
  --project=chromium` en verde. Verificar: salida anotada en el PR; si el entorno de la sesión no ve los listeners, la
  corrida del workflow `e2e` con `target=local` en la rama.

## 6. Validación en el repositorio y antes del `up` (design D5, D7)

- [ ] 6.1 [infra] `infra/ci/check-env-file.mjs`: la regla de formato de 35b **extendida** a `MONGO_APP_PASSWORD` (misma
  función, no copiada); cada contraseña de la lista cerrada distinta de todo valor de relleno versionado (de
  `infra/ci/verify.env` y `.env.example`, como variables y como contraseña de `MONGO_URI`/`REDIS_URL` extraída con
  `new URL()`; si no se encuentran los ficheros, la comprobación falla) y distintas entre sí. Verificar con ficheros de
  prueba en el directorio temporal de la sesión, con valores aleatorios: uno correcto pasa; uno con la de relleno de
  `verify.env` («Un valor de relleno en el fichero de entorno del host»), uno con `/` en `MONGO_APP_PASSWORD` («Una
  contraseña que rompería la URI») y uno con dos iguales fallan cada uno nombrando su comprobación; la salida de los
  cuatro, buscada con `node`, no contiene ningún valor. Ficheros borrados.
- [ ] 6.2 [infra] `.env.example` declara `REDIS_PASSWORD`, `MONGO_ROOT_PASSWORD` y `MONGO_APP_PASSWORD` sin valor, en
  la sección de despliegue, con un comentario que remite al README; regla de `compose-env-contract`: cada variable de la
  lista cerrada usada por `docker-compose.prod.yml` está declarada en `.env.example`. Verificar: `bash
  infra/ci/repo-checks.sh` en verde. Falsación de «Una contraseña de la lista cerrada sin declarar en el ejemplo»:
  quitar `MONGO_APP_PASSWORD` de `.env.example` y ver fallar nombrándola; restaurar.
- [ ] 6.3a [infra] Reglas de `compose-env-contract` sobre `api` y `worker` (design D7.3): ninguna clave `MONGO_ROOT_*`
  ni `MONGO_APP_PASSWORD`; ningún valor con `${MONGO_ROOT_`; `${MONGO_APP_PASSWORD` solo dentro de `MONGO_URI`.
  Verificar: en verde. Falsación, una por regla, restaurando cada vez: `MONGO_ROOT_PASSWORD` como clave en `worker`;
  `${MONGO_ROOT_PASSWORD:?}` dentro del `MONGO_URI` de `api`; `${MONGO_APP_PASSWORD:?}` en otra variable de `worker`.
  Cada una falla nombrando servicio y regla.
- [ ] 6.3b [infra] Regla de `compose-env-contract` sobre la lista cerrada (design D7.3, F3): toda coincidencia de
  `(?<!\$)\$\{(REDIS_PASSWORD|MONGO_ROOT_PASSWORD|MONGO_APP_PASSWORD)` en `docker-compose.prod.yml` es `${VAR:?…}`;
  `MAIL_SMTP_PASSWORD` no está en la lista, como excepción nombrada en el propio check. Verificar: en verde, y una
  `$${MONGO_ROOT_PASSWORD}` dentro de un `command` no cuenta. Falsación de «Una contraseña con valor por defecto en el
  compose de producción»: `${REDIS_PASSWORD:-x}` y ver fallar nombrando `REDIS_PASSWORD`; `${MONGO_APP_PASSWORD}` a
  secas y ver fallar nombrándola; restaurar.

## 7. Rotación y documentación (design D6, D8)

- [ ] 7.1 [infra] Ensayo de rotación del usuario de aplicación y de Redis en la pila local de producción con datos
  sembrados («Rotar la contraseña del usuario de aplicación», «Rotar la contraseña de Redis con un job pendiente»):
  recuentos y SHA-256 de `usersInfo({showCredentials: true})` antes; nueva `MONGO_APP_PASSWORD` y `up -d`; recuentos
  iguales, huella distinta, `api` y `worker` sanos, la anterior no autentica. Con el worker parado, guardar un link (job
  `enrich-link` en espera), nueva `REDIS_PASSWORD` y `up -d`: el job se procesa y la anterior responde `WRONGPASS`.
  Verificar: recuentos, huellas y resultados anotados en el PR, sin valores.
- [ ] 7.2 [infra] Documentación. En `docs/RUNBOOK.md`, la sección «Credenciales de Mongo y Redis» **reemplaza** la de
  Mongo de 35b: generación con la orden de D5 que agrega la línea sin mostrarla; dónde viven; la tabla de rotación de
  D6 con «cuándo»; la rotación de la raíz en el orden de D6 (`.env` y copia → `updateUser` con la actual del entorno del
  contenedor y la nueva por la entrada estándar → `up -d mongo`); el healthcheck que impone la contraseña de la
  aplicación; que el `keyFile` no se rota; y que `collMod` lo ejecuta el operador con la raíz por el ayudante. En
  `infra/README.md`, el párrafo de `down -v` de 35b pasa al procedimiento de D8 (volumen con datos y sin usuarios:
  `mongodump`/`mongorestore`, o `down -v` + `api:seed-demo`) y `MONGO_APP_PASSWORD` se suma a lo que vive solo en el
  host, con qué se pierde sin ella. Verificar con un `node -e` que encuentre la sección, las tres variables,
  `mongodump`, `mongorestore`, `collMod` y «por evento», y que el README ya no diga que un volumen anterior se resuelve
  solo con `down -v`; y, para «El procedimiento de la raíz no pasa contraseñas por argumentos», que ninguna línea de
  código de esa sección contenga `--password`, `-p ` ni `$MONGO_ROOT_PASSWORD` como argumento.

## 8. Staging (design D8; las ejecuta el owner)

- [ ] 8.1 [infra] **[bloqueada: owner]** Antes de fusionar: el owner genera `MONGO_APP_PASSWORD` con la orden de D5
  (agrega la línea sin mostrarla) en `.env.staging` y en su copia fuera del host; ejecuta **en su máquina**
  `node infra/ci/check-env-file.mjs <copia>` desde el árbol del commit a desplegar y compara la suma de la copia con la
  del host (regla de 35b); hace `mongodump --archive` desde el contenedor `mongo` de staging y lo guarda fuera del host;
  y ejecuta `counts.mongosh.js` por `run.sh`. Verificar: confirmación escrita del owner en el PR, «8.1 hecha el
  AAAA-MM-DD: check-env-file PASS; sumas iguales; copia guardada fuera del host», con los recuentos y sin valores.
- [ ] 8.2 [infra] **[bloqueada: 8.1 y fusión en una ventana autorizada por el owner]** Tras el despliegue del push
  («Staging con la raíz de antes»): en el host, `bash infra/deploy/check-auth.sh` en verde y `counts.mongosh.js` con los
  mismos recuentos que en 8.1; la corrida dice «desplegado a staging». Si el `up` abortó por falta de la variable
  («Falta la contraseña nueva»), anotar que los contenedores conservaron su identificador, completar 8.1 y relanzar solo
  el job de despliegue. Verificar: salidas anotadas en el PR, sin credenciales.

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
