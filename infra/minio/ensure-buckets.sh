#!/bin/sh
# Reproducible MinIO bucket bootstrap for LinkVault prod (ADR-033 D5).
# Idempotent: safe to re-run. Used by the minio healthcheck in docker-compose.prod.yml
# and as a manual operator script (infra/README.md).
#
# Requires:
#   - mc in PATH (MinIO client; present in the quay.io/minio/minio image)
#   - MC_HOST_admin already set (compose sets it from S3_ACCESS_KEY / S3_SECRET_KEY)
#   - MINIO_KMS_SECRET_KEY on the MinIO server for SSE-S3 (compose.prod)
#
# NO se puede usar en este script nada que la imagen de MinIO no traiga. En concreto **no hay `grep`**
# (`quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` trae coreutils y `mc`, pero no grep): hasta este change
# las dos comprobaciones finales lo usaban, salían `127`, `set -e` abortaba, el healthcheck nunca pasaba y
# `api`/`worker` —que dependen de `service_healthy`— no llegaban a arrancar. Por eso las comprobaciones se
# resuelven con `case` sobre la salida de `mc --json`, que solo necesita el shell.
#
# Env (defaults match .env.example):
#   S3_BUCKET            CV objects (SSE-S3, no expiry) — default cvs
#   S3_SNAPSHOTS_BUCKET  enrich page snapshots (ILM 30d) — default snapshots

set -eu

CV_BUCKET="${S3_BUCKET:-cvs}"
SNAP_BUCKET="${S3_SNAPSHOTS_BUCKET:-snapshots}"

# Un binario ausente NO puede volver a leerse como "la condición comprobada no se cumple": se dice por su
# nombre y con un código propio. `command -v` es builtin del shell, así que esta línea no puede fallar ella misma.
if ! command -v mc >/dev/null 2>&1; then
  echo "minio/ensure-buckets: falta el binario 'mc' en la imagen; esto NO es un problema de configuración de los buckets" >&2
  exit 127
fi

mc ready local

# --- snapshots: create + 30-day expiry (replace entire ILM config; do not use `ilm rule add`) ---
if ! mc ilm rule ls "admin/${SNAP_BUCKET}" >/dev/null 2>&1; then
  mc mb --ignore-existing "admin/${SNAP_BUCKET}"
  printf '%s\n' '{"Rules":[{"ID":"expire-snapshots-30d","Status":"Enabled","Expiration":{"Days":30},"Filter":{}}]}' \
    | mc ilm rule import "admin/${SNAP_BUCKET}"
fi

# --- CV bucket: private, no lifecycle expiry, SSE-S3 at rest ---
mc mb --ignore-existing "admin/${CV_BUCKET}"
# Fail closed if SSE cannot be enabled (KMS key missing on the server).
mc encrypt set sse-s3 "admin/${CV_BUCKET}"

# SSE-S3 en reposo sobre el bucket de CV. `mc --json encrypt info` NO devuelve la cadena "sse-s3": devuelve el
# algoritmo del servidor, y SSE-S3 es exactamente `AES256` (SSE-KMS sería `aws:kms`), así que el `case` distingue
# las dos. Tres desenlaces distintos y distinguibles: mc no pudo preguntar / hay otro cifrado / correcto.
if ! cv_encryption=$(mc --json encrypt info "admin/${CV_BUCKET}" 2>&1); then
  echo "minio/ensure-buckets: no se pudo leer la configuración de cifrado de '${CV_BUCKET}': ${cv_encryption}" >&2
  exit 1
fi
case "${cv_encryption}" in
  *'"algorithm":"AES256"'* | *'"algorithm": "AES256"'*) ;;
  *)
    echo "minio/ensure-buckets: '${CV_BUCKET}' no está cifrado con SSE-S3 (AES256); mc devolvió: ${cv_encryption}" >&2
    exit 1
    ;;
esac

# Confirm snapshots ILM still present (healthy only when both buckets are correct). Se exige **el ID de la regla**,
# no la palabra "Expiration": la tabla de `mc ilm rule ls` lleva esa palabra en la cabecera, así que la comprobación
# anterior habría dado por buena cualquier regla de ciclo de vida, incluida una que no expirase a 30 días.
if ! snapshots_ilm=$(mc --json ilm rule ls "admin/${SNAP_BUCKET}" 2>&1); then
  echo "minio/ensure-buckets: no se pudo leer el ciclo de vida de '${SNAP_BUCKET}': ${snapshots_ilm}" >&2
  exit 1
fi
case "${snapshots_ilm}" in
  *'"ID":"expire-snapshots-30d"'* | *'"ID": "expire-snapshots-30d"'*) ;;
  *)
    echo "minio/ensure-buckets: '${SNAP_BUCKET}' no tiene la regla ILM 'expire-snapshots-30d'; mc devolvió: ${snapshots_ilm}" >&2
    exit 1
    ;;
esac

echo "minio buckets ok: ${CV_BUCKET} (sse-s3), ${SNAP_BUCKET} (ilm 30d)"
