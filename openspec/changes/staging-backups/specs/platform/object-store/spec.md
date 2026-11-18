## MODIFIED Requirements

### Requirement: El almacén se usa solo por la API S3

La aplicación, el aprovisionamiento del almacén, la verificación del artefacto y el arranque documentado SHALL hablar
con el almacén **exclusivamente por la API S3**, autenticándose con las credenciales del fichero de entorno. Ningún paso
del arranque documentado, del despliegue ni de la verificación SHALL depender de la CLI ni de la API de administración
de un producto concreto: el día que el producto cambie, lo que se sustituye es la imagen y su configuración, no el
código ni esos procedimientos.

**Única excepción, acotada:** asegurar la identidad S3 de solo lectura del respaldo (`platform/backups`) MAY usar la API
de identidades que expone la pasarela del almacén, con la forma de la API IAM de AWS, **solo** desde un script aislado
(`infra/backup/ensure-backup-identity.sh`, ejecutado desde un proceso efímero sin salida en la red del almacén) que es
lo único a reescribir si cambia el producto. Ningún otro paso SHALL
usarla, y NO SHALL usarse la CLI del producto ni ejecutarse órdenes dentro del contenedor del almacén para ello.

Los procedimientos de operación del RUNBOOK que todavía usen la CLI de un producto anterior (listar y borrar objetos,
recoger huérfanos) SHALL marcarse como **pendientes y no aplicables al almacén actual** mientras no se reescriban, y NO
SHALL presentarse como una operación válida sobre él.

La configuración propia del producto (sus credenciales, su clave de cifrado del lado del servidor si la tiene) SHALL
llegar por variables interpoladas desde el fichero de entorno. En el **compose de producción** esas variables SHALL ser
obligatorias y sin valor por defecto. El compose de **desarrollo** MAY llevar valores de desarrollo por defecto (p. ej.
`${S3_SECRET_KEY:-linkvault-dev-secret}`), que no son secretos de ningún entorno real. NO SHALL versionarse ningún
fichero que contenga un secreto del almacén de un entorno real.

#### Scenario: Arrancar, desplegar y verificar no usan la CLI de un producto

- **WHEN** se revisan el arranque documentado en `README.md` e `infra/README.md`, el despliegue y la verificación del
  artefacto
- **THEN** NO SHALL contener órdenes de la CLI de un producto de almacén (p. ej. `mc`)
- **AND** comprobar la configuración del almacén SHALL hacerse con la herramienta S3 del propio repositorio

#### Scenario: Un procedimiento con la CLI de otro producto está marcado

- **GIVEN** una sección del RUNBOOK que opera el almacén con la CLI de un producto que ya no es el almacén
- **WHEN** alguien la lee
- **THEN** SHALL encontrar al principio que está pendiente y no aplica al almacén actual

#### Scenario: Las credenciales del almacén no viven en el repositorio

- **WHEN** se inspecciona el servicio del almacén en el compose de producción
- **THEN** sus credenciales y su clave de cifrado SHALL aparecer solo como referencias obligatorias a variables del
  fichero de entorno, sin valor por defecto

#### Scenario: El compose de desarrollo puede traer valores de desarrollo

- **WHEN** se inspecciona el servicio del almacén en el compose de desarrollo
- **THEN** sus credenciales y su clave de cifrado SHALL ser referencias a variables del fichero de entorno
- **AND** esas referencias MAY llevar un valor de desarrollo por defecto

#### Scenario: La API de identidades solo la usa el script del respaldo

- **WHEN** se buscan llamadas a la API de identidades del almacén en el repositorio
- **THEN** SHALL aparecer solo en `infra/backup/ensure-backup-identity.sh`

### Requirement: Solo la aplicación alcanza el almacén por la red

El servicio del almacén SHALL vivir en **redes de contenedores propias**, porque un producto puede escuchar en puertos
internos sin autenticación que su configuración no permite cerrar. En el compose de **producción**, a esas redes SHALL
pertenecer **solo** el almacén, los procesos de la aplicación que lo usan (`api` y `worker`), el **lector de objetos
del respaldo**, el **proceso que asegura su identidad** y el **cargador de objetos de la restauración**
(`platform/backups`); cada una SHALL ser una red sin
salida ni puertos publicados, y el almacén NO SHALL pertenecer a ninguna otra. El lector del respaldo SHALL leer con
una identidad S3 de solo lectura propia; esos tres procesos NO SHALL tener salida a Internet, ni compartir red con
`api` o `worker`, ni guardar registros, y SHALL existir solo mientras dura la corrida o la restauración. Ningún otro
servicio (base de datos, cola, `web`, proxy de entrada, el proceso que envía los respaldos) SHALL poder alcanzar
**ningún** puerto del almacén. En el compose de **desarrollo**, donde la aplicación corre en el host, el almacén SHALL
estar solo en su red y publicar en el host **únicamente** su puerto S3. Aislar la red NO SHALL cambiar la configuración
del producto que midió la matriz.

#### Scenario: Otro servicio de la pila no alcanza el almacén

- **GIVEN** la pila de producción levantada
- **WHEN** un contenedor de la red de la base de datos y la cola intenta conectar con cualquier puerto del almacén
- **THEN** la conexión SHALL fallar por resolución o por conexión, sin llegar a ninguna respuesta del almacén

#### Scenario: La aplicación sí alcanza el almacén

- **GIVEN** la pila de producción levantada
- **WHEN** se ejecuta el modo de comprobación del aprovisionamiento con la imagen de la aplicación
- **THEN** SHALL terminar con código cero

#### Scenario: Unirse a la red del almacén da acceso

- **GIVEN** el mismo contenedor que no alcanzaba el almacén
- **WHEN** se une a la red del almacén
- **THEN** SHALL alcanzar sus puertos internos, lo que demuestra que la separación la da la red

#### Scenario: El lector del respaldo alcanza el almacén y nada más

- **GIVEN** la pila de producción levantada y el lector de objetos del respaldo en marcha
- **WHEN** lista los buckets con su identidad de solo lectura y abre una conexión a un sitio público
- **THEN** el listado SHALL funcionar
- **AND** la conexión externa SHALL fallar

#### Scenario: El que envía los respaldos no alcanza el almacén

- **GIVEN** el proceso que envía los respaldos en marcha
- **WHEN** intenta conectar con cualquier puerto del almacén
- **THEN** la conexión SHALL fallar por resolución
