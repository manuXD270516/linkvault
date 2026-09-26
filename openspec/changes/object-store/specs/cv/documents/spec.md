## MODIFIED Requirements

### Requirement: Bucket de CV cifrado en reposo en producción

En producción, cada objeto del bucket de CV SHALL guardarse **cifrado en reposo**, de una de estas dos formas y en este
orden de preferencia:

1. **Cifrado del lado del servidor con clave del almacén** (SSE-S3 o equivalente), configurado como **cifrado por
   defecto del bucket** por la orden de aprovisionamiento, de modo que el almacén cifre toda escritura aunque el cliente
   no lo pida. La clave del almacén SHALL llegar por una variable del fichero de entorno, obligatoria en producción;
   con ella en el entorno, el almacén SHALL cifrar con **esa** clave y NO SHALL guardarla en su volumen: una clave
   guardada junto a los datos que cifra no los protege.
2. **Solo si (1) no se ha podido demostrar con estas pruebas**: **cifrado del lado del servidor con clave del
   cliente** (SSE-C). La aplicación SHALL enviar la clave en **cada** escritura, lectura y copia de un objeto del bucket
   de CV. La clave SHALL vivir en el fichero de entorno de la aplicación, junto a `AI_VAULT_KEY`, y SHALL copiarse fuera
   del host con él; NO SHALL guardarse en el almacén, en el repositorio ni en ningún registro.

**Lo que (2) cambia respecto de (1), escrito aquí para que no se rebaje en silencio.** Con (1) la garantía es **del
almacén**: cifra todo lo que recibe. Con (2) pasa a ser **de la aplicación**: solo queda cifrado lo que se escribe con
la clave, y un camino de escritura que la olvide guardaría un CV en claro sin que el almacén lo impida. Por eso, con (2):

- cada camino de escritura del bucket de CV SHALL llevar la clave, y una prueba SHALL fallar si alguno no la lleva;
- un objeto del bucket de CV SHALL ser **ilegible sin la clave**;
- rotar la clave NO SHALL darse por soportado.

En las dos formas, perder la clave SHALL significar perder todos los CV, sin recuperación, y la documentación de
operación SHALL decirlo junto al procedimiento de generación y copia de la clave.

**Que el cifrado existe y protege SHALL demostrarse ejecutando, en las dos formas, y no con la respuesta de la API.**
El cifrado **se demuestra sobre la configuración del almacén que se entrega**: la del compose del repositorio, con su
imagen, su orden de arranque, sus variables y sus montajes, y no sobre otra escrita solo para la prueba. Las pruebas
son estas:

- **leyendo el almacenamiento del almacén**, con el almacén detenido: el contenido de un CV no aparece en claro,
  mientras que el de un objeto de control **distinto** en el bucket de snapshots, que no se cifra, **sí** aparece (sin
  ese control, no encontrar nada no demuestra nada); con objetos grandes y pequeños, porque un almacén puede guardar los
  pequeños por otro camino;
- **con otra clave**: en (1), sobre una **copia** del volumen del almacén, arrancándolo con otra clave del almacén: o
  arranca y el CV **no** se lee mientras el objeto de control **sí**, o **no arranca** por un error de clave o de
  descifrado que su registro nombra; en los dos casos, con la clave correcta sobre esa misma copia el CV (y el control)
  se leen igual que se escribieron. En (2), pidiendo el objeto con otra clave o sin ella, el CV **no** se lee, el
  objeto de control **sí**, y con la clave correcta el CV se lee igual que se escribió;
- **buscando la clave** en el almacenamiento del almacén, donde NO SHALL encontrarse.

La política de retención del CV SHALL quedar documentada en `infra/README.md` o `docs/RUNBOOK.md`: por defecto **sin
borrado automático** del objeto de CV (no lifecycle de caducidad del archivo personal); el cifrado permanece activo. El
aviso `/privacidad` MAY describir el cifrado y esa retención cuando el entorno los tenga, y NO SHALL describir ninguna
de las dos formas como cifrado gestionado por un proveedor.

#### Scenario: SSE en el bucket de CV de prod

- **GIVEN** el object store de producción aprovisionado según la documentación
- **WHEN** se sube un CV
- **THEN** el objeto SHALL almacenarse cifrado en reposo con la forma (1) o, si la (1) no se ha podido demostrar con
  las pruebas de este requirement, con la (2)
- **AND** la configuración documentada NO SHALL dejar el bucket de CV sin cifrado

#### Scenario: El contenido del CV no aparece en claro en el disco del almacén, y el control sí

- **GIVEN** un CV y un objeto de control distinto en el bucket de snapshots, subidos con contenidos conocidos, y el
  almacén detenido
- **WHEN** se busca cada contenido en los ficheros que el almacén guarda en su volumen
- **THEN** el del CV NO SHALL encontrarse en claro
- **AND** el del objeto de control SHALL encontrarse, y si no se encuentra la demostración SHALL darse por no
  concluyente, no por aprobada

#### Scenario: Con otra clave, el CV no se lee

- **GIVEN** un CV y un objeto de control guardados con la clave correcta
- **WHEN** se pide el CV con otra clave (otra clave del almacén al arrancarlo sobre una copia de su volumen, en la
  forma (1); otra clave del cliente o ninguna, en la forma (2))
- **THEN** el almacén SHALL rechazar la petición sin devolver el contenido del CV, mientras el objeto de control sigue
  leyéndose, **o** no arrancar por la clave, con un error de clave o de descifrado en su registro (solo en la forma (1))
- **AND** con la clave correcta, sobre ese mismo almacenamiento, el CV SHALL leerse igual que se escribió

#### Scenario: La clave no está en el almacenamiento del almacén

- **GIVEN** un almacén con CV cifrados
- **WHEN** se buscan los bytes de la clave en los ficheros que el almacén guarda en su volumen
- **THEN** NO SHALL encontrarse

#### Scenario: Con clave del cliente, un camino de escritura sin la clave rompe las pruebas

- **GIVEN** el bucket de CV cifrado con la forma (2)
- **WHEN** un camino de escritura del bucket de CV deja de enviar la clave
- **THEN** las pruebas de la aplicación SHALL fallar nombrando ese camino

#### Scenario: Sin caducidad automática del CV

- **GIVEN** la política de retención documentada para el bucket de CV
- **WHEN** un operador la revisa
- **THEN** NO SHALL exigirse un lifecycle que borre CVs a los N días por defecto
- **AND** SHALL constar que la retención por defecto es conservar el objeto hasta borrado de cuenta o eliminación
  explícita del CV

### Requirement: Retención de snapshots de enriquecimiento

El bucket de snapshots de enriquecimiento en producción SHALL aplicar una retención de **30 días** sin intervención
manual, de una de estas dos formas y en este orden de preferencia:

1. **Regla de expiración del almacén**, creada por la orden de aprovisionamiento y comprobada por su modo de comprobación
   por su identificador, **habilitada**, sin filtro, como **única** regla del bucket **y** por su plazo.
2. **Solo si el almacén elegido no aplica (1)**, demostrado ejecutando: un **barrido del `worker`**, al menos una vez al
   día, que borre los snapshots con más de 30 días. El barrido SHALL actuar **solo sobre el bucket de snapshots**:
   SHALL negarse a ejecutarse si ese bucket es el mismo que el de CV, porque un barrido por antigüedad sobre el bucket de
   CV borraría los CV de todo el mundo. Varias réplicas del `worker` barriendo a la vez NO SHALL producir errores ni
   borrar nada que no tenga más de 30 días. Con el barrido, el modo de comprobación SHALL exigir que no quede ningún
   snapshot de más de 31 días.

#### Scenario: Snapshot caduca a los 30 días

- **GIVEN** un snapshot de enriquecimiento escrito hace más de 30 días
- **WHEN** actúa la retención del bucket de snapshots, sea la regla del almacén o el barrido
- **THEN** el objeto SHALL eliminarse o quedar marcado para eliminación según el mecanismo
- **AND** un snapshot reciente (< 30 días) NO SHALL eliminarse

#### Scenario: El barrido no toca el bucket de CV

- **GIVEN** la retención por barrido y una configuración en la que el bucket de snapshots coincide con el de CV
- **WHEN** llega la hora del barrido
- **THEN** el barrido NO SHALL borrar nada
- **AND** SHALL registrar que se negó a ejecutarse y por qué

#### Scenario: Dos réplicas barren a la vez

- **GIVEN** la retención por barrido y dos réplicas del `worker`
- **WHEN** las dos barren el bucket de snapshots al mismo tiempo
- **THEN** ninguna SHALL terminar en error por un objeto que la otra ya borró
- **AND** NO SHALL borrarse ningún snapshot de menos de 30 días

#### Scenario: Con el barrido, un snapshot viejo rompe la comprobación

- **GIVEN** la retención por barrido y un snapshot de más de 31 días en el bucket de snapshots
- **WHEN** se ejecuta el modo de comprobación del aprovisionamiento
- **THEN** SHALL terminar con código distinto de cero nombrando el bucket y el snapshot

### Requirement: Recogida de objetos huérfanos documentada

`docs/RUNBOOK.md` SHALL documentar el procedimiento para listar y borrar objetos huérfanos del bucket de CV (p. ej. bajo
un `userId/` sin documento `cv_documents` asociado, o restos tras un fallo parcial). La recogida MAY ser manual; NO SHALL
exigirse un job automático.

**Hasta el change posterior de operación del almacén** (design D12 de `object-store`), el procedimiento queda
**pendiente**: la sección del RUNBOOK que lo describe SHALL estar marcada al principio como pendiente y no aplicable al
almacén actual (`platform/object-store`, «El almacén se usa solo por la API S3»), y NO SHALL presentarse como una
operación válida sobre él. Ese change SHALL reescribirlo con la herramienta S3 del propio repositorio, sin la CLI de
ningún producto de almacén y con revisión humana entre listar y borrar (ADR-028), y SHALL quitar la marca.

#### Scenario: Operador limpia huérfanos

- **GIVEN** un objeto en el bucket de CV sin documento de CV que lo referencie, y el procedimiento ya reescrito por el
  change posterior de operación del almacén
- **WHEN** el operador sigue el procedimiento del RUNBOOK
- **THEN** SHALL poder identificar el objeto huérfano
- **AND** SHALL poder eliminarlo del almacén sin afectar a CVs referenciados

#### Scenario: El procedimiento pendiente está marcado

- **GIVEN** el almacén actual y el procedimiento de recogida de huérfanos todavía sin reescribir
- **WHEN** el operador abre su sección del RUNBOOK
- **THEN** SHALL encontrar al principio que está pendiente y no aplica al almacén actual
- **AND** NO SHALL encontrar sus órdenes presentadas como una operación válida sobre él
