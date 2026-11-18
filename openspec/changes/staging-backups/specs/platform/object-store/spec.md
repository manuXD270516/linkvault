## MODIFIED Requirements

### Requirement: Solo la aplicación alcanza el almacén por la red

El servicio del almacén SHALL vivir en **redes de contenedores propias**, porque un producto puede escuchar en puertos
internos sin autenticación que su configuración no permite cerrar. En el compose de **producción**, a esas redes SHALL
pertenecer **solo** el almacén, los procesos de la aplicación que lo usan (`api` y `worker`) y el **lector de objetos
del respaldo** (`platform/backups`); cada una SHALL ser una red sin salida ni puertos publicados, y el almacén NO SHALL
pertenecer a ninguna otra. El lector del respaldo SHALL leer con una identidad S3 de solo lectura propia, NO SHALL
tener salida a Internet ni compartir red con `api` o `worker`, y SHALL existir solo mientras dura la corrida del
respaldo. Ningún otro servicio (base de datos, cola, `web`, proxy de entrada, el proceso que envía los respaldos)
SHALL poder alcanzar **ningún** puerto del almacén. En el compose de **desarrollo**, donde la aplicación corre en el
host, el almacén SHALL estar solo en su red y publicar en el host **únicamente** su puerto S3. Aislar la red NO SHALL
cambiar la configuración del producto que midió la matriz.

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
