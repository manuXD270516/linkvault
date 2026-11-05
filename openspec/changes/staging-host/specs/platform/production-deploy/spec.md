## ADDED Requirements

### Requirement: El destino de staging se puede reconstruir desde la documentación

`infra/README.md` SHALL documentar el destino de staging **real** —no solo sus marcadores de posición— de modo que
otra persona, con un host vacío de la arquitectura documentada y acceso a los secretos, pueda levantarlo de nuevo sin
pasos que no estén escritos. Un destino que solo sabe reconstruir quien lo montó es un destino que se pierde con su
disco.

- SHALL constar qué necesita el host (proveedor, región, arquitectura, sistema, versiones mínimas de Docker y Compose,
  puertos abiertos en el proveedor **y** en el cortafuegos del propio sistema, usuario de despliegue), cómo se obtiene
  su nombre público y cómo se crea cada secreto del destino, incluida la clave pública del host y por qué canal se
  obtiene.
- SHALL constar **qué vive solo en el host** —el fichero de entorno con los secretos, los volúmenes de datos, el
  almacén de certificados, la configuración conservada de los últimos despliegues— y qué se pierde si se pierde el
  host. Staging SHALL declararse **desechable**: sus datos no tienen copia. El fichero de entorno SHALL tener una copia
  fuera del host, porque contiene la clave que cifra las claves de los usuarios y sin ella no se pueden descifrar.
- SHALL constar cómo volver a la versión desplegada anterior.
- SHALL constar **quién puede desplegar** y el límite del guardia de despliegue: quien tiene escritura en el
  repositorio tiene root en staging, y la lista de quién la tiene hoy —colaboradores, claves de despliegue con
  escritura y aplicaciones instaladas con sus permisos—.
- SHALL constar qué alternativas de host se evaluaron y por qué se eligió la usada. Documentarlas NO SHALL presentarlas
  como caminos soportados: el camino soportado sigue siendo el compose con Traefik.
- La reconstrucción SHALL haberse **ensayado** siguiendo solo la documentación, y cada paso que faltara SHALL haberse
  corregido en el texto. Una documentación de reconstrucción que nadie ha seguido es una afirmación sin comprobar.

#### Scenario: Reconstruir staging siguiendo solo la documentación

- **GIVEN** un host vacío de la arquitectura documentada y los secretos del destino
- **WHEN** un operador sigue `infra/README.md` de principio a fin
- **THEN** staging SHALL quedar desplegado y respondiendo por su origen HTTPS público
- **AND** cada paso que haya hecho falta y no estuviera escrito SHALL contarse como defecto de la documentación

#### Scenario: Lo que se pierde con el host está escrito

- **WHEN** un operador busca en `infra/README.md` qué datos y secretos existen solo en el host de staging
- **THEN** SHALL encontrarlos enumerados
- **AND** SHALL encontrar qué consecuencia tiene perder cada uno
- **AND** SHALL encontrar dónde está la copia del fichero de entorno

#### Scenario: Volver a la versión anterior

- **GIVEN** staging desplegado con una versión y la anterior todavía en el registro
- **WHEN** un operador sigue el procedimiento documentado para volver a la anterior
- **THEN** staging SHALL quedar corriendo las imágenes de la versión anterior y respondiendo readiness

#### Scenario: Quién puede desplegar está escrito

- **WHEN** un operador busca en `infra/README.md` quién puede desplegar a staging
- **THEN** SHALL encontrar que quien tiene escritura en el repositorio tiene root en staging
- **AND** SHALL encontrar quién tiene hoy ese permiso, incluidas las claves de despliegue y las aplicaciones instaladas

### Requirement: La pila de staging separa la red de cada proceso y no deja datos sin credenciales

Defensa en profundidad del lado del despliegue (ADR-056 §6), además del filtro de salida de las descargas iniciadas por
datos de usuario.

- `api` y `worker` SHALL tener salida a Internet, cada uno por una red propia, y NO SHALL compartir ninguna red.
- Cada despliegue SHALL comprobar esa salida y fallar nombrando el servicio si no la tiene.
- Mongo y Redis NO SHALL aceptar operaciones sin credenciales, y ninguna contraseña SHALL aparecer en los argumentos de
  un proceso.
- El filer del almacén NO SHALL servir objetos por HTTP. Las interfaces del almacén que siguen sin autenticación SHALL
  ser alcanzables solo desde `api` y `worker`, y SHALL constar como riesgo residual.
- Ningún contenedor SHALL alcanzar la dirección de metadatos del proveedor.

#### Scenario: El worker sale a Internet pero no alcanza la API

- **GIVEN** la pila de staging arriba
- **WHEN** el worker resuelve el nombre de `api` y abre una conexión HTTPS a un sitio público
- **THEN** la resolución SHALL fallar
- **AND** la conexión externa SHALL responder

#### Scenario: Un despliegue sin salida a Internet falla

- **GIVEN** una versión de la pila en la que `worker` no tiene salida a Internet
- **WHEN** se despliega
- **THEN** la comprobación posterior al despliegue SHALL fallar nombrando a `worker`

#### Scenario: Sin credenciales no se entra a los datos

- **GIVEN** la pila de staging arriba
- **WHEN** `worker` se conecta sin credenciales a Mongo o a Redis, o pide un objeto al filer por HTTP
- **THEN** Mongo y Redis SHALL rechazar la operación
- **AND** el filer NO SHALL devolver el objeto

#### Scenario: La dirección de metadatos no responde a los contenedores

- **GIVEN** el host respondiendo a la dirección de metadatos
- **WHEN** `api` o `worker` piden `http://169.254.169.254/`
- **THEN** la petición SHALL terminar en error de conexión o de plazo, también después de reiniciar el host
