#!/usr/bin/env bash
# ===================================================================================================================
# Verificación del artefacto: la pila entera de producción, levantada en el corredor.
# ===================================================================================================================
# Grupo 5 del change `deploy-image-verification`; decisión en ADR-048 §4; requirement "CD a staging en main" de
# `platform/ci-pipeline`.
#
# Qué comprueba, y por qué no basta con que el build termine: que el código compile no dice **nada** sobre si la
# imagen arranca. Aquí se levanta `docker-compose.prod.yml` —el **mismo** fichero que se despliega, nunca un compose
# escrito para CI— con las imágenes recién construidas y se exige que `api`, `worker` y `web` arranquen y respondan.
#
# Lo que queda fuera del alcance, y está dicho en la spec: Traefik, los certificados y la publicación de puertos al
# exterior (exigen DNS y ACME). Todo lo demás viene del fichero de producción tal cual, incluido el mapa de servicio a
# variable: NO se añade ni se retira ninguna variable de ningún servicio para que esto pase, porque ahí es justo donde
# vivía el defecto que esta verificación existe para encontrar.
#
# Y NO se publican puertos: la red `internal` es `internal: true` y ningún servicio de aplicación publica nada, así
# que desde el corredor no se alcanza ninguno. Se entra con `docker compose exec`. Abrir puertos para poder comprobar
# cambiaría la configuración que se está verificando.
#
# El `GET /health` de `api` y de `worker` declara indicadores de **mongo y redis**, y ninguno de los dos mira el almacén
# de objetos: el almacén se levanta porque `api` y `worker` dependen de su `service_healthy`, y su healthcheck es de
# solo lectura. Por eso, después del `up`, este script aprovisiona y comprueba el almacén con la imagen de `api`
# (`object-store.js provision` y `verify`) y comprueba que el `worker` lee el bucket de CV con su configuración
# (`s3-probe.js`); ver esas secciones, más abajo.
#
# Uso:
#   API_IMAGE=… WORKER_IMAGE=… WEB_IMAGE=… IMAGE_TAG=… infra/ci/verify-artifact.sh
#
# Opcional: `VERIFY_FAIL_CLASS_FILE=<ruta>` para que un fallo deje escrita su **clase** (`artifact` | `environment`) y
# el reporte del CD pueda nombrar la causa en vez de suponerla. Ver el bloque de `fail()`.
#
# Opcional: `TARGET_PLATFORM=<os>/<arch>` (`linux/arm64` en `cd-staging`), la arquitectura del destino. Con ella, el
# daemon tiene que ser de esa plataforma y las imágenes, existir para ella; sin ella (`cd-prod`, en local), se exige la
# del daemon. Ver la sección de la plataforma.
#
# Las cuatro variables de imagen y tag son obligatorias y vienen del step que ejecuta esto, calculadas con el tag
# local de la corrida (tarea 5.5). No están en `infra/ci/verify.env` a propósito: allí serían un valor fijo que
# envejece. Sin ellas el compose resolvería al valor por defecto y se verificaría una imagen que no es la construida.
#
# El derribo (`down -v`) NO se hace aquí: va en un step aparte con `if: always()`, para que también ocurra cuando esto
# falle. Ver `infra/ci/teardown-artifact.sh`.
# ===================================================================================================================
set -euo pipefail

COMPOSE_FILE='docker-compose.prod.yml'
ENV_FILE='infra/ci/verify.env'
# Traefik fuera (borde: DNS y ACME). Los seis que sí: las tres dependencias y las tres imágenes que se verifican.
SERVICES=(mongo redis object-store api worker web)
# Las de terceros se descargan aparte; las nuestras NO pueden descargarse (ver el `up` de abajo).
THIRD_PARTY_SERVICES=(mongo redis object-store)

# --- El plazo del `up --wait`, y de dónde sale el número -----------------------------------------------------------
# Corrección medida (2026-09-24, Docker Compose de Docker 29.8.0): el change afirmaba que «un plazo ausente deja el
# `up` esperando para siempre ante un bucle de reinicio». **No es cierto con este compose**, y se comprobó ejecutando:
# con la imagen de `api` rota a propósito, el mismo `up -d --wait` **sin** `--wait-timeout` terminó en **7 s** con
# `container linkvault-prod-api-1 is unhealthy` y código ≠0. Compose aborta en cuanto un contenedor pasa a
# `unhealthy`, y aquí **los seis servicios declaran healthcheck** con reintentos acotados, así que no hay espera
# infinita que evitar. Lo que de verdad convierte ese «is unhealthy» en algo diagnosticable es el **volcado de logs**
# de `dump_diagnostics`, no el plazo.
#
# El plazo se mantiene por lo que sí acota: el tiempo máximo que puede tardar una corrida **sana** antes de que este
# paso se dé por perdido con su propio mensaje, en vez de depender de la heurística de Compose o de morir por el
# timeout del job. Por eso el número tiene que quedar **por encima** del peor caso legítimo; si se quedara corto,
# cortaría corridas buenas. Sale de los `start_period` y las ventanas de reintento del propio
# `docker-compose.prod.yml`:
#
#   mongo  start_period 30 s + retries 12 × interval  5 s =  90 s
#   redis  start_period  5 s + retries 10 × interval  5 s =  55 s
#   minio  start_period 20 s + retries 12 × interval 10 s = 140 s   ← el más lento de las dependencias
#   api    start_period 60 s + retries 12 × interval 10 s = 180 s
#   worker start_period 60 s + retries 12 × interval 10 s = 180 s
#   web    start_period 10 s + retries  6 × interval 15 s = 100 s
#
# `api` y `worker` dependen de `service_healthy` de mongo, redis y minio, así que su ventana **no empieza a contar**
# hasta que la más lenta de las tres termina: 140 s + 180 s = **320 s** en el peor caso legítimo. De ahí sale el
# suelo, y 360 s le deja un margen del 12 % para un corredor lento. (El change escribió «≥ 240 s»; esa cifra sale de
# sumar sin encadenar las dos fases y queda **por debajo** del peor caso de sus propios números. Se usa 360.)
WAIT_TIMEOUT="${VERIFY_WAIT_TIMEOUT:-360}"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# Cada `run` de un solo uso va acotado (design D4 de `object-store`): un almacén que acepta la conexión y no responde
# no puede dejar este paso esperando hasta el timeout del job. `timeout` ejecuta un programa, no una función de la
# shell, así que no puede envolver a `dc`: esta es la misma orden, con el plazo delante.
RUN_TIMEOUT=180
dc_bounded() { timeout "$RUN_TIMEOUT" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

section() { printf '\n=== %s\n' "$1"; }

dump_diagnostics() {
  section 'Diagnóstico: estado de los servicios'
  dc ps --all || true
  section 'Diagnóstico: logs de api, worker y web'
  dc logs --no-color --tail=200 api worker web || true
}

# --- La clase del fallo: "el artefacto está roto" NO es lo mismo que "no se pudo verificar" -------------------------
# Este script ya distinguía las dos cosas en el **texto** de cada `fail`, pero ese texto muere dentro del log del job:
# quien mira la lista de checks lee lo que publica `infra/ci/report-cd-outcome.sh`, y allí llegaban las dos como
# "El artefacto no se construyó o no arrancó". En las corridas reales 36045259965 y 36048413770 —las dos cayeron por el
# `pull` de las imágenes de terceros— esa frase era **falsa**, y la desmentía la propia ejecución que la publicaba.
#
# Así que la clase se **escribe a un fichero** que el job sube como artefacto y el job de reporte recoge. Dos valores,
# ni uno más, porque son los dos que las corridas reales han demostrado:
#   artifact     → el artefacto no se construyó, no arrancó, no responde o no trae lo que dice traer (por defecto).
#   environment  → el entorno no dejó verificar; nadie ha comprobado el artefacto, ni para bien ni para mal.
# El fichero solo existe si `VERIFY_FAIL_CLASS_FILE` viene definida (en local no hace falta). Que no se pueda escribir
# **no** aborta la verificación: dejaría el reporte sin causa, que es justo el desenlace previsto para ese caso.
FAIL_CLASS_FILE="${VERIFY_FAIL_CLASS_FILE:-}"

write_fail_class() {
  if [ -z "$FAIL_CLASS_FILE" ]; then
    return 0
  fi
  if ! printf '%s\n' "$1" >"$FAIL_CLASS_FILE"; then
    printf '\n[WARN] no se pudo escribir la clase del fallo en %s: el reporte no nombrará la causa\n' \
      "$FAIL_CLASS_FILE" >&2
  fi
}

# Segundo argumento = clase. Se omite en todas las llamadas salvo en la del `pull` de terceros:
# la clase por defecto es `artifact`, y un fallo sin clasificar explícitamente **no** es una avería ajena.
fail() {
  local class="${2:-artifact}"
  write_fail_class "$class"
  printf '\n[FAIL/%s] %s\n' "$class" "$1" >&2
  dump_diagnostics
  exit 1
}

: "${API_IMAGE:?API_IMAGE es obligatoria: es el tag local construido en este job}"
: "${WORKER_IMAGE:?WORKER_IMAGE es obligatoria: es el tag local construido en este job}"
: "${WEB_IMAGE:?WEB_IMAGE es obligatoria: es el tag local construido en este job}"
: "${IMAGE_TAG:?IMAGE_TAG es obligatoria: es el tag local construido en este job}"

# --- 5.1: las imágenes que se verifican son las del daemon de este corredor ----------------------------------------
# Si alguna no está cargada, esto tiene que decirlo **aquí** y no taparse tirando del registro más abajo: por eso el
# `up` lleva `--pull never`. Una descarga silenciosa verificaría una imagen anterior y daría verde sobre otra cosa.
section 'Imágenes cargadas en el daemon del corredor'
for ref in "${API_IMAGE}:${IMAGE_TAG}" "${WORKER_IMAGE}:${IMAGE_TAG}" "${WEB_IMAGE}:${IMAGE_TAG}"; do
  if ! id="$(docker image inspect "$ref" --format '{{.Id}}' 2>/dev/null)"; then
    fail "la imagen ${ref} no está en el daemon: el paso de build no la cargó (load) o el tag no coincide"
  fi
  printf '  %s -> %s\n' "$ref" "$id"
done

# --- La plataforma: el daemon, nuestras imágenes y las de terceros (design D9 de `object-store`, ADR-052 §9) -------
# Una imagen que no existe para la arquitectura del destino es un defecto **del artefacto**, no una avería del registro:
# sin esto, el `pull` de una imagen de terceros sin `arm64` («no matching manifest») agotaba los reintentos y salía
# con clase `environment`, mandando a alguien a depurar el sitio equivocado. Por eso se comprueba **antes** del `pull`:
#   - con `TARGET_PLATFORM`, el daemon tiene que ser de esa plataforma (sin QEMU: un corredor de otra arquitectura no
#     construye ni arranca por emulación sin avisar); sin ella, se exige la del daemon;
#   - nuestras imágenes están cargadas y aún no publicadas, así que no hay registro al que preguntar: se miran **en el
#     daemon** con `docker image inspect`;
#   - las de terceros, en el registro, con `infra/deploy/check-image-platforms.sh` (el mismo que usa el `deploy.sh` de
#     35b), dentro del bucle de reintentos del `pull`: su salida 3 (no existe para esa plataforma) es `artifact` y no
#     se reintenta; su salida 4 (no se pudo comprobar) se reintenta como un `pull` fallido y, agotada, es `environment`.
# Solo se compara `os/arch`, sin variantes, como en el script.
section 'Plataforma del daemon y de las imágenes propias'
daemon_platform="$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')"
daemon_platform="${daemon_platform//$''/}"
printf '  daemon: %s\n' "$daemon_platform"
if [ -n "${TARGET_PLATFORM:-}" ]; then
  if [ "$daemon_platform" != "$TARGET_PLATFORM" ]; then
    fail "el daemon es ${daemon_platform} y TARGET_PLATFORM pide ${TARGET_PLATFORM}: este corredor no es de la arquitectura del destino y aquí no se emula"
  fi
  expected_platform="$TARGET_PLATFORM"
  printf '  TARGET_PLATFORM: %s (igual que el daemon)\n' "$expected_platform"
else
  expected_platform="$daemon_platform"
  printf '  TARGET_PLATFORM: sin definir; se exige la del daemon, %s\n' "$expected_platform"
fi
for ref in "${API_IMAGE}:${IMAGE_TAG}" "${WORKER_IMAGE}:${IMAGE_TAG}" "${WEB_IMAGE}:${IMAGE_TAG}"; do
  image_platform="$(docker image inspect "$ref" --format '{{.Os}}/{{.Architecture}}')"
  image_platform="${image_platform//$''/}"
  if [ "$image_platform" != "$expected_platform" ]; then
    fail "la imagen ${ref} es ${image_platform} y el destino es ${expected_platform}: no existe para la arquitectura del destino"
  fi
  printf '  ok: %s (%s)\n' "$ref" "$image_platform"
done

# --- 5.2/5.5: qué resuelve el compose con este env file y estas variables de step ----------------------------------
section 'Imágenes que resuelve el compose'
dc config --images

# --- 5.6/5.7: levantar la pila entera, con plazo y con volcado al vencer -------------------------------------------
# Las imágenes de terceros (mongo, redis y el almacén de objetos) sí hay que descargarlas: en un corredor limpio no
# existen, y `--pull never` las daría por ausentes abortando el `up`. Se descargan **antes y por separado**,
# nombrándolas, para que el `up` pueda seguir llevando `--pull never` y la garantía de arriba —verificar lo construido
# aquí y no algo bajado del registro— siga valiendo para NUESTRAS tres imágenes, que son las únicas que este change
# produce. Esto lo destapó la primera corrida real: en local pasaba porque esas imágenes ya estaban en la máquina.
section "pull de las imágenes de terceros (${THIRD_PARTY_SERVICES[*]})"
# Se reintenta porque el registro de terceros falla de forma intermitente: una descarga anónima limitada devuelve
# `unauthorized`, no un error de cuota legible. Sin reintento, esa avería ajena pone el pipeline en rojo de vez en
# cuando — y un rojo intermitente es exactamente lo que enseña a la gente a ignorar el pipeline, que es el defecto
# que este change existe para cerrar.
# Y si agota los intentos, el mensaje **no** puede confundirse con "nuestro artefacto no arranca": es una avería del
# registro del que se descarga, y atribuirla al artefacto mandaría a alguien a depurar el sitio equivocado. Por eso es
# la **única** llamada a `fail` que declara clase `environment`: aquí no se ha llegado a levantar nada, así que no hay
# nada que decir del artefacto, ni bueno ni malo.
# Antes de cada intento, la plataforma en el registro (ver la sección de la plataforma, arriba).
PLATFORM_CHECK='infra/deploy/check-image-platforms.sh'
third_party_images=()
while IFS= read -r line; do
  line="${line%$''}"
  [ -n "$line" ] && third_party_images+=("$line")
done < <(dc config --images "${THIRD_PARTY_SERVICES[@]}")
[ ${#third_party_images[@]} -eq ${#THIRD_PARTY_SERVICES[@]} ] \
  || fail "el compose resolvió ${#third_party_images[@]} imágenes para ${#THIRD_PARTY_SERVICES[@]} servicios de terceros (${THIRD_PARTY_SERVICES[*]})"
pull_ok=0
for attempt in 1 2 3; do
  platform_status=0
  bash "$PLATFORM_CHECK" --platform "$expected_platform" "${third_party_images[@]}" || platform_status=$?
  case "$platform_status" in
    0)
      if dc pull --quiet "${THIRD_PARTY_SERVICES[@]}"; then
        pull_ok=1
        break
      fi
      printf '  intento %d de 3 fallido al descargar las imágenes de terceros; reintentando en %ds\n' \
        "$attempt" $((attempt * 15))
      ;;
    3)
      fail "alguna imagen de terceros no existe para ${expected_platform} (la línea de arriba nombra la imagen y las plataformas que existen): es un defecto del compose, no del registro, y reintentar no lo arregla"
      ;;
    4)
      printf '  intento %d de 3: no se pudo comprobar la plataforma de las imágenes de terceros en su registro; reintentando en %ds\n' \
        "$attempt" $((attempt * 15))
      ;;
    *)
      fail "${PLATFORM_CHECK} salió ${platform_status} (uso incorrecto): la comprobación de plataformas está mal invocada"
      ;;
  esac
  sleep $((attempt * 15))
done
if [ "$pull_ok" -ne 1 ]; then
  fail "no se pudieron comprobar o descargar las imágenes de terceros (${THIRD_PARTY_SERVICES[*]}) tras 3 intentos. Esto NO es un fallo del artefacto de LinkVault: es el registro del que se descargan (limitación de peticiones anónimas o caída). Reintentar la corrida suele bastar." environment
fi

section "up -d --wait --wait-timeout ${WAIT_TIMEOUT} --pull never ${SERVICES[*]}"
if ! dc up -d --wait --wait-timeout "$WAIT_TIMEOUT" --pull never "${SERVICES[@]}"; then
  fail "la pila no quedó sana en ${WAIT_TIMEOUT}s: alguna imagen no arranca o su readiness no pasa"
fi

section 'Estado tras el up'
dc ps

# --- Tiempo hasta `healthy` de cada servicio, leído de `docker inspect` (design D8 de `object-store`) --------------
# Informa el plazo del `up` (la tabla de `WAIT_TIMEOUT`); no aprueba ni suspende nada. Es el fin del primer sondeo con
# salida 0 de `.State.Health.Log` menos `.State.StartedAt`, el mismo método que C9 en `docs/object-store-matrix/`.
# Docker guarda solo los **cinco** últimos sondeos (y no guarda los fallidos dentro de `start_period`): con el
# registro lleno, el primer sondeo sano puede haberse perdido, y lo que se imprime es una **cota superior** («≤»),
# nunca una cifra que parezca exacta sin serlo. Por eso esta sección va justo después del `up`.
section 'Tiempo hasta healthy de cada servicio (docker inspect)'
seconds_since_epoch() { date -d "$1" +%s.%N 2>/dev/null; }
for service in "${SERVICES[@]}"; do
  cid="$(dc ps -q "$service" 2>/dev/null | head -n 1 || true)"
  if [ -z "$cid" ]; then
    printf '  %-12s sin contenedor\n' "$service"
    continue
  fi
  inspected="$(docker inspect --format '{{.State.StartedAt}}|{{if .State.Health}}{{.State.Health.Status}}{{range .State.Health.Log}}|{{.ExitCode}}@{{json .End}}{{end}}{{else}}sin-healthcheck{{end}}' "$cid" 2>/dev/null || true)"
  IFS='|' read -r -a fields <<<"$inspected"
  started="${fields[0]:-}"
  status="${fields[1]:-desconocido}"
  probes=$((${#fields[@]} > 2 ? ${#fields[@]} - 2 : 0))
  first_ok=''
  for entry in "${fields[@]:2}"; do
    if [ "${entry%%@*}" = '0' ]; then
      first_ok="${entry#*@}"
      first_ok="${first_ok//\"/}"
      break
    fi
  done
  start_s="$(seconds_since_epoch "$started" || true)"
  ok_s=''
  if [ -n "$first_ok" ]; then
    ok_s="$(seconds_since_epoch "$first_ok" || true)"
  fi
  if [ -z "$start_s" ] || [ -z "$ok_s" ]; then
    printf '  %-12s estado %s; sin sondeo con salida 0 en el registro (sondeos guardados: %d): no se puede medir\n' \
      "$service" "$status" "$probes"
    continue
  fi
  elapsed="$(awk -v a="$start_s" -v b="$ok_s" 'BEGIN { printf "%.2f", b - a }')"
  if [ "$probes" -ge 5 ]; then
    printf '  %-12s estado %s; hasta healthy: <= %s s (registro lleno, sondeos guardados: %d; el primero sano puede haberse perdido)\n' \
      "$service" "$status" "$elapsed" "$probes"
  else
    printf '  %-12s estado %s; hasta healthy: %s s (sondeos guardados: %d)\n' "$service" "$status" "$elapsed" "$probes"
  fi
done

# --- El almacén de objetos: aprovisionado y comprobado por la API S3, con la imagen de `api` (design D4) -----------
# El orden es `up` → `provision` → `verify`: la readiness de `api` y `worker` no necesita los buckets. `provision` crea
# los dos buckets, pone el cifrado por defecto del de CV y quita reglas de ciclo de vida y políticas; `verify` lo lee
# sin escribir y exige además que las peticiones anónimas se rechacen. `run --no-deps` hereda las redes del servicio,
# `object-store-net` incluida.
section 'object-store: provision (run --rm --no-deps api node object-store.js provision)'
dc_bounded run --rm --no-deps api node object-store.js provision \
  || fail "object-store provision salió ≠0 (o superó ${RUN_TIMEOUT} s): el almacén no quedó aprovisionado"

section 'object-store: verify (run --rm --no-deps api node object-store.js verify)'
dc_bounded run --rm --no-deps api node object-store.js verify \
  || fail "object-store verify salió ≠0 (o superó ${RUN_TIMEOUT} s): el almacén no está como se entrega"

# --- El `worker` alcanza el almacén con su propia configuración (tarea 7.5 de `object-store`) ----------------------
# La readiness del `worker` no mira el almacén. `s3-probe.js` (entrada del build de `worker`) usa su fábrica de
# cliente S3 y su lector de CV: `HeadBucket` firmado del bucket de CV y lectura de una clave ausente de
# `.verify-probe/`, que tiene que dar `null`. Un almacén que deje de aceptar esa lectura (credenciales, bucket, TLS)
# rompe aquí el CD, no la primera lectura de un CV en el destino.
section 'worker: lectura del bucket de CV (run --rm --no-deps worker node s3-probe.js)'
dc_bounded run --rm --no-deps worker node s3-probe.js \
  || fail "worker s3-probe salió ≠0 (o superó ${RUN_TIMEOUT} s): el worker no alcanza el bucket de CV con su configuración"

# --- 5.6: el borde queda fuera, y se comprueba que de verdad quedó fuera -------------------------------------------
if [ -n "$(dc ps --all --services --filter status=running | grep -x traefik || true)" ]; then
  fail 'traefik se levantó: la verificación no incluye el borde (DNS y ACME quedan fuera de alcance)'
fi
printf 'traefik no se levantó (correcto: el borde queda fuera del alcance)\n'

# --- 5.8: mongo como replica set de un nodo, igual que en producción -----------------------------------------------
# Con instancia suelta cualquier transacción multi-documento fallaría **solo** en el despliegue real.
section 'mongo: replica set de un nodo y primario escribible'
dc exec -T mongo mongosh --quiet --eval '
  const s = rs.status();
  if (s.set !== "rs0") { print("[FAIL] el replica set es " + s.set + ", no rs0"); quit(1); }
  if (s.members.length !== 1) { print("[FAIL] miembros: " + s.members.length + ", se esperaba 1"); quit(1); }
  const h = db.hello();
  if (!h.isWritablePrimary) { print("[FAIL] db.hello().isWritablePrimary es falso"); quit(1); }
  print("rs0 con " + s.members.length + " miembro, estado " + s.members[0].stateStr + ", primario escribible: " + h.me);
' || fail 'mongo no está como replica set de un nodo con primario escribible'

# --- 5.9: readiness real de api, desde dentro de la pila -----------------------------------------------------------
# No un 200 cualquiera ni HTML del SPA: `status: up` **y** los indicadores de mongo y redis en `up`.
section 'api: GET /health con mongo y redis'
dc exec -T api node -e '
  const port = process.env.API_PORT || 3000;
  fetch("http://127.0.0.1:" + port + "/health").then(async (r) => {
    const t = await r.text();
    console.log(t);
    if (!r.ok) { console.error("[FAIL] api /health respondió " + r.status); process.exit(1); }
    const j = JSON.parse(t);
    const up = j.status === "up" && j.checks && j.checks.mongo && j.checks.mongo.status === "up" && j.checks.redis && j.checks.redis.status === "up";
    if (!up) { console.error("[FAIL] api /health no declara status/mongo/redis en up"); process.exit(1); }
    process.exit(0);
  }).catch((e) => { console.error("[FAIL] api /health inalcanzable: " + e); process.exit(1); });
' || fail 'api no responde readiness con mongo y redis'

# --- 5.10: readiness de worker, en **su propio** /health -----------------------------------------------------------
# Que `api` esté en verde no dice nada del worker: es otro proceso, otra imagen y otro esquema de configuración.
section 'worker: GET /health con mongo y redis'
dc exec -T worker node -e '
  const port = process.env.WORKER_HEALTH_PORT || 3001;
  fetch("http://127.0.0.1:" + port + "/health").then(async (r) => {
    const t = await r.text();
    console.log(t);
    if (!r.ok) { console.error("[FAIL] worker /health respondió " + r.status); process.exit(1); }
    const j = JSON.parse(t);
    const up = j.status === "up" && j.checks && j.checks.mongo && j.checks.mongo.status === "up" && j.checks.redis && j.checks.redis.status === "up";
    if (!up) { console.error("[FAIL] worker /health no declara status/mongo/redis en up"); process.exit(1); }
    process.exit(0);
  }).catch((e) => { console.error("[FAIL] worker /health inalcanzable: " + e); process.exit(1); });
' || fail 'worker no responde readiness con mongo y redis'

# --- 5.11: web sirve el documento del SPA --------------------------------------------------------------------------
# No un 200: un nginx con el directorio vacío responde 200. Se exige la raíz de la aplicación Angular, `<lv-root>`
# (`apps/web/src/index.html`).
section 'web: el documento del SPA'
if ! body="$(dc exec -T web wget -qO- http://127.0.0.1/ 2>/dev/null)"; then
  fail 'web no sirve nada en http://127.0.0.1/'
fi
printf '%s\n' "$body" | head -c 400
printf '\n'
case "$body" in
  *'<lv-root'*) printf 'web sirve el documento del SPA (<lv-root> presente)\n' ;;
  *) fail 'web responde pero el cuerpo no es el documento del SPA: falta <lv-root>' ;;
esac

# --- 5.12: los prompts viajan **en la imagen** ---------------------------------------------------------------------
# Sobre el contenedor arrancado y sobre la ruta que resuelve `AI_PROMPTS_DIR` dentro de él, no sobre `dist/` ni sobre
# ningún directorio del corredor: mirar el corredor respondería a otra pregunta (¿se construyó?) y no a esta (¿está
# dentro de la imagen que se va a publicar?).
section 'api: el directorio de prompts de la imagen no está vacío'
dc exec -T api sh -c '
  dir="${AI_PROMPTS_DIR:?AI_PROMPTS_DIR no está definida en el contenedor}"
  if [ ! -d "$dir" ]; then echo "[FAIL] $dir no existe dentro de la imagen"; exit 1; fi
  n="$(ls -1 "$dir" | wc -l)"
  echo "$dir: $n entradas"
  if [ "$n" -eq 0 ]; then echo "[FAIL] $dir está vacío dentro de la imagen"; exit 1; fi
  ls -1 "$dir"
' || fail 'el directorio de prompts de la imagen de api está vacío o no existe'

section 'worker: el directorio de prompts de la imagen no está vacío'
dc exec -T worker sh -c '
  dir="${AI_PROMPTS_DIR:?AI_PROMPTS_DIR no está definida en el contenedor}"
  if [ ! -d "$dir" ]; then echo "[FAIL] $dir no existe dentro de la imagen"; exit 1; fi
  n="$(ls -1 "$dir" | wc -l)"
  echo "$dir: $n entradas"
  if [ "$n" -eq 0 ]; then echo "[FAIL] $dir está vacío dentro de la imagen"; exit 1; fi
' || fail 'el directorio de prompts de la imagen de worker está vacío o no existe'

section 'Artefacto verificado'
printf 'api, worker y web arrancan y responden con la configuración de producción real.\n'
