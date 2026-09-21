## ADDED Requirements

### Requirement: Cadena con proveedores BYOK del usuario

Además del orden ya definido (BYOK → coste → local → contexto → `AI_CHAIN`), el sistema SHALL poder incluir en la cadena proveedores cuyo id es `byok:<userId>:<vendor>` construidos desde el vault del usuario del contexto. Esos proveedores SHALL declarar `external: true` y SOLO SHALL aparecer cuando el `userId` del contexto coincide con el de la clave.

#### Scenario: BYOK de otra persona no entra

- **GIVEN** claves de Beto en el vault y un `runTask` de Ana
- **WHEN** se construye la cadena de Ana
- **THEN** ningún `byok:<beto>:` SHALL estar en la cadena
