#!/usr/bin/env bash
# ===================================================================================================================
# ¿Existen las imágenes para la plataforma del destino? Se pregunta al registro **antes** de descargar nada.
# ===================================================================================================================
# Change `object-store` (fila 35a), design D9; ADR-052 §9; requirement «Las imágenes de la pila se pueden descargar en
# la arquitectura del destino» (`platform/production-deploy`). Lo invocan `infra/ci/verify-artifact.sh` (imágenes de
# terceros, antes del `pull`) y el `deploy.sh` de 35b (después del login y antes del `pull`).
#
# Solo bash y Docker (`docker buildx imagetools`): el host de staging no tiene `node` ni `jq`.
#
# Uso:
#   infra/deploy/check-image-platforms.sh [--platform <os>/<arch>] <imagen>...
#   infra/deploy/check-image-platforms.sh [--platform <os>/<arch>] --compose <fichero> --env-file <fichero>
# Sin `--platform`, la del daemon (`docker version --format '{{.Server.Os}}/{{.Server.Arch}}'`). Solo `os/arch`,
# **sin variantes**: una `--platform` con variante es uso incorrecto. Con `--compose`, las imágenes salen de
# `docker compose -f <fichero> --env-file <fichero> config --images`.
#
# --- Salidas --------------------------------------------------------------------------------------------------------
#   0  todas las imágenes existen para la plataforma pedida.
#   3  alguna **no existe para esa plataforma**: falta en su índice, su manifiesto único es de otra, o el registro dice
#      que la etiqueta no existe. Es un defecto del compose o del artefacto (clase `artifact`). Nombra imagen,
#      plataforma pedida y las que existen.
#   4  alguna **no se pudo comprobar** (DNS, conexión, `401`, `403`, `429` y todo error no clasificado). Lo desconocido
#      no se atribuye a la imagen: quien llama reintenta y, agotado, lo trata como del entorno.
#   2  uso incorrecto.
# Con imágenes en 3 y otras en 4 sale 3: la ausencia ya demostrada es del artefacto y reintentar no la arregla.
#
# --- Clasificación, medida en la tarea 2.14 de `object-store` (`docs/object-store-matrix/matriz.md`) --------------
# `imagetools inspect` sale con 1 en todos los errores medidos, así que el código no distingue nada: decide el stderr.
#   `ERROR: <ref>: not found`                         etiqueta inexistente (Docker Hub y GHCR) → 3
#   `… failed to fetch anonymous token: … 401 …`      imagen privada sin sesión                  → 4
#   `… failed to fetch anonymous token: … 403 …`      repositorio inexistente en GHCR, sin sesión → 4
#   `pull access denied, repository does not exist or may require authorization …`
#                                                     repositorio inexistente en Docker Hub     → 4
#   `… dial tcp: lookup <host>: no such host`         nombre que no resuelve                    → 4
# Un repositorio inexistente no se distingue de uno privado (el registro no lo dice): cae en 4, no en 3.
#
# --- Plantilla, medida en la misma tarea --------------------------------------------------------------------------
# Con un manifiesto único, `.Manifest` no tiene `Manifests` y un `range` sobre él falla (exit 1), así que la plantilla
# decide por el tipo de medio: en un índice (OCI o lista de Docker) lista la plataforma de cada entrada; en un
# manifiesto único, la de su configuración. Las entradas de atestación salen como `unknown/unknown` y se ignoran.
# ===================================================================================================================
set -uo pipefail

readonly INDEX_TEMPLATE='{{if or (eq .Manifest.MediaType "application/vnd.oci.image.index.v1+json") (eq .Manifest.MediaType "application/vnd.docker.distribution.manifest.list.v2+json")}}{{range .Manifest.Manifests}}{{with .Platform}}{{.OS}}/{{.Architecture}}{{"\n"}}{{end}}{{end}}{{else}}{{.Image.OS}}/{{.Image.Architecture}}{{"\n"}}{{end}}'

usage() {
  echo "check-image-platforms: $1" >&2
  echo "uso: $0 [--platform <os>/<arch>] (<imagen>... | --compose <fichero> --env-file <fichero>)" >&2
  exit 2
}

platform=''
compose=''
env_file=''
images=()
while [ $# -gt 0 ]; do
  case "$1" in
    --platform)
      [ $# -ge 2 ] || usage '--platform necesita un valor'
      platform="$2"; shift 2 ;;
    --compose)
      [ $# -ge 2 ] || usage '--compose necesita un fichero'
      compose="$2"; shift 2 ;;
    --env-file)
      [ $# -ge 2 ] || usage '--env-file necesita un fichero'
      env_file="$2"; shift 2 ;;
    -*)
      usage "opción desconocida: $1" ;;
    *)
      images+=("$1"); shift ;;
  esac
done

if [ -n "$compose" ] || [ -n "$env_file" ]; then
  [ -n "$compose" ] && [ -n "$env_file" ] || usage '--compose y --env-file van juntos'
  [ ${#images[@]} -eq 0 ] || usage 'o imágenes como argumentos o --compose, no las dos cosas'
  [ -f "$compose" ] || usage "no existe el compose: $compose"
  [ -f "$env_file" ] || usage "no existe el fichero de entorno: $env_file"
elif [ ${#images[@]} -eq 0 ]; then
  usage 'faltan las imágenes'
fi

if [ -n "$platform" ]; then
  [[ "$platform" =~ ^[a-z0-9]+/[a-z0-9_]+$ ]] || usage "plataforma no válida (solo <os>/<arch>, sin variante): $platform"
else
  if ! platform="$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}' 2>&1)"; then
    echo "check-image-platforms: no se pudo leer la plataforma del daemon: $platform" >&2
    exit 4
  fi
  platform="${platform//$'\r'/}"
  [[ "$platform" =~ ^[a-z0-9]+/[a-z0-9_]+$ ]] || { echo "check-image-platforms: plataforma del daemon ilegible: $platform" >&2; exit 4; }
fi

if [ -n "$compose" ]; then
  if ! listed="$(docker compose -f "$compose" --env-file "$env_file" config --images 2>&1)"; then
    echo "check-image-platforms: no se pudieron resolver las imágenes de $compose: $listed" >&2
    exit 4
  fi
  while IFS= read -r line; do
    line="${line%$'\r'}"
    [ -n "$line" ] && images+=("$line")
  done <<< "$listed"
  [ ${#images[@]} -gt 0 ] || { echo "check-image-platforms: $compose no declara ninguna imagen" >&2; exit 4; }
fi

missing=0
unknown=0
for image in "${images[@]}"; do
  if ! out="$(docker buildx imagetools inspect "$image" --format "$INDEX_TEMPLATE" 2>&1)"; then
    last="${out//$'\r'/}"
    last="${last##*$'\n'}"
    if [[ "$last" =~ ^ERROR:\ .+:\ not\ found$ ]]; then
      echo "no existe: $image (pedida $platform): el registro no tiene esa etiqueta ($last)"
      missing=1
    else
      echo "no se pudo comprobar: $image: $last"
      unknown=1
    fi
    continue
  fi
  available=()
  found=0
  while IFS= read -r p; do
    p="${p%$'\r'}"
    case "$p" in ''|unknown/unknown) continue ;; esac
    available+=("$p")
    [ "$p" = "$platform" ] && found=1
  done <<< "$out"
  if [ "$found" -eq 1 ]; then
    echo "ok: $image ($platform)"
  else
    echo "no existe para $platform: $image (disponibles: ${available[*]:-ninguna})"
    missing=1
  fi
done

[ "$missing" -eq 1 ] && exit 3
[ "$unknown" -eq 1 ] && exit 4
exit 0
