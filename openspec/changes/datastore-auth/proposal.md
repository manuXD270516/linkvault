## Why

MongoDB y Redis responden **sin autenticación** a cualquiera que llegue a su red: en `docker-compose.yml` (con los dos
puertos publicados en el host) y, hasta que entre la defensa en profundidad de 35b, también en
`docker-compose.prod.yml`. Tres decisiones ya tomadas apuntan a cerrarlo:

- **ADR-058, riesgo aceptado R8** (`cv-extract-isolation`): el hijo que lee los CV tiene red, porque en Node 22 el
  modelo de permisos no restringe sockets, «y en la red interna del compose MongoDB y Redis responden sin
  autenticación». Respuesta del owner a su Q7, 2026-10-29: (a) el flag de red se agrega al subir a Node 26 LTS, y
  (b) **la autenticación de MongoDB y Redis va en un change propio después de la fila 35**. Este es ese change.
- **ADR-056 §6** (`enrichment-egress-guard`): «contraseñas en Redis y Mongo aunque estén en una red privada», como
  defensa frente a una falla del filtro de salida. Respuesta del owner a su Q3, 2026-10-29: trasladarla a 35b, que la
  escribió como su D18, medida 3 (PR #92, `spec/staging-host-defense-in-depth`, abierto al 2026-11-04).
- **ADR-051, riesgos aceptados**: «Mongo de producción no tiene autenticación […] autenticar Mongo queda fuera de la
  fila».

Lo que 35b D18 (medida 3) deja hecho en `docker-compose.prod.yml` es la base: `requirepass` con `REDIS_PASSWORD`, un
usuario raíz de Mongo (`MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD`) creado sobre un volumen vacío, el `keyFile` generado
dentro del contenedor y ninguna contraseña en los argumentos de un proceso. Lo que **no** deja, y este change define:

- **El entorno de desarrollo** sigue sin credenciales, con los puertos publicados en el host.
- **`api` y `worker` entran como raíz.** No hay usuario de aplicación con privilegio mínimo.
- **Un volumen anterior se queda sin usuario**: la salida escrita de 35b es `down -v`, que borra los datos.
- **No hay rotación escrita** de ninguna de las tres credenciales.
- **No hay validación**: una contraseña con caracteres que rompen la URI, un valor de desarrollo en un `.env` de
  despliegue o una URI de producción sin credenciales se descubren al fallar la conexión, no antes.

## What Changes

- **Usuario de aplicación de mínimo privilegio** en Mongo: `api` y `worker` se conectan con un usuario que solo tiene
  lectura y escritura sobre la base de la aplicación; la raíz queda para el propio servicio `mongo` y para el operador,
  y sale del entorno de `api` y `worker`. Variable nueva: `MONGO_APP_PASSWORD`.
- **El healthcheck de `mongo` asegura los usuarios** de forma idempotente, como ya asegura el replica set: crea la raíz
  en un volumen con datos y sin usuarios (migración sin pérdida), y crea o ajusta el usuario de aplicación. Nunca
  imprime un valor.
- **Desarrollo con la misma forma que producción**: `docker-compose.yml` con autenticación de Mongo, `keyFile` y
  `requirepass`, con valores de desarrollo por defecto marcados como tales, para que `pnpm infra:up` siga funcionando
  sin `.env`; `.env.example`, `apps/web-e2e/e2e.env` e `infra/ci/verify.env` con credenciales de relleno.
- **Rotación escrita y ensayada** de las tres credenciales; la de la aplicación y la de Redis se rotan editando el
  `.env` y recreando los servicios; la raíz, con un script que no pasa la contraseña por argumentos.
- **Validación sin exponer secretos**: el arranque de producción exige credenciales en `MONGO_URI` y `REDIS_URL`
  nombrando la variable y nunca su valor; `check-env-file.mjs` revisa formato, valores versionados y repetidos; el
  compose de producción no puede dar valor por defecto a una contraseña; los registros redactan URIs y contraseñas y
  nombran la causa de un fallo de autenticación por su código.
- **Las herramientas que reescriben o leen URIs** (el runner de `e2e-stack`, el guardia de la semilla de demostración,
  los `mongosh` del RUNBOOK) aceptan credenciales.
- **ADR-065** (Propuesto).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `platform/local-environment`: credenciales en la infraestructura local, migración de un volumen local sin pérdida y
  URIs con credenciales en las herramientas locales (requirements añadidos).
- `platform/production-deploy`: usuario de aplicación de mínimo privilegio, generación y custodia de las credenciales,
  rotación, adopción por un despliegue existente y verificación del artefacto (requirements añadidos, sobre el que
  añade 35b D18 al archivarse).
- `platform/runtime-health`: credenciales exigidas al arrancar en producción y registros sin credenciales
  (requirements añadidos).

## Impact

- **Ficheros**: `docker-compose.yml`, `docker-compose.prod.yml`, `.env.example`, `apps/web-e2e/e2e.env`,
  `apps/web-e2e/scripts/e2e-stack.ts`, `infra/ci/verify.env`, `infra/ci/verify-artifact.sh`,
  `infra/ci/check-env-file.mjs`, `tools/repo-checks/src/compose-env-contract.check.mjs`, los esquemas de configuración y
  los módulos de conexión de `api` y `worker`, `logger-params.ts`, un script nuevo de rotación de la raíz y un
  ayudante de `mongosh` en `infra/datastore/`, `docs/RUNBOOK.md` e `infra/README.md`.
- **Fuera de alcance**: el flag de red de Node (`--allow-net`) para el hijo de lectura de CV, que llega con la subida a
  Node 26 LTS por decisión del owner (Q7 (a) de `cv-extract-isolation`, 2026-10-29); TLS entre servicios; usuarios ACL
  de Redis; copias de seguridad; un gestor de secretos; rotar las claves del almacén de objetos.
- **Orden**: entra **después de la fila 35** (35c archivado), sin excepción a su precedencia, y **después de archivar
  35b** con su D18. No edita `openspec/changes/staging-host/`.
- **El owner** genera los valores, los escribe en el `.env` del host y en su copia fuera del host, y ejecuta las
  órdenes que tocan el host. Ningún valor real pasa por el repositorio, por GitHub ni por un registro.
