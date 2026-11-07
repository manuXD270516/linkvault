## MODIFIED Requirements

### Requirement: Sensibilidad de datos por tarea

Cada tarea SHALL declarar su sensibilidad de datos como `personal`, `incidental` o `public`, con `personal` como valor
por defecto.

- `personal`: datos de quien ejecuta. La exigencia de consentimiento para proveedores externos SHALL aplicarse solo a
  tareas `personal`.
- `incidental`: contenido que no es de quien ejecuta, pero que puede traer datos personales de otras personas que nadie
  eligió enviar. Una tarea `incidental` NO SHALL exigir el consentimiento de quien ejecuta, y SHALL poder enviarse a un
  proveedor `external: true` **solo** si ese proveedor declara que pide no recolectar los datos
  (`ai/provider-routing`, «Declaración de no recolección de datos»), tenga o no quien ejecuta el consentimiento.
- `public`: contenido publicado. Ninguna de las reglas de esta capacidad para datos personales SHALL aplicársele.

Toda regla que esta capacidad, `ai/deterministic-mock` o `ai/eval-harness` fijen para las tareas `personal`, salvo la
del consentimiento, SHALL aplicarse igual a las tareas `incidental`: la redacción de PII hacia proveedores externos, la
prohibición de declararlas cacheables y de leer o escribir su resultado en una caché compartida, el registro de entradas
pendientes de fixture sin la entrada, la grabación de fixtures solo contra el mock y la auditoría de sus fixtures con el
redactor de proveedor externo. Las reglas SHALL decidirse en un único lugar del dominio, con una sola tabla que dé las
reglas de cada sensibilidad, y ningún otro módulo SHALL mencionar un valor de sensibilidad ni el valor por defecto. La
única excepción es la declaración de la sensibilidad de cada tarea. Una comprobación automatizada SHALL fallar nombrando
el fichero y la línea que lo hagan, sea una comparación, una variable intermedia o un `switch`. Declarar una tarea
`incidental`, igual que declararla `public`, SHALL exigir una decisión registrada que diga por qué su contenido no es de
quien ejecuta; sin ella, la tarea SHALL quedar en `personal`.

#### Scenario: Tarea sin sensibilidad declarada

- **GIVEN** una tarea registrada sin sensibilidad explícita
- **WHEN** se consulta su sensibilidad
- **THEN** SHALL ser `personal`

#### Scenario: Tarea pública hacia proveedor externo

- **GIVEN** una tarea `public` y un proveedor externo
- **WHEN** el input contiene una URL
- **THEN** el prompt enviado SHALL contener la URL original

#### Scenario: Tarea incidental sin consentimiento

- **GIVEN** una tarea `incidental`, un contexto sin consentimiento y un único proveedor externo que pide no recolectar
  los datos
- **WHEN** el input contiene un email y una URL
- **THEN** la ejecución SHALL enviarse a ese proveedor
- **AND** el prompt enviado SHALL contener `[EMAIL_1]` y `[URL_1]` y NO SHALL contener los valores originales

#### Scenario: Tarea incidental declarada cacheable

- **GIVEN** una tarea registrada como `incidental` y con el resultado declarado cacheable
- **WHEN** arranca el proceso que la registra
- **THEN** el arranque SHALL fallar con un error de programación que nombra la tarea

#### Scenario: Entrada incidental sin fixture

- **GIVEN** una tarea `incidental` ejecutada contra el mock sin fixture para su entrada
- **WHEN** se anota la entrada pendiente
- **THEN** el registro SHALL marcarla como redactada
- **AND** NO SHALL contener la entrada

#### Scenario: Grabar fixtures de una tarea incidental

- **GIVEN** una tarea `incidental` y un upstream de grabación que no es el mock
- **WHEN** se pide grabar sus fixtures
- **THEN** la grabación SHALL rechazarse antes de contactar a ningún proveedor, nombrando la tarea y su sensibilidad

#### Scenario: Auditoría de fixtures de una tarea incidental

- **GIVEN** un fixture en disco de una tarea `incidental` cuyo origen declarado es un proveedor externo
- **WHEN** se ejecuta la auditoría de fixtures
- **THEN** SHALL fallar nombrando la tarea y el fixture

#### Scenario: Una comparación suelta de la sensibilidad

- **GIVEN** un módulo de la IA, fuera del lugar del dominio que decide las reglas, que compara la sensibilidad de una
  tarea con un valor, la guarda en una variable y la compara después, o decide con un `switch` sobre ella
- **WHEN** se ejecuta la comprobación automatizada
- **THEN** SHALL fallar nombrando ese fichero y la línea

#### Scenario: Un valor de sensibilidad sin reglas

- **GIVEN** un valor nuevo de sensibilidad sin su fila en la tabla de reglas
- **WHEN** se compila la librería de IA
- **THEN** la compilación SHALL fallar
