#!/usr/bin/env bash
# ===================================================================================================================
# Prueba permanente de `infra/backup/run-backup.sh` (tareas 4.7a y 4.7b de `staging-backups`; ADR-066).
# ===================================================================================================================
# Ejecuta el orquestador con un `docker`, un `curl` y un `flock` FALSOS (como `infra/ci/test-report-cd-outcome.sh`): los falsos
# registran su `argv` y contestan por guion (variables `FAKE_*`). Lo que se comprueba es el orden de las órdenes, los avisos y
# lo que NO debe pasar:
#   - cada `run` lleva `--rm --no-deps -T` (sin `-T` la tubería se corrompe; sin `--no-deps`, `run` toca la pila);
#   - las órdenes se ejecutan desde la copia `.backup-run-<id>/` y la última línea del script es `main "$@"; exit $?`;
#   - el script no contiene `set -x` y un MARCADOR BINARIO que el `docker` falso emite en los flujos no aparece ni en la
#     salida estándar ni en la de errores del orquestador;
#   - ninguna credencial ni la dirección del monitor aparecen en el `argv` de `docker` ni de `curl`;
#   - el manifiesto se envía al final, solo si las dos pasadas terminaron, con las sumas que el host midió.
# No necesita `docker`, red ni `flock` reales. Uso: `bash infra/backup/test-run-backup.sh` (sale 0 si todos los casos pasan; la
# última línea dice cuántos corrió). El caso del candado REAL solo corre donde hay `flock`.
# ===================================================================================================================
set -uo pipefail

here="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
script="$here/run-backup.sh"
[ -f "$script" ] || { printf '[FAIL] no encuentro %s\n' "$script" >&2; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

# --- Falsos -----------------------------------------------------------------------------------------------------------------
cat >"$tmp/bin/docker" <<'FAKE'
#!/usr/bin/env bash
printf '%s\t%s\n' "$PWD" "$*" >>"$FAKE_LOG"
if [ "${1:-}" = inspect ]; then printf '%s\n' "${FAKE_HEALTH:-healthy}"; exit 0; fi
[ "${1:-}" = compose ] || exit 0
args=" $* "
state="$FAKE_STATE"
dest=''
case "${BACKUP_DEST_REPOSITORY:-}" in */oci) dest=oci ;; */offsite) dest=offsite ;; esac
case "$args" in
  *" ps -q "*) echo cid-fake; exit 0 ;;
  *" config --images "*) printf '%s\n' 'mongo:7.0.43@sha256:aaa' 'rclone/rclone:1.70.3@sha256:bbb' 'restic/restic:0.18.1@sha256:ccc'; exit 0 ;;
  *" pull "*) exit 0 ;;
  *" exec "*) cat >/dev/null; exit "${FAKE_ENSURE_EXIT:-0}" ;;
  *" run "*) ;;
  *) exit 0 ;;
esac
svc=''
rest=()
found=0
for a in "$@"; do
  if [ "$found" -eq 1 ]; then rest+=("$a"); continue; fi
  case "$a" in backup-mongo | backup-objects | backup-push) svc="$a"; found=1 ;; esac
done
marker() { printf 'HEAD\000\001LV-MARKER-7f3c9e\376\377TAIL'; }
case "$svc" in
  backup-mongo)
    marker
    head -c "${FAKE_STREAM_BYTES:-2000}" /dev/zero | tr '\0' 'm'
    exit "${FAKE_MONGO_EXIT:-0}"
    ;;
  backup-objects)
    case "$args" in
      *"list-objects.sh"*) printf '%s\n' '{"cvs":{"count":2,"objects":[{"Path":"a.pdf","MimeType":"application/pdf"}]},"snapshots":{"count":1,"objects":[]}}'; exit 0 ;;
    esac
    marker
    head -c "${FAKE_STREAM_BYTES:-2000}" /dev/zero | tr '\0' 'o'
    exit "${FAKE_OBJECTS_EXIT:-0}"
    ;;
  backup-push)
    case "${rest[0]:-}" in
      cat) exit 0 ;;
      init) exit 0 ;;
      stats) printf '{"total_size":%s,"total_file_count":1}\n' "${FAKE_REPO_SIZE:-1000}"; exit 0 ;;
      snapshots) printf '[{"time":"%s","tags":["run:old"]},{"time":"2099-01-01T00:00:00Z","tags":["run:new"]}]\n' "${FAKE_OLDEST_TIME:-2099-01-01T00:00:00Z}"; exit 0 ;;
      backup)
        fname=''
        for ((i = 0; i < ${#rest[@]}; i++)); do [ "${rest[$i]}" = --stdin-filename ] && fname="${rest[$((i + 1))]}"; done
        if [ "${FAKE_PUSH_FAIL_DEST:-}" = "$dest" ]; then cat >/dev/null; exit 1; fi
        if [ "$fname" = manifest.json ]; then cat >"$state/manifest.$dest.json"; else sha256sum | cut -d' ' -f1 >"$state/sha.$dest.$fname"; fi
        printf '%s %s\n' "$dest" "$fname" >>"$state/order.log"
        exit 0
        ;;
    esac
    exit 0
    ;;
esac
exit 0
FAKE
cat >"$tmp/bin/curl" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_LOG.curl"
n=$(( $(ls "$FAKE_STATE"/curl.* 2>/dev/null | wc -l) + 1 ))
cat >"$FAKE_STATE/curl.$n"
exit 0
FAKE
cat >"$tmp/bin/flock" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_LOG.flock"
[ "${FAKE_FLOCK_BUSY:-0}" = 1 ] && exit 1
exit 0
FAKE
chmod +x "$tmp/bin/"*

# --- Entorno de cada caso ---------------------------------------------------------------------------------------------------
# «VARIABLE:valor»: si un valor aparece en un argv, el fallo nombra la variable y nunca el valor.
SECRETS=(
  'BACKUP_PING_URL:SECRET-ping-uuid-1234'
  'RESTIC_PASSWORD:SECRET-restic-password-0123456789abcdef'
  'MONGO_BACKUP_PASSWORD:SECRET-mongo-backup-password-0123'
  'BACKUP_OCI_ACCESS_KEY_ID:SECRET-oci-key-id'
  'BACKUP_OCI_SECRET_ACCESS_KEY:SECRET-oci-secret-key'
  'BACKUP_OFFSITE_ACCESS_KEY_ID:SECRET-offsite-key-id'
  'BACKUP_OFFSITE_SECRET_ACCESS_KEY:SECRET-offsite-secret-key'
)

case_dir=''
new_case() {
  case_dir="$tmp/$1"
  mkdir -p "$case_dir/root/infra/deploy" "$case_dir/state"
  printf 'name: linkvault-prod\n' >"$case_dir/root/docker-compose.prod.yml"
  cp -R "$here/." "$case_dir/root/infra/backup/"
  printf '#!/usr/bin/env bash\nexit "${FAKE_PLATFORMS_EXIT:-0}"\n' >"$case_dir/root/infra/deploy/check-image-platforms.sh"
  cat >"$case_dir/root/.env.staging" <<ENV
BACKUP_PING_URL=https://hc-ping.invalid/SECRET-ping-uuid-1234
RESTIC_PASSWORD=SECRET-restic-password-0123456789abcdef
MONGO_BACKUP_PASSWORD=SECRET-mongo-backup-password-0123
BACKUP_OCI_REPOSITORY=/repo/oci
BACKUP_OCI_ACCESS_KEY_ID=SECRET-oci-key-id
BACKUP_OCI_SECRET_ACCESS_KEY=SECRET-oci-secret-key
BACKUP_OFFSITE_REPOSITORY=/repo/offsite
BACKUP_OFFSITE_ACCESS_KEY_ID=SECRET-offsite-key-id
BACKUP_OFFSITE_SECRET_ACCESS_KEY=SECRET-offsite-secret-key
ENV
  : >"$case_dir/state/log"
}

# run_case [VAR=valor…]: ejecuta el orquestador con los falsos; deja `code`, `out` y `err`.
code=0
out=''
err=''
run_case() {
  out="$case_dir/out"
  err="$case_dir/err"
  env PATH="$tmp/bin:$PATH" FAKE_LOG="$case_dir/state/log" FAKE_STATE="$case_dir/state" \
    BACKUP_ROOT="$case_dir/root" BACKUP_HEALTH_POLL_SECONDS=1 BACKUP_HEALTH_TIMEOUT_SECONDS=2 "$@" \
    timeout 30 bash "$script" >"$out" 2>"$err"
  code=$?
}

# Avisos: una línea por ping, «url|data».
pings() {
  local f url data
  for f in $(ls "$case_dir/state"/curl.* 2>/dev/null | sort -t. -k2 -n); do
    url="$(sed -n 's/^url = "\(.*\)"$/\1/p' "$f")"
    data="$(sed -n 's/^data = "\(.*\)"$/\1/p' "$f")"
    printf '%s|%s\n' "${url##*/}" "$data"
  done
}

cases=0
failures=0
check() {
  # $1 nombre del caso, $2 condición (0 = pasa), $3 detalle opcional
  cases=$((cases + 1))
  if [ "$2" -eq 0 ]; then
    printf '  ok   %s\n' "$1"
  else
    failures=$((failures + 1))
    printf '  FAIL %s%s\n' "$1" "${3:+ — $3}"
  fi
}
has() { grep -qF -- "$2" "$1"; }
hasre() { grep -qE -- "$2" "$1"; }

# ---------------------------------------------------------------------------------------------------------------------
printf 'run-backup: corrida buena\n'
new_case good
run_case
check 'run-backup: good run exits 0' "$code" "salió $code; $(head -c 300 "$err")"
p="$(pings)"
first="$(printf '%s\n' "$p" | head -n 1)"
last="$(printf '%s\n' "$p" | tail -n 1)"
[[ "$first" == start\|* ]]; r1=$?
[[ "$last" != fail\|* && "$last" != start\|* ]]; r2=$?
check 'run-backup: good run pings start and success' $((r1 + r2)) "avisos: $(printf '%s' "$p" | tr '\n' ' ')"
order="$case_dir/state/order.log"
expected=$'oci mongo.archive.gz\noci objects.tar\noci manifest.json\noffsite mongo.archive.gz\noffsite objects.tar\noffsite manifest.json'
[ "$(cat "$order" 2>/dev/null)" = "$expected" ]
check 'run-backup: good run writes the manifest last, after both streams, per destination' $? "orden: $(tr '\n' ',' <"$order")"
# El manifiesto lleva las sumas que el HOST midió y las horas del volcado ordenadas.
ok=0
for d in oci offsite; do
  m="$case_dir/state/manifest.$d.json"
  sm="$(cat "$case_dir/state/sha.$d.mongo.archive.gz")"
  so="$(cat "$case_dir/state/sha.$d.objects.tar")"
  has "$m" "\"sha256\":\"$sm\"" || ok=1
  has "$m" "\"sha256\":\"$so\"" || ok=1
  has "$m" '"formatVersion":1' || ok=1
  has "$m" "\"destination\":\"$d\"" || ok=1
  has "$m" '"mongoDumpStartedAt"' || ok=1
  has "$m" '"mongoDumpFinishedAt"' || ok=1
  has "$m" '"cvs":{"count":2' || ok=1
  s="$(sed -n 's/.*"mongoDumpStartedAt":"\([^"]*\)".*/\1/p' "$m")"
  f="$(sed -n 's/.*"mongoDumpFinishedAt":"\([^"]*\)".*/\1/p' "$m")"
  a="$(sed -n 's/.*"manifestAt":"\([^"]*\)".*/\1/p' "$m")"
  [[ "$s" < "$f" || "$s" == "$f" ]] || ok=1
  [[ "$f" < "$a" ]] || ok=1
done
check 'run-backup: manifest carries host-measured sums, dump times and object headers' "$ok"
# Cada `run` con --rm --no-deps -T.
bad=0
while IFS=$'\t' read -r _ line; do
  case " $line " in
    *" run "*) case "$line" in *"run --rm --no-deps -T "*) ;; *) bad=1 ;; esac ;;
  esac
done <"$case_dir/state/log"
check 'run-backup: every run carries --rm --no-deps -T' "$bad"
# Desde la copia.
bad=0
while IFS=$'\t' read -r cwd line; do
  case "$line" in compose*)
    case "$cwd" in *"/.backup-run-"*) ;; *) bad=1 ;; esac
    case "$line" in *"/.backup-run-"*"docker-compose.prod.yml"*) ;; *) bad=1 ;; esac
    ;;
  esac
done <"$case_dir/state/log"
check 'run-backup: every docker compose call runs from the .backup-run-<id> copy' "$bad"
ls -d "$case_dir/root"/.backup-run-* >/dev/null 2>&1
check 'run-backup: the .backup-run-<id> copy is removed at the end' $(( $? == 0 ))
# Marcador binario.
grep -aq 'LV-MARKER-7f3c9e' "$out" "$err"
check 'run-backup: binary marker never reaches stdout or stderr' $(( $? == 0 ))
# Estructura del script.
tail -n 1 "$script" | grep -qx 'main "\$@"; exit \$?'
check 'run-backup: last line of the script is main "$@"; exit $?' $?
grep -Eq '^[[:space:]]*(set -[a-z]*x|set -o xtrace)' "$script"
check 'run-backup: the script never enables set -x' $(( $? == 0 ))
grep -Eq '(^|[|;[:space:]])tee[[:space:]]+(/dev/stdout|-a[[:space:]]+/dev/stdout|/dev/fd/1|/proc/self/fd/1)' "$script"
check 'run-backup: no tee towards stdout in the script' $(( $? == 0 ))

# ---------------------------------------------------------------------------------------------------------------------
printf 'run-backup: ningún secreto en los argumentos\n'
leak=0
for s in "${SECRETS[@]}"; do
  if grep -qF -- "${s#*:}" "$case_dir/state/log" "$case_dir/state/log.curl" 2>/dev/null; then
    leak=1
    printf '       el valor de %s aparece en un argv de docker o de curl\n' "${s%%:*}"
  fi
done
check 'run-backup: no secret value appears in docker or curl argv' "$leak"
grep -qF 'hc-ping.invalid' "$case_dir/state/log.curl" 2>/dev/null
check 'run-backup: the monitor URL travels on stdin (--config -), never as an argument' $(( $? == 0 ))
grep -qx -- '--config -' "$case_dir/state/log.curl"
check 'run-backup: curl is called with --config -' $?
grep -qF 'url = "https://hc-ping.invalid/SECRET-ping-uuid-1234/start"' "$case_dir/state/curl.1"
check 'run-backup: the start ping reaches the secret URL on stdin' $?

# ---------------------------------------------------------------------------------------------------------------------
printf 'run-backup: candado\n'
new_case lock
run_case FAKE_FLOCK_BUSY=1
[ "$code" -eq 75 ] && [ ! -s "$case_dir/state/log" ] && ! ls -d "$case_dir/root"/.backup-run-* >/dev/null 2>&1
check 'run-backup: second run or restore exits lock_busy without touching anything' $? "código $code; log: $(head -c 200 "$case_dir/state/log")"
grep -qE '^fail[|][0-9]{8}T[0-9]{6}Z lock_busy$' <<<"$(pings)"
check 'run-backup: lock_busy pings fail with the run id and the class' $? "$(pings)"

# ---------------------------------------------------------------------------------------------------------------------
printf 'run-backup: fallas\n'
new_case mongo
run_case FAKE_MONGO_EXIT=137 FAKE_STREAM_BYTES=50000
p="$(pings)"
[ "$code" -ne 0 ] && [[ "$p" == *"fail|"*"mongo_dump@oci"*"mongo_dump@offsite"* ]]
check 'run-backup: killed mongo dump leaves no manifest and pings fail mongo_dump' $? "código $code; avisos: $(printf '%s' "$p" | tr '\n' ' ')"
! grep -q manifest.json "$case_dir/state/order.log" 2>/dev/null
check 'run-backup: no manifest is sent when the dump fails' $?
grep -qE '^fail[|][0-9]{8}T[0-9]{6}Z [a-z_@,]+$' <<<"$(pings | tail -n 1)"
check 'run-backup: fail ping carries run id and class only' $? "$(pings | tail -n 1)"

new_case cap
printf 'BACKUP_MAX_REPO_BYTES=1\n' >>"$case_dir/root/.env.staging"
run_case FAKE_REPO_SIZE=9999
p="$(pings)"
[ "$code" -ne 0 ] && [[ "$p" == *"size_cap@oci"* ]] && ! grep -q 'backup --stdin' "$case_dir/state/log"
check 'run-backup: size cap below repo size pings fail size_cap and skips push' $? "código $code; $(printf '%s' "$p" | tr '\n' ' ')"

new_case objbig
run_case FAKE_OBJECTS_EXIT=42
[[ "$(pings)" == *"objects_too_large@oci"* ]] && ! grep -q 'oci manifest.json' "$case_dir/state/order.log"
check 'run-backup: objects over the cap ping objects_too_large and leave no manifest' $?

new_case objread
run_case FAKE_OBJECTS_EXIT=1
[[ "$(pings)" == *"objects_read@oci"* ]]
check 'run-backup: failing object reader pings objects_read' $?

new_case oci
run_case FAKE_PUSH_FAIL_DEST=oci
p="$(pings)"
[ "$code" -ne 0 ] && [[ "$p" == *"push_oci"* ]] && grep -q 'offsite manifest.json' "$case_dir/state/order.log" && ! grep -q 'oci manifest.json' "$case_dir/state/order.log"
check 'run-backup: failing oci destination still completes offsite and pings fail push_oci' $? "código $code; $(printf '%s' "$p" | tr '\n' ' ')"

new_case health
run_case FAKE_HEALTH=starting
[ "$code" -ne 0 ] && [[ "$(pings)" == *"stack_unhealthy"* ]] && ! grep -q ' run ' "$case_dir/state/log"
check 'run-backup: an unhealthy stack pings stack_unhealthy before reading anything' $?

new_case images
run_case FAKE_PLATFORMS_EXIT=3
[ "$code" -ne 0 ] && [[ "$(pings)" == *" images"* ]] && ! grep -q ' run ' "$case_dir/state/log"
check 'run-backup: images without the host platform ping images' $?

new_case user
run_case FAKE_ENSURE_EXIT=1
[ "$code" -ne 0 ] && [[ "$(pings)" == *"ensure_user"* ]] && ! grep -q ' run ' "$case_dir/state/log"
check 'run-backup: failing ensure-backup-user pings ensure_user' $?

# ---------------------------------------------------------------------------------------------------------------------
printf 'run-backup: poda vencida\n'
new_case prune
old="$(date -u -d '70 days ago' +%Y-%m-%dT%H:%M:%SZ)"
run_case FAKE_OLDEST_TIME="$old"
p="$(pings)"
[[ "$p" == *"prune_overdue@oci"* ]] && grep -q 'oci manifest.json' "$case_dir/state/order.log" && grep -q 'offsite manifest.json' "$case_dir/state/order.log"
check 'run-backup: snapshot older than 65 days pings prune_overdue after a complete run' $? "$(printf '%s' "$p" | tr '\n' ' ')"
new_case fresh
run_case FAKE_OLDEST_TIME="$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)"
[[ "$(pings | tail -n 1)" != fail\|* ]]
check 'run-backup: a 30-day-old snapshot does not warn' $?

# ---------------------------------------------------------------------------------------------------------------------
if command -v flock >/dev/null 2>&1; then
  printf 'run-backup: candado real (flock)\n'
  new_case reallock
  mkdir -p "$tmp/bin-real"
  cp "$tmp/bin/docker" "$tmp/bin/curl" "$tmp/bin-real/"
  (
    exec 8>"$case_dir/root/.backup.lock"
    flock 8
    env PATH="$tmp/bin-real:$PATH" FAKE_LOG="$case_dir/state/log" FAKE_STATE="$case_dir/state" BACKUP_ROOT="$case_dir/root" bash "$script" >/dev/null 2>&1
  )
  [ $? -eq 75 ]
  check 'run-backup: the real flock rejects a second run while the lock is held' $?
else
  printf 'run-backup: candado real: se omite (este equipo no tiene flock; CI sí)\n'
fi

printf '\nrun-backup: %s casos, %s fallos\n' "$cases" "$failures"
[ "$failures" -eq 0 ]
