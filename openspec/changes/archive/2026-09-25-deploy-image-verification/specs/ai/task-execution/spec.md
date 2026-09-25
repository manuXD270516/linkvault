## MODIFIED Requirements

### Requirement: Degradación tipada

Cuando ningún proveedor de la cadena produce una salida válida, o la cadena queda vacía tras el filtrado o por configuración,
`runTask` NO SHALL lanzar una excepción: SHALL devolver `status: "degraded"` con un motivo de un **conjunto cerrado de
cuatro**: `no_providers`, `providers_failed`, `quota_exceeded` y el motivo propio de que **faltaba el consentimiento**. Si la
tarea declara una función de degradación, el resultado SHALL incluir su salida validada contra el schema de salida; una
salida de degradación inválida SHALL lanzarse como error de programación. `runTask` solo SHALL propagar como excepción el
input inválido y los errores de programación: fixture ausente o inválido del mock, tarea sin muestra en modo synth, uso
incorrecto del mock, prompt que no puede renderizarse y salida de degradación inválida. Cualquier otro fallo SHALL traducirse
en fallback o degradación.

El motivo de falta de consentimiento existe porque los otros tres no significan eso: sin él, a quien no ha dado el permiso se
le devolvía el mismo motivo que a quien no tiene ninguna IA configurada, y quien lo lee tenía que **adivinar** justo en el
único caso que la persona puede arreglar. Sus reglas:

- SHALL darse **solo cuando conceder el consentimiento habría hecho elegible a algún proveedor**, es decir cuando la política
  de routing informa `consentWouldEnable` en verdadero (`ai/provider-routing`). `runTask` NO SHALL recalcular ese hecho por
  su cuenta.
- SHALL darse además **solo cuando la cadena quedó vacía tras el filtrado**, sin haber contactado a ningún proveedor. Si la
  cadena tenía proveedores y todos fallaron, el motivo SHALL ser `providers_failed` aunque conceder el permiso hubiera
  añadido a otro: lo que ocurrió fue una avería, y ofrecer «te falta autorizarlo» como salida sería ofrecer la salida
  equivocada.
- Con la cadena vacía y `consentWouldEnable` en falso, el motivo SHALL ser `no_providers`.

Los cuatro motivos SHALL ser **mutuamente excluyentes y deterministas** para una misma ejecución, con esta precedencia:
primero se evalúa la cuota de plataforma (conteo de `success` no-`byok:` según `ai/usage-accounting`); `quota_exceeded`
**solo** si ese tope está alcanzado **y** no hay ningún BYOK elegible —en ese caso se comprueba **antes** de componer la
cadena y no se contacta a ningún proveedor—; si el tope está alcanzado **y** hay BYOK elegible, `runTask` SHALL componer
una cadena **restringida a esos `byok:*`** y continuar (no degradar por cuota); después, con la cadena vacía, el de falta de
consentimiento si procede y `no_providers` en otro caso; y `providers_failed` solo cuando hubo al menos un intento.

**BYOK elegible** SHALL significar, en esa precedencia, un vendor con consentimiento externo vigente, clave descifrable,
**configuración utilizable** (la que permite construir su proveedor, según «Inyección BYOK en runTask» de `ai/byok`) y las
capacidades que la tarea requiere. Las cuatro condiciones SHALL **sumarse**, nunca sustituirse: la configuración utilizable
NO SHALL habilitar a un vendor sin consentimiento vigente o sin clave descifrable. La indisponibilidad por configuración
SHALL ser **de ese vendor**, nunca de BYOK entero: los demás vendors del usuario con clave, consentimiento y configuración
utilizable SHALL seguir siendo BYOK elegible y componer la cadena restringida.

En consecuencia, con el tope alcanzado y **ningún** vendor que reúna las cuatro condiciones, el motivo SHALL ser
`quota_exceeded` —con su instante de vuelta— y NO SHALL ser `no_providers` ni ningún otro: la cadena restringida no llega a
componerse vacía porque ese usuario nunca entra en la rama del BYOK. Un vendor sin configuración utilizable NO SHALL poder
convertir un `quota_exceeded` en un degradado por cadena vacía.

**Cuando el motivo es `quota_exceeded`**, el resultado degradado SHALL incluir además el **instante en que se podrá volver a
intentar**: el momento en que la ejecución contada más antigua sale de la ventana de la cuota y el conteo vuelve a estar por
debajo del límite. SHALL ser un instante absoluto, para que quien lo guarde lo devuelva tal cual sin recalcularlo, y NO SHALL
acompañar a ninguno de los otros tres motivos. Sin ese dato, lo único que puede hacerse es invitar a reintentar en el vacío,
que es la manera más rápida de gastar una cuota que ya está agotada.

#### Scenario: Cadena agotada sin función de degradación

- **GIVEN** una tarea sin función de degradación y todos los proveedores fallando
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `status: "degraded"` con motivo `providers_failed` y sin salida

#### Scenario: Cadena agotada con función de degradación

- **GIVEN** una tarea que declara una función de degradación válida y todos los proveedores fallando
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `status: "degraded"` con la salida de la función de degradación

#### Scenario: Función de degradación con salida inválida

- **GIVEN** una tarea cuya función de degradación devuelve una salida que no cumple el schema
- **WHEN** la cadena se agota
- **THEN** `runTask` SHALL lanzar un error que nombre la tarea

#### Scenario: Ningún proveedor elegible

- **GIVEN** una cadena en la que ningún proveedor supera el filtrado
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `status: "degraded"` con motivo `no_providers` sin contactar a ningún proveedor

#### Scenario: Faltaba el consentimiento y el permiso era la diferencia

- **GIVEN** una tarea `personal`, un contexto sin consentimiento y una política de routing que devuelve la cadena vacía con `consentWouldEnable` en verdadero
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `status: "degraded"` con el motivo propio de la falta de consentimiento
- **AND** ningún proveedor SHALL recibir una petición

#### Scenario: Faltaba el consentimiento pero no habría cambiado nada

- **GIVEN** una tarea `personal`, un contexto sin consentimiento y una política de routing que devuelve la cadena vacía con `consentWouldEnable` en falso
- **WHEN** se ejecuta `runTask`
- **THEN** el motivo SHALL ser `no_providers` y NO SHALL ser el de la falta de consentimiento

#### Scenario: Sin consentimiento, con un proveedor local que falla

- **GIVEN** una tarea `personal` sin consentimiento, un proveedor local elegible que devuelve error y `consentWouldEnable` en verdadero
- **WHEN** se ejecuta `runTask`
- **THEN** el motivo SHALL ser `providers_failed`
- **AND** NO SHALL ser el de la falta de consentimiento, porque hubo intento

#### Scenario: Los cuatro motivos se distinguen entre sí

- **GIVEN** cuatro ejecuciones degradadas por cadena vacía, por fallo de todos los proveedores, por cuota agotada y por falta de consentimiento
- **WHEN** se comparan sus motivos
- **THEN** los cuatro SHALL ser distintos entre sí
- **AND** el de la falta de consentimiento SHALL poder distinguirse de `no_providers`

#### Scenario: La cuota agotada dice cuándo volver

- **GIVEN** un usuario que alcanzó el límite diario de una tarea **sin** BYOK elegible
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `status: "degraded"` con motivo `quota_exceeded` y con el instante en que se podrá volver a intentar
- **AND** ese instante SHALL ser aquel en que la ejecución contada más antigua sale de la ventana

#### Scenario: Cuota de plataforma agotada con BYOK elegible

- **GIVEN** un usuario que alcanzó el límite diario de `success` no-BYOK y tiene al menos un BYOK elegible
- **WHEN** se ejecuta `runTask`
- **THEN** NO SHALL degradar con `quota_exceeded`
- **AND** la cadena de esa ejecución SHALL restringirse a proveedores `byok:*`

#### Scenario: El instante de vuelta no acompaña a otro motivo

- **GIVEN** una ejecución degradada con motivo `providers_failed`, otra con `no_providers` y otra por falta de consentimiento
- **WHEN** se inspeccionan los tres resultados
- **THEN** ninguno SHALL traer instante de vuelta

#### Scenario: Cuota agotada y el único vendor BYOK sin configuración utilizable

- **GIVEN** un usuario que alcanzó el límite diario de `success` no-BYOK, con consentimiento externo vigente y una única clave descifrable, la de un vendor sin configuración utilizable
- **WHEN** se ejecuta `runTask`
- **THEN** ese vendor NO SHALL contar como BYOK elegible
- **AND** el motivo SHALL ser `quota_exceeded` con su instante de vuelta
- **AND** NO SHALL ser `no_providers` ni ningún otro de los cuatro
- **AND** ningún proveedor SHALL recibir una petición

#### Scenario: Cuota agotada con un vendor inutilizable y otro utilizable

- **GIVEN** un usuario que alcanzó el límite diario de `success` no-BYOK, con consentimiento vigente y claves descifrables de dos vendors
- **AND** uno de ellos sin configuración utilizable y el otro con configuración utilizable y las capacidades de la tarea
- **WHEN** se ejecuta `runTask`
- **THEN** NO SHALL degradar con `quota_exceeded`
- **AND** la cadena SHALL restringirse al `byok:*` del vendor con configuración utilizable
- **AND** el `byok:*` del vendor sin configuración utilizable NO SHALL formar parte de la cadena

#### Scenario: La configuración utilizable no abre una puerta trasera al consentimiento

- **GIVEN** un usuario que alcanzó el límite diario de `success` no-BYOK y un vendor con configuración utilizable pero sin consentimiento externo vigente, o sin clave descifrable
- **WHEN** se ejecuta `runTask`
- **THEN** ese vendor NO SHALL componer ninguna cadena restringida
- **AND** el motivo SHALL ser `quota_exceeded` sin contactar a ningún proveedor
