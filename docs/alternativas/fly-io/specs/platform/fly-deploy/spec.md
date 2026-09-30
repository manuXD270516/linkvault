## Purpose

Despliegue del entorno de staging en Fly.io: cada servicio de la pila es una app de Fly desplegada por digest, solo la
web es pública, los servicios se hablan por la red privada IPv6, los datos viven en volúmenes y el coste está acotado.
Alternativa a Oracle Cloud descartada el 2026-09-30 (ADR-054).

## ADDED Requirements

### Requirement: Cada servicio se despliega por digest desde el registro de Fly

El sistema SHALL desplegar cada app de staging con `fly deploy --image registry.fly.io/<app>@sha256:<digest>`, donde el
digest es el de la imagen verificada por `cd-staging`, y SHALL comprobar antes de desplegar que el digest publicado en
`registry.fly.io` es igual al publicado en GHCR. Ningún despliegue SHALL usar una etiqueta.

#### Scenario: Digest igual en los dos registros

- **WHEN** `cd-staging` publica la imagen verificada en GHCR y en `registry.fly.io`
- **THEN** los dos digests coinciden y el despliegue usa ese digest

#### Scenario: Digest distinto entre registros

- **WHEN** el digest de `registry.fly.io` no es el de la imagen verificada
- **THEN** la publicación falla con clase `artifact` y no se despliega nada

### Requirement: La arquitectura verificada es la del destino

El sistema SHALL verificar el artefacto en `linux/amd64`, la única arquitectura de Fly.io, y la comprobación de
plataformas SHALL rechazar con clase `artifact` cualquier imagen sin `linux/amd64`.

#### Scenario: Imagen de tercero sin amd64

- **WHEN** una imagen de tercero del compose no tiene `linux/amd64`
- **THEN** la verificación falla con clase `artifact` nombrando la imagen y sus plataformas

### Requirement: Solo la web es pública

Solo la app web SHALL declarar un servicio público en el proxy de Fly. La api, el worker, mongo, redis y el almacén de
objetos SHALL NOT tener servicios públicos ni IP pública.

#### Scenario: Configuración de las apps

- **WHEN** se leen los `fly.toml` de las seis apps
- **THEN** solo el de la web contiene `[http_service]`

#### Scenario: El almacén no es alcanzable desde internet

- **WHEN** se pide el almacén de objetos desde fuera de la red privada de Fly
- **THEN** no hay ninguna dirección pública que responda

### Requirement: Los servicios se alcanzan por la red privada IPv6

La api y el worker SHALL escuchar en `::` y responder a otra app de la red privada por `<app>.internal`; mongo, redis y
el almacén SHALL escuchar en IPv6 en la red privada.

#### Scenario: Salud desde otra app de la red privada

- **WHEN** una máquina efímera de la organización pide `/health` a `linkvault-stg-api.internal:3000` y a `linkvault-stg-worker.internal:3001`
- **THEN** las dos responden `200`

#### Scenario: Api escuchando solo en IPv4

- **WHEN** la api escucha en `0.0.0.0`
- **THEN** la comprobación desde otra app falla nombrando la api

### Requirement: El aprovisionamiento bloquea el despliegue

La app de la api SHALL declarar `object-store provision` como `release_command`, de modo que un aprovisionamiento
fallido aborte el despliegue antes de cambiar ninguna máquina.

#### Scenario: Aprovisionamiento fallido

- **WHEN** `object-store provision` sale distinto de 0 durante el despliegue
- **THEN** Fly aborta el despliegue y las máquinas siguen con la versión anterior

### Requirement: Datos persistentes en volúmenes

Mongo, redis y el almacén de objetos SHALL guardar su estado en volúmenes de Fly con snapshots diarios, y sus máquinas
SHALL NOT pararse automáticamente.

#### Scenario: Reinicio de una máquina con estado

- **WHEN** se reinicia la máquina de mongo
- **THEN** los datos siguen presentes y la api vuelve a `up` sin intervención

### Requirement: Secretos fuera del repositorio

Los secretos de staging SHALL fijarse con `fly secrets set` y `gh secret set` por el usuario, y SHALL NOT aparecer en
ningún `fly.toml`, fichero versionado ni log.

#### Scenario: Configuración versionada sin secretos

- **WHEN** se buscan en `infra/fly/` los nombres de las variables secretas con un valor asignado
- **THEN** no aparece ninguno

### Requirement: Coste acotado

La cuenta de Fly SHALL tener una alerta de facturación al 80 % del tope mensual que fija el usuario, y el tope y la
región SHALL estar anotados en `infra/README.md`.

#### Scenario: Alerta configurada

- **WHEN** se revisa la facturación de la organización de staging
- **THEN** existe una alerta al 80 % del tope anotado
