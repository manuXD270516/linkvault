#!/bin/sh
# Lector de los objetos (servicio `backup-objects`). Copia los buckets al `tmpfs` (/work, con tope) y saca un `tar` por la
# salida estándar. Código 42 = el tope se pasó (clase `objects_too_large`); cualquier otro ≠0 = `objects_read`.
# Nada más va por la salida estándar: es el `tar`.
#
# El `tar` lleva además `/.lv-content-types` (bucket, clave y `Content-Type` de cada objeto, separados por tabuladores): un
# `rclone copy` de un fichero sin extensión (las claves de CV son `<userId>/<cvId>`) no puede adivinar el tipo, y sin él la
# restauración dejaría todos los CV como `application/octet-stream` (design D11, C28). `load-objects.sh` lo usa al cargar.
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

: >/work/.lv-content-types
for bucket in $BACKUP_BUCKETS; do
  mkdir -p "/work/$bucket"
  if ! rclone copy "store:$bucket" "/work/$bucket" 2>/tmp/rclone.err; then
    if grep -qi 'no space left' /tmp/rclone.err; then
      echo "read-objects: el área de trabajo en memoria se llenó" >&2
      exit 42
    fi
    echo "read-objects: rclone copy falló en $bucket" >&2
    exit 1
  fi
  rclone lsjson -R --files-only "store:$bucket" | tr -d '\n' | sed 's/},{"Path"/}\n{"Path"/g' |
    sed -n "s/.*\"Path\":\"\\([^\"]*\\)\".*\"MimeType\":\"\\([^\"]*\\)\".*/$bucket\\t\\1\\t\\2/p" >>/work/.lv-content-types
  # `sed` no cierra la última línea si la entrada no la cerraba: sin este salto, el último objeto de un bucket se pegaría al
  # primero del siguiente.
  echo >>/work/.lv-content-types
done
exec tar -c -C /work .
