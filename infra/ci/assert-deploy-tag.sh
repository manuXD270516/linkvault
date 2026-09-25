#!/usr/bin/env bash
# ===================================================================================================================
# Guardia del tag que se va a desplegar: que sea **el de esta corrida**, comprobado antes de tocar el host.
# ===================================================================================================================
# Tarea 7.4 del change `deploy-image-verification`; ADR-048 §3 y §4.
#
# El despliegue exporta `IMAGE_TAG` y el compose del host resuelve con él las tres imágenes. Si ese valor llega
# **vacío** —porque el job de despliegue no declaró `needs` sobre el de publicación, o porque el output cambió de
# nombre— `docker-compose.prod.yml` **no falla**: cae a su valor por defecto, `:latest`, hace `pull`, levanta lo que
# hubiera ahí e informa de un despliegue con éxito. `cd-staging` **ni siquiera publica** `:latest`, así que lo
# desplegado sería, en el mejor caso, una imagen vieja, y en el peor, una que nadie verificó nunca.
#
# Por eso el guardia recomputa el tag esperado **aquí**, a partir de `GITHUB_SHA`, en vez de confiar en el que llega:
# comparar el output consigo mismo no comprobaría nada. La duplicación del cálculo (`sha-<12>`) es el **contenido** de
# la comprobación, no un descuido.
#
# Falla en tres casos distintos y con tres mensajes distintos, porque son tres averías distintas:
#   1. tag vacío              → el `needs` o el output no están donde se creía;
#   2. tag móvil              → se desplegaría un alias que puede apuntar a otra imagen mañana;
#   3. tag ≠ el de la corrida → se desplegaría **otra cosa**, verificada o no.
#
# Corre **antes** de cualquier paso que toque el host: un despliegue equivocado ya detectado sigue siendo un
# despliegue equivocado.
#
# Uso:
#   IMAGE_TAG="<output del job de publicación>" GITHUB_SHA=… infra/ci/assert-deploy-tag.sh
#   # o, para un CD cuyo tag no es `sha-<12>` (release por tag semver): EXPECTED_TAG=v1.2.3
# ===================================================================================================================
set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-}"

# Una línea para la anotación (GitHub corta `::error::` en el primer salto de línea) y el resto como contexto.
fail() {
  printf '::error::%s\n' "$1" >&2
  printf '\n[FAIL] %s\n' "$1" >&2
  shift
  for line in "$@"; do
    printf '       %s\n' "$line" >&2
  done
  exit 1
}

if [ -z "${EXPECTED_TAG:-}" ]; then
  : "${GITHUB_SHA:?GITHUB_SHA es obligatoria (o pasa EXPECTED_TAG): de ahí sale el tag esperado sha-<12>}"
  EXPECTED_TAG="sha-${GITHUB_SHA:0:12}"
fi

printf '=== Tag a desplegar\n'
printf '  recibido: %s\n' "${IMAGE_TAG:-<vacío>}"
printf '  esperado: %s\n' "$EXPECTED_TAG"

if [ -z "$IMAGE_TAG" ]; then
  fail "el tag de imagen llegó vacío: el despliegue no recibió el output del job de publicación" \
    "Con el tag vacío el compose cae a :latest, que cd-staging ni siquiera publica, y el despliegue" \
    "informaría éxito sobre otra imagen. Revisa el needs del job y el nombre del output."
fi

case "$IMAGE_TAG" in
  latest | staging | prod | production | main | edge)
    fail "el tag a desplegar es el alias móvil '${IMAGE_TAG}', no el inmutable de esta corrida (${EXPECTED_TAG})" \
      "Un alias puede apuntar a otra imagen mañana: desplegarlo no dice qué queda desplegado."
    ;;
esac

if [ "$IMAGE_TAG" != "$EXPECTED_TAG" ]; then
  fail "el tag a desplegar (${IMAGE_TAG}) no es el de esta corrida (${EXPECTED_TAG})" \
    "Se desplegaría un artefacto distinto del que se acaba de construir y verificar."
fi

printf '\nok: se desplegará %s, que es el artefacto verificado en esta corrida\n' "$IMAGE_TAG"
