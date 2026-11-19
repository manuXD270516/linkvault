#!/bin/sh
# Lector de los objetos (servicio `backup-objects`). Copia los buckets al `tmpfs` (/work, con tope) y saca un `tar` por la
# salida estándar. Código 42 = el tope se pasó (clase `objects_too_large`); cualquier otro ≠0 = `objects_read`.
# Nada más va por la salida estándar: es el `tar`.
set -eu
umask 077
limit="${BACKUP_OBJECTS_MAX_BYTES:?}"

total=0
for bucket in $BACKUP_BUCKETS; do
  size="$(rclone size --json "store:$bucket" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
  [ -n "$size" ] || { echo "read-objects: no pude medir el bucket $bucket" >&2; exit 1; }
  total=$((total + size))
done
if [ "$total" -gt "$limit" ]; then
  echo "read-objects: los objetos pasan del tope BACKUP_OBJECTS_MAX_BYTES" >&2
  exit 42
fi

for bucket in $BACKUP_BUCKETS; do
  mkdir -p "/work/$bucket"
  if ! rclone copy "store:$bucket" "/work/$bucket" --quiet 2>/tmp/rclone.err; then
    if grep -qi 'no space left' /tmp/rclone.err; then
      echo "read-objects: el área de trabajo en memoria se llenó" >&2
      exit 42
    fi
    echo "read-objects: rclone copy falló en $bucket" >&2
    exit 1
  fi
done
exec tar -c -C /work .
