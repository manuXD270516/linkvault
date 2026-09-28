## MODIFIED Requirements

### Requirement: Registro de cada intento

Cada intento de un proveedor dentro de `runTask` SHALL registrarse en el ledger con usuario (si existe), tarea, proveedor,
modelo, tokens de entrada y salida, coste estimado, latencia, versión de prompt, hash de la ejecución, fecha y `outcome`
(`success`, `schema_error` o `provider_error`). Un resultado degradado por cadena vacía o agotada SHALL registrar un único
`degraded` con su motivo (`no_providers`, `providers_failed` o `consent_required`); una cuota superada SHALL registrar un
único `quota` y ningún `degraded`. Los registros `degraded` y `quota` SHALL tener proveedor y modelo nulos y tokens, coste y
latencia a 0. Una respuesta servida desde la caché NO SHALL registrarse. El almacén del ledger SHALL aceptar cualquier motivo
de degradación y cualquier `outcome` que `runTask` o `embedTexts` puedan emitir: un registro válido NO SHALL perderse por
una validación del almacén.

#### Scenario: Ejecución exitosa

- **WHEN** `runTask` obtiene una salida válida del primer proveedor
- **THEN** el ledger SHALL tener un registro con `outcome: "success"` y los tokens, coste y latencia de ese intento

#### Scenario: Fallo seguido de éxito

- **GIVEN** un primer proveedor que falla por error de red y un segundo que responde bien
- **WHEN** se ejecuta `runTask`
- **THEN** el ledger SHALL tener un registro `provider_error` del primero y uno `success` del segundo, en ese orden

#### Scenario: Resultado degradado

- **WHEN** `runTask` devuelve un resultado degradado con motivo `providers_failed`
- **THEN** el ledger SHALL tener un registro `degraded` con ese motivo y proveedor nulo

#### Scenario: Resultado degradado por falta de consentimiento

- **GIVEN** una cadena que solo tiene proveedores externos y un usuario sin consentimiento para IA externa
- **WHEN** `runTask` devuelve un resultado degradado con motivo `consent_required`
- **THEN** el almacén del ledger SHALL guardar un registro `degraded` con ese motivo y proveedor nulo
