#!/usr/bin/env bash
# C5 de la matriz del almacén de objetos: el cifrado se demuestra protegiendo (tareas 2.9, 2.9b y 2.10 de
# `object-store`; design D2; ADR-052 §2). Encadena, sobre el servicio `object-store` de un compose:
#
#   modo `server` (por defecto: cifrado por defecto del bucket con la clave del servidor, K1):
#     1. modo C5 de la suite de contrato de `api` (A1/A2 al bucket de CV sin cabeceras SSE, B1/B2 al de snapshots);
#     2. `docker compose stop object-store` y `tar` del volumen con `alpine`;
#     3. `find-plaintext.mjs`: tres ventanas de cada buffer y la clave en sus formas;
#     4. lectura del disco: B1 y B2 3/3 (si no, `no concluyente`), A1 y A2 0/3 (si no, `falla`);
#     (c) la clave no está en el volumen;
#     (b) sobre una **copia** del volumen restaurada desde el `tar`, en otro proyecto de Compose: con otra clave K2
#         (mismo formato que K1), b1 = arranca, A1 rechazado sin bytes y B1 leído; b2 = no arranca y su log nombra un
#         error de clave; y, sobre **esa misma copia** con K1, A1 y B1 vuelven idénticos;
#     (a) queda demostrada por (b) y (c).
#   modo `--sse-c` (salida SSE-C, forma (2) de `cv/documents`):
#     1. modo SSE-C de la suite (A1/A2 con SSE-C y el eco de `SSECustomerKeyMD5`); un rechazo que nombre TLS o una
#        conexión segura es `falla: TLS del servidor`;
#     2-4 y (c) igual, con la clave SSE-C de 32 bytes y su base64;
#     (b) sobre el original rearrancado: A1 sin clave y con otra clave, rechazados sin bytes; B1 leído; A1 con la
#         clave, idéntico.
#
# C5 se corta en la primera prueba ejecutada que decide (disco, después (c), después (b)).
#
# Uso, desde cualquier directorio, con el almacén **en marcha y aprovisionado** (`object-store provision`) y sus `S3_*`
# exportadas (`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_SNAPSHOTS_BUCKET`), y el
# proyecto de Compose en `COMPOSE_PROJECT_NAME` (el mismo con el que se levantó):
#
#   COMPOSE_PROJECT_NAME=os29-minio C5_WORKDIR=<dir vacío> \
#     bash docs/object-store-matrix/c5.sh [--sse-c] <compose> <volumen>
#
# `<volumen>` es la clave del volumen en el compose (p. ej. `object-store-data`), no el nombre de Docker.
#
# Se niega a medir (sale con 2, nombrando cada causa) si el servicio `object-store` monta más de un volumen o un bind
# escribible —el `tar` de un solo volumen tiene que ser todo el estado del almacén—, si ese volumen declara `name:`
# explícito o es `external` en el YAML crudo —la copia de (b) montaría el original—, si el servicio fija
# `container_name` —la copia no podría coexistir— o, en modo `server`, si no hay exactamente una entrada de su
# `environment` que referencie `OBJECT_STORE_SSE_KEY` o si resuelve vacía. **K1 es la del compose resuelto**
# (`docker compose config --format json`), no la de la shell, y el contenedor en marcha tiene que llevarla. Nombra
# siempre el servicio `object-store` (`stop object-store`, `up -d --no-deps object-store`): los demás servicios del
# compose no se tocan. Al terminar, pase lo que pase, vuelve a arrancar el original y borra la copia.
#
# Códigos: 0 `nativo` (o `salida` con `--sse-c`); 1 `falla`, `falla: TLS del servidor` o `no concluyente` (la última
# línea, `c5: resultado: …`, lo dice); 2 precondición o uso. Nunca imprime una clave.

set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
helpers="$here/c5-helpers.mjs"
alpine="${C5_ALPINE_IMAGE:-alpine:3}"
wait_timeout="${C5_WAIT_TIMEOUT:-120}"
service=object-store

say() { printf 'c5: %s\n' "$*"; }
refuse() { printf 'c5: refused: %s\n' "$*" >&2; exit 2; }
usage() {
  printf 'usage: [COMPOSE_PROJECT_NAME=…] [C5_WORKDIR=<empty dir>] %s [--sse-c] <compose> <volume>\n' "$0" >&2
  exit 2
}

mode=server
while [ $# -gt 0 ]; do
  case "$1" in
    --sse-c) mode=sse-c; shift ;;
    -h|--help) usage ;;
    --) shift; break ;;
    -*) printf 'c5: unknown option %s\n' "$1" >&2; usage ;;
    *) break ;;
  esac
done
[ $# -eq 2 ] || usage
compose="$1"
volume_key="$2"
[ -f "$compose" ] || refuse "$compose does not exist"

missing=""
for name in S3_ENDPOINT S3_REGION S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET S3_SNAPSHOTS_BUCKET; do
  [ -n "${!name:-}" ] || missing="$missing $name"
done
[ -z "$missing" ] || refuse "missing environment:$missing"

work="${C5_WORKDIR:-$(mktemp -d)}"
mkdir -p "$work" || refuse "cannot create $work"
work="$(cd "$work" && pwd)"
[ -z "$(ls -A "$work")" ] || refuse "$work is not empty (the evidence of two runs would mix)"
objects="$work/objects"

# Rutas del host para `docker run -v` y para `node` en Git Bash (Windows); en Linux, las mismas.
hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
dockerx() { MSYS_NO_PATHCONV=1 docker "$@"; }
dc() { MSYS_NO_PATHCONV=1 docker compose -f "$compose" "$@"; }

say "mode $mode, compose $compose, volume $volume_key, workdir $work"
# Con `MSYS_NO_PATHCONV=1`, Docker recibe las rutas tal cual: el compose va como ruta del host.
compose="$(hostpath "$(cd "$(dirname "$compose")" && pwd)/$(basename "$compose")")"

# ---------------------------------------------------------------------------------------------------------------------
# Precondiciones: el compose resuelto y sin interpolar, y el YAML crudo.
# ---------------------------------------------------------------------------------------------------------------------
dc config --format json >"$work/compose.resolved.json" 2>"$work/compose.err" \
  || refuse "docker compose config failed: $(head -c 400 "$work/compose.err")"
dc config --no-interpolate --format json >"$work/compose.raw.json" 2>"$work/compose.err" \
  || refuse "docker compose config --no-interpolate failed: $(head -c 400 "$work/compose.err")"
checked="$(node "$helpers" compose "$compose" "$work/compose.resolved.json" "$work/compose.raw.json" "$volume_key" "$mode")" \
  || exit 2
project="$(printf '%s\n' "$checked" | sed -n 's/^project=//p')"
volume="$(printf '%s\n' "$checked" | sed -n 's/^volume=//p')"
keyvar="$(printf '%s\n' "$checked" | sed -n 's/^keyvar=//p')"
say "project $project, docker volume $volume${keyvar:+, key entry $keyvar (from OBJECT_STORE_SSE_KEY)}"

k1=""
ssec_key=""
if [ "$mode" = server ]; then
  k1="$(node "$helpers" k1 "$work/compose.resolved.json" "$work/compose.raw.json")" || exit 2
else
  ssec_key="$(node "$helpers" sse-c-key)" || exit 2
fi

cid="$(dc ps -q "$service" 2>/dev/null)"
[ -n "$cid" ] || refuse "service $service of project $project is not running"
dockerx inspect "$cid" >"$work/container.json" || refuse "docker inspect $cid failed"
C5_K1="$k1" node "$helpers" container "$work/container.json" "$volume" "$keyvar" || exit 2

# ---------------------------------------------------------------------------------------------------------------------
# Limpieza: pase lo que pase, el original vuelve a arrancar y la copia se borra.
# ---------------------------------------------------------------------------------------------------------------------
stopped=0
copy=""
cleanup() {
  if [ -n "$copy" ]; then
    MSYS_NO_PATHCONV=1 docker compose -p "$copy" -f "$compose" down -v --remove-orphans >"$work/copy-down.log" 2>&1 \
      && say "copy project $copy removed (container, network and volume)" \
      || say "WARNING: could not remove copy project $copy (see $work/copy-down.log)"
    copy=""
  fi
  if [ "$stopped" = 1 ]; then
    if dc up -d --no-deps --wait --wait-timeout "$wait_timeout" "$service" >"$work/restart.log" 2>&1; then
      say "original $service started again (up -d --no-deps $service)"
    else
      say "WARNING: original $service did not come back (see $work/restart.log)"
    fi
    stopped=0
  fi
}
trap cleanup EXIT

result() {
  say "resultado: $*"
}

# ---------------------------------------------------------------------------------------------------------------------
# 1. Modo C5 (o SSE-C) de la suite de contrato de `api`.
# ---------------------------------------------------------------------------------------------------------------------
say "1. contract suite, C5 $mode mode (vitest, output in $work/suite.log)"
if [ "$mode" = server ]; then
  (cd "$repo" && env -u S3_CONTRACT_C5_SSE_C -u S3_CV_SSE_C_KEY S3_CONTRACT=1 S3_CONTRACT_C5_DIR="$(hostpath "$objects")" \
    pnpm exec vitest run --config apps/api/vitest.config.mts --reporter=verbose s3.s3-contract -t 'C5') \
    >"$work/suite.log" 2>&1
else
  (cd "$repo" && S3_CONTRACT=1 S3_CONTRACT_C5_DIR="$(hostpath "$objects")" S3_CONTRACT_C5_SSE_C=1 \
    S3_CV_SSE_C_KEY="$ssec_key" \
    pnpm exec vitest run --config apps/api/vitest.config.mts --reporter=verbose s3.s3-contract -t 'C5') \
    >"$work/suite.log" 2>&1
fi
suite=$?
node -e "
const lines = require('fs').readFileSync(process.argv[1], 'utf8').split(/\r?\n/);
for (const l of lines) if (/^\s*(✓|×|↓)|Test Files|Tests\s|→/.test(l)) console.log('   ' + l.trim());
" "$work/suite.log"
if [ "$suite" -ne 0 ]; then
  if [ "$mode" = sse-c ]; then
    node "$helpers" sse-c-error "$objects/sse-c-error.json"
    case $? in
      0) result "falla: TLS del servidor (el almacén rechaza SSE-C por $S3_ENDPOINT)"; exit 1 ;;
      4) result "falla (TLS): el SDK no envía SSE-C por http://"; exit 1 ;;
    esac
  fi
  result "no ejecutado: la suite de C5 falló (exit $suite, ver $work/suite.log)"
  exit 1
fi
node -e "
const m = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
for (const [n, o] of Object.entries(m.objects)) console.log('   ' + n + ' ' + o.bucket + ' ' + o.bytes + ' bytes, lo que dice el almacén: ' + o.serverSideEncryptionReported);
if (m.sseC) console.log('   eco SSECustomerKeyMD5 de A1 y A2 igual al MD5 de la clave: ' + Object.keys(m.sseC.keyMd5Echo).join(', '));
" "$objects/manifest.json"

# ---------------------------------------------------------------------------------------------------------------------
# 2. `stop` del almacén y `tar` del volumen.
# ---------------------------------------------------------------------------------------------------------------------
say "2. docker compose stop $service"
stopped=1
dc stop "$service" >"$work/stop.log" 2>&1 || { result "no ejecutado: stop $service failed"; exit 1; }
say "   tar of volume $volume with $alpine"
dockerx run --rm -v "$volume:/data:ro" -v "$(hostpath "$work"):/out" "$alpine" tar -C /data -cf /out/vol.tar . \
  >"$work/tar.log" 2>&1 || { result "no ejecutado: tar failed (see $work/tar.log)"; exit 1; }

# ---------------------------------------------------------------------------------------------------------------------
# 3-4 y (c). Lectura del disco.
# ---------------------------------------------------------------------------------------------------------------------
say "3. find-plaintext"
key_text="$k1"
[ "$mode" = sse-c ] && key_text="$ssec_key"
C5_KEY_TEXT="$key_text" node "$here/find-plaintext.mjs" "$(hostpath "$work/vol.tar")" "$(hostpath "$objects")" \
  --json "$(hostpath "$work/plaintext.json")" | sed 's/^/   /'
[ "${PIPESTATUS[0]}" -eq 0 ] || { result "no ejecutado: find-plaintext failed"; exit 1; }
say "4. disk reading"
disk_line="$(node "$helpers" disk "$work/plaintext.json")"
disk=$?
say "   $disk_line"
case $disk in
  0) ;;
  1) result "falla (disco: texto en claro del CV; no se ejecutan (a)-(c))"; exit 1 ;;
  *) result "no concluyente (disco: el control no aparece entero; el método no vale para este producto)"; exit 1 ;;
esac
c_line="$(node "$helpers" key "$work/plaintext.json")"
c=$?
say "   $c_line"
[ "$c" -eq 0 ] || { result "falla ((c): la clave está en el volumen)"; exit 1; }

# ---------------------------------------------------------------------------------------------------------------------
# (b), modo SSE-C: sobre el original rearrancado.
# ---------------------------------------------------------------------------------------------------------------------
if [ "$mode" = sse-c ]; then
  cleanup
  node "$helpers" wait-ready "$wait_timeout" | sed 's/^/   /'
  say "(b) GETs against the original"
  other_key="$(node "$helpers" sse-c-key)"
  node "$helpers" get "$objects" A1 | sed 's/^/   sin clave: /'; a1_none=${PIPESTATUS[0]}
  C5_OTHER_KEY="$other_key" node "$helpers" get "$objects" A1 --sse-c-env C5_OTHER_KEY | sed 's/^/   otra clave: /'
  a1_other=${PIPESTATUS[0]}
  node "$helpers" get "$objects" B1 | sed 's/^/   /'; b1=${PIPESTATUS[0]}
  S3_CV_SSE_C_KEY="$ssec_key" node "$helpers" get "$objects" A1 --sse-c-env S3_CV_SSE_C_KEY | sed 's/^/   con la clave: /'
  a1_key=${PIPESTATUS[0]}
  if [ "$a1_none" -eq 0 ] || [ "$a1_other" -eq 0 ]; then
    result "falla ((b): A1 se lee sin la clave o con otra)"; exit 1
  fi
  if [ "$a1_key" -ne 0 ]; then
    result "falla ((b): con la clave, A1 no vuelve idéntico)"; exit 1
  fi
  if [ "$a1_none" -ne 10 ] || [ "$a1_other" -ne 10 ] || [ "$b1" -ne 0 ]; then
    result "no concluyente ((b): rechazo con bytes, sin respuesta o B1 no leído)"; exit 1
  fi
  result "salida ($disk_line; (b) sin clave y con otra, rechazado sin bytes; B1 leído; con la clave, A1 idéntico; $c_line)"
  exit 0
fi

# ---------------------------------------------------------------------------------------------------------------------
# (b), modo `server`: una copia del volumen, en otro proyecto de Compose, con K2 y después con K1.
# ---------------------------------------------------------------------------------------------------------------------
k2="$(C5_K1="$k1" node "$helpers" k2)" || exit 2
copy="c5copy-$(node -e "process.stdout.write(require('crypto').randomBytes(3).toString('hex'))")"
copy_volume="${copy}_${volume_key}"
dcc() { MSYS_NO_PATHCONV=1 docker compose -p "$copy" -f "$compose" "$@"; }
say "(b) copy project $copy: container created with K2 (same format as K1), volume $copy_volume restored from vol.tar"
OBJECT_STORE_SSE_KEY="$k2" dcc up --no-start --no-deps "$service" >"$work/copy-create.log" 2>&1 \
  || { result "no ejecutado: could not create the copy (see $work/copy-create.log)"; exit 1; }
[ "$(dockerx volume inspect -f '{{.Name}}' "$copy_volume" 2>/dev/null)" = "$copy_volume" ] \
  || { result "no ejecutado: the copy volume $copy_volume was not created"; exit 1; }
[ "$copy_volume" != "$volume" ] || { result "no ejecutado: the copy would mount the original volume"; exit 2; }
# La copia tiene que llevar K2 en la entrada de la clave: si el compose compone el valor con otro texto, pasar K2 por
# `OBJECT_STORE_SSE_KEY` no la deja así y la prueba no mediría lo que dice.
copy_cid="$(dcc ps -a -q "$service")"
dockerx inspect "$copy_cid" >"$work/copy-k2.json" 2>/dev/null
C5_EXPECT="$k2" node "$helpers" env-is "$work/copy-k2.json" "$keyvar" | sed 's/^/   K2 /'
[ "${PIPESTATUS[0]}" -eq 0 ] || { result "no ejecutado: the copy did not get K2 through OBJECT_STORE_SSE_KEY"; exit 2; }
dockerx run --rm -v "$copy_volume:/data" -v "$(hostpath "$work"):/in:ro" "$alpine" tar -C /data -xf /in/vol.tar \
  >"$work/restore.log" 2>&1 || { result "no ejecutado: restore of vol.tar failed (see $work/restore.log)"; exit 1; }

say "(b) K2 on the copy"
# El endpoint tiene que llegar a la copia y no al original: el original sigue detenido.
[ "$(dockerx inspect -f '{{.State.Running}}' "$cid")" = false ] \
  || { result "no ejecutado: the original $service is running during (b)"; exit 1; }
say "   original $service still stopped: the endpoint reaches the copy"
if OBJECT_STORE_SSE_KEY="$k2" dcc up -d --no-deps --wait --wait-timeout "$wait_timeout" "$service" \
  >"$work/copy-k2-up.log" 2>&1; then
  k2_started=1
else
  k2_started=0
fi
if [ "$k2_started" = 1 ]; then
  node "$helpers" wait-ready "$wait_timeout" | sed 's/^/   /'
  [ "${PIPESTATUS[0]}" -eq 0 ] || k2_started=0
fi
# El log de la copia se guarda **después** de los `GET`: en b1, el rechazo de A1 solo puede estar en el log si se lee
# tras pedirlo (corrección posterior a la 3.4; hasta entonces se leía antes y el log de b1 no podía respaldarlo).
k2_a1=-1
k2_b1=-1
k2_log=1
if [ "$k2_started" = 1 ]; then
  say "   K2: started"
  node "$helpers" get "$objects" A1 | sed 's/^/   K2 /'; k2_a1=${PIPESTATUS[0]}
  node "$helpers" get "$objects" B1 | sed 's/^/   K2 /'; k2_b1=${PIPESTATUS[0]}
  dcc logs --no-color "$service" >"$work/copy-k2.log" 2>&1
  # Informativo, no decide (b): las líneas del log de la copia con K2 que nombran la clave o el descifrado.
  C5_K1="$k1" C5_K2="$k2" node "$helpers" log-key-error "$work/copy-k2.log" | sed 's/^/   K2 /'
else
  dcc logs --no-color "$service" >"$work/copy-k2.log" 2>&1
  say "   K2: did not start ($(dcc ps -a --format '{{.State}} {{.Status}}' "$service" 2>/dev/null | head -1))"
  C5_K1="$k1" C5_K2="$k2" node "$helpers" log-key-error "$work/copy-k2.log" | sed 's/^/   K2 /'
  k2_log=${PIPESTATUS[0]}
fi
dcc stop "$service" >/dev/null 2>&1

say "(b) K1 on the same copy (the compose's own key: OBJECT_STORE_SSE_KEY as the compose resolves it)"
if dcc up -d --no-deps --wait --wait-timeout "$wait_timeout" "$service" >"$work/copy-k1-up.log" 2>&1; then
  k1_started=1
else
  k1_started=0
fi
copy_cid="$(dcc ps -a -q "$service")"
dockerx inspect "$copy_cid" >"$work/copy-k1.json" 2>/dev/null
C5_EXPECT="$k1" node "$helpers" env-is "$work/copy-k1.json" "$keyvar" | sed 's/^/   K1 /'
[ "${PIPESTATUS[0]}" -eq 0 ] || { result "no ejecutado: the copy did not get K1"; exit 2; }
if [ "$k1_started" = 1 ]; then
  node "$helpers" wait-ready "$wait_timeout" | sed 's/^/   /'
  [ "${PIPESTATUS[0]}" -eq 0 ] || k1_started=0
fi
k1_a1=-1
k1_b1=-1
if [ "$k1_started" = 1 ]; then
  say "   K1: started"
  node "$helpers" get "$objects" A1 | sed 's/^/   K1 /'; k1_a1=${PIPESTATUS[0]}
  node "$helpers" get "$objects" B1 | sed 's/^/   K1 /'; k1_b1=${PIPESTATUS[0]}
fi
dcc logs --no-color "$service" >"$work/copy-k1.log" 2>&1
if [ "$k1_started" != 1 ]; then
  say "   K1: did not start (see $work/copy-k1.log)"
fi
cleanup

# Clasificación de (b) (design D2): b1, b2, `falla` o `no concluyente`.
if [ "$k2_started" = 1 ] && [ "$k2_a1" -eq 0 ]; then
  result "falla ((b): A1 se lee con K2)"; exit 1
fi
if [ "$k1_started" != 1 ] || [ "$k1_a1" -ne 0 ] || [ "$k1_b1" -ne 0 ]; then
  result "falla ((b): con K1 sobre la misma copia, A1 o B1 no vuelven idénticos)"; exit 1
fi
if [ "$k2_started" = 1 ]; then
  if [ "$k2_b1" -ne 0 ]; then
    result "no concluyente ((b): con K2 arranca y B1 no se lee)"; exit 1
  fi
  if [ "$k2_a1" -ne 10 ]; then
    result "no concluyente ((b): con K2, A1 ni se lee ni se rechaza sin bytes)"; exit 1
  fi
  b="b1 (K2: arranca, A1 rechazado sin bytes, B1 leído; K1 sobre la misma copia: A1 y B1 idénticos)"
else
  if [ "$k2_log" -ne 0 ]; then
    result "no concluyente ((b): con K2 no arranca sin que el log nombre la clave)"; exit 1
  fi
  b="b2 (K2: no arranca y el log nombra la clave; K1 sobre la misma copia: arranca, A1 y B1 idénticos)"
fi
say "(b) $b"
say "(a) with the key in the environment the product uses that key: shown by (b) and (c)"
result "nativo ($disk_line; (b) $b; $c_line)"
exit 0
