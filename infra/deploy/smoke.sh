#!/usr/bin/env bash
# ===================================================================================================================
# Smoke tras el despliegue a staging: `GET /health` contra `api` **por la red de Docker**, no contra Traefik
# (requirement «CD a staging en main»; design D4 de `staging-host`, tarea 4.5).
# ===================================================================================================================
# Corre en el host: `ssh … "bash <dir fijo>/.incoming-<sha12>/infra/deploy/smoke.sh"`. Exige la readiness de Nest
# (`"status":"up"` con las comprobaciones de mongo y redis), nunca HTML: un HTML significa que respondió el SPA y no la
# API. Antes era JavaScript dentro de una orden de shell dentro de un `script:` del workflow; como fichero se lee, se
# prueba en local con un `docker` falso y viaja con el resto de la configuración.
# ===================================================================================================================
set -euo pipefail

script_dir="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
staging_dir="$(cd "$script_dir/../../.." && pwd)"
cd "$staging_dir"

# Dentro del contenedor de `api` hay `node` (en el host no): pide /health, lo imprime y sale ≠0 si no es 200 o si el
# cuerpo no es la readiness de Nest con `status`, `checks.mongo.status` y `checks.redis.status` en `up`.
probe='fetch("http://127.0.0.1:3000/health").then(async (r) => { const t = await r.text(); console.log(t); const j = JSON.parse(t); const up = (x) => x && x.status === "up"; if (!r.ok || !up(j) || !j.checks || !up(j.checks.mongo) || !up(j.checks.redis)) process.exit(1); }).catch((e) => { console.error(String(e)); process.exit(1); })'

body="$(docker compose -f docker-compose.prod.yml --env-file .env.staging exec -T api node -e "$probe")" || {
  printf 'smoke: /health de api no respondió 200: %s\n' "${body:-sin cuerpo}" >&2
  exit 1
}
printf '%s\n' "$body"

case "$body" in
  *'<html'* | *'<!DOCTYPE'* | *'<!doctype'*)
    printf 'smoke: /health devolvió HTML (el SPA), no la readiness de api\n' >&2
    exit 1
    ;;
esac
# Segunda barrera, en el host: el `status` de primer nivel (la primera clave de la respuesta) y los dos checks en `up`.
# Buscar solo `"status":"up"` no basta: lo contiene también un cuerpo en `down` con alguna dependencia en `up`.
case "$body" in
  '{"status":"up"'*) ;;
  *)
    printf 'smoke: /health no empieza por {"status":"up"\n' >&2
    exit 1
    ;;
esac
for needle in '"mongo":{"status":"up"}' '"redis":{"status":"up"}'; do
  case "$body" in
    *"$needle"*) ;;
    *)
      printf 'smoke: a /health le falta %s\n' "$needle" >&2
      exit 1
      ;;
  esac
done
printf 'smoke: api sana (mongo y redis up)\n'
