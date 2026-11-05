## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos exactos de los tests (`it(...)`), en
inglés; cada escenario de los deltas tiene al menos una prueba o una verificación nombrada. La falsación de un guardia
se hace, se ve caer lo nombrado y se restaura en la misma tarea. **Ninguna verificación imprime un valor de
credencial**: se comparan longitudes, sumas o presencia con `node`, y todo fichero temporal con valores se borra en la
misma tarea. Las órdenes que tocan el host o un `.env` real las ejecuta el owner (design D5).

- [ ] 0.1 [infra] Q1-Q4 del design respondidas por el owner y anotadas con su fecha en «Respuestas del owner y
  aprobación» del design y, en una línea por pregunta, en ADR-065 («Respuesta del owner (Qn), AAAA-MM-DD:»). Con
  Q1 = (b), se activan 2.0a y 2.0b; con Q1 = (c), el change vuelve a `/lv:debate` para fundirse con `staging-host`. Con
  Q2 respondida, la fila en `docs/design-v0.2.md` §6 con el número que diga el owner. Con Q3 = (b), el design gana una
  D11 y el grupo 2 una tarea antes de seguir. Verificar: `grep -cE "Respuesta del owner (Q[1-4]), 20" docs/adr/ADR-065.md`
  devuelve `4` (hoy `0`).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada en el
  design con su fecha. Verificar: la sección «Debate» de la última iteración dice «Convergencia: SI».
- [ ] 0.3 [infra] Precondiciones de orden (design D1): `verify-reusable-workflow` (35c) y `staging-host` (35b)
  archivados en `openspec/changes/archive/`, y el requirement «La pila de staging separa la red de cada proceso y no
  deja datos sin credenciales» en `openspec/specs/platform/production-deploy/spec.md`. Releer el `mongo` y el `redis`
  de `docker-compose.prod.yml` en `main` contra la lista «Lo que trae 35b» del design. Verificar: `ls
  openspec/changes/archive | grep -c -E "staging-host|verify-reusable-workflow"` devuelve `2` y `grep -c "no deja datos
  sin credenciales" openspec/specs/platform/production-deploy/spec.md` devuelve `1`; la comparación queda anotada en el
  PR, punto por punto. Si algo difiere, el design vuelve a 0.2 antes de seguir.

## 1. Inventario y mediciones (design D2, D3, D9)

- [ ] 1.1 [backend] Inventario de órdenes de MongoDB que exigen más que `readWrite`. Buscar en `apps/`, `libs/` y
  `tools/` (`runCommand`, `.command(`, `admin()`, `collMod`, `createUser`, `getSiblingDB`, `syncIndexes`,
  `diff`/`dropIndex` de Mongoose) y anotar en el PR cada uso con su fichero y si `readWrite@linkvault` lo cubre.
  Verificar: la lista queda en el PR; cada uso no cubierto tiene decisión escrita (rol propio con esa acción, nunca
  `dbAdmin` ni la raíz) antes de 2.2.
- [ ] 1.2 [backend] Prueba de integración con autenticación en `apps/api/src/infrastructure/persistence/
  mongo-app-user.integration.spec.ts`: un `MongoMemoryReplSet` con autenticación (opción `auth` de
  `mongodb-memory-server-core`), un usuario `linkvault_app` con `readWrite@linkvault` creado por la raíz del test, y
  tres tests: «app user commits a transaction and creates an index», «app user cannot create users, read admin or write
  another database» y «rejects an unauthenticated read». Si la versión del paquete no admite autenticación en replica
  set, se anota y los tres casos pasan a la sección de 2.4. Verificar: los tres en verde con `pnpm nx run api:test`
  (`--include` del fichero). Falsación: dar al usuario `read` en vez de `readWrite` y ver caer el primero; restaurar.
- [ ] 1.3 [infra] Medir el healthcheck nuevo antes de escribirlo en los composes. En una pila propia (proyecto de
  compose aparte), sembrar un volumen **sin autenticación** con tres colecciones y un recuento conocido; arrancarlo con
  `keyFile` y autenticación y ejecutar a mano el guion del healthcheck de design D3. Verificar, anotado en el PR: el
  primer latido crea la raíz y `linkvault_app`; los recuentos son los mismos; un segundo latido no cambia nada
  (`usersInfo` antes y después comparado con `node`); la duración de cada latido (debe caber en `timeout: 10s`; si
  pasa de 5 s, se anota y se sube el `timeout` en 2.1); la salida del latido no contiene ninguna contraseña
  (`node` buscando las tres en el texto: 0). Pila apagada con `down -v`.

## 2. Compose de producción (design D1, D2, D3, D7)

- [ ] 2.0a [infra] **Solo con Q1 = (b).** Redis con `requirepass` en `docker-compose.prod.yml` según 35b D18 medida 3
  (contraseña leída de un fichero escrito al arrancar, healthcheck con `REDISCLI_AUTH`, `REDIS_URL` con la contraseña).
  Verificar como la 12.4 de 35b: `docker top` de `redis` sin la contraseña; sin `REDISCLI_AUTH` el healthcheck da
  `NOAUTH` y `unhealthy`, con ella `PONG`.
- [ ] 2.0b [infra] **Solo con Q1 = (b).** Mongo con autenticación según 35b D18 medida 3 (raíz con
  `MONGO_ROOT_USER`/`MONGO_ROOT_PASSWORD`, `keyFile` generado en el contenedor, uid 999, modo 400). Verificar como la
  12.5 de 35b, con `docker top` de `mongo` sin la contraseña durante el healthcheck.
- [ ] 2.1 [infra] Healthcheck de `mongo` reescrito en `docker-compose.prod.yml` con los cinco pasos de design D3, en
  `mongosh --eval`, leyendo `process.env` e imprimiendo solo `codeName`. `MONGO_APP_PASSWORD: ${MONGO_APP_PASSWORD:?…}`
  en el entorno de `mongo`. Verificar en la pila local de producción (`--env-file infra/ci/verify.env`) que `mongo`
  queda `healthy`, que `usersInfo` (leído con la raíz, sin imprimir credenciales) muestra `linkvault_app` con un solo
  rol `readWrite@linkvault`, y el escenario «El healthcheck no muestra credenciales»: cambiar a mano la contraseña de
  `linkvault_app`, esperar un latido y comprobar que autentica con la del `.env` y que `docker inspect` del estado de
  salud no contiene ninguna de las dos (`node`: 0 coincidencias). Falsación: quitar el paso 4 y ver que, tras el cambio
  a mano, `api` no autentica; restaurar.
- [ ] 2.2 [infra] `MONGO_URI` de `api` y `worker` con `linkvault_app` (design D2) y sin `MONGO_ROOT_*` en su entorno.
  Verificar con `docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env config --format json` volcado
  a fichero y leído con `node` («La raíz no llega a las aplicaciones»): ninguna clave `MONGO_ROOT_*` en `api` ni
  `worker` y su `MONGO_URI` nombra `linkvault_app`; la readiness de los dos con `checks.mongo` en `up`.
- [ ] 2.3 [infra] `infra/ci/verify.env` con `MONGO_APP_PASSWORD` de relleno (prefijo `linkvault-ci-`, design D5),
  distinta de las otras dos. Verificar: `verify-artifact.sh` en verde en local y `grep -c "MONGO_APP_PASSWORD="
  infra/ci/verify.env` devuelve `1`.
- [ ] 2.4 [infra] Sección nueva de `infra/ci/verify-artifact.sh` (design D10; requirement «La verificación del
  artefacto comprueba las credenciales»): desde `api`, con `node -e` y el driver de la imagen, una lectura sin
  credenciales falla con `Unauthorized`; con la `MONGO_URI` del contenedor, escribir y borrar un documento en una
  colección de prueba funciona (control); crear un usuario y leer `admin` fallan; desde `worker`, con `net`, un `PING`
  a Redis sin `AUTH` responde `-NOAUTH`; la raíz no está en `process.env` de `api` ni de `worker`. Cada fallo sale con
  `fail` nombrando la comprobación. Verificar: la sección en verde en el CI de la rama. Falsación del escenario «Redis
  sin contraseña en la pila verificada»: en una copia del compose, Redis sin `requirepass`; la sección falla nombrando
  a Redis; restaurar.

## 3. Compose de desarrollo (design D4, D8, D9)

- [ ] 3.1 [infra] `mongo` de `docker-compose.yml` con la forma de producción (design D9): `keyFile` generado al
  arrancar, raíz de relleno por defecto, `MONGO_APP_PASSWORD` de relleno y el **mismo** healthcheck de 2.1; el
  comentario de cabecera dice qué es de relleno y remite al README. Verificar con «Arranque en limpio con credenciales
  de desarrollo»: sin `.env`, `docker compose up -d --wait` deja `mongo` sano y `usersInfo` con `linkvault_app` y un
  solo rol.
- [ ] 3.2 [infra] `redis` de `docker-compose.yml` con `requirepass` por fichero escrito al arrancar y healthcheck con
  `REDISCLI_AUTH` (design D4), valor de relleno por defecto. Verificar «Conexión sin credenciales rechazada en local»:
  desde el host, con `node` y `net` al puerto publicado, `PING` sin `AUTH` responde `-NOAUTH`; con `node` y el paquete
  `mongodb` de la raíz contra el puerto publicado, sin credenciales, un `findOne` en `linkvault` falla con
  `Unauthorized`. Falsación: sin `REDISCLI_AUTH` en el healthcheck, `redis` pasa a `unhealthy`; restaurar.
- [ ] 3.3 [infra] `.env.example` con `MONGO_URI` (usuario de aplicación y contraseña de relleno, `directConnection=true`)
  y `REDIS_URL` con contraseña; `infra/README.md` («Variables de entorno» y la pila local) dice qué dos líneas copiar a
  un `.env` anterior. Verificar «Las apps del host entran con las URIs del ejemplo»: con un `.env` copiado del ejemplo,
  `nx serve api` y `nx serve worker` dan `/health` con `mongo` y `redis` en `up`, y una transacción con esa URI se
  confirma (`mongosh` desde el host o el test de 1.2 apuntado a la pila).
- [ ] 3.4 [infra] Ensayo de la migración de un volumen local («Volumen con datos y sin usuarios», «Volumen ya
  migrado»): con `main` anterior a este change, `pnpm infra:up` y `pnpm nx run api:seed-demo`; recuento por colección
  volcado con `node`; cambiar a la rama y `pnpm infra:up` sin borrar volúmenes. Verificar: mismos recuentos, raíz y
  `linkvault_app` presentes; un segundo `pnpm infra:up` deja `usersInfo` idéntico. Anotar en el PR la orden opcional de
  copia previa (`mongodump --archive` desde el contenedor).

## 4. Aplicaciones (design D7)

- [ ] 4.1 [backend] `api-config.schema.ts`: con `NODE_ENV=production`, `MONGO_URI` exige usuario y contraseña y
  `REDIS_URL` contraseña, y se rechaza una contraseña igual a un valor de relleno versionado (constantes en un
  módulo de configuración que comparten los dos esquemas, fuera del índice de `@linkvault/shared`, que llega al SPA; con un test que las compara con `.env.example`, `docker-compose.yml`, `apps/web-e2e/e2e.env` e
  `infra/ci/verify.env`). Tests en `load-api-config.spec.ts`: «rejects a production MONGO_URI without credentials
  naming the variable», «rejects a production REDIS_URL without password», «rejects a versioned placeholder password in
  production», «accepts URIs without credentials outside production» y «never prints the URI when rejecting it» (la
  salida de stderr capturada no contiene ninguna parte de la URI). Falsación: quitar la regla de Redis y ver caer el
  segundo; restaurar.
- [ ] 4.2 [backend] Lo mismo en `worker-config.schema.ts`, con la regla compartida desde un único módulo (no copiada).
  Tests en `load-worker-config.spec.ts` con los mismos cinco títulos. Verificar: los diez en verde y `grep -c` de la
  función compartida en los dos esquemas devuelve `1` en cada uno.
- [ ] 4.3 [backend] Redactor (`logger-params.ts` de `api` y su gemelo de `worker`, si existe): `MONGO_URI`,
  `REDIS_URL`, `REDIS_PASSWORD`, `MONGO_ROOT_PASSWORD` y `MONGO_APP_PASSWORD`. Test «redacts MONGO_URI and REDIS_URL
  values» (escenario «Objeto con la URI registrado»): ningún valor en la salida y las dos claves con `[Redacted]`.
  Falsación: quitar `REDIS_URL` de la lista y ver caer el test; restaurar.
- [ ] 4.4 [backend] Avisos de conexión con código (`mongo-initial-connect-retry.ts` y `redis-health-client.ts`, en
  `api` y `worker`): nombre **y** `code`/`codeName` del error, nunca mensaje, host ni URI. Test «logs the error code but
  not the URI when the initial MongoDB connection fails authentication» contra el replica set con autenticación de 1.2
  y una contraseña mala: el aviso contiene `AuthenticationFailed` y no contiene usuario, contraseña ni host. Falsación:
  registrar `error.message` y ver caer el test; restaurar.
- [ ] 4.5 [backend] Guardia de la semilla de demostración («Semilla de demostración con credenciales en la URI»): test
  «judges the host, not the userinfo, of a MONGO_URI with credentials» en `demo-seed.guards.spec.ts`, con un usuario
  `localhost` y host `mongo.example.com` (rechaza) y al revés (acepta). Verificar: en verde.

## 5. Suite e2e y herramientas (design D9)

- [ ] 5.1 [backend] `withPort` de `apps/web-e2e/scripts/e2e-stack.ts` conserva usuario y contraseña («Bloque de puertos
  con URI con credenciales»); se extrae a `scripts/lib/` con su spec. Tests: «keeps user and password when rewriting
  the port of a mongodb URI», «keeps the password when rewriting the port of a redis URI» y «rewrites the port when the
  password starts with digits». Falsación: volver a la expresión actual y ver caer el primero; restaurar.
- [ ] 5.2 [infra] `apps/web-e2e/e2e.env` con las tres contraseñas de relleno (`linkvault-e2e-…`, sin `#` ni `$`) y
  las URIs con credenciales; el valor por defecto de `MONGO_URI` en las pruebas que abren Mongo (o en el ayudante
  `local-only`, si `e2e-suite-lot-2` ya lo creó) igual al de `.env.example`. Verificar: `grep -rn
  "mongodb://localhost:27017/linkvault?directConnection=true\"" apps/web-e2e/src` sin resultados.
- [ ] 5.3 [infra] Ayudante `infra/datastore/mongo-shell.sh` para el operador: `docker compose … exec -T mongo mongosh`
  autenticado como raíz dentro de `--eval` desde `process.env` del contenedor, con el script por la entrada estándar.
  Las órdenes `mongosh` del RUNBOOK, `infra/staging/run.sh` y `infra/staging/seed-volume.sh` pasan a usarlo (o a la
  misma autenticación en `--eval`). Verificar: `grep -c 'mongosh "mongodb://localhost:27017' docs/RUNBOOK.md
  infra/staging/*.sh` devuelve `0` en cada fichero; una orden del RUNBOOK ejecutada contra la pila local responde; `run.sh`
  sigue aplicando `assert-readonly.mjs` (falsación: un script con `insertOne` rechazado antes de conectar).
- [ ] 5.4 [infra] Camino crítico e2e sin regresión: `pnpm nx run web-e2e:e2e-stack -- --project=chromium` en verde con
  un bloque de puertos distinto del de por defecto (`--mongo-port`, `--redis-port`). Verificar: salida anotada en el
  PR; si el entorno de la sesión no ve los listeners, la corrida del workflow `e2e` con `target=local` en la rama.

## 6. Validación en el repositorio y antes del `up` (design D5, D7)

- [ ] 6.1 [infra] `infra/ci/check-env-file.mjs`: para `REDIS_PASSWORD`, `MONGO_ROOT_PASSWORD` y `MONGO_APP_PASSWORD`,
  formato de design D5, distinta de cada valor de relleno versionado (leídos de los cuatro ficheros, no copiados; si no
  se encuentran, la comprobación falla) y distintas entre sí. Verificar con ficheros de prueba en el directorio temporal
  de la sesión (nunca valores reales): uno correcto pasa; uno con la de relleno de desarrollo, uno con `/` en la del
  usuario de aplicación y uno con dos iguales fallan cada uno nombrando su comprobación («Un valor de desarrollo en el
  fichero de entorno del host», «Una contraseña que rompería la URI»); la salida de los cuatro, buscada con `node`, no
  contiene ninguno de los valores. Ficheros borrados.
- [ ] 6.2 [infra] `compose-env-contract`: en `docker-compose.prod.yml`, toda variable que termine en `_PASSWORD` usa
  `${VAR:?…}`, y `MONGO_ROOT_*` y `MONGO_APP_PASSWORD` no están en `api` ni `worker`. Verificar: `bash
  infra/ci/repo-checks.sh` en verde. Falsación del escenario «Una contraseña con valor por defecto en el compose de
  producción»: `${REDIS_PASSWORD:-x}` y ver fallar nombrando `REDIS_PASSWORD`; `MONGO_ROOT_PASSWORD` en `worker` y ver
  fallar nombrando el servicio; restaurar.
- [ ] 6.3 [infra] Comprobación nueva en `tools/repo-checks` (agregada a `check`): el `healthcheck.test` de `mongo` y el
  de `redis` son el mismo texto en `docker-compose.yml` y `docker-compose.prod.yml` (design D3, D9). Verificar: en
  verde. Falsación: un espacio de más en el de desarrollo y ver fallar nombrando el servicio; restaurar.

## 7. Rotación (design D6)

- [ ] 7.1 [infra] `infra/datastore/rotate-mongo-root.sh`: `read -s` de la nueva (dos veces, iguales), formato de D5,
  `docker compose … exec -T -e MONGO_ROOT_PASSWORD_NEW mongo mongosh --eval …` autenticando con la actual desde el
  entorno del contenedor; sale ≠0 sin cambiar nada si la actual no autentica; no imprime valores; termina pidiendo
  editar el `.env` y `up -d mongo`. Añadido a `infra/deploy/config-files.txt`. Verificar con `bash -n` y en la pila
  local: con una actual incorrecta sale ≠0 y la raíz sigue autenticando con la de antes.
- [ ] 7.2 [infra] Ensayo de rotación del usuario de aplicación y de Redis en la pila local de producción con datos
  sembrados («Rotar la contraseña del usuario de aplicación», «Rotar la contraseña de Redis con un job pendiente»):
  recuentos antes; nueva `MONGO_APP_PASSWORD` y `up -d`; recuentos iguales, `api` y `worker` sanos, la anterior no
  autentica. Con el worker parado, guardar un link (job `enrich-link` en espera), nueva `REDIS_PASSWORD` y `up -d`: el
  job se procesa y la anterior responde `WRONGPASS`. Verificar: recuentos y resultados anotados en el PR, sin valores.
- [ ] 7.3 [infra] Ensayo de rotación de la raíz («Rotar la raíz sin exponerla»): con un bucle que vuelca `ps -eo args`
  del host y `docker top mongo` a ficheros cada 0,1 s, ejecutar 7.1 y `up -d mongo`. Verificar con `node` sobre esos
  ficheros: alguna muestra contiene `mongosh` (el muestreo alcanzó la orden) y ninguna contiene la contraseña nueva ni
  la anterior; `mongo` sano. Ficheros borrados.
- [ ] 7.4 [infra] Documentación: `docs/RUNBOOK.md`, sección «Credenciales de Mongo y Redis» (generación con la orden de
  D5, dónde viven, la tabla de rotación de D6 con «cuándo», migración por entorno de D8 con la copia previa, vuelta
  atrás, el healthcheck que impone la contraseña de la aplicación, y que el `keyFile` no se rota); `infra/README.md`
  suma `MONGO_APP_PASSWORD` a lo que vive solo en el host y qué se pierde sin ella. Verificar con un `node -e` que
  encuentre la sección, las tres variables, `rotate-mongo-root.sh`, `mongodump` y «por evento».

## 8. Staging (design D8; las ejecuta el owner)

- [ ] 8.1 [infra] **[bloqueada: owner]** Antes de fusionar: el owner genera `MONGO_APP_PASSWORD` con la orden de D5, la
  añade a `.env.staging` y a su copia fuera del host, y ejecuta en el host `node infra/ci/check-env-file.mjs
  .env.staging` desde el árbol del commit a desplegar. Verificar: el owner confirma por escrito en el PR «8.1 hecha el
  AAAA-MM-DD: check-env-file PASS», sin pegar valores; la suma de la copia coincide con la del host (regla de 35b).
- [ ] 8.2 [infra] **[bloqueada: 8.1 y fusión en una ventana autorizada por el owner]** Tras el despliegue del push
  («Staging con la raíz de antes»): recuentos por colección con `infra/staging/run.sh` antes de fusionar y después,
  iguales; la corrida dice «desplegado a staging»; desde `api`, `db.runCommand({connectionStatus: 1})` con su
  `MONGO_URI` devuelve `linkvault_app` como usuario autenticado; desde `worker`, una lectura sin credenciales falla con
  `Unauthorized`. Verificar: valores anotados en el PR, sin credenciales. Si el `up` abortó por falta de la variable
  («Falta la contraseña nueva»), anotar que los contenedores conservaron su identificador, completar 8.1 y relanzar
  solo el job de despliegue.

## 9. Cierre

- [ ] 9.1 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar: salida anotada en el PR.
- [ ] 9.2 [infra] `pnpm exec openspec validate --all --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en
  verde. Verificar: salidas anotadas en el PR.
- [ ] 9.3 [infra] Al archivar: ADR-065 a «Aceptado» con fecha, PR y hash del merge; una línea de anotación que apunte a
  ADR-065 en ADR-051 (riesgo aceptado «Mongo de producción no tiene autenticación»), ADR-056 §6 (punto «contraseñas en
  Redis y Mongo») y ADR-058 (riesgo aceptado «El hijo tiene red»: queda cerrada la parte de Mongo y Redis sin
  autenticación; la red del hijo sigue abierta hasta Node 26 LTS). Verificar: `grep -c "ADR-065"` devuelve al menos `1`
  en cada uno de los tres y `grep -n "^\*\*Estado:\*\* Aceptado" docs/adr/ADR-065.md` devuelve una línea.
- [ ] 9.4 [infra] Al archivar: la fila de `docs/design-v0.2.md` §6 (la de 0.1) con el estado «archivado» y la entrada
  de `openspec-changes.yaml` actualizada. Verificar: `grep -c "datastore-auth" docs/design-v0.2.md` devuelve al menos
  `1`.
- [ ] 9.5 [infra] Fuera de alcance comprobado (design Non-Goals): el change no toca el flag de red de Node.
  Verificar: `git diff origin/main...HEAD -- apps libs docker docker-compose.yml docker-compose.prod.yml | grep -c -- "--allow-net"` devuelve `0`; si al aplicar el proyecto ya
  estuviera en Node 26 LTS, se anota en el PR y se avisa al owner para abrir aquel change, sin hacerlo aquí.
