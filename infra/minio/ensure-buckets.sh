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
# Env (defaults match .env.example):
#   S3_BUCKET            CV objects (SSE-S3, no expiry) — default cvs
#   S3_SNAPSHOTS_BUCKET  enrich page snapshots (ILM 30d) — default snapshots

set -eu

CV_BUCKET="${S3_BUCKET:-cvs}"
SNAP_BUCKET="${S3_SNAPSHOTS_BUCKET:-snapshots}"

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
mc encrypt info "admin/${CV_BUCKET}" | grep -qi 'sse-s3'

# Confirm snapshots ILM still present (healthy only when both buckets are correct).
mc ilm rule ls "admin/${SNAP_BUCKET}" | grep -qi 'expire-snapshots-30d\|Expiration'

echo "minio buckets ok: ${CV_BUCKET} (sse-s3), ${SNAP_BUCKET} (ilm 30d)"
