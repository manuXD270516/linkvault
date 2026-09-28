#!/usr/bin/env bash
# ===================================================================================================================
# Publicación del artefacto **ya verificado**, y comprobación de que lo publicado es exactamente eso.
# ===================================================================================================================
# Grupo 6 del change `deploy-image-verification`; decisión en ADR-048 §4; requirement "CD a staging en main" de
# `platform/ci-pipeline` ("Se publica exactamente el artefacto verificado" y "Publicar algo reconstruido rompe el
# pipeline").
#
# Este script corre **después** de `infra/ci/verify-artifact.sh`, en el **mismo job y el mismo daemon**, y publica
# **las imágenes que ese daemon ya tiene cargadas**: `docker push` del tag que se acaba de verificar.
#
# NO hay —ni puede haber— una segunda construcción en este camino. Ni `docker/build-push-action` con `push: true`, ni
# `docker buildx build --push`, por barata que la haga la caché. Una imagen cargada con `load: true` vive **solo en el
# daemon de este corredor**: publicar desde cualquier otro sitio la reconstruiría, y subiría al registro bits que
# nadie ha levantado. Se cumpliría el orden construir → verificar → publicar y se incumpliría su propósito, que es el
# peor resultado posible: una garantía que se ve satisfecha y no lo está.
#
# --- Por qué se comparan **estos** dos digests y no otros ----------------------------------------------------------
# El orden no basta, así que la garantía se comprueba por **identidad**: el digest de lo publicado tiene que ser el de
# lo verificado, y se comprueba **en la corrida**.
#
#   * `docker image inspect -f '{{.Id}}'` **no sirve**: en el daemon clásico (el de los corredores de GitHub) ese es
#     el digest del **config** de la imagen, mientras que el registro identifica la imagen por el digest de su
#     **manifiesto**, que por construcción *contiene* al config. Son objetos distintos: esa comparación no puede
#     coincidir nunca. (Medido en la implementación: con el **almacén containerd** de Docker Desktop `.Id` sí es el
#     digest del índice y coincide con el del registro, así que una comparación basada en `.Id` pasaría en la máquina
#     de desarrollo y fallaría en CI — la peor combinación posible. Ver la nota del grupo 6 en `tasks.md`.)
#   * Comparar `{{.Id}}` **antes y después** de publicar es peor todavía: pasa su propia prueba de falsación
#     ("reconstruir entre verificar y publicar cambia el id") **sin consultar el registro ni una vez**, de modo que el
#     pipeline volvería a afirmar identidad sin haberla comprobado. Es exactamente el defecto que este change
#     persigue, con forma de arreglo.
#   * El par comparable es el **digest de repositorio** de la imagen local —lo que el daemon anota al publicarla—
#     contra el `Digest:` que el **registro** devuelve para ese tag (`docker buildx imagetools inspect`). El primero
#     sale de la imagen que se levantó y se verificó; el segundo, de lo que de verdad hay publicado. Si difieren, o lo
#     publicado no salió de aquí o alguien reconstruyó por el camino, y en los dos casos el pipeline falla.
#
# Y una segunda corrección, esta descubierta al **ver fallar la falsación**: el cotejo contra el registro, **solo**, no
# basta. Si el camino de publicación reconstruye con `docker buildx build --push` sobre el mismo tag, el daemon
# reetiqueta la imagen recién construida, de modo que el digest de repositorio que se lee *después* ya es el del
# artefacto reconstruido y coincide con el del registro: la comprobación aprobaría la reconstrucción comparándola
# consigo misma. Por eso se toma la identidad de la imagen **antes** de publicar y se exige que el tag local siga
# señalando al mismo objeto después. Ese guardia por sí solo sería inútil —no consulta el registro ni una vez, que es
# justo lo que 6.2 prohíbe— y el cotejo por sí solo es ciego a la reetiquetación: hacen falta los dos.
#
# Corrección a la tarea 6.2 al implementarla: `{{index .RepoDigests 0}}` es **elegir a ciegas**. `RepoDigests` es una
# lista con una entrada por repositorio conocido, y una imagen etiquetada más de una vez trae varias sin orden
# garantizado (medido: una imagen con el tag local y el del registro devuelve las dos). Se selecciona por **prefijo
# de repositorio**, y si no hay ninguna entrada para este repositorio se falla diciéndolo, en vez de responder con el
# digest de otro repositorio.
#
# Lo que esta comprobación **no** puede hacer, dicho aquí en vez de dado por hecho: des-publicar. Si el camino de
# publicación reconstruyera, los bits reconstruidos **ya estarían en el registro** cuando la comprobación falla
# (medido en la falsación: el tag quedó en el registro y el paso salió ≠0 después). Lo que garantiza que eso no pase
# no es la comprobación sino la **forma** del camino —`docker push` de la imagen cargada—; la comprobación existe
# para que nadie pueda cambiar esa forma sin que el pipeline se entere. Las dos cosas van juntas.
#
# --- Qué publica ---------------------------------------------------------------------------------------------------
#   * Siempre, el tag **inmutable** `sha-<12>` (`IMAGE_TAG`).
#   * El tag **móvil** (`MOVING_TAG`, p. ej. `staging`) **solo si el que invoca lo pasa**, y el workflow solo lo pasa
#     desde `main`: una corrida de rama que moviera `:staging` dejaría el canal apuntando a código de rama.
#   * El tag móvil se comprueba por identidad **igual** que el inmutable: tras moverlo, el registro tiene que resolver
#     ese tag al mismo digest. Mover un alias sin comprobarlo es la vía por la que un canal acaba apuntando a otra
#     cosa sin que nadie se entere.
#
# Uso:
#   API_IMAGE=… WORKER_IMAGE=… WEB_IMAGE=… IMAGE_TAG=… [MOVING_TAG=staging] infra/ci/publish-artifact.sh
# ===================================================================================================================
set -euo pipefail

: "${API_IMAGE:?API_IMAGE es obligatoria: es el repositorio de la imagen verificada en este job}"
: "${WORKER_IMAGE:?WORKER_IMAGE es obligatoria: es el repositorio de la imagen verificada en este job}"
: "${WEB_IMAGE:?WEB_IMAGE es obligatoria: es el repositorio de la imagen verificada en este job}"
: "${IMAGE_TAG:?IMAGE_TAG es obligatoria: es el tag inmutable sha-<12> que se acaba de verificar}"
MOVING_TAG="${MOVING_TAG:-}"

section() { printf '\n=== %s\n' "$1"; }

fail() {
  printf '\n[FAIL] %s\n' "$1" >&2
  exit 1
}

# Digest de repositorio de la imagen local, para **este** repositorio (ver cabecera: no vale el índice 0).
repo_digest_of() {
  local repo="$1" ref="$2" digests entry
  digests="$(docker image inspect "$ref" --format '{{range .RepoDigests}}{{println .}}{{end}}')"
  while IFS= read -r entry; do
    case "$entry" in
      "${repo}@sha256:"*) printf '%s\n' "${entry#*@}"; return 0 ;;
    esac
  done <<EOF
$digests
EOF
  return 1
}

# Digest que el **registro** devuelve para ese tag. Es la única parte que consulta el registro, y por eso es la que
# hace que esta comprobación pueda ser falsa.
registry_digest_of() {
  local ref="$1" out digest
  out="$(mktemp)"
  if ! docker buildx imagetools inspect "$ref" >"$out" 2>&1; then
    printf '%s\n' "--- docker buildx imagetools inspect $ref" >&2
    cat "$out" >&2
    rm -f "$out"
    return 1
  fi
  digest="$(sed -n 's/^Digest:[[:space:]]*\(sha256:[0-9a-f]\{64\}\).*$/\1/p' "$out" | head -n 1)"
  rm -f "$out"
  [ -n "$digest" ] || return 1
  printf '%s\n' "$digest"
}

publish_one() {
  local repo="$1" ref="${1}:${IMAGE_TAG}" verified_id published_id local_digest registry_digest moving_ref moving_digest

  section "Publicar ${ref}"

  # La imagen tiene que estar **aquí**: es la que `infra/ci/verify-artifact.sh` acaba de levantar. Si no está, lo que
  # se publicaría sería otra cosa, y eso es un fallo, no algo que se arregle reconstruyendo.
  verified_id="$(docker image inspect "$ref" --format '{{.Id}}' 2>/dev/null)" ||
    fail "la imagen ${ref} no está en el daemon: no se publica lo que no se ha verificado aquí"
  printf '  artefacto verificado en este daemon: %s\n' "$verified_id"

  # `docker push` de la imagen cargada. Nunca un build.
  # TEMPORARY (object-store 9.3, falsación de ADR-048 §4 en arm64): para `api`, el `docker push` de la imagen cargada
  # se SUSTITUYE por una reconstrucción publicada con el builder `docker-container` de setup-buildx-action. Se revierte
  # en el commit siguiente. `--provenance=false`: manifiesto único, sin índice ni atestación.
  if [ "$repo" = "$API_IMAGE" ]; then
    docker buildx build --push --provenance=false --platform "${TARGET_PLATFORM:?}" -f docker/api.Dockerfile -t "$ref" . ||
      fail "no se pudo reconstruir y publicar ${ref}"
  else
    docker push "$ref" || fail "no se pudo publicar ${ref}"
  fi

  # --- El tag local tiene que seguir señalando **al mismo objeto** que se verificó ------------------------------
  # Esta comprobación salió de ver **fallar la falsación**: con `docker buildx build --push` sobre el mismo tag y el
  # driver `docker`, el daemon **reetiqueta la imagen recién construida**, así que el digest de repositorio que se
  # lee después ya es el del artefacto reconstruido y coincide con el del registro. Es decir: sin este guardia, la
  # comprobación de identidad de abajo **pasaba su propia falsación** comparando la reconstrucción consigo misma.
  #
  # Y este guardia **no es** la comparación prohibida de 6.2 —"`{{.Id}}` antes y después"— convertida en la buena:
  # por sí solo no vale nada, porque no consulta el registro ni una vez. Es necesario y nunca suficiente; lo que hace
  # falsable esta comprobación es el cotejo contra el registro que viene a continuación, y los dos van juntos.
  published_id="$(docker image inspect "$ref" --format '{{.Id}}' 2>/dev/null)" ||
    fail "la imagen ${ref} desapareció del daemon durante la publicación"
  if [ "$verified_id" != "$published_id" ]; then
    fail "el paso de publicación sustituyó la imagen local ${ref} (${verified_id} -> ${published_id}): se construyó otra vez para publicar, así que lo que hay en el registro no es lo que se verificó"
  fi

  local_digest="$(repo_digest_of "$repo" "$ref")" || fail \
    "la imagen local ${ref} no tiene digest de repositorio para ${repo}: lo que hay publicado bajo ese tag no salió de este daemon (¿se reconstruyó para publicar?)"

  registry_digest="$(registry_digest_of "$ref")" ||
    fail "el registro no devuelve digest para ${ref}: no se puede afirmar que lo publicado sea lo verificado"

  printf '  verificado (digest de repositorio local): %s\n' "$local_digest"
  printf '  publicado  (digest del registro)        : %s\n' "$registry_digest"

  if [ "$local_digest" != "$registry_digest" ]; then
    fail "lo publicado en ${ref} NO es lo que se verificó: local ${local_digest} != registro ${registry_digest} (alguien reconstruyó entre verificar y publicar)"
  fi
  printf '  identidad confirmada: lo publicado es el artefacto verificado\n'

  # Tag móvil: solo si el invocante lo pide (el workflow, solo desde `main`).
  if [ -z "$MOVING_TAG" ]; then
    printf '  tag móvil: no se mueve en esta corrida (MOVING_TAG vacío)\n'
    return 0
  fi

  moving_ref="${repo}:${MOVING_TAG}"
  section "Mover ${moving_ref} al artefacto verificado"
  docker tag "$ref" "$moving_ref"
  docker push "$moving_ref" || fail "no se pudo publicar ${moving_ref}"

  moving_digest="$(registry_digest_of "$moving_ref")" ||
    fail "el registro no devuelve digest para ${moving_ref}"
  printf '  %s -> %s\n' "$moving_ref" "$moving_digest"
  if [ "$moving_digest" != "$local_digest" ]; then
    fail "el tag móvil ${moving_ref} resuelve a ${moving_digest}, que no es el artefacto verificado ${local_digest}"
  fi
  printf '  identidad confirmada también para el tag móvil\n'
}

section 'Publicación del artefacto verificado'
printf 'tag inmutable: %s\n' "$IMAGE_TAG"
printf 'tag móvil    : %s\n' "${MOVING_TAG:-(ninguno: esta corrida no mueve ningún canal)}"

publish_one "$API_IMAGE"
publish_one "$WORKER_IMAGE"
publish_one "$WEB_IMAGE"

section 'Artefacto publicado'
printf 'api, worker y web publicados con el digest del artefacto que se verificó en este mismo job.\n'
