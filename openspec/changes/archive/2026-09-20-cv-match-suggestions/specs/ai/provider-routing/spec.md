## MODIFIED Requirements

### Requirement: Filtrado por capacidades, consentimiento y circuitos abiertos

Antes de elegir, la política de routing SHALL descartar los proveedores que no satisfacen las capacidades requeridas por la
tarea (cada capacidad booleana requerida debe ser verdadera y el contexto máximo debe ser mayor o igual al requerido), los
proveedores con circuito abierto y, cuando la tarea es `personal` y el contexto no tiene consentimiento para proveedores
externos, los proveedores con `external: true`. El consentimiento SHALL ser un dato obligatorio del contexto, sin valor por
defecto. La política SHALL ser una función pura sin acceso a red ni a almacenamiento.

Además de la cadena, la política SHALL devolver `consentWouldEnable`: si **conceder el consentimiento habría hecho elegible
a algún proveedor que hoy no lo es**. Sin ese dato, una cadena vacía por falta de permiso es indistinguible de una cadena
vacía por no haber IA configurada, y quien lo lee solo puede adivinar —y adivinaría mal justo en el único caso que la
persona puede arreglar—.

- Para calcularlo, la política SHALL componer una **segunda cadena hipotética** con el consentimiento supuesto dado y
  **todo lo demás igual** (las mismas capacidades requeridas, la misma configuración de `AI_CHAIN` y el mismo estado de los
  circuit breakers), y SHALL comparar ambas.
- `consentWouldEnable` SHALL ser `true` **solo si** la tarea es `personal`, el contexto llega sin consentimiento y la cadena
  hipotética contiene al menos un proveedor que la cadena real no contiene. En cualquier otro caso SHALL ser `false`.
- En consecuencia SHALL ser `false` cuando no hay ningún proveedor `external: true` en `AI_CHAIN`, cuando el único externo
  se descarta también por capacidades o por circuito abierto, cuando el contexto trae el consentimiento y cuando la tarea es
  `public`: en todos esos casos conceder el permiso no habría cambiado nada, y decir lo contrario mandaría a la persona a
  arreglar algo que no es suyo.
- El cálculo SHALL mantenerse dentro de la función pura: NO SHALL consultar la red, el almacenamiento ni el perfil de nadie,
  y NO SHALL contactar a ningún proveedor.

La política NO SHALL decidir el motivo de degradación: se limita a exponer el hecho. Quién lo traduce en motivo y con qué
precedencia lo fija `ai/task-execution`.

#### Scenario: Capacidad insuficiente

- **GIVEN** una tarea que requiere `jsonMode` y un proveedor sin `jsonMode`
- **WHEN** se construye la cadena
- **THEN** ese proveedor NO SHALL formar parte de la cadena

#### Scenario: Sin consentimiento en una tarea personal

- **GIVEN** una tarea `personal`, un contexto con `externalProviders: false` y una cadena con un proveedor externo y otro local
- **WHEN** se construye la cadena
- **THEN** solo el proveedor local SHALL formar parte de la cadena

#### Scenario: Tarea pública sin consentimiento

- **GIVEN** una tarea `public` y un contexto con `externalProviders: false`
- **WHEN** se construye la cadena
- **THEN** los proveedores externos SHALL seguir siendo elegibles

#### Scenario: El permiso habría habilitado al único proveedor

- **GIVEN** una tarea `personal`, un contexto con `externalProviders: false` y `AI_CHAIN` con un único proveedor `external: true` que cumple las capacidades y tiene el circuito cerrado
- **WHEN** se construye la cadena
- **THEN** la cadena SHALL quedar vacía
- **AND** `consentWouldEnable` SHALL ser `true`

#### Scenario: No hay ningún proveedor externo configurado

- **GIVEN** una tarea `personal`, un contexto con `externalProviders: false` y `AI_CHAIN` sin ningún proveedor `external: true`
- **WHEN** se construye la cadena
- **THEN** `consentWouldEnable` SHALL ser `false`, porque la cadena hipotética es igual a la real

#### Scenario: El único externo tampoco cumple las capacidades

- **GIVEN** una tarea `personal` que requiere `jsonMode`, un contexto sin consentimiento y un único proveedor externo sin `jsonMode`
- **WHEN** se construye la cadena
- **THEN** la cadena SHALL quedar vacía
- **AND** `consentWouldEnable` SHALL ser `false`, porque con el permiso dado ese proveedor seguiría descartado

#### Scenario: El único externo tiene el circuito abierto

- **GIVEN** una tarea `personal`, un contexto sin consentimiento y un único proveedor externo con el circuito abierto
- **WHEN** se construye la cadena
- **THEN** `consentWouldEnable` SHALL ser `false`, porque lo que lo deja fuera es el circuito y no el permiso

#### Scenario: Con el consentimiento dado la pregunta no se plantea

- **GIVEN** una tarea `personal` con el consentimiento en el contexto y todos los proveedores con el circuito abierto
- **WHEN** se construye la cadena
- **THEN** la cadena SHALL quedar vacía
- **AND** `consentWouldEnable` SHALL ser `false`

#### Scenario: El permiso habría añadido un externo a una cadena que no está vacía

- **GIVEN** una tarea `personal`, un contexto sin consentimiento, un proveedor local elegible y un proveedor externo elegible salvo por el consentimiento
- **WHEN** se construye la cadena
- **THEN** la cadena SHALL contener solo el proveedor local
- **AND** `consentWouldEnable` SHALL ser `true`
