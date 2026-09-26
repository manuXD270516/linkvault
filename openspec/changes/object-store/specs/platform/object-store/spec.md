## Purpose

Fija lo que LinkVault exige a su almacén de objetos S3-compatible sin atarse a un producto: cómo se aprovisiona, cómo se
comprueba su salud, quién puede leerlo, qué imagen se usa y cómo se justifica su elección, de modo que sustituir el
producto no cambie el código de la aplicación ni la forma de arrancarlo, desplegarlo y verificarlo.

## ADDED Requirements

### Requirement: El almacén se usa solo por la API S3

La aplicación, el aprovisionamiento del almacén, la verificación del artefacto y el arranque documentado SHALL hablar
con el almacén **exclusivamente por la API S3**, autenticándose con las credenciales del fichero de entorno. Ningún paso
del arranque documentado, del despliegue ni de la verificación SHALL depender de la CLI ni de la API de administración
de un producto concreto: el día que el producto cambie, lo que se sustituye es la imagen y su configuración, no el
código ni esos procedimientos.

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

### Requirement: Aprovisionamiento idempotente y separado de la salud

El repositorio SHALL ofrecer **una orden documentada de aprovisionamiento** que, por la API S3, deje el almacén como la
aplicación lo necesita: el bucket de snapshots con su retención (`cv/documents`, «Retención de snapshots de
enriquecimiento») y el bucket de CV con su cifrado en reposo y **sin** regla de expiración (`cv/documents`, «Bucket de
CV cifrado en reposo en producción»), los dos sin ninguna política de acceso anónimo.

- SHALL ser **idempotente**: repetirla NO SHALL duplicar ni cambiar la configuración que ya es correcta.
- La preparación de cada bucket SHALL ser **independiente** de la del otro: un almacén que ya tenía uno de los dos
  SHALL quedar igualmente con el otro.
- Ante cualquier propiedad que no pueda dejar como se exige, SHALL terminar con código distinto de cero **nombrando el
  bucket y la propiedad**, sin dar por bueno el resto. Un almacén que **no implementa** las políticas de bucket SHALL
  tratarse como un almacén sin políticas, anotándolo en la salida: la ausencia de acceso anónimo la demuestra el modo de
  comprobación con peticiones, no las políticas.
- SHALL terminar en un **plazo acotado** aunque el almacén acepte la conexión y no responda, con código distinto de cero
  nombrando el paso en curso.
- SHALL tener un **modo de comprobación que no escribe nada** y que termina con código distinto de cero nombrando cada
  discrepancia: bucket ausente; retención distinta de la exigida (por su identificador, **habilitada**, sin filtro, como
  **única** regla y por su plazo, no por la mera existencia de una regla); un snapshot más antiguo de lo que la
  retención permite, que SHALL buscarse **con las dos formas de retención** (más de **32 días** con la regla del
  almacén, que expira a los 30 y admite el redondeo a medianoche y un día de su pasada; más de **31** con el barrido);
  expiración presente en el bucket de CV; cifrado ausente cuando el almacén lo aplica por bucket; o acceso anónimo
  concedido. La única escritura admitida es
  borrar, con firma, el objeto de sonda que una escritura anónima **ya aceptada** por el almacén haya creado, e
  informarlo como fallo.
- SHALL ejecutarse en producción con la **imagen de la aplicación** ya publicada, sin imagen adicional, y en desarrollo
  desde el código fuente, con las mismas variables `S3_*` que la aplicación.
- **Aprovisionar NO SHALL formar parte del healthcheck del almacén** («Healthcheck del almacén de solo lectura»).

#### Scenario: Primer aprovisionamiento

- **GIVEN** un almacén recién arrancado, sano y sin buckets
- **WHEN** se ejecuta la orden de aprovisionamiento
- **THEN** SHALL existir el bucket de snapshots con su retención y el de CV con su cifrado y sin expiración
- **AND** el modo de comprobación SHALL terminar con código cero

#### Scenario: Repetir el aprovisionamiento no cambia nada

- **GIVEN** un almacén ya aprovisionado
- **WHEN** se ejecuta otra vez la orden de aprovisionamiento
- **THEN** SHALL terminar con código cero
- **AND** la configuración de los dos buckets SHALL ser la misma que antes, con una sola regla de retención

#### Scenario: Un bucket ya existente no impide crear el otro

- **GIVEN** un almacén con el bucket de snapshots creado y sin el de CV
- **WHEN** se ejecuta la orden de aprovisionamiento
- **THEN** SHALL existir también el bucket de CV con su configuración

#### Scenario: Un almacén sin políticas de bucket se aprovisiona

- **GIVEN** un almacén que responde que no implementa las políticas de bucket
- **WHEN** se ejecuta la orden de aprovisionamiento
- **THEN** SHALL terminar con código cero si el resto de propiedades quedó como se exige
- **AND** su salida SHALL decir que el almacén no tiene políticas de bucket

#### Scenario: Un almacén que no responde no cuelga el aprovisionamiento

- **GIVEN** un almacén que acepta la conexión y no responde
- **WHEN** se ejecuta la orden de aprovisionamiento
- **THEN** SHALL terminar dentro de su plazo con código distinto de cero nombrando el paso en curso

#### Scenario: Una retención distinta se detecta

- **GIVEN** el bucket de snapshots con una regla de expiración de 7 días en lugar de la exigida
- **WHEN** se ejecuta el modo de comprobación
- **THEN** SHALL terminar con código distinto de cero nombrando el bucket y el plazo encontrado
- **AND** la mera existencia de una regla NO SHALL bastar para darlo por bueno

#### Scenario: Una regla deshabilitada o acompañada se detecta

- **GIVEN** el bucket de snapshots con la regla exigida deshabilitada, con un filtro, o acompañada de otra regla
- **WHEN** se ejecuta el modo de comprobación
- **THEN** SHALL terminar con código distinto de cero nombrando el bucket y la propiedad

#### Scenario: Con la regla del almacén, un snapshot viejo rompe la comprobación

- **GIVEN** la retención por regla del almacén, con la regla exigida en su sitio, y un snapshot de 33 días en el bucket
  de snapshots
- **WHEN** se ejecuta el modo de comprobación
- **THEN** SHALL terminar con código distinto de cero nombrando el bucket y el snapshot
- **AND** que la regla esté bien escrita NO SHALL bastar para darlo por bueno

#### Scenario: El modo de comprobación no escribe

- **GIVEN** un almacén con cualquier configuración
- **WHEN** se ejecuta el modo de comprobación
- **THEN** NO SHALL crear, modificar ni borrar ningún bucket, regla u objeto
- **AND** la única excepción SHALL ser borrar, con firma, el objeto de sonda que una escritura anónima aceptada por el
  almacén haya creado, informando del acceso concedido y del borrado

### Requirement: Healthcheck del almacén de solo lectura

El healthcheck del almacén, en los dos composes, SHALL responder **solo si el almacén sirve peticiones**. NO SHALL crear,
modificar ni borrar ningún bucket, regla ni objeto, y NO SHALL depender de que el aprovisionamiento se haya hecho: un
almacén sano y vacío SHALL estar sano. SHALL fallar cuando el proceso del almacén no responde.

#### Scenario: Sano y vacío

- **GIVEN** un almacén recién arrancado sin ningún bucket
- **WHEN** su healthcheck se evalúa
- **THEN** SHALL dar el almacén por sano
- **AND** después de evaluarlo SHALL seguir sin haber ningún bucket

#### Scenario: El almacén no responde

- **GIVEN** el proceso del almacén detenido o sin responder
- **WHEN** su healthcheck se evalúa
- **THEN** SHALL darlo por no sano

### Requirement: Sin acceso anónimo al almacén

Ningún bucket del almacén SHALL aceptar peticiones **sin firmar**: ni leer un objeto, ni listar, ni escribir. El
almacén SHALL configurarse de forma que la ausencia de configuración de identidades NO SHALL equivaler a acceso abierto.
El modo de comprobación del aprovisionamiento SHALL comprobarlo con peticiones sin firmar a los dos buckets, y la
verificación del artefacto del CD SHALL ejecutarlo en cada corrida. **Solo un rechazo por falta de autenticación o de
permiso cuenta como rechazo**, y siempre **sin ningún byte del objeto** en la respuesta: un `401` o un `403`, o un `400`
cuyo código de error S3 sea de la familia de autenticación (`AccessDenied`, `MissingSecurityHeader`,
`AuthorizationHeaderMalformed`, `InvalidAccessKeyId`, `SignatureDoesNotMatch`). Una respuesta de éxito es acceso
concedido; una respuesta de «no existe» a una petición sin firmar también es un fallo, porque el almacén la dejó pasar
a buscar; y cualquier otra respuesta, incluido un `400` con otro código, NO SHALL contar como rechazo.

#### Scenario: GET anónimo de un CV

- **GIVEN** un objeto en el bucket de CV
- **WHEN** se pide ese objeto sin firmar la petición
- **THEN** el almacén SHALL rechazarla sin devolver ningún byte del objeto

#### Scenario: Listado anónimo

- **WHEN** se pide el listado de cualquiera de los dos buckets sin firmar la petición
- **THEN** el almacén SHALL rechazarla sin devolver ninguna clave

#### Scenario: Un acceso anónimo concedido rompe la verificación

- **GIVEN** un almacén cuyo bucket de CV admite lecturas sin firmar
- **WHEN** corre la verificación del artefacto
- **THEN** SHALL fallar nombrando el bucket

#### Scenario: Un «no existe» anónimo no cuenta como rechazo

- **GIVEN** un almacén que responde «no existe» a la petición sin firmar de un objeto inexistente
- **WHEN** se ejecuta el modo de comprobación
- **THEN** SHALL terminar con código distinto de cero nombrando el bucket y la respuesta

#### Scenario: Un 400 de autenticación cuenta como rechazo

- **GIVEN** un almacén que responde a toda petición sin firmar con un `400` cuyo código es `MissingSecurityHeader`, sin
  bytes del objeto
- **WHEN** se ejecuta el modo de comprobación
- **THEN** esas respuestas SHALL contar como rechazo

#### Scenario: Un 400 con otro código no cuenta como rechazo

- **GIVEN** un almacén que responde a una petición sin firmar con un `400` cuyo código no es de la familia de
  autenticación
- **WHEN** se ejecuta el modo de comprobación
- **THEN** SHALL terminar con código distinto de cero nombrando el bucket y la respuesta

### Requirement: Imagen del almacén mantenida, fijada y multiarquitectura

La imagen del almacén SHALL:

- estar publicada para **`linux/amd64` y `linux/arm64`** y poder descargarse **sin credenciales** en las dos;
- fijarse a una **versión exacta**, nunca a una etiqueta móvil como `latest`;
- referenciarse por **variable con valor por defecto**, con el **mismo** valor por defecto en los dos composes, para
  poder sortear un registro caído sin editar ficheros (ADR-048 §8);
- pertenecer a un proyecto **no archivado** y con una versión publicada en los doce meses anteriores a su elección,
  comprobado en la forja oficial del proyecto;
- tener anotado el **digest del índice** de la versión fijada y la fecha en que se comprobó, en la documentación de
  despliegue o en el ADR de la elección que esa documentación enlaza.

Un espejo propio de la imagen NO SHALL ser el valor por defecto: replicar una imagen de terceros traslada su
mantenimiento al proyecto.

#### Scenario: Descarga anónima en las dos arquitecturas

- **GIVEN** una máquina sin credenciales de ningún registro
- **WHEN** se descarga la imagen fijada del almacén para `linux/amd64` y para `linux/arm64`
- **THEN** las dos descargas SHALL terminar con éxito

#### Scenario: Los dos composes resuelven la misma imagen

- **WHEN** se resuelven sin variables de entorno la imagen del almacén de `docker-compose.yml` y la de
  `docker-compose.prod.yml`
- **THEN** SHALL ser la misma referencia, con una versión exacta

### Requirement: La elección del almacén se justifica con evidencia ejecutada

El producto que se use como almacén SHALL haber pasado una **matriz de requisitos ejecutada**, y `infra/README.md`
SHALL enlazar el registro de esa matriz y el ADR de la elección. El registro SHALL vivir en una ruta **estable** del
repositorio, `docs/object-store-matrix/` (el registro y los scripts que lo produjeron), y no bajo el directorio de un
change, que se mueve al archivarlo y rompería el enlace. Ese registro SHALL contener la salida de cada comprobación para
el producto elegido: cifrado en reposo demostrado leyendo el almacenamiento del contenedor con un control que sí aparece, y
demostrado protegiendo (otra clave no lee el CV o el almacén no arranca con ella, y la clave no está en el
almacenamiento); expiración observada;
acceso anónimo rechazado; imágenes descargables en las dos arquitecturas; los tests reales de la aplicación con el SDK
en uso; y un healthcheck de solo lectura. Sustituir el producto o subir su versión mayor SHALL repetir la matriz antes
de cambiar el valor por defecto de su imagen.

#### Scenario: La elección tiene su evidencia enlazada

- **WHEN** alguien busca en `infra/README.md` por qué se usa el almacén actual
- **THEN** SHALL encontrar el enlace al registro de la matriz en `docs/object-store-matrix/`, con la salida de cada
  comprobación del producto elegido, y al ADR de la elección
- **AND** el enlace SHALL resolver a un fichero existente también después de archivar el change que eligió el almacén

#### Scenario: Cambiar de producto sin matriz no está documentado como válido

- **GIVEN** una propuesta de sustituir el almacén o de subir su versión mayor
- **WHEN** se consulta el procedimiento en `infra/README.md` o en el ADR que enlaza
- **THEN** SHALL constar que la matriz se repite antes de cambiar el valor por defecto de la imagen
