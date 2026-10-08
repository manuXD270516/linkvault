#!/usr/bin/env bash
# ===================================================================================================================
# Semilla de volumen para probar la medición (design D17 de `staging-host`, tareas 10.3b-10.3e).
# ===================================================================================================================
# SOLO contra un Mongo local y desechable. NUNCA contra staging ni producción. Se ejecuta en la máquina donde corre; no
# tiene camino `ssh`:
#
#   bash infra/staging/seed-volume.sh <seed|clean|expect|digest> [--scale N] [--seed N] [--batch <lote>] \
#        [--anchor <ISO>] [--container <nombre>]
#
#   --scale N        entero de 1 a 50 (por defecto 1)
#   --seed N         entero de 32 bits sin signo (por defecto 35)
#   --batch <lote>   ^[a-z0-9][a-z0-9-]{0,30}$ (por defecto vol)
#   --anchor <ISO>   fecha ISO UTC, AAAA-MM-DDThh:mm:ssZ (por defecto 2026-10-01T00:00:00Z)
#   --container <c>  contenedor de Mongo; sin él, el del servicio `mongo` de `docker-compose.yml` en el proyecto de
#                    Compose activo: el de `COMPOSE_PROJECT_NAME` si está en el entorno (gana sobre el `name:` del
#                    fichero) y, si no, el del fichero. Con una pila ajena en marcha, pasa --container o el proyecto
#
# Ejecuta `docker exec -i <contenedor> mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet
# --eval "globalThis.LV_SEED={…}" /dev/stdin < infra/staging/seed-volume.mongosh.js`.
#
# Guardias (fallan cerradas, antes de escribir nada; salen 2 nombrando la causa):
#   1. `DOCKER_HOST` que no sea el socket o la tubería local, o contexto de Docker activo que no sea local;
#   2. contenedor con `docker-compose.prod.yml` en la etiqueta `com.docker.compose.project.config_files` (el compose de
#      staging y producción) o cuya imagen no sea `mongo:`;
#   3. el script se niega sin `LV_SEED.guard === 'local-synthetic-only'`, que solo pone este envoltorio;
#   4. `infra/staging/run.sh` rechaza el script por sus escrituras y no abre `ssh`.
# Los parámetros se validan antes de llamar a `docker`.
#
# Salidas: la de `mongosh` (0 si terminó); 2 por un parámetro, una guardia o un error de uso.
# ===================================================================================================================
set -euo pipefail

# Git Bash en Windows convierte los argumentos que empiezan por `/` (como `/dev/stdin`) en rutas de Windows.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

fail() {
  printf 'seed-volume.sh: %s\n' "$1" >&2
  exit 2
}

here="$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)"
script="$here/seed-volume.mongosh.js"

[ "$#" -ge 1 ] || fail 'uso: bash infra/staging/seed-volume.sh <seed|clean|expect|digest> [--scale N] [--seed N] [--batch <lote>] [--anchor <ISO>] [--container <nombre>]'
mode="$1"
shift
case "$mode" in
  seed | clean | expect | digest) ;;
  *) fail "modo no válido: $mode (seed, clean, expect o digest)" ;;
esac

scale=1
seed=35
batch=vol
anchor=2026-10-01T00:00:00Z
container=''
while [ "$#" -gt 0 ]; do
  flag="$1"
  case "$flag" in
    --scale | --seed | --batch | --anchor | --container) ;;
    *) fail "parámetro desconocido: $flag" ;;
  esac
  [ "$#" -ge 2 ] || fail "$flag necesita un valor"
  value="$2"
  case "$flag" in
    --scale) scale="$value" ;;
    --seed) seed="$value" ;;
    --batch) batch="$value" ;;
    --anchor) anchor="$value" ;;
    --container) container="$value" ;;
  esac
  shift 2
done

# 1. Parámetros, antes de llamar a `docker`.
[[ "$scale" =~ ^[1-9][0-9]{0,2}$ ]] && [ "$scale" -le 50 ] ||
  fail "--scale tiene que ser un entero de 1 a 50 (recibido: $scale)"
[[ "$seed" =~ ^(0|[1-9][0-9]{0,9})$ ]] && [ "$seed" -le 4294967295 ] ||
  fail "--seed tiene que ser un entero de 32 bits sin signo (recibido: $seed)"
[[ "$batch" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] ||
  fail "--batch tiene que casar con ^[a-z0-9][a-z0-9-]{0,30}\$ (recibido: $batch)"
[[ "$anchor" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] && date -u -d "$anchor" +%s >/dev/null 2>&1 ||
  fail "--anchor tiene que ser una fecha ISO UTC AAAA-MM-DDThh:mm:ssZ (recibido: $anchor)"
if [ -n "$container" ]; then
  [[ "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] ||
    fail "--container no es un nombre de contenedor válido (recibido: $container)"
fi
[ -f "$script" ] && [ -r "$script" ] || fail "no se puede leer $script"

# 2. Guardia 1: solo el Docker local. Sin `ssh`, ni `DOCKER_HOST` remoto, ni un contexto que apunte a otra máquina.
is_local_endpoint() {
  case "$1" in
    unix://* | npipe://*) return 0 ;;
    *) return 1 ;;
  esac
}
if [ -n "${DOCKER_HOST:-}" ]; then
  is_local_endpoint "$DOCKER_HOST" ||
    fail "DOCKER_HOST no es local ($DOCKER_HOST): esta semilla solo se ejecuta contra el Docker de esta máquina"
else
  endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)" ||
    fail 'no se pudo leer el contexto de Docker activo (docker context inspect)'
  endpoint="${endpoint%$'\r'}"
  is_local_endpoint "$endpoint" ||
    fail "el contexto de Docker activo no es local ($endpoint): esta semilla solo se ejecuta contra el Docker de esta máquina"
fi

# 3. Contenedor: el pedido o el del servicio `mongo` de docker-compose.yml.
if [ -z "$container" ]; then
  # La raíz está dos niveles por encima (infra/staging). `pwd -W` da la ruta de Windows que entiende docker.exe en Git
  # Bash; en Linux no existe y cae en `pwd -P`.
  repo="$(cd "$here/../.." && { pwd -W 2>/dev/null || pwd -P; })" || fail 'no se encuentra la raíz del repositorio'
  container="$(docker compose -f "$repo/docker-compose.yml" ps -q mongo 2>/dev/null | head -n 1)" || true
  container="${container%$'\r'}"
  [ -n "$container" ] ||
    fail 'no hay contenedor del servicio mongo de docker-compose.yml: levántalo o pasa --container <nombre>'
fi

# 4. Guardia 2: etiquetas de Compose e imagen del contenedor.
inspected="$(docker inspect --format '{{range $k, $v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}image={{.Config.Image}}' "$container" 2>/dev/null)" ||
  fail "no se pudo inspeccionar el contenedor $container (docker inspect)"
inspected="${inspected//$'\r'/}"
config_files=''
image=''
while IFS= read -r line; do
  case "$line" in
    com.docker.compose.project.config_files=*) config_files="${line#*=}" ;;
    image=*) image="${line#image=}" ;;
  esac
done <<<"$inspected"
case "$config_files" in
  *docker-compose.prod.yml*)
    fail "el contenedor $container se levantó con docker-compose.prod.yml ($config_files): es el compose de staging y producción; esta semilla no se ejecuta ahí"
    ;;
esac
case "$image" in
  mongo:*) ;;
  *) fail "el contenedor $container no es una imagen mongo: (imagen: ${image:-desconocida})" ;;
esac

# 5. Ejecución. `void 0` evita que `--eval` imprima el valor asignado antes de la salida del script.
eval_params="globalThis.LV_SEED={mode:'$mode',scale:$scale,seed:$seed,batch:'$batch',anchor:'$anchor',guard:'local-synthetic-only'};void 0"
exec docker exec -i "$container" mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet \
  --eval "$eval_params" /dev/stdin <"$script"
