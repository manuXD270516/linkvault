## ADDED Requirements

### Requirement: Condición del proveedor en la degradación

Cuando `runTask` degrada con `providers_failed` o con `no_providers`, el resultado SHALL incluir la **condición del
proveedor** siempre que haya proveedores afectados, y NO SHALL incluirla cuando no los haya. Esa condición NO SHALL
acompañar nunca a `quota_exceeded` ni al motivo de falta de consentimiento. El instante de vuelta de la cuota SHALL seguir
siendo exclusivo de `quota_exceeded`, y la condición NO SHALL llevar instante. Los cuatro motivos, su precedencia, el
ledger y la caché NO SHALL cambiar por esta condición.

**Proveedores afectados** de una ejecución son los de la **cadena hipotética** —la que compone la política de routing
con el mismo universo de esa ejecución, **sin circuitos abiertos y con el consentimiento supuesto**— que no dieron una
salida válida. Cada uno cuenta así, y la primera regla que le aplica es la que vale:

- los excluidos por falta de consentimiento, **tengan o no el circuito abierto**, cuentan como `consent_missing`: la
  clase recordada por el breaker para ese proveedor NO SHALL contar;
- los que se intentaron y fallaron, con la clase de su error. Una salida que no cumple el schema y una cancelación
  cuentan como `unavailable`;
- los que la instantánea de circuitos daba por elegibles pero se saltaron porque el breaker no concedió el permiso justo
  antes de enviar, como `unavailable`;
- los excluidos por circuito abierto, con la clase recordada por el breaker. Un circuito abierto sin clase recordada
  cuenta como `unavailable`. Un circuito en half-open cuya prueba está en curso en otra ejecución es un circuito
  abierto para la instantánea, y cuenta con su clase recordada.

La condición SHALL agregarse así, en este orden:

- con `no_providers`, `consent_missing` si algún afectado lo es. Con `providers_failed`, esos afectados NO SHALL contar,
  igual que en «Degradación tipada»: lo que ocurrió fue una avería;
- si no, `unavailable` si algún afectado lo es;
- si no, `rate_limited` si alguno lo es;
- si no, `rejected`.

La condición `consent_missing` SHALL significar «falta el permiso de quien ejecuta y ese permiso es necesario para al
menos un proveedor de la cadena hipotética». NO SHALL implicar `consentWouldEnable` ni el motivo de falta de
consentimiento: puede acompañar a `no_providers` aunque la política haya compuesto una cadena no vacía, por ejemplo
cuando el único proveedor permitido se saltó por el breaker. `consentWouldEnable` y la elección del motivo NO SHALL
cambiar.

La condición SHALL ser determinista para un mismo estado de los breakers y unas mismas respuestas.

#### Scenario: Cupo del único proveedor agotado

- **GIVEN** una cadena con un solo proveedor, que responde `429`
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `degraded` con motivo `providers_failed` y condición `rate_limited`

#### Scenario: Ejecución siguiente con el circuito abierto por el cupo

- **GIVEN** el mismo proveedor con el circuito abierto tras cinco `429`
- **WHEN** se ejecuta `runTask` otra vez
- **THEN** SHALL devolver `degraded` con motivo `no_providers` y condición `rate_limited`
- **AND** ningún proveedor SHALL recibir una petición

#### Scenario: Política de datos rechazada

- **GIVEN** una cadena con un solo proveedor, que responde `404`
- **WHEN** se ejecuta `runTask`
- **THEN** la condición SHALL ser `rejected`

#### Scenario: Un proveedor caído y otro sin cupo

- **GIVEN** una cadena cuyo primer proveedor responde `503` y cuyo segundo responde `429`
- **WHEN** se ejecuta `runTask`
- **THEN** la condición SHALL ser `unavailable`

#### Scenario: Proveedor saltado sin permiso del breaker

- **GIVEN** una cadena con un solo proveedor en half-open, que la instantánea de circuitos daba por elegible, y otra
  ejecución que tomó su permiso de prueba justo antes de enviar
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `no_providers` con condición `unavailable`

#### Scenario: Prueba de half-open en curso

- **GIVEN** un solo proveedor con el circuito en half-open, clase recordada `rate_limited` y su petición de prueba en
  curso en otra ejecución cuando se toma la instantánea de circuitos
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `no_providers` con condición `rate_limited`
- **AND** el proveedor NO SHALL recibir una petición

#### Scenario: Circuito abierto y permiso que falta

- **GIVEN** una tarea `personal`, un usuario sin consentimiento y un único proveedor externo con el circuito abierto con
  clase recordada `rate_limited`
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `no_providers` con condición `consent_missing`
- **AND** la clase `rate_limited` de ese proveedor NO SHALL contar

#### Scenario: Carrera del breaker y permiso que falta

- **GIVEN** una tarea `personal`, un usuario sin consentimiento, un proveedor local en half-open que la instantánea daba
  por elegible y cuyo permiso de prueba tomó otra ejecución justo antes de enviar, y un proveedor externo
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver motivo `no_providers`, no el de falta de consentimiento, porque la cadena compuesta no estaba
  vacía y el motivo no consulta `consentWouldEnable`
- **AND** la condición SHALL ser `consent_missing`

#### Scenario: Una avería no se convierte en falta de permiso

- **GIVEN** una tarea `personal`, un usuario sin consentimiento, un proveedor local que responde `503` y un proveedor
  externo
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `providers_failed` con condición `unavailable`

#### Scenario: Sin IA configurada

- **GIVEN** `AI_CHAIN=none`
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `no_providers` sin condición del proveedor

#### Scenario: La condición no acompaña a la cuota ni al consentimiento

- **GIVEN** una ejecución degradada por `quota_exceeded` y otra por falta de consentimiento, con un proveedor cuyo
  último error fue un `429`
- **WHEN** se inspeccionan los resultados
- **THEN** ninguno SHALL traer condición del proveedor
