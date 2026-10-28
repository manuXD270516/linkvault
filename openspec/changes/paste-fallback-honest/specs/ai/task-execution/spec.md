## ADDED Requirements

### Requirement: Condición del proveedor en la degradación

Cuando `runTask` degrada con `providers_failed` o con `no_providers`, el resultado SHALL incluir la **condición del
proveedor** siempre que haya proveedores afectados, y NO SHALL incluirla cuando no los haya. Esa condición NO SHALL
acompañar nunca a `quota_exceeded` ni al motivo de falta de consentimiento. El instante de vuelta de la cuota SHALL seguir
siendo exclusivo de `quota_exceeded`, y la condición NO SHALL llevar instante. Los cuatro motivos, su precedencia, el
ledger y la caché NO SHALL cambiar por esta condición.

**Proveedores afectados** de una ejecución son los de la **cadena hipotética** —la que compone la política de routing
con el mismo universo de esa ejecución, **sin circuitos abiertos y con el consentimiento supuesto**— que no dieron una
salida válida:

- los que se intentaron y fallaron, con la clase de su error. Una salida que no cumple el schema y una cancelación
  cuentan como `unavailable`;
- los que se saltaron porque el breaker no concedió el permiso justo antes de enviar, como `unavailable`;
- los excluidos por circuito abierto, con la clase recordada por el breaker. Un circuito abierto sin clase recordada
  cuenta como `unavailable`;
- los excluidos solo por falta de consentimiento, como **habilitables por el permiso**.

La condición SHALL agregarse así, en este orden:

- con `no_providers`, `consent_required` si algún afectado es habilitable por el permiso: el permiso es lo primero que la
  persona puede arreglar. Con `providers_failed`, los habilitables por el permiso NO SHALL contar, igual que en
  «Degradación tipada»: lo que ocurrió fue una avería;
- si no, `unavailable` si algún afectado lo es;
- si no, `rate_limited` si alguno lo es;
- si no, `rejected`.

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

- **GIVEN** una cadena con un solo proveedor en half-open cuyo permiso de prueba ya tomó otra ejecución
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `no_providers` con condición `unavailable`

#### Scenario: Circuito abierto y permiso que falta

- **GIVEN** una tarea `personal`, un usuario sin consentimiento y un único proveedor externo con el circuito abierto con
  clase recordada `rate_limited`
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `no_providers` con condición `consent_required`

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
