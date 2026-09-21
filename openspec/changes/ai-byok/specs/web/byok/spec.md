## Purpose

En el perfil, la persona gestiona sus claves de IA propias: las pega, ve un hint, las rota o las revoca, y entiende que con consentimiento el CV puede salir hacia ese proveedor.

## ADDED Requirements

### Requirement: Gestión de claves en perfil

`/perfil` SHALL ofrecer, para cada vendor soportado, estado configurado/no configurado, acción de guardar o rotar (input de clave, sin echo), hint visible si hay clave, y acción de revocar con confirmación. Tras guardar o revocar, la UI SHALL reflejar el listado del API sin mostrar la clave completa.

#### Scenario: Guarda OpenAI

- **GIVEN** Ana en `/perfil` sin clave OpenAI
- **WHEN** pega una clave y guarda
- **THEN** ve el hint y el vendor como configurado
- **AND** el valor pegado ya no aparece en el campo

#### Scenario: Revoca

- **GIVEN** Ana con Anthropic configurado
- **WHEN** confirma la revocación
- **THEN** ese vendor pasa a no configurado
