#!/bin/sh
# Listado de metadatos de los objetos (servicio `backup-objects`): solo nombres, tamaños, cabeceras y el número de objetos por
# bucket, nunca el contenido. Lo usa el manifiesto (design D4 y C28):
#   {"<bucket>": {"count": N, "objects": [ {Path, Size, MimeType, Metadata…}, … ]}, …}
set -eu
sep=''
printf '{'
for bucket in $BACKUP_BUCKETS; do
  count="$(rclone size --json "store:$bucket" | sed -n 's/.*"count":\([0-9]*\).*/\1/p')"
  [ -n "$count" ] || { echo "list-objects: no pude contar el bucket $bucket" >&2; exit 1; }
  printf '%s"%s":{"count":%s,"objects":' "$sep" "$bucket" "$count"
  rclone lsjson -R --files-only --metadata "store:$bucket" | tr -d '\n'
  printf '}'
  sep=','
done
printf '}\n'
