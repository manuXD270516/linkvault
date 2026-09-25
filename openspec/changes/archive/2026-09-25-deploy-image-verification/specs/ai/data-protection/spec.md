## MODIFIED Requirements

### Requirement: Secretos BYOK fuera de logs y respuestas

El sistema NO SHALL escribir en logs la clave en claro, el material descifrado, `AI_VAULT_KEY`, ni el `ciphertext` del
vault. Las respuestas HTTP de gestión de claves NO SHALL incluir más que `vendor`, `keyHint`, timestamps y el **estado
de disponibilidad** de ese vendor. El redactor de logs de api y worker SHALL cubrir al menos las claves de objeto
`apiKey`, `authorization`, `AI_VAULT_KEY`, `ciphertext` y `vaultKey`.

El estado de disponibilidad SHALL ser **un hecho sobre la configuración del servidor**, no sobre la clave de nadie: dice
si ese vendor puede construirse en esta instancia, y NO SHALL revelar ningún valor de configuración —ni el modelo, ni
un endpoint, ni la existencia o ausencia de una credencial de plataforma—. Se añade a la lista porque la interfaz tiene
que distinguir "no forzamos `data_collection: deny`" de "este vendor no está disponible", y deducirlo en el cliente
obligaría a reimplementar allí el criterio del servidor: dos verdades que divergirían el día que una cambiara.

El límite sigue siendo **cerrado**. Ampliarlo con un campo no lo convierte en una lista abierta: cualquier otro dato
sobre una clave o sobre la configuración de IA sigue estando fuera, y la prohibición sobre la clave en claro y el
`ciphertext` queda **intacta**.

#### Scenario: Log de error de proveedor

- **GIVEN** un BYOK que falla con error HTTP del vendor
- **WHEN** se registra el fallo
- **THEN** el mensaje de log NO SHALL contener la apiKey ni un Bearer token completo

#### Scenario: La disponibilidad viaja, el secreto no

- **GIVEN** una persona con una clave BYOK guardada para un vendor
- **WHEN** consulta sus claves por HTTP
- **THEN** la respuesta SHALL traer el vendor, su pista, sus timestamps y su estado de disponibilidad
- **AND** NO SHALL traer la clave en claro ni el `ciphertext` del vault

#### Scenario: La disponibilidad no filtra la configuración

- **GIVEN** un vendor que esta instancia no puede construir por su configuración
- **WHEN** se consulta el estado de ese vendor
- **THEN** la respuesta SHALL decir que no está disponible
- **AND** NO SHALL decir qué valor de configuración falta ni cuál tiene, ni revelar credenciales de plataforma

#### Scenario: Ampliar el límite no lo abre

- **GIVEN** la lista de lo que una respuesta de gestión de claves puede incluir
- **WHEN** se añade un dato que no sea vendor, pista, timestamp o disponibilidad
- **THEN** SHALL considerarse fuera del límite
- **AND** la ampliación de este change NO SHALL leerse como permiso para devolver cualquier otro dato
