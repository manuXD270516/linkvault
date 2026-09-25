#!/usr/bin/env bash
# Derribo de la pila de verificación (tarea 5.16 del change `deploy-image-verification`).
#
# Va en un step con `if: always()` y **no** dentro de `verify-artifact.sh`: justo cuando la verificación falla es
# cuando hay volúmenes que limpiar, y un derribo atado al camino de éxito dejaría la siguiente corrida del mismo
# corredor arrancando sobre datos de la anterior —una base de mongo ya inicializada o un MinIO con los buckets ya
# creados esconderían exactamente los fallos de arranque que esto busca—. `-v` es obligatorio por ese motivo.
#
# Nunca falla: si la pila ni siquiera llegó a existir, no hay nada que derribar y eso no es un error.
set -uo pipefail

docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env down -v --remove-orphans --timeout 30 || true
