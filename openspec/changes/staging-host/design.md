## Context

Motivación y alcance: ver `proposal.md`. Este change es la pieza **35b** de la fila 35 (ADR-051 §1). Aquí, solo el
estado que condiciona el cómo, medido el 2026-09-25, y lo que **35a** (`object-store`) deja hecho antes de que este
change se aplique:

- **Cero secretos de repositorio**, un único entorno (`production-preflight`, creado por `cd-prod`), **cero tags y cero
  releases**. Repositorio **privado** en plan gratuito: la API de protección de ramas y de rulesets responde `403`.
- Paquetes de GHCR `linkvault-api`, `-worker` y `-web` **privados**: el host necesita credencial de lectura.
- `cd-staging` → `deploy-staging` lleva `if: needs.preflight.outputs.state == 'full'` **sin mirar `dry_run` ni la
  referencia**. `cd-prod` → `deploy-prod` sí excluye el modo de prueba, pero `infra/ci/report-cd-outcome.sh` no sabe que
  existe y lo lee como "había destino y el despliegue no se completó".
- Los pasos de `appleboy/ssh-action@v1.2.0` (fijada por **etiqueta**) interpolan `${{ secrets.STAGING_COMPOSE_DIR }}` y
  `${{ secrets.GHCR_READ_TOKEN }}` dentro de `script:`, el token se pasa con `echo`, el login es opcional (`if [ -n …
  ]`) y nunca se hace `logout`. El host no se verifica.
- El despliegue hace `cd "$STAGING_COMPOSE_DIR"` y `docker compose … pull/up`, pero **ningún paso lleva allí** el
  `docker-compose.prod.yml` ni los ficheros que monta.
- `packages: write` está declarado a **nivel de workflow** en `cd-staging.yml` (y en `cd-prod.yml`): todos los jobs
  reciben un `GITHUB_TOKEN` que puede reescribir las imágenes, aunque solo `build-verify-publish` publica.
- Traefik monta `/var/run/docker.sock` aunque solo usa el proveedor de ficheros (`--providers.file.filename`).
- Dos adaptadores SMTP con `secure: false` y sin `auth`: `apps/api/src/infrastructure/mail/smtp-mailer.ts` (que además
  pone `tls.rejectUnauthorized: false`) y `apps/worker/src/modules/notifications/infrastructure/mail/notify-mailer.ts`.
  Los dos esquemas (`api-config.schema.ts`, `worker-config.schema.ts`) validan `MAIL_SMTP_HOST`/`PORT` por rama en un
  `superRefine`, cada uno con su copia.
- Ningún texto de `apps/web` menciona "spam", y la pantalla de verificación no dice que verificar sea opcional, aunque
  `auth/email-verification` «Login sin exigir verificación» ya lo garantiza en la API.
- Mongo de producción **no tiene autenticación** (`MONGO_URI: mongodb://mongo:27017/linkvault?replicaSet=rs0` en
  `docker-compose.prod.yml`): quien entra en el host y en el contenedor tiene acceso total a los datos.
- El compose de producción **no pasa** `AI_EMBED_CHAIN`, `FEATURE_SEARCH` ni `MEILI_*`, y no tiene servicio de
  Meilisearch: la búsqueda está apagada en cualquier despliegue de ese compose (D13).

**Lo que 35a entrega y este change da por hecho** (precondición de `/opsx:apply`, tarea 1.1): la pila sin MinIO, con un
almacén S3 que tiene imagen `arm64`; `build-verify-publish` de `cd-staging` en `ubuntu-24.04-arm`, de modo que lo
publicado en `sha-<12>` y `:staging` es `linux/arm64` y verificado en esa arquitectura; la comprobación de plataformas
de las imágenes del compose frente a la del host, como script del repositorio (`infra/deploy/check-image-platforms.sh`);
la orden de aprovisionamiento del almacén en la imagen de `api` (`node object-store.js provision|verify`); y el plazo
de `--wait-timeout` recalculado en `infra/ci/verify-artifact.sh` con los tiempos del almacén nuevo; y el digest del
índice de la imagen del almacén en ADR-052 «Elección», en una línea `Digest del índice: sha256:<64 hexadecimales>`.
Este change **coloca** la comprobación y el aprovisionamiento en el orden del despliegue y **lee** el plazo y el digest
(D4); no los escribe.
(Traslados que 35a editó aquí durante su debate: ver su design, «Traslados».)

## Goals / Non-Goals

**Goals:**
- Que la primera corrida de `cd-staging` con secretos termine en "desplegado a staging" y que **ninguna** corrida de
  prueba ni de otra rama pueda desplegar, en ese orden: lo segundo se arregla antes de configurar el primer secreto.
- Que el host de staging se pueda reconstruir desde `infra/README.md` sin conocimiento que solo tenga el autor, y que eso
  se haya **ensayado** reconstruyendo el propio host.
- Que entre 3 y 5 personas que no son el autor usen staging, y que se sepa **si lo usan** con umbrales fijados antes de
  invitarlas.
- Que cada tarea se cierre **ejecutando** algo, y que cada guardia permanente se vea caer antes de darlo por bueno
  (ADR-048 §7: "una comprobación que no puede fallar no es una comprobación").

**Non-Goals:**
- El almacén de objetos, su aprovisionamiento y su healthcheck, y el build `arm64` (35a).
- El workflow reutilizable de verificación, la comprobación post-merge, la primera release, el guardia que impide
  republicar un `sha-<12>`, la regla de acciones fijadas por SHA y todo lo que toca `cd-prod` (35c).
- Despliegue a un host de producción, escalado y observabilidad nueva.
- Copias de seguridad de datos (Q8 = desechable) y registro restringido (Q4: abierto, con vigilancia; ADR-051 §5).
- La búsqueda en staging (D13), la extensión del navegador para estos usuarios, límites `413`/`429` de `POST /api/cv`
  en el borde y el aviso de registro abierto dentro de la aplicación (V2, diferidos).

## Decisions

La numeración D1-D16 se conserva entre iteraciones, porque los debates la citan. Las que salieron de este change quedan
con una línea que dice adónde fueron.

### D1. El modo de prueba se cierra primero, con una fila más en la misma tabla, y su límite se escribe

El despliegue a staging pasa a exigir **tres** condiciones: preflight `full`, corrida que no sea de modo de prueba y
`github.ref == 'refs/heads/main'`. `deploy-prod` ya excluye el modo de prueba.

El reporte recibe un **modo de corrida** (`real` | `test` | `off-main`) y lo evalúa **dentro de la misma tabla** de
`infra/ci/report-cd-outcome.sh`, en este orden:

| # | Condición | Estado | Por qué en este lugar |
|---|---|---|---|
| 1 | el artefacto no pasó | `failure` | un artefacto roto es fallo en cualquier modo |
| 2 | preflight `partial` o vacío | `failure` | un destino a medias es un defecto de configuración, **también** en modo de prueba o fuera de `main`; si el modo fuera antes, `partial` + `test` saldría verde |
| 3 | modo distinto de `real` | `success`, "NO desplegado (modo de prueba)" o "(corrida fuera de main)" | con destino `full` o sin él, no se desplegó por decisión |
| 4 | preflight `full` | según el despliegue | solo una corrida real llega aquí |
| 5 | preflight `none` | `success`, "sin destino" | ADR-048 §3 |

`RUN_MODE` ausente vale `real`: `cd-prod` no lo pasa hasta 35c y su comportamiento no cambia. Un valor desconocido es
`failure` nombrándolo. La expresión `name:` del job `report` repite las cadenas nuevas, como ya hace con las cinco
actuales, y el script sigue imprimiendo el nombre que deriva para que la divergencia se vea en la corrida.

*Alternativas descartadas:* un segundo script para este caso (dos lógicas que deciden lo mismo divergen); confiar en que
el `pull` falle (en `main` **no** falla: la imagen del mismo commit ya existe, publicada por la corrida del push).

**Orden obligatorio:** este arreglo se fusiona (PR-1) **antes** de configurar ningún secreto. Con los secretos puestos y
el workflow actual, un `workflow_dispatch` con `dry_run` sobre `main` desplegaría de verdad.

**El límite (ADR-051 §4).** El guardia evita accidentes; **no autoriza**. Quien tiene escritura puede escribir en una
rama un workflow que lea los secretos y abra una sesión en el host, y el usuario de despliegue está en el grupo
`docker`. Se escribe en la spec, al estilo de «El límite de la señal queda escrito», y en `infra/README.md` con la lista
de quién puede escribir: colaboradores con escritura, **claves de despliegue** con `read_only: false` y **GitHub Apps**
instaladas con sus permisos (tarea 1.2). Hoy debe ser **solo el autor**, sin claves de escritura.

**`cd-prod` queda fuera.** Pasarle `RUN_MODE` y repetir las cadenas en su `name:` (antigua 2.6) es de 35c: sin secretos
de producción, su modo de prueba termina en "sin destino", que ya es verde, y el rojo falso no puede ocurrir hasta que
producción tenga destino.

### D2. → 35c

El workflow reutilizable `verify.yml` pasa a 35c como **MODIFIED** de «El CD verifica con las mismas etapas que la
integración continua», después de archivar `i18n-catalog-gate`.

### D3. Secretos como datos, OpenSSH con clave del host fijada y directorio fijo

**OpenSSH nativo en vez de `appleboy/ssh-action` y `appleboy/scp-action`.** El job de despliegue usa el `ssh` y el `tar`
del corredor. Motivos: ningún código de terceros recibe la clave privada de despliegue (así que no hay acción que fijar
por SHA en este job); la comprobación del host la hace `ssh` con `StrictHostKeyChecking=yes`, no un input opcional de
una acción; el token viaja por la entrada estándar de forma natural; y la copia no tiene un parámetro `target:` que la
acción convierta en orden remota.

- **Clave privada y `known_hosts` en ficheros temporales.** Un paso escribe, con `umask 077`, `STAGING_SSH_KEY` y un
  `known_hosts` con la línea `<host> <clave del host>` en `$RUNNER_TEMP`. Cada `ssh` lleva `-o
  StrictHostKeyChecking=yes -o UserKnownHostsFile=<ese fichero> -o BatchMode=yes -o IdentitiesOnly=yes -i <clave>`.
- **Validación de formato antes de usarlos, por lista blanca.** Aunque los valores van como datos, `ssh` interpreta
  como opción un destino que empiece por `-` (`-oProxyCommand=…` ejecutaría algo en el corredor), y una clave del host
  con un salto de línea añadiría líneas arbitrarias a `known_hosts`. Rechazar lo peligroso que se conoce («no empieza
  por `-`») deja pasar lo que no se ha pensado, como un salto de línea en medio del host; por eso el paso **acepta solo
  formas conocidas**: `STAGING_HOST` es una IPv4 (`^([0-9]{1,3}\.){3}[0-9]{1,3}$`) o un nombre DNS por etiquetas
  (`^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$`); `STAGING_SSH_USER`, un
  nombre de usuario POSIX; `STAGING_SSH_HOST_KEY`, `ssh-ed25519 <base64>` en una sola línea. Las expresiones se evalúan
  con `[[ … =~ … ]]` de bash y `LC_ALL=C`: ahí `^` y `$` anclan a la cadena entera, así que un salto de línea no pasa.
  Falla nombrando la variable, sin su valor.
- **Clave pública del host, no huella.** `known_hosts` necesita la clave, no su hash. El secreto pasa a ser
  `STAGING_SSH_HOST_KEY`, obtenido **desde dentro del host** (tarea 5.6: historial de consola de OCI, donde cloud-init
  imprime las claves, o la consola del proveedor), no con `ssh-keyscan` por la red, que confía en lo primero que
  conteste.
- **La configuración viaja por la misma conexión.** `tar -cf - -T infra/deploy/config-files.txt | ssh … "rm -rf
  $STAGING_DIR/.incoming-<sha12> && mkdir $STAGING_DIR/.incoming-<sha12> && tar -xf - -C
  $STAGING_DIR/.incoming-<sha12>"`. `<sha12>` sale de `github.sha`, y el paso lo comprueba contra `^[0-9a-f]{12}$`
  **en el corredor, antes de montar la orden**: es el único trozo de la orden remota que no es una constante del
  workflow ni un argumento ya validado. `mkdir` **sin** `-p`, para que falle si falta el directorio fijo, nombrándolo, y
  el despliegue no lo cree. El `rm -rf` previo existe porque "repetir un despliegue" relanza el mismo job con el mismo
  `<sha12>`, y borra solo el directorio de ese commit. Cuando se relanza el despliegue del commit que ya está instalado
  (6.5-6.7), ese directorio **sí** es el del despliegue instalado; borrarlo es inocuo, porque lo instalado son
  **copias** en su sitio (D4) y no el directorio `.incoming`, y la misma orden lo vuelve a crear. `tar` sin `-p`: los
  ficheros quedan con el `umask` del usuario de despliegue.
- **Los pasos con tubería, en `bash` con `pipefail`.** Cada paso que canaliza hacia `ssh` (`tar | ssh`, `printf | ssh`)
  declara `shell: bash`, que en GitHub Actions es `bash --noprofile --norc -eo pipefail`: sin `pipefail`, un `tar` que
  falla a mitad dejaría pasar el estado de salida del `ssh`. Se comprueba con un `node -e` sobre el workflow (tarea
  4.5).
- **Usuario y token del registro por la entrada estándar, sin rama opcional y con `logout`.** `printf '%s\n%s\n'
  "$GHCR_READ_USER" "$GHCR_READ_TOKEN" | ssh … "bash $STAGING_DIR/.incoming-<sha12>/infra/deploy/deploy.sh <tag>
  <plazo> <digest>"`. `deploy.sh` lee las dos líneas de su entrada estándar (`IFS= read -r user; IFS= read -r token`) y hace
  `docker login ghcr.io -u "$user" --password-stdin` con el token, dentro de un `trap` que hace `docker logout ghcr.io`
  al salir, también en error. El `printf` termina en salto de línea porque `read` devuelve ≠0 ante una última línea sin
  él, y con `set -e` eso abortaría antes del login. Se invoca con `bash` para no depender del bit de ejecución, que
  `tar` sin `-p` no garantiza.
  **En la orden remota solo quedan valores no secretos y validados:** `STAGING_DIR` (constante del workflow),
  `<sha12>` (validado en el corredor), el tag (`sha-` + 12 hexadecimales, ya comprobado por `assert-deploy-tag.sh`) y
  el plazo de arranque (`^[0-9]{2,4}$`, D4) y el digest del almacén (`^sha256:[0-9a-f]{64}$`, D4); `deploy.sh` valida
  otra vez los tres. **El usuario del registro no
  puede ir como argumento de esa orden**, aunque no sea confidencial: es el valor de un secreto, y la shell remota
  interpreta la cadena **antes** de que ninguna expresión regular de `deploy.sh` la vea, así que validarlo allí llega
  tarde (iteración 3). Ya en el host, `docker login` recibe el usuario como argumento literal, sin shell de por medio, y
  el token nunca: los argumentos los ve cualquiera que liste los procesos del host (tarea 6.5).
- **`GHCR_READ_USER` explícito.** El login de hoy usa `github.actor`. En un relanzamiento `github.actor` sigue siendo
  el **actor inicial** de la corrida (quien pulsa el botón es `github.triggering_actor`), pero ninguno de los dos es el
  dueño del token: el actor de un push es quien fusiona. La credencial de lectura es un par usuario-token, con
  caducidad, atado a una persona, y así se documenta.
- **Preflight a seis valores:** `STAGING_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_SSH_HOST_KEY`,
  `GHCR_READ_USER` y `GHCR_READ_TOKEN`. `infra/ci/preflight-deploy-target.sh` recibe la lista por destino en vez de
  fijarla. `cd-prod` conserva sus cuatro `PROD_*` y su workflow no se toca en este change. **`GHCR_READ_*` no entra en
  el preflight de producción:** son secretos de repositorio compartidos por los dos workflows, y en cuanto staging los
  configure el preflight de producción vería dos de seis y cada tag `v*` terminaría `partial` y en rojo.
- **Criterio: lo que el script usa como ruta o como código va en el repositorio.** `STAGING_COMPOSE_DIR` deja de ser
  secreto: es la ruta fija `/srv/linkvault-staging`, declarada una vez como `env:` del workflow (`STAGING_DIR`) y
  documentada en `infra/README.md`. Una ruta guardada como secreto no se ve en la revisión y, al entrar en la orden
  remota, es código que controla quien solo configura secretos.
- **`STAGING_HOST`, `STAGING_SSH_USER` y `STAGING_SSH_HOST_KEY` no son secretos por ese criterio**, ni por
  confidencialidad: la IP va dentro del nombre `sslip.io` y se publica por Certificate Transparency, el usuario no
  protege nada y una clave pública es pública. **Siguen como secretos**, por dos motivos: (1) los seis valores definen el
  destino **como unidad**, y el preflight lo lee así (ADR-048 §3): retirar uno deja el CD "a medias" y retirarlos todos
  lo devuelve a "sin destino", sin tocar código; si el host viviera en el repositorio, el destino estaría "configurado"
  en cada rama y en cada copia del repositorio; y (2) reconstruir el host (IP o clave nuevas) no exige un commit ni una
  corrida de CI. Como el script los usa solo como **datos** —argumentos del `ssh` local y una línea de `known_hosts`,
  validados antes—, guardarlos como secreto no abre el vector de inyección que tenía `STAGING_COMPOSE_DIR`.
- **`packages: write` solo en `build-verify-publish`.** Un `GITHUB_TOKEN` con ese permiso **puede reescribir las
  imágenes que el host descarga**, incluido `:staging`, mientras dura la corrida: no abre una sesión en el host, pero
  decide qué ejecuta en el siguiente despliegue. Por eso el permiso baja del nivel de workflow al único job que publica
  (tarea 3.5). La regla que fija por SHA todo `uses:` de un job con `packages: write` es de 35c, junto con la regla
  general de acciones fijadas.
- **La comprobación de inyección** se ejecuta aquí como verificación de tarea (3.3, un script de un solo uso que se ve
  caer contra el workflow actual de `main`); convertirla en guardia permanente de `repo-checks`, cubriendo también los
  `appleboy/*` de `cd-prod`, es de 35c.

*Alternativas descartadas:* `appleboy/*` fijadas por SHA (sigue siendo código de terceros con la clave privada, y que
su input `envs:` entregue los valores sin reinterpretarlos habría que falsarlo); `ssh-keyscan` en cada corrida (no
protege de nada); dejar la clave del host opcional (un destino que funciona sin ella acaba configurado sin ella); un
entorno `staging` con reglas de protección (D8).

### D4. La configuración llega al host desde el commit desplegado, en un orden que no rompe lo que corre

El orden del job de despliegue:

1. **Copia** (D3): `tar | ssh` a `"$STAGING_DIR/.incoming-<sha12>/"` de los ficheros de `infra/deploy/config-files.txt`:
   `docker-compose.prod.yml`, los que monta (`infra/traefik/dynamic.yml` y el fichero de configuración que monte el
   almacén elegido por 35a, si lo hay, sin secretos, según ADR-052 «Elección»), los scripts de `infra/deploy/`
   (`deploy.sh`, `install-config.sh` y `smoke.sh`), **la propia `config-files.txt`**, que `install-config.sh` lee en el
   host, y **el script de plataformas de 35a**, `infra/deploy/check-image-platforms.sh`, que `deploy.sh` invoca. Si
   falta el directorio fijo, falla aquí nombrándolo, sin crear nada.
2. **ssh** que ejecuta `bash .incoming-<sha12>/infra/deploy/deploy.sh <tag> <plazo> <digest>`, **del mismo commit**, con usuario
   y token por la entrada estándar (D3), que hace: login → comprobación de plataformas (script de 35a) → comprobación del digest del almacén (abajo) → `docker compose
   -f .incoming-<sha12>/docker-compose.prod.yml --env-file .env.staging pull` → `install-config.sh` → `docker compose -f
   docker-compose.prod.yml --env-file .env.staging up -d --wait --wait-timeout <plazo>`, **con el compose instalado** →
   `docker compose -f docker-compose.prod.yml --env-file .env.staging run --rm --no-deps api node object-store.js
   provision` → la misma orden con `verify` → `logout` (en `trap`).
3. **Smoke:** `ssh … "bash $STAGING_DIR/.incoming-<sha12>/infra/deploy/smoke.sh"`, contra `api` por la red Docker,
   como hoy. Pasa a un script del repositorio porque hoy es JavaScript con comillas simples y dobles mezcladas dentro
   de una orden de shell que va a su vez dentro de un `script:`; como fichero se lee, se prueba en local con un
   `docker` falso y viaja con el resto.

**Todo lo que `deploy.sh` usa viaja en la lista o llega como argumento.** El script corre en el host, donde no hay
repositorio. De ahí `config-files.txt` y el script de plataformas en la lista, y el plazo como argumento: el corredor
lo extrae de `infra/ci/verify-artifact.sh` (la línea `WAIT_TIMEOUT="${VERIFY_WAIT_TIMEOUT:-<n>}"`, que 35a recalcula)
con un paso como el que ya lee `MONGOMS_VERSION` en `cd-staging.yml:70-79`, que falla si no lo encuentra, y lo valida
con `^[0-9]{2,4}$` antes de ponerlo en la orden. `verify-artifact.sh` no viaja: leerlo en el host sería depender de un
fichero que no está en la lista. La tarea 4.4 lo comprueba ejecutando `deploy.sh` desde un árbol extraído con `tar -T
config-files.txt`, no desde el repositorio.

**El digest del almacén se comprueba antes de descargar** (traslado de 35a, pasada extra de su debate). La imagen del
almacén se eligió con una matriz ejecutada sobre una versión cuyo digest del índice anota ADR-052 «Elección» en una
línea `Digest del índice: sha256:<64 hexadecimales>`. El corredor la lee del commit desplegado igual que el plazo
(falla si no la encuentra exactamente una vez) y la valida con `^sha256:[0-9a-f]{64}$`; `deploy.sh` la recibe como
tercer argumento, la valida otra vez y, antes del `pull`, resuelve la imagen del servicio `object-store` con `docker
compose -f .incoming-<sha12>/docker-compose.prod.yml --env-file .env.staging config --images object-store` (forma
medida en la tarea 2.14 de 35a), que tiene que dar **exactamente una línea**: con un servicio nombrado, Compose añade
a la salida las imágenes de sus `depends_on` (medido en la misma 2.14: `config --images object-store api` da también
`mongo` y `redis`), así que una segunda línea significa que `object-store` ganó un `depends_on` y la lectura ya no
identifica la imagen; `deploy.sh` sale ≠0 nombrando las líneas en vez de elegir una (y nunca lee la lista sin
argumentos, cuyo orden no es estable). 35a deja `object-store` **sin `depends_on`** en los dos composes y lo comprueba
(sus tareas 7.1 y 7.3). Y su digest del índice con `docker buildx imagetools inspect` y la plantilla que midió
esa misma tarea. Si difieren, sale ≠0 nombrando la imagen y los dos digests, sin `pull` ni instalación y con `logout`:
una etiqueta movida en el registro, o un `OBJECT_STORE_IMAGE` de `.env.staging` que apunte a otra imagen, desplegaría
algo que la matriz no midió (`platform/object-store`: cambiar la imagen del almacén repite la matriz). ADR-052 no viaja
al host; viaja el valor, como el plazo. La tarea 4.4 lo comprueba con el `docker` falso.

**`pull` con el compose de `.incoming`, `up` con el instalado.** El `pull` necesita la lista de imágenes del commit
nuevo antes de instalar nada. El `up`, en cambio, usa el compose **instalado** en `$STAGING_DIR`: Compose toma como
directorio del proyecto el del primer `-f`, y de él salen el nombre del proyecto —y con él los de contenedores, redes y
volúmenes— y la resolución de los montajes relativos como `./infra/traefik/dynamic.yml`. Un `up` con `-f
.incoming-<sha12>/…` crearía otro proyecto con volúmenes vacíos y montaría ficheros de un directorio que la retención
acabará borrando. La tarea 4.4 lo comprueba en los argumentos registrados.

**Aprovisionar después del `up`, con el compose instalado.** Es el arranque documentado de 35a (`platform/production-deploy`,
«Compose de producción»): `up --wait`, luego `object-store.js provision` y `verify` con la imagen de `api` recién
descargada. `provision` es idempotente, así que repetirlo en cada despliegue no cambia nada; `verify` comprueba en cada
despliegue que los buckets, la retención, el cifrado y el rechazo anónimo siguen como se exigen. Si cualquiera de las
dos falla, el despliegue falla nombrándola, con la pila nueva ya arriba (el `up` ya ocurrió): la vuelta atrás es la de
abajo. La tarea 4.4 comprueba el orden en los argumentos registrados.

**Instalar sin cambiar el inodo.** Traefik monta `./infra/traefik/dynamic.yml` como **fichero suelto** y lo vigila con
`--providers.file.watch=true`. El montaje de un fichero suelto queda atado a su **inodo**: si `install-config.sh`
escribiera por renombrado (copia a un temporal y `mv`), el contenedor seguiría viendo el inodo viejo, el cambio no
llegaría a Traefik y nada fallaría. Por eso `install-config.sh` escribe **sobre el mismo fichero** (`cat src > dst`)
cuando ya existe, y la tarea 4.2 comprueba que `stat -c %i` no cambia.

Por qué ese orden: todo lo que puede fallar por el registro (credencial, arquitectura, imagen ausente) falla **antes**
de tocar la configuración instalada, que sigue siendo la del despliegue anterior. `install-config.sh` copia los
ficheros de la lista (y solo esos) de `.incoming-<sha12>/` a su sitio, no toca `.env.staging` y conserva los **5**
últimos `.incoming-*` (borra los más antiguos, nunca el actual).

La lista de ficheros se declara **una vez**, en `infra/deploy/config-files.txt`, y la usan la copia e
`install-config.sh`. La comprobación de que cada montaje del compose está en la lista es de 35c; aquí se verifica una
vez con `node` en la tarea que crea la lista.

**Repetir y volver atrás.**
- Repetir un despliegue = **relanzar solo el job de despliegue**: `gh run rerun <run-id> --job <job-id>`. GitHub
  conserva las salidas de los jobs previos, así que se reutilizan las imágenes ya publicadas. Relanzar la corrida entera
  volvería a construir y a publicar el mismo `sha-<12>`, y el build no es reproducible bit a bit. **Hasta 35c eso es
  procedimiento, no guardia:** el guardia de `publish-artifact.sh` que lo rechaza es de 35c (su diseño está en el
  `scope` de `verify-reusable-workflow`).
- **Relanzar tiene plazo: 30 días.** GitHub solo deja relanzar jobs de una corrida **hasta 30 días después de la
  corrida inicial** (cuenta desde que se creó la corrida, no desde el último relanzamiento). Pasado el plazo, relanzar
  deja de ser un camino para esa corrida. Por eso 9.4 y 11.6 llevan como precondición «≤ 30 días desde la corrida de
  6.3», que es la del push de PR-1; si no se cumple, se despliega o se vuelve atrás desde el host, como abajo, y se
  anota.
- **El primer despliegue relanza el preflight de la corrida del push de PR-1** (6.3). Esa corrida ya verificó y publicó
  su `sha-<12>`, con el preflight en `none` porque aún no había secretos. Relanzar su job `preflight` (`gh run rerun
  <run> --job <id del preflight>`) lo evalúa de nuevo con los secretos ya puestos, y GitHub relanza con él los jobs que
  dependen de él, `deploy-staging` y `report`, que reutilizan la salida de `build-verify-publish`. Ese job **no**
  depende del preflight y no se vuelve a ejecutar, así que no se republica nada. Se verifica que el digest de
  `sha-<12>` es el mismo antes y después y que `build-verify-publish` no se ejecutó en el intento nuevo.
  **Alternativa escrita:** si GitHub no relanza los dependientes, o si han pasado más de 30 días desde el push de PR-1,
  se vuelve al plan anterior: un `workflow_dispatch` real sobre `main` que republica **una vez** el `sha-<12>` de ese
  commit con otro digest, antes de que nada lo haya desplegado. Solo en ese caso aplican las notas de excepción de
  «Risks / Trade-offs» y del `scope` de `verify-reusable-workflow`.
- **Vuelta atrás por GitHub:** relanzar solo el job de despliegue de una corrida anterior de `main`, dentro de sus 30
  días. Se ejercita en 11.6, cuando hay dos commits de `main` desplegados (el de PR-1 y el de PR-2).
- **Vuelta atrás sin GitHub:** en el host, `install-config.sh` desde el `.incoming-<sha anterior>` guardado e
  `IMAGE_TAG=sha-<anterior> … up -d --wait`. Queda como **procedimiento escrito** en el RUNBOOK (11.2), no como ensayo:
  sus piezas (`install-config.sh` y la retención) ya se verifican en 4.2 y 4.3, y ensayarlo entero añadía una tarea sin
  añadir una comprobación nueva. Su escenario de spec se rebaja a "el procedimiento está escrito".

*Alternativas descartadas:* `git clone`/`fetch` en el host (segunda credencial del repositorio privado y un árbol de
trabajo que alguien acabará editando); instalar la configuración antes del `pull` (un `pull` fallido dejaría la
configuración nueva con las imágenes viejas).

### D5. → 35a

El aprovisionamiento del almacén fuera del healthcheck y su healthcheck de solo lectura pasan a 35a, porque dependen de
qué almacén sustituya a MinIO. 35a **no** vuelve a medir `service_completed_successfully`: aprovisionar es un `run
--rm --no-deps api node object-store.js provision` aparte, después del `up` (ADR-052 §4), y un servicio de un solo uso
en el compose queda descartado sin medir, porque `compose-healthchecks` exige healthcheck en todo servicio (design D4 de
`object-store`). Aquí solo se coloca ese `run`, con el de `verify`, en el orden del despliegue (D4).

### D6. SMTP con autenticación: una sola regla para los dos procesos, y rechazos con clase

Variables nuevas: `MAIL_SMTP_USER`, `MAIL_SMTP_PASSWORD` y `MAIL_SMTP_SECURE` (`true` = TLS implícito, típico del 465;
`false` = conexión en claro que, **con credenciales**, exige negociar TLS antes de autenticarse). Con credenciales, el
certificado se verifica siempre; sin credenciales se conserva el comportamiento actual, que es el de Mailpit. Brevo se
configura con `smtp-relay.brevo.com:587` y `MAIL_SMTP_SECURE=false` (STARTTLS exigido).

La validación (las dos credenciales juntas) y la traducción a opciones del transporte se escriben **una vez**, como
fragmento de esquema zod y función pura en `libs/shared` —sin importar `nodemailer`—, y las consumen `api` y `worker`.
Hoy cada esquema tiene su copia del `superRefine` de correo; una tercera regla duplicada es la divergencia que la spec
prohíbe.

**Rechazos con clase.** Una función pura, también en `libs/shared`, clasifica el error del transporte por el código de
respuesta SMTP: `535`/`534`/`530` → credenciales rechazadas; `421`/`450`/`451`/`452`/`550`-`554` con texto de límite →
cuota agotada; el resto → sin clasificar. Los dos adaptadores registran la clase y el código con pino, y el test
comprueba que el log no contiene usuario ni contraseña. Los códigos concretos de Brevo se confirman en la tarea del
envío real y, si difieren, se corrige la tabla antes de cerrar el grupo.

Tests: un servidor SMTP **en proceso** que exige `AUTH` tras `STARTTLS`, con un certificado de prueba confiado solo por
el test, sin Docker ni red. Es una dependencia de desarrollo nueva; su elección se anota aquí al aplicar la tarea 7.2,
con el motivo.

**Elegida (tarea 7.2, 2026-10-02): `smtp-server` 3.19 (MIT-0) con `@types/smtp-server`, solo en `devDependencies`.** Es
el servidor de los autores de `nodemailer`, el cliente que ya usan `api` y `worker`, así que habla exactamente el mismo
SMTP: `STARTTLS`, `AUTH PLAIN`/`LOGIN` y, por defecto (`allowInsecureAuth: false`), rechaza con `538` un `AUTH` sobre la
conexión en claro sin llegar a su `onAuth`, que es lo que la spec pide comprobar. Corre en el proceso del test, sin
Docker ni red, y deja inyectar los rechazos (`535`, `452`…) por código. Vive en `@linkvault/testing`
(`tools/testing/src/smtp/`), con un certificado autofirmado para `localhost`/`127.0.0.1` de 100 años que solo confían
los tests. Descartadas: Mailpit (contenedor y sin `AUTH` obligatorio tras `STARTTLS`) y un servidor escrito a mano
(repetir el protocolo para probar un cliente).

### D7. La comprobación de plataformas es de 35a; aquí solo su sitio

El requirement «Las imágenes de la pila se pueden descargar en la arquitectura del destino» y su script van a 35a con
el paso a `arm64`, que también lo falsa. Este change lo invoca en el paso 2 de D4, **después** del login y **antes**
del `pull`, y verifica ese lugar con el `docker` falso de la tarea 4.4. El script usa `docker buildx imagetools`
(35a, su design D9, eligió `imagetools` frente a `docker manifest inspect`), así que el host necesita el plugin
`buildx`, que viene en la instalación oficial de Docker Engine; la tarea 5.3 lo comprueba con `docker buildx version`.
La falsación en el host que proponía la versión anterior (apuntar la imagen del almacén al espejo `amd64` de
MinIO) se retira: 35a retira ese espejo y la comprobación ya se ve caer allí.

### D8. Secretos de staging como secretos de repositorio

`cd-staging` no declara entorno, y lo que el preflight lee son secretos de repositorio. No se introduce un entorno
`staging`: añadiría el problema de lectura que ADR-048 §3 describe para producción, y no se ha comprobado que el plan
del repositorio permita reglas de protección de entorno que limiten qué rama lee los secretos (ADR-051 §4).

### D9. → 35c

La comprobación post-merge de que un `main` en rojo no mueve `:staging`, con su ventana autorizada por el usuario,
pasa a 35c. Necesita un host desplegado para observar que sigue en la imagen anterior, y este change es el que lo crea.

### D10. Host: Oracle Cloud Always Free, Ampere A1

- **Forma:** `VM.Standard.A1.Flex`, 2 OCPU / 12 GB, Ubuntu 24.04 `aarch64`, disco de arranque dentro del límite
  gratuito. La **región de origen** se anota en `infra/README.md`: los recursos Always Free solo existen en ella.
- **IP pública reservada**, no efímera: el nombre (`<ip>.sslip.io`) y el certificado dependen de ella. Se comprueba con
  `oci network public-ip get --public-ip-address <ip>` → `lifetime: RESERVED` (tarea 5.2), no reiniciando la
  instancia, que con una IP efímera también la conserva.
- **Dos cortafuegos.** La lista de seguridad (o NSG) de la VCN abre 22, 80 y 443; y la imagen Ubuntu de OCI trae
  **reglas `iptables` propias** en `/etc/iptables/rules.v4` que rechazan todo salvo 22. Abrir solo la VCN deja 80/443
  cerrados sin error visible. Se comprueban las dos capas desde fuera.
- **"Out of host capacity".** La creación tiene un **plazo de 45 minutos** por sesión: probar cada dominio de
  disponibilidad de la región de origen, dos rondas. Si se agota, la tarea queda abierta con los intentos anotados, se
  reintenta otro día en otra franja horaria y, tras tres días sin capacidad, el dato pasa al usuario junto a la decisión
  de pago por uso (ADR-051 §6). No se cambia de región.
- **Reclamación por inactividad** (percentil 95 de CPU, red y memoria por debajo del 20 % durante 7 días). Se acepta
  mientras la cuenta sea gratuita; si se pasa a pago por uso, deja de aplicar. La memoria en régimen se mide tras el
  primer despliegue (tarea 6.4) frente a ese 20 % de 12 GB, para que la decisión de pago por uso se tome con el dato. No
  se genera carga artificial para esquivarla: sería consumir recursos para aparentar un uso que no existe.
- **Docker Engine y el plugin de Compose** desde el repositorio oficial de Docker para `arm64`; el usuario de
  despliegue, con acceso solo por clave, shell `bash` y en el grupo `docker` (equivale a root: ADR-051 §4).

### D11. Nombre y certificado sin dominio

- **Nombre:** `<ip-con-guiones>.sslip.io`. Antes de la primera emisión **de producción** se comprueba que resuelve con
  `dig` contra `1.1.1.1` y `8.8.8.8`, y si `sslip.io` figura en la Public Suffix List (búsqueda en la lista publicada),
  con el resultado anotado en `infra/README.md` como dato del riesgo (tarea 6.8). La emisión contra el entorno
  *staging* de ACME no gasta cupo de producción, así que puede ir antes. Si `sslip.io` no figura en la lista, los
  límites de emisión de Let's Encrypt se comparten con todos sus usuarios: la emisión puede fallar por culpa ajena, y
  eso se escribe como riesgo con su dato.
- **Primera emisión contra el entorno *staging* de ACME.** Traefik recibe el servidor ACME por variable
  (`ACME_CA_SERVER`, por defecto el de producción). Primero se emite con el de *staging* (certificado no confiable,
  sin gastar cupo), se comprueba el enrutado, y después se cambia al de producción con una copia de seguridad de
  `acme.json`, el **borrado del fichero entero** y un reinicio de Traefik (tarea 6.9). En ese momento el almacén solo
  guarda lo emitido contra *staging*, y editar el JSON a mano para quitar un certificado es una operación sin
  comprobación que puede dejarlo corrupto. El volumen `traefik-letsencrypt` no se borra en ninguna tarea; el ensayo de
  reconstrucción lo pierde con el disco y emite una vez más contra producción.
- **Traefik sin `docker.sock`.** Solo usa el proveedor de ficheros; montar el socket de Docker en el contenedor
  expuesto a Internet le da, si lo comprometen, el control del host. Es solo una tarea: ninguna spec lo exige hoy.

### D12. Correo que llega, y que no bloquea

- **Brevo**, plan gratuito, con **remitente verificado** en Brevo (sin dominio propio). `MAIL_FROM` = esa dirección.
- **Envío real antes de invitar** desde staging a tres proveedores: Gmail, Outlook y un tercero (Proton o Yahoo). Por
  cada uno se anotan las cabeceras `Authentication-Results` y la **carpeta** de llegada. **Umbral:** bandeja de entrada
  en al menos dos de los tres. Si no se cumple, el dominio propio vuelve al usuario como decisión con coste, y **no se
  invita** (10.7 bloqueada) hasta que se cumpla o hasta que el usuario acepte el riesgo por escrito.
- **El correo no bloquea el uso.** `auth/email-verification` «Login sin exigir verificación» ya lo garantiza en la API.
  Se comprueba que la interfaz lo **dice** (tras el registro y en la pantalla de verificación) y que pide revisar spam;
  si no lo dice —hoy no lo dice—, cambio de texto en i18n con ids nuevos (ADR-030 §12) en ES y EN, en PR-1.
- **Recuperación manual de cuenta** en el RUNBOOK para cuando el correo no llega: presentada como camino excepcional,
  que nombra la operación del producto que sustituye (recuperación de contraseña), como exige «Documentación del camino
  canónico compose+Traefik».
- El registro DNS del remitente (SPF, DKIM, DMARC) **no aplica** mientras no haya dominio: «Remitente placeholder y DNS
  documentado» sigue valiendo para cuando lo haya.

### D13. IA: OpenRouter `:free` con `data_collection: deny`, y sin búsqueda en staging

`AI_CHAIN=openrouter` con el modelo `:free` verificado de `.env.example`. Antes de invitar, una llamada real de
`runTask` desde el host —disparada por un análisis de encaje o un roadmap con una cuenta de prueba— y se anota qué
proveedor respondió según el ledger de uso, o el error "no endpoints" si ningún proveedor del modelo acepta
`data_collection: deny`. El cupo diario gratuito de OpenRouter se anota en el RUNBOOK con la fecha de la consulta.

**Cadena de embeddings: decisión de este design.** Lo que dice el código:

- `AI_EMBED_CHAIN` es **opcional**: ausente vale cadena vacía y no impide arrancar
  (`libs/ai/src/infrastructure/config/parse-ai-config.ts:244-246`, `parseChain` con `required = false`; lo mismo con
  `none`, `:254`). Con `NODE_ENV=production`, `mock` en ella se rechaza (`:73-83`).
- Los **únicos** consumidores de `embedTexts` son los dos módulos de búsqueda:
  `apps/api/src/modules/search/presentation/search.module.ts:49-54` y
  `apps/worker/src/modules/search/search.module.ts:59-62`. El análisis de encaje, el roadmap y el resto de tareas de IA
  van por `runTask` y no usan embeddings.
- Sin proveedores, `EmbedTexts` devuelve `degraded` con `no_providers` sin llamar a nadie
  (`libs/ai/src/application/embed-texts.usecase.ts:100-112`); el adaptador lo convierte en excepción
  (`apps/api/src/modules/search/infrastructure/adapt-embed-texts.ts:22-24`); la consulta cae a texto completo con
  `degraded: true` y `degradeReason: 'embeddings_unavailable'`
  (`apps/api/src/modules/search/application/search-content.usecase.ts:101-118` y `:156-157`), que la web muestra como
  "La búsqueda semántica no está disponible ahora; mostramos coincidencias por texto."
  (`apps/web/src/app/features/search/search.page.html:242-251`); y la indexación guarda `embeddingStatus: 'failed'`
  (`apps/worker/src/modules/search/application/process-search-index.usecase.ts:123-124`).
- **Pero en staging esa degradación no llega a verse**, porque la búsqueda entera está apagada: `FEATURE_SEARCH` vale
  `false` por defecto (`apps/api/src/infrastructure/config/api-config.schema.ts:45-48`,
  `apps/worker/src/infrastructure/config/worker-config.schema.ts:28-31`), y `docker-compose.prod.yml` no la pasa ni
  tiene Meilisearch ni pasa `AI_EMBED_CHAIN`. La consulta responde `503 search_unavailable` antes de pedir ningún
  vector (`search-content.usecase.ts:65-66`), la indexación no hace nada (`process-search-index.usecase.ts:48-50`), y la
  web muestra "La búsqueda no está disponible en este momento. Inténtalo más tarde."
  (`search.page.html:253-256`), con el enlace "Buscar" visible en la barra (`apps/web/src/app/layout/shell/shell.html:4`).

**Decisión: sin cadena de embeddings, y con ella sin búsqueda en staging.** El aviso de 9.10 dice que la búsqueda no
está disponible en staging (el "inténtalo más tarde" de la pantalla es engañoso ahí, y cambiarlo es de otra fila),
quien invita lo dice además de palabra (10.7), y la tarea 8.1 comprueba que `AI_EMBED_CHAIN` no llega a los
contenedores y que la búsqueda responde `503`. El código no exige declarar la variable en el compose, así que **no hay
tarea** que la declare.

**No es un bloqueo del usuario** (iteración 3): es una decisión de este design, y el usuario la aprueba al aprobar el
design antes de `/opsx:apply`. Activar la búsqueda exige añadir al compose de producción `FEATURE_SEARCH`, `MEILI_*`,
`AI_EMBED_CHAIN` y un servicio de Meilisearch en `arm64`, además de una cadena de embeddings de producción: sería un
change **posterior a 35c**, y no retiene el archivado de 35b. La señal para decidirlo sale de la conversación del día
14 (10.4): si alguien buscó algo que había guardado y no lo encontró.

### D14. Antes de invitar: lo que se ensaya y lo que se comprueba

- **Ensayo de reconstrucción reemplazando el volumen de arranque** («Replace boot volume» de OCI): conserva la
  instancia, su forma, su IP reservada y su **capacidad** —no hay que volver a ganar la lotería de "Out of host
  capacity"—, y parte de un disco vacío. Se reparte en cuatro tareas que repiten las del grupo 5 siguiendo solo
  `infra/README.md` (9.1-9.4, menos de una hora cada una), restaura `.env.staging` desde su copia y relanza el job de
  despliegue. Staging es desechable y todavía no tiene usuarios, así que es el momento más barato. **No se fusiona nada
  a `main` durante el ensayo**: un push desplegaría contra un host a medio reconstruir. Con pago por uso (4 OCPU / 24 GB
  sin coste) hay además margen para crear la instancia nueva **antes** de terminar la vieja; se anota en
  `infra/README.md` como variante, sin ensayarla.
- **Vuelta atrás** por GitHub en 11.6 (D4) y **copia de `.env.staging`** comprobada por suma.
- **`/metrics` y `/health` no públicos** y **códigos de invitación ausentes** de los logs de Traefik **y** de `api`.
- **Entrevista previa** de 10 minutos con cada invitado: cómo guarda hoy las ofertas, **qué fuentes usa y cómo le
  llegan**. No depende del host y puede hacerse en paralelo a 35a. **Alimenta el recorrido en el móvil**, y por eso
  bloquea la invitación (9.7 → 9.8 → 10.7): no es una mejora aplazable.
- **Recorrido en el móvil** con cinco links reales **de las fuentes que la entrevista dio como más usadas**, recibidos
  por el canal que dijeron (WhatsApp, correo…) y compartidos al producto como lo haría una persona: se anota por link si
  el enriquecimiento funcionó **desde la IP de Oracle** (algunas fuentes bloquean rangos de nube). Si falla una fuente
  que usa la mayoría, se decide por escrito antes de invitar: se avisa en el aviso ampliado o se pospone la invitación.
- **Degradación de IA** forzando el agotamiento de cuota: si una persona ajena la entiende.
- **El camino crítico automatizado, contra staging** (origen: ADR-053 §1.3, añadido por `e2e-suite`; lo que se ejecuta
  está escrito aquí). La **cuenta de prueba `+e2e`**: alias `+e2e` de un buzón del autor, creada a mano en la interfaz
  de staging, con el email **sin verificar** y **sin permiso de IA externa**, y su id en la lista de excluidos de D15.
  La corrida: `pnpm nx run web-e2e:e2e-remote -- --base-url <origen de staging> --match-expectation consent-required`,
  con las credenciales de esa cuenta en el entorno de la sesión, en verde en `chromium` y `mobile` **sobre el commit
  desplegado** (el `sha-<12>` que muestra `docker compose images` en el host o el estado `cd-staging/artifact`),
  lanzada desde la máquina del autor, sin minutos de CI y gastando dos análisis del cupo de la cuenta de prueba. Bloquea
  10.7.
  - **Si el PR-1 de `e2e-suite` no está en `main` el día de invitar**: la misma corrida, lanzada desde la **cabeza de la
    rama de ese PR** (en un `git worktree`) contra staging, con el commit desplegado leído del host. Prueba lo mismo:
    la suite es la de la rama; lo probado, lo desplegado.
  - **Sin respaldo local.** Una corrida de `e2e-stack` en la máquina del autor, aunque sea en un `git worktree` del
    commit desplegado, no prueba lo desplegado (ni nginx, ni Traefik, ni el host) y no sustituye a la corrida contra
    staging.
  - **Un `429`** del cupo de análisis de la cuenta se resuelve repitiendo la corrida **otro día**: el cupo es diario.
  - **Último recurso, la alternativa manual**, solo si no puede lanzarse la corrida y el usuario decide no esperar: en
    el móvil, contra staging, con la cuenta `+e2e`, anotando el `sha-<12>` del host y, por cada paso, su resultado y la
    hora:
    1. entrar con la cuenta `+e2e` y comprobar en la interfaz que el email está **sin verificar** y el permiso de IA
       **apagado** (si alguno no lo está, se para: no es la cuenta de prueba que se cree);
    2. crear un grupo **sin visibilidad pública**;
    3. guardar en ese grupo un link en un dominio `.invalid` y completar la oferta a mano;
    4. pulsar «Postulé» y comprobar que la postulación aparece en «Hoy» y en `/postulaciones`;
    5. subir el CV y esperar a que se lea;
    6. «Analizar»: el análisis **degrada por falta de permiso** de IA (no llama a ningún proveedor);
    7. borrar lo creado: la postulación, el CV y el grupo.

### D15. Usuarios y medición, escritos antes del primer dato

- **Quiénes (Q4, decide el usuario, bloquea):** 3-5 personas **que buscan empleo ahora**; 2 o 3 en **un mismo grupo**
  creado por el autor e invitadas con el código de unión.
- **Aviso ampliado**, entregado antes del alta y guardado en el RUNBOOK: que la URL `…sslip.io` es legítima; que el
  entorno es desechable y no tiene copias; que el correo puede ir a spam y no es obligatorio; que la IA es OpenRouter
  gratuito con PII redactada y `data_collection: deny`; que la búsqueda no está disponible (D13); **que si sube su CV,
  se guarda cifrado, que este entorno puede perderse sin copia y que puede borrarlo en Mi CV**; que puede borrar su
  cuenta; el canal de feedback; **si la cuenta de Oracle sigue gratuita, que la instancia puede reclamarse tras 7 días
  de poco uso**; y **una pregunta aparte, desactivada por defecto**, sobre si sus datos anonimizados pueden alimentar el
  golden set de la fila 36, con la respuesta registrada en el RUNBOOK. El consentimiento dentro de la aplicación es de
  la fila 36.
- **Plan de medición**, en el RUNBOOK y **antes de invitar**:
  - *activación* = primer link guardado en menos de 48 h desde el alta;
  - *uso* = al menos 2 personas con 3 o más links en 14 días;
  - *uso de grupo* = al menos un estado de postulación visible para otro miembro del grupo;
  - *uso de IA* = al menos un análisis de encaje o un roadmap generado.
- **Scripts `mongosh` versionados** (`infra/staging/measure.mongosh.js`, `uninvited.mongosh.js`) que devuelven **solo
  recuentos** y excluyen **por `userId`, en cada métrica** —users, groups, links, applications, cvs y analyses—, la
  **lista de ids excluidos: autor + cuentas E2E** (las cuentas de prueba persistentes de `e2e-suite`, alias `+e2e`,
  sin email verificado ni permiso de IA; ADR-053 §1.4, decidido por el usuario el 2026-09-26). No basta con quitarlas
  del recuento de cuentas: sus grupos, links, postulaciones, CV y análisis tampoco cuentan. La lista vive **fuera del
  repositorio** y se pasa a `run.sh`. **Mongo no tiene autenticación**, así que no existe un usuario de rol
  `read` con el que ejecutarlos: se ejecutan con `mongosh` dentro del contenedor `mongo`, **el operador tiene acceso
  total**, y así se escribe en el RUNBOOK. La garantía de solo lectura es una **comprobación estática**,
  `infra/staging/assert-readonly.mjs`, que falla nombrando cualquier operación de escritura: `insert*`, `update*`,
  `replace*`, `delete*`, `remove`, `drop*`, `bulkWrite`, `findOneAnd*`, `findAndModify`, `create*`, `rename*`, `save`,
  `runCommand`, `adminCommand` y las etapas `$out` y `$merge`.
- **La comprobación la aplica un envoltorio, en la máquina del operador.** `infra/staging/run.sh <script>` ejecuta
  primero `node infra/staging/assert-readonly.mjs <script>` en local y, **solo si pasa**, `ssh <host> 'docker compose …
  exec -T mongo mongosh --quiet …' < <script>`, con la lista de invitados inyectada en el host por `--eval` (la lista
  vive allí, fuera del repositorio) y la **lista de excluidos** (autor + cuentas E2E), que el operador pasa a `run.sh`
  como fichero fuera del repositorio, inyectada igual. Así el guardia no depende de que alguien se acuerde de ejecutarlo antes, ni de que
  el host tenga `node`. Se ve caer añadiendo un `insertOne`: el envoltorio se niega a ejecutar y no abre ninguna sesión
  (tareas 9.12 y 10.3). Añadir autenticación a Mongo de producción queda fuera de la fila.
- **Conversación de cinco preguntas** el día 14, con el guion escrito de antemano. Una de ellas pregunta si buscaron
  algo que habían guardado y no lo encontraron: es la señal para decidir si se activa la búsqueda (D13).
- **Regla de decisión** escrita: si no se alcanza la activación, lo que falla es la entrada (alta, primer link,
  aviso); si hay activación y no uso, lo que falla es el valor. Cada rama dice qué se hace después.
- **Los días 7 y 14 son condiciones de cierre de la fila, no tareas de trabajo**: el change puede archivarse con ellos
  pendientes, y la fila 35 no se da por cerrada en `docs/design-v0.2.md` hasta que ocurran. Esos dos días **no se lanza
  la suite remota de `e2e-suite` contra staging**, para que ninguna corrida de prueba coincida con la foto de la
  medición.

### D16. Cuentas no invitadas: vigilar en vez de restringir

Por Certificate Transparency la URL es pública desde la primera emisión (ADR-051 §5). `uninvited.mongosh.js` cuenta las
cuentas cuyo id no está en la lista de invitados del host (fichero fuera del repositorio: son datos personales) **ni en
la de excluidos** (autor + cuentas E2E, D15), que tampoco vive en el repositorio y se pasa a `run.sh`. Se
ejecuta semanalmente mientras dure staging, siempre por `run.sh` (D15), y el RUNBOOK describe qué hacer con una
cuenta ajena: el borrado de la operación del producto no lo puede invocar el operador en nombre de otra persona, así que
el procedimiento manual se presenta como excepcional y nombra la operación a la que sustituye.

## Risks / Trade-offs

- [Un `dry_run` sobre `main` despliega si los secretos llegan antes que D1] → D1 va en PR-1 y la tarea de secretos
  (6.1) está bloqueada por su fusión.
- [**Oracle reclama la instancia** por inactividad, o no hay capacidad ARM] → staging es desechable y el ensayo de
  reconstrucción está hecho; pasar a pago por uso lo evita y es decisión del usuario, que bloquea invitar, tomada con la
  memoria en régimen medida.
- [**`sslip.io`** cae o comparte límites de emisión] → se comprueba la Public Suffix List antes de la emisión de
  producción; la primera emisión va contra el entorno *staging* de ACME. Un dominio propio lo quita.
- [**Spam**: sin dominio no hay DKIM alineado] → medido en tres proveedores con umbral que bloquea invitar; la
  verificación no bloquea el uso y la interfaz lo dice; recuperación manual escrita.
- [**Certificate Transparency** publica la URL] → recuento periódico de cuentas no invitadas y procedimiento de borrado;
  cuota de Brevo y límites por IP del registro (ADR-020) acotan el abuso.
- [**Cupo de OpenRouter** pequeño y variable; "no endpoints" con `data_collection: deny`] → degradación honesta
  existente; se comprueba en el móvil que se entiende; cupo anotado en el RUNBOOK.
- [**Sin búsqueda en staging**] → decisión de este design (D13); dicho en el aviso y de palabra al invitar; la pantalla
  dice "inténtalo más tarde", que ahí no es cierto, y cambiarlo es de otra fila. Activarla es un change posterior a 35c.
- [**Minutos de CI** en `arm64` salen del plan gratuito] → 35a los mide frente al plan; aquí se anotan con la corrida
  del primer despliegue en ADR-051 «Tras aplicar» (tarea 11.3).
- [SSH abierto a Internet: los corredores de GitHub no tienen un rango de IP pequeño] → usuario de despliegue dedicado,
  solo clave, clave del host fijada con comprobación estricta (D3). **Quien tiene escritura en el repositorio tiene root
  en staging**, escrito en la spec y en `infra/README.md`, con quien escribe = solo el autor.
- [Un `GITHUB_TOKEN` con `packages: write` en un job que no publica podría reescribir las imágenes] → el permiso baja
  al job que publica (3.5); fijar por SHA los `uses:` de ese job es de 35c.
- [`AI_VAULT_KEY` solo en el host] → copia de `.env.staging` fuera del host, comprobada por suma, y restaurada en el
  ensayo de reconstrucción.
- [**Mongo sin autenticación**: el operador lo lee y lo escribe todo] → escrito en el RUNBOOK; los scripts de medición
  pasan por una comprobación estática antes de ejecutarse.
- [Datos personales reales en un entorno desechable] → aviso ampliado antes del alta; sin copias; borrado de cuenta del
  producto.
- [Relanzar la corrida entera publicaría otro digest bajo el mismo `sha-<12>`] → se relanza solo el job; hasta 35c es
  procedimiento. El primer despliegue (6.3) relanza el preflight de la corrida del push de PR-1 y no republica. **Solo
  si ese camino falla** (GitHub no relanza los dependientes, o han pasado más de 30 días), 6.3 cae a un
  `workflow_dispatch` que republica una vez, a sabiendas, antes de que nada haya desplegado ese tag.
- [GitHub solo deja relanzar jobs hasta 30 días después de la corrida inicial] → 9.4 y 11.6 lo llevan como
  precondición; si no se cumple, se despliega o se vuelve atrás desde el host o la máquina del operador, y se anota.
- [La comprobación de inyección no es permanente hasta 35c] → se ejecuta como verificación de tarea contra este
  change; la fila entera no admite otro change entre medias, así que el hueco lo cierra 35c sin intermediarios.

## Migration Plan

**Dentro de la fila 35 (ADR-051 §1):**

1. **35a `object-store`** aplicado y archivado: almacén S3 `arm64`, build y verificación en `ubuntu-24.04-arm`,
   comprobación de plataformas, plazo de arranque recalculado. `main` verde, "verificado sin destino".
2. **35b, este change**, en dos PR:
   1. **PR-1** — guardias sin secretos (grupos 2-4) y código de correo (7.1-7.8, 7.13), fusionado en su ventana con el
      CD en "verificado sin destino".
   2. Sin fusionar nada: host (grupo 5), secretos y primer despliegue real relanzando el preflight de la corrida del push
      de PR-1, dentro de sus 30 días (grupo 6, D4), correo real (7.9-7.12, 7.14), IA (grupo 8), antes de invitar (grupo
      9), medición (10.1-10.6), documentación (11.1-11.5).
   3. **PR-2** — el cierre, fusionado en su ventana; su push es el primer despliegue por merge.
   4. Con PR-2 en `main`: vuelta atrás por GitHub entre los dos commits desplegados (11.6, dentro de los 30 días de la
      corrida de PR-1) e invitación (10.7), bloqueada por el usuario. `/opsx:verify` sobre todo el change y PR de
      archivo.
3. **35c `verify-reusable-workflow`**, tras archivar `i18n-catalog-gate`: workflow reutilizable, post-merge, release
   `v0.1.0` solo `arm64`, guardias diferidos y la parte de `cd-prod`.

**Vuelta atrás:** staging vuelve a la versión anterior relanzando el job de despliegue de la corrida anterior o, en el
host, con `install-config.sh` desde el `.incoming-*` guardado (D4). Retirar un secreto devuelve el CD a "verificado sin
destino" (o a "a medias", si se retira solo uno) sin tocar código.

## Decisiones cerradas y bloqueos del usuario

Las once preguntas de la primera versión están respondidas (`proposal.md`, «Decisiones del usuario») y los debates de
las iteraciones 1 a 3 cerraron el resto (ADR-051). **Ninguna pregunta cambia ya las specs.** Quedan **dos decisiones
del usuario** (pago por uso y Q4), un umbral medido que puede convertirse en una tercera, las dos ventanas de fusión y
la precondición de invitar que añadió `e2e-suite` (ADR-053 §1.3).
**Sin búsqueda en staging ya no es un bloqueo**: es una decisión de este design (D13), que el usuario aprueba al
aprobar el design antes de `/opsx:apply`.

| Bloqueo | Quién decide | Qué bloquea | Si se decide que sí |
|---|---|---|---|
| Pasar la cuenta de Oracle a **pago por uso** | el usuario | 5.10, PR-2 y 10.7 | alerta de presupuesto a 1 € (tarea 5.10); si no, el riesgo aceptado en `infra/README.md` y el aviso de 9.10 lleva la reclamación a 7 días |
| **Q4**: quiénes (3-5 que buscan empleo ahora, 2-3 en un mismo grupo) | el usuario | 9.7, 9.8, 10.1, PR-2 y 10.7 | invitación con el código de unión del grupo del autor |
| **Umbral del correo** (7.10): bandeja de entrada en al menos 2 de 3 proveedores | la medición; si no se cumple, el usuario | 10.7 | cumplido: nada; no cumplido: dominio propio con su coste, o riesgo aceptado por escrito |
| **Ventana de fusión de PR-1** | el usuario | la fusión de PR-1 y, tras ella, 6.1 | fusión a mano con el CI en verde |
| **Ventana de fusión de PR-2** | el usuario, pedida **junto con Q4** | la fusión de PR-2 y, tras ella, 11.6 y 10.7 | fusión a mano con el CI en verde |
| **Precondición de invitar de `e2e-suite`** (origen: ADR-053 §1.3; ejecución: D14) | la corrida `e2e-remote` contra staging; si no puede lanzarse, el usuario | 10.7 | en verde en los dos proyectos sobre el commit desplegado —desde `main` o, sin el PR-1 de `e2e-suite` en `main`, desde la cabeza de la rama de ese PR—: nada; si falla, no se invita hasta que pase; un `429`: se repite otro día; sin respaldo local; último recurso, esperar o la alternativa manual de D14, anotada paso a paso |

**PR-2 depende de Q4 y de 5.10** (pago por uso), porque lleva anotaciones que salen de ellas: la entrevista por
invitado (9.7) y el número de personas y cuántas van al grupo (10.1) en el RUNBOOK, la decisión de pago por uso en
`infra/README.md` (5.10) y la frase condicional del aviso (9.10). Sin esas decisiones PR-2 no está completo.

**Las dos decisiones del usuario (Q4 y pago por uso) se toman en paralelo a 35a**, no al llegar a sus tareas: ninguna
depende del host, y esperar a la tarea convertiría cada una en una parada al final del change. **La ventana de fusión
de PR-2 se pide junto con Q4**, también en paralelo a 35a, por la misma razón. La de pago por uso puede revisarse
cuando 6.4 dé la memoria en régimen.

Si el usuario decide **no** pasar a pago por uso, la tarea 5.10 se cierra anotando esa decisión y el riesgo de
reclamación aceptado por escrito; el bloqueo es la decisión, no una respuesta concreta.
