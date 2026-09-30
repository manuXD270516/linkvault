## Context

Pieza alternativa a 35b (`staging-host`). Parte del estado que deja 35a (`object-store`): pila sin MinIO, SeaweedFS con
cifrado nativo y guardia de la clave, `provision`/`verify`/`s3-probe`, comprobación de plataformas y de salud desde otro
contenedor, CD verificando en `arm64` con la plataforma en `TARGET_PLATFORM`. Los hechos de Fly.io que condicionan el
diseño están medidos en ADR-054 §Contexto.

## Goals / Non-Goals

**Goals:** `cd-staging` despliega de verdad a Fly.io el mismo digest que verificó; la pila entera corre en Fly con sus
datos persistentes; solo la web es pública; ningún secreto pasa por el repositorio ni por el chat.

**Non-Goals:** producción (`cd-prod`), dominio propio, alta disponibilidad, varias regiones, Tigris o Upstash, escalado
automático.

## Decisions

### D1. Topología: una app de Fly por servicio

| App | Servicio | Pública | Máquina | Volumen |
|---|---|---|---|---|
| `linkvault-stg-web` | nginx con el SPA | sí (`[http_service]`, 443) | shared-cpu-1x 256 MB | — |
| `linkvault-stg-api` | api | no | shared-cpu-1x 512 MB-1 GB | — |
| `linkvault-stg-worker` | worker | no | shared-cpu-1x 1 GB | — |
| `linkvault-stg-mongo` | mongo 7, réplica de 1 nodo | no | shared-cpu-1x 1 GB | 3 GB |
| `linkvault-stg-redis` | redis 7 | no | shared-cpu-1x 256 MB | 1 GB |
| `linkvault-stg-store` | SeaweedFS 4.47 con su guardia | no | shared-cpu-1x 512 MB | 5 GB |

Una máquina por app, `auto_stop_machines = "off"` en todas (el worker ejecuta BullMQ y el barrido diario; mongo, redis y
el almacén guardan estado). Traefik desaparece: TLS y enrutado público los hace el proxy de Fly.

**Alternativas descartadas:** una sola máquina con compose dentro (Fly no está pensado para Docker-in-VM y pierde las
ventajas del proxy); Tigris (clave custodiada por Tigris, contradice `privacy.cv.encryption.v2`); Upstash (BullMQ sondea
y encarece); Mongo Atlas M0 (fuera de Fly, límite de 512 MB y otra cuenta).

### D2. Arquitectura del destino `linux/amd64`

Fly solo ejecuta `amd64`. `TARGET_PLATFORM: linux/amd64` y el job `build-verify-publish` en `ubuntu-24.04`. La
comprobación de plataformas de 35a sigue: daemon y las tres imágenes propias iguales a `TARGET_PLATFORM`; terceras con
`linux/amd64` o salida 3 (`artifact`).

### D3. Registro de despliegue `registry.fly.io`, identidad por digest

Fly no descarga imágenes privadas de GHCR. `publish-artifact.sh` publica en GHCR **y** en `registry.fly.io/<app>` y
comprueba en los dos lo mismo que ADR-048 §4: el digest del registro es el de la imagen verificada. El despliegue es
`fly deploy --app <app> --image registry.fly.io/<app>@sha256:<digest>`, nunca por etiqueta. Un digest distinto entre
registros falla con clase `artifact`.

### D4. Red privada IPv6

La 6PN de Fly es IPv6. api y worker escuchan en `::` (dual-stack), sustituyendo `0.0.0.0` de ADR-052; mongo con
`--bind_ip_all --ipv6`, redis con `bind :: 0.0.0.0` y SeaweedFS con `-ip.bind=::` (medir la flag en 4.47 antes de
adoptarla; si no existe, `fly-local-6pn`). Los nombres son `<app>.internal`. La comprobación «desde otro contenedor» de
35a (7.10) pasa a ser «desde otra app de la 6PN»: una máquina efímera `fly machine run --rm` que pide `/health`.

### D5. Aislamiento

Solo `linkvault-stg-web` declara `[http_service]`. El resto no tiene IP pública ni servicios en el proxy. Todas las apps
de la organización comparten la 6PN: la organización de Fly se usa **solo** para LinkVault staging, que es el equivalente
a la red propia del almacén (ADR-052 D14).

### D6. Borde y enrutado

nginx de la imagen `web` pasa `/api/*` y `/p/*` a `http://linkvault-stg-api.internal:3000` y sirve el SPA en lo demás;
cabeceras `X-Forwarded-*` y `Referrer-Policy` como hoy en Traefik. TLS y certificado los da Fly en
`linkvault-stg-web.fly.dev`, sin dominio ni sslip.io.

### D7. Aprovisionamiento como `release_command`

`linkvault-stg-api` declara `release_command = "node object-store.js provision"`: Fly lo ejecuta en una máquina efímera
antes de cambiar las máquinas y **aborta el despliegue** si falla. `verify` y `s3-probe` se ejecutan después con
`fly machine run --rm`.

### D8. Datos en volúmenes

Volúmenes de Fly para mongo, redis y SeaweedFS, con snapshots diarios (retención por defecto de Fly; los primeros 10 GB
gratis). Staging sigue siendo desechable (ADR-051): no hay copias fuera de Fly salvo `.env` equivalente, que aquí son los
secretos (D9) y su copia del usuario.

### D9. Secretos

`fly secrets set` por app, **puestos por el usuario**; nunca en `fly.toml` ni en el repositorio. En GitHub, un único
secreto `FLY_API_TOKEN` de despliegue con alcance a la organización de staging, también puesto por el usuario.
`OBJECT_STORE_SSE_KEY` pasa por `check-env-file.mjs` (formato y distinta de las claves de desarrollo y de CI) antes de
fijarse.

### D10. Región y coste

Región `iad` (1×; `gru` cuesta 1,615×). Presupuesto: ~20-25 USD/mes. Alerta de facturación en la cuenta de Fly al 80 %
de un tope que fija el usuario.

### D11. Lo que se conserva de 35b

Correo por Brevo (SMTP 587), IA por OpenRouter con `data_collection: deny`, smoke tras desplegar, precondición de invitar
con `e2e-remote` contra staging (`e2e-suite` 9.4), medición de uso y exclusión de cuentas E2E.

### D12. Vuelta atrás

`fly releases` + `fly deploy --image` del digest anterior. El smoke fallido tras desplegar deja el desenlace «artefacto
verificado, despliegue fallido» y no mueve `:staging`.

## Risks / Trade-offs

- [Coste recurrente] → alerta al 80 %; staging se puede destruir (`fly apps destroy`) y reconstruir desde el CD.
- [Volúmenes en un solo servidor físico] → staging desechable; snapshots diarios.
- [Cambio de escucha a `::`] → probado con la comprobación desde otra app de la 6PN y con los tests de 7.9 adaptados.
- [Dos registros] → la identidad por digest se comprueba en los dos; un desajuste es `artifact`.
- [Precios de Fly cambian con frecuencia] → se releen al adoptar y se anotan en ADR-054.

## Migration Plan

1. Rama con este change; 35a ya fusionado.
2. Grupos 1-3 (CD, registro, escucha) verificados en modo de prueba sin destino.
3. El usuario crea la organización de Fly, las apps, volúmenes y secretos (grupo 4, tareas del usuario).
4. Primer despliegue real y smoke (grupo 5); luego invitar como en 35b.

## Open Questions

- ¿Cuenta de Fly nueva o la de otros proyectos con asignaciones heredadas? (decide el usuario; cambia el coste).
- ¿`iad` o `gru`? (latencia frente a 1,615× de coste).
