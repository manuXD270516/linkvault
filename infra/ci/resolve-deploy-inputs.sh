#!/usr/bin/env bash
# ===================================================================================================================
# Lo que la orden remota del despliegue a staging necesita y no es un secreto (design D3 y D4 de `staging-host`,
# tarea 4.5): `<sha12>`, el plazo de arranque y el digest del almacén, leídos y **validados en el corredor** antes de
# ponerlos en ninguna orden.
# ===================================================================================================================
#   sha12   los 12 primeros caracteres de `GIT_SHA` (de `github.sha`), contra `^[0-9a-f]{12}$`. Es el único trozo de
#           la orden remota que no es una constante del workflow ni un argumento ya validado.
#   timeout la línea `WAIT_TIMEOUT="${VERIFY_WAIT_TIMEOUT:-<n>}"` de `infra/ci/verify-artifact.sh` (la que 35a
#           recalcula), contra `^[0-9]{2,4}$`. Se lee aquí porque `verify-artifact.sh` no viaja al host.
#   digest  la línea `Digest del índice: sha256:<64 hexadecimales>` de `docs/adr/ADR-052.md` «Elección»: exactamente
#           una vez. ADR-052 no viaja al host; viaja el valor.
# Cada valor ausente, repetido o fuera de su forma es un fallo que lo nombra. Escribe `sha12`, `timeout` y `digest` en
# `GITHUB_OUTPUT` si existe. `VERIFY_SCRIPT` y `ADR_FILE` permiten ejercitarlo en local contra copias.
# ===================================================================================================================
set -euo pipefail
export LC_ALL=C

fail() {
  printf '::error::%s\n' "$1" >&2
  exit 1
}

root="${BASH_SOURCE[0]%/*}/../.."
verify_script="${VERIFY_SCRIPT:-$root/infra/ci/verify-artifact.sh}"
adr_file="${ADR_FILE:-$root/docs/adr/ADR-052.md}"

sha="${GIT_SHA:-}"
sha12="${sha:0:12}"
[[ "$sha12" =~ ^[0-9a-f]{12}$ ]] || fail "GIT_SHA no empieza por 12 hexadecimales: no se monta la orden remota"

timeout=''
timeout_lines=0
while IFS= read -r line || [ -n "$line" ]; do
  if [[ "$line" =~ ^WAIT_TIMEOUT=\"\$\{VERIFY_WAIT_TIMEOUT:-([0-9]+)\}\"$ ]]; then
    timeout="${BASH_REMATCH[1]}"
    timeout_lines=$((timeout_lines + 1))
  fi
done <"$verify_script"
[ "$timeout_lines" -eq 1 ] ||
  fail "la línea WAIT_TIMEOUT de $verify_script aparece $timeout_lines veces; se esperaba exactamente una"
[[ "$timeout" =~ ^[0-9]{2,4}$ ]] || fail "el plazo de arranque de $verify_script no tiene 2 a 4 cifras: $timeout"

digest=''
digest_lines=0
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  if [[ "$line" =~ ^Digest\ del\ índice:\ (sha256:[0-9a-f]{64})$ ]]; then
    digest="${BASH_REMATCH[1]}"
    digest_lines=$((digest_lines + 1))
  fi
done <"$adr_file"
[ "$digest_lines" -eq 1 ] ||
  fail "la línea «Digest del índice: sha256:…» de $adr_file aparece $digest_lines veces; se esperaba exactamente una"

printf 'sha12=%s\ntimeout=%s\ndigest=%s\n' "$sha12" "$timeout" "$digest"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'sha12=%s\ntimeout=%s\ndigest=%s\n' "$sha12" "$timeout" "$digest" >>"$GITHUB_OUTPUT"
fi
