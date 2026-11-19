#!/bin/sh
# Cargador de los objetos al restaurar (servicio `restore-objects`): lee el `tar` de la entrada estándar, lo extrae en el
# `tmpfs` y sube cada bucket por la API S3 con la identidad de la aplicación. Debe correr DESPUÉS de `provision`.
set -eu
umask 077
tar -x -C /work
for bucket in $BACKUP_BUCKETS; do
  [ -d "/work/$bucket" ] || continue
  rclone copy "/work/$bucket" "store:$bucket" --quiet
done
