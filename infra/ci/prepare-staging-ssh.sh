#!/usr/bin/env bash
# ===================================================================================================================
# Prepara la conexión SSH del despliegue a staging: valida el destino por lista blanca y escribe la clave privada y un
# `known_hosts` con la clave del host fijada (design D3 de `staging-host`, tarea 3.4).
# ===================================================================================================================
# Los valores llegan por `env:` (nunca interpolados en el texto de un `run:`) y se tratan como **datos**, pero `ssh`
# interpreta como opción un destino que empiece por `-` (`-oProxyCommand=…` ejecutaría algo en el corredor) y una clave
# del host con un salto de línea añadiría líneas arbitrarias a `known_hosts`. Rechazar lo peligroso conocido deja pasar
# lo que no se ha pensado, así que aquí se **acepta solo lo conocido**:
#   STAGING_HOST          IPv4 o nombre DNS por etiquetas.
#   STAGING_SSH_USER      nombre de usuario POSIX.
#   STAGING_SSH_HOST_KEY  `ssh-ed25519 <base64>`, una sola línea (la clave pública del host, no su huella).
# Las expresiones se evalúan con `[[ … =~ … ]]` y `LC_ALL=C`: `^` y `$` anclan a la cadena entera, así que un salto de
# línea en medio no pasa. Un fallo nombra la **variable**, nunca su valor.
#
# Escribe, con `umask 077`, `<dir>/key` (STAGING_SSH_KEY) y `<dir>/known_hosts` (`<host> <clave del host>`), donde
# `<dir>` es `SSH_DIR` (por defecto `$RUNNER_TEMP/staging-ssh`). Cada `ssh` del job usa
#   -o StrictHostKeyChecking=yes -o UserKnownHostsFile=<dir>/known_hosts -o BatchMode=yes -o IdentitiesOnly=yes -i <dir>/key
# ===================================================================================================================
set -euo pipefail
export LC_ALL=C

reject() {
  # Solo el nombre de la variable: su valor es un secreto o puede serlo.
  printf '::error::%s no tiene una forma válida (%s); no se usa\n' "$1" "$2" >&2
  exit 1
}

host="${STAGING_HOST:-}"
user="${STAGING_SSH_USER:-}"
key="${STAGING_SSH_KEY:-}"
host_key="${STAGING_SSH_HOST_KEY:-}"

ipv4='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
dns_name='^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$'
if ! [[ "$host" =~ $ipv4 ]] && ! [[ "$host" =~ $dns_name ]]; then
  reject STAGING_HOST 'se espera una IPv4 o un nombre DNS'
fi
[[ "$user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || reject STAGING_SSH_USER 'se espera un nombre de usuario POSIX'
[[ "$host_key" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+={0,3}$ ]] ||
  reject STAGING_SSH_HOST_KEY 'se espera "ssh-ed25519 <base64>" en una sola línea'
[ -n "${key//[[:space:]]/}" ] || reject STAGING_SSH_KEY 'está vacía'

dir="${SSH_DIR:-${RUNNER_TEMP:?RUNNER_TEMP o SSH_DIR}/staging-ssh}"
umask 077
mkdir -p -- "$dir"
printf '%s\n' "$key" >"$dir/key"
printf '%s %s\n' "$host" "$host_key" >"$dir/known_hosts"
printf 'ssh: destino validado; clave y known_hosts escritos en %s\n' "$dir"
