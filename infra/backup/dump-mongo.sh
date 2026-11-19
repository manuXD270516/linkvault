#!/bin/sh
# Lector de la base (servicio `backup-mongo`). Su salida estándar ES el volcado: no imprime nada más por ella.
# La contraseña no va en los argumentos: se escribe un `--config` con modo 600 en el `tmpfs` desde el entorno.
set -eu
umask 077
conf=/tmp/mongodump.yml
printf 'uri: mongodb://%s:%s@mongo:27017/?replicaSet=rs0&authSource=admin\n' "$MONGO_BACKUP_USER" "$MONGO_BACKUP_PASSWORD" >"$conf"
exec mongodump --quiet --config "$conf" --archive --gzip
