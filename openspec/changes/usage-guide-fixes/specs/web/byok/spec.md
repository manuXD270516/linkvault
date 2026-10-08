## MODIFIED Requirements

### Requirement: Gestión de claves en perfil

`/perfil` SHALL ofrecer, para cada vendor soportado, estado configurado/no configurado, acción de guardar o rotar (input de clave, sin echo), hint visible si hay clave, y acción de revocar con confirmación. Tras guardar o revocar, la UI SHALL reflejar el listado del API sin mostrar la clave completa.

Si guardar responde `503` con código `vault_unavailable` (la instancia no tiene bóveda, spec `ai/byok`), la UI SHALL decir "Las claves propias no están disponibles en esta instancia ahora mismo. Tu clave no se ha guardado." en lugar del error genérico, SHALL vaciar el campo de la clave y NO SHALL presentar el vendor como configurado. Cualquier otro error SHALL seguir mostrándose con los mensajes comunes.

#### Scenario: Guarda OpenAI

- **GIVEN** Ana en `/perfil` sin clave OpenAI
- **WHEN** pega una clave y guarda
- **THEN** ve el hint y el vendor como configurado
- **AND** el valor pegado ya no aparece en el campo

#### Scenario: Revoca

- **GIVEN** Ana con Anthropic configurado
- **WHEN** confirma la revocación
- **THEN** ese vendor pasa a no configurado

#### Scenario: Instancia sin bóveda

- **GIVEN** Ana en `/perfil` sin clave de Anthropic, en una instancia cuya API responde `503` `vault_unavailable` al
  guardar
- **WHEN** pega una clave y pulsa "Guardar clave"
- **THEN** SHALL ver "Las claves propias no están disponibles en esta instancia ahora mismo. Tu clave no se ha
  guardado."
- **AND** NO SHALL ver "Algo salió mal. Inténtalo de nuevo"
- **AND** el campo de la clave SHALL quedar vacío y Anthropic SHALL seguir como no configurado

#### Scenario: Otro error sigue siendo el común

- **GIVEN** Ana en `/perfil`
- **WHEN** guarda una clave y la API responde `500`
- **THEN** SHALL ver "Algo salió mal. Inténtalo de nuevo"

