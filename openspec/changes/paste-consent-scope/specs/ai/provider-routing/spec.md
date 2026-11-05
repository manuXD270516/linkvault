## ADDED Requirements

### Requirement: Declaración de no recolección de datos

Cada proveedor SHALL poder declarar, entre sus capacidades, que pide no recolectar los datos que recibe
(`dataCollectionDenied`). Un proveedor SHALL declararlo **solo** si **cada** petición que envía pide al servicio que no
recolecte ni conserve los datos; un proveedor que no lo declare SHALL tratarse como si no lo pidiera. La declaración es
un dato de política, como `external` y los costes: el filtro de capacidades requeridas por la tarea NO SHALL tenerla en
cuenta. Hoy SHALL declararlo el proveedor OpenRouter que envía `data_collection: "deny"` (el de plataforma y el BYOK con
modelo `:free`), y NO SHALL declararlo el BYOK de OpenRouter sin forzar `data_collection`, ni los de OpenAI y
Anthropic.

#### Scenario: OpenRouter de plataforma

- **GIVEN** el proveedor OpenRouter de plataforma
- **WHEN** se leen sus capacidades
- **THEN** SHALL declarar que pide no recolectar los datos
- **AND** cada petición que envía SHALL llevar `data_collection: "deny"`

#### Scenario: BYOK de OpenRouter con modelo gratuito y de pago

- **GIVEN** Ana con BYOK de OpenRouter
- **WHEN** se construye su proveedor con un modelo terminado en `:free` y, en otra configuración, con uno que no
  termina en `:free`
- **THEN** el primero SHALL declarar que pide no recolectar los datos
- **AND** el segundo NO SHALL declararlo

#### Scenario: BYOK de OpenAI y de Anthropic

- **GIVEN** Ana con BYOK de OpenAI y de Anthropic
- **WHEN** se construyen sus proveedores
- **THEN** ninguno SHALL declarar que pide no recolectar los datos

## MODIFIED Requirements

### Requirement: Filtrado por capacidades, consentimiento y circuitos abiertos

Antes de elegir, la política de routing SHALL descartar los proveedores que no satisfacen las capacidades requeridas por la
tarea (cada capacidad booleana requerida debe ser verdadera y el contexto máximo debe ser mayor o igual al requerido), los
proveedores con circuito abierto y, cuando la tarea es `personal` y el contexto no tiene consentimiento para proveedores
externos, los proveedores con `external: true`. Cuando la tarea es `incidental` (`ai/data-protection`), la política SHALL
descartar además, **con o sin consentimiento**, los proveedores con `external: true` que no declaran que piden no
recolectar los datos («Declaración de no recolección de datos»), y NO SHALL descartar ningún proveedor por falta de
consentimiento. El consentimiento SHALL ser un dato obligatorio del contexto, sin valor por defecto. La política SHALL ser
una función pura sin acceso a red ni a almacenamiento. La lista de candidatos que recibe SHALL ser el universo efectivo de
la ejecución (`AI_CHAIN` ∪ `byok:<userId>:*` ya resueltos); la política NO SHALL leer el vault por su cuenta.

Además de la cadena, la política SHALL devolver `consentWouldEnable`: si **conceder el consentimiento habría hecho elegible
a algún proveedor que hoy no lo es**. Sin ese dato, una cadena vacía por falta de permiso es indistinguible de una cadena
vacía por no haber IA configurada, y quien lo lee solo puede adivinar —y adivinaría mal justo en el único caso que la
persona puede arreglar—.

- Para calcularlo, la política SHALL componer una **segunda cadena hipotética** con el consentimiento supuesto dado y
  **todo lo demás igual** (las mismas capacidades requeridas, el **mismo universo efectivo** de candidatos —plataforma y
  BYOK ya incluidos en la lista—, el mismo estado de los circuit breakers y el mismo filtro de no recolección de las
  tareas `incidental`), y SHALL comparar ambas.
- `consentWouldEnable` SHALL ser `true` **solo si** la tarea es `personal`, el contexto llega sin consentimiento y la cadena
  hipotética contiene al menos un proveedor que la cadena real no contiene. En cualquier otro caso SHALL ser `false`.
- En consecuencia SHALL ser `false` cuando en el universo efectivo no hay ningún proveedor `external: true`, cuando el único
  externo se descarta también por capacidades o por circuito abierto, cuando el contexto trae el consentimiento y cuando la
  tarea es `public` o `incidental`: en todos esos casos conceder el permiso no habría cambiado nada, y decir lo contrario
  mandaría a la persona a arreglar algo que no es suyo. Un BYOK del usuario en esa lista **sí** cuenta como externo del
  universo efectivo aunque `AI_CHAIN` no liste ninguno.
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

#### Scenario: Tarea incidental sin consentimiento

- **GIVEN** una tarea `incidental`, un contexto con `externalProviders: false`, un proveedor externo que pide no recolectar
  los datos y un proveedor local
- **WHEN** se construye la cadena
- **THEN** los dos proveedores SHALL formar parte de la cadena
- **AND** `consentWouldEnable` SHALL ser `false`

#### Scenario: Tarea incidental con un externo que no pide no recolectar

- **GIVEN** una tarea `incidental`, un contexto con `externalProviders: true`, un proveedor externo que no declara que pide
  no recolectar los datos y un proveedor local
- **WHEN** se construye la cadena
- **THEN** solo el proveedor local SHALL formar parte de la cadena

#### Scenario: Tarea incidental cuyo único externo no pide no recolectar

- **GIVEN** una tarea `incidental`, un contexto con `externalProviders: false` y un universo efectivo con un único proveedor,
  externo, que cumple las capacidades, tiene el circuito cerrado y no declara que pide no recolectar los datos
- **WHEN** se construye la cadena
- **THEN** la cadena SHALL quedar vacía
- **AND** `consentWouldEnable` SHALL ser `false`, porque con el permiso dado ese proveedor seguiría descartado

#### Scenario: El permiso habría habilitado al único proveedor

- **GIVEN** una tarea `personal`, un contexto con `externalProviders: false` y `AI_CHAIN` con un único proveedor `external: true` que cumple las capacidades y tiene el circuito cerrado
- **WHEN** se construye la cadena
- **THEN** la cadena SHALL quedar vacía
- **AND** `consentWouldEnable` SHALL ser `true`

#### Scenario: No hay ningún proveedor externo configurado

- **GIVEN** una tarea `personal`, un contexto con `externalProviders: false` y un universo efectivo sin ningún proveedor `external: true`
- **WHEN** se construye la cadena
- **THEN** `consentWouldEnable` SHALL ser `false`, porque la cadena hipotética es igual a la real

#### Scenario: Solo BYOK y sin consentimiento

- **GIVEN** una tarea `personal`, `AI_CHAIN=none`, Ana con un BYOK OpenAI en el universo efectivo, consentimiento off, capacidades OK y circuito cerrado
- **WHEN** se construye la cadena
- **THEN** la cadena SHALL quedar vacía
- **AND** `consentWouldEnable` SHALL ser `true`

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

#### Scenario: Proveedor que no declara la no recolección

- **GIVEN** una tarea `incidental` y un proveedor externo cuyas capacidades no dicen nada sobre la recolección de datos
- **WHEN** se construye la cadena
- **THEN** ese proveedor NO SHALL formar parte de la cadena
