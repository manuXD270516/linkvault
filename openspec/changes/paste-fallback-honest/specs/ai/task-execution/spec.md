## ADDED Requirements

### Requirement: Condición del proveedor en la degradación

Cuando `runTask` degrada con `providers_failed` o con `no_providers`, el resultado SHALL incluir la **condición del
proveedor** siempre que haya proveedores afectados, y NO SHALL incluirla cuando no los haya. Esa condición NO SHALL
acompañar nunca a `quota_exceeded` ni a la falta de consentimiento. El instante de vuelta de la cuota SHALL seguir
siendo exclusivo de `quota_exceeded`. Los cuatro motivos, su precedencia, el ledger y la caché NO SHALL cambiar por
esta condición.

**Proveedores afectados** de una ejecución son:

- los que la cadena intentó y fallaron, con la clase de su error. Una salida que no cumple el schema y una cancelación
  cuentan como `unavailable`;
- los que el filtrado habría admitido si su circuito no estuviera abierto, con la clase recordada por el breaker. Un
  circuito abierto sin clase recordada cuenta como `unavailable`.

La condición SHALL agregarse así:

- `unavailable` si algún afectado lo es;
- si no, `rate_limited` si alguno lo es, con el instante de vuelta más temprano **solo si todos** los `rate_limited` lo
  conocen;
- si no, `rejected`.

El instante SHALL ser absoluto (ISO-8601 UTC). La condición SHALL ser determinista para un mismo estado de los
breakers y unas mismas respuestas.

#### Scenario: Cupo del único proveedor agotado

- **GIVEN** una cadena con un solo proveedor, que responde `429` con reinicio a las 00:00 UTC del día siguiente
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `degraded` con motivo `providers_failed` y condición `rate_limited` con ese instante

#### Scenario: Ejecución siguiente con el proveedor pausado

- **GIVEN** el mismo proveedor pausado por ese `429`
- **WHEN** se ejecuta `runTask` otra vez
- **THEN** SHALL devolver `degraded` con motivo `no_providers` y la misma condición
- **AND** ningún proveedor SHALL recibir una petición

#### Scenario: Política de datos rechazada

- **GIVEN** una cadena con un solo proveedor, que responde `404`
- **WHEN** se ejecuta `runTask`
- **THEN** la condición SHALL ser `rejected`

#### Scenario: Un proveedor caído y otro sin cupo

- **GIVEN** una cadena cuyo primer proveedor responde `503` y cuyo segundo responde `429` con instante
- **WHEN** se ejecuta `runTask`
- **THEN** la condición SHALL ser `unavailable`

#### Scenario: Dos proveedores sin cupo, uno sin instante

- **GIVEN** dos proveedores que responden `429`, uno con instante y otro sin él
- **WHEN** se ejecuta `runTask`
- **THEN** la condición SHALL ser `rate_limited` sin instante

#### Scenario: Sin IA configurada

- **GIVEN** `AI_CHAIN=none`
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `no_providers` sin condición del proveedor

#### Scenario: La condición no acompaña a la cuota ni al consentimiento

- **GIVEN** una ejecución degradada por `quota_exceeded` y otra por falta de consentimiento, con un proveedor pausado
  por `429`
- **WHEN** se inspeccionan los resultados
- **THEN** ninguno SHALL traer condición del proveedor
