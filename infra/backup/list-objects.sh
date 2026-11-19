#!/bin/sh
# Listado de metadatos de los objetos (servicio `backup-objects`): solo nombres, tamaños y cabeceras, nunca el contenido.
# Lo usa el manifiesto (design D4 y C28): {"<bucket>": [ {Path, Size, MimeType, Metadata…}, … ], …}
set -eu
sep=''
printf '{'
for bucket in $BACKUP_BUCKETS; do
  printf '%s"%s":' "$sep" "$bucket"
  rclone lsjson -R --files-only --metadata "store:$bucket" | tr -d '\n'
  sep=','
done
printf '}\n'
