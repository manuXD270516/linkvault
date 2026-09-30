> Change alternativo a 35b. Cada tarea cabe en menos de una hora, lleva su etiqueta y dice qué se ejecuta para darla
> por cerrada. Las tareas marcadas **[usuario]** las hace el usuario (cuenta, apps, secretos); el resto, los agentes. Antes de
> `/opsx:apply`: redactar los MODIFIED pendientes (proposal) y `/lv:debate`.

## 1. Arquitectura del destino `amd64` (design D2)

- [ ] 1.1 [infra] `cd-staging.yml`: `TARGET_PLATFORM: linux/amd64` y `runs-on: ubuntu-24.04` en `build-verify-publish`, caché `scope=<imagen>-amd64`. Verificar con un `node -e` sobre el YAML parseado y una corrida en modo de prueba en verde con `linux/amd64` en el log del daemon.
- [ ] 1.2 [infra] Falsación: una imagen de tercero sin `linux/amd64` en el paso de verificación da clase `artifact` (como la 10.3 de 35a). Verificar con la corrida y la descripción del estado de commit.

## 2. Registro `registry.fly.io` e identidad por digest (design D3)

- [ ] 2.1 [infra] `publish-artifact.sh`: publicar también en `registry.fly.io/<app>` y comprobar en los dos registros que el digest es el de la imagen verificada. Verificar con una corrida real desde una rama: los dos digests iguales en el log.
- [ ] 2.2 [infra] Falsación de identidad en `registry.fly.io` (como la 9.3 de 35a): reconstruir la imagen en lugar de empujar la verificada; ver fallar la comprobación y borrar solo esa versión. Verificar con el mensaje del fallo y el listado del registro.

## 3. Escucha en la red privada IPv6 (design D4)

- [ ] 3.1 [backend] api y worker escuchan en `::`. Adaptar `listen-on-all-interfaces.spec.ts` (35a 7.9) para exigir dirección `::` y respuesta por IPv4 **y** por IPv6 que no sea loopback; falsación volviendo a `0.0.0.0`.
- [ ] 3.2 [infra] mongo, redis y SeaweedFS con enlace IPv6 en sus `fly.toml` (medir la flag de SeaweedFS 4.47; si no hay, `fly-local-6pn`). Verificar en local con una red Docker IPv6 que otro contenedor alcanza cada servicio por su dirección IPv6.

## 4. Cuenta, apps, volúmenes y secretos (design D1, D5, D8, D9)

- [ ] 4.1 [infra] **[usuario]** Crear (o elegir) la organización de Fly dedicada a staging y registrar la decisión de cuenta nueva o heredada y la región en `infra/README.md`.
- [ ] 4.2 [infra] Escribir `infra/fly/{web,api,worker,mongo,redis,store}.fly.toml` según design D1 (solo `web` con `[http_service]`, `auto_stop_machines = "off"`, volúmenes, `release_command` en api). Verificar con `fly config validate` para cada uno y un `node -e` que solo encuentra `[http_service]` en `web`.
- [ ] 4.3 [infra] **[usuario]** `fly apps create` y `fly volumes create` para las seis apps, en la región elegida. Verificar con `fly apps list` y `fly volumes list` pegados en `infra/README.md`.
- [ ] 4.4 [infra] **[usuario]** `fly secrets set` por app (credenciales S3, `OBJECT_STORE_SSE_KEY` pasada antes por `check-env-file.mjs`, `AUTH_*`, `AI_VAULT_KEY`, `MAIL_*`, `OPENROUTER_*`) y `FLY_API_TOKEN` en GitHub. Verificar con `fly secrets list` (solo nombres) y `gh secret list`.
- [ ] 4.5 [infra] **[usuario]** Alerta de facturación en Fly al 80 % del tope mensual elegido. Verificar con la captura de la configuración (sin datos de pago).

## 5. Borde, despliegue y smoke (design D6, D7, D11, D12)

- [ ] 5.1 [frontend] nginx de la imagen `web`: `/api/*` y `/p/*` a `linkvault-stg-api.internal:3000`, `X-Forwarded-*` y `Referrer-Policy`. Verificar en local con la pila de producción que `/api/health` devuelve JSON de la api y `/login` el SPA.
- [ ] 5.2 [infra] Job `deploy-staging` con `flyctl`: `fly deploy --image registry.fly.io/<app>@sha256:<digest>` en orden mongo, redis, store, api (con su `release_command`), worker, web. Verificar con una corrida en modo de prueba que el job queda saltado y un `node -e` que no encuentra ningún despliegue por etiqueta.
- [ ] 5.3 [infra] Primer despliegue real desde `main`. Verificar el reporte «desplegado a staging», `fly status` de las seis apps en `started`, y `verify` y `s3-probe` con `fly machine run --rm` en `ok`.
- [ ] 5.4 [infra] Comprobación desde otra app de la 6PN: una máquina efímera pide `/health` de api y worker por `.internal` y obtiene `200`; falsación con la imagen de api escuchando en `0.0.0.0`.
- [ ] 5.5 [infra] Smoke tras desplegar contra `https://linkvault-stg-web.fly.dev`: `/api/health` `up`, `/login` con `<lv-root`, `/api/cv` sin token `401`. Verificar con el log del job.
- [ ] 5.6 [infra] Vuelta atrás: desplegar el digest anterior con `fly deploy --image` y volver. Verificar con `fly releases` y el smoke en los dos sentidos.

## 6. Documentación y cierre

- [ ] 6.1 [infra] `infra/README.md` y `docs/RUNBOOK.md`: operar staging en Fly (apps, volúmenes, secretos, releases, vuelta atrás, coste). Verificar con un `node -e` que encuentra cada encabezado.
- [ ] 6.2 [infra] Enmiendas: ADR-051 (host y TLS), ADR-052 (escucha `::`, plataforma `amd64`) y ADR-054 a «Aceptado». Verificar con un `node -e` que cada uno contiene la línea.
- [ ] 6.3 [infra] `pnpm nx affected -t lint,typecheck,test,i18n-check`, `openspec validate --all` y `repo-checks` en verde.
