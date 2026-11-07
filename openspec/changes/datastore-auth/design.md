## Context

**Estado del repositorio** (`origin/main`, `5b92d28`, leído el 2026-11-04; lo que cambió al fusionarse 35b, en el
bloque siguiente):

- `docker-compose.yml` y `docker-compose.prod.yml`: `mongo:7.0.43` con `--replSet rs0 --bind_ip_all`, sin `--auth` ni
  `keyFile`; `redis:7.4.11` sin `requirepass`. En desarrollo **todos** los servicios publican su puerto en todas las
  interfaces del host (`'${MONGO_PORT:-27017}:27017'`, y lo mismo Redis, el almacén, Mailpit, Ollama y Meilisearch).
  El healthcheck de `mongo` ya **escribe**: ejecuta `rs.initiate` si el replica set no está inicializado y solo da sano
  con primario escribible.
- `api` y `worker` leen `MONGO_URI` y `REDIS_URL` (zod: `^mongodb(\+srv)?:\/\/\S+$` y `^rediss?:\/\/\S+$`). Los dos
  módulos de conexión registran solo el **nombre** del error (`mongo-initial-connect-retry.ts`: «el mensaje del driver
  puede incluir hosts o detalles de la URI»). `loadApiConfigOrExit` y su gemelo del worker escriben variables y motivo,
  **nunca valores**. El redactor de pino (`logger-params.ts`) no conoce `MONGO_URI` ni `REDIS_URL`.
- Los tests de integración usan `MongoMemoryReplSet` (`@linkvault/testing`) sin autenticación; los de Redis usan
  puertos cerrados o una Redis local opcional (`OUTBOX_REDIS_LOCAL=1`).
- `apps/web-e2e/scripts/e2e-stack.ts`, `withPort`, reescribe el puerto con `^([a-z][a-z0-9+.-]*:\/\/[^/:?#]+):\d+`: con
  una URI `esquema://usuario:clave@host:puerto` el grupo se detiene en `usuario` y el puerto **no se reescribe** (o se
  reescribe la clave, si empieza por dígitos). Hoy no pasa porque ninguna URI de la suite lleva credenciales.
- El RUNBOOK tiene 48 órdenes `docker compose exec mongo mongosh "mongodb://localhost:27017/…"` sin autenticación,
  pensadas para la pila de desarrollo. `infra/staging/run.sh` ya se autentica como raíz dentro de `--eval` (35b).
  `infra/staging/seed-volume.sh` no autentica y su guardia 2 **rechaza** todo contenedor levantado con
  `docker-compose.prod.yml`: solo siembra Mongo locales sin autenticación.
- `infra/ci/check-env-file.mjs` revisa un `.env` de despliegue contra los `${VAR:?}` del compose sin imprimir valores;
  `tools/repo-checks/src/compose-env-contract.check.mjs` comprueba que el compose declara lo que los esquemas exigen.

**Lo que trae 35b, ya en `main`** (spec: PR #92, fusionado en `556c7b6`; implementación del grupo 12: PR #93,
`b493986`; leído el 2026-11-07 tras fusionar `origin/main` en esta rama; design D18, medida 3; tareas 12.4 y 12.5 de
`openspec/changes/staging-host/`, aún sin archivar), que este change toma como base y no redefine:

- Redis con `requirepass` (`REDIS_PASSWORD`, obligatoria con `:?` y declarada en `.env.example`), leída de un fichero
  de configuración escrito al arrancar; healthcheck con `REDISCLI_AUTH`; `REDIS_URL` con la contraseña.
- Mongo con `MONGO_ROOT_USER` y `MONGO_ROOT_PASSWORD`, que Compose pasa al contenedor `mongo` como
  `MONGO_INITDB_ROOT_USERNAME` y `MONGO_INITDB_ROOT_PASSWORD` (los nombres que leen el healthcheck y `run.sh`); el `keyFile` **generado dentro del contenedor al arrancar**
  (uid 999, modo 400), sin conservarlo ni tratarlo como secreto; la raíz creada por el arranque de la imagen solo sobre
  un **volumen vacío**; healthcheck, `rs.initiate`, `run.sh` y `verify-artifact.sh` autenticados dentro de `--eval`
  leyendo `process.env`; `$$VAR` en `command` y healthchecks; `MONGO_URI` con credenciales y `authSource=admin`.
- **Formato apto para URI** en `check-env-file.mjs`: las dos contraseñas con 32-128 caracteres de `[A-Za-z0-9._~-]` y
  `MONGO_ROOT_USER` con 1-64, generadas con `openssl rand -hex 32`, fallando con el nombre y sin el valor.
- `.env.example` declara `REDIS_PASSWORD`, `MONGO_ROOT_USER` y `MONGO_ROOT_PASSWORD` **con valores de relleno**
  (`dev-only-…-not-a-secret-change-me`), que `check-env-file.mjs` rechaza; `infra/ci/verify.env` trae los suyos.
- El anexo de secretos de la pila local de `infra/README.md` (paso 2 del bloque que `docs-stack-up` compara con
  `verify-artifact.sh`) genera `REDIS_PASSWORD` y `MONGO_ROOT_PASSWORD`.
- Un volumen con datos y sin usuario «deja a `mongo` sin llegar a `healthy` […] Se arregla con el `down -v`» (README).
- Las contraseñas viven solo en `.env.staging` y en su copia fuera del host; **no son secretos de GitHub**.
- El requirement de `platform/production-deploy` «La pila de staging separa la red de cada proceso y no deja datos sin
  credenciales» («Mongo y Redis NO SHALL aceptar operaciones sin credenciales, y ninguna contraseña SHALL aparecer en
  los argumentos de un proceso»).

**El hijo de lectura de CV no hereda el entorno** (`cv-extract-isolation`, rama `change/cv-extract-isolation`): arranca
con `env: {}`, y lo cubre el test «the child sees none of the worker variables». El riesgo R8 de ADR-058 es **de red**:
el hijo alcanza Mongo y Redis. Con autenticación los sigue alcanzando, pero no tiene credenciales para usarlos.

**Por qué hace falta un change aparte si 35b ya pone contraseñas:** el owner decidió las dos cosas el mismo día
(2026-10-29): la defensa de ADR-056 §6 dentro de 35b (Q3 de `enrichment-egress-guard`) y la autenticación de Mongo y
Redis en un change propio después de la fila 35 (Q7 (b) de `cv-extract-isolation`). Este design las reconcilia sin
contradecir ninguna (D1): 35b cierra lo urgente en staging antes de invitar; este change quita la raíz a las
aplicaciones, cierra el entorno de desarrollo, migra staging sin borrar y escribe rotación y validación.

## Goals / Non-Goals

**Goals:**

- `api` y `worker` entran a Mongo con un usuario de **mínimo privilegio**; la raíz no está en su entorno.
- Staging adopta el usuario de aplicación **sin perder datos** y sin `down -v`, con vuelta atrás ensayada.
- La infraestructura de desarrollo deja de escuchar fuera del propio equipo (Q5 (a)).
- Las tres credenciales tienen generación, custodia y rotación escritas; la de la aplicación y la de Redis, ensayadas.
- Una configuración inválida falla **antes** o **al** arrancar, nombrando la variable y sin mostrar su valor.

**Non-Goals:**

- **El flag de red de Node** (`--allow-net`) para el hijo de lectura de CV. Por decisión del owner (Q7 (a) de
  `cv-extract-isolation`, 2026-10-29) se agrega al subir a Node 26 LTS, en ese change.
- **Autenticación en desarrollo** con Q5 (a): el compose de desarrollo sigue sin credenciales y solo escucha en
  `127.0.0.1`. Con Q5 (b) vuelve a alcance (ver Q5).
- **Crear la raíz desde el healthcheck** (B3): un volumen con datos y sin usuarios sigue un procedimiento manual (D8).
- TLS entre servicios del mismo host, usuarios ACL de Redis, un usuario de Mongo de solo lectura (Q3), un gestor de
  secretos, rotar las claves del almacén de objetos (`S3_*`, `OBJECT_STORE_SSE_KEY`).
- Redes, almacén y metadatos: son D18 medidas 1, 2, 4 y 5 de 35b.
- Los tests unitarios y de integración siguen contra `MongoMemoryReplSet` sin autenticación (D9), más una prueba nueva
  con autenticación.

## Decisions

### D1. La base es 35b D18, medida 3; este change la extiende y no la redefine

Se conservan sus nombres (`REDIS_PASSWORD`, `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD`), su `requirepass` por fichero
escrito al arrancar, su `keyFile` generado en el contenedor, la creación de la raíz por el arranque de la imagen sobre un
volumen vacío, su autenticación de `mongosh` dentro de `--eval` desde `process.env`, su regla de formato apto para URI y
su regla de que ninguna contraseña va en argumentos. Lo que este change cambia de ese texto, una vez archivado 35b:

- `MONGO_URI` de `api` y `worker` pasa de la raíz al usuario de aplicación (D2).
- El healthcheck de `mongo` se reescribe con el orden de D3 y suma el usuario de aplicación.
- El párrafo «volumen anterior sin usuario → `down -v`» del README y la sección del RUNBOOK de 35b pasan al
  procedimiento de D8 (tarea 7.2).

**Cuándo se aplica:** después de archivar 35b y de cerrar la fila 35 (35c archivado), sin excepción a la precedencia
de ADR-048 §Consecuencias. Así el compose de producción se edita **después** de 35b, nunca a la vez. La tarea 0.3 relee
lo que quede en `main`, confirma con el owner (sin valores) que las contraseñas de 35b cumplen D5 y comprueba el test del
hijo de `cv-extract-isolation`; si algo difiere, el design vuelve a debate antes de `/opsx:apply`.

**Q1 cerrada por los hechos (2026-11-07):** 35b se fusionó con la medida 3 (`556c7b6` y `b493986`), así que vale (a) y
salen las antiguas 2.0a y 2.0b. La 0.3 sigue releyendo `main` (punto 4) por si 35b cambia antes de archivarse.

*Descartado:* rediseñar aquí el mecanismo de 35b; fundir este change en 35b (agranda la fila 35 contra ADR-051 §1).

### D2. Un usuario de aplicación con `readWrite` sobre la base de la aplicación

- Usuario `linkvault_app` (el nombre no es secreto y queda fijo en el compose), creado **en la base `linkvault`** con un
  único rol, `readWrite` sobre `linkvault`. La URI queda
  `mongodb://linkvault_app:${MONGO_APP_PASSWORD:?…}@mongo:27017/linkvault?replicaSet=rs0`: el `authSource` por defecto
  es la base de la ruta.
- `api` y `worker` reciben solo esa URI. `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD` y `MONGO_APP_PASSWORD` como claves
  solo están en el entorno del servicio `mongo` (reglas exactas en D7.3).
- `readWrite` cubre lo que hace la aplicación hoy: lecturas y escrituras, transacciones del outbox, `createIndexes` y
  `dropIndexes`, `listCollections`; el `ping` del indicador de salud no pide privilegios. **No** cubre `collMod`
  (validadores, TTL de un índice existente): si una migración lo necesitara, la ejecuta el operador con la raíz por el
  ayudante de D8, y así lo dicen el RUNBOOK y ADR-065. La tarea 1.1 lo **inventaría** y la 1.2 lo **prueba**; si algo
  pide más, se decide en el PR (un rol propio con esa acción, nunca `dbAdmin` entero ni la raíz).

*Descartado:* seguir con la raíz en las aplicaciones; `dbOwner` (incluye gestionar usuarios); el usuario en `admin`.

### D3. El healthcheck de `mongo` asegura el usuario de aplicación; no crea la raíz

El healthcheck ya hace trabajo idempotente (`rs.initiate`); se reescribe con este orden, leyendo solo `process.env`:

1. `db.hello()`, que no pide privilegios (comprueba que el servidor responde).
2. Autenticarse como raíz con `MONGO_INITDB_ROOT_USERNAME` y `MONGO_INITDB_ROOT_PASSWORD` (los de 35b).
3. `rs.status()` y, si el replica set no está inicializado, `rs.initiate` con `mongo:27017`.
4. Asegurar `linkvault_app`: si no existe, crearlo; si sus roles no son exactamente `readWrite@linkvault`,
   reemplazarlos; **en una conexión aparte**, autenticarse con `MONGO_APP_PASSWORD` y, si falla, ponerle esa
   contraseña. El `.env` es la única fuente de verdad de esa contraseña (D6).
5. Sano solo con primario escribible (`isWritablePrimary`).

**Salidas:** con los códigos que significan «reintentar en el próximo latido» —10107 (`NotWritablePrimary`), 11602
(`InterruptedDueToReplStateChange`) y 51003, este último **solo si la 2.1a consigue provocarlo y confirma su
significado**; si no, sale de la lista— sale 1 sin imprimir nada. Con cualquier otro error sale 1 imprimiendo
**solo** `e.codeName ?? e.name` (un error sin código, como uno de red de `mongosh`, se nombra por su clase). En particular, si el paso 2 da 18 (`AuthenticationFailed`) —volumen con datos y sin usuarios,
o raíz con otra contraseña—, sale 1 con `AuthenticationFailed` y el README describe el procedimiento manual (D8). La
salida del healthcheck, que `docker inspect` guarda, nunca contiene un valor. El texto vive en línea en el `test:` del
compose de producción.

*Descartado:* **crear la raíz desde el healthcheck** sobre un volumen sin usuarios (B3): abriría nosotros la ventana de
la excepción de localhost de MongoDB, y el único volumen así es el local, que con Q5 (a) no tiene autenticación. *También
descartado:* un servicio de un solo uso con `service_completed_successfully` (cómo lo trata `up --wait` no está medido en
la versión del host, y `e2e-stack` y `deploy.sh` miran cada servicio); una orden tras el `up` (la readiness de `api`
fallaría antes); scripts de `/docker-entrypoint-initdb.d` (solo con volumen vacío y un fichero montado más).

**Diferencia con el almacén.** `platform/object-store` exige un healthcheck de solo lectura porque crear buckets desde
el healthcheck escondía un aprovisionamiento a medias. Aquí cada paso es idempotente y el healthcheck no da sano hasta
completarlos todos.

### D4. Desarrollo: puertos solo en `127.0.0.1`, sin autenticación (Q5 (a))

Todos los `ports` de `docker-compose.yml` pasan a `'127.0.0.1:${…_PORT:-…}:<puerto>'`. Los procesos del host (`nx
serve`, la suite e2e, los scripts) siguen llegando por `localhost`; nadie de la red del equipo llega. Mongo y Redis de
desarrollo siguen sin credenciales, así que `.env.example`, `apps/web-e2e/e2e.env`, los tests y los `.env` de
desarrollo ya existentes no cambian, y no hay volumen local que migrar. Una comprobación de `repo-checks` exige el
prefijo en cada puerto publicado.

*Costo de Q5 (a):* desarrollo no ejercita la autenticación; la ejercitan la verificación del artefacto en CI y
staging. *Q5 (b)* devolvería la paridad (autenticación también en desarrollo, migración de volúmenes locales, `.env`
viejos que dejan de conectar, el mismo healthcheck en los dos composes) a costa de unas diez tareas más.

### D5. Generación, formato y custodia

- **Generación:** el owner, con un generador criptográfico, agregando la línea al fichero **sin mostrar el valor**:
  `printf 'MONGO_APP_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> .env.staging` (64 caracteres `[0-9a-f]`, la misma
  convención que 35b y `OBJECT_STORE_SSE_KEY`). La orden va en `infra/README.md`; los valores, nunca. El anexo de
  secretos de la pila local del README (paso 2) suma también `MONGO_APP_PASSWORD`, y `verify-artifact.sh` cambia a la
  vez (los compara `docs-stack-up`).
- **Relleno:** `.env.example` conserva los rellenos de 35b y suma `MONGO_APP_PASSWORD` con uno del mismo estilo
  (`dev-only-mongo-app-password-not-a-secret-change-me`), que `check-env-file.mjs` rechaza como los demás.
- **Formato exigido:** el de 35b (32-128 caracteres de `[A-Za-z0-9._~-]`), extendido a `MONGO_APP_PASSWORD` (D7.2).
- **Custodia:** solo el `.env` del host y su copia fuera del host. No son secretos de GitHub, no se pegan en un PR,
  una issue ni una conversación.
- **Verificación en CI:** valores de relleno en `infra/ci/verify.env`, con prefijo `linkvault-ci-`.

### D6. Rotación

| Credencial | Dónde vive el valor que manda | Cómo se rota | Corte |
|---|---|---|---|
| `MONGO_APP_PASSWORD` | `.env` (el healthcheck la impone, D3) | editar el `.env` y su copia → `up -d` (recrea `mongo`, `api`, `worker`) | segundos |
| `REDIS_PASSWORD` | `.env` (el fichero de Redis se escribe al arrancar) | editar el `.env` y su copia → `up -d` (recrea `redis`, `api`, `worker`) | segundos; los jobs persisten (AOF) |
| `MONGO_ROOT_PASSWORD` | **el volumen** (la raíz ya existe) | sección del RUNBOOK, sin script propio (ver abajo) | el del reinicio de `mongo` |

**Rotación de la raíz, en este orden** (alternativa del critic, C6):

1. Generar la nueva en un fichero temporal del host con modo 600 (`umask 077`), sin mostrarla.
2. `updateUser` de la raíz por `docker compose exec -T mongo mongosh`, autenticando con la **actual del entorno del
   contenedor** (que aún no se recreó) y leyendo la **nueva del fichero temporal por la entrada estándar**, nunca por
   argumentos. La misma orden comprueba que la nueva autentica y la anterior no.
3. Solo después, escribir la nueva en el `.env` y en su copia fuera del host, borrar el temporal y `up -d mongo`.

**Si el paso 2 falla:** no cambió nada; se borra el temporal y la actual sigue valiendo en el `.env` y en el volumen.
Si el paso 2 terminó pero el 3 se interrumpe, el temporal es la única copia de la nueva: **no se borra** hasta haberla
escrito en el `.env` y en su copia. Se ensaya una vez en la pila local (7.1c).

- **Cuándo:** por evento —sospecha de exposición, salida de alguien con acceso al host, cualquier impresión
  accidental— y no por calendario (Q4).
- El `keyFile` no se rota: se regenera en cada arranque (35b).

*Descartado:* un script propio de rotación de la raíz (B8: una orden de tres pasos no lo justifica); una variable
`MONGO_ROOT_PASSWORD_PREVIOUS` que pruebe el healthcheck (deja un secreto viejo en el `.env`); `CONFIG SET requirepass`
en caliente (la contraseña viajaría en los argumentos de `redis-cli`).

### D7. Validación sin mostrar secretos

**Lista cerrada** de contraseñas de los almacenes: `REDIS_PASSWORD`, `MONGO_ROOT_PASSWORD` y `MONGO_APP_PASSWORD`.
`MAIL_SMTP_PASSWORD` es una **excepción nombrada**: puede quedar vacía por el modo relay de 35b (D6 de `staging-host`).

1. **Al arrancar, solo en producción** (`api-config.schema.ts`, `worker-config.schema.ts`): con `NODE_ENV=production`,
   `MONGO_URI` SHALL llevar usuario y contraseña y `REDIS_URL`, contraseña. El fallo sale por `formatInvalidVariables`:
   variable y motivo, nunca el valor. El escenario «La configuración de la verificación en CI arranca» lo prueba de verdad
   `verify-artifact.sh`, que levanta la pila con `verify.env` y exige la readiness (C8). Los esquemas **no** comparan contra valores de relleno (B9): con Q5 (a) no hay
   relleno de desarrollo ni de e2e para estas variables, y el de `infra/ci/verify.env` lo usa la verificación en CI con
   `NODE_ENV=production`, así que rechazarlo rompería el CI (F2). Fuera de producción no se exige nada.
2. **Antes del `up`** (`check-env-file.mjs`): la regla de formato de 35b se **extiende** a `MONGO_APP_PASSWORD` (no se
   duplica); además, cada contraseña de la lista cerrada SHALL ser distinta de todo valor de relleno versionado y
   distinta de las otras dos. Los valores de relleno se leen de los ficheros (`infra/ci/verify.env` y `.env.example`),
   tanto de las variables declaradas como de la contraseña de `MONGO_URI` y `REDIS_URL` extraída con `new URL()`; no se
   copian al script. Solo nombres y PASS/FAIL.
3. **En el repositorio** (`compose-env-contract`), reglas exactas sobre `docker-compose.prod.yml`, cada una con su
   falsación:
   - en el `environment` de `api` y `worker`, ninguna clave `MONGO_ROOT_*` ni `MONGO_APP_PASSWORD`, y ningún valor
     que contenga `${MONGO_ROOT_`;
   - `${MONGO_APP_PASSWORD` solo aparece, en `api` y `worker`, dentro del valor de `MONGO_URI`;
   - toda referencia de Compose a una variable de la lista cerrada, buscada con `(?<!\$)\$\{(REDIS_PASSWORD|
     MONGO_ROOT_PASSWORD|MONGO_APP_PASSWORD)` (sin contar las `$${…}` que expande el shell del contenedor), SHALL ser
     `${VAR:?…}`;
   - cada variable de la lista cerrada que use el compose SHALL estar declarada en `.env.example`, con relleno, y una
     comprobación de coincidencia lo exige (F9 (a), C1).
4. **En los registros**: el redactor suma `MONGO_URI`, `REDIS_URL` y las tres de la lista cerrada; los avisos de
   conexión fallida, que hoy solo llevan el nombre del error, suman su código: de MongoDB, `codeName`
   (`AuthenticationFailed`…); de un `ReplyError` de Redis, solo un token de la lista {`NOAUTH`, `WRONGPASS`}, y nada
   más del mensaje.

### D8. Migración de un despliegue existente, sin pérdida

| Entorno | Estado antes | Qué hace quien opera | Qué pasa |
|---|---|---|---|
| Staging | raíz de 35b, apps como raíz | el owner añade `MONGO_APP_PASSWORD` al `.env.staging` y a su copia, hace la copia `mongodump --archive` y la guarda fuera del host, **antes de fusionar**; la fusión despliega | D3 paso 4 crea el usuario; `api` y `worker` cambian de URI |
| Volumen con datos y sin usuarios (cualquier pila con el compose de producción levantada antes de 35b) | sin raíz | procedimiento manual del README: `mongodump` desde la pila anterior, volumen nuevo, `mongorestore --nsInclude 'linkvault.*'` como raíz; o, si los datos no importan, `down -v`, que los pierde | D3 paso 2 da `AuthenticationFailed` y la pila no da sano hasta hacerlo; nada se borra solo |
| Desarrollo, `e2e-stack` | sin autenticación (Q5 (a)) | nada | — |
| Verificación en CI | volúmenes desechables | nada | — |
| Producción | sin host | — | el primer `up` parte de un volumen vacío |

- **Recuentos:** `infra/staging/counts.mongosh.js`, de solo lectura (pasa `assert-readonly.mjs`), cuenta documentos
  por colección; se ejecuta antes de fusionar y después del despliegue, por `run.sh`, y en las pilas locales por el
  ayudante.
- **Copia previa obligatoria** antes de fusionar: `mongodump --archive` desde el contenedor, guardada fuera del host,
  aunque staging sea desechable (ADR-051 §2): es la única vuelta atrás si algo borra datos.
- **Vuelta atrás:** el compose del commit anterior entra con la raíz (que sigue existiendo) y no toca datos; el usuario
  de aplicación queda en el volumen sin uso. Se ensaya (tarea 2.5).
- Si el `.env.staging` no tiene `MONGO_APP_PASSWORD` al fusionar, el `up` aborta nombrándola **antes de tocar
  contenedores** (`:?`) y la pila anterior sigue arriba; el owner la añade y relanza solo el job de despliegue.
- **Herramientas del operador en el host:** el ayudante `infra/datastore/mongo-shell.sh -f <compose> --env-file
  <env>` (script por la entrada estándar; se autentica como raíz dentro de `--eval` **solo si** el contenedor tiene
  `MONGO_INITDB_ROOT_USERNAME`, así que sirve igual contra la pila de desarrollo, sin autenticación) y
  `infra/deploy/check-auth.sh <compose> <env-file>` (D10), con la misma firma que `deploy.sh`, se agregan a
  `infra/deploy/config-files.txt`, así que cada despliegue los instala con la versión del commit desplegado (F23). No
  se usan por `ssh` desde la máquina del operador, para no depender de su checkout.
- **Siembra de prueba:** un fragmento versionado (`infra/datastore/seed-sample.mongosh.js`, tres colecciones con un
  recuento conocido) que las mediciones y ensayos ejecutan por el ayudante. Para un volumen sin usuarios (1.3c-i) se
  siembra con un `mongo:7.0.43` sin autenticación montado sobre el mismo volumen.

### D9. Tests y herramientas

- **Tests unitarios y de integración**: siguen sin autenticación. Una prueba de integración nueva levanta un replica
  set **con** autenticación (si `mongodb-memory-server-core` lo admite, medido en 1.2; si no, los mismos casos pasan a
  `check-auth.sh`) para demostrar que `readWrite` basta y que sin credenciales se rechaza.
- **`withPort`** de `e2e-stack` se corrige aunque desarrollo quede sin credenciales: la suite y el CI pueden recibir
  URIs con credenciales (perfil remoto, una pila del compose de producción), y una URI sin puerto debe quedar igual.
- `infra/staging/seed-volume.sh` **no se toca** (C4): su guardia 2 de 35b rechaza el compose de producción, así que
  nunca encuentra un Mongo con autenticación. `run.sh` tampoco: ya autentica desde 35b.

### D10. Cómo se verifica

- Cada requirement tiene al menos una prueba o verificación nombrada; los guardias (formato, contrato del compose,
  redacción, exigencia en producción, prefijo `127.0.0.1`) se falsan en su tarea y se restauran.
- `infra/deploy/check-auth.sh <compose> <env-file>` es **una sola orden** que usan la verificación del artefacto en CI (sección nueva de
  `verify-artifact.sh`) y el owner en staging tras desplegar: sin credenciales Mongo y Redis rechazan; el usuario de
  aplicación escribe en `linkvault` y no puede crear usuarios ni leer `admin`; la raíz no está en el entorno de `api` ni
  de `worker`. Cada fallo lo nombra. Su colección de control se borra **entera** al terminar, y la 8.2 cuenta antes de
  llamarla.
- La idempotencia del healthcheck se comprueba con el SHA-256 de `usersInfo({showCredentials: true})` antes y después
  de un latido: igual si nada cambió, distinto tras una rotación.
- Ninguna verificación imprime un valor: se comparan con `node` sumas o longitudes, y los ficheros temporales se borran.

## Risks / Trade-offs

- [R1. El healthcheck escribe el usuario de aplicación] → solo cuando algo difiere (1.3b lo mide con el SHA-256 de
  `usersInfo`). Si un operador cambia a mano esa contraseña, el healthcheck la devuelve a la del `.env`: es lo buscado,
  y el RUNBOOK lo dice.
- [R2. Un volumen con datos y sin usuarios no arranca sano] → es intencional (B3): la pila no borra ni crea nada sola;
  el código `AuthenticationFailed` en el healthcheck y el procedimiento del README dicen qué hacer.
- [R3. `readWrite` puede no bastar para algo que el inventario no vea] → 1.1 y 1.2 antes de cambiar la URI;
  `check-auth.sh` escribe con el usuario de aplicación en CI.
- [R4. Desarrollo no ejercita la autenticación con Q5 (a)] → la ejercitan la verificación en CI en cada PR y staging;
  Q5 (b) lo resuelve con su costo.
- [R5. Conflicto con `e2e-suite-lot-2`] → con Q5 (a) solo comparten `e2e-stack.ts`; el que entre segundo reescribe
  `withPort` sobre el primero.
- [R6. El healthcheck dura más] → 1.3a lo mide contra su `timeout: 10s` con diez arranques seguidos.
- [R7. La fusión despliega staging con usuarios reales] → copia previa obligatoria, recuentos antes y después, y
  vuelta atrás ensayada (2.5).
- [R8. El único guardia contra un valor de relleno en el `.env` del host es `check-env-file.mjs`, que corre el owner a
  mano] → el arranque no lo compara (B9, F2); 8.1 lo exige antes de fusionar y el RUNBOOK lo pide en cada rotación
  (C13).

## Migration Plan

1. 0.1-0.3: preguntas, debate, aprobación y relectura de 35b archivado.
2. Grupos 1-7 en una rama, con `e2e-stack` y la verificación del artefacto en verde.
3. Antes de fusionar (8.1): el owner genera `MONGO_APP_PASSWORD`, la añade al `.env.staging` y a su copia, revisa la
   copia con `check-env-file.mjs` en su máquina comparando sumas, y guarda fuera del host un `mongodump --archive`.
4. Fusión en una ventana autorizada por el owner; su push despliega staging; `check-auth.sh` y los recuentos (8.2).
5. Vuelta atrás: la de 35b (relanzar el despliegue del commit anterior), ensayada en 2.5.

## Open Questions

- **Q1 — cerrada por los hechos el 2026-11-07: (a).** 35b se fusionó con la medida 3 (`556c7b6`, `b493986`); este
  change hace usuario de aplicación, desarrollo, migración, rotación y validación. No necesita respuesta del owner.
- **Q2 [no bloqueante] Lugar en el plan.** (a) primera fila tras la 35, antes de `golden-sets-reales` (36) —
  **recomendada** (se mantiene tras el debate): cierra un riesgo aceptado de ADR-058 y ADR-051 con usuarios reales ya
  dentro; (b) después de la 36; (c) cuando el owner la asigne.
- **Q3 [no bloqueante] Usuario de Mongo de solo lectura para las mediciones** (`run.sh`). (a) no, se queda la raíz con
  `assert-readonly.mjs` — **recomendada**: los días 7 y 14 ya habrán pasado; (b) sí, `linkvault_read` y una cuarta
  variable.
- **Q4 [no bloqueante] Cadencia de rotación.** (a) por evento (D6) — **recomendada**; (b) además cada 90 días.
- **Q5 [bloqueante para `/opsx:apply`] Desarrollo.** La fila dice «en el compose de producción y en el de desarrollo».
  (a) todos los puertos de `docker-compose.yml` atados a `127.0.0.1` y desarrollo sin autenticación — **recomendada y
  aplicada en este design**: quita la exposición a la red del equipo, que es el riesgo real de desarrollo, sin migrar
  volúmenes locales ni romper `.env` viejos; costo: desarrollo no ejercita la autenticación (R4) y la letra de la fila
  se cumple solo en su intención. (b) autenticación también en desarrollo, con el requirement reescrito como paridad con
  producción: vuelven unas diez tareas (compose de desarrollo con `keyFile` y `requirepass`, `.env.example` y `e2e.env`
  con credenciales, migración de volúmenes locales, el mismo healthcheck en los dos composes y su comprobación) y
  vuelve el riesgo de `.env` viejos que dejan de conectar.

## Debate iteración 1 (2026-11-04)

Critic: 3 P0 (F1, F2, F3). Business: 0 V0. Reflect de la sesión principal: se acepta el recorte de business como base
y se aplican los hallazgos de critic sobre él.

| id | decisión | motivo |
|---|---|---|
| Recorte de business | aceptado | simplifica F1; desarrollo queda en Q5 (a), con Q5 abierta al owner |
| Q5 | nueva, (a) aplicada | salen las tareas de autenticación en desarrollo, la migración de volúmenes locales, el healthcheck duplicado, R3 y B4; queda el arreglo de `withPort` |
| B1 | aceptado | el hijo arranca con `env: {}` («the child sees none of the worker variables»); R8 es de red; 0.3 lo comprueba y 9.3 anota el cierre en esos términos |
| B3 | aceptado | el healthcheck no crea la raíz; fuera el paso 2 y la ventana de localhost provocada por nosotros |
| B5 = F8 | aceptado | 8.1 corre `check-env-file.mjs` en la máquina del owner contra la copia y compara sumas con el host, como 35b |
| B6 | aceptado | la orden de generación agrega la línea sin mostrar el valor (D5) |
| B7 | aceptado | 8.2 es una orden, `check-auth.sh`, compartida con `verify-artifact.sh`; copia previa obligatoria (F22) |
| B8 | aceptado | rotación de la raíz como sección del RUNBOOK sin script, con el orden de F7 (D6); fuera las antiguas 7.1 y 7.3 |
| B9 | aceptado | los esquemas solo exigen credenciales en producción; los valores de relleno los rechaza solo `check-env-file` |
| B10 | aceptado | 0.3 confirma con el owner, sin valores, que las contraseñas de 35b cumplen D5 |
| B11 | rechazado | se mantiene Q2 (a) |
| F1 (P0) | aceptado, reescrito sobre el recorte | orden `hello` → raíz → replica set → usuario de aplicación → primario; sin crear la raíz; 18 sobre volumen con datos sale con `codeName` y procedimiento manual (D3, D8); 1.3 mide volumen vacío, con raíz y diez arranques seguidos |
| F2 (P0) | aceptado | las apps no rechazan el relleno de `verify.env`; con Q5 (a) no hay relleno de desarrollo ni e2e, y B9 deja el rechazo de relleno en `check-env-file` (D7.1) |
| F3 (P0) | aceptado | lista cerrada de tres; `MAIL_SMTP_PASSWORD` como excepción nombrada por el modo relay (D7) |
| F4 | aceptado | diez arranques seguidos sobre volumen vacío con `RestartCount` 0 (1.3a) |
| F5 | aceptado | códigos de reintento 51003, 10107 y 11602; el resto sale con `codeName`; usuario de aplicación en conexión aparte (D3) |
| F6 | aceptado | tarea de vuelta atrás con el compose anterior sobre el volumen migrado (2.5) |
| F7 | aceptado | orden de la rotación de la raíz (D6) |
| F9 | aceptado | (a) las tres variables declaradas en `.env.example` con comprobación de coincidencia, y relleno leído también de las URIs con `new URL()`; (b) 6.1 extiende la regla de 35b; R5 anterior eliminado |
| F10 | aceptado | reglas exactas del contrato del compose, una falsación por regla (D7.3, 6.3a, 6.3b) |
| F11 | aceptado | 7.2 reemplaza el párrafo de `down -v` y la sección del RUNBOOK de 35b; Context de `run.sh` actualizado |
| F12 | aceptado | 4.4 con alternativa sobre un doble de `MongoServerError` |
| F13 | aceptado | 1.3, 2.1, 2.4, 4.1 y 5.3 partidas sobre lo que queda tras el recorte |
| F14 | no aplica | con Q5 (a) los `.env` y worktrees de desarrollo no cambian; no hace falta la línea del README |
| F15 | aceptado | regex de `withPort` y el caso «URI sin puerto queda igual» (5.1) |
| F16 | aceptado | de un `ReplyError` de Redis solo un token de {`NOAUTH`, `WRONGPASS`} (D7.4) |
| F17 | aceptado | los tests de no-impresión usan usuario, clave y host aleatorios |
| F18 | aceptado | SHA-256 de `usersInfo({showCredentials: true})` para idempotencia y rotación (D10) |
| F19 | aceptado | más patrones en 1.1; línea sobre `collMod` en el RUNBOOK y en ADR-065 (D2) |
| F20 | aceptado | `seed-volume.sh` autentica solo si el contenedor tiene `MONGO_ROOT_USER` (D9) |
| F21 | aceptado | sin ventana de localhost provocada por nosotros (B3), el riesgo y la salvedad desaparecen |
| F22 | aceptado | `counts.mongosh.js` de solo lectura; `mongodump --archive` obligatorio antes de fusionar, fuera del host (D8) |
| F23 | decidido | ayudante y `check-auth.sh` en `config-files.txt`, instalados por el despliegue (D8) |

**Tareas tras la iteración 1:** 41 (antes 39), dos de ellas condicionales a Q1 = (b). **Preguntas:** Q1 y Q5 bloqueantes para
`/opsx:apply`; Q2, Q3 y Q4 no bloqueantes.

## Debate iteración 2 (2026-11-07)

Critic: 0 P0 (F1, F2 y F3 cerrados) y 13 P1. Business: 0 V0. Reflect: los 13 aceptados. Antes de aplicarlos se fusionó
`origin/main` en la rama (sin conflictos): 35b ya está en `main` y C1 y C10 se confirmaron sobre él.

| id | decisión | motivo |
|---|---|---|
| C1 | aceptado | `.env.example` conserva los rellenos de 35b y suma `MONGO_APP_PASSWORD` con uno del mismo estilo; la spec exceptúa los rellenos de la verificación en CI y de `.env.example`; 6.2 «declara, con relleno» |
| C2 | aceptado | 7.2 suma `MONGO_APP_PASSWORD` al anexo de secretos de la pila local del README (y a `verify-artifact.sh`, por `docs-stack-up`); se verifica ejecutando los pasos 2 y 4 |
| C3 | aceptado | fuera `api:seed-demo`: con el compose de producción, perder los datos es `down -v` y nada más; `mongorestore --nsInclude 'linkvault.*'` (D8, 7.2, ADR-065) |
| C4 | aceptado | fuera F20: `seed-volume.sh` no se toca, su guardia 2 rechaza el compose de producción (D9, 5.2) |
| C5 | aceptado | el ayudante autentica solo si el contenedor tiene la raíz (`MONGO_INITDB_ROOT_USERNAME`, el `MONGO_ROOT_USER` que Compose le pasa) y recibe `-f` y `--env-file`; `run.sh` sale de la tarea; 5.2 partida en RUNBOOK y verificación contra las dos pilas |
| C6 | aceptado | 7.1c ensaya la rotación de la raíz; RUNBOOK con la nueva en un temporal de modo 600 escrita en el `.env` y su copia solo después del `updateUser`, y qué hacer si el paso 2 falla (D6) |
| C7 | aceptado | 2.1a provoca cada código de reintento y anota cómo; 51003 sale si no se confirma; la salida es `e.codeName ?? e.name` (D3) |
| C8 | aceptado | el escenario de `verify.env` lo prueba `verify-artifact.sh` (2.4b); el test de 4.1a se renombra a lo que prueba: «accepts URIs with credentials in production» |
| C9 | aceptado | `check-auth.sh <compose-file> <env-file>`, como `deploy.sh`; borra entera su colección de control; 8.2 cuenta antes de llamarlo |
| C10 | aceptado | Context con 35b fusionado (`556c7b6`, `b493986`); Q1 cerrada como (a) por los hechos; fuera 2.0a y 2.0b; 0.3 punto 4 se mantiene |
| C11 | aceptado | el ayudante y la siembra versionada pasan antes de las mediciones (1.0a, 1.0b); 1.3c-i siembra con un `mongo:7.0.43` sin autenticación sobre el mismo volumen |
| C12 | aceptado | 7.1a (aplicación) y 7.1b (Redis, job por el outbox o por el ayudante, no por la API); 1.3c-i y 1.3c-ii |
| C13 | aceptado | R8 en el design y una línea en «Riesgos aceptados» de ADR-065: el único guardia contra el relleno es `check-env-file`, que corre el owner a mano |

**Tareas tras la iteración 2:** 43 (antes 41). **Preguntas:** Q5 bloqueante para `/opsx:apply`; Q2, Q3 y Q4 no
bloqueantes; Q1 cerrada por los hechos.

Convergencia: SI

## Respuestas del owner y aprobación

Pendiente.
