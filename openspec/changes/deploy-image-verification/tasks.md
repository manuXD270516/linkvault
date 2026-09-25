## 1. Los dos inventarios que el resto de grupos consume

> **Los dos inventarios están escritos en [`inventarios.md`](./inventarios.md)**, que es el fichero que los grupos 4, 5
> y 12 consumen. Las tareas 1.1 y 1.2 apuntan ahí; aquí solo queda su enunciado y el estado.

- [x] 1.1 [infra] Extraer de `apps/api/src/infrastructure/config/api-config.schema.ts` y `apps/worker/src/infrastructure/config/worker-config.schema.ts` la lista completa de obligatorias (las que no tienen `.default()` ni `.optional()`), añadiendo las que valida en cadena `parseAiConfig` (`AI_VAULT_KEY`, obligatoria en producción como base64 de 32 bytes) y las condicionales del `superRefine` (`MAIL_SMTP_HOST`/`MAIL_SMTP_PORT` con `MAIL_PROVIDER=smtp`, `RESEND_API_KEY` con `resend`); verificar contando: `api` no son dos variables de infraestructura sino ~29 más `AI_VAULT_KEY`, y dejar la lista escrita en el change porque los grupos 4, 5 y 12 dependen de ella.
- [x] 1.2 [infra] Comprobar en `libs/ai/src/infrastructure/config/parse-ai-config.ts` que `mock` en `AI_CHAIN` (y en `AI_EMBED_CHAIN`) está **prohibido con `NODE_ENV=production`**, y que las imágenes de `api` y `worker` hornean `ENV NODE_ENV=production`; verificar que, por tanto, la verificación del artefacto tendrá que usar `AI_CHAIN=none` y dejarlo anotado antes de escribir el grupo 5.

## 2. Arreglar el build de las imágenes

- [x] 2.1 [infra] En `docker/api.Dockerfile`, retirar `packageManager` del manifiesto generado antes del install de producción, **conservando `--frozen-lockfile`**; verificar construyendo la imagen localmente y comprobando que esa capa, que antes abortaba con `ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE` sobre `packageManagerDependencies` (salida literal en `proposal.md` §Why y ADR-048 §1), ahora termina con éxito.
- [x] 2.2 [infra] Lo mismo en `docker/worker.Dockerfile`; verificar con el build local de esa imagen y comprobando de paso que su manifiesto generado también traía el campo, es decir que el defecto era el mismo y no otro parecido.
- [x] 2.3 [infra] Dejar un comentario en ambos Dockerfiles que diga **por qué** se retira ese campo y qué pasa si alguien quita esa línea (vuelve `ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE`), y anotar ahí mismo que `docker/web.Dockerfile` no lleva el arreglo porque no tiene etapa de dependencias de producción (copia `dist/apps/web/browser` a nginx); verificar leyendo los tres Dockerfiles seguidos que la asimetría queda explicada y no se lee como un olvido.
- [x] 2.4 [infra] Comprobar que el arreglo **no** desactiva la reproducibilidad: alterar a mano una versión del lockfile generado y verificar que el build **falla**; restaurar. Si pasara en verde, el arreglo habría aflojado el candado sin decirlo.

- [x] 2.5 [infra] **La imagen se construye y no arranca: cuarto defecto nunca verificado.** El contenedor muere con `Cannot find module 'tslib'`. La causa: `tslib` está declarada como `devDependency` en la raíz, así que el manifiesto que genera Nx para el artefacto **no la incluye**, pero el bundle la requiere en tiempo de ejecución (`require("tslib")`, ~1.500 apariciones en `dist/apps/api/main.js`) porque `importHelpers` hace que el código emitido dependa de ella. Es una dependencia de ejecución mal declarada. **Decisión humana (2026-09-24): moverla a `dependencies`**, que es el arreglo mínimo y deja que Nx la incluya sola; se descartó dejar de externalizarla en webpack, que cambia cómo se construye el bundle y tiene más radio. Verificar que tras el cambio el manifiesto generado la lista.
- [x] 2.6 [infra] **Y comprobar que la imagen arranca de verdad**, que es lo que el grupo 2 dio por bueno sin ejecutarlo: `docker run` de `api` y de `worker` con configuración mínima, viendo el proceso levantar en vez de morir importando. Esta tarea existe porque el build en verde **no dice nada** sobre si el artefacto corre — la tesis entera de este change— y al implementarlo caímos justo en eso.

> **Corrección de 2.5 al implementarla (2026-09-24).** El enunciado daba por hecho que mover `tslib` a
> `dependencies` bastaba «para que Nx la incluya sola». **No basta, y se comprobó ejecutando**: con `tslib` ya en
> `dependencies`, el manifiesto generado seguía sin listarla, en Windows y también dentro de la imagen Linux
> (`docker build` completo). La causa real es otra y es de Nx 23.2.1: `GeneratePackageJsonPlugin` llama a
> `readTsConfig(options.tsConfig)` con la ruta **tal cual** —`apps/api/tsconfig.app.json`, relativa al raíz del
> workspace— mientras el ejecutor corre con el cwd en el directorio del proyecto, así que el fichero no se
> encuentra, `importHelpers` se lee `false` y Nx **nunca llega a considerar** `tslib`. El resto de consumidores del
> mismo valor sí lo resuelven (`path.isAbsolute(tsConfig) ? tsConfig : path.join(options.root, tsConfig)`,
> `@nx/webpack/dist/src/plugins/nx-webpack-plugin/lib/apply-base-config.js:267-269`).
>
> El arreglo son **las dos cosas**, y cada una es necesaria —las cuatro combinaciones se ejecutaron—:
>
> | `tslib` en | `tsConfig` | `tslib` en el manifiesto |
> |---|---|---|
> | `devDependencies` | relativo | no (estado anterior: el contenedor moría con `Cannot find module 'tslib'`) |
> | `dependencies` | relativo | **no** (lo que 2.5 daba por suficiente) |
> | `devDependencies` | absoluto | **no** (`createPackageJson` descarta con `isProduction` lo que esté en `devDependencies` raíz) |
> | `dependencies` | absoluto | sí, `tslib 2.8.1`, y además en el `pnpm-lock.yaml` podado |
>
> Poner la ruta absoluta **no** es la alternativa descartada por radio (dejar de externalizar `tslib` en webpack):
> el bundle se construye igual y sigue haciendo `require("tslib")`; lo único que cambia es qué manifiesto genera Nx.

## 3. El sitio donde viven las comprobaciones de repositorio

- [x] 3.1 [infra] Crear el proyecto `tools/repo-checks` (al estilo de `tools/workspace-rules/project.json`) **ya con una comprobación real**, no vacío: que **todos** los servicios de `docker-compose.prod.yml` declaren `healthcheck` —hoy los siete lo hacen, así que nace en verde y no deja el repositorio en rojo entre esta tarea y las de los grupos 4 y 10, que añaden las demás—. Dos reglas escritas en el propio `project.json`: **un target por comprobación**, cada uno con `inputs` **explícitos** que nombren los ficheros que lee, y un target agregador que dependa de todos. Verificar con `pnpm nx show project repo-checks --json` redirigido a un archivo que el proyecto sale y que el agregador existe, y ejecutando el agregador y viendo que corre **una** comprobación y pasa.
- [x] 3.2 [infra] Añadir a `ci.yml` un paso **incondicional** que ejecute el agregador (no `nx affected`: son greps y tardan segundos, y así ninguna comprobación depende de que el cálculo de afectación la alcance), con un guardia que **falle si no se ejecutó ninguna comprobación**, para que un agregador vacío no cuente como verde. Esta tarea SHALL ir **después** de 3.1 y nunca antes: el guardia sobre un agregador vacío deja el CI rojo por construcción y sin nada que restaurar. Verificar forzando el caso vacío, viendo el fallo, y restaurando.

## 4. El compose de producción declara lo que los procesos exigen

- [x] 4.1 [infra] Añadir al servicio `api` de `docker-compose.prod.yml` las cuatro que faltan: `MAIL_PROVIDER`, `MAIL_FROM`, `AUTH_VERIFY_TOKEN_TTL_HOURS` y `AUTH_RESET_TOKEN_TTL_SECONDS`; verificar con `docker compose -f docker-compose.prod.yml --env-file <env> config`.
- [x] 4.2 [infra] Añadir al servicio `worker` las tres que faltan: `WEB_BASE_URL`, `MAIL_PROVIDER` y `MAIL_FROM`; verificar con `config` y con un arranque real del servicio.
- [x] 4.3 [infra] `MAIL_PROVIDER` **no** puede quedar por defecto en `capture` ni en ningún valor que capture o deseche los mensajes sin entregarlos: declararla en la forma que aborta el `up` nombrándola (`${MAIL_PROVIDER:?}`); verificar que sin ella el `up` falla con el nombre de la variable, y no arranca un despliegue que envía verificaciones a ninguna parte.
- [x] 4.4 [backend] El `superRefine` de correo **solo existe en `api`**: `worker-config.schema.ts` únicamente comprueba `ENRICH_DEADLINE_MS`, así que hoy un worker con `MAIL_PROVIDER=smtp` y sin `MAIL_SMTP_HOST` arranca y falla al enviar el primer correo. Añadir al esquema del worker las mismas dos ramas (`smtp` → `MAIL_SMTP_HOST` y `MAIL_SMTP_PORT`; `resend` → `RESEND_API_KEY`), cada issue con su `path`; verificar con un test unitario por rama que el parseo falla nombrando la variable.
- [x] 4.5 [infra] Pasar las condicionales de correo (`MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `RESEND_API_KEY`) en los **dos** servicios del compose; verificar arrancando `api` y `worker` con `MAIL_PROVIDER=smtp` y sin `MAIL_SMTP_HOST` y viendo que los dos salen ≠0 nombrándola — en `worker` es posible gracias a 4.4, y antes de 4.4 no lo era.
- [x] 4.6 [infra] Corregir el namespace por defecto de las tres imágenes del compose (`ghcr.io/linkvault/linkvault-api`, `-worker` y `-web`): apunta a una organización ajena que nadie controla y que nunca se ha ejercitado porque los workflows siempre exportan `API_IMAGE`/`WORKER_IMAGE`/`WEB_IMAGE`; dejar el namespace real del repositorio; verificar con `config` **sin** exportar esas tres variables y leyendo las imágenes resueltas.
- [x] 4.7 [infra] Escribir en `tools/repo-checks` la comprobación que compara `docker-compose.prod.yml` contra los dos esquemas zod y **falla nombrando la variable y el servicio** al que le falta; que sea **unidireccional** (el compose puede declarar opcionales de más; lo prohibido es que el esquema exija lo que el compose no da) y que trate como declarada la variable con valor fijo, con `${VAR:-…}` o con `${VAR:?}`.
- [x] 4.8 [infra] Las condicionales van **declaradas** en la comprobación —una tabla en el fichero de la comprobación, del tipo "`MAIL_PROVIDER=smtp` exige `MAIL_SMTP_HOST` y `MAIL_SMTP_PORT` en el servicio X"— y **no** inferidas leyendo el TypeScript del `superRefine`, que no es analizable con un grep; verificar que la tabla cubre las tres ramas de 4.4/4.5 y que la comprobación falla si se borra una de esas variables del compose.
- [x] 4.9 [infra] Comprobar que la comprobación **cae** por los dos lados: (a) borrar a mano `AUTH_RESET_TOKEN_TTL_SECONDS` del servicio `api` y ver que falla nombrándola; (b) añadir a mano una obligatoria nueva al esquema de `worker` y ver que falla nombrándola; restaurar las dos. Sin esto, el grupo 4 sería otra afirmación no verificada.
- [x] 4.10 [infra] Comprobar que **no** cae en la dirección permitida: una variable que el esquema trata como opcional y el compose declara (p. ej. `AI_QUOTAS`) no hace fallar nada; verificar con el caso real.
- [x] 4.11 [infra] Comprobar que la comprobación detecta el valor por defecto peligroso: poner `${MAIL_PROVIDER:-capture}` y ver que falla diciendo que ese proveedor descarta correos; restaurar.
- [x] 4.12 [infra] **El healthcheck de `worker` decide por accidente**: hoy (`docker-compose.prod.yml:264-271`) solo hace `JSON.parse` del cuerpo y se apoya en que el controlador responde `503` cuando un indicador está caído; el día que responda `200` describiendo un estado degradado, `up --wait` daría verde con el worker roto. Igualarlo al de `api` (`:195-206`): exigir `status === 'up'` **y** `checks.mongo.status === 'up'` **y** `checks.redis.status === 'up'`, de modo que el **contenido** decida y el código de estado no haga falta para distinguir sano de degradado. Verificar por los dos lados: (a) parando `redis` y viendo que el servicio pasa a `unhealthy` y que `up --wait` no retorna en verde; (b) alimentando esa misma expresión de `node -e` con un cuerpo `200` que declare `redis` abajo y comprobando que sale ≠0. Cubre el requirement "La salud se decide por el contenido, no por el código de estado" de la delta de `platform/production-deploy`, que hasta esta iteración no tenía ninguna tarea.
- [x] 4.13 [infra] Lo mismo con `web`, cuyo healthcheck (`:283`) es un `wget -qO- http://127.0.0.1/` que no mira **qué** sirve: un nginx con el directorio vacío o sirviendo otra cosa responde `200` y pasa. Exigir el documento del SPA en el cuerpo —la raíz de la aplicación Angular es `<lv-root>` (`apps/web/src/index.html:26`)—, p. ej. `wget -qO- http://127.0.0.1/ | grep -q '<lv-root'`. Verificar vaciando `/usr/share/nginx/html` en el contenedor, viendo que pasa a `unhealthy`, y restaurando con `up -d --force-recreate web`.

- [x] 4.14 [infra] **Nadie ha podido levantar nunca el compose de producción: quinto defecto nunca verificado.** El healthcheck de MinIO ejecuta `sh /ensure-buckets.sh`, y ese script usa `grep` dos veces (`infra/minio/ensure-buckets.sh:33` y `:36`). **La imagen de MinIO no trae `grep`**: el healthcheck sale `127`, MinIO nunca queda sano, y `api` y `worker` —que dependen de `service_healthy`— no llegan a arrancar. **Decisión humana (2026-09-24): reescribir las dos comprobaciones sin `grep`**, resolviendo con `case` sobre la salida de `mc --json`. Verificar levantando MinIO y viendo el healthcheck pasar, y comprobar que **cae** cuando la condición que comprueba no se cumple, en vez de pasar por no encontrar el binario — un `127` y un "no está cifrado" son cosas distintas y hoy se ven igual.
- [x] 4.15 [infra] Anotar en el change, y en la fila 35 del plan, el rediseño que **no** se hace aquí: un healthcheck no debería aprovisionar buckets. Mezclar "¿está sano?" con "¿está configurado?" es lo que convierte un fallo de configuración en un servicio enfermo para siempre, y es la razón de que este defecto durara tanto sin que nadie lo viera. Verificar que queda escrito dónde se retoma.

> **El rediseño que este change NO hace (4.15).** El healthcheck de `minio` en `docker-compose.prod.yml:131` es
> `sh /ensure-buckets.sh`: el mismo script que **crea** los buckets, les pone el ciclo de vida y activa SSE-S3 es el
> que contesta «¿estoy sano?». Mezclar «¿está configurado?» con «¿está sano?» convierte cualquier fallo de
> configuración en un servicio **enfermo para siempre** —y, como `api` y `worker` dependen de `service_healthy`, en
> una pila que no arranca—; es exactamente lo que hizo que el `grep` ausente durase sin que nadie lo viera: no había
> ningún otro sitio donde ese error pudiera salir. Aquí solo se quita el `grep` (4.14) y se hacen distinguibles los
> tres desenlaces (binario ausente → 127 con su mensaje; condición incumplida → 1 nombrándola; correcto → 0).
> **Se retoma en la fila 35 (`staging-host`)**, escrito en `docs/design-v0.2.md` §6 y en el `scope` de `staging-host`
> de `openspec-changes.yaml`: separar las dos preguntas pide un despliegue real contra el que probar el paso de
> aprovisionamiento, que es justo lo que esa fila trae.

- [x] 4.16 [infra] **La pila dejó de poder montarse a mitad del change (ADR-048 §8).** El 2026-09-24 MinIO restringió el acceso anónimo a sus imágenes en `quay.io`: el repositorio entero pasó a devolver `401` y ninguna máquina limpia podía levantar los **dos** composes. **Decisión humana: replicar la imagen al registro propio** (opción A de cuatro), el **mismo objeto**, sin modificarlo y conservando su procedencia. Verificar que el espejo existe, que se descarga **sin credenciales** desde una máquina limpia —no desde la que lo subió, que ya la tiene en caché— y que la pila entera queda sana con él; y verificar el **precio** que la decisión acepta en vez de darlo por escrito: que lo replicado es **solo `linux/amd64`**, leyéndolo del manifiesto y no del comentario que lo afirma.
- [x] 4.17 [infra] **La referencia pasa a variable con el espejo por defecto, no a otra URL clavada** (ADR-048 §8): la lección del incidente es que una imagen de un tercero fijada a fuego es un punto de fallo que no se puede sortear sin editar el fichero, y estaba fijada en `docker-compose.prod.yml` **y** en `docker-compose.yml`. Dejar `${MINIO_IMAGE:-…}:${MINIO_IMAGE_TAG:-…}` en los dos, con el porqué y la limitación de arquitectura escritos al lado; y **registrar de verdad en la fila 35** —no solo afirmar que está registrado— las dos cosas que la decisión aplaza: sustituir MinIO por otro servidor compatible con S3 (opción C, el camino limpio) y el **mantenimiento del espejo**, que pasa a ser trabajo nuestro. Verificar leyendo la fila 35 en `docs/design-v0.2.md` y el `scope` de `staging-host` en `openspec-changes.yaml`, no releyendo el comentario del compose que dice que está anotado.

> **El espejo, comprobado en vez de afirmado (4.16 y 4.17, 2026-09-25).**
>
> * **Existe y se descarga sin credenciales.** `ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z`,
>   versión creada el `2026-09-24T21:09:54Z`. El manifiesto se obtiene con un token **anónimo** de `ghcr.io`
>   (`docker-content-digest: sha256:a1a8bd4a…`), así que no depende de que quien lo consuma tenga cuenta.
> * **La procedencia se conserva, y eso también se lee del objeto**: la configuración de la imagen
>   (`sha256:69b2ec20…`, que es su id) trae `name: MinIO`, `vendor: MinIO Inc <dev@min.io>` y
>   `release: RELEASE.2025-09-07T16-13-09Z`. Es el mismo objeto, no una reconstrucción.
> * **Solo `linux/amd64`, leído del manifiesto.** Lo que responde el registro **no es un índice** multi-arquitectura
>   sino un manifiesto único (`application/vnd.docker.distribution.manifest.v2+json`), y su configuración declara
>   `architecture: amd64`, `os: linux`. El comentario del compose dice lo mismo; la diferencia es que ahora está
>   comprobado.
> * **La pila queda sana con él, en una máquina que no es la que lo subió.** Corrida `36104024048` de `cd-staging`,
>   en el corredor de GitHub: `ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z` → `minio Pulling`
>   → `minio Pulled` → `Container linkvault-prod-minio-1  Healthy` y, en el `ps`,
>   `linkvault-prod-minio-1  ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z … Up 13 seconds
>   (healthy)`. El `build, verify and publish artifact` de esa corrida terminó en `success`.
> * **La variable está en los dos composes** (`docker-compose.prod.yml:121` y `docker-compose.yml:77`), con el mismo
>   valor por defecto y el mismo bloque de comentario.
> * **Y lo que estos dos apartados tenían mal:** los tres sitios que decían «sustituir MinIO … sigue anotado para la
>   fila 35» (`docs/adr/ADR-048.md`, y el comentario de los dos composes) lo daban por hecho sobre una fila 35 que
>   **no lo enumeraba**. Registrado ahora en `docs/design-v0.2.md` fila 35 y en el `scope` de `staging-host` de
>   `openspec-changes.yaml`, con las dos piezas: sustituir MinIO y **mantener el espejo**, que es el coste que la
>   decisión acepta y que sin dueño no lo tiene nadie. Es el mismo defecto que 13.5 §5 cazó para el SMTP.

## 5. Verificación del artefacto: la pila entera, en el corredor

- [x] 5.1 [infra] La verificación SHALL consumir **las imágenes que están en el daemon del corredor**, etiquetadas localmente por el paso de build del mismo job, y `up` SHALL ejecutarse con `--pull never` para que un fallo de carga no se tape tirando del registro; verificar con `docker image inspect` que las tres están en el daemon y comprobando que, borrando una a mano, el `up` falla en vez de descargarla.
- [x] 5.2 [infra] Escribir el env file de verificación (versionado, `infra/ci/verify.env`) con **todas** las obligatorias del inventario de 1.1: `AUTH_JWT_SECRET` de ≥32 caracteres y distinto del de `.env.example`, `PUBLIC_PAGE_BASE_URL` y `WEB_BASE_URL` sin barra final, `S3_*` incluido `S3_BUCKET`, `MAIL_*` con sus condicionales, `AUTH_VERIFY_TOKEN_TTL_HOURS`, `AUTH_RESET_TOKEN_TTL_SECONDS`, `MATCH_*`, `ENRICH_USER_AGENT`, `MINIO_KMS_SECRET_KEY`, `AI_CHAIN=none` (por 1.2: `mock` está prohibido con el `NODE_ENV=production` horneado) y `AI_VAULT_KEY` como base64 de 32 bytes; verificar con `docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env config`.
- [x] 5.3 [infra] Ese fichero va versionado y lleno de credenciales de mentira, así que alguien lo copiará: ponerle una **cabecera** que diga que solo sirve para la verificación en el corredor, que sus valores no son secretos y que **no sirve para ningún despliegue**, y nombrar en ella `.env.example` como el fichero del que se parte; verificar que la cabecera está en las primeras líneas y que nada del repositorio lo referencia como env de despliegue.
- [x] 5.4 [infra] Añadir a ese env file `PUBLIC_HOST` y `ACME_EMAIL` con valores de relleno aunque Traefik no se levante: excluir el servicio no basta, porque la interpolación de `${…:?}` ocurre al leer el fichero **entero** y sin ellas el `config` aborta antes de mirar qué servicios se piden; verificar que sin ellas falla y con ellas no.
- [x] 5.5 [infra] Faltan del inventario las **cuatro variables de imagen y tag** (`API_IMAGE`, `WORKER_IMAGE`, `WEB_IMAGE`, `IMAGE_TAG`), sin las cuales el compose resuelve al valor por defecto y no a lo recién construido, contradiciendo 5.1. Van como **variables del step** que ejecuta la verificación —`env:` del paso, calculadas a partir del tag local de 6.1—, **no** en `infra/ci/verify.env`: en el fichero versionado serían un valor fijo que envejece y que además reintroduciría el namespace del defecto de 4.6. Verificar con `config` que los tres `image:` resueltos son los tags locales del job, y que borrando esas variables del step el `config` resuelve a otra cosa y el paso falla.
- [x] 5.6 [infra] Levantar la pila con **`docker-compose.prod.yml`** —no un compose escrito para CI— seleccionando servicios para dejar fuera el borde: `up -d --wait --wait-timeout <n> --pull never mongo redis minio api worker web`; verificar que retorna en verde dentro del plazo y que Traefik no se ha levantado.
- [x] 5.7 [infra] El plazo es obligatorio, tiene que ser un **número justificado por escrito** y el fallo tiene que ser legible. Justificarlo en un comentario del YAML contra los `start_period` del compose y sus ventanas de reintento —mongo 30 s (interval 5 s × 12), minio 20 s (10 s × 12), api 60 s (10 s × 12), worker 60 s (10 s × 12), y `api`/`worker` no empiezan a contar hasta que mongo, redis y minio están sanos—, de donde sale un suelo de **≥ 240 s**; un plazo menor haría fallar corridas sanas y uno ausente deja el `up` esperando para siempre ante un bucle de reinicio, y la corrida muere por el timeout del job sin decir nada útil. Al vencer el plazo, volcar `docker compose ps` y `docker compose logs` de `api`, `worker` y `web`; verificar forzando un bucle de reinicio (imagen con el `main.js` roto) y comprobando que el paso termina con error, con los logs en la salida, y no por timeout del job.
- [x] 5.8 [infra] Comprobar que mongo queda como **replica set de un nodo**, igual que en producción (el healthcheck del compose hace el `rs.initiate`); verificar con `rs.status()` desde el contenedor y que `db.hello().isWritablePrimary` es cierto, para que una transacción multi-documento no falle solo en el despliegue real.
- [x] 5.9 [infra] Comprobar readiness de `api` **desde dentro de la pila**: la red `internal` es `internal: true` y ningún servicio de aplicación publica puertos, así que desde el corredor no se alcanza nada; se hace con `docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/health')…"`. **NO SHALL publicarse puertos para poder comprobarlo**: la spec deja Traefik y la publicación de puertos fuera del alcance, y abrirlos cambiaría la configuración que se está verificando. Exigir `status: up` con `checks.mongo` y `checks.redis` en `up`, no un `200` cualquiera ni HTML del SPA; verificar que la comprobación **falla** si se para redis y volver a arrancarlo.
- [x] 5.10 [infra] Comprobar readiness de `worker` en **su propio `GET /health`**, también con `docker compose exec -T worker` contra `127.0.0.1:${WORKER_HEALTH_PORT}` (3001 en el compose; el controlador y los indicadores existen en `apps/worker/src/presentation/http/` e `infrastructure/health/`), exigiendo los mismos indicadores de mongo y redis; verificar que cae si se para redis. Cierra Q1 del diseño en "sí".
- [x] 5.11 [infra] Comprobar que `web` **sirve el documento del SPA**, otra vez sin publicar puertos: `docker compose exec -T web wget -qO- http://127.0.0.1/` (nginx alpine trae `wget`) o `docker compose exec -T api` contra `http://web/` por la red interna; exigir el cuerpo HTML con la raíz de la aplicación (`<lv-root>`), no solo un `200`. Verificar que cae si se vacía el directorio servido por nginx y restaurar. Cierra Q2 del diseño en "sí".
- [x] 5.12 [infra] Comprobar los prompts **sobre el contenedor arrancado**: `docker compose exec api` listando la ruta que resuelve `AI_PROMPTS_DIR` (`/app/assets/ai/prompts`) y fallando si está vacía; verificar que la comprobación **no** mira `dist/` ni ningún directorio del corredor, que respondería a otra pregunta.
- [x] 5.13 [infra] Comprobar que **cae** cuando la imagen no arranca: romper a mano el artefacto de una imagen (p. ej. `main.js`), ver fallar el paso diciendo que la imagen no arranca y que **no se publica nada**, y restaurar.
- [x] 5.14 [infra] Comprobar que **cae** con un directorio de prompts vacío. La falsación **no** puede ser construir una imagen con otro `AI_PROMPTS_DIR`: el compose fija `AI_PROMPTS_DIR: /app/assets/ai/prompts` en el `environment` de `api` (`:159`) y de `worker` (`:225`), y ese valor **pisa** cualquier `ENV` horneado, así que esa prueba no probaría nada. Vaciar la ruta **dentro del contenedor ya arrancado** (`docker compose exec -T api rm -rf /app/assets/ai/prompts/…`, o montar ahí un directorio vacío) y ver que 5.12 falla nombrando la ruta vacía aunque el proceso siga en pie; restaurar con `up -d --force-recreate api`.
- [x] 5.15 [infra] Comprobar que **cae** cuando al servicio le falta una obligatoria **en su bloque del compose**, que es el defecto real del grupo 4: quitar a mano una variable del bloque `environment` de `api` (no del env file: tras 4.3 y 5.2 quitarla del fichero aborta la interpolación y el `up` ni empieza), levantar y ver que el servicio termina sin llegar a escuchar y que la verificación falla; restaurar. Es el defecto del grupo 4 descubriéndose aquí, que es donde tenía que haberse descubierto.
- [x] 5.16 [infra] Derribar la pila con `down -v` pase lo que pase (paso `if: always()`); verificar que dos corridas seguidas en el mismo corredor no se pisan los volúmenes.

> **Lo que el grupo 5 dio por cierto y no lo era (2026-09-24, implementación).**
>
> 1. **El motivo que 5.7 daba al plazo es falso con este compose, y se comprobó ejecutando.** 5.7 dice que «uno
>    ausente deja el `up` esperando para siempre ante un bucle de reinicio, y la corrida muere por el timeout del
>    job». Con la imagen de `api` rota a propósito, el mismo `up -d --wait` **sin** `--wait-timeout` terminó en
>    **7 s** con `container linkvault-prod-api-1 is unhealthy` y código ≠0 (Docker 29.8.0). Compose aborta en cuanto
>    un contenedor pasa a `unhealthy`, y **los seis servicios declaran healthcheck** con reintentos acotados, así que
>    no hay espera infinita que evitar. El plazo se mantiene por lo que sí acota —el techo de una corrida **sana**,
>    para que el paso falle con su propio mensaje y no por el timeout del job—, y lo que de verdad convierte ese
>    «is unhealthy» en algo diagnosticable es el **volcado de `ps` y `logs`**. Por eso el volcado se hace ante
>    **cualquier** fallo del `up`, no solo al vencer el plazo.
> 2. **El suelo de «≥ 240 s» queda por debajo del peor caso de sus propios números.** Encadenando las dos fases como
>    el propio enunciado describe (`api`/`worker` no empiezan hasta que mongo, redis y minio están sanos): minio
>    20 + 12×10 = **140 s**, y después api/worker 60 + 12×10 = **180 s** → **320 s**. Se usa **360 s** (margen del
>    12 %). Con 240 s una corrida sana en un corredor lento se cortaría.
> 3. **La readiness no cubre el almacén de objetos, y el grupo no lo prometía pero convenía decirlo.** El `/health`
>    de `api` y de `worker` declara **solo** `checks.mongo` y `checks.redis`; ninguno mira S3. MinIO se levanta
>    porque `api` y `worker` dependen de su `service_healthy`, y su healthcheck comprueba que los buckets existen,
>    pero que los procesos **sepan hablar** con S3 no queda cubierto aquí. Queda escrito en la cabecera de
>    `infra/ci/verify-artifact.sh` en vez de darse por cubierto; se cierra con un despliegue real (fila 35).
> 4. **La falsación de 5.11 necesita dos experimentos, no uno.** Vaciar `/usr/share/nginx/html` **no** produce el
>    caso interesante: nginx responde **403**, `wget` sale ≠0 y la comprobación cae por «no sirve nada», no por el
>    cuerpo. El caso que 4.13 y 5.11 existen para cubrir —**200 con el documento equivocado**— hay que fabricarlo
>    escribiendo otro `index.html`; hecho así, cae nombrando la falta de `<lv-root>`. Con un solo experimento, la
>    rama que comprueba el **contenido** se habría quedado sin ejercitar.
> 5. **`cd-staging` deja de publicar hasta el grupo 6, a propósito.** 5.1 exige que el build **cargue** las imágenes
>    en el daemon (`load: true`), y la spec prohíbe publicar antes de verificar; como la publicación del tag ya
>    cargado es 6.1–6.3, el job `build-push` pasa a llamarse **`build-verify`** y hoy construye y verifica sin
>    publicar nada. Es el lado seguro del orden, y está anotado en el YAML para que no se lea como un olvido.

## 6. Un solo job: construir → verificar → publicar

- [x] 6.1 [infra] Sustituir `build-push` de `cd-staging.yml` por **un único job** que construya las tres imágenes con `load: true` y **sin `push`**, ejecute la verificación del grupo 5 y publique **esas mismas** imágenes al final. La publicación SHALL ser `docker push` del tag **ya cargado y verificado**, y **NO SHALL haber una segunda construcción en el camino de publicación**: ni otro `docker/build-push-action` con `push: true`, ni `docker buildx build --push`, por barata que la haga la caché. Escribir en el YAML por qué: una imagen cargada vive **solo en el daemon de ese corredor**, así que reconstruir para publicar sube **bits que nadie verificó**, que es justo la garantía que este change viene a dar. Verificar leyendo el workflow que no hay ninguna ruta en la que se construya dos veces y que ningún paso posterior a la verificación ejecuta un build.
- [x] 6.2 [infra] Comprobar la **identidad por digest** entre lo verificado y lo publicado con el **único par comparable**: tras el `docker push` de la imagen cargada, leer el **digest del repositorio** de esa misma imagen local —`docker image inspect -f '{{index .RepoDigests 0}}' <tag>`, que el daemon rellena al publicar— y compararlo con el `Digest:` que devuelve `docker buildx imagetools inspect <tag>`, **fallando si difieren**. Dejar escrito en el YAML por qué **no** se compara `{{.Id}}`: es el digest del **config** de la imagen y el del registro es el del **manifiesto**, que por construcción contiene al config, así que esa comparación **no puede coincidir nunca**; y la variante a la que lleva verla fallar —comparar el `{{.Id}}` antes y después de publicar— es peor todavía, porque **pasa su propia prueba de falsación** ("reconstruir entre verificar y publicar cambia el id") **sin consultar el registro ni una vez**, y el pipeline volvería a afirmar identidad sin comprobarla. Falsación correcta: **publicar con una segunda construcción** (`buildx build --push` en lugar del `docker push` de la imagen cargada), ver que los dos digests difieren y que el paso falla; restaurar.
- [ ] 6.3 [infra] La publicación SHALL ocurrir solo tras la verificación en verde, y entonces publicar el tag inmutable `sha-<12>` y el móvil `:staging`; verificar con una corrida en verde que los dos tags aparecen en GHCR y que ninguno existía antes del paso de verificación.
- [x] 6.4 [infra] Dar a `cd-staging` el mismo modo de prueba sin publicar que **8.7** da a `cd-prod` (input de `workflow_dispatch`; 8.6 es el guardia de semver, no el modo de prueba), y además condicionar el tag móvil `:staging` a `github.ref == refs/heads/main`: una corrida de prueba desde esta rama movería el canal `:staging` a código de rama. Verificar con la corrida de prueba de la rama **por lo que sí es observable desde aquí**: que ningún paso de publicación se ejecutó y que en GHCR no apareció ningún tag nuevo para el `sha-<12>` de esta corrida. Que `:staging` no se mueve en una corrida **de `main`** que falla la verificación **no es comprobable en esta rama** —fuera de `main` el tag móvil no se toca en ningún caso— y queda **pendiente post-merge**, anotado en la fila 35 (13.5).
- [x] 6.5 [infra] Comprobar que un artefacto que no pasa la verificación **no queda publicado bajo ningún tag**: hacer fallar la verificación a propósito en una corrida de la rama y comprobar en GHCR que no existe ninguna imagen nueva —ni `sha-<12>`, ni `:staging`, ni ninguna otra— para esa corrida; restaurar. Formulado así porque es lo que esta rama puede demostrar: comprobar que `:staging` "sigue apuntando a la imagen anterior" no prueba nada cuando el tag móvil no se mueve fuera de `main`.
- [x] 6.6 [infra] Mantener `cache-from`/`cache-to` de buildx con `load: true` para que la imagen no se reconstruya entre corridas; verificar comparando los tiempos de dos corridas consecutivas y leyendo en el log que las capas salen de caché. La caché abarata **la** construcción, no autoriza una segunda (6.1).

> **Lo que el grupo 6 dio por cierto y no lo era (2026-09-24, implementación).** La publicación vive en
> `infra/ci/publish-artifact.sh`, misma forma que la verificación del grupo 5 (script, no inline, para poder correr
> en local lo mismo que CI). Todo lo de abajo se ejecutó contra un **registro local** (`registry:2`) y, para la
> forma exacta de CI, dentro de un **dind con daemon clásico** (Docker 28.5.2, overlay2) — ver el punto 6.
>
> 1. **La falsación de 6.2 *pasó* a la primera, y el guardia que faltaba salió de ahí.** Publicando con una segunda
>    construcción (`docker buildx build --push` sobre el mismo tag, driver `docker`), el paso terminó en **0** y
>    dijo `identidad confirmada`: el daemon **reetiqueta** la imagen recién construida, así que el digest de
>    repositorio que se lee *después* del paso de publicación **ya es el del artefacto reconstruido** y coincide con
>    el del registro — la comprobación aprobaba la reconstrucción comparándola **consigo misma**. Se añadió tomar la
>    identidad de la imagen **antes** de publicar y exigir que el tag local siga señalando al mismo objeto después.
>    Ese guardia **no es** la comparación prohibida de 6.2 ascendida a buena: por sí solo no consulta el registro y
>    no vale nada; el cotejo contra el registro, por sí solo, es ciego a la reetiquetación. Hacen falta los dos, y
>    con los dos la falsación cae:
>    `[FAIL] el paso de publicación sustituyó la imagen local … (sha256:3c42c57c… -> sha256:c0f9a04b…)`.
> 2. **La falsación tiene dos desenlaces, no uno, y 6.2 solo describe el segundo.** Con el driver
>    `docker-container` —el que crea `setup-buildx-action` en CI— la reconstrucción **no toca** el daemon local, así
>    que el guardia del punto 1 pasa y quien cae es el cotejo contra el registro. Ejecutados los dos:
>    con el almacén containerd, `[FAIL] lo publicado … NO es lo que se verificó: local sha256:4e8a263b… != registro
>    sha256:a008738b…`; en el **daemon clásico**, donde una imagen sólo cargada **no tiene** digest de repositorio,
>    `[FAIL] la imagen local … no tiene digest de repositorio … (¿se reconstruyó para publicar?)`. Es decir: en la
>    forma real de CI la falsación **no** produce "dos digests que difieren" sino "no hay con qué comparar", y el
>    mensaje tiene que decir eso o nadie entenderá el fallo.
> 3. **`{{.Id}}` no siempre es el digest del config, y ahí había una trampa peor que la descrita.** En el daemon
>    clásico se confirmó lo que dice 6.2 (`ID=sha256:1f612859…` frente a `Digest: sha256:cbbf947b…` en el registro
>    para la misma imagen recién publicada). Pero con el **almacén containerd** de Docker Desktop `.Id` es el digest
>    del **índice** y **coincide** con el del registro. Una comparación por `.Id` habría pasado en la máquina de
>    desarrollo y fallado en CI: la peor combinación posible, y una razón más para no usarla.
> 4. **`{{index .RepoDigests 0}}` es elegir a ciegas.** `RepoDigests` trae una entrada por repositorio conocido sin
>    orden garantizado; con la imagen etiquetada además localmente se midieron **dos** entradas. Se selecciona por
>    prefijo de repositorio y, si no hay ninguna para ese repositorio, se falla diciéndolo (que es el desenlace del
>    punto 2 en el daemon clásico).
> 5. **La comprobación detecta, pero no des-publica.** En la falsación los bits reconstruidos **quedaron en el
>    registro** y el paso falló después. Lo que impide eso no es la comprobación sino la **forma** del camino
>    (`docker push` de la imagen cargada); la comprobación existe para que nadie cambie esa forma sin que el
>    pipeline se entere. Queda escrito en la cabecera del script en vez de darse por cubierto.
> 6. **GHCR no se pudo ejercitar desde aquí, así que 6.3, 6.4, 6.5 y 6.6 quedaban sin marcar** (revisado después
>    contra las corridas reales en el bloque siguiente: 6.4, 6.5 y 6.6 quedan verificadas y 6.3 sigue abierta). El token local no
>    tiene `write:packages` (`gh auth status`: `'gist', 'read:org', 'repo', 'workflow'`) y la rama no está publicada,
>    de modo que no hay corrida real en la que mirar GHCR. Lo que **sí** se ejecutó: la mecánica completa contra
>    `registry:2` (tag inmutable y móvil, con identidad confirmada en los dos), la falsación en sus dos desenlaces,
>    el encadenado `verify && publish` con la verificación fallando —el paso de publicación **no llega a
>    ejecutarse** y el registro no tiene ese tag: `ERROR: …:sha-e0000000000e: not found`—, y para 6.6 que
>    `--cache-from` y `--load` conviven en la misma invocación (builder nuevo, capa cara `RUN sleep 6` resuelta como
>    `CACHED`, 2 s en vez de ≥6 s, imagen igualmente cargada con el mismo id). Lo que queda pendiente de una corrida
>    real es lo que solo se ve en GHCR y en la caché `type=gha`.

> **Lo que las corridas reales demuestran del grupo 6, y lo que no (2026-09-24, revisión contra los logs).** Seis
> corridas sobre esta rama: `35980420363`, `35982223240`, `36045259965`, `36048413770` y `36064994390` (`cd-staging`)
> y `36068228388` (`cd-prod`). Revisadas leyendo los logs (`gh run view <id> --log` redirigido a fichero) y el estado
> real de GHCR (`users/manuXD270516/packages/container/linkvault-{api,worker,web}/versions`), no la conclusión de la
> corrida.
>
> * **6.4 — verificada.** `35982223240` corre con `"dry_run": "true"`: el log del job pasa de
>   `infra/ci/verify-artifact.sh` a `infra/ci/teardown-artifact.sh` sin que exista el paso de publicación, y la
>   corrida queda verde. En GHCR **no hay ninguna versión** para el `sha-cf412ecd1df7` de esa corrida: los tres
>   paquetes tienen **una sola** versión cada uno, con el único tag `sha-b541a9a314b4`.
> * **6.5 — verificada, y por corridas reales en modo de publicación.** `36045259965` y `36048413770` corrieron con
>   `"dry_run": "false"` —el camino de publicación estaba habilitado— y fallaron **dentro** de la verificación
>   (`unauthorized: access to the requested resource is not authorized` bajando MinIO de quay.io;
>   `[FAIL] no se pudieron descargar las imágenes de terceros (mongo redis minio) tras 3 intentos`), y `35980420363`
>   falló con `[FAIL] la pila no quedó sana en 360s`. En las tres el paso de publicación **no llegó a ejecutarse** y
>   GHCR no tiene ninguna versión para `sha-cf412ecd1df7`, `sha-0401241baf3e` ni `sha-b12520c41c03`. El fallo fue
>   **real y no inducido**, así que no hubo nada que restaurar; la observación que la tarea pedía es la misma.
> * **6.6 — verificada con dos corridas consecutivas comparables.** `35980420363` (09:18) y `35982223240` (09:36):
>   el build de `api` pasa de **174 s con cero capas `CACHED`** a **13 s con 14 capas `CACHED`** tras
>   `#7 importing cache manifest from gha:…`; `worker` 65 s → 10 s y `web` 39 s → 3 s. Y las imágenes siguen
>   quedando cargadas en el daemon, porque la verificación de esa misma corrida las consume con `--pull never`.
> * **6.3 sigue abierta, y esto es exactamente lo que le falta.** `36064994390` publicó el tag inmutable en los tres
>   paquetes (`sha-b541a9a314b4`, con `identidad confirmada: lo publicado es el artefacto verificado` y los digests
>   del registro coincidiendo uno a uno con los de GHCR), pero el tag móvil **no se publicó**: el log dice
>   `tag móvil    : (ninguno: esta corrida no mueve ningún canal)` porque `MOVING_TAG` llega vacío fuera de `main`.
>   6.3 enuncia **dos** tags y la evidencia cubre **uno**; se cierra con la primera corrida de `main`.

## 7. Tres resultados honestos y visibles en `cd-staging`

- [x] 7.1 [infra] Job `preflight` que mapee `STAGING_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY` y `STAGING_COMPOSE_DIR` a `env:` **dentro de un step** y emita un output con el estado (`none` | `partial` | `full`) y el aviso: el contexto `secrets` **no se puede leer en un `if:` de job**, así que no hay atajo; verificar con una corrida real que el output sale y vale `none`.
- [x] 7.2 [infra] `partial` **falla en el preflight** nombrando los que faltan, porque ahí alguien sí quería desplegar; verificar configurando un secret de prueba y dejando el resto ausente, ver el fallo, y retirarlo después.
- [x] 7.3 [infra] Job `deploy` con `needs` sobre `preflight` **y sobre el job de construir-verificar-publicar**, e `if:` sobre el estado igual a `full`, **sin `always()`**: sin el segundo `needs`, el tag de imagen llegaría vacío, el compose caería a `:latest` —que `cd-staging` ni siquiera publica— y el despliegue informaría éxito sobre la imagen equivocada; verificar en la corrida real (hoy sin secretos) que el job queda **saltado** y que un job saltado deja el workflow en **éxito**.
- [x] 7.4 [infra] Añadir en el despliegue un guardia que **falle** si el tag resuelto no es el de esta corrida: vacío, `latest` o distinto del output del job de publicación; verificar forzando el caso (vaciando el output) y viendo que el paso falla antes de tocar el host, en vez de desplegar otra cosa.
- [x] 7.5 [infra] Escribir un job de **reporte** que corra **siempre** (`if: always()`), con el nombre calculado a partir del estado del preflight y del resultado de la verificación, porque lo que se ve en la lista de *checks* de un commit es el **nombre del job**, no el de la ejecución (`run-name` se evalúa al iniciar y no puede depender de outputs de jobs, así que no sirve de vehículo); verificar mirando la lista de checks del commit en la rama y leyendo ahí que no se desplegó.
- [x] 7.6 [infra] Publicar además un **estado de commit explícito** desde ese job (permiso `statuses: write`) y fijar **el estado, no solo la descripción**: `success` únicamente cuando el artefacto se construyó **y** arrancó; `failure` cuando no se construyó o no arrancó. Como el job corre con `if: always()`, un reporte que publique siempre `success` pondría un **tic verde junto al check rojo** y reconstruiría exactamente la señal que este change viene a arreglar. El estado SHALL derivarse del `result` del job de construir-verificar-publicar y del output del preflight, nunca de un literal. Verificar en el propio commit de la rama —API de estados o vista del commit— dos cosas: en verde, que el estado dice que se verificó y no se desplegó; y **con la corrida rota de 7.8**, que el estado publicado es de **fallo** y su descripción lo dice.
- [x] 7.7 [infra] Repasar que ningún job ni step siga diciendo "deploy" o "desplegado" en su nombre o en su resumen cuando solo verificó; verificar leyendo los nombres tal y como se ven en la lista de checks, no en el YAML.
- [x] 7.8 [infra] Comprobar que un artefacto roto **rompe** el pipeline aunque no haya destino, y que el fallo no queda tapado por la rama de "no hay dónde desplegar"; verificar rompiendo el build a propósito en una corrida de la rama y restaurando. Esta misma corrida es la que 7.6 usa para comprobar el estado de fallo.
- [x] 7.9 [infra] Aplicar el plazo explícito y el volcado de logs de 5.7 a los `up -d --wait` de los **dos** despliegues por ssh (`cd-staging.yml` y `cd-prod.yml`), que hoy se colgarían igual; verificar reproduciendo en local un contenedor en bucle de reinicio con exactamente esa línea de comandos y viendo que termina con error y con los logs, en vez de esperar sin fin.
- [x] 7.10 [infra] **La clase del fallo tiene que viajar del job que cae al job que lo describe.** El reporte publicaba «El artefacto no se construyó o no arrancó» para dos fallos de naturaleza distinta, y en las corridas `36045259965` y `36048413770` esa frase era **falsa**: las dos cayeron descargando imágenes de terceros, con el artefacto sin llegar a levantarse, y la desmentía la propia ejecución que la publicaba. `infra/ci/verify-artifact.sh` SHALL clasificar cada fallo (`artifact` por defecto; `environment` solo en el `pull` de terceros) y dejarlo escrito en `VERIFY_FAIL_CLASS_FILE`; el job de build SHALL subirlo como **artefacto de corrida** con `if: always()` y el job de reporte SHALL recogerlo y derivar de él la descripción. Un `output` de job **no sirve** aquí: lo que hay que comunicar es justo lo que pasa cuando el job falla, y que los outputs de un job fallido lleguen a `needs` no está demostrado. Con la clase **vacía** no se afirma ninguna causa —vacío no es `artifact`, y tratar "no lo sé" como "lo de siempre" es el defecto que esto cierra—, y el `state` sigue siendo `failure` y el script sigue saliendo ≠0 en los tres casos: un fallo de entorno no es verde. Verificar **en Actions**, no solo en local, que el fichero sobrevive a un job condenado, que el job de reporte lo recibe y que lo que llega al estado de commit es la descripción **de la clase** y no la genérica.

> **Lo que el grupo 7 dio por cierto y no lo era (2026-09-24, implementación).**
>
> 1. **`cancelled` y `skipped` no son "artefacto roto", y la primera versión del reporte los describía así.** La
>    tabla de ADR-048 §3 tiene tres resultados y el `result` de un job tiene cuatro valores. Decir «no se construyó
>    o no arrancó» cuando alguien canceló la corrida es inventarse el motivo —el mismo pecado, en pequeño—, así que
>    el estado sigue siendo de fallo (nadie ha comprobado nada) pero la descripción **nombra el resultado real**:
>    `La verificación del artefacto terminó en 'cancelled': no se publicó nada y no se desplegó nada.`
> 2. **El tic verde junto al check rojo tiene una tercera superficie que 7.6 no nombra: la conclusión del propio job
>    de reporte.** 7.6 exige que el **estado de commit** lleve el estado y no solo la descripción. Pero un job con
>    `if: always()` que publique un estado de `failure` y luego **termine en éxito** deja en la lista de checks un
>    check verde («resultado: el artefacto NO pasó la verificación» ✅) al lado del rojo. Por eso
>    `infra/ci/report-cd-outcome.sh` **sale ≠0** cuando lo que deriva es un fallo: el nombre, el estado de commit y
>    la conclusión del job dicen lo mismo o no dicen nada.
> 3. **Un estado de commit que no se publica es peor que ninguno**, porque el job sigue verde y nadie se entera de
>    que la señal dejó de existir. El script **falla** si no tiene token en vez de saltarse la publicación; el modo
>    local (`CD_REPORT_LOCAL=1`, para ejercitar la tabla) es explícito y no existe en CI.
> 4. **El nombre del job hay que escribirlo dos veces, y eso no se puede evitar.** `jobs.<id>.name` no puede salir
>    de un step del propio job, así que la expresión del YAML y el script derivan las mismas cinco cadenas. Se
>    comprobó que **coinciden** evaluando la expresión del YAML (es JavaScript válido: `&&`/`||` con la misma
>    precedencia y la misma semántica de verdad) contra la salida del script para los seis casos de la tabla, y el
>    script **imprime** el nombre que deriva para que una divergencia futura se vea en la propia corrida.
> 5. **Trampa de YAML en esa expresión.** En un escalar plegado (`>-`), las líneas **más indentadas** que la primera
>    conservan su salto de línea. La expresión partida «bonita», con sangría por nivel, habría llegado a GitHub con
>    saltos dentro del `${{ … }}`. Todas las líneas van al mismo nivel; se comprobó parseando el fichero y viendo
>    que el nombre resultante es **una sola línea**.
> 6. **`needs` con guiones va entre corchetes.** `needs['build-verify-publish'].result`: la sintaxis con punto sobre
>    un nombre con guiones no es la documentada, y si fallara lo haría **en silencio** devolviendo vacío — que es
>    justo el caso que el guardia de 7.4 existe para cazar (tag vacío → `:latest`). Se cambió también la referencia
>    que el grupo 6 dejó en el paso de ssh.
> 7. **La premisa de 7.9 es falsa con este Compose, igual que lo fue la de 5.7, y por el mismo motivo.** 7.9 dice
>    que los dos `up -d --wait` por ssh «hoy se colgarían». Medido con Docker 29.8.0 / Compose 5.5.1 y un contenedor
>    en **bucle de reinicio**: el `up` **sin** plazo termina en **4 s** con `container loop-api-1 is unhealthy` y
>    código ≠0. Lo que el plazo **sí** acota —y esto necesitó un **segundo** experimento— es una readiness que no
>    converge **dentro de su `start_period`**, donde Compose no declara nada y espera: con `--wait-timeout 20`
>    terminó en 21 s con `application not healthy after 20s`. Con un solo experimento, la rama del plazo se habría
>    quedado sin ejercitar y el número habría entrado en los dos workflows sin que nada lo probara. En los dos casos
>    lo que hace el fallo **diagnosticable** es el volcado de `ps` y `logs` —`Up Less than a second (health:
>    starting)` y el mensaje del proceso repetido una vez por reinicio—, y por eso el volcado se hace ante
>    **cualquier** fallo del `up`.
> 8. **`deploy-staging` no tenía `Checkout`.** No le hacía falta mientras todos sus pasos fueran `ssh-action`; el
>    guardia de 7.4 es un script del repositorio, así que ahora sí.
>
> **Lo que quedaba sin verificar y por qué** (escrito antes de que la rama se publicara; **revisado contra las
> corridas reales en el bloque siguiente**, que deja verificadas 7.1, 7.3, 7.5 y 7.7 y abiertas 7.2, 7.6 y 7.8; 7.6
> y 7.8 se cierran en el **tercer** bloque, con la corrida rota a propósito, y 7.2 sigue abierta).
> 7.1, 7.2, 7.3, 7.5, 7.6, 7.7 y 7.8 exigen una **corrida real de GitHub
> Actions** (que el output del preflight salga y valga `none`; que un job saltado deje el workflow en éxito; que el
> nombre y el estado de commit se vean en la lista de checks; que una corrida con el build roto termine en rojo).
> La rama no está publicada y el repositorio no tiene secretos, así que nada de eso se puede observar desde aquí.
> Lo que **sí** se ejecutó es la lógica entera fuera de Actions: los cuatro estados del preflight (incluido
> `partial` saliendo ≠0 y nombrando los que faltan), los seis desenlaces de la tabla de resultados con su estado y
> su descripción —entre ellos la falsación del grupo: **artefacto roto y sin destino → estado `failure`**—, los
> cuatro caminos del guardia del tag y los dos experimentos del `up`.

> **Lo que las corridas reales demuestran del grupo 7, y lo que no (2026-09-24, revisión contra los logs).**
>
> * **7.1 — verificada.** En las seis corridas el step `Resolve staging deploy target` mapea los cuatro secretos a
>   `env:` **dentro del step** (`DEPLOY_HOST:`, `DEPLOY_SSH_USER:`, `DEPLOY_SSH_KEY:`, `DEPLOY_COMPOSE_DIR:`, los
>   cuatro vacíos), el script imprime `estado: none` con los cuatro nombres marcados `ausente`, y el job registra
>   `Set output 'state'` y `Set output 'summary'`.
> * **7.3 — verificada por los dos lados.** `deploy-staging` lleva `needs: [preflight, build-verify-publish]`,
>   `if: needs.preflight.outputs.state == 'full'` y ningún `always()`; en `35982223240` y `36064994390` el job sale
>   **`skipped`** y la corrida entera queda en **`success`**.
> * **7.5 — verificada.** El nombre se **calcula**: `resultado: artefacto verificado — NO desplegado (sin destino de
>   staging)` en las verdes y `resultado: el artefacto NO pasó la verificación` en las rojas. Y se lee donde la tarea
>   exige: `commits/b541a9a…/check-runs` devuelve 10 checks, entre ellos ese nombre para `cd-staging` y su gemelo de
>   `cd-prod`.
> * **7.7 — verificada leyendo la lista de checks, no el YAML.** De los diez nombres de `b541a9a…`, ninguno afirma
>   haber desplegado; los dos que llevan "deploy" (`deploy staging` / `deploy prod (solo si hay destino configurado)`)
>   salen **`skipped`**, y los dos de reporte dicen `NO desplegado`.
> * **7.2 sigue abierta.** Ninguna de las seis corridas tuvo un solo secreto de destino puesto: el estado `partial`
>   —el que falla nombrando los que faltan— no se ha ejercitado **nunca** dentro de Actions.
> * **7.6 quedó abierta aquí, y no por falta de corrida** (se cierra en el bloque siguiente). Los dos estados
>   existen sobre commits de esta rama
>   (`success` en `b541a9a…` con «Artefacto verificado. NO desplegado…»; `failure` en `b12520c…`, `0401241…` y
>   `cf412ec…`). Lo que falla es la **descripción** del lado de fallo, que la propia corrida desmiente: en
>   `36048413770` el log dice `[FAIL] … Esto NO es un fallo del artefacto de LinkVault: es el registro del que se
>   descargan`, y el estado publicado en ese mismo commit dice `El artefacto no se construyó o no arrancó`. 7.6 pide
>   que el estado sea de fallo **y** que su descripción lo diga; dice de más, y afirmar una causa que el log niega es
>   la forma de error que este change persigue. Queda abierta con el defecto nombrado aquí, no dada por buena.
> * **7.8 quedó abierta aquí** (se cierra en el bloque siguiente). No se había roto ningún artefacto a propósito. Las
>   tres corridas rojas sí demuestran que un fallo de la verificación pone la corrida en rojo **sin destino
>   configurado** (deploy saltado, reporte ≠0), pero no el caso que 7.8 enuncia: en las tres el artefacto **se
>   construyó y se cargó**, y lo que falló fue la descarga de las imágenes de terceros.

> **La corrida rota a propósito, y lo que cierra (2026-09-25, corrida `36074771079` de `cd-staging`).**
>
> Rotura deliberada en el commit `831c37d3a0e9` —una capa `RUN … && exit 1` en la etapa `runner` de
> `docker/api.Dockerfile`—, lanzada por `workflow_dispatch` sobre esta rama con `dry_run=true` para que una corrida
> rota no tuviera como precio publicar nada, y **revertida** en `14fddc3`: `git diff 8f94e66 HEAD` sale vacío, el
> árbol es el de antes de la rotura.
> Enlace: <https://github.com/manuXD270516/linkvault/actions/runs/36074771079>
>
> * **7.8 — verificada, cláusula por cláusula.**
>   * *El artefacto se rompe de verdad, y en el sitio previsto* (clase `artifact`, no de entorno): el paso
>     `Build api (load, no push)` sale `failure` con
>     `##[error]buildx failed with: ERROR: failed to build: failed to solve: process "/bin/sh -c echo 'ROTURA`
>     `TEMPORAL 7.8: el build de api falla a proposito' >&2 && exit 1" did not complete successfully: exit code: 1`.
>   * *No hay destino y aun así el pipeline es rojo.* El preflight termina en verde diciendo que no hay dónde
>     desplegar (`preflight                  : success (estado: none)`), `deploy staging (solo si hay destino
>     configurado)` queda **`skipped`** —así lo devuelven `/actions/runs/36074771079/jobs` y
>     `commits/831c37d3…/check-runs`— y la corrida entera concluye en **`failure`**. Es la falsación de 7.3 por el
>     otro lado: allí un job saltado dejaba el workflow en verde; aquí el rojo lo pone el fallo real, y la rama de
>     "no hay dónde desplegar" **no lo tapa**.
>   * *El fallo no queda tapado por ningún verde.* El job de reporte —el único con `if: always()`— sale
>     **`failure`**: `[FAIL] El artefacto no se construyó o no arrancó: no se publicó nada y no se desplegó nada.`
>     y `##[error]Process completed with exit code 1.`; y su **nombre** en la lista de checks del commit es
>     `resultado: el artefacto NO pasó la verificación`. Los seis check-runs del commit son
>     `failure build, verify and publish artifact`, `failure resultado: el artefacto NO pasó la verificación`,
>     `skipped deploy staging (…)` y tres verdes que solo hablan de `verify`/`preflight`: ninguno afirma que el
>     artefacto esté bien.
>   * *Nada se publicó.* `Publish verified artifact to GHCR (docker push of the loaded image)` sale `skipped` y en
>     GHCR los tres paquetes siguen con **una sola** versión cada uno (`sha-b541a9a314b4`): no existe
>     `sha-831c37d3a0e9`.
> * **7.6 — verificada por los dos lados, leyendo la API de estados y no la conclusión de la corrida.**
>   * Verde: `commits/b541a9a3…/statuses` →
>     `cd-staging/artifact  success  Artefacto verificado. NO desplegado: no hay destino de staging configurado (ADR-048 §3).`
>     (con su gemelo `cd-prod/artifact`).
>   * Fallo: `commits/831c37d3…/statuses` →
>     `cd-staging/artifact  failure  El artefacto no se construyó o no arrancó: no se publicó nada y no se desplegó nada.`
>     Lo que 7.6 exige es justo eso: el **`state`** es `failure` —no solo el texto—, y la descripción dice la causa.
>     El `context` es el mismo en los dos, así que el estado sustituye al anterior en vez de acumularse.
> * **7.10 — verificada. El transporte de la clase del fallo funciona en GitHub, y esta fue su primera corrida.** El mecanismo de
>   `9a8dbbf` solo se había ejercitado en local, así que esta corrida era también su prueba. Funcionó: el job de
>   build sube el fichero **con el job ya condenado** (`Upload artifact failure class` en verde dentro de un job en
>   rojo → `Artifact verify-fail-class has been successfully uploaded! Final size is 159 bytes. Artifact ID is`
>   `10839712524`), el job de reporte lo recoge
>   (`- verify-fail-class (ID: 10839712524, Size: 159, Expected Digest: sha256:4dad22f5…)`,
>   `Artifact download completed successfully.`) y lo lee: `clase del fallo: artifact`, que el script repite en
>   `verificación del artefacto : failure (clase del fallo: artifact)`. Y lo que llega al estado de commit es **la
>   descripción de la clase `artifact`**, no la genérica de clase ausente (`La verificación del artefacto no pasó:
>   no se publicó nada y no se desplegó nada.`): la clase **viajó**, que es exactamente lo que no estaba demostrado.
>   Lo que esta corrida **no** demuestra es la rama `environment` del `case` por esta vía —las dos corridas que la
>   motivaron son anteriores al mecanismo—: lo falsado es el transporte y la clase `artifact`.
> * **7.2 seguía abierta en ese momento**: esta corrida tampoco tuvo ningún secreto de destino puesto. Se cierra en el bloque siguiente.

> **El destino a medias, ejercitado por primera vez (2026-09-25, corrida `36104024048` de `cd-staging`).**
>
> Hasta esta corrida el estado `partial` no es que estuviera sin probar: era **inalcanzable**. `gh secret list`
> devolvía la lista **vacía**, así que el preflight solo podía salir `none`. Se creó un único secreto de repositorio
> —`STAGING_HOST`, con un valor de pega bajo el TLD reservado `.invalid`, que no resuelve en ninguna red— dejando
> los otros tres ausentes, y se retiró al terminar.
> Enlace: <https://github.com/manuXD270516/linkvault/actions/runs/36104024048>
>
> * **7.2 — verificada.** El preflight **falla** y **nombra los que faltan**, que es lo que la tarea exige (fallar a
>   secas no bastaría: un mensaje que dijera solo «faltan secretos» la cumpliría en la forma y no en el fondo):
>
>   ```
>   estado: partial
>   destino de staging a medias: faltan STAGING_SSH_USER STAGING_SSH_KEY STAGING_COMPOSE_DIR
>   ##[error]Destino de staging configurado a medias; faltan: STAGING_SSH_USER STAGING_SSH_KEY STAGING_COMPOSE_DIR
>   Están: STAGING_HOST. Documentados en infra/README.md.
>   ```
>
>   Además dice **cuál está** y cómo volver al estado "sin destino", de modo que quien se lo encuentre pueda salir
>   por cualquiera de los dos lados.
> * **El valor del secreto no se filtra al log, y esto no estaba en el enunciado.** Se comprobó sobre la corrida
>   **entera**, no sobre el job: `0` coincidencias del valor en las 3.639 líneas. El script imprime
>   `STAGING_HOST             presente` —nombres, nunca valores— y Actions enmascara el mapeo como
>   `DEPLOY_HOST: ***`. Importan las dos capas, pero la del script es la nuestra: aquí el valor era de pega y daría
>   igual, y el día que sea el host real ya no.
> * **De paso quedó ejercitada la quinta fila de la tabla de ADR-048 §3**, la del preflight indeterminado, que
>   tampoco se había ejecutado nunca. El artefacto se construyó y verificó **con éxito** (`build, verify and publish
>   artifact` → `success`) y aun así la corrida es **roja**:
>
>   ```
>   resultado: destino de staging indeterminado — no se desplegó   → failure
>   deploy staging (solo si hay destino configurado)               → skipped
>   cd-staging/artifact  failure  El preflight terminó en 'failure' con estado 'partial': no se despliega.
>   ```
>
>   Es justo lo que el comentario del script advertía que no debía pasar: lo cómodo habría sido tratar el destino a
>   medias como "no hay destino" y terminar en verde. Un destino a medias es un **fallo**, no una ausencia.
> * **El secreto se retiró** al cerrar la comprobación. Dejarlo puesto habría hecho que la primera fusión a `main`
>   saliera roja por un destino a medias que pusimos nosotros — el mismo rojo permanente que este change vino a
>   quitar, y por una causa más tonta.

## 8. `cd-prod`: el que nunca se ha ejecutado

- [ ] 8.1 [infra] Aplicar a `.github/workflows/cd-prod.yml` la misma estructura: un job que construya (load, sin push), verifique con `docker-compose.prod.yml` y publique esas mismas imágenes, más `preflight` y `deploy` con las mismas condiciones y guardias de los grupos 6 y 7. **La verificación pedida —una corrida `workflow_dispatch` en modo prueba— ya se hizo y salió en verde (`36068228388`), y aun así esta tarea sigue abierta, a propósito**: el modo de prueba salta por su `if:` justamente el cuarto trozo que la tarea enuncia, **publicar esas mismas imágenes**, así que el camino de publicación de `cd-prod` (tag semver salido del guardia + `MOVING_TAG=latest`, que es el tag que producción se lleva en el siguiente `pull`) **no se ha ejecutado nunca** y es la pieza de más riesgo del workflow. Cerrarla exige una corrida de `cd-prod` **sin** modo prueba, sobre un tag `v*` real, con las tres imágenes publicadas y `latest` movido; una corrida verde en modo prueba NO SHALL contar como cierre. Esta cláusula estaba solo en la nota del grupo 8 y se sube aquí para que el motivo no dependa de leerla.
- [x] 8.2 [infra] Comprobar antes de nada qué hace `environment: production` en este repositorio: si abre un **registro de despliegue** (mostraría producción como desplegada aunque no lo esté) o si exige revisores (el job quedaría **colgado** esperando aprobación); verificar leyendo la configuración del entorno y una corrida de prueba, y dejar escrito el resultado.
- [x] 8.3 [infra] Si 8.2 confirma cualquiera de las dos cosas, el `preflight` SHALL usar un **entorno espejo solo para leer secretos** (sin reglas de protección ni URL), y `environment: production` SHALL quedar únicamente en el job de despliegue: los secretos de prod son de *environment*, así que un preflight sin entorno los leería vacíos y reportaría "sin destino → verde" para siempre; verificar que el preflight reporta `none` honestamente y que no aparece ningún despliegue registrado en el entorno real.
- [x] 8.4 [infra] El `verify` de un release SHALL correr sobre **todo el workspace** (`run-many --all`) y no sobre `affected`: con `nx-set-shas` en un tag que apunta a un commit de `main`, base y cabeza coinciden y el conjunto afectado sale **vacío**, así que hoy el verify daría verde **sin ejecutar nada** justo antes de desplegar a producción; verificar comparando la lista de proyectos del log con `pnpm nx show projects`.
- [x] 8.5 [infra] Añadir un guardia que **falle** si el conjunto de proyectos verificados sale vacío, **solo en el modo release** (`run-many --all`, 8.4) y **no** en el `verify` por afectación de `ci.yml` y `cd-staging.yml`: ahí un conjunto vacío es legítimo —un merge que solo toca documentación no afecta a ningún proyecto— y un guardia incondicional pondría en rojo esos merges, inventando un fallo donde no lo hay. Verificar los dos lados: forzando el conjunto vacío en el modo release y viendo el fallo, y con un commit de solo documentación en la rama viendo que `ci.yml` sigue en verde (y que el paso incondicional de 3.2 sí corre). Restaurar.
- [x] 8.6 [infra] Endurecer el guardia de semver: hoy es un glob de `case` (`v[0-9]*.[0-9]*.[0-9]*`) que acepta `v1.2.3abc`; sustituirlo por una comparación anclada que **no admita ceros a la izquierda** (`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`); verificar con una tabla de casos: `v1.2.3` y `v0.1.0` pasan, y `v1.2.3abc`, `v1.2`, `v01.2.3` y `1.2.3` se rechazan nombrando el tag.
- [x] 8.7 [infra] La corrida de prueba **no puede mover tags flotantes ni correr código viejo**: añadir un input de `workflow_dispatch` que construya y verifique **sin publicar** (`:latest` es el valor por defecto de `IMAGE_TAG` en el compose, así que publicarlo en una prueba es lo que producción se llevaría en el siguiente `pull`) y **un input de referencia** para ese modo, porque hoy el checkout usa `inputs.tag` y una prueba desde esta rama haría checkout del tag y correría el código anterior; verificar con la corrida de prueba sobre la rama, comprobando en el log que el commit construido es el de la rama y en GHCR que no apareció ningún `:latest` nuevo. Es el modo de prueba al que 6.4 se refiere.

> **Lo que el grupo 8 dio por cierto y no lo era (2026-09-24, implementación).**
>
> 1. **La premisa de 8.2 es falsa hoy, y de la forma que más importa: `environment: production` no existe.** 8.2 y
>    ADR-048 §3 dan por hecho que «los secretos de producción son de *environment*». Medido con la API de GitHub
>    sobre `manuXD270516/linkvault` (2026-09-24): `repos/{owner}/{repo}/environments` → `{"total_count":0,
>    "environments":[]}`, `actions/secrets` → `{"total_count":0,"secrets":[]}`, `deployments` → `[]` y
>    `actions/workflows/cd-prod.yml/runs` → `{"total_count":0}`. **No hay ningún entorno, ningún secreto y ningún
>    despliegue registrado**, así que hoy no hay revisores que puedan colgar el job y el `environment: production`
>    del workflow anterior apuntaba a un entorno que se habría creado solo en la primera corrida. Es decir: lo que
>    el ADR describe como un hecho es un **plan**, y el preflight tenía que funcionar en las dos configuraciones
>    posibles (secretos de repositorio o de entorno), no solo en la que el ADR supone.
> 2. **Por eso el espejo se usa igual, y no "solo si 8.2 confirma".** 8.3 lo condiciona a 8.2. Pero de los dos
>    efectos que 8.2 manda medir, uno —el **registro de despliegue**— solo se puede observar ejecutando, y observarlo
>    significa haberlo producido ya en producción. Esperar a verlo una vez para entonces corregirlo es exactamente la
>    forma de error que este change persigue. El preflight declara `production-preflight` (espejo sin reglas de
>    protección, sin revisores y sin URL) y `environment: production` queda **solo** en el job de despliegue. El
>    espejo funciona en las dos configuraciones: si los `PROD_*` son secretos de repositorio, un entorno sin secretos
>    propios los hereda; si son del entorno `production`, hay que **copiarlos** también al espejo, y eso queda escrito
>    en `infra/README.md` porque de lo contrario el preflight diría "sin destino" para siempre — la mentira original.
> 3. **`run-many --all` no garantiza que se ejecute nada, así que 8.4 sin 8.5 no cerraría el agujero.** Medido
>    (Nx 23.2.1): `pnpm nx run-many --all -t no-such-target` → `NX No tasks were run` y **código 0**. Y la premisa de
>    8.4 se confirmó por el otro lado: `pnpm nx show projects --affected --base=HEAD --head=HEAD --json` → `[]`, y
>    `NX_BASE=HEAD NX_HEAD=HEAD pnpm nx affected -t lint` → `No tasks were run`, código **0**. Las dos mitades hacen
>    falta: `--all` (8.4) y el guardia del conjunto vacío (8.5, `infra/ci/assert-release-projects.sh`).
> 4. **El guardia del conjunto vacío tiene que ser por target, no sobre el total.** Un guardia que solo comprobara
>    "el workspace tiene proyectos" pasaría en verde con un target renombrado, que es el caso realista: el workspace
>    sigue teniendo 11 proyectos y el `test` del release no ejecuta ninguno. El guardia resuelve la lista **por cada
>    target del release** y falla nombrando los vacíos; de ahí que `RELEASE_TARGETS` tenga que ir a la par con los
>    `run-many` del YAML, dicho en el propio script.
> 5. **El modo de prueba y la tabla de tres resultados chocan en un caso, y queda anotado en vez de tapado.** En una
>    corrida con `dry_run: true` **y destino configurado**, `deploy-prod` queda saltado a propósito y
>    `report-cd-outcome.sh` lo lee como "había destino y el despliegue no terminó bien" → **rojo falso**. Hoy no puede
>    darse (0 secretos configurados), y `cd-staging` tiene el mismo hueco con su `dry_run` de 6.4. No se arregla aquí
>    duplicando la tabla de decisión en un segundo script —dos lógicas de decisión es peor que un rojo falso
>    imposible—; se cierra en la fila 35, para los dos workflows a la vez.
> 6. **Un dispatch sin modo prueba y sin tag deja el `ref` del checkout vacío.** Evaluada la expresión del YAML como
>    JavaScript (mismos operadores y misma semántica de verdad) sobre los cinco escenarios: ahí `ref` sale `""` y
>    `actions/checkout` cae a la referencia del dispatch. No se añade otra rama a una expresión que ya decide
>    demasiado: el guardia de semver recibe el **nombre de la rama** y aborta nombrándolo (`no empieza por 'v'`) antes
>    de construir nada. Queda escrito en el YAML.
> 7. **`infra/README.md` seguía diciendo la regla revocada.** Línea 20: «Los workflows CD esperan secrets SSH; sin
>    ellos el job de deploy **falla** (no hay dry-run de aceptación)» — que es literalmente ADR-033 D10, enmendado por
>    ADR-048 §3 en este mismo change. Y el apartado de CD declaraba `cd-prod` «**todavía sin** la verificación del
>    artefacto». Corregidas las dos, más la tabla de tags de producción (`:latest` móvil) y el modo de prueba.
>
> **Lo que quedaba sin verificar y por qué** (escrito antes de que la rama se publicara; **revisado contra la corrida
> real en el bloque siguiente**, que deja verificadas 8.2, 8.3 y 8.7 y abiertas 8.1 y 8.5).
> 8.1, 8.2, 8.3, 8.5 y 8.7 exigen una **corrida real de GitHub Actions**:
> que el modo de prueba construya el commit de la rama y no el del tag; que no aparezca ningún `:latest` nuevo en
> GHCR; que el preflight reporte `none` leyendo el entorno espejo; que no quede ningún despliegue registrado en
> `production`; y el lado de 8.5 que pide un commit de solo documentación dejando `ci.yml` en verde. La rama no está
> publicada y el repositorio no tiene secretos, así que nada de eso se puede observar desde aquí. Lo que **sí** se
> ejecutó fuera de Actions: la tabla completa de casos del guardia de semver (8.6, diez casos), el guardia del
> conjunto vacío por los dos lados (real → 11 proyectos y ningún target vacío; forzado → `[FAIL] el release
> verificaría **cero proyectos** para: no-such-target`), las dos medidas de Nx del punto 3, la lectura de la API de
> GitHub del punto 1, `actionlint` sobre los tres workflows (limpio, y falsado con un `needs` inexistente para
> comprobar que de verdad analiza), el parseo del YAML confirmando que las expresiones plegadas llegan en **una sola
> línea**, la evaluación de las ocho expresiones del workflow sobre cinco escenarios de disparo, y la comprobación de
> que los **seis** nombres que deriva la expresión del job `report` coinciden uno a uno con los que imprime
> `infra/ci/report-cd-outcome.sh` con `TARGET_LABEL=production`.

> **Lo que la corrida real de `cd-prod` demuestra del grupo 8, y lo que no (2026-09-24, revisión contra los logs).**
> La corrida es `36068228388`, `workflow_dispatch` con `dry_run: true` sobre esta rama.
>
> * **8.2 — verificada, y la premisa del grupo queda medida en vez de supuesta.** Consultada la API **después** de
>   esa corrida: `repos/{owner}/{repo}/environments` → **1** (`production-preflight`, `protection_rules: []`, sin
>   URL) y `repos/{owner}/{repo}/deployments` → **1**, con `environment: production-preflight` y
>   `created_at: 2026-09-24T22:34:53Z`, el instante en que arrancó la corrida. Eso demuestra el primer efecto que 8.2
>   manda medir: **referenciar un entorno abre un registro de despliegue**. El segundo queda descartado: el entorno
>   `production` **no existe**, así que no hay revisores que puedan colgar el job. El resultado está escrito en
>   `cd-prod.yml` §preflight.
>   **Consecuencia que no conviene tapar:** el espejo **no** es «de solo lectura». El registro de despliegue se abrió
>   —en `production-preflight`—; lo que el espejo consigue es que no se abra en `production`, no que no se abra.
> * **8.3 — verificada por los dos lados.** `environment: production-preflight` aparece **solo** en `preflight` y
>   `environment: production` **solo** en `deploy-prod`; el preflight reportó `estado: none` leyendo desde el espejo,
>   y la lista de `deployments` no tiene **ninguna** entrada de `production`.
> * **8.7 — verificada.** El step `Show what is being verified` imprime `commit      : b541a9a314b4…`,
>   `github.ref  : refs/heads/change/deploy-image-verification` y `referencias que apuntan a este commit:
>   change/deploy-image-verification` —el commit de la rama, no el del tag—, y
>   `##[notice]Modo prueba: se construye y se verifica sha-b541a9a314b4; no se publica ni se despliega nada.`. En
>   GHCR **no existe ningún tag `latest`** en ninguno de los tres paquetes.
> * **8.1 sigue abierta.** La corrida de prueba demuestra tres de las cuatro piezas que 8.1 enuncia: construir con
>   `load` y sin `push`, verificar con `docker-compose.prod.yml` —la pila entera sana, `rs0` con un miembro
>   `PRIMARY`, `/health` de `api` y de `worker` con mongo y redis `up`, `<lv-root>` servido por `web`— y el par
>   `preflight` (`none`) / `deploy-prod` (saltado). La cuarta, **publicar esas mismas imágenes**, es justo la que el
>   modo de prueba salta por su `if:`: el camino de publicación de `cd-prod` (tag semver salido del guardia +
>   `MOVING_TAG=latest`, que es el tag que producción se lleva en el siguiente `pull`) **no se ha ejecutado nunca**.
>   Una corrida verde en modo prueba no prueba eso, y es la pieza de más riesgo del workflow.
> * **8.5 seguía abierta en esta revisión.** La corrida demuestra el lado **positivo** —`ok: el release verifica 11
>   proyectos y ningún target del release queda vacío`—, que es el que ya pasaba. Los dos lados que 8.5 pide
>   **falsar** (conjunto vacío en modo release dando rojo; commit de solo documentación dejando `ci.yml` verde con el
>   paso incondicional corriendo) no se ejercitaron ahí. **Se ejercitaron después: los dos bloques siguientes son esa
>   evidencia, y con ellos 8.5 queda marcada.**

> **8.5 — lado 1 (conjunto vacío en modo release) falsado, 2026-09-24.** Ejercitado `infra/ci/assert-release-projects.sh`
> tal cual está en la rama, sobre el workspace real, por dos caminos:
>
> 1. **Por la palanca documentada en la cabecera del script** (`RELEASE_TARGETS`):
>    `RELEASE_TARGETS='lint typecheck test eval-ci-renamed build' infra/ci/assert-release-projects.sh` → código **1**,
>    con `  eval-ci-renamed 0  <-- VACÍO` en la tabla y
>    `[FAIL] el release verificaría **cero proyectos** para: eval-ci-renamed`.
> 2. **Por el caso realista del punto 4 de la nota de implementación —un target renombrado—**, que es el que importa:
>    renombrado `"eval-ci"` a `"eval-ci-old"` en `libs/ai/project.json` (el **único** sitio que lo declara) y ejecutado
>    el guardia **con su lista de targets por defecto**, sin tocar nada más → código **1**, `  eval-ci      0  <-- VACÍO`
>    y `[FAIL] el release verificaría **cero proyectos** para: eval-ci`. En ese mismo estado, lo que el `verify` del
>    release haría sin guardia: `pnpm nx run-many --all -t eval-ci` → `NX   No tasks were run` y código **0**. El verde
>    sin ejecutar nada, medido en el estado averiado y no supuesto. Y el total del workspace **seguía siendo 11
>    proyectos**: un guardia sobre el total, y no por target, habría pasado en verde.
>
> **Restaurado** con `git checkout -- libs/ai/project.json`; el guardia vuelve a
> `ok: el release verifica 11 proyectos y ningún target del release queda vacío`, código **0**.

> **8.5 — lado 2, lo medido fuera de Actions (2026-09-24).** El guardia **no está cableado** a los dos workflows por
> afectación: `grep -c assert-release-projects` sobre los tres da `ci.yml:0`, `cd-staging.yml:0` y `cd-prod.yml:1` —el
> step `Assert the release verifies a non-empty set of projects` de `cd-prod.yml`, y ningún otro—.
> Y con el conjunto afectado **vacío** —lo que produce el merge que solo toca documentación— los cinco pasos por
> afectación de `ci.yml` terminan en verde sin ejecutar nada: con `NX_BASE=HEAD NX_HEAD=HEAD`,
> `pnpm nx affected -t <lint|typecheck|test|eval-ci|build>` → `NX   No tasks were run` y código **0** en los cinco;
> y el paso **incondicional** de 3.2 sí corre en ese mismo estado: `infra/ci/repo-checks.sh` →
> `ok: 5 comprobaciones de repositorio ejecutadas`, código **0**.
>
> **8.5 — lado 2, la corrida real (2026-09-24):**
> **https://github.com/manuXD270516/linkvault/actions/runs/36072683959** — `ci` sobre
> `change/deploy-image-verification`, evento `pull_request`, commit **`5a0a058933`**, conclusión **success**. Ese
> commit es **de solo documentación**: toca un único fichero, `openspec/changes/deploy-image-verification/tasks.md`
> (+32 líneas, el bloque del lado 1). El paso **incondicional** de 3.2 corrió en esa misma corrida —step 8,
> `Repo checks` → `success`—, con `Successfully ran target check for project repo-checks and 5 tasks it depends on`
> y `ok: 5 comprobaciones de repositorio ejecutadas` en el log, **antes** del step `Derive affected base and head`.
> Los dieciséis steps del job salieron en `success` y ninguno invocó el guardia.
>
> **Hizo falta un PR para poder observarlo, y conviene que quede escrito**: `ci.yml` se dispara con `push` a `main` y
> con `pull_request` (`:5-8`), así que empujar el commit a la rama **no disparó nada** —comprobado después del push:
> `gh run list --branch change/deploy-image-verification` seguía devolviendo solo las seis corridas de
> `cd-staging`/`cd-prod` por `workflow_dispatch`—. La corrida existe porque se abrió el PR **#57 en borrador**
> (https://github.com/manuXD270516/linkvault/pull/57), que aquí no se fusiona.
>
> **Lo que esta corrida NO demuestra, dicho antes de que nadie lo lea de más:** su conjunto afectado **no estaba
> vacío**. En `pull_request`, `nx-set-shas` fija la base en el punto de corte con `main` (`NX_BASE:
> 00640a3d02a1`, `NX_HEAD: 271486c9f609`), así que el verify corrió de verdad: `lint` para 11 proyectos, `typecheck`
> 10, `test` 9, `eval-ci` para `ai` y `build` 4, todos `Successfully ran target`. Dentro de Actions el conjunto vacío
> solo se da en el `push` a `main` del merge, y eso no se observa sin empujar a `main`. Lo que cierra ese hueco es
> que allí **no hay nada que pueda fallar**: el guardia no está invocado en `ci.yml` —el grep de arriba— y con el
> conjunto vacío los cinco pasos por afectación terminan en **0** —la medición de arriba— mientras el paso
> incondicional de 3.2 sigue ejecutando sus cinco comprobaciones.

## 9. Cerrar la divergencia de entorno entre los tres `verify`

- [x] 9.1 [infra] Cerrar la divergencia con `ci.yml`: a los steps `Test` y `Eval (replay)` de `cd-staging.yml` y `cd-prod.yml` les falta `AI_EMBED_CHAIN: mock`, que `ci.yml` sí fija; añadirlo y verificar comparando los tres ficheros lado a lado.

> Extraer el `verify` a un workflow reutilizable y llevar allí el step `Check prompt assets` **salen de este change**: es un refactor que ningún defecto de aquí exige, y un fallo en él pondría en rojo los tres pipelines justo en el change cuyo entregable es una corrida verde. Quedan registrados en la fila 35 (13.5).

## 10. La documentación deja de mentir, y se comprueba sola

- [x] 10.1 [infra] Crear el **registro declarado** de afirmaciones (fichero versionado), donde cada entrada asocia un patrón que reconoce la afirmación, **los archivos donde se busca —`docs/**` y también `apps/**`, porque la misma frase vive en comentarios del código (10.3)—** y el **símbolo del código que la desmiente**; verificar que la primera entrada es la del borrado de cuenta, con `DELETE /api/users/me` (`apps/api/src/modules/users/presentation/account-deletion.controller.ts`) y su cascada (`mongo-account-deletion.cascade.ts`, probada en `account-deletion.cascade.spec.ts`) como símbolo.
- [x] 10.2 [infra] Corregir en `docs/RUNBOOK.md` **los ocho sitios verificados** —`:468`, `:478`, `:558`, `:585`, `:709`, `:929`, `:952` y `:1008`— que afirman que el borrado de cuenta no existe o que lo hereda `deploy-prod`: nombrar la operación del producto como camino primero y dejar el procedimiento manual con `mongosh` como excepcional, diciendo qué sustituye; verificar con una búsqueda del patrón sobre el fichero entero que no queda ninguno más (la frase se parte entre `:467` y `:468`, así que la búsqueda no puede ser línea a línea).
- [x] 10.3 [backend] La misma afirmación está en **tres** sitios de `apps/**`, no en uno: `apps/api/src/modules/links/application/link.mapper.ts:31-32` ("hoy no existe el borrado de cuenta, así que no debería ocurrir"), `apps/api/src/modules/groups/application/group.mapper.ts:51-52` (idéntica, sobre `UNKNOWN_MEMBER_NAME`) y `apps/api/src/modules/groups/application/ports/group-member-directory.port.ts:9`. Corregir los tres —la defensa en profundidad sigue siendo correcta; lo que es falso es el motivo que dan— y verificar con una búsqueda del patrón sobre `apps/**` que no queda ninguno más, con `apps/**` ya dentro del alcance del registro de 10.1 para que el tercero no vuelva por donde volvió el segundo.
- [x] 10.4 [infra] `docs/adr/ADR-024.md:161` y `:197` también la afirman: un ADR es historia y **no se reescribe**, así que añadir una nota fechada que diga que esa deuda se cerró y dónde; verificar que ADR-026 §192 y ADR-028 §238, que solo dicen qué hereda `deploy-prod`, quedan igualmente anotados o justificados como no afectados.
- [x] 10.5 [infra] Escribir en `tools/repo-checks` la comprobación que **falla** cuando, para una entrada del registro, el patrón sigue apareciendo en la documentación **o en el código de `apps/**`** y el símbolo existe, nombrando entrada, archivo y símbolo; verificar que **cae** reintroduciendo la frase a mano en el RUNBOOK **y** reintroduciéndola en uno de los tres comentarios de 10.3, y restaurar las dos veces.
- [x] 10.6 [infra] Comprobar que la comprobación tampoco se queda en verde por el otro lado: si el símbolo desaparece del código, la entrada SHALL señalarse para revisión en vez de pasar en silencio; verificar renombrando el símbolo a mano, viendo el aviso, y restaurando.
- [x] 10.7 [infra] Inventariar **todos** los sitios donde vive el modelo muerto antes de tocar nada, separando los que son **valor por defecto** de los que son **literales de test**, porque no se tratan igual:
  - Valores por defecto (los que hay que cambiar): `.env.example:166`, `docker-compose.prod.yml:180` (servicio `api`) y `:239` (servicio `worker`), y el valor por defecto del **código** en `libs/ai/src/infrastructure/config/ai-config.schema.ts:59` (`AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_MODEL`), que consume `libs/ai/src/infrastructure/config/default-byok-config.ts:19`.
  - Literales de test que **nombran** el modelo muerto sin leer el default: `byok-provider.factory.spec.ts:75`, `parse-ai-config.spec.ts:73`, `:99`, `:290`, `:308` y `:402`, `provider-registry.spec.ts:31`, `openrouter.provider.spec.ts` (ocho apariciones) , `openrouter.run-task.spec.ts:98`, `:145`, `:204` y `evals/recording/record-fixtures.openrouter.spec.ts:25`.
  - **Corregir la afirmación de la iteración anterior**: `byok-provider.factory.spec.ts:75`/`:83` y `parse-ai-config.spec.ts:140-143` fijan valores **explícitos** (`openrouterModel` en el config del test y `BYOK_OPENROUTER_MODEL` en el env), así que **no** rompen al cambiar el default; lo que hay que hacer con ellos es actualizar el literal muerto de `:75`, no "arreglar lo que rompe".

  Verificar el inventario con una búsqueda del literal sobre todo el repositorio y dejarlo escrito: corregir solo el ejemplo dejaría la avería en los sitios que más cuesta ver, y no distinguir defaults de literales produce en 10.11 una comprobación que falla en veinte ficheros de test.
- [x] 10.8 [infra] El sustituto **ya está medido y es `cohere/north-mini-code:free`**, y cumple las **dos** condiciones: disponible en la pasada anotada y terminado en `:free`, que es lo único con lo que OpenRouter fuerza `data_collection: deny` (ADR-032 §4, `openspec/specs/ai/byok`). Lo registra el propio `docs/RUNBOOK.md` en `:1021` ("modelo confirmado"), `:1026` ("Modelo fijado") y `:1034` (`data_collection: "deny"` aceptado, HTTP 200), y `.env.example:153` ya lo usa para el `OPENROUTER_MODEL` de plataforma. **No quedarse en `:1045-1047`**: ahí solo se dice que los `:free` *populares* (Qwen/Gemma, Nemotron, Liquid) estaban en rate-limit o sin endpoint compatible; leer solo eso lleva a concluir "ninguno cumple", vaciar la variable y dejar BYOK-OpenRouter **inenrutable sin motivo**, que es una regresión funcional disfrazada de protección. Verificar releyendo `:1017-1047` entero y anotando en el RUNBOOK (Paso 6 nonies) la fecha de la pasada y el resultado **por candidato**, incluido el que sí cumple, para que la próxima lectura no vuelva a quedarse en el párrafo de los descartes.
- [x] 10.9 [backend] La regla "sin modelo utilizable → proveedor no disponible" se implementa como **invariante**, no como el camino esperado: 10.8 encontró candidato, así que el estado normal es "con modelo", y esto es lo que tiene que pasar el día que no lo haya. Hace falta porque la factory (`byok-provider.factory.ts:104-115`) pone `dataCollection: 'omit'` cuando el modelo no acaba en `:free`, y `EnvReader` (`parse-ai-config.ts:174-177`) trata la cadena vacía como ausente: sin esta regla, un default vacío mandaría texto de CV **sin `data_collection: deny`**. Sin modelo utilizable, `ByokProviderFactory` **no SHALL devolver proveedor** para `openrouter` —el vendor deja de poder enrutarse—, sin impedir el arranque y sin afectar a `anthropic` ni a `openai`; verificar con tests unitarios de que `providersFor` **no** incluye OpenRouter con `openrouterModel` vacío, **sí** lo incluye con uno `:free` y con `dataCollection: 'deny'`, y que los otros dos vendors se resuelven igual en los dos casos.
- [x] 10.10 [backend] Fijar `cohere/north-mini-code:free` como valor de `BYOK_OPENROUTER_MODEL` en los **cuatro** sitios de valor por defecto de 10.7 (`.env.example:166`, `docker-compose.prod.yml:180` y `:239`, y `AI_CONFIG_DEFAULTS` en `ai-config.schema.ts:59`), y actualizar el literal muerto de `byok-provider.factory.spec.ts:75` y los demás literales del inventario que nombran `meta-llama/llama-3.3-70b-instruct:free` como si existiera. **No vaciar la variable**: vaciarla dejaría el proveedor inenrutable por 10.9 teniendo candidato, que es una regresión, no una protección. Actualizar también el comentario de `.env.example:162-163` para que diga cuál es el modelo verificado y con qué pasada. Verificar que `pnpm nx run ai:test` pasa y que ningún test sigue afirmando que el default del código es el modelo muerto.
- [x] 10.11 [infra] Escribir en `tools/repo-checks` la comprobación de valores por defecto desmentidos, que inspeccione **solo los sitios de valor por defecto** de 10.7 **y** el namespace de imágenes del compose (4.6), y falle nombrando variable, valor y archivo. **Alcance y exclusiones, declaradas en el fichero de la comprobación**: excluye `infra/ci/verify.env` (relleno declarado, no un valor por defecto de nadie) y excluye los **ficheros de test**, que nombran el modelo muerto como literal offline y no como valor por defecto de nada —sin esa exclusión la comprobación fallaría en unos veinte ficheros de `libs/ai` y se desactivaría a la primera—. Verificar que **cae** devolviendo el modelo muerto **solo al compose**, después **solo al default del código**, y restaurar las dos veces; y que **no** cae por los literales de test. Si corregir el ejemplo bastara para pasar, la comprobación no cubriría lo que dice cubrir.
- [x] 10.12 [backend] **El aviso de arranque que exige la delta de `ai/byok` no tiene hoy por dónde salir**: `AiConfigResult` solo distingue `{ ok: false, problems }` de `{ ok: true, config }`, y todo lo que `parseAiConfig` sabe emitir **aborta** el proceso (`formatAiConfigProblems`, `parse-ai-config.ts:157-169`); no existe canal de aviso. Añadir uno: un tipo `AiConfigWarning` con la misma disciplina que `AiConfigProblem` (variable, motivo y `detail` sin valores ni credenciales), un campo `warnings` en la rama `ok: true` del resultado, un `formatAiConfigWarnings` simétrico, la emisión del aviso cuando `byok.openrouterModel` queda vacío tras aplicar el valor por defecto, y el logueo de esos avisos al arrancar `api` y `worker`, donde hoy se formatean los problemas. Verificar con tests unitarios en `parse-ai-config.spec.ts`: con `BYOK_OPENROUTER_MODEL=''` y sin default el resultado es `ok: true` **con** el aviso nombrando el vendor (el proceso arranca igual, como exige la delta), y en el caso normal `warnings` queda vacío. Sin esta tarea, 10.9 tendría spec y no mecanismo.
- [x] 10.13 [infra] Tras 10.9 y 10.10, el RUNBOOK seguiría describiendo un fallo que ya no ocurre: `:1017-1021` y `:1040-1043` dicen que si el modelo deja de aceptar `deny` "el proveedor falla, el circuit breaker abre y la degradación puede quedar permanente y silenciosa". Para el **BYOK de OpenRouter** eso deja de ser cierto: sin modelo utilizable el proveedor **no se construye** y no entra en el enrutado, con aviso al arrancar (10.9, 10.12), así que no hay breaker que abrir. Separar los dos casos en el texto —la cadena de plataforma (`OPENROUTER_MODEL`), donde el breaker **sí** sigue siendo el mecanismo, y el BYOK, donde el estado nuevo es "vendor inenrutable con aviso"— y decir dónde se ve cada uno; verificar con una búsqueda de "breaker" y "degradación" sobre el apartado y comprobando que ninguna frase atribuye al BYOK un comportamiento que el código ya no tiene.

> **Lo que el grupo 10 dio por cierto y no lo era (2026-09-24, implementación).**
>
> 1. **La falsación de 10.5 *pasó* a la primera, y de ahí salió el arreglo.** La primera versión de la comprobación
>    buscaba con `\s+` entre palabras. Eso encuentra la frase partida del RUNBOOK —"Hoy no ⏎ existe el borrado de
>    cuenta", `:467-468`— pero **no** la de `group.mapper.ts:51-52`, donde entre las dos mitades hay un ` * ` de
>    JSDoc: `…el borrado ⏎ * de cuenta`. Devuelta a mano la frase original a ese comentario, la comprobación salió
>    en **verde**. Es decir: nació incapaz de detectar justo el sitio que 10.3 nombra, y solo se supo **ejecutando**
>    la falsación. El arreglo es aplanar el texto antes de buscar —sangrías, saltos y marcadores de continuación
>    (`//`, ` * `, `#`, `>`) colapsados en un espacio, conservando el índice original para poder dar la línea—.
>    Hecho así, los **cuatro** comentarios originales de HEAD caen a la vez y cada uno en su línea:
>    `group.mapper.ts:51`, `group-member-directory.port.ts:9`, `link.mapper.ts:31` y `cv-file-key.ts:10`. Sin correr
>    la falsación, el grupo habría entregado una comprobación decorativa: el sexto defecto de ADR-048 §7, repetido
>    dentro del grupo que lo cita.
> 2. **La afirmación no vive en tres sitios de `apps/**` sino en cuatro, y el cuarto está en `libs/`.**
>    `libs/shared/src/cv/cv-file-key.ts:10` la dice **en futuro**: "que es justo lo que el borrado de cuenta
>    necesitará". Con el alcance que 10.1 declara (`docs/**` y `apps/**`) ese cuarto se queda fuera, que es
>    literalmente el motivo por el que 10.3 pide ampliar el alcance. El registro incluye `libs/**` y lleva un patrón
>    propio para la forma en futuro.
> 3. **El registro NO puede abarcar `docs/adr/**`, y 10.1 y 10.4 se contradicen en eso.** 10.1 pide buscar en
>    `docs/**`; 10.4 prohíbe reescribir un ADR y manda anotarlo. Juntas dejarían el CI en rojo por construcción sobre
>    ficheros que la propia tarea prohíbe corregir. `docs/adr/` queda **excluido con su motivo escrito** en
>    `claims.registry.mjs`; ADR-024, ADR-026 y ADR-028 llevan la nota fechada. ADR-026 §192 y ADR-028 §238 **sí**
>    estaban afectados (los dos dicen que `deploy-prod` hereda el borrado de cuenta), así que no valía justificarlos
>    como "no afectados".
> 4. **Escribir la corrección reintroduce la afirmación, y la comprobación lo pilló sobre mi propio texto.** El
>    primer intento de corregir `link.mapper.ts` **citaba entre comillas** la frase vieja para explicar qué había
>    dejado de ser cierto. El registro no analiza prosa: una cita es indistinguible de una afirmación, y
>    `check(claims-registry)` falló en `link.mapper.ts:33`. Reescrito sin citarla. Es el precio declarado de atarse a
>    patrones, y conviene saberlo antes de redactar la corrección.
> 5. **Las líneas del RUNBOOK de 10.2 estaban bien; las del compose de 10.7 no.** Las ocho (`:468`, `:478`, `:558`,
>    `:585`, `:709`, `:929`, `:952`, `:1008`) eran exactas. Lo que sí envejeció es 10.7: `BYOK_OPENROUTER_MODEL` está
>    en `docker-compose.prod.yml:200` (servicio `api`) y `:260` (`worker`), no en `:180` y `:239` — el grupo 4 metió
>    variables por encima.
> 6. **Los literales de test son ~19 apariciones en 6 ficheros, no "unos veinte ficheros" (10.11).** Inventario real:
>    `openrouter.provider.spec.ts` (8), `parse-ai-config.spec.ts` (5), `openrouter.run-task.spec.ts` (3),
>    `byok-provider.factory.spec.ts` (1), `provider-registry.spec.ts` (1) y `record-fixtures.openrouter.spec.ts` (1).
>    La exclusión sigue siendo necesaria, y se hace **estructural**: `check-stale-defaults` no lee ningún fichero de
>    test, solo los tres sitios de valor por defecto. Verificado devolviendo el literal muerto a dos de esos
>    ficheros (13 apariciones) y viendo la comprobación pasar en verde.
> 7. **El canal de aviso de 10.12 no rompió a ningún consumidor, al contrario de lo que cabía temer.** Añadir
>    `warnings` como campo **obligatorio** de la rama `ok: true` de `AiConfigResult` dejó `typecheck` en verde para
>    `shared`, `ai`, `api` y `worker` a la primera: el único productor de esa rama es `parseAiConfig`. Confirma lo
>    que 10.12 afirmaba: no existía canal de aviso, no existía nadie que lo consumiera.
> 8. **`git checkout -- <fichero>` no sirve para restaurar una falsación en este change**, y costó una recuperación:
>    revierte al `HEAD` de la rama, es decir **borra también lo que el grupo acaba de escribir** en ese fichero. Las
>    falsaciones se restauran desde una copia tomada **antes** de romper, y se comprueba por hash que el fichero
>    vuelve byte a byte al estado previo.
> 9. **`api:test` es inestable bajo carga y no por este grupo.** La primera corrida de
>    `pnpm nx affected -t lint,typecheck,test` dio dos fallos por `Test timed out in 5000ms`
>    (`auth.controller.logout.spec.ts` y `cv-match-analyses-count.spec.ts`, los dos de integración con
>    `mongodb-memory-server`). En aislamiento pasan (12/12) y la segunda corrida del gate entero salió verde con Nx
>    marcándolo él mismo: `NX Nx detected a flaky task: api:test`.

## 10-bis. La disponibilidad por vendor: una señal, dicha una sola vez

> Grupo nuevo por la **decisión humana A1**: el change cierra también la contradicción de interfaz de las cuatro deltas
> que entraron al cerrar el debate (`web/byok`, `ai/usage-accounting`, `ai/task-execution` y `cv/match`), que definen
> «BYOK elegible» incluyendo **configuración utilizable** y exigen una **señal de disponibilidad por vendor que hoy no
> existe en ninguna capa**: ni en `libs/shared`, ni en la API, ni en el SPA. Va **después del grupo 10** porque todo él
> depende de 10.9 —la factory que deja de construir OpenRouter sin modelo— y de 10.12 —el canal de aviso—: antes de esas
> dos tareas el predicado que aquí se extrae no tendría ningún caso falso que devolver. Se numera `10-bis` y no `11`
> para no renumerar los grupos 11 a 13, a los que apuntan por número 1.1, 6.4, 8.5, 9, 11.1, 11.5 y 13.5.
>
> **Pendiente fuera de este fichero:** `design.md` §Non-Goals sigue diciendo "cualquier cambio funcional de la
> aplicación" y el manifiesto sigue etiquetando el change como `[devops]`. Con A1 las dos cosas son falsas —este grupo
> toca `libs/shared`, `libs/ai`, `apps/api` y `apps/web`—, y dejarlas así sería la misma clase de afirmación
> desmentida que el change persigue. La corrección es del autor del change, no de estas tareas.

- [x] 10-bis.1 [backend] **Decidir por dónde viaja la señal, y dejar el motivo escrito.** `GET /api/users/me/ai-keys` lista **solo los vendors con clave guardada** (`list-my-ai-keys.usecase.ts:19-30`), pero el aviso de indisponibilidad puede tener que salir para un vendor **sin** clave: la pantalla pinta un bloque por cada uno de los tres `AI_VENDORS` (`apps/web/src/app/features/profile/profile.page.ts:149-152`), tenga clave o no. De las dos salidas posibles —ampliar lo que devuelve ese listado, o exponer la configuración de IA pública por otra vía— se elige **ampliar el listado**, por tres razones: la delta de `web/byok` exige que la UI tome ese estado «de la respuesta del API de claves» y NO lo deduzca; ese listado es el único sitio donde el SPA ya mira para pintar esta sección; y un endpoint de configuración pública sería superficie nueva, con su propia decisión de qué se revela sin sesión y su propio reflejo en `design.md` y en el manifiesto, para responder algo que el listado ya puede decir. Dejar el motivo escrito en **dos** sitios: el comentario de cabecera de `libs/shared/src/schemas/ai-byok.schema.ts` y una sección nueva de `docs/adr/ADR-048.md` (decisión no trivial, regla de `CLAUDE.md`). Verificar que el ADR nombra la alternativa descartada y **por qué** se descarta, y que ningún fichero del change acaba proponiendo además un endpoint de configuración pública: dos vías para el mismo dato son otra vez dos verdades.
- [x] 10-bis.2 [backend] **El contrato compartido, antes que cualquier consumidor.** En `libs/shared/src/schemas/ai-byok.schema.ts`: añadir `available` a `aiKeyViewSchema` —hoy lleva solo `vendor`, `keyHint` y `updatedAt`, y es `strictObject`, así que el campo no puede colarse sin declararlo— y ampliar `listAiKeysResponseSchema` con `vendors`: **una entrada `{ vendor, available }` por cada uno de los tres `AI_VENDORS`**, con un refine que exija cobertura **exacta y sin repetidos**. Si ese array pudiera venir a medias, el SPA tendría que decidir qué significa un vendor ausente, que es justo lo que la delta le prohíbe (deducir). Verificar con tests de schema: una vista sin `available` no valida; una respuesta cuyo `vendors` deja fuera un vendor, o lo repite, no valida; una respuesta con `keys: []` y los tres estados sí valida. Y con `pnpm nx run-many -t typecheck -p shared api web`, que **romperá** en los dos productores de `AiKeyView` (`upsert-my-ai-key.usecase.ts:50-60` y `list-my-ai-keys.usecase.ts:22-28`): esa rotura es la señal de que los dos tienen que poblar el campo (10-bis.4), no un estorbo.
- [x] 10-bis.2bis [backend] **El tercer conjunto cerrado.** El dato nuevo choca con tres listas normativas que dicen "solo": la del listado de claves en `ai/byok`, la de la pantalla en `web/byok` y la de `openspec/specs/ai/data-protection/spec.md` («Secretos BYOK fuera de logs y respuestas»), que limita las respuestas de gestión de claves a `vendor`, `keyHint` y timestamps. Las tres se amplían en las deltas del change; esta tarea comprueba que la **implementación** respeta la tercera, que es la de seguridad: la respuesta trae el estado de disponibilidad y **nada más** —ni la clave en claro, ni el `ciphertext`, ni qué valor de configuración falta—. Verificar con un test que afirme el conjunto exacto de claves del cuerpo (no un `toMatchObject`, que dejaría pasar campos de más) y con otro que compruebe que un vendor indisponible **no** revela el motivo; comprobar que el primero **cae** añadiendo a mano un campo cualquiera a la respuesta, y restaurar.
- [x] 10-bis.3 [ai] **Un solo predicado de disponibilidad, no dos.** Quien decide si un vendor es construible es `ByokProviderFactory.buildProvider` (`byok-provider.factory.ts:81-122`), y tras 10.9 ahí vive la regla «OpenRouter sin modelo utilizable no se construye». Extraerla a una función exportada de `libs/ai` —`isByokVendorConfigUsable(vendor, config: ByokProviderConfig)`— y hacer que **la factory la llame** en vez de repetir la condición en línea; publicarla en `libs/ai/src/index.ts` y, para que la API no tenga que leer `AiConfig.byok` por su cuenta, exponerla como proveedor del `AiModule` con un token nuevo en `ai.tokens.ts` (`BYOK_VENDOR_AVAILABILITY`) **añadido a `exports:`** (`ai.module.ts:362-368`), que es el módulo que `AiKeysModule` ya importa (`ai-keys.module.ts:17-20`). La API **NO SHALL** reimplementar ese criterio: el día que cambie uno, el otro se queda mintiendo, que es el patrón que este change entero persigue. Verificar con un **test de no divergencia** en `libs/ai`, sobre una tabla de configuraciones (OpenRouter con modelo `:free`, con modelo de pago y con modelo vacío; `anthropic` y `openai` con y sin modelo): `providersFor` incluye `byok:<u>:<vendor>` **si y solo si** el predicado dice que ese vendor es utilizable. Comprobar que **cae** devolviendo a la factory su condición propia —que responda distinto del predicado para un caso— y restaurar; si pasara en verde, el test no estaría atando los dos lados.
- [x] 10-bis.4 [backend] **La API pobla el campo y no decide nada.** `ListMyAiKeys` inyecta `BYOK_VENDOR_AVAILABILITY`, calcula **un solo** mapa vendor → disponible y de ahí salen las dos cosas: el `available` de cada `AiKeyView` y el array `vendors` con los tres vendors. `UpsertMyAiKey` (`upsert-my-ai-key.usecase.ts:50-60`) pobla el mismo campo en la vista que devuelve el `PUT`, para que la pantalla no se quede con un estado viejo justo después de guardar una clave. `AiKeysController` sigue validando la respuesta con `listAiKeysResponseSchema.parse` (`ai-keys.controller.ts:45`), que tras 10-bis.2 exige la cobertura de los tres vendors. Verificar con unitarios en `apps/api/src/modules/users/application/ai-keys.usecase.spec.ts`: sin ninguna clave la respuesta trae `keys: []` y los **tres** estados; con clave de un vendor indisponible esa vista sale con `available: false` y el resto con `true`; y un test de coherencia de que **ningún** `keys[i].available` difiere del estado del mismo vendor en `vendors` —dos campos del mismo cuerpo que se contradigan serían la misma avería en miniatura—.
- [x] 10-bis.5 [ai] **Los otros tres consumidores heredan la condición; comprobarlo, no suponerlo.** Las deltas de `ai/task-execution`, `ai/usage-accounting` y `cv/match` añaden «configuración utilizable» a la definición de BYOK elegible, y con 10.9 y 10-bis.3 eso les llega **solo** por la factory: `run-task.usecase.ts:150-180` compone la cadena con `resolveByokProviders`, y `DefaultProviderEligibility` (`provider-eligibility.ts:76-99`) calcula `hasEligibleByok` de la misma fuente, que es lo que consume la vigencia del degradado por cuota de `match`. Ninguno de los tres SHALL volver a preguntar por el modelo ni repetir el predicado. Verificar con unitarios: con la cuota de plataforma agotada y el **único** vendor con clave sin configuración utilizable, `runTask` devuelve `quota_exceeded` con su instante de vuelta, sin contactar a ningún proveedor y con un único registro `quota` —**no** un degradado por cadena vacía, que es el fallo que estas deltas cierran—; con ese vendor inutilizable **y otro utilizable**, la cadena restringida se compone solo con el segundo; y `hasEligibleByok` sale en falso en el primer caso y en verdadero en el segundo.
- [x] 10-bis.6 [frontend] **El SPA consume la señal, no la deduce.** `ai-keys.api.ts:22-25` devuelve hoy solo `response.keys` y tira el resto del cuerpo: pasa a devolver el `ListAiKeysResponse` entero; `ai-keys.store.ts` guarda `vendors` en el estado y expone la disponibilidad por vendor junto a `keyByVendor`; `profile.page.ts` añade el accesorio por vendor al lado de `keyFor` (`:176-178`); y `profile.page.html` sustituye el bloque condicionado solo al nombre del vendor (`@if (vendor === 'openrouter')`, `:293-300`) y el comentario que dice literalmente «(MVP: siempre)» (`:225-228`) por los **dos avisos distintos**, que NO SHALL compartir párrafo ni `data-testid`:
  - el de política de datos (`profile-byok-openrouter-data-collection`) **solo** cuando ese vendor sí es construible;
  - el de indisponibilidad, `data-testid` nuevo `profile-byok-unavailable-<vendor>` y `role="status"`, cuando no lo es, con los cuatro contenidos de la delta y **en ese orden**: que ese vendor no está disponible ahora mismo por la configuración de la instancia; que su clave sigue guardada y cifrada y no se ha borrado; que no se usará para ninguna tarea mientras dure, ni siquiera con el permiso de IA externa vigente; y qué puede hacer la persona —usar o configurar otro vendor soportado, o pedir a quien administra la instancia que configure el modelo—. **No** SHALL pedirle que cambie su clave ni sugerir que el problema está en ella.

  El aviso de destino del dato (`profile-byok-destination-<vendor>`) se mantiene tal cual para **todos** los vendors, porque el primer párrafo del requirement lo exige sin condición y el aviso de indisponibilidad lo acota explícitamente en el párrafo siguiente; lo único que la delta prohíbe mostrar para un vendor indisponible es el de `data_collection`. Y la frase de `data_collection` conserva su redacción condicional («si el modelo configurado no es `:free`…»): el contrato de 10-bis.2 lleva disponibilidad, **no** si el modelo fuerza `deny`, así que afirmarlo en indicativo sería afirmar algo que el SPA no sabe. Verificar leyendo la plantilla que ningún aviso queda cableado a `vendor === 'openrouter'` y que no queda ningún «MVP» en el comentario.
- [x] 10-bis.7 [frontend] **Textos ES y EN con identificador nuevo.** Añadir a `apps/web/src/locale/messages.xlf` y `messages.en.xlf` los `trans-unit` del aviso de indisponibilidad con ids **nuevos** (`profile.byok.unavailable…`), nunca reutilizando `profile.byok.destination` ni `profile.byok.openrouterDataCollection`. La regla de este mismo change: **cualquier frase cuyo `source` cambie, aunque sea una palabra, SHALL llevar id nuevo** — una traducción heredada es una promesa que sobrevive a su desmentido, y aquí el desmentido es precisamente el punto. Verificar con `pnpm nx run web:extract-i18n` (redirigiendo la salida a un archivo y leyendo el archivo) que los ids salen como se escribieron, y con un test junto a `apps/web/src/locale/privacy-text.spec.ts` —que ya sabe parsear los dos `.xlf` con `parseXlfUnits`— de que cada id nuevo existe en los dos ficheros, que el `target` inglés no está vacío y que ningún id heredado ha cambiado de `source`.
- [x] 10-bis.8 [frontend] **Tests de componente y smoke.** En `apps/web/src/app/features/profile/profile.page.spec.ts`, con el API respondiendo los tres vendors: (a) con OpenRouter indisponible sale `profile-byok-unavailable-openrouter` con los cuatro contenidos y **no** sale `profile-byok-openrouter-data-collection`; (b) con OpenRouter disponible ocurre lo contrario; (c) con solo OpenRouter indisponible, `anthropic` y `openai` siguen mostrando su aviso de destino y **ninguno** muestra el de indisponibilidad (`:427-442` ya afirma parte de eso y pasa a depender del estado). En `apps/web-e2e/src/byok.spec.ts`: `:33` afirma hoy el aviso de `data_collection` **incondicionalmente**, así que pasa a derivar la expectativa del cuerpo de `GET /api/users/me/ai-keys` —afirmar la correspondencia UI↔API, que es comprobable en cualquier configuración, y no la existencia de un vendor—; y se añade el caso del vendor indisponible. **Cuidado con cómo se fabrica ese caso:** vaciar `BYOK_OPENROUTER_MODEL` en el entorno **no** lo produce, porque `EnvReader` lee la cadena vacía como ausente y `parse-ai-config.ts:525-527` repone el valor por defecto del código, que tras 10.10 es un modelo `:free` vivo; el estado indisponible es un **invariante** (13.2) y no es alcanzable por entorno. La pasada del smoke que lo cubre SHALL hacerse neutralizando a mano `AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_MODEL` —romper, mirar, restaurar, como el resto del change—, con la `api` arrancada aparte (`playwright.config.mts` solo levanta `nx serve web`), comprobando el aviso de indisponibilidad, que la clave guardada se sigue anunciando como guardada y que **no** aparece el de `data_collection`. El procedimiento, el motivo por el que no basta con el entorno y la obligación de restaurar van escritos en la cabecera del propio spec.
- [x] 10-bis.9 [frontend] **La verificación por negación, como el resto del change.** Romper cada afirmación a mano, mirar fallar y restaurar: (a) con OpenRouter **construible**, forzar el aviso de indisponibilidad (condición siempre cierta en la plantilla) y ver caer (b) de 10-bis.8; (b) con OpenRouter **indisponible**, devolver a la plantilla el `@if (vendor === 'openrouter')` de hoy y ver que el test del aviso de `data_collection` cae, porque afirmaría un envío que no va a ocurrir; (c) hacer que el caso de uso de la API responda `available: true` fijo y ver caer el test de coherencia de 10-bis.4 y los dos de componente. Sin estas tres, el grupo sería otra afirmación no verificada — y el aviso que nadie puede hacer fallar es exactamente el tipo de señal que este change vino a arreglar.
- [x] 10-bis.10 [frontend] **La precedencia sobre el aviso de consentimiento apagado.** Tarea **añadida en el grupo 13 (13.4)**: el requirement "Claves guardadas con consentimiento off" de `web/byok` se amplía en este change con una precedencia **vendor a vendor** —para un vendor sin configuración utilizable, el aviso de indisponibilidad **sustituye** al de consentimiento apagado, porque «no se usan hasta que vuelvas a dar el permiso» es literalmente falso ahí: dar el permiso no lo activa— y **ninguna tarea lo enunciaba**. Estaba implementado y probado, pero sin tarea: exactamente el agujero que 13.4 existe para cazar, y el mismo que dejó sin tarea el requirement de healthchecks por contenido hasta la iteración 3. Enunciarlo aquí y verificar que lo implementado lo cumple: el aviso de permiso apagado sale **por vendor** —`data-testid` `profile-byok-consent-off-<vendor>`, id de i18n `profile.byok.vendorKeyInactive`— y `showsConsentOffNotice(vendor)` exige las tres condiciones a la vez: clave guardada **de ese** vendor, disponibilidad `=== true` y permiso apagado. Así, sobre un vendor caído el aviso de permiso no sale nunca y solo se lee el de indisponibilidad —que ya dice que la clave sigue guardada y cifrada—, mientras un vendor disponible con clave lleva el suyo con el texto íntegro y nombrando al proveedor. Verificado en `apps/web/src/app/features/profile/profile.page.spec.ts` con tres casos: «Vendor indisponible con el consentimiento apagado: la indisponibilidad sustituye al aviso de permiso», «El permiso apagado es de cada vendor: el indisponible solo lleva su aviso y el disponible solo el del permiso» y «Mientras el listado no ha respondido no se afirma nada sobre el permiso» (disponibilidad `undefined`: la pantalla no afirma ni que se usará ni que no). En verde dentro de `web:test` sin caché: **86 ficheros, 1026 tests**, corrida del 2026-09-25. **Nota de cierre (2026-09-25, commit `4dca9e3`):** hasta ese commit este punto cerraba con un «lo que NO queda cubierto» —el aviso «sigue siendo de sección» y partirlo «se retoma en la fila 35 (13.5)»—, y eso ya es falso: se partió **dentro de este change**. El aviso de sección (`profile-byok-consent-off`, id `profile.byok.keysInactive`) y los símbolos `byokKeysInactive` y `hasAnyUsableKey` del store **ya no existen**; el catálogo retira el id plural en ES y EN y `apps/web/src/locale/byok-availability-text.spec.ts` exige que el retirado no esté en ninguno de los dos ficheros. Lo que queda abierto no es el aviso sino su registro, y por eso los siete sitios que lo daban por diferido se corrigen a la vez que esta nota.

> **Lo que el contrato y el predicado (10-bis.1, 10-bis.2, 10-bis.2bis y 10-bis.3) dieron por cierto y no lo era
> (2026-09-24, implementación).** El resto del grupo (10-bis.6 a 10-bis.9) sigue sin implementar.
>
> 1. **La falsación de 10-bis.3 tiene una versión que no prueba nada, y es la primera que sale.** Devolverle a la
>    factory su condición propia por el camino obvio —que solo construya OpenRouter con modelo `:free`— hace caer el
>    test de no divergencia, sí, pero **también** un test que ya existía
>    (`byok-provider.factory.spec.ts > sets OpenRouter dataCollection deny only for :free models`), así que no
>    demuestra que el test nuevo ate nada que no estuviera atado. La falsación que sí lo demuestra es una divergencia
>    en un caso que ningún otro test cubre —la factory rechazando `anthropic` con `anthropicModel` vacío—: cae
>    **un solo** test, el nuevo, y con el mensaje que nombra el caso y el vendor
>    (`anthropic y openai sin modelo / anthropic: la factory y el predicado discrepan: expected false to be true`).
>    Se ejecutaron las dos.
> 2. **El predicado dice que `anthropic` y `openai` están siempre disponibles, y eso es correcto precisamente porque
>    es lo que la factory hace.** La tentación es añadirles «y que su modelo no esté vacío», que suena más prudente:
>    sería **inventar** una condición que el enrutado no aplica, es decir la divergencia que la tarea existe para
>    impedir, solo que en la dirección contraria. El caso está en la tabla del test.
> 3. **`strictObject` no da la garantía que pide 10-bis.2bis.** Impide que un campo **se cuele** sin declararlo, pero
>    no dice nada de un campo que alguien **declare** mañana. Lo que convierte «no se cuela» en «no se añade sin que
>    nadie lo vea» es la afirmación del conjunto exacto de claves del cuerpo. Y para falsarla hay que añadir el campo
>    **con `.default()`**: un campo obligatorio invalida la *entrada* de media suite y esos fallos son por otra causa,
>    mientras que con un default el campo aparece en la *salida* del parseo y caen exactamente las dos afirmaciones de
>    conjunto exacto (`expected [ 'chain', 'keys', 'vendors' ] to deeply equal [ 'keys', 'vendors' ]`).
> 4. **10-bis.2 predice la rotura del typecheck en los dos productores, y son tres errores en esos dos ficheros; pero
>    el mismo comando rompe además en `web`, y eso la tarea no lo dice.**
>    `profile.page.spec.ts:23` y `:29` construyen `AiKeyView` a mano y se quedan sin `available`. No es un defecto:
>    es trabajo de 10-bis.8, y conviene saberlo antes de correr el comando y creer que falta un productor.
> 5. **`api:test` pasa en verde con el contrato a medias, y eso es un agujero de cobertura que 10-bis.4 tiene que
>    cerrar.** Con `ListMyAiKeys` devolviendo un cuerpo **sin** `vendors`, los tests de `api` siguen en verde: ningún
>    test de `apps/api` pasa por `AiKeysController` ni por `listAiKeysResponseSchema.parse`, así que la validación de
>    respuesta del controlador —lo único que en ejecución impediría devolver un cuerpo fuera de contrato— **no la
>    ejercita nadie**. Lo único que detectó la rotura fue `tsc`.
> 6. **El contrato hace falta en `vendors` y en `keys`, y no es redundante.** `keys` lleva `available` por el PUT: la
>    respuesta del `PUT` es **una vista suelta**, no el listado, así que sin el campo en la vista la pantalla se
>    quedaría con el estado viejo justo después de guardar una clave y no habría dónde leerlo.

> **Lo que el SPA (10-bis.6 a 10-bis.9) dio por cierto y no lo era (2026-09-24, implementación).**
>
> 1. **Las cuatro frases del aviso salían pegadas en pantalla, y solo se vio al falsar.** El aviso se compone de
>    cuatro `<span>` con `i18n` —un id por frase, que es lo que permite exigir el **orden**—, y Angular compila
>    sin `preserveWhitespaces`: el espacio entre dos elementos desaparece. La salida de la falsación (a) lo enseñó
>    literalmente: `…configuración de esta instancia.Tu clave sigue guardada…`. Se arregla con `&ngsp;` entre los
>    `<span>` y se ata con una aserción del propio test (`/instancia. Tu clave/`), porque un test que solo mira
>    `toContainText` de cada frase **no ve** este defecto: las cuatro frases están, mal separadas.
> 2. **`nx run web:extract-i18n` no reproduce el orden del `messages.xlf` versionado.** Regenerarlo deja el mismo
>    conjunto de ids pero mueve **513 de 668** unidades (≈800 líneas de diff) sin cambiar ni un texto: el fichero del
>    repositorio está mantenido a mano y el extractor ordena por el grafo de chunks. Así que las cuatro unidades se
>    insertan **en su sitio** y lo que se comprueba contra el extractor es lo que 10-bis.7 pide de verdad: que los
>    **ids y los `source`** del fichero versionado coincidan **exactamente** con los que extrae Angular (comprobado:
>    668 → 672 unidades, las cuatro nuevas y ninguna otra diferencia). Regenerar el fichero entero habría metido en
>    este PR un churn que nada del change explica.
>
>    **Corrección del motivo (2026-09-25, QA).** Donde esto se haya resumido como «la extracción completa metía
>    unidades ajenas que **romperían** `translations.spec.ts`», es falso, y conviene decirlo porque es el mismo tipo
>    de justificación cómoda que el change persigue. Se ejecutó la extracción sobre el árbol de hoy
>    (`nx run web:extract-i18n` con `--outputPath` fuera del repositorio, para no pisar el catálogo versionado):
>    produce **exactamente los mismos 672 ids** que `messages.xlf`, conjunto idéntico, cero diferencias. Y
>    `translations.spec.ts` no mira lo que extrae Angular: compara el **conjunto de ids** de los dos catálogos entre
>    sí y exige `target` en cada unidad, así que **habría pasado igual**. Lo que la extracción produce de verdad es
>    **ruido**, todo ajeno a este change: unidades `discovery.*`/`links.*` en otro orden, líneas de
>    `<context-type="linenumber">` actualizadas y espacios en tres `source` (cifras en el párrafo siguiente). El
>    motivo correcto de editar el catálogo a mano es **evitar ruido no relacionado**, no una prueba que se rompería.
>
>    **Las cifras, que este párrafo mezclaba (corregido el 2026-09-25, tercer pase de QA).** Decía «de paso corrige
>    el tamaño: 513 de 668 → 38», como si fueran dos medidas de lo mismo. **Son dos métricas distintas**, y ninguna
>    corrige a la otra:
>    - **Unidades fuera de su posición** —las que en el fichero extraído no ocupan el mismo índice que en el
>      versionado—: es lo que medía el «**513 de 668**» del 2026-09-24. Hoy son **517 de 672**.
>    - **Unidades que cambian de orden relativo** —672 menos la subsecuencia común más larga de las dos secuencias de
>      ids, que es de 634—: **38** (23 `discovery.*` y 15 `links.*`). Una unidad que cambia de sitio desplaza el
>      índice de todas las que quedan entre su posición vieja y la nueva, y por eso la primera cifra es mucho mayor.
>    - **El tamaño del diff depende de la herramienta**, así que se dan las dos: `diff -u` (GNU diffutils 3.12) da
>      **1724** líneas, **798** de ellas `+`/`-`; `git diff --no-index` da **1735**, **810** `+`/`-` (417 inserciones,
>      393 borrados). En las dos, **356** de las líneas `+`/`-` son de `<context-type="linenumber">`.
>    - Y lo que el recuento anterior no decía: **3** `source` de `discovery.*` (`discovery.submit`,
>      `discovery.save.hint`, `discovery.destination.groupsError`) difieren del versionado **solo en espacios** al
>      principio y al final. El «cero diferencias» de arriba vale para el conjunto de ids, no para esos tres `source`.
>
>    Medido el 2026-09-25 sobre `f4d5342` con `nx run web:extract-i18n --outputPath=<scratchpad>` fuera del
>    repositorio (672 ids en los dos ficheros, conjunto idéntico) y comparando las dos secuencias de `trans-unit id`.
>    La conclusión no cambia —el churn no lo explica nada del change—, pero cada número dice ya qué mide.
> 3. **La falsación (c) de 10-bis.9 no puede hacer caer «los dos de componente», y no es un matiz.** Los tests de
>    componente hablan con `HttpTestingController`: no pasan por `ListMyAiKeys`. Fijar `available: true` en el caso
>    de uso hace caer el test de coherencia de 10-bis.4 (lado API) y **ningún** test de `web`. El equivalente del
>    lado del SPA —que el store ignore `vendors` y lo dé todo por disponible— es el que sí los ejercita, y es el que
>    se ejecutó: caen **tres** (el del aviso, el de «no es de todos» y el de la precedencia con el permiso apagado).
> 4. **Neutralizar `AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_MODEL` NO basta para fabricar el caso indisponible en el
>    smoke local, y la pasada parece verde igual.** El `.env` local de la máquina donde se corrió —no versionado:
>    `.gitignore:15` lo ignora— fijaba `BYOK_OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free`, que **no** es
>    el modelo de `.env.example` (`cohere/north-mini-code:free`, `:172`), y Nx lo inyecta **pisando** el valor por defecto
>    del código; exportar la variable vacía tampoco sirvió. Con solo la neutralización del código el smoke pasó en
>    verde **sin ejecutar la rama** (el vendor seguía disponible), que es justo la forma de falso verde que este
>    change persigue: lo que lo delata es que **no se escribe la captura** `perfil-byok-vendor-indisponible.png`. Hay
>    que **comentar además la línea de ese `.env` local**; entonces `api` arranca diciendo
>    `AI configuration warnings: BYOK_OPENROUTER_MODEL (unusable: BYOK vendor openrouter has no usable model: it is
>    not built and cannot be routed)` y la rama corre. Queda escrito en la cabecera del spec.
> 5. **La precedencia que la delta pide «vendor a vendor» cayó sobre un aviso que era de sección — y se partió aquí,
>    no en la fila 35.** El 2026-09-24 `profile-byok-consent-off` era un párrafo único para toda la sección, atado a
>    que hubiera al menos una clave de un vendor **no indisponible**: con una sola clave y su vendor caído el aviso
>    desaparecía —el caso que la delta nombra—, pero con una clave disponible y otra caída seguía hablando en plural
>    («Tienes claves guardadas…») y podía leerse como que incluía al vendor caído. Entonces quedó anotado como
>    diferido. **Cerrado el 2026-09-25 por `4dca9e3`, dentro de este mismo change:** el aviso vive ahora dentro del
>    bloque de cada vendor, con `data-testid` `profile-byok-consent-off-<vendor>`, `role="status"`, texto en singular
>    que nombra al proveedor e id de i18n **nuevo** `profile.byok.vendorKeyInactive` en ES y EN —`profile.byok.keysInactive`
>    se retira y un test exige su ausencia de los dos catálogos—. Cae con él `hasAnyUsableKey` del store, que solo
>    existía para el aviso de sección. Este punto se deja escrito, en vez de borrarse, porque lo que describe —una
>    precedencia por vendor implementada sobre un aviso que no lo era— sí ocurrió.
> 6. **Referencias del enunciado que ya no apuntan donde dicen.** `ai-keys.api.ts` vive en
>    `apps/web/src/app/core/ai-keys/`, no en `features/profile/`; el valor por defecto lo repone
>    `parse-ai-config.ts:563-564`, no `:525-527`; y en la plantilla el `@if (vendor === 'openrouter')` estaba en
>    `:293` y el comentario del «MVP: siempre» en `:224-227`.
> 7. **«Ningún aviso cableado a `vendor === 'openrouter'`» tiene un límite que conviene decir.** La condición salió
>    de la plantilla a un conjunto documentado del componente (`VENDORS_WITH_DATA_COLLECTION_CAVEAT`) y ahora se
>    combina con la disponibilidad que manda el API. Pero el `data-testid` que la propia tarea fija —
>    `profile-byok-openrouter-data-collection`— sigue nombrando al vendor, así que el día que otro proveedor gane la
>    salvedad habrá que darle su propio identificador.

> **10-bis.8 — el smoke de `web-e2e` ejecutado de verdad sobre la aserción que `4dca9e3` cambió (2026-09-25).**
> La evidencia que cerraba esta tarea era del **2026-09-24** y, por tanto, **anterior** a la línea que hoy afirma:
> `4dca9e3` movió `byok.spec.ts:135` de `profile-byok-consent-off` a `profile-byok-consent-off-openai`, y esa línea
> **nunca se había ejecutado** —`ci.yml` no tiene ningún target de Playwright ni de `e2e`; este smoke solo corre a
> mano—. Marcarla `[x]` sobre la corrida anterior era exactamente el fallo que este change persigue.
>
> 1. **Levantado.** `mongo`, `redis`, `minio` (más `meilisearch` y `mailpit`) del compose, ya `healthy`; `.env` del
>    repositorio sin tocar (`AI_CHAIN=mock`, `AI_MOCK_MODE=replay`); `pnpm nx serve api` aparte
>    (`playwright.config.mts` solo levanta `web`), con `GET /health` → `200 {"status":"up",…,"mongo":"up","redis":"up"}`;
>    y `nx serve web` arrancado por el propio `webServer` de Playwright. Comprobado **antes** de empezar que `3000` y
>    `4200` estaban libres: con un serve ajeno en pie se habría probado código viejo sin enterarse.
> 2. **La línea 135 corrió, y eso está medido, no supuesto.** El reporter de lista dice `ok`, pero **no nombra
>    ninguna aserción**: un verde de `1 passed` no distingue una línea ejecutada de una línea muerta. Se corrió con un
>    reporter que imprime cada step con su `location`, y la salida literal es:
>
>    ```
>    STEP byok.spec.ts:133:66 Click -> passed (38ms)
>    STEP byok.spec.ts:126:24 Wait for event "response" -> passed (54ms)
>    STEP byok.spec.ts:135:69 Expect "toBeVisible" -> passed (3ms)
>    STEP byok.spec.ts:136:14 Screenshot -> passed (129ms)
>      ok 1 [chromium] › apps\web-e2e\src\byok.spec.ts:45:5 › BYOK profile: notices, save OpenAI hint, consent-off copy (1.3s)
>
>      1 passed (10.7s)
>    ```
>
>    `135:69` es la columna del `expect(page.getByTestId('profile-byok-consent-off-openai')).toBeVisible(...)`. La
>    captura `reports/smoke/ai-byok/perfil-byok-consent-off.png`, que se escribe en la línea siguiente, quedó fechada
>    en esa corrida. **No se falsó** la aserción nueva editando el spec. Que el `data-testid` de sección
>    `profile-byok-consent-off` ya no exista en ningún sitio —`grep -rn` sobre `apps/web/src` y `apps/web-e2e/src`
>    solo devuelve la forma por vendor— demuestra que la aserción **anterior** habría caído; **no** demuestra que la
>    **nueva** pueda caer. Esa capacidad de fallo queda sin ejercitar en el e2e; las condiciones del aviso las fijan
>    los tests de componente de `profile.page.spec.ts`, no esta corrida. (Corregido el 2026-09-25 tras el tercer pase
>    de QA, que señaló que el razonamiento original no se seguía.)
> 3. **Lo que esta corrida NO cubrió, y que ya está cubierto por la pasada del punto 6.** Los tres vendors son
>    construibles con el `.env` local —no versionado (`.gitignore:15`) y con un modelo distinto al de `.env.example`—, así que en esta corrida el bloque final —el del vendor indisponible—
>    se saltó: los steps saltan de `136` a `187` y **no** se escribe `perfil-byok-vendor-indisponible.png`, que es
>    justo la señal que el punto 4 de arriba describe. Aquí se remitía ese lado a la corrida del 2026-09-24; **esa
>    salvedad queda retirada**: la pasada del punto 6, del mismo día y sobre el spec de hoy, ejecuta ese bloque con la
>    neutralización completa y con la aserción que le faltaba.
> 4. **`pnpm nx serve api` no arranca en esta máquina si `dist/apps/api/node_modules` existe, y el mensaje no lo dice.**
>    Webpack compila (`webpack compiled successfully`) y acto seguido Nx falla al cachear el target con
>    `A required privilege is not held by the client. (os error 1314)` —el privilegio de crear symlinks en Windows—,
>    porque ese directorio, que sobra de un `api:prune` anterior, tiene **708** enlaces simbólicos dentro de los
>    `outputs` del build. Se apartó para la corrida y se dejó **restaurado** al terminar (708 enlaces, verificados).
>    No es un defecto de este change, pero quien corra el smoke se lo encuentra y el error no menciona ni a `dist/`
>    ni a los symlinks. **Apartarlo renombrándolo dentro de `dist/apps/api/` no basta**: en la pasada del punto 6 el
>    primer intento, como `dist/apps/api/node_modules.aside`, falló igual con `os error 1314`, porque sigue dentro
>    de los `outputs`. Hay que sacarlo **fuera de `dist/`** —se movió a `D:/projects/linkvault-api-node_modules.aside`,
>    en el mismo disco para que `mv` renombre y no copie los enlaces— y devolverlo al terminar.
> 5. **Apagado.** Se mató solo el árbol de procesos propio (`taskkill /T` desde el `sh` que arrancó `nx serve api`);
>    el `nx serve web` lo cerró Playwright, que lo había levantado. `3000` y `4200`, libres al terminar.
> 6. **Pasada del vendor indisponible con la receta corregida (2026-09-25, QA: un P1 y el P2-6).**
>
>    **Lo que QA encontró.** La cabecera de `byok.spec.ts` daba una receta de tres pasos que **omitía el que la hace
>    funcionar**: comentar la línea `BYOK_OPENROUTER_MODEL` del `.env` local. El punto 4 de la nota del SPA decía
>    «Queda escrito en la cabecera del spec» y no lo estaba, así que quien siguiera la receta obtenía `1 passed` con
>    la rama saltada —el falso verde que ese mismo punto describe—, con esta tarea ya marcada `[x]`. Y el bloque del
>    vendor indisponible, que corre justo en el escenario de `4dca9e3` —permiso apagado y clave guardada de ese
>    vendor—, **no afirmaba** que faltase `profile-byok-consent-off-<vendor>`: solo lo cubrían los tests de componente.
>
>    **Lo que se cambió en el spec.** La cabecera nombra ahora las **dos** fuentes que reponen un modelo utilizable
>    (el valor por defecto del código y el `.env` local), da la receta en cinco pasos —neutralizar el código,
>    comentar la línea del `.env`, arrancar la `api` y **no seguir** si su arranque no trae el aviso de
>    configuración, borrar la captura y correr, restaurar los dos— y un apartado «CÓMO DISTINGUIR LA RAMA EJECUTADA DE
>    LA SALTADA» con las dos señales: el aviso en el arranque de la `api` **y** la captura
>    `perfil-byok-vendor-indisponible.png` escrita en esa corrida; si falta cualquiera, la pasada no se ha hecho,
>    diga lo que diga el reporter. En el bloque se añade un `toHaveCount(0)` sobre
>    `profile-byok-consent-off-${down.vendor}`, precedido de un `toBeVisible()` sobre `profile-byok-consent-off-openai`:
>    sin él, la ausencia también se cumpliría si el aviso dejara de pintarse por cualquier otra causa (permiso
>    encendido, sección sin renderizar).
>
>    **Ejecutada la receta tal como queda escrita.** `3000` y `4200` libres antes de empezar; `.env` copiado byte a
>    byte al scratchpad; `dist/apps/api/node_modules` apartado fuera de `dist/` (punto 4);
>    `AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_MODEL` a `''`; la línea del `.env` comentada; la captura borrada. La `api`
>    arrancó diciendo, literal:
>
>    ```
>    [api] AI configuration warnings: BYOK_OPENROUTER_MODEL (unusable: BYOK vendor openrouter has no usable model: it is not built and cannot be routed)
>    ```
>
>    y `GET /health` → `{"status":"up",…,"mongo":{"status":"up"},"redis":{"status":"up"}}`. El smoke, con un reporter
>    que imprime cada step con su `file:line:col` (y el de lista detrás), dio en la parte que lee el cuerpo del API y
>    en todo lo que sigue al apagado del permiso, literal (el `…` marca los steps del alta de la clave de OpenAI):
>
>    ```
>    STEP byok.spec.ts:99:93 anthropic es construible y no puede decir que no lo está -> passed (2ms)
>    STEP byok.spec.ts:96:74 Expect "toBeVisible" -> passed (1ms)
>    STEP byok.spec.ts:99:93 openai es construible y no puede decir que no lo está -> passed (1ms)
>    STEP byok.spec.ts:96:74 Expect "toBeVisible" -> passed (1ms)
>    STEP byok.spec.ts:101:84 openrouter no es construible y tiene que decirlo -> passed (2ms)
>    STEP byok.spec.ts:115:7 OpenRouter no es construible: ese aviso afirmaría un envío que no va a ocurrir -> passed (1ms)
>    …
>    STEP byok.spec.ts:155:66 Click -> passed (44ms)
>    STEP byok.spec.ts:148:24 Wait for event "response" -> passed (56ms)
>    STEP byok.spec.ts:157:69 Expect "toBeVisible" -> passed (3ms)
>    STEP byok.spec.ts:158:14 Screenshot -> passed (135ms)
>    STEP byok.spec.ts:174:26 Expect "toBeVisible" -> passed (2ms)
>    STEP byok.spec.ts:175:26 Expect "toHaveAttribute" -> passed (2ms)
>    STEP byok.spec.ts:176:26 Expect "toContainText" -> passed (3ms)
>    STEP byok.spec.ts:177:26 Expect "toContainText" -> passed (2ms)
>    STEP byok.spec.ts:178:26 Expect "toContainText" -> passed (2ms)
>    STEP byok.spec.ts:179:26 Expect "toContainText" -> passed (2ms)
>    STEP byok.spec.ts:180:79 Expect "toHaveCount" -> passed (1ms)
>    STEP byok.spec.ts:190:63 Fill "sk-smoke-down-key-123456" -> passed (5ms)
>    STEP byok.spec.ts:191:64 Click -> passed (40ms)
>    STEP byok.spec.ts:183:27 Wait for event "response" -> passed (59ms)
>    STEP byok.spec.ts:194:74 Expect "toContainText" -> passed (29ms)
>    STEP byok.spec.ts:198:72 Expect "toContainText" -> passed (2ms)
>    STEP byok.spec.ts:201:26 Expect "toBeVisible" -> passed (1ms)
>    STEP byok.spec.ts:202:79 Expect "toHaveCount" -> passed (1ms)
>    STEP byok.spec.ts:206:71 Expect "toBeVisible" -> passed (1ms)
>    STEP byok.spec.ts:210:7 openrouter no es construible: su clave no se usaría ni con el permiso encendido -> passed (1ms)
>    STEP byok.spec.ts:211:16 Screenshot -> passed (112ms)
>    STEP byok.spec.ts:217:22 Expect "toEqual" -> passed (0ms)
>    TEST BYOK profile: notices, save OpenAI hint, consent-off copy -> passed
>      ok 1 [chromium] › apps\web-e2e\src\byok.spec.ts:67:5 › BYOK profile: notices, save OpenAI hint, consent-off copy (2.1s)
>      1 passed (14.1s)
>    ```
>
>    Los números de línea son los del spec **con la cabecera ampliada**: la aserción del punto 2 (`135:69` entonces) es
>    ahora `157:69`, y corrió también. `174`–`180` son el aviso de indisponibilidad con sus cuatro contenidos y la
>    ausencia de la nota de `data_collection`; `194` y `198`, la clave del vendor caído anunciada como «Configurada»
>    con su `keyHint`; `206:71` es el `toBeVisible` de OpenAI y **`210:7` es la aserción nueva** —el reporter la nombra
>    por su mensaje, porque lo lleva—. Los steps ya no saltan del final del bloque del permiso a `217`: la rama
>    corrió. Y la segunda señal: `reports/smoke/ai-byok/perfil-byok-vendor-indisponible.png`, borrada antes de la
>    corrida, quedó **escrita** por ella (2026-09-25 13:47:19, 176 647 bytes).
>
>    **Restauración.** `git diff --exit-code libs/ai/src/infrastructure/config/ai-config.schema.ts` vacío y el mismo
>    md5 que antes de tocarlo. El `.env` tenía una trampa que conviene dejar escrita: **`sed -i` de Git Bash le quitó
>    los `\r` a todo el fichero** —las mismas 176 líneas, otros bytes, y `git` no lo iba a delatar porque el fichero
>    está ignorado—; se repuso la copia byte a byte tomada antes de tocarlo y `cmp` la da idéntica (md5 `2c30bc47…`
>    antes y después). Quien automatice la receta ha de restaurar el `.env` **desde copia**, no deshaciendo la
>    edición. `dist/apps/api/node_modules` devuelto a su sitio con sus **708** enlaces. Apagado solo el árbol propio
>    (`taskkill /T` desde el `sh` que arrancó `nx serve api`); `nx serve web` lo cerró Playwright; `3000` y `4200`
>    libres al terminar.
>
>    **Lo que esta pasada NO hace.** No se falseó la aserción nueva en el smoke —no se forzó el aviso de clave
>    inactiva para el vendor caído para verla caer—. Que pueda fallar descansa hoy en el `toBeVisible` de OpenAI que
>    la precede (el aviso sí se pinta en esa pantalla, para el vendor disponible) y en la falsación del lado del SPA
>    de 10-bis.9, que hace caer el test de componente de la precedencia con el permiso apagado.

> **Lo que la API y los consumidores (10-bis.4 y 10-bis.5) dieron por cierto y no lo era (2026-09-24,
> implementación).**
>
> 1. **Los unitarios que pide 10-bis.4 no cierran el agujero que el propio fichero describe en su punto 5, y hay que
>    ampliar el enunciado para cerrarlo.** La tarea se verifica «con unitarios en `ai-keys.usecase.spec.ts`», que
>    construyen los casos de uso a mano y **no pasan por el controlador**: con ellos en verde, la validación de
>    respuesta seguiría sin ejercitarse y un cuerpo fuera de contrato solo lo cazaría `tsc`. Se añade
>    `apps/api/src/modules/users/presentation/ai-keys.controller.spec.ts`, cableado por Nest (sin Mongo ni HTTP),
>    que además comprueba que los casos de uso siguen siendo **construibles por DI** con el token nuevo. Sus dos
>    casos de negación —el caso de uso devolviendo el cuerpo de antes de 10-bis.2, y una cobertura de `vendors` a
>    medias— hacen que el controlador **rechace** con `ZodError`, que es lo que en ejecución impide responderlo.
> 2. **El `PUT` no estaba validado, y la cabecera de `AiKeysController` decía que sí.** La clase promete
>    «respuestas validadas contra el contrato de `@linkvault/shared`» y solo el `GET` llamaba a `parse`; el `PUT`
>    devolvía la vista tal cual. Es la misma vista suelta a la que 10-bis.2 (§6 de la nota anterior) le añade
>    `available` y la que el SPA lee justo después de guardar una clave, y el conjunto cerrado de
>    `ai/data-protection` le aplica igual. Se añade `aiKeyViewSchema.parse` en el `PUT`: una afirmación de la
>    cabecera que era falsa, del tamaño de una línea.
> 3. **El mapa de disponibilidad se escribe como literal de `Record<AiVendor, boolean>` a propósito.** Derivarlo de
>    `AI_VENDORS` con un `Map` obliga a un `?? false` o a un cast para el `get` que TypeScript no puede descartar, y
>    ese `?? false` es un estado **inventado** para un vendor que no estuviera en el mapa. Con el literal, añadir un
>    vendor a `AI_VENDORS` rompe el typecheck en el productor en vez de devolver «indisponible» en silencio.
> 4. **10-bis.5 exige que los tres consumidores no repitan el predicado, y eso ningún test de comportamiento lo ve.**
>    Mientras la copia responda lo mismo que el original, todos los escenarios siguen en verde: la divergencia
>    aparece el día que una de las dos cambie, que es cuando ya es tarde. Se añade una comprobación sobre el
>    **fuente** de los dos consumidores de `libs/ai` (`run-task.usecase.ts` y `provider-eligibility.ts`), que cae si
>    nombran `openrouterModel`, `isOpenRouterModelUsable`, `isByokVendorConfigUsable` o `:free`. Es un grep y cae
>    también si la palabra sale en un comentario; se acepta el falso positivo. El tercer consumidor,
>    `isDegradedReasonCurrent` (`apps/api/.../match/domain/degraded-reason-vigencia.ts`), no necesita la
>    comprobación: es una función pura que solo recibe `hasEligibleByok` y no tiene de dónde sacar el modelo.
> 5. **La herencia hay que probarla con la factory real; con un `providersFor` de mentira el test no prueba nada.**
>    Un stub que devuelva «los vendors utilizables» estaría afirmando la premisa. Los tests usan
>    `ByokProviderFactory` con su vault y su repositorio en memoria, y solo sustituyen **los objetos construidos**
>    por fakes con el mismo id y las mismas capacidades, para no hablar por red: quién entra en el universo lo sigue
>    decidiendo la factory. La falsación lo confirma —quitándole a la factory la llamada al predicado caen los tres
>    escenarios— y el primero cae de la forma que da sentido a la delta: con la cuota agotada y OpenRouter sin
>    modelo, el resultado pasa de `quota_exceeded` a **`success` por ese mismo proveedor**, es decir el envío con
>    `dataCollection: 'omit'` que 10.9 cierra, no un `no_providers`.
> 6. **`api:test` no salió flaky en esta corrida.** `pnpm nx run-many -t lint,typecheck,test -p api ai
>    --skip-nx-cache` terminó en verde a la primera (6/6 tareas, 1 m 11 s), sin que Nx marcara ninguna tarea como
>    flaky. Se anota porque la nota del grupo anterior avisa de lo contrario y conviene saber que no es sistemático.

## 11. Que las comprobaciones lleguen a ejecutarse en todas partes

- [x] 11.1 [infra] Comprobar que los targets creados por los grupos 4 y 10 declaran los `inputs` que de verdad leen (`{workspaceRoot}/.env.example`, `{workspaceRoot}/docker-compose.prod.yml`, `{workspaceRoot}/docs/RUNBOOK.md`, los dos esquemas de configuración, los ficheros de `apps/**` del registro y el propio registro de afirmaciones); verificar con `pnpm nx show project repo-checks --json` redirigido a un archivo que salen como se escribieron, porque de esos `inputs` depende que Nx no restaure un verde cacheado.
- [x] 11.2 [infra] Añadir a `sharedGlobals` de `nx.json` **solo** `.env.example` y `docker-compose.prod.yml` —hoy la lista tiene `nx.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.nvmrc`, `package.json` y `pnpm-lock.yaml`— y dejar escrito por qué **no** entra `docs/**`: invalidaría la caché de **todos** los proyectos en cada commit de documentación, que en este repositorio es casi cada commit; la documentación queda cubierta por los `inputs` explícitos de 11.1 más el paso incondicional de 3.2. Verificar que un commit que solo toca `.env.example` hace que `pnpm nx show projects --affected` liste `repo-checks`.
- [x] 11.3 [infra] **La prueba espejo**, que es el PR donde esto importa: con un commit que solo toca `apps/api/src/infrastructure/config/api-config.schema.ts` añadiendo una obligatoria nueva, verificar que la comprobación del compose **se ejecuta** (paso incondicional) y **falla** nombrándola, y que Nx no dice que recupera la caché; si la restaurara, los `inputs` de 11.1 están mal. Restaurar el esquema después.
- [x] 11.4 [infra] Comprobar lo mismo con la documentación: un commit que solo toca `docs/RUNBOOK.md` hace que la comprobación de afirmaciones se ejecute de verdad; verificar leyendo la salida de Nx en la corrida (no puede decir que recupera la caché).
- [x] 11.5 [infra] Llevar el paso incondicional de 3.2 también a `cd-staging.yml` y `cd-prod.yml`, **escribiéndolo en los tres workflows** (no hay workflow reutilizable en este change: su extracción sale del alcance, ver el grupo 9); dejar en el YAML una nota de que los tres bloques son el mismo y han de cambiarse a la vez hasta que la fila 35 cierre la extracción. Verificar con una corrida real de `cd-staging` en la rama que el paso aparece y pasa, y comparando los tres bloques lado a lado.

> **11.5 verificada con corrida real (2026-09-24).** En `36064994390` (`cd-staging`, rama) el step `Repo checks` del
> job `verify` corre **antes** del cálculo de afectación y pasa: `=== Comprobaciones de repositorio
> (tools/repo-checks), paso incondicional`, `repo-checks: 5 comprobaciones ejecutadas (check-claims-registry,
> check-compose-env-contract, check-compose-healthchecks, check-docs-stack-up, check-stale-defaults)` y
> `ok: 5 comprobaciones de repositorio ejecutadas`. El mismo step corre y pasa en `36068228388` (`cd-prod`).
> Comparados los tres bloques lado a lado: `ci.yml:71-80`, `cd-staging.yml:86-95` y `cd-prod.yml:158-169` llevan el
> **mismo** comentario de 11.5 y el **mismo** step (`cd-prod` añade dos líneas de comentario propias explicando por
> qué no basta con que corra en `ci.yml`).

> **Lo que el grupo 11 dio por cierto y no lo era (2026-09-24, implementación).**
>
> 1. **Las comprobaciones NO nacían muertas por lo que 11.2 dice, y se comprobó ejecutando las dos configuraciones.**
>    11.2 da por hecho que sin `.env.example` ni el compose en `sharedGlobals` un commit que solo los tocara no
>    marcaría ningún proyecto como afectado y Nx restauraría un verde cacheado. Medido con Nx 23.2.1, **quitando la
>    adición** y con un commit real que solo toca `.env.example` y `docker-compose.prod.yml`:
>    `pnpm nx show projects --affected` devuelve igualmente `["repo-checks"]`, y en la corrida siguiente
>    `check-stale-defaults` **se vuelve a ejecutar** mientras las otras tres salen de la caché. La razón es que Nx
>    deriva los proyectos tocados también de los **globs `{workspaceRoot}` de los `inputs` de los targets**, y los
>    de `tools/repo-checks` (tarea 11.1) nombran los dos ficheros. Lo que las mantenía vivas eran, ya, los
>    `inputs` explícitos. La adición se hace igual —es la decisión tomada— pero por lo que sí aporta: los dos
>    ficheros entran en la clave de caché de **todos** los proyectos (de `["repo-checks"]` a los 11), así que
>    ningún consumidor futuro puede leerlos y quedarse cacheado por olvidar declararlos. El motivo escrito en
>    `nx.json` es ese y no el de la tarea.
> 2. **Los `inputs` de `check-claims-registry` sí estaban mal, y por eso 11.1 no era una comprobación de trámite.**
>    Declaraban `docs/**/*.md`, `apps/**/*.ts` y `libs/**/*.ts`; el alcance declarado en `claims.registry.mjs`
>    es el producto de sus `roots` (docs, apps, libs) por sus `extensions` (`.md`, `.ts`, `.html`). Contados
>    ejecutando el mismo recorrido del check: lee **1554** ficheros y los `inputs` cubrían **1508**. Los **46**
>    restantes —40 plantillas `apps/**/*.html` y 6 `libs/**/*.md`— se leían pero **no cambiaban el hash**: una
>    afirmación desmentida escrita en una plantilla de Angular o en un README de `libs/` habría salido en verde
>    desde la caché. Ahora van los nueve globs del producto, incluidos los que hoy no casan con nada.
> 3. **Faltaba un guardia, y lo descubrió el propio grupo: el agregador no puede ser cacheable.** El guardia de 3.2
>    lee del log la línea `repo-checks: N comprobaciones ejecutadas`. Si `targets.check` llevara `cache: true`,
>    Nx **reproduce esa línea desde la caché** sin ejecutar nada y el guardia daría verde sobre un verde restaurado
>    — la misma avería que este grupo cierra en `nx.json`, un piso más arriba. Se añade la comprobación de que
>    `check.cache === false` y se falsa poniéndolo a `true`:
>    `[FAIL] el agregador de repo-checks no es ejecutable de forma fiable`.
> 4. **El cuerpo del paso incondicional se extrae a `infra/ci/repo-checks.sh`, y 11.5 pedía copiarlo tres veces.**
>    La tarea manda escribir el bloque en los tres workflows con una nota de que han de cambiarse a la vez. Se hace
>    al revés y a propósito: un cuerpo copiado en tres YAML **no se puede ejecutar fuera de Actions** —y este change
>    entero trata de no afirmar sin ejecutar—, y tres copias con una nota es exactamente la forma en la que un
>    guardia deja de estar en uno de los tres sin que nadie se entere. Lo prohibido por 11.5 es el **workflow
>    reutilizable** (extracción de la fila 35), no un script, que es además la forma que ya usan los grupos 5 a 8
>    (`assert-semver-tag.sh`, `assert-release-projects.sh`, `verify-artifact.sh`…). Lo que queda duplicado es la
>    invocación de cuatro líneas, comparada lado a lado: **idéntica** en los tres (en `cd-prod` con dos líneas más
>    de comentario, porque un release se lanza sobre un tag y no pasa por el CI de la rama).
> 5. **De paso, el paso de `ci.yml` era la única excepción a la norma de no entubar `nx`.** Hacía
>    `pnpm nx run repo-checks:check 2>&1 | tee repo-checks.log`, mientras `assert-release-projects.sh` documenta
>    que la salida de `nx` se redirige a fichero y nunca se entuba. El script redirige y lee el fichero.
> 6. **El mensaje de fallo de la comprobación del compose (grupo 4) tenía un verbo de menos, y solo se ve al hacerlo
>    fallar.** La prueba espejo de 11.3 lo sacó: `… le falta la variable obligatoria 'AUDIT_SINK_URL', que
>    apps/api/…/api-config.schema.ts al arrancar el proceso`. Corregido a `…, que **exige**
>    apps/api/…/api-config.schema.ts al arrancar el proceso`.
>
> **Lo que queda sin verificar y por qué.** 11.5 exige además una **corrida real de `cd-staging`** en la rama para
> ver el paso aparecer y pasar. La rama no está publicada y el token local no tiene `write:packages` (mismo motivo
> que 6.3–6.6 y que 7.1–7.8), así que queda sin marcar. Lo que **sí** se ejecutó: el script entero en local sobre el
> repositorio real, sus dos guardias falsados uno a uno, el parseo de los tres workflows y la comparación literal de
> los tres bloques.

## 12. La documentación operativa deja de describir la regla vieja

- [x] 12.1 [infra] `infra/README.md:20` afirma la regla que este change revoca ("sin ellos el job de deploy **falla** (no hay dry-run de aceptación)") y `:127` la repite ("Dry-run **no** cuenta como despliegue exitoso. Secrets requeridos…"): reescribir con los tres resultados, quién los decide (el `preflight`) y que `partial` sí falla; verificar leyéndolo contra ADR-048 §3, para que el change no cree una mentira documental nueva del tipo que dice erradicar.
- [x] 12.2 [infra] Añadir a `infra/README.md` el orden **construir → verificar → publicar** en un solo job, por qué no se parte (la imagen cargada vive solo en ese corredor), por qué no puede haber una segunda construcción para publicar (6.1) y qué hace la verificación del artefacto (pila de `docker-compose.prod.yml`, mongo como replica set, sin Traefik ni certificados, sin publicar puertos), más la advertencia de que `IMAGE_TAG` vale `latest` por defecto y lo que eso implica al publicar tags flotantes; verificar que lo escrito coincide con los workflows ya modificados.
- [x] 12.3 [infra] **Nadie puede levantar esto hoy**: se demuestra en CI que la pila arranca y no hay ningún camino escrito para que una persona la levante. Documentar en `infra/README.md` **el mismo `up` que ejecuta CI** —`--env-file` partiendo de `.env.example`, secreto de sesión generado con un comando concreto, selección de servicios sin Traefik, `--wait` con el plazo justificado de 5.7, `exec` para mirar los healthchecks porque la red es interna— y qué se obtiene al final (los tres healthchecks en verde y cómo mirarlos). **Verificación ejecutable en el corredor**, porque "seguirlo desde cero en una máquina limpia" no es comprobable en un PR: una comprobación de `tools/repo-checks` que exija que el bloque de comandos documentado y el que ejecuta el workflow coinciden en fichero de compose, selección de servicios y flags (`--wait`, `--wait-timeout`, `--pull never` donde aplique), de modo que no puedan divergir en silencio; y, si el presupuesto del job lo permite, ejecutar una vez el bloque documentado tal cual en el corredor.
- [x] 12.4 [infra] Actualizar las cabeceras de los dos workflows: `cd-staging.yml:1-2` ("Secrets obligatorios; si faltan, el job de deploy falla") y `cd-prod.yml:1-2` ("Dry-run NO cuenta como éxito"); verificar que describen el mecanismo real y citan ADR-048 además de ADR-033.
- [x] 12.5 [infra] Completar el contrato de variables de `infra/README.md` con lo que los esquemas exigen de verdad (las cuatro nuevas de `api`, las tres de `worker`, las condicionales de `MAIL_*` en los dos procesos tras 4.4, `S3_BUCKET`, `AI_VAULT_KEY` como base64 de 32 bytes) y dejar explícito que en producción `AI_CHAIN` **no** puede incluir `mock`; verificar la lista contra `api-config.schema.ts`, `worker-config.schema.ts` y `parse-ai-config.ts`, no contra la memoria.
- [x] 12.6 [infra] El correo pasa a ser obligatorio (4.3) y hoy el README solo nombra Resend con dominio verificado, así que el primer operador no podría completar ni un alta: nombrar en el contrato **al menos una opción que funcione sin cuenta de pago** —SMTP contra un servidor que el operador ya tenga, o el nivel gratuito de Resend con sus límites escritos— y decir **qué queda inutilizable** si no se configura (verificación de cuenta y recuperación de contraseña, con el procedimiento de operador del RUNBOOK Paso 6 duodecies como salida); verificar que un lector sin cuenta de correo de pago encuentra un camino completo hasta el alta.
- [x] 12.7 [infra] Documentar en `infra/README.md` las alternativas de despliegue **sin presentarlas como soportadas**: una línea que diga que el camino canónico es compose+Traefik y que Fly, Railway, Render, k3s+Helm, Cloud Run y el VPS genérico no están soportados en este change; verificar que no se añade ningún manifiesto Helm ni config de esos hosts como entregable, que la spec prohíbe expresamente.
- [x] 12.8 [infra] Documentar en `docs/RUNBOOK.md` los dos workflows de CD, que hoy **no se mencionan en ningún sitio** —lo que contribuyó a que nadie mirara veintiún fallos—: qué hace cada uno, cómo se lee cada uno de los tres resultados **desde la lista de checks del commit**, dónde se ve la verificación del artefacto y qué hay que configurar para que llegue a desplegar; verificar con una búsqueda de `cd-staging` y `cd-prod` sobre el fichero.

> **Lo que el grupo 12 dio por cierto y no lo era (2026-09-24, implementación).**
>
> 1. **La premisa de 12.6 es falsa: sin correo el alta SÍ se completa.** 12.6 dice que «el primer operador no podría
>    completar ni un alta». Leído el código en vez de suponerlo: `Register`
>    (`apps/api/src/modules/auth/application/register.usecase.ts`) **captura** el fallo del envío, registra un warning
>    y devuelve `201`; y el login **no** gatea por `emailVerified` (ADR-034 D3, con test:
>    `login.usecase.spec.ts:71-72`, «createWithPassword deja emailVerified=false; el login no gatea»). Nadie se queda
>    fuera por no tener correo. Lo que **sí** queda inutilizable es otra cosa, y es lo que el README dice ahora: la
>    **verificación de la cuenta** (banner permanente, y el reenvío tampoco llega), la **recuperación de contraseña
>    por autoservicio**, y —esto no estaba en el enunciado— **todas las notificaciones por email**, que solo se envían
>    a cuentas con `emailVerified = true` (`notifications/dispatch` y el digest semanal de grupo). Escribir la premisa
>    tal cual habría metido en el README una afirmación falsa dentro del apartado que existe para no tenerlas.
> 2. **La opción «SMTP contra un servidor que el operador ya tenga» casi nunca vale, y es una carencia del
>    adaptador.** `SmtpMailer` (`apps/api/src/infrastructure/mail/smtp-mailer.ts`) construye el transporte **sin
>    bloque `auth`**, con `secure: false`, y **no existen `MAIL_SMTP_USER` ni `MAIL_SMTP_PASSWORD`** en ninguno de los
>    dos esquemas de configuración (comprobado por patrón sobre los dos ficheros). Es decir: sirve para un relay que
>    autorice **por red o por IP** —un MTA en el propio host, el relay de la red— y **no** para una submission con
>    usuario y contraseña en el 587 (Gmail, Fastmail, el SMTP de Mailgun). Va al README como limitación con su causa,
>    no como un camino que funciona. Los topes del nivel gratuito de Resend **no se copian** al repositorio: son
>    números de un tercero que envejecen solos, justo la forma de afirmación que ADR-048 §5 persigue; se remite a su
>    página de precios y se escribe lo que sí es estructural (clave obligatoria, dominio a verificar, y hasta
>    entonces solo se entrega a la dirección de la propia cuenta).
> 3. **El par que 12.3 mandaba comparar ya no existe.** 12.3 planeaba atar «el bloque documentado» con «el del
>    workflow», y el grupo 11 movió la verificación a `infra/ci/verify-artifact.sh`: comparar contra el YAML no diría
>    nada, porque el YAML solo invoca el script. El par comparable es **README ↔ script**, y así está escrito
>    `tools/repo-checks/src/docs-stack-up.check.mjs`. De paso, el «`--pull never` donde aplique» **aplica**: el camino
>    a mano construye las imágenes en el daemon, así que una descarga silenciosa de GHCR arrancaría una versión
>    anterior haciéndose pasar por la recién construida — exactamente el motivo de 5.1.
> 4. **De 12.1, 12.2 y 12.4 quedaba vivo mucho menos de lo que el enunciado describe.** El grupo 8 ya había corregido
>    `infra/README.md:20` y las cabeceras de los dos workflows. Comprobado por patrón sobre los cuatro ficheros
>    operativos (los dos workflows, el README y el RUNBOOK): lo único que seguía **afirmando** la regla revocada era
>    **una línea**, `infra/README.md:172` («Dry-run **no** cuenta como despliegue exitoso. Secrets requeridos…»), que
>    además mezclaba lo que ADR-048 §3 mantiene con lo que revoca. Las otras dos apariciones del texto viejo están
>    citadas **como revocadas** y se comprobó una a una que lo están.
> 5. **Traefik es el único servicio con puertos publicados, y por eso el camino documentado termina sin URL.** Medido
>    sobre `docker compose config` del fichero de producción: `api`, `worker`, `web`, `mongo`, `redis` y `minio`
>    resuelven `ports = null`; `traefik` publica 80 y 443. El procedimiento de 12.3 deja **seis servicios sanos y
>    ninguna página que abrir**, y decirlo es la mitad del entregable: sin esa frase, el primero que lo siga buscará
>    un `localhost:puerto` que no existe y concluirá que el arranque falló. El README remite al README raíz para
>    desarrollar y a la fila 35 para un destino usable.
> 6. **El contrato de variables se contó, no se recordó.** El README anterior mezclaba obligatorias, opcionales y
>    cosas que el compose ya fija. Lo que de verdad aborta el `up` son **trece** variables, extraídas recorriendo el
>    compose en busca de `${VAR:?}`: `PUBLIC_HOST`, `ACME_EMAIL`, `PUBLIC_PAGE_BASE_URL`, `WEB_BASE_URL`,
>    `AUTH_JWT_SECRET`, `AI_CHAIN`, `AI_VAULT_KEY`, `MAIL_PROVIDER`, `MAIL_FROM`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
>    `MINIO_KMS_SECRET_KEY` y `ENRICH_USER_AGENT`. Las 30 obligatorias por proceso siguen estando, y el README remite
>    a `inventarios.md` en vez de repetir la lista y dejarla envejecer en dos sitios.
> 7. **Que anexar al final de `.env.example` baste no era evidente, y se comprobó ejecutando.** El procedimiento
>    documentado hace `cp .env.example .env.local-stack` y **añade** las líneas que faltan o hay que cambiar; funciona
>    porque `--env-file` rellena un mapa y **la última definición de cada clave gana**. Medido con `config`:
>    `.env.example` trae `AI_CHAIN=mock` —prohibido con el `NODE_ENV=production` de las imágenes— y el compose
>    resuelve `AI_CHAIN: none`, y `AUTH_JWT_SECRET` resuelve al generado y no al del ejemplo. Si no ganara la última,
>    el procedimiento arrancaría una pila que aborta.
>
> **Lo que se ejecutó, con su salida.** El bloque documentado se **extrajo del propio README** y se ejecutó tal cual
> (Docker 29.8.0): los tres `docker build` en 0, el `config` en 0, y el
> `up -d --wait --wait-timeout 360 --pull never mongo redis minio api worker web` terminando en **0** con los seis
> contenedores `Healthy`. Después, el bloque de comprobación, también extraído del README: `api` y `worker`
> `200 {"status":"up",…,"checks":{"mongo":{"status":"up"},"redis":{"status":"up"}}}` y
> `ok: web sirve el documento del SPA`; y el `down -v` documentado, en 0. La comprobación nueva
> (`check-docs-stack-up`) se falsó **ocho veces, por los dos lados**: quitando `web` del bloque documentado, cambiando
> su plazo a 120, quitándole `--pull never`, apuntándolo a `infra/ci/verify.env`, borrando la marca, y —en el
> script— metiendo `traefik` en `SERVICES`, cambiando `COMPOSE_FILE` y bajando el plazo por defecto a 240. Las ocho
> salieron ≠0 nombrando la diferencia; restaurado, vuelve a 0. El agregador pasa de cuatro a **cinco** comprobaciones
> (`repo-checks: 5 comprobaciones ejecutadas`) y el guardia de `infra/ci/repo-checks.sh` sigue leyendo esa línea
> (`ok: 5 comprobaciones de repositorio ejecutadas`).
>
> **Lo que NO se hace, y por qué.** La mitad condicional de 12.3 —«si el presupuesto del job lo permite, ejecutar una
> vez el bloque documentado tal cual en el corredor»— **no** se añade a los workflows. Duplicaría en cada corrida de
> CD el arranque de la pila entera (el paso que ya existe tarda minutos) por un único delta frente a lo que la
> verificación ya hace: **construir el env file desde `.env.example`**. Ese delta se ejecutó aquí, con las salidas de
> arriba, y lo que impide que el bloque se pudra es la comprobación estática, que sí corre en cada corrida.

## 13. Cierre

- [x] 13.1 [infra] Cerrar Q1 y Q2 de `design.md` **en "sí"** (se verifica el arranque de `worker`, 5.10, y de `web`, 5.11) y **Q3 con el dato**: sí existe un modelo a la vez disponible y sujeto a `data_collection: deny` —`cohere/north-mini-code:free`, medido en la pasada del RUNBOOK (10.8)—, así que la rama "la variable queda vacía con aviso" **no** es el resultado; reescribir esa sección para que no siga diciendo que se deciden en el debate y para que Q3 no deje escrito un desenlace que los datos del propio repositorio contradicen; verificar que el diseño y las specs no se contradicen en el alcance de la verificación ni en el estado del modelo.
- [x] 13.2 [infra] Dejar constancia de que el estado honesto de "sin modelo utilizable" es **"proveedor no enrutable"**, no "variable vacía con aviso", y de que es un **invariante** y no el camino esperado (hay candidato): anotar en `docs/adr/ADR-048.md` §6 y revisar la spec delta de `platform/local-environment` y `openspec/specs/ai/byok`; verificar que ninguna de las tres deja en pie el camino de `dataCollection: 'omit'` con modelo vacío, que es el que 10.9 cierra, y que ninguna manda vaciar la variable teniendo sustituto.
- [x] 13.3 [infra] Anotar igualmente `docs/adr/ADR-048.md` §3, que manda declarar `environment: production` **en el preflight**: si 8.2 confirma que ese entorno abre registro de despliegue o exige revisores, el mecanismo real pasa a ser el entorno espejo de 8.3 y el ADR no puede quedarse describiendo el anterior; verificar que la nota dice qué se mantiene (los secretos de prod son de *environment* y un preflight sin entorno mentiría para siempre) y qué cambia.
- [x] 13.4 [infra] **La auditoría de cobertura, por los dos lados.** `docs/adr/ADR-048.md` ya está escrito y `docs/adr/ADR-033.md:41-44` ya lleva la nota fechada de que su D10 queda **enmendado en parte**: verificar las dos cosas y, además, que:
  - **cada decisión de ADR-048 (§1 a §6, §4-bis y sus Consecuencias) tiene al menos una tarea** en este fichero. Enumerado: §1 → 2.1–2.4; §2 → 4.1–4.11, 4.7; §3 → 7.1–7.8, 12.1, 12.4; §4 → 5.1–5.16, 6.1, 6.2; §4-bis → 4.6, 10.11; §5 → 10.1–10.6, 11.1–11.4; §6 → 10.7–10.13, 13.2; §6-bis → 10-bis.5; §6-ter → 10-bis.1–10-bis.4; §Consecuencias → 13.5 (fila 35 y golden sets a la 36), 7.5 y 7.6 (el estado se lee sin abrir la ejecución), 8.1–8.7 (`cd-prod` en alcance), 8.4 y 8.5 (un release se verifica entero); §7 → 2.5, 2.6, 4.14, 4.15 y las falsaciones de cada grupo; **§8 → 4.16 y 4.17** (el espejo de la imagen de MinIO: replicarla al registro propio, referenciarla por variable en los dos composes y registrar en la fila 35 lo que la decisión aplaza). **Las tres secciones que el enunciado no nombra —§6-bis, §6-ter y §8— existen y también tienen tareas**: el enunciado dice «§1 a §6, §4-bis», escrito antes de que el debate añadiera las dos primeras y antes de que el incidente de `quay.io` añadiera §8;

    **Corregido en la re-ejecución (2026-09-25): la enumeración de arriba omitía §8, y §8 no tenía NINGUNA tarea.** El ADR decidía ahí replicar la imagen de MinIO al registro propio —solo `amd64`, con el coste de mantenimiento aceptado— y ese trabajo estaba **hecho y sin enunciar**: es exactamente el hueco que esta auditoría existe para encontrar, el mismo del punto 2 de la nota de abajo. Añadidas **4.16** (el espejo existe, se descarga sin credenciales, la pila queda sana con él y lo replicado es solo `linux/amd64`, leído del manifiesto) y **4.17** (la referencia por variable en los **dos** composes y el registro real en la fila 35), las dos con su bloque de evidencia. Añadida también **7.10**, el **transporte de la clase del fallo** por artefacto de corrida (`VERIFY_FAIL_CLASS`, commit `9a8dbbf`), que entró después de la auditoría y tampoco tenía tarea: la verifica la corrida `36074771079`;
  - **cada requirement de las deltas tiene al menos una tarea**, listando requirement → tareas.

    **Corregido al ejecutar la auditoría (2026-09-24): son NUEVE ficheros de `specs/` y DIECISÉIS requirements, no ocho y doce.** El enunciado anterior decía «ocho ficheros y doce requirements» y su propia lista sumaba **trece**, así que ni siquiera cuadraba consigo misma. Enumerado recorriendo los ficheros, no de memoria (`## ADDED|MODIFIED Requirements` → `### Requirement:` → `#### Scenario:`): 9 ficheros, 16 requirements, 104 escenarios. Faltaban **tres** requirements y **una delta entera**:

    **Re-contado el 2026-09-25: son 106 escenarios, no 104.** La cifra de arriba era correcta el 2026-09-24 y dejó de serlo esa misma tarde: el commit `9a8dbbf` añadió a `specs/platform/ci-pipeline/spec.md` los dos escenarios del transporte de la clase del fallo —«Una avería ajena no se comunica como artefacto roto» y «Sin causa conocida no se inventa una»—, **después** de la auditoría. Ficheros y requirements no cambian. Contado otra vez con comandos, no releyendo (`find`/`grep -c` sobre `openspec/changes/deploy-image-verification/specs`):

    ```
    ficheros: 9        ./ai/byok/spec.md 3 req / 15 esc      ./platform/ci-pipeline/spec.md      2 / 22
    requirements: 16   ./ai/data-protection/spec.md 1 / 4    ./platform/local-environment/spec.md 1 / 11
    escenarios: 106    ./ai/task-execution/spec.md  1 / 14   ./platform/production-deploy/spec.md 4 / 21
                       ./ai/usage-accounting/spec.md 1 / 8   ./web/byok/spec.md                  2 / 7
                       ./cv/match/spec.md            1 / 4
    ```

    Y los dos escenarios nuevos **no tenían ninguna tarea**, porque el mecanismo que describen tampoco la tenía: es **7.10**, añadida aquí. La lección es la misma de siempre, ahora por cuarta vez: un conteo escrito en prosa envejece con el primer commit posterior, y lo único que lo destapa es **volver a contar**.

    | # | Delta | Requirement | Tareas |
    |---|---|---|---|
    | 1 | `platform/ci-pipeline` | CD a staging en main | 3.2, 5.1–5.16, 6.1–6.6, 7.1–7.10, 9.1, 11.5, 12.4 |
    | 2 | `platform/ci-pipeline` | CD a producción por tag semver | 8.1–8.7, 9.1, 11.5, 12.4 |
    | 3 | `platform/production-deploy` | Compose de producción | 4.1–4.6, 4.12, 4.13, 4.14, 4.15, 4.16, 4.17, 5.6, 5.8 |
    | 4 | `platform/production-deploy` | Imágenes multi-stage publicables | 2.1–2.6, 5.12, 5.13, 5.14, 6.1, 6.2 |
    | 5 | `platform/production-deploy` | Contrato de variables de producción | 1.1, 4.1–4.11, 5.2–5.5, 12.5, 12.6 |
    | 6 | `platform/production-deploy` | Documentación del camino canónico compose+Traefik | 10.1–10.6, 12.1–12.3, 12.7, 12.8 |
    | 7 | `platform/local-environment` | Configuración por entorno documentada | 1.2, 10.7–10.13, 12.5, 12.6 |
    | 8 | `ai/byok` | **Guardar y revocar una clave por vendor** ← faltaba | 10-bis.1, 10-bis.2, 10-bis.2bis, 10-bis.4 |
    | 9 | `ai/byok` | Inyección BYOK en runTask | 10.9, 10-bis.3, 10-bis.5 |
    | 10 | `ai/byok` | OpenRouter BYOK y data_collection | 10.8, 10.9, 10.10, 10.12, 10.13 |
    | 11 | **`ai/data-protection`** ← delta entera fuera de la lista | Secretos BYOK fuera de logs y respuestas | 10-bis.2bis, 10-bis.4 |
    | 12 | `ai/usage-accounting` | Cuotas diarias por usuario y tarea | 10-bis.5 |
    | 13 | `ai/task-execution` | Degradación tipada | 10-bis.5 |
    | 14 | `cv/match` | BYOK hace no vigente el degradado por cuota de IA | 10-bis.5 |
    | 15 | `web/byok` | Aviso de destino del dato | 10-bis.6, 10-bis.7, 10-bis.8, 10-bis.9 |
    | 16 | `web/byok` | **Claves guardadas con consentimiento off** ← faltaba, y **sin ninguna tarea** | **10-bis.10 (añadida aquí)**, 10-bis.6, 10-bis.8 |

    De los tres que faltaban en la lista, **dos ya tenían tareas** y solo faltaba nombrarlos (el 8, cubierto por el contrato y el poblado del listado; el 11, cubierto por 10-bis.2bis, que nombra `openspec/specs/ai/data-protection/spec.md` por su ruta). El **16 no tenía ninguna**: la precedencia «la indisponibilidad sustituye al aviso de consentimiento apagado, vendor a vendor» estaba implementada y probada (`profile.page.spec.ts:533`) sin que ninguna tarea la enunciara. Se añade **10-bis.10**, que es lo que esta tarea manda hacer con lo que falte.

    Comprobar además que **cada escenario nuevo** de esos requirements tiene dónde caerse: los de las tres deltas de IA, en 10-bis.5; los de `ai/byok` y `ai/data-protection` sobre disponibilidad, en 10-bis.2, 10-bis.2bis y 10-bis.4; los de `web/byok`, en 10-bis.6, 10-bis.8, 10-bis.9 y 10-bis.10. Esta segunda mitad es la que faltaba: "La salud se decide por el contenido, no por el código de estado" llegó a la iteración 3 **sin ninguna tarea** porque la auditoría solo miraba el ADR; las cuatro deltas del cierre del debate llegaron a la iteración 4 sin ninguna por el mismo motivo —la auditoría **nombraba cuatro deltas cuando ya había ocho**—; y la propia auditoría llegó al grupo 13 **nombrando ocho cuando ya había nueve**. Tres veces el mismo error, y las tres veces lo que lo destapó fue **contar**, no releer.

  Añadir la tarea que falte y comprobar que `proposal.md` referencia el ADR.
- [x] 13.5 [infra] Comprobar que la **fila 35 = destino real y primeros usuarios no-autor** esta abierta en `docs/design-v0.2.md` §6 y en `openspec-changes.yaml` —ya lo esta— **con la precedencia verificable de ADR-048 §Consecuencias y NO con una fecha**: una fecha que nadie acordo envejece sola, mientras que la precedencia se comprueba mirando si el pipeline sigue terminando en «verificado sin destino». Bajar los golden sets reales a la fila 36 (ADR-048, Consecuencias). Registrar en la fila 35, además, lo que este change **no** cierra y por qué:
  - las **dos tareas de endurecimiento del paso de secretos por ssh** —sacar `STAGING_COMPOSE_DIR`/`PROD_COMPOSE_DIR` y `GHCR_READ_TOKEN` del `script:` de `appleboy/ssh-action` a `envs:`—, que aquí solo podrían cerrarse leyendo YAML porque el job de despliegue queda **saltado**;
  - las **dos tareas del workflow reutilizable de `verify`** —extraerlo con input de modo (`affected` / `all`) y llevar allí el step `Check prompt assets`—, sacadas del alcance en esta iteración: son un refactor que ningún defecto de este change exige y un fallo ahí pondría en rojo los tres pipelines justo en el change cuyo entregable es una corrida verde (ver el grupo 9 y 11.5);
  - la comprobación **post-merge** de que una corrida de `main` con la verificación en rojo **no mueve** `:staging` (6.4), no observable desde una rama.
  - el **rediseño del healthcheck de MinIO** (4.15): que deje de aprovisionar buckets para responder si está sano, lo que pide un despliegue real contra el que probar el paso de aprovisionamiento separado.

  **Y tres más que se acumularon después de escribir esta tarea, añadidas al ejecutarla (2026-09-24):**
  - el **rojo falso del modo de prueba con destino configurado**, en los **dos** workflows: con `dry_run: true` y destino configurado, `deploy-*` queda saltado a propósito y `infra/ci/report-cd-outcome.sh` lo lee como «había destino y el despliegue no terminó bien». Hoy es imposible (cero secretos) y **deja de serlo en cuanto la fila 35 configure secretos**, que es justo el motivo de cerrarlo ahí y no antes. No se arregla aquí duplicando la tabla de decisión en un segundo script: dos lógicas de decisión son peores que un rojo falso imposible (nota del grupo 8, punto 5, y hueco gemelo de 6.4);
  - ~~el **aviso de consentimiento apagado que sigue siendo de sección y no por vendor** (`profile-byok-consent-off`)~~ — **ya no se difiere, se cerró aquí**: el 2026-09-25 `4dca9e3` lo partió por vendor dentro de este change (`profile-byok-consent-off-<vendor>`, id nuevo `profile.byok.vendorKeyInactive`; el id plural `profile.byok.keysInactive` queda retirado de los dos catálogos). Sale de la fila 35, del punto **(d)** del `scope` de `staging-host` y del punto 7 de `proposal.md`; queda tachado aquí, y no borrado, porque durante un día sí fue un diferido de esta lista (nota del SPA, punto 5, y 10-bis.10);
  - la **carencia de autenticación del adaptador SMTP**: `SmtpMailer` crea el transporte **sin bloque `auth`** y con `secure: false`, y no existen `MAIL_SMTP_USER` ni `MAIL_SMTP_PASSWORD` en ninguno de los dos esquemas, así que solo sirve para un relay que autorice por red o por IP. Los primeros usuarios no-autor de la fila 35 obligan a que el correo funcione de verdad (nota del grupo 12, punto 2).

  **Y un cuarto, añadido el 2026-09-25 con 4.16/4.17:** **sustituir MinIO y mantener su espejo** (ADR-048 §8). Este es
  el caso más claro del defecto que 13.5 §5 cazó para el SMTP: tres sitios —el propio ADR y el comentario de los dos
  composes— afirmaban que quedaba «anotado para la fila 35», y la fila 35 enumeraba siete diferidos sin ninguno de los
  dos. Registrado ahora de verdad en `docs/design-v0.2.md` fila 35, en el `scope` de `staging-host` de
  `openspec-changes.yaml` (punto **(f)**) y en `proposal.md` §"Lo que este change NO cierra" (punto 9).

  Verificar que los dos ficheros dicen lo mismo y que el manifiesto del change registra lo que **no** cierra: sigue sin haber servidor de staging.
- [x] 13.6 [infra] `pnpm nx affected -t lint,typecheck,test --base=main` y `pnpm exec openspec validate --all --no-interactive` en verde, **redirigiendo la salida a un archivo y leyendo el archivo** (nunca por pipe). Con **A1** el conjunto afectado deja de ser solo de infraestructura: el grupo 10-bis toca `shared`, `ai`, `api` y `web`, así que la corrida verde SHALL incluir esos cuatro proyectos —comprobarlo leyendo la lista del log, no suponerla—; si `shared` o `web` no aparecen, o los `inputs` están mal o la corrida está restaurando caché, y el verde no significaría nada. El smoke de `web-e2e` **no** entra aquí (necesita la pila arrancada a mano): su corrida y su restauración del entorno son 10-bis.8.
- [x] 13.7 [infra] **La comprobación que da sentido al change**: `cd-staging` en **verde** sobre la rama, con las tres imágenes construidas, la pila de `docker-compose.prod.yml` levantada y verificada, **nada publicado antes de verificar**, el digest publicado idéntico al verificado (6.2) y el aviso de que no se desplegó visible **en la lista de checks del commit**. Adjuntar el enlace de la corrida. No se da por terminado con "el CI pasa". Con **A1** el criterio no se rebaja sino que se amplía: esa misma corrida SHALL llevar el `verify` de los proyectos que el grupo 10-bis toca (`shared`, `ai`, `api`, `web`) en verde **antes** del paso de publicación, de modo que lo que se publique sea también lo que pasó los tests del cambio funcional; una corrida verde por afectación vacía en esos cuatro proyectos NO SHALL contar como cierre.

> **13.7 cerrada con corrida real (2026-09-24):**
> **https://github.com/manuXD270516/linkvault/actions/runs/36064994390** — `cd-staging` sobre
> `change/deploy-image-verification`, commit `b541a9a314b4`, conclusión **success**. Lo que el log demuestra, punto
> por punto del enunciado:
>
> * **Las tres imágenes construidas y cargadas** en el daemon del corredor (`load: true`, sin `push`), con sus tres
>   ids listados por la verificación.
> * **La pila de `docker-compose.prod.yml` levantada y verificada**: `up -d --wait --wait-timeout 360 --pull never
>   mongo redis minio api worker web` con los seis contenedores `(healthy)`, `traefik no se levantó (correcto)`,
>   `rs0 con 1 miembro, estado PRIMARY, primario escribible`, `/health` de `api` y de `worker` con
>   `"status":"up"` y `mongo`/`redis` en `up`, `web sirve el documento del SPA (<lv-root> presente)` y los dos
>   directorios de prompts con 6 entradas.
> * **Nada publicado antes de verificar**: el paso de publicación arranca cuando la verificación ya ha terminado en
>   verde, y las tres versiones de GHCR se crean a las 22:16:08–22:16:25Z. Antes de esta corrida **no existía ninguna
>   versión** de los tres paquetes.
> * **Identidad por digest (6.2)**: `verificado (digest de repositorio local)` y `publicado (digest del registro)`
>   coinciden en los tres (`sha256:107629fb…`, `sha256:0f317800…`, `sha256:d1c83477…`), y son exactamente los que
>   devuelve hoy la API de paquetes de GHCR.
> * **El aviso visible en la lista de checks del commit**: `commits/b541a9a…/check-runs` incluye
>   `resultado: artefacto verificado — NO desplegado (sin destino de staging)` en `success`, con
>   `deploy staging (solo si hay destino configurado)` en `skipped`.
> * **A1**: el `verify` de esa misma corrida, **anterior** al job de publicación, no fue por afectación vacía:
>   `lint` para **11** proyectos, `typecheck` para 10, `test` para **9** —entre ellos `api`, `web`, `ai` y
>   `shared`—, `eval-ci` para `ai` y `build` para 4, todos `Successfully ran target`.
>
> **Recomprobada — pero solo en parte — sobre el workflow de hoy (2026-09-25, corrida `36106819545`).** La corrida de arriba es de
> `b541a9a`, y desde entonces `cd-staging.yml` ha crecido **+90 líneas** (el cuarto desenlace y el transporte de
> clase de `9a8dbbf`). El argumento de que la rama verde no podía haber cambiado es correcto —los cambios son
> **puramente aditivos**, cero líneas borradas, y `infra/ci/report-cd-outcome.sh` solo consulta la clase cuando la
> verificación **no** fue exitosa—, pero este change entero nace de confiar en un razonamiento correcto sobre algo
> que nadie había ejecutado, así que se relanzó:
>
> ```
> verify (lint, specs, typecheck, test, build)                          → success
> preflight (¿hay destino de staging configurado?)                      → success
> build, verify and publish artifact                                    → success
> resultado: artefacto verificado — NO desplegado (sin destino de staging) → success
> deploy staging (solo si hay destino configurado)                      → skipped
> ```
>
> Enlace: <https://github.com/manuXD270516/linkvault/actions/runs/36106819545>. De paso confirma que el secreto de
> prueba de 7.2 **se retiró de verdad**: el preflight vuelve a decir `none` y el desenlace vuelve a ser el tercero
> —verificado y sin destino, en verde—, no el de destino a medias.
>
> **Qué cubre esta segunda corrida y qué no, dicho en voz alta.** Fue en **modo prueba** (`dry_run`), así que
> `Publish verified artifact to GHCR` salió **`skipped`**: no publicó nada. De las dos mitades del enunciado de 13.7,
> la segunda corrida recomprueba la primera —construir las tres imágenes, levantar y verificar la pila de
> `docker-compose.prod.yml` y dejar el aviso visible en la lista de checks— y **no** recomprueba la segunda, que
> son las dos afirmaciones sobre lo publicado. «**Nada publicado antes de verificar**» no puede recomprobarla: en
> modo prueba el paso de publicación se salta **en cualquier caso**, verifique antes o no, así que una corrida sin
> publicación no distingue el orden correcto del incorrecto. Y «**el digest publicado idéntico al verificado
> (6.2)**» tampoco, porque no hay digest publicado. Las dos siguen cubiertas **solo** por `36064994390`, la única
> corrida que ha publicado de verdad. El argumento del diff aditivo respalda que siguen
> valiendo —cero líneas borradas, el paso de publicación intacto, y `report-cd-outcome.sh` solo consulta la clase
> cuando la verificación **no** fue exitosa—, pero es un argumento, no una ejecución, y este change entero nace de no
> confundir las dos cosas. Así que «recomprobada» aquí significa **parcialmente**: el orden verificar-antes-de-publicar
> y la identidad por digest están demostrados por una corrida sobre `b541a9a`, no sobre el workflow de hoy. Cerrarla
> del todo pide una corrida que publique —fuera del modo prueba—, que es lo que ocurre al fusionar.
>
> **Tercera corrida, sobre la punta de la rama (2026-09-25, `36114285794`, commit `f4d5342`), con el mismo límite.**
> También en **modo prueba** —el payload del `workflow_dispatch` que registra el log del build lleva
> `"dry_run": "true"`—, así que no publica nada y **no** amplía lo que la segunda no cubre. Conclusión **success**:
>
> ```
> verify (lint, specs, typecheck, test, build)                          → success
> preflight (¿hay destino de staging configurado?)                      → success (estado: none)
> build, verify and publish artifact                                    → success
>   Publish verified artifact to GHCR (docker push of the loaded image) → skipped
> resultado: artefacto verificado — NO desplegado (sin destino de staging) → success
> deploy staging (solo si hay destino configurado)                      → skipped
> ```
>
> Lo que sí aporta, leído del log: el `verify` no fue por afectación vacía —`lint` para 11 proyectos, `typecheck`
> para 10, `test` para 9, `eval-ci` para `ai` y `build` para 4, con `web:lint`, `web:typecheck`, `web:test` y
> `web:build` entre ellos, igual que los de `api`, `ai` y `shared`—, así que el `web` que `4dca9e3` cambió pasó por
> él; y la verificación del artefacto levantó los seis contenedores `(healthy)` con las imágenes `sha-f4d5342be…`,
> `rs0` en `PRIMARY` y escribible, `/health` de `api` y de `worker` en `up`, `<lv-root>` servido y los dos
> directorios de prompts con 6 entradas. Lo que **no** aporta, por lo mismo que la segunda: ni «nada publicado
> antes de verificar» ni la identidad por digest (6.2). Que no publicó se comprobó también fuera del log: cada uno
> de los tres paquetes de GHCR sigue teniendo **una sola versión**, `sha-b541a9a314b4`, la de `36064994390`.
> Enlace: <https://github.com/manuXD270516/linkvault/actions/runs/36114285794>.

> **Lo que el grupo 13 dio por cierto y no lo era (2026-09-24, implementación).**
>
> 1. **La auditoría enumeraba OCHO deltas cuando ya había NUEVE, y decía «doce requirements» sobre una lista que sumaba
>    trece.** Contado recorriendo los ficheros: **9 deltas, 16 requirements, 104 escenarios** — cifra válida el
>    2026-09-24 y **superada el mismo día**: `9a8dbbf` añadió dos escenarios a `platform/ci-pipeline` y el conteo de
>    hoy es **106** (re-contado con comandos en 13.4). Faltaban `ai/byok` →
>    "Guardar y revocar una clave por vendor", `web/byok` → "Claves guardadas con consentimiento off" y **la delta
>    entera de `ai/data-protection`**. Es la **tercera** vez que esta auditoría se queda corta por el mismo motivo
>    (iteración 3: el requirement de healthchecks por contenido; iteración 4: las cuatro deltas del cierre del debate;
>    ahora: la novena), y las tres veces lo destapó **contar**, no releer. La tabla completa está en 13.4.
> 2. **De los tres que faltaban, uno no tenía ninguna tarea**, que es lo que esta auditoría existe para encontrar: la
>    precedencia «la indisponibilidad sustituye al aviso de consentimiento apagado, vendor a vendor» de `web/byok`
>    estaba **implementada y probada** (`profile.page.spec.ts:533`) sin que ninguna tarea la enunciara. Añadida como
>    **10-bis.10**. Los otros dos ya estaban cubiertos (10-bis.2/10-bis.4 y 10-bis.2bis) y solo faltaba nombrarlos.
> 3. **ADR-048 §4 describía la identidad por digest como UNA comprobación, y la falsación demostró que con una sola
>    pasa.** El ADR decía «lo publicado y lo verificado tienen el mismo digest, comprobado en la corrida, y si difieren
>    el pipeline falla» — que es exactamente el cotejo que, solo, **aprobó** la reconstrucción (el daemon reetiqueta, y
>    el digest leído después coincide consigo mismo; nota del grupo 6, punto 1). Corregido en el ADR con las dos
>    salidas reales de la falsación, y la misma corrección aplicada a `design.md` D2-ter, que lo decía igual.
> 4. **El encabezado de ADR-048 §7 se contradecía con su propio cuerpo**: «dos defectos más» sobre tres enumerados
>    (cuarto, quinto y sexto), y «los cinco defectos de arriba» sobre una serie —la de «defecto nunca verificado», que
>    usan §4-bis, 2.5 y 4.14— en la que arriba hay **tres**. Corregido a tres y tres, seis en total.
> 5. **`infra/README.md` afirmaba que la carencia del SMTP «está registrada como tal», y no lo estaba en ningún sitio.**
>    Buscado el par `MAIL_SMTP_USER`/`MAIL_SMTP_PASSWORD` sobre todo el repositorio: **dos** apariciones, las dos
>    describiendo la carencia (el propio README y la nota del grupo 12), ninguna registrándola. Es la forma exacta de
>    afirmación que este change persigue, escrita **dentro del fichero que el change corrigió para no tenerlas**.
>    Arreglado registrándola de verdad (fila 35 en los dos ficheros del plan y en `proposal.md`), que es lo que la
>    frase prometía.
> 6. **El manifiesto seguía diciendo «Fuera: … y cualquier cambio funcional de la aplicación»**, revocado por A1 en el
>    mismo debate. `design.md` §Non-Goals y `proposal.md` ya estaban corregidos; el manifiesto no. Y `proposal.md`
>    §Modified Capabilities enumeraba **ocho** capacidades: le faltaba `ai/data-protection`, el mismo hueco del punto 1
>    en otro fichero.
> 7. **`api:test` es inestable bajo carga, y no en los dos ficheros que decía el grupo 10 sino en cualquiera de los de
>    integración.** Con el gate entero corriendo sin caché una y otra vez en la misma máquina, `api:test` falló en
>    **tres** de cinco pasadas, siempre con `Test timed out in 5000ms` (o `Hook timed out in 10000ms`) y **siempre en
>    ficheros distintos**: `applications.controller.spec.ts`, `groups.controller.spec.ts`,
>    `group-link-comments.limits.spec.ts` y `public-page.privacy.spec.ts` — ninguno de los dos que nombra la nota del
>    grupo 10 (`auth.controller.logout.spec.ts`, `cv-match-analyses-count.spec.ts`). Todos son de integración con
>    `mongodb-memory-server`. **En aislamiento pasa siempre**: `pnpm nx run api:test --skip-nx-cache` se ejecutó
>    **cuatro** veces, las cuatro en código **0** con `Test Files 269 passed | 1 skipped (270)` y
>    `Tests 3585 passed | 11 skipped (3596)`. No es una regresión de este grupo: lo único que toca son ficheros `.md`
>    y `.yaml`. Y el aviso `NX Nx detected a flaky task: api:test` aparece **también debajo de corridas verdes**, así
>    que no sirve para distinguir un fallo de esta corrida de un recuerdo de Nx.
> 8. **Y salió una avería del propio Nx que importa a este change: una corrida verde puede imprimir el log de un
>    intento fallido.** Después de una pasada en la que `api:test` falló y de una pasada en aislamiento en la que pasó,
>    `pnpm nx affected -t lint,typecheck,test --base=main --output-style=static` terminó en **código 0** con
>    `Successfully ran targets lint, typecheck, test for 11 projects` y `30 out of 30 tasks` desde la caché, y bajo
>    `> nx run api:test [local cache]` **replicó la salida del intento fallido**: `Failed Suites 1`, `Failed Tests 3`,
>    `Test Files 4 failed | 265 passed | 1 skipped (270)`. Reproducido una segunda vez con
>    `pnpm nx affected -t test --base=main --output-style=static` (código 0, `Successfully ran target test for 9
>    projects`, el mismo bloque de fallos dentro). El **estado** restaurado es verde —`api:test` en aislamiento pasa—;
>    lo que está mal es el **texto** que se restaura con él. Importa aquí porque este change tiene guardias que
>    **leen líneas del log de Nx** (3.2 vía `infra/ci/repo-checks.sh`, 8.5 vía `assert-release-projects.sh`), y es la
>    misma avería que el grupo 11 ya cerró un piso más arriba al exigir `check.cache === false` en el agregador: un log
>    restaurado no describe la corrida que lo imprime. Por eso las salidas que este grupo da por buenas son las de
>    corridas **sin caché**, y nunca las de un `[local cache]`. (De paso: `pnpm nx reset` **no** se pudo ejecutar en
>    Windows —`EBUSY: resource busy or locked, unlink .nx/workspace-data/…-v3.db`—, así que la caché sucia sigue ahí.)
>
> **Lo que se ejecutó, con su salida.**
>
> - `pnpm nx show projects --affected --base=main --json` →
>   `["api","web-e2e","web","worker","ai","shared","testing","repo-checks","workspace-rules","extension","test-env"]`
>   — los cuatro que 13.6 exige (`shared`, `ai`, `api`, `web`) están.
> - `pnpm nx affected -t lint,typecheck,test --base=main --skip-nx-cache --output-style=static` → código **0**,
>   `Successfully ran targets lint, typecheck, test for 11 projects`, `Cache: Skipped (--skip-nx-cache)`,
>   `Run duration: 1m 38s`, las **30** tareas ejecutadas. Se corrió **sin caché a propósito**: la primera pasada
>   resolvió `30/30` desde la caché, y un verde restaurado no responde a lo que 13.6 pregunta (ver el punto 8).
> - El gate **se repitió tras editar** los ficheros de este grupo y, por la inestabilidad del punto 7, se partió para
>   que la carga no fabricara el fallo: `--skip-nx-cache --exclude=api` → código **0**,
>   `Successfully ran targets lint, typecheck, test for 10 projects`, `Run duration: 46.9s`; y `api:test` aparte,
>   `pnpm nx run api:test --skip-nx-cache` → código **0**, `Tests 3585 passed | 11 skipped (3596)`. Las 30 tareas en
>   verde, sin caché, después de los cambios.
> - `pnpm exec openspec validate --all --no-interactive` → código **0**,
>   `Totals: 74 passed, 0 failed (74 items)`, con `✓ change/deploy-image-verification` entre ellos.
> - Salidas guardadas en el scratchpad de la sesión; ninguna se obtuvo entubando `nx`, siempre por redirección a
>   fichero y lectura del fichero.
>
> **~~Lo que queda sin marcar y por qué.~~ SUPERADO el 2026-09-25 — se deja fechado, no borrado, porque el bloque de
> abajo describe un estado que ya no existe y leerlo como actual es el error que este change persigue.** Decía:
> «**Diecisiete** tareas exigen una corrida real de GitHub Actions y la rama no está publicada: 6.3, 6.4, 6.5, 6.6,
> 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.5, 8.7 y 11.5, más 13.7». Las dos premisas cayeron: **la rama
> está publicada** (`origin/change/deploy-image-verification`) y tiene PR abierto —**#57**,
> <https://github.com/manuXD270516/linkvault/pull/57>—, y de aquellas diecisiete quedan **dos**.
>
> **Estado de hoy (2026-09-25): abiertas 6.3 y 8.1, y ninguna otra.**
>
> * **6.3** — pide ver en GHCR los **dos** tags, el inmutable `sha-<12>` y el móvil `:staging`. El móvil solo se
>   mueve en corridas de `main`, así que desde esta rama no se puede ejercitar sin fusionar; es el mismo límite que
>   6.4 (cerrada anotando el hueco) por el otro lado.
> * **8.1** — ver su enunciado y la nota del grupo 8: la cláusula literal se cumplió con `36068228388`, pero el
>   **camino de publicación** de `cd-prod` no se ha ejecutado nunca.
>
> Las quince restantes se cerraron con corridas reales, cada una con su enlace: `36064994390` (la verde de
> `cd-staging`, 13.7), `36068228388` (`cd-prod` en modo prueba, 8.2, 8.3, 8.7), `36074771079` (la rota a propósito,
> 7.8, 7.6 y 7.10), `36104024048` (el destino a medias, 7.2) y las del grupo 8 para 8.5.
