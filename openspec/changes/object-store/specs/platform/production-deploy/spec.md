## MODIFIED Requirements

### Requirement: Compose de producción

El repositorio SHALL incluir un `docker-compose.prod.yml` (o nombre equivalente documentado) que declare los servicios
`api`, `worker` (al menos una réplica), `web`, MongoDB como replica set `rs0` de un nodo, Redis, un almacén de objetos
S3-compatible que cumpla `platform/object-store` y Traefik como proxy de entrada. El compose NO SHALL nombrar un
producto de almacén concreto como parte del contrato: la imagen del almacén es un valor por defecto sustituible por
variable.

El arranque documentado SHALL constar de **levantar la pila esperando a que esté sana y ejecutar la orden de
aprovisionamiento del almacén** («Aprovisionamiento idempotente y separado de la salud», `platform/object-store`), y
SHALL dejar esos servicios saludables según sus healthchecks y el almacén aprovisionado, sin pasos manuales fuera de las
variables de entorno, los secretos y esas órdenes documentadas.

**El healthcheck de cada servicio SHALL decidir por el contenido de la respuesta, no por su código de estado.** El de
`worker` hoy solo hace `JSON.parse` del cuerpo: acierta **por accidente**, porque el controlador devuelve `503` cuando
algún indicador está caído. El día que responda `200` describiendo un estado degradado —un cambio razonable, hecho en
otro fichero por alguien que no sabe que este depende de ese detalle—, `docker compose up --wait` daría **verde con el
worker degradado** y el despliegue se daría por bueno. Una garantía que se sostiene sobre una casualidad no es una
garantía. Por tanto:

- Cuando el servicio publique un estado y sus dependencias, el healthcheck SHALL exigir **estado global arriba y cada
  dependencia arriba**; para `api` y `worker`, al menos mongo y redis, con el mismo criterio en los dos.
- Cuando el servicio sirva contenido, como `web`, el healthcheck SHALL exigir que lo servido sea el documento esperado,
  no una respuesta cualquiera.
- Un healthcheck que necesite el código de estado para distinguir sano de degradado NO SHALL considerarse suficiente,
  aunque hoy funcione.
- El healthcheck del almacén SHALL ser de **solo lectura** («Healthcheck del almacén de solo lectura»,
  `platform/object-store`): contestar si está sano NO SHALL crear ni configurar nada.

#### Scenario: Stack prod completo

- **GIVEN** un host con Docker y las variables de producción definidas
- **WHEN** se ejecuta el arranque documentado en `infra/README.md`
- **THEN** SHALL quedar en ejecución `api`, al menos una réplica de `worker`, `web`, Mongo `rs0`, Redis, el object store
  y Traefik
- **AND** los healthchecks de `api` y `worker` SHALL reportar salud según `platform/runtime-health`
- **AND** el almacén SHALL quedar aprovisionado y su modo de comprobación SHALL terminar con código cero

#### Scenario: Réplicas del worker

- **GIVEN** la configuración de compose con `worker` a escala ≥ 1
- **WHEN** se levanta el stack de producción
- **THEN** SHALL existir al menos una réplica de `worker` consumiendo colas
- **AND** el compose SHALL permitir escalar `worker` sin tocar el resto de servicios

#### Scenario: La salud se decide por el contenido, no por el código de estado

- **GIVEN** un servicio cuyo endpoint de salud responde `200` con un cuerpo que declara una dependencia caída
- **WHEN** el healthcheck de ese servicio en el compose lo evalúa
- **THEN** SHALL considerarlo **no** saludable por lo que dice el cuerpo
- **AND** `docker compose up --wait` NO SHALL terminar en verde con ese servicio degradado
- **AND** el healthcheck de `worker` SHALL exigir mongo y redis arriba, igual que el de `api`, sin apoyarse en el código
  de estado

#### Scenario: Levantar la pila no aprovisiona el almacén

- **GIVEN** volúmenes vacíos y la pila levantada con espera de salud, sin ejecutar todavía la orden de aprovisionamiento
- **WHEN** se listan los buckets del almacén
- **THEN** NO SHALL existir ninguno creado por el healthcheck
- **AND** tras ejecutar la orden de aprovisionamiento SHALL existir los dos con su configuración

## ADDED Requirements

### Requirement: Las imágenes de la pila se pueden descargar en la arquitectura del destino

Antes de descargar ninguna imagen para arrancar la pila, SHALL comprobarse que **cada imagen que resuelve el compose de
producción** —las de la aplicación y las de terceros— existe en su registro **para la plataforma del destino**. La
plataforma del destino SHALL ser la del daemon de Docker donde se va a arrancar, salvo que se declare explícitamente.

**Alcance y desde cuándo.** Este requirement SHALL aplicarse al despliegue a staging desde `staging-host` (35b) y al
despliegue a producción desde `verify-reusable-workflow` (35c); hasta entonces, esos despliegues no lo incumplen por no
llamar todavía al script. En la **verificación del artefacto** del CD, las imágenes propias recién construidas aún no
están en ningún registro: se comprueban **en el daemon** donde se cargaron, y las de terceros con el script.

El repositorio SHALL incluir un script que haga esa comparación, y su resultado SHALL distinguir tres desenlaces:

1. **todas presentes** → sigue el despliegue;
2. **alguna imagen no existe para esa plataforma** —el registro la ofrece solo para otras, su índice no la incluye, o
   el registro dice que esa etiqueta no existe— → falla nombrando la imagen, la plataforma pedida y las que sí existen. Es un **defecto del artefacto**: el
   repositorio eligió o publicó esa imagen, y NO SHALL comunicarse como avería del registro;
3. **no se pudo consultar el registro** (sin respuesta, nombre que no resuelve, credenciales rechazadas, límite de
   peticiones o cualquier error que no se sepa clasificar) → falla diciendo que no se pudo comprobar, sin atribuirlo a
   la imagen.

El script SHALL ejecutarse solo con Docker y sus plugins oficiales de Compose y Buildx, sin intérpretes ni utilidades
que el host de despliegue no necesite ya para desplegar.

#### Scenario: Todas las imágenes existen para el destino

- **GIVEN** un compose cuyas imágenes existen todas para `linux/arm64` y un destino `linux/arm64`
- **WHEN** se ejecuta la comprobación de plataformas
- **THEN** SHALL terminar con código cero listando cada imagen con la plataforma encontrada

#### Scenario: Una imagen de terceros sin la arquitectura del destino

- **GIVEN** un compose que referencia una imagen cuyo índice no incluye `linux/arm64`, y un destino `linux/arm64`
- **WHEN** se ejecuta la comprobación de plataformas
- **THEN** SHALL fallar antes de descargar nada, nombrando la imagen y las plataformas que sí ofrece
- **AND** el fallo SHALL identificarse como defecto del artefacto, no como avería del registro

#### Scenario: Una imagen de una sola plataforma distinta de la del destino

- **GIVEN** una imagen publicada con un único manifiesto `linux/amd64`, sin índice, y un destino `linux/arm64`
- **WHEN** se ejecuta la comprobación de plataformas
- **THEN** SHALL fallar igual que si faltara en un índice, sin dejar que la descarga la acepte con un aviso y el
  contenedor muera después con un error de formato

#### Scenario: El registro no responde

- **GIVEN** un registro que no responde o rechaza las credenciales
- **WHEN** se ejecuta la comprobación de plataformas
- **THEN** SHALL fallar diciendo que no se pudo comprobar
- **AND** NO SHALL afirmar que falta ninguna plataforma
