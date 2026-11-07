## RENAMED Requirements

- FROM: `### Requirement: El texto pegado es un dato personal`
- TO: `### Requirement: El texto pegado puede traer datos personales`

## MODIFIED Requirements

### Requirement: El texto pegado puede traer datos personales

El texto recibido NO SHALL persistirse en ninguna colección, cola, caché ni registro, ni aparecer en los logs, en el
ledger de IA ni en los avisos del canal de eventos. Antes de la IA SHALL quitársele cualquier email y teléfono. SHALL
tratarse como contenido que puede traer datos personales de otras personas, y no como un dato de quien lo pega: la
lectura SHALL hacerse con una tarea de sensibilidad `incidental` (`ai/data-protection`). En consecuencia, NO SHALL
exigir el permiso de IA externa de quien pega, que habla solo de su CV; SHALL enviarse a un proveedor externo **solo**
si ese proveedor pide no recolectar los datos, tenga o no quien pega ese permiso; y, si se envía, SHALL pasar por la
redacción de datos personales. Los campos que se derivan de él sí se guardan, y NO SHALL reproducir nombres de
personas.

#### Scenario: Texto con datos de contacto

- **WHEN** se pega una oferta que incluye el email, el teléfono y el nombre del reclutador, y una marca única sembrada
- **THEN** ni la base de datos, ni la cola, ni los logs, ni el ledger SHALL contener el texto, la marca, el email ni el
  teléfono
- **AND** la entrada que recibe la IA NO SHALL contener el email ni el teléfono
- **AND** el resumen guardado NO SHALL contener el nombre del reclutador

#### Scenario: Con consentimiento, el proveedor externo es elegible

- **GIVEN** un usuario que aceptó enviar sus datos a proveedores externos
- **AND** una cadena con un proveedor externo que pide no recolectar los datos antes que uno local
- **WHEN** pega una oferta
- **THEN** la lectura SHALL poder ir al proveedor externo, con los datos personales redactados

#### Scenario: Sin consentimiento, sin proveedor externo

- **GIVEN** un usuario que no aceptó enviar sus datos a proveedores externos
- **AND** una cadena con un proveedor externo que no pide no recolectar los datos antes que uno local
- **WHEN** pega una oferta
- **THEN** la lectura NO SHALL enviarse al proveedor externo
- **AND** la falta de permiso NO SHALL ser el motivo: con el permiso dado tampoco se enviaría

#### Scenario: Sin consentimiento, el externo que pide no recolectar lee lo pegado

- **GIVEN** un usuario que no aceptó enviar sus datos a proveedores externos
- **AND** una cadena con un proveedor externo que pide no recolectar los datos antes que uno local
- **WHEN** pega una oferta
- **THEN** la lectura SHALL poder ir al proveedor externo, con los datos personales redactados

#### Scenario: Ni con consentimiento va a un externo que no pide no recolectar

- **GIVEN** un usuario que aceptó enviar sus datos a proveedores externos
- **AND** una cadena con un proveedor externo que no pide no recolectar los datos antes que uno local
- **WHEN** pega una oferta
- **THEN** la lectura NO SHALL enviarse a ese proveedor externo

#### Scenario: Solo hay externos que no piden no recolectar

- **GIVEN** una cadena cuyo único proveedor es externo y no pide no recolectar los datos
- **WHEN** un usuario, con o sin el permiso de IA externa, pega una oferta
- **THEN** ninguna petición SHALL salir hacia ese proveedor
- **AND** la respuesta SHALL ser `503` con código `extraction_disabled`

#### Scenario: Sin consentimiento nunca se pide el permiso

- **GIVEN** un usuario que no aceptó enviar sus datos a proveedores externos
- **WHEN** pega una oferta con cualquier cadena configurada
- **THEN** la respuesta NO SHALL ser `409` con código `ai_consent_required`
