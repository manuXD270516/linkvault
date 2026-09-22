# web/byok Specification

## Purpose

En el perfil, la persona gestiona sus claves de IA propias: las pega, ve un hint, las rota o las revoca, y entiende con claridad cuándo el CV puede salir a un vendor y cuándo las claves están guardadas pero inactivas.

## Requirements

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

### Requirement: Aviso de destino del dato

Junto al formulario BYOK, la UI SHALL mostrar un aviso que nombre el vendor y diga que, con el permiso de IA externa vigente, texto del CV y de la oferta puede salir hacia ese proveedor. Si el vendor es OpenRouter y el modelo de entorno no termina en `:free`, el aviso SHALL indicar además que LinkVault no fuerza `data_collection: deny` en ese caso.

#### Scenario: Ve el aviso al configurar

- **GIVEN** Ana en la sección de claves
- **WHEN** mira el formulario de un vendor
- **THEN** lee el aviso de destino del dato con el nombre del vendor

#### Scenario: OpenRouter sin sufijo free

- **GIVEN** el modelo de entorno de OpenRouter BYOK no termina en `:free`
- **WHEN** Ana mira el formulario de OpenRouter
- **THEN** el aviso SHALL decir que LinkVault no fuerza `data_collection: deny` en ese caso

### Requirement: Claves guardadas con consentimiento off

Si hay al menos un `keyHint` y el consentimiento externo no está vigente, la UI SHALL decir con claridad que las claves siguen guardadas pero **no se usan** hasta que vuelva a dar el permiso (y que revocar el permiso no las borró).

#### Scenario: Consentimiento retirado con hint visible

- **GIVEN** Ana con OpenAI configurado y consentimiento revocado
- **WHEN** abre `/perfil`
- **THEN** ve el hint del vendor
- **AND** lee que las claves no se usan mientras el permiso esté off
