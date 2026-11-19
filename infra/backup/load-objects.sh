#!/bin/sh
# Cargador de los objetos al restaurar (servicio `restore-objects`): lee el `tar` de la entrada estándar, lo extrae en el
# `tmpfs` y sube cada objeto por la API S3 con la identidad de la aplicación, con el `Content-Type` que tenía
# (`/.lv-content-types`, escrito por `read-objects.sh`). Debe correr DESPUÉS de `provision`.
set -eu
umask 077
tar -x -C /work

if [ -s /work/.lv-content-types ]; then
  while IFS="$(printf '\t')" read -r bucket key mime; do
    [ -n "$key" ] || continue
    [ -f "/work/$bucket/$key" ] || continue
    rclone copyto "/work/$bucket/$key" "store:$bucket/$key" --header-upload "Content-Type: $mime"
  done </work/.lv-content-types
fi

# Lo que no tuviera tipo registrado (no debería haber nada) se sube igual, sin pisar lo ya cargado.
for bucket in $BACKUP_BUCKETS; do
  [ -d "/work/$bucket" ] || continue
  rclone copy "/work/$bucket" "store:$bucket" --ignore-existing
done
