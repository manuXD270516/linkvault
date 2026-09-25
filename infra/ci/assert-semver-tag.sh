#!/usr/bin/env bash
# ===================================================================================================================
# Guardia del tag de release: solo `vMAJOR.MINOR.PATCH`, anclado y sin ceros a la izquierda.
# ===================================================================================================================
# Tarea 8.6 del change `deploy-image-verification`; requirement "CD a producción por tag semver" de
# `platform/ci-pipeline` ("Un tag que no cumpla el patrón documentado NO SHALL desplegar a prod").
#
# --- Qué sustituye y por qué ---------------------------------------------------------------------------------------
# El guardia anterior de `cd-prod.yml` era un glob de `case`:
#
#     case "$ref" in
#       v[0-9]*.[0-9]*.[0-9]*) echo "tag=$ref" ;;
#       *) echo "::error::…"; exit 1 ;;
#     esac
#
# En un glob, `*` es "cualquier cosa" y `.` es un punto literal sin significado especial, así que `v1.2.3abc` **pasa**
# (y `v1.2.3-rc.1`, y `v1.2.3-lo-que-sea`). Un patrón que acepta casi cualquier cosa que empiece por `v` no es un
# guardia: es un adorno delante del único camino que despliega a producción. Aquí se compara contra una expresión
# regular **anclada** en los dos extremos.
#
# --- Por qué no se admiten ceros a la izquierda ----------------------------------------------------------------------
# `v01.2.3` y `v1.2.3` son el mismo release para una persona y **dos tags distintos** para git, para el registro de
# imágenes y para el compose del host. Aceptar los dos abre la puerta a dos artefactos publicados bajo nombres que
# se leen igual, y a un despliegue que "es la 1.2.3" sin serlo. Semver lo prohíbe por el mismo motivo
# (https://semver.org §2: "MUST NOT contain leading zeroes"). De ahí el `(0|[1-9][0-9]*)` de cada componente, que
# acepta el `0` suelto —`v0.1.0` es un tag legítimo y es la serie en la que vive hoy este proyecto— y rechaza
# cualquier otro número que empiece por cero.
#
# --- Consecuencia que conviene decir en voz alta ---------------------------------------------------------------------
# El disparador del workflow es el glob de tags `v*.*.*`, que **no** puede expresar semver: con él llega hasta aquí
# cualquier `v1.2.3-rc.1`. Este guardia lo **rechaza**, de modo que empujar un tag de prerelease deja la corrida en
# rojo en vez de desplegar a producción. Es deliberado: mientras no haya una decisión sobre qué significa un
# prerelease en este proyecto (¿despliega?, ¿a dónde?), el desenlace seguro es no desplegar y decirlo. Lo que NO se
# hace es aceptarlo en silencio, que es lo que hacía el glob.
#
# Uso:
#   TAG=v1.2.3 infra/ci/assert-semver-tag.sh
#
# Escribe `tag=<valor>` en `GITHUB_OUTPUT` cuando el tag es válido, para que el resto del workflow use el valor ya
# comprobado y no vuelva a derivarlo de `github.ref_name` por su cuenta.
# ===================================================================================================================
set -euo pipefail

TAG="${TAG:-}"

SEMVER_RE='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'

# Una línea para la anotación (GitHub corta `::error::` en el primer salto) y el resto como contexto.
fail() {
  printf '::error::%s\n' "$1" >&2
  printf '\n[FAIL] %s\n' "$1" >&2
  shift
  for line in "$@"; do
    printf '       %s\n' "$line" >&2
  done
  printf '       Forma aceptada: vMAJOR.MINOR.PATCH, sin ceros a la izquierda (v1.2.3, v0.1.0).\n' >&2
  exit 1
}

printf '=== Tag de release\n'
printf '  recibido: %s\n' "${TAG:-<vacío>}"
printf '  patrón  : %s\n' "$SEMVER_RE"

if [ -z "$TAG" ]; then
  fail "el tag de release llegó vacío: no hay nada que desplegar a producción" \
    "En workflow_dispatch hay que pasar el tag existente que se quiere desplegar; en push de tag," \
    "el valor sale de github.ref_name."
fi

case "$TAG" in
  refs/*)
    fail "el tag de release llegó como referencia completa ('${TAG}') y no como nombre de tag" \
      "Se espera 'v1.2.3', no 'refs/tags/v1.2.3': usa github.ref_name, no github.ref."
    ;;
esac

if [[ $TAG =~ $SEMVER_RE ]]; then
  printf '\nok: %s es un tag de release válido\n' "$TAG"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'tag=%s\n' "$TAG" >>"$GITHUB_OUTPUT"
  fi
  exit 0
fi

# --- Diagnóstico: cuatro averías distintas con cuatro mensajes distintos ---------------------------------------------
# Un único "no cumple el patrón" obliga a quien empuja el tag a comparar caracteres a ojo. Cada rama de aquí abajo es
# un error que se comete de verdad, y cada una dice cuál es.
if [[ ! $TAG =~ ^v ]]; then
  fail "el tag de release '${TAG}' no empieza por 'v'" \
    "Los tags de release de este proyecto llevan la 'v' delante: v1.2.3, no 1.2.3."
fi

if [[ $TAG =~ ^v[0-9]+(\.[0-9]+)?$ ]]; then
  fail "al tag de release '${TAG}' le faltan componentes: hacen falta los tres (mayor, menor y parche)" \
    "v1.2 no es un release: nombra una serie, no una versión."
fi

if [[ $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "el tag de release '${TAG}' lleva ceros a la izquierda en algún componente" \
    "'v01.2.3' y 'v1.2.3' se leen igual y son dos tags distintos para git y para el registro de imágenes:" \
    "se publicarían dos artefactos bajo nombres indistinguibles. Semver lo prohíbe por este mismo motivo."
fi

if [[ $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+. ]]; then
  fail "el tag de release '${TAG}' tiene algo después del parche" \
    "El guardia anterior (un glob de case) aceptaba esto; se rechaza a propósito, incluidos los prerelease" \
    "del tipo v1.2.3-rc.1: mientras no esté decidido qué despliega un prerelease, no despliega producción."
fi

fail "el tag de release '${TAG}' no tiene forma de versión semver"
