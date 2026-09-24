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
# Lo que esta verificación **no** cubre, dicho en voz alta en vez de fingido: el `GET /health` de `api` y de `worker`
# declara indicadores de **mongo y redis**, y ninguno de los dos mira el almacén de objetos. MinIO se levanta porque
# `api` y `worker` dependen de su `service_healthy`, y su propio healthcheck comprueba que los buckets existen, pero
# que los procesos sepan hablar con S3 **no** queda cubierto por la readiness. Ese hueco se cierra con un despliegue
# real (fila 35), no aquí.
#
# Uso:
#   API_IMAGE=… WORKER_IMAGE=… WEB_IMAGE=… IMAGE_TAG=… infra/ci/verify-artifact.sh
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
SERVICES=(mongo redis minio api worker web)
# Las de terceros se descargan aparte; las nuestras NO pueden descargarse (ver el `up` de abajo).
THIRD_PARTY_SERVICES=(mongo redis minio)

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

section() { printf '\n=== %s\n' "$1"; }

dump_diagnostics() {
  section 'Diagnóstico: estado de los servicios'
  dc ps --all || true
  section 'Diagnóstico: logs de api, worker y web'
  dc logs --no-color --tail=200 api worker web || true
}

fail() {
  printf '\n[FAIL] %s\n' "$1" >&2
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

# --- 5.2/5.5: qué resuelve el compose con este env file y estas variables de step ----------------------------------
section 'Imágenes que resuelve el compose'
dc config --images

# --- 5.6/5.7: levantar la pila entera, con plazo y con volcado al vencer -------------------------------------------
# Las imágenes de terceros (mongo, redis, minio) sí hay que descargarlas: en un corredor limpio no existen, y
# `--pull never` las daría por ausentes abortando el `up`. Se descargan **antes y por separado**, nombrándolas, para
# que el `up` pueda seguir llevando `--pull never` y la garantía de arriba —verificar lo construido aquí y no algo
# bajado del registro— siga valiendo para NUESTRAS tres imágenes, que son las únicas que este change produce.
# Esto lo destapó la primera corrida real: en local pasaba porque esas imágenes ya estaban en la máquina.
section "pull de las imágenes de terceros (${THIRD_PARTY_SERVICES[*]})"
# Se reintenta porque el registro de terceros falla de forma intermitente: una descarga anónima limitada devuelve
# `unauthorized`, no un error de cuota legible. Sin reintento, esa avería ajena pone el pipeline en rojo de vez en
# cuando — y un rojo intermitente es exactamente lo que enseña a la gente a ignorar el pipeline, que es el defecto
# que este change existe para cerrar.
# Y si agota los intentos, el mensaje **no** puede confundirse con "nuestro artefacto no arranca": es una avería del
# registro del que se descarga, y atribuirla al artefacto mandaría a alguien a depurar el sitio equivocado.
pull_ok=0
for attempt in 1 2 3; do
  if dc pull --quiet "${THIRD_PARTY_SERVICES[@]}"; then
    pull_ok=1
    break
  fi
  printf '  intento %d de 3 fallido al descargar las imágenes de terceros; reintentando en %ds
' "$attempt" $((attempt * 15))
  sleep $((attempt * 15))
done
if [ "$pull_ok" -ne 1 ]; then
  fail "no se pudieron descargar las imágenes de terceros (${THIRD_PARTY_SERVICES[*]}) tras 3 intentos. Esto NO es un fallo del artefacto de LinkVault: es el registro del que se descargan (limitación de peticiones anónimas o caída). Reintentar la corrida suele bastar."
fi

section "up -d --wait --wait-timeout ${WAIT_TIMEOUT} --pull never ${SERVICES[*]}"
if ! dc up -d --wait --wait-timeout "$WAIT_TIMEOUT" --pull never "${SERVICES[@]}"; then
  fail "la pila no quedó sana en ${WAIT_TIMEOUT}s: alguna imagen no arranca o su readiness no pasa"
fi

section 'Estado tras el up'
dc ps

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
