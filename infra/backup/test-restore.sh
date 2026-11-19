#!/usr/bin/env bash
# ===================================================================================================================
# Prueba permanente de las guardas de `infra/backup/restore.sh` (ADR-066, design D11; `staging-backups`).
# ===================================================================================================================
# Ejecuta `restore.sh` con un `docker` y un `flock` FALSOS (como `test-run-backup.sh`): registran su `argv` y contestan por guion. Solo
# cubre lo que debe pasar ANTES de tocar nada:
#   - `--project linkvault-prod` sin escribir «CD DESACTIVADO»: sale 3 y no hay NINGUNA llamada a `docker`;
#   - el guardia «nunca en la PC del owner» (B1): un repositorio remoto sin `.env.staging` y sin `--confirm-host` sale 4, sin `docker`;
#   - una `api` de staging con la etiqueta `:latest` se rechaza, sin parar nada;
#   - un segundo manifiesto de la misma corrida es un error, sin parar nada.
# La restauración completa se prueba con Docker real (ver las tareas 6.x de `tasks.md`). Uso: `bash infra/backup/test-restore.sh`.
# ===================================================================================================================
set -uo pipefail

here="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
script="$here/restore.sh"
[ -f "$script" ] || { printf '[FAIL] no encuentro %s\n' "$script" >&2; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

cat >"$tmp/bin/docker" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_LOG"
if [ "${1:-}" = inspect ]; then printf '%s\n' "${FAKE_IMAGE:-ghcr.io/x/linkvault-api:sha-0123456789ab}"; exit 0; fi
case " $* " in
  *" ps -q api"*) echo cid-api; exit 0 ;;
  *" backup-push snapshots "*) printf '%s\n' "${FAKE_SNAPS:-[]}"; exit 0 ;;
esac
exit 0
FAKE
cat >"$tmp/bin/flock" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE
chmod +x "$tmp/bin/"*

H64a="$(printf 'a%.0s' $(seq 1 64))"
H64b="$(printf 'b%.0s' $(seq 1 64))"
RUN='20260101T000000Z'
snap() { printf '{"time":"2026-01-01T00:00:00Z","tags":["kind:manifest","run:%s"],"id":"%s","short_id":"x"}' "$RUN" "$1"; }
TWO_MANIFESTS="[$(snap "$H64a"),$(snap "$H64b")]"

case_dir=''
new_case() {
  case_dir="$tmp/$1"
  mkdir -p "$case_dir/root/infra" "$case_dir/state"
  printf 'name: linkvault-prod\n' >"$case_dir/root/docker-compose.prod.yml"
  cp -R "$here" "$case_dir/root/infra/backup"
  printf 'BACKUP_OCI_REPOSITORY=/repo/oci\n' >"$case_dir/root/.env.staging"
  : >"$case_dir/state/log"
}
code=0
# run_case <stdin> <env…> -- <argumentos de restore.sh>
run_case() {
  local input="$1"
  shift
  local -a envs=()
  while [ "$1" != -- ]; do envs+=("$1"); shift; done
  shift
  printf '%s\n' "$input" | env PATH="$tmp/bin:$PATH" FAKE_LOG="$case_dir/state/log" BACKUP_ROOT="$case_dir/root" "${envs[@]}" \
    timeout 30 bash "$script" "$@" >"$case_dir/out" 2>"$case_dir/err"
  code=$?
}

cases=0
failures=0
check() {
  cases=$((cases + 1))
  if [ "$2" -eq 0 ]; then printf '  ok   %s\n' "$1"; else failures=$((failures + 1)); printf '  FAIL %s%s\n' "$1" "${3:+ — $3}"; fi
}
no_docker() { [ ! -s "$case_dir/state/log" ]; }
called() { grep -q -- "$1" "$case_dir/state/log"; }

printf 'restore: guardas previas\n'

new_case cd
run_case 'nada' X=1 -- --project linkvault-prod --from oci
[ "$code" -eq 3 ] && no_docker
check 'restore on linkvault-prod without CD DESACTIVADO exits 3 touching no docker' $? "código $code; docker: $(head -c 120 "$case_dir/state/log")"

new_case b1
rm -f "$case_dir/root/.env.staging"
run_case '' BACKUP_OCI_REPOSITORY=s3:https://example.invalid/x -- --project sbk-test --from oci
[ "$code" -eq 4 ] && no_docker
check 'restore refuses a remote repository without host env file or --confirm-host (exit 4)' $? "código $code"

new_case latest
run_case '' FAKE_IMAGE=ghcr.io/x/linkvault-api:latest -- --project sbk-test --from oci
[ "$code" -ne 0 ] && grep -q 'sha-' "$case_dir/err" && ! called ' stop '
check 'restore refuses when staging api is :latest and stops nothing' $? "código $code; $(tail -n 1 "$case_dir/err" | cut -c1-150)"

new_case dup
run_case '' "FAKE_SNAPS=$TWO_MANIFESTS" -- --project sbk-test --from oci
[ "$code" -ne 0 ] && grep -q '2 instantáneas de tipo manifest' "$case_dir/err" && ! called ' stop '
check 'restore errors on a second manifest of the same run before stopping anything' $? "código $code; $(tail -n 1 "$case_dir/err" | cut -c1-150)"

printf '\nrestore: %s casos, %s fallos\n' "$cases" "$failures"
[ "$failures" -eq 0 ]
