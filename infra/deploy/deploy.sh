#!/usr/bin/env bash
# ===================================================================================================================
# Despliegue en el host de staging de un commit ya verificado y publicado (design D3 y D4 de `staging-host`, tarea 4.4).
# ===================================================================================================================
# Corre **en el host**, desde el árbol `.incoming-<sha12>/` que el corredor copió con `tar | ssh`; en el host no hay
# repositorio, así que todo lo que usa viaja en `infra/deploy/config-files.txt` o llega como argumento. Se invoca con
# `bash` (no depende del bit de ejecución, que `tar` sin `-p` no garantiza):
#
#   printf '%s\n%s\n' "$GHCR_READ_USER" "$GHCR_READ_TOKEN" |
#     ssh … "bash <dir fijo>/.incoming-<sha12>/infra/deploy/deploy.sh <tag> <plazo> <digest del almacén>"
#
# Argumentos (los tres se validan **antes de cualquier llamada a `docker`**):
#   <tag>     `sha-<12 hexadecimales>`, la imagen verificada y publicada por la corrida.
#   <plazo>   segundos del `up --wait`, leídos por el corredor de `infra/ci/verify-artifact.sh` (`WAIT_TIMEOUT`).
#   <digest>  digest del índice de la imagen del almacén que midió la matriz (ADR-052 «Elección»).
# Entrada estándar: usuario y token de lectura del registro, uno por línea. El token **nunca** va en argumentos: los ve
# cualquiera que liste los procesos del host (tarea 6.5); el usuario tampoco, porque es el valor de un secreto y la
# shell remota interpretaría la orden antes de que nada lo validara (design D3).
#
# Orden (design D4): login → plataformas → digest del almacén → `pull` con el compose de `.incoming` → instalación →
# `up` con el compose **instalado** → `object-store.js provision` → `verify` → `logout` (en `trap`, también en error).
# Todo lo que puede fallar por el registro falla **antes** de tocar la configuración instalada.
# ===================================================================================================================
set -euo pipefail

fail() {
  printf 'deploy: %s\n' "$1" >&2
  exit 1
}

tag="${1:-}"
wait_timeout="${2:-}"
store_digest="${3:-}"
[ "$#" -eq 3 ] || { printf 'deploy: uso: deploy.sh <tag> <plazo> <digest del almacén>\n' >&2; exit 2; }
[[ "$tag" =~ ^sha-[0-9a-f]{12}$ ]] || { printf 'deploy: tag no válido: %s\n' "$tag" >&2; exit 2; }
[[ "$wait_timeout" =~ ^[0-9]{2,4}$ ]] || { printf 'deploy: plazo no válido: %s\n' "$wait_timeout" >&2; exit 2; }
[[ "$store_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { printf 'deploy: digest del almacén no válido: %s\n' "$store_digest" >&2; exit 2; }

script_dir="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
incoming="$(cd "$script_dir/../.." && pwd)"
[[ "${incoming##*/}" =~ ^\.incoming-[0-9a-f]{12}$ ]] || fail "no se ejecuta desde un .incoming-<sha12>: $incoming"
staging_dir="${incoming%/*}"
incoming_compose="$incoming/docker-compose.prod.yml"
env_file="$staging_dir/.env.staging"
[ -f "$env_file" ] || fail "falta $env_file en el directorio fijo"

# Las dos líneas de la entrada estándar. `read` devuelve ≠0 ante una última línea sin salto; el corredor la termina.
IFS= read -r registry_user || fail 'no llegó el usuario del registro por la entrada estándar'
IFS= read -r registry_token || fail 'no llegó el token del registro por la entrada estándar'
[ -n "$registry_user" ] && [ -n "$registry_token" ] || fail 'usuario o token del registro vacíos'

trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
# `printf` es un builtin: el token pasa por una tubería, no por los argumentos de ningún proceso.
printf '%s' "$registry_token" | docker login ghcr.io -u "$registry_user" --password-stdin >/dev/null ||
  fail 'docker login en ghcr.io falló'
unset registry_token

# Las imágenes de la aplicación del commit verificado (el compose las nombra con IMAGE_TAG).
export IMAGE_TAG="$tag"

# --- Plataformas (script de `object-store`, ADR-051 §3): antes de descargar nada --------------------------------
platform_status=0
bash "$incoming/infra/deploy/check-image-platforms.sh" --compose "$incoming_compose" --env-file "$env_file" ||
  platform_status=$?
case "$platform_status" in
  0) ;;
  3) fail 'alguna imagen no existe para la arquitectura del host (check-image-platforms salió 3): no se descarga nada' ;;
  *) fail "no se pudieron comprobar las plataformas (check-image-platforms salió $platform_status): no se descarga nada" ;;
esac

# --- Digest del almacén: la imagen que midió la matriz, no otra (design D4) ------------------------------------------
# Con un servicio nombrado, Compose añade las imágenes de sus `depends_on`: una segunda línea significa que la lectura
# ya no identifica la imagen, y entonces no se elige ninguna.
store_images=()
while IFS= read -r line; do
  line="${line%$'\r'}"
  [ -n "$line" ] && store_images+=("$line")
done < <(docker compose -f "$incoming_compose" --env-file "$env_file" config --images object-store)
if [ "${#store_images[@]}" -ne 1 ]; then
  fail "config --images object-store dio ${#store_images[@]} líneas, se esperaba exactamente una: ${store_images[*]:-ninguna}"
fi
store_image="${store_images[0]}"
actual_digest="$(docker buildx imagetools inspect "$store_image" --format '{{.Manifest.Digest}}')"
actual_digest="${actual_digest//$'\r'/}"
if [ "$actual_digest" != "$store_digest" ]; then
  fail "la imagen del almacén $store_image tiene el digest $actual_digest y la matriz midió $store_digest: no se despliega"
fi
printf 'almacén: %s @ %s (el medido)\n' "$store_image" "$actual_digest"

# --- Descarga con el compose nuevo; instalación; arranque con el instalado ----------------------------------------
docker compose -f "$incoming_compose" --env-file "$env_file" pull || fail 'el pull falló: no se instala nada'
bash "$incoming/infra/deploy/install-config.sh" "$staging_dir"

# El `up` usa el compose **instalado**: el directorio del proyecto (nombre, volúmenes, montajes relativos) es el del
# primer `-f`, y uno de `.incoming` crearía otro proyecto con volúmenes vacíos (design D4).
cd "$staging_dir"
up_status=0
docker compose -f docker-compose.prod.yml --env-file .env.staging up -d --wait --wait-timeout "$wait_timeout" ||
  up_status=$?
if [ "$up_status" -ne 0 ]; then
  printf 'deploy: la pila no quedó sana en %s s (up salió %s)\n' "$wait_timeout" "$up_status" >&2
  docker compose -f docker-compose.prod.yml --env-file .env.staging ps --all || true
  docker compose -f docker-compose.prod.yml --env-file .env.staging logs --no-color --tail=200 api worker web || true
  exit 1
fi

# --- Almacén: el arranque documentado de `object-store`, con la imagen de `api` recién descargada ----------------
docker compose -f docker-compose.prod.yml --env-file .env.staging run --rm --no-deps api node object-store.js provision ||
  fail 'object-store.js provision falló (la pila nueva ya está arriba: ver la vuelta atrás del RUNBOOK)'
docker compose -f docker-compose.prod.yml --env-file .env.staging run --rm --no-deps api node object-store.js verify ||
  fail 'object-store.js verify falló (la pila nueva ya está arriba: ver la vuelta atrás del RUNBOOK)'

printf 'deploy: %s desplegado\n' "$tag"
