## Why

MongoDB y Redis responden **sin autenticación** a cualquiera que llegue a su red: en `docker-compose.yml`, con todos
los puertos publicados en todas las interfaces del host, y, hasta que entre la defensa en profundidad de 35b, también en
`docker-compose.prod.yml`. Tres decisiones ya tomadas apuntan a cerrarlo:

- **ADR-058, riesgo aceptado R8** (`cv-extract-isolation`): el hijo que lee los CV tiene red, porque en Node 22 el
  modelo de permisos no restringe sockets, «y en la red interna del compose MongoDB y Redis responden sin
  autenticación». El hijo arranca con `env: {}`: con autenticación los alcanza pero no tiene con qué entrar. Respuesta
  del owner a su Q7, 2026-10-29: (a) el flag de red se agrega al subir a Node 26 LTS, y (b) **la autenticación de
  MongoDB y Redis va en un change propio después de la fila 35**. Este es ese change.
- **ADR-056 §6** (`enrichment-egress-guard`): «contraseñas en Redis y Mongo aunque estén en una red privada». Respuesta
  del owner a su Q3, 2026-10-29: trasladarla a 35b, que la escribió como su D18, medida 3 (PR #92,
  `spec/staging-host-defense-in-depth`, abierto al 2026-11-04).
- **ADR-051, riesgos aceptados**: «Mongo de producción no tiene autenticación […] autenticar Mongo queda fuera de la
  fila».

Lo que 35b D18 (medida 3) deja hecho en `docker-compose.prod.yml` es la base: `requirepass` con `REDIS_PASSWORD`, una
raíz de Mongo creada sobre un volumen vacío, el `keyFile` generado dentro del contenedor, el formato apto para URI de
las contraseñas y ninguna contraseña en los argumentos de un proceso. Lo que **no** deja, y este change define:

- **`api` y `worker` entran como raíz.** No hay usuario de aplicación con privilegio mínimo.
- **La infraestructura de desarrollo escucha en toda la red del equipo**, sin credenciales.
- **La adopción en staging** (un volumen con datos y la raíz) no está escrita, ni su vuelta atrás.
- **No hay rotación escrita** de ninguna de las tres credenciales.
- **No hay validación al arrancar**: una URI de producción sin credenciales se descubre al fallar la conexión.

## What Changes

- **Usuario de aplicación de mínimo privilegio** en Mongo: `api` y `worker` se conectan con un usuario que solo tiene
  lectura y escritura sobre la base de la aplicación; la raíz queda para el propio servicio `mongo` y el operador, y
  sale del entorno de `api` y `worker`. Variable nueva: `MONGO_APP_PASSWORD`.
- **El healthcheck de `mongo` se reescribe** (`hello` → raíz → replica set → usuario de aplicación → primario): asegura
  ese usuario de forma idempotente, **no crea la raíz** y nunca imprime un valor. Un volumen con datos y sin usuarios no
  se da por sano y sigue un procedimiento manual escrito.
- **Desarrollo** (Q5 (a), recomendada y abierta al owner): todos los puertos de `docker-compose.yml` atados a
  `127.0.0.1`, sin autenticación.
- **Rotación escrita** de las tres credenciales; la de la aplicación y la de Redis, ensayadas; la de la raíz, como
  sección del RUNBOOK sin pasar contraseñas por argumentos.
- **Validación sin exponer secretos**: el arranque de producción exige credenciales en `MONGO_URI` y `REDIS_URL`
  nombrando la variable y nunca su valor; `check-env-file.mjs` extiende la regla de formato de 35b y rechaza valores de
  relleno y repetidos; reglas exactas del compose de producción para una lista cerrada de tres contraseñas; los
  registros redactan URIs y contraseñas y nombran el código de un fallo de autenticación.
- **Una sola orden de comprobación** (`infra/deploy/check-auth.sh`) para la verificación en CI y para el host, más un
  ayudante de `mongosh` autenticado y un recuento de solo lectura para antes y después de migrar.
- **El runner de `e2e-stack`** conserva usuario y contraseña al reescribir el puerto de una URI.
- **ADR-065** (Propuesto).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `platform/local-environment`: la infraestructura local solo escucha en el propio equipo, y el runner e2e conserva las
  credenciales de una URI (requirements añadidos).
- `platform/production-deploy`: usuario de aplicación de mínimo privilegio, generación y custodia de las credenciales,
  rotación, adopción por un despliegue existente y una comprobación de credenciales compartida (requirements añadidos,
  sobre el que añade 35b D18 al archivarse).
- `platform/runtime-health`: credenciales exigidas al arrancar en producción y registros sin credenciales
  (requirements añadidos).

## Impact

- **Ficheros**: `docker-compose.yml` (solo `ports`), `docker-compose.prod.yml`, `.env.example`, `infra/ci/verify.env`,
  `infra/ci/verify-artifact.sh`, `infra/ci/check-env-file.mjs`, `infra/deploy/config-files.txt`, nuevos
  `infra/deploy/check-auth.sh`, `infra/datastore/mongo-shell.sh` e `infra/staging/counts.mongosh.js`,
  `infra/staging/run.sh` y `seed-volume.sh`, `tools/repo-checks`, los esquemas de configuración y los módulos de
  conexión de `api` y `worker`, `logger-params.ts`, `apps/web-e2e/scripts/`, `docs/RUNBOOK.md` e `infra/README.md`.
- **Fuera de alcance**: el flag de red de Node (`--allow-net`), que llega con la subida a Node 26 LTS por decisión del
  owner (Q7 (a) de `cv-extract-isolation`, 2026-10-29); autenticación en desarrollo con Q5 (a); TLS entre servicios;
  usuarios ACL de Redis; un gestor de secretos; rotar las claves del almacén de objetos.
- **Orden**: entra **después de la fila 35** (35c archivado), sin excepción a su precedencia, y **después de archivar
  35b** con su D18. No edita `openspec/changes/staging-host/`.
- **El owner** genera los valores, los escribe en el `.env` del host y en su copia fuera del host, guarda la copia del
  volumen y ejecuta las órdenes que tocan el host. Ningún valor real pasa por el repositorio, por GitHub ni por un
  registro.
