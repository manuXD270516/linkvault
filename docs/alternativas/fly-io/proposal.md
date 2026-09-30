## Why

La fila 35 (ADR-051) necesita un destino real para `cd-staging`. El plan vigente es Oracle Cloud Always Free (35b,
`staging-host`): gratis, pero con un servidor que administrar (SO, SSH, cortafuegos, Traefik, TLS con sslip.io), riesgo
de reclamación por inactividad y de «Out of host capacity» al crear la instancia ARM.

Fly.io elimina toda la administración del servidor y da TLS en `*.fly.dev` sin dominio, a cambio de **~20-25 USD/mes**
(región `iad`) y de tres ajustes técnicos: imágenes `amd64`, escucha en la red privada IPv6 y un segundo registro. Este
change es la especificación de esa alternativa, **descartada por coste el 2026-09-30** (ADR-054) y lista para adoptarse
si se cumple alguna de sus condiciones de reapertura.

## What Changes

- **Destino de staging en Fly.io** en lugar de Oracle: seis apps de Fly en una región (`iad` por defecto), una por
  servicio de `docker-compose.prod.yml` salvo Traefik, que sobra.
- **Arquitectura del destino `linux/amd64`**: `TARGET_PLATFORM` y el runner de `build-verify-publish` vuelven a `amd64`.
  La comprobación de plataformas de 35a (salida 3/4) se conserva con el nuevo destino.
- **Publicación también en `registry.fly.io`**, con la identidad por digest de ADR-048 comprobada en los dos registros;
  el despliegue usa `fly deploy --image registry.fly.io/<app>@sha256:<digest>`.
- **Escucha en `::`** (IPv4 e IPv6) para api y worker, y enlace IPv6 para mongo, redis y SeaweedFS, porque la red
  privada de Fly (6PN) es IPv6. Sustituye a la decisión `0.0.0.0` de ADR-052 (tarea 7.9 de 35a).
- **`object-store provision` como `release_command`** de la app `api`: se ejecuta antes de cada despliegue y lo
  bloquea si falla.
- **Datos en volúmenes de Fly** (mongo, redis, SeaweedFS) con snapshots diarios.
- **Borde sin Traefik**: la app `web` es la única pública; su nginx pasa `/api/*` y `/p/*` a la api por la red privada.
- **Secretos con `fly secrets`**, puestos por el usuario.
- **Se conserva de 35b**: correo por Brevo, IA por OpenRouter, smoke tras desplegar, precondición de invitar con la
  suite e2e contra staging, medición de uso.

## Capabilities

### New Capabilities

- `platform/fly-deploy`: despliegue de staging en Fly.io por digest, topología de apps, red privada, volúmenes,
  secretos y coste acotado.

### Deltas que se escriben al adoptarlo

No se incluyen ya escritos porque su texto base cambia con 35a y 35c; se redactan como MODIFIED sobre
`openspec/specs/` vigente en el momento de adoptar:

- `platform/ci-pipeline` — «CD a staging en main»: destino Fly, arquitectura `amd64`, registro `registry.fly.io`.
- `platform/production-deploy` — «Compose de producción»: el compose sigue siendo el artefacto que verifica CI, pero el
  despliegue de staging no lo usa; «Las imágenes de la pila se pueden descargar en la arquitectura del destino»: destino
  `linux/amd64`.
- `platform/runtime-health` — «Liveness»: la api y el worker responden a otra app de la red privada (IPv6).

## Impact

- `.github/workflows/cd-staging.yml`: runner, `TARGET_PLATFORM`, publicación en `registry.fly.io`, job de despliegue con
  `flyctl`.
- `infra/fly/<app>.fly.toml` (nuevo, seis ficheros) y la configuración de nginx de la imagen `web`.
- `apps/api/src/app/create-app.ts`, `apps/worker/src/app/create-worker-app.ts`: host de escucha.
- `infra/README.md`, `docs/RUNBOOK.md`: operar staging en Fly.
- ADR-051 (host, TLS) y ADR-052 (escucha, plataforma) enmendados; ADR-054 pasa a Aceptado.
- Coste: ~20-25 USD/mes en `iad`.
