## Context

**Estado del repositorio** (`origin/main`, `5b92d28`, leído el 2026-11-04):

- `docker-compose.yml` y `docker-compose.prod.yml`: `mongo:7.0.43` con `--replSet rs0 --bind_ip_all`, sin `--auth` ni
  `keyFile`; `redis:7.4.11` sin `requirepass`. En desarrollo los dos publican su puerto en el host (`MONGO_PORT`,
  `REDIS_PORT`). El healthcheck de `mongo` ya **escribe**: ejecuta `rs.initiate` si el replica set no está
  inicializado y solo da sano con primario escribible.
- `api` y `worker` leen `MONGO_URI` y `REDIS_URL` (zod: `^mongodb(\+srv)?:\/\/\S+$` y `^rediss?:\/\/\S+$`). Los dos
  módulos de conexión registran solo el **nombre** del error (`mongo-initial-connect-retry.ts`: «el mensaje del driver
  puede incluir hosts o detalles de la URI»). `loadApiConfigOrExit` y su gemelo del worker escriben variables y motivo,
  **nunca valores**. El redactor de pino (`logger-params.ts`) no conoce `MONGO_URI` ni `REDIS_URL`.
- Los tests de integración usan `MongoMemoryReplSet` (`@linkvault/testing`) sin autenticación; los de Redis usan
  puertos cerrados o una Redis local opcional (`OUTBOX_REDIS_LOCAL=1`).
- `apps/web-e2e/scripts/e2e-stack.ts`, `withPort`, reescribe el puerto con `^([a-z][a-z0-9+.-]*:\/\/[^/:?#]+):\d+`: con
  una URI `esquema://usuario:clave@host:puerto` el grupo se detiene en `usuario` y el puerto **no se reescribe** (o se
  reescribe la clave, si empieza por dígitos). Hoy no pasa porque ninguna URI lleva credenciales.
- `apps/api/src/seed/demo-seed.guards.ts` ya extrae los hosts de una URI con credenciales.
- El RUNBOOK tiene más de veinte órdenes `docker compose exec mongo mongosh "mongodb://localhost:27017/…"` sin
  autenticación; `infra/staging/run.sh` y `seed-volume.sh` también.
- `infra/ci/check-env-file.mjs` revisa un `.env` de despliegue contra los `${VAR:?}` del compose sin imprimir valores;
  `tools/repo-checks/src/compose-env-contract.check.mjs` comprueba que el compose declara lo que los esquemas exigen.

**Lo que trae 35b** (PR #92, abierto al 2026-11-04; design D18, medida 3; tareas 12.4 y 12.5 de
`openspec/changes/staging-host/`), que este change toma como base y no redefine:

- Redis con `requirepass` (`REDIS_PASSWORD`, obligatoria con `:?`), leída de un fichero de configuración escrito al
  arrancar; healthcheck con `REDISCLI_AUTH`; `REDIS_URL` con la contraseña.
- Mongo con `MONGO_ROOT_USER` y `MONGO_ROOT_PASSWORD`; el `keyFile` **generado dentro del contenedor al arrancar** (uid
  999, modo 400), sin conservarlo ni tratarlo como secreto; la raíz creada solo sobre un **volumen vacío**;
  healthcheck, `rs.initiate`, `run.sh` y `verify-artifact.sh` autenticados dentro de `--eval` leyendo `process.env`;
  `$$VAR` en `command` y healthchecks; `MONGO_URI` con credenciales y `authSource=admin`.
- Un volumen con datos y sin usuario «se queda sin usuario y su healthcheck falla; el README lo dice y da `down -v`».
- Las contraseñas viven solo en `.env.staging` y en su copia fuera del host; **no son secretos de GitHub**.
- El requirement nuevo de `platform/production-deploy` «La pila de staging separa la red de cada proceso y no deja
  datos sin credenciales» («Mongo y Redis NO SHALL aceptar operaciones sin credenciales, y ninguna contraseña SHALL
  aparecer en los argumentos de un proceso»).

**Por qué hace falta un change aparte si 35b ya pone contraseñas:** el owner decidió las dos cosas el mismo día
(2026-10-29): la defensa de ADR-056 §6 dentro de 35b (Q3 de `enrichment-egress-guard`) y la autenticación de Mongo y
Redis en un change propio después de la fila 35 (Q7 (b) de `cv-extract-isolation`). Este design las reconcilia sin
contradecir ninguna (D1): 35b cierra lo urgente en staging antes de invitar; este change lo completa en todos los
entornos, quita la raíz a las aplicaciones, migra sin borrar y escribe rotación y validación.

## Goals / Non-Goals

**Goals:**

- Mongo y Redis rechazan toda operación sin credenciales en **todos** los entornos con compose: desarrollo, la pila de
  `e2e-stack`, la verificación del artefacto en CI, staging y producción.
- `api` y `worker` entran a Mongo con un usuario de **mínimo privilegio**; la raíz no está en su entorno.
- Un volumen existente adopta la autenticación **sin perder datos** y sin `down -v`.
- Las tres credenciales tienen generación, custodia y **rotación escritas y ensayadas**.
- Una configuración inválida falla **antes** o **al** arrancar, nombrando la variable y sin mostrar su valor.

**Non-Goals:**

- **El flag de red de Node** (`--allow-net`) para el hijo de lectura de CV. Por decisión del owner (Q7 (a) de
  `cv-extract-isolation`, 2026-10-29) se agrega al subir a Node 26 LTS, en ese change, comprobando allí que el hijo
  queda sin red. Este change no lo adelanta ni lo condiciona.
- TLS entre servicios del mismo host, usuarios ACL de Redis, un usuario de Mongo de solo lectura (Q3), copias de
  seguridad, un gestor de secretos, rotar las claves del almacén de objetos (`S3_*`, `OBJECT_STORE_SSE_KEY`).
- Redes, almacén y metadatos: son D18 medidas 1, 2, 4 y 5 de 35b.
- Los tests unitarios y de integración siguen contra `MongoMemoryReplSet` sin autenticación (D9).

## Decisions

### D1. La base es 35b D18, medida 3; este change la extiende y no la redefine

Se conservan sus nombres (`REDIS_PASSWORD`, `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD`), su mecanismo de `requirepass`
por fichero escrito al arrancar, su `keyFile` generado en el contenedor, su autenticación de `mongosh` dentro de
`--eval` desde `process.env` y su regla de que ninguna contraseña va en argumentos. Lo que este change cambia de ese
texto, una vez archivado 35b:

- `MONGO_URI` de `api` y `worker` pasa de la raíz al usuario de aplicación (D2).
- «Volumen anterior sin usuario → `down -v`» pasa a «volumen anterior sin usuario → la raíz se crea sola» (D3, D8).

**Cuándo se aplica:** después de archivar 35b y de cerrar la fila 35 (35c archivado), sin excepción a la precedencia
de ADR-048 §Consecuencias. Así el compose de producción se edita **después** de 35b, nunca a la vez. La tarea 0.3
relee el compose y el requirement de 35b tal como queden en `main` y, si difieren de lo descrito arriba, este design
vuelve a debate antes de `/opsx:apply`.

**Si 35b no llevara la medida 3** (su debate la retira o el owner la saca): este change la absorbe entera, con el texto
de D18 medida 3 como especificación de partida, y el grupo 2 crece en dos tareas (2.0a y 2.0b). Es la Q1.

*Descartado:* rediseñar aquí el mecanismo de 35b (dos diseños del mismo compose en ramas a la vez); fundir este change
en 35b (agranda la fila 35 contra ADR-051 §1 y retrasa invitar).

### D2. Un usuario de aplicación con `readWrite` sobre la base de la aplicación

- Usuario `linkvault_app` (el nombre no es secreto y queda fijo en el compose), creado **en la base `linkvault`** con
  un único rol, `readWrite` sobre `linkvault`. La URI queda
  `mongodb://linkvault_app:${MONGO_APP_PASSWORD:?}@mongo:27017/linkvault?replicaSet=rs0`: el `authSource` por defecto
  es la base de la ruta, así que no hace falta nombrarlo.
- `api` y `worker` reciben solo esa URI. `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD` y `MONGO_APP_PASSWORD` solo están en
  el entorno del servicio `mongo`.
- `readWrite` cubre lo que hace la aplicación hoy: lecturas y escrituras, transacciones del outbox, `createIndexes` y
  `dropIndexes` de Mongoose y de las migraciones de índices, `listCollections`. El `ping` del indicador de salud no
  pide privilegios. La tarea 1.1 lo **inventaría en el código** (búsqueda de `runCommand`, `command(`, `collMod`,
  `admin()`) y la 1.2 lo **prueba** con un replica set con autenticación; si algo pide más, se anota y se decide en el
  PR (un rol propio con esa acción, nunca `dbAdmin` entero ni la raíz).

*Descartado:* seguir con la raíz en las aplicaciones (una credencial filtrada desde `api` o `worker` daría control del
servidor, también de los usuarios); `dbOwner` (incluye gestionar usuarios de la base); el usuario en `admin` (obliga a
`authSource=admin` sin ganar nada).

### D3. El healthcheck de `mongo` asegura los usuarios, igual que ya asegura el replica set

El healthcheck actual ya hace trabajo idempotente (`rs.initiate`); se reescribe para que, en cada latido, haga en este
orden y sin imprimir ningún valor:

1. Si el replica set no está inicializado, `rs.initiate` con `mongo:27017` (como hoy).
2. **Si el servidor no tiene ningún usuario** (la excepción de localhost de MongoDB está activa: solo admite crear el
   primer usuario y solo desde dentro del contenedor), crea la raíz con `MONGO_ROOT_USER` y `MONGO_ROOT_PASSWORD`. Es
   el camino de un volumen con datos de antes de la autenticación (D8). En un volumen vacío la raíz ya la creó el
   arranque de la imagen (35b), y este paso no hace nada.
3. Se autentica como raíz.
4. Asegura `linkvault_app`: si no existe, lo crea; si sus roles no son exactamente `readWrite@linkvault`, los
   reemplaza; si autenticarse con `MONGO_APP_PASSWORD` falla, le pone esa contraseña. El `.env` es la única fuente de
   verdad de esa contraseña (D5).
5. Sano solo con primario escribible (como hoy).

Los errores se capturan y se imprime solo su `codeName`; la salida del healthcheck (que `docker inspect` guarda) nunca
contiene un valor. El código vive en línea en el `test:` del compose, como hoy, y es **el mismo texto** en los dos
composes; una comprobación de `repo-checks` lo compara (tarea 6.3).

*Descartado:* un servicio de un solo uso (`mongo-users`) con `service_completed_successfully` (cómo lo trata
`up --wait` no está medido en la versión de Compose del host, el runner de `e2e-stack` comprueba el estado de cada
servicio y `deploy.sh` compara imágenes por servicio); una orden de aprovisionamiento tras el `up`, como la del almacén
(la readiness de `api` fallaría antes, porque `up --wait` espera a `api`); los scripts de
`/docker-entrypoint-initdb.d` (solo corren sobre un volumen vacío y exigen un fichero montado más en el host).

**Diferencia con el almacén.** `platform/object-store` exige un healthcheck de solo lectura porque crear buckets desde
el healthcheck escondía un aprovisionamiento a medias. Aquí no hay estado parcial que esconder: cada paso es
idempotente y el healthcheck no da sano hasta completar todos.

### D4. Redis: `requirepass` también en desarrollo, sin usuarios ACL

En desarrollo, el mismo mecanismo que 35b en producción: la contraseña se lee de un fichero escrito al arrancar desde
`REDIS_PASSWORD` (con valor de desarrollo por defecto), y el healthcheck usa `REDISCLI_AUTH`. Un solo secreto
compartido por `api` y `worker`.

*Descartado:* usuarios ACL por proceso (BullMQ usa muchos comandos y scripts Lua; la lista de permisos sería frágil y
los dos procesos usan las mismas colas).

### D5. Generación, formato y custodia

- **Generación:** el owner, en su máquina o en el host, con un generador criptográfico (`openssl rand -hex 32`, 64
  caracteres `[0-9a-f]`, la misma convención que `OBJECT_STORE_SSE_KEY`). La orden va en `infra/README.md`; los valores,
  nunca.
- **Formato exigido** (`check-env-file.mjs`, D7): entre 32 y 128 caracteres del conjunto no reservado de las URI
  (`A-Z a-z 0-9 . _ ~ -`). Así la contraseña entra en `MONGO_URI` y `REDIS_URL` sin codificar, no la interpreta
  Compose (`$`) ni la corta un fichero de entorno (`#`). Se admite más que hex para no invalidar valores que el owner
  ya haya puesto con 35b, si cumplen.
- **Custodia:** solo el `.env` del host y su copia fuera del host (regla de la copia de `.env.staging`, 35b). No son
  secretos de GitHub, no se pegan en un PR, una issue ni una conversación, y no se escriben en este change.
- **Desarrollo, `e2e-stack` y CI:** valores de relleno versionados, con prefijo `linkvault-dev-`, `linkvault-e2e-` o
  `linkvault-ci-` y la palabra `not-a-secret` donde quepa, como los de `S3_*`. No protegen nada: existen para que la
  forma sea la de producción.

### D6. Rotación

| Credencial | Dónde vive el valor que manda | Cómo se rota | Corte |
|---|---|---|---|
| `MONGO_APP_PASSWORD` | `.env` (el healthcheck la impone, D3) | editar el `.env` → `up -d` (recrea `mongo`, `api`, `worker`) | segundos |
| `REDIS_PASSWORD` | `.env` (el fichero de Redis se escribe al arrancar) | editar el `.env` → `up -d` (recrea `redis`, `api`, `worker`) | segundos; los jobs persisten (AOF en producción) |
| `MONGO_ROOT_PASSWORD` | **el volumen** (la raíz ya existe) | `infra/datastore/rotate-mongo-root.sh`: lee la nueva sin eco, la cambia autenticándose con la actual y pide editar el `.env`; después `up -d mongo` | el del reinicio de `mongo` |

- El script de la raíz pasa la contraseña nueva al contenedor **por entorno** (`docker compose exec -e NOMBRE` sin
  valor, que la toma del entorno del script), nunca por argumentos; la lee con `read -s`; no la imprime; sale ≠0 sin
  cambiar nada si la actual no autentica. Se añade a `infra/deploy/config-files.txt` para que llegue al host.
- **Cuándo:** por evento —sospecha de exposición, salida de alguien con acceso al host, cualquier impresión accidental—
  y no por calendario (Q4).
- El `keyFile` no se rota: se regenera en cada arranque (35b).

*Descartado:* rotar la raíz con una variable `MONGO_ROOT_PASSWORD_PREVIOUS` que el healthcheck probaría (deja un
secreto viejo en el `.env` y otra rama en el healthcheck); `CONFIG SET requirepass` en caliente (la contraseña nueva
viajaría en los argumentos de `redis-cli` y el fichero escrito al arrancar dejaría de ser la fuente de verdad).

### D7. Validación sin mostrar secretos

1. **Al arrancar, en producción** (`api-config.schema.ts`, `worker-config.schema.ts`): con `NODE_ENV=production`,
   `MONGO_URI` SHALL llevar usuario y contraseña y `REDIS_URL`, contraseña; una contraseña igual a un valor de relleno
   versionado (D5) se rechaza. El fallo sale por el camino que ya existe (`formatInvalidVariables`): variable y motivo,
   nunca el valor. En desarrollo y en tests no se exige (D9).
2. **Antes del `up`** (`check-env-file.mjs`): para `REDIS_PASSWORD`, `MONGO_ROOT_PASSWORD` y `MONGO_APP_PASSWORD`,
   formato de D5, distinta de todo valor de relleno versionado (leídos de `docker-compose.yml`, `.env.example`,
   `apps/web-e2e/e2e.env` e `infra/ci/verify.env`, no copiados) y distintas entre sí. Solo nombres y PASS/FAIL.
3. **En el repositorio** (`compose-env-contract`): en `docker-compose.prod.yml`, toda variable cuyo nombre termine en
   `_PASSWORD` SHALL usar `${VAR:?…}`; un `:-` o un `${VAR}` a secas falla nombrándola. `MONGO_ROOT_*` y
   `MONGO_APP_PASSWORD` NO SHALL estar en el entorno de `api` ni de `worker`.
4. **En los registros**: el redactor suma `MONGO_URI`, `REDIS_URL`, `REDIS_PASSWORD`, `MONGO_ROOT_PASSWORD` y
   `MONGO_APP_PASSWORD`; los avisos de conexión fallida, que hoy solo llevan el nombre del error, suman su código
   (`AuthenticationFailed`, `WRONGPASS`, `NOAUTH`), que permite distinguir una credencial mala de un servidor caído sin
   mostrar host ni URI.

### D8. Migración sin pérdida, por entorno

| Entorno | Estado antes | Qué hace quien opera | Qué pasa |
|---|---|---|---|
| Desarrollo | volumen con datos y sin usuarios | actualizar `MONGO_URI` y `REDIS_URL` de su `.env` desde `.env.example` y `pnpm infra:up` | D3 paso 2 crea la raíz y el paso 4 el usuario de aplicación; los datos quedan |
| `e2e-stack`, verificación en CI | volúmenes desechables | nada | — |
| Staging | raíz de 35b, apps como raíz | el owner añade `MONGO_APP_PASSWORD` al `.env.staging` y a su copia **antes de fusionar**; la fusión despliega | D3 paso 4 crea el usuario; `api` y `worker` cambian de URI |
| Producción | sin host | — | el primer `up` parte de un volumen vacío |

- **Antes de migrar** un volumen con datos que importen, una copia con `mongodump --archive` desde el contenedor; en
  staging, desechable por ADR-051 §2, se anota la decisión de hacerla o no.
- **Vuelta atrás:** el compose anterior no exige credenciales a nadie que ya las tenga: los usuarios creados se quedan
  en el volumen, sin uso, y los datos no se tocan. En staging, vuelta atrás del despliegue como la escribe 35b.
- Si el `.env.staging` no tiene `MONGO_APP_PASSWORD` al fusionar, el `up` aborta nombrándola **antes de tocar
  contenedores** (`:?`) y la pila anterior sigue arriba; el owner la añade y relanza solo el job de despliegue.

### D9. Desarrollo, `e2e-stack` y tests

- `docker-compose.yml` copia el bloque de `mongo` y `redis` de producción salvo `ports`, `restart`, el origen del
  volumen y los valores por defecto de relleno; el healthcheck es el mismo texto (D3).
- `.env.example`: `MONGO_URI` y `REDIS_URL` con las credenciales de relleno y un comentario que remite al README.
- `apps/web-e2e/e2e.env`: las tres variables de relleno y las URIs con credenciales; `withPort` deja la parte de
  usuario y contraseña intacta.
- Tres pruebas end-to-end (`links`, `match`, `freshness`) abren Mongo con un valor por defecto escrito en el código; se
  alinea con el de `.env.example`. `e2e-suite-lot-2` moverá esos accesos a ayudantes `local-only`: si ya lo hizo al
  aplicar, se toca el ayudante y no las pruebas.
- **Tests unitarios y de integración**: siguen sin autenticación. Una sola prueba de integración nueva levanta un
  replica set **con** autenticación (si `mongodb-memory-server-core` lo admite, medido en 1.2; si no, la misma prueba
  pasa a `verify-artifact.sh`) para demostrar que `readWrite` basta y que sin credenciales se rechaza.

### D10. Cómo se verifica

- Cada requirement tiene al menos una prueba nombrada; los guardias (formato, contrato del compose, redacción,
  exigencia en producción) se falsan en su tarea y se restauran.
- `verify-artifact.sh` gana una sección: sin credenciales Mongo y Redis rechazan; el usuario de aplicación escribe en
  `linkvault` y no puede crear usuarios ni leer `admin`; la raíz no está en el entorno de `api` ni de `worker`.
- La migración y la rotación se **ensayan** en una pila propia con datos sembrados y recuento antes y después.
- Ninguna verificación imprime un valor: se comparan con `node` sumas o longitudes, y los ficheros temporales se
  borran.

## Risks / Trade-offs

- [R1. El healthcheck escribe usuarios en cada latido] → los pasos son idempotentes y baratos; solo escribe cuando
  algo difiere. Si un operador cambia a mano la contraseña del usuario de aplicación, el healthcheck la devuelve a la
  del `.env`: es lo buscado (una fuente de verdad), y el RUNBOOK lo dice.
- [R2. La excepción de localhost en un volumen sin usuarios] → existe desde que se activa la autenticación hasta el
  primer latido (segundos), solo desde dentro del contenedor `mongo`; D3 la cierra en ese latido. Antes de este change
  el servidor no pedía nada a nadie.
- [R3. Un `.env` de desarrollo viejo deja `api` sin conectar] → el aviso de conexión lleva `AuthenticationFailed`
  (D7.4) y el README dice qué dos líneas copiar; `/health` lo da caído, no sano.
- [R4. `readWrite` puede no bastar para algo que el inventario no vea] → 1.1 y 1.2 antes de cambiar la URI; la
  verificación en CI escribe y crea índices con el usuario de aplicación.
- [R5. Una contraseña puesta con 35b fuera del conjunto de D5] → `check-env-file.mjs` la rechaza antes de fusionar;
  rotarla (D6) la arregla. En 35b, un valor con `/`, `+` o `=` ya rompería su `MONGO_URI`: se avisa en el debate de
  35b (fuera de este change).
- [R6. Conflicto con `e2e-suite-lot-2`] → los dos tocan los accesos a Mongo de las pruebas e2e; el que entre segundo
  reescribe sobre el primero (D9).
- [R7. El healthcheck dura más] → mide 1.3 contra su `timeout: 10s`; si pasa de 5 s, se sube el `timeout` y se anota.
- [R8. Con la fila 35 cerrada, esto se despliega con usuarios reales] → la fusión despliega staging; el owner prepara
  el `.env.staging` antes (D8) y la tarea 8.2 comprueba recuentos antes y después.

## Migration Plan

1. 0.1-0.3: preguntas, debate, aprobación y relectura de 35b archivado.
2. Grupos 1-7 en una rama, con la pila local y `e2e-stack` en verde; el compose de producción cambia en el mismo PR.
3. Antes de fusionar: el owner genera `MONGO_APP_PASSWORD`, la añade al `.env.staging` y a su copia, y ejecuta
   `check-env-file.mjs` en el host (8.1).
4. Fusión en una ventana autorizada por el owner; su push despliega staging (8.2).
5. Vuelta atrás: la de 35b (relanzar el despliegue del commit anterior); los usuarios quedan en el volumen sin uso.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`] Frontera con 35b D18, medida 3.**
  (a) 35b conserva la medida 3 en staging y este change hace usuario de aplicación, desarrollo, migración, rotación y
  validación — **recomendada**: respeta las dos decisiones del owner del 2026-10-29 y staging no espera a este change
  para tener contraseñas; (b) 35b retira la medida 3 y este change la absorbe (tareas 2.0a y 2.0b): staging invitaría
  sin contraseñas, contra ADR-056 §6 y la Q3 de `enrichment-egress-guard`; (c) fundir este change en 35b: agranda la
  fila 35 y retrasa invitar.
- **Q2 [no bloqueante] Lugar en el plan.** (a) primera fila tras la 35, antes de `golden-sets-reales` (36) —
  **recomendada**: cierra un riesgo aceptado de ADR-058 y ADR-051 con usuarios reales ya dentro; (b) después de la 36;
  (c) cuando el owner la asigne. Hoy no tiene fila en `docs/design-v0.2.md` §6.
- **Q3 [no bloqueante] Usuario de Mongo de solo lectura para las mediciones** (`run.sh`). (a) no, se queda la raíz con
  `assert-readonly.mjs` — **recomendada**: los días 7 y 14 de medición ya habrán pasado cuando esto se aplique; (b) sí,
  `linkvault_read` con `read@linkvault` y una cuarta variable.
- **Q4 [no bloqueante] Cadencia de rotación.** (a) por evento (D6) — **recomendada**: staging es desechable y cada
  rotación es un corte; (b) además cada 90 días, con un recordatorio en el RUNBOOK.

## Debate

Pendiente: lo orquesta la sesión principal con `/lv:debate` (critic, business, reflect).

## Respuestas del owner y aprobación

Pendiente.
