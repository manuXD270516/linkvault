## ADDED Requirements

### Requirement: Límite de importaciones

`POST /api/links/import` SHALL contar las importaciones por usuario en una ventana de tiempo y SHALL responder `429` con
código `too_many_attempts` y la cabecera `Retry-After` al superarse el límite. El contador SHALL fallar abierto: si el
almacén de contadores no responde, la importación SHALL seguir adelante. Guardar un link de uno en uno NO SHALL contar
contra este límite.

#### Scenario: Ventana agotada

- **GIVEN** un usuario que ya agotó sus importaciones de la ventana
- **WHEN** importa otro texto
- **THEN** la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After`
- **AND** NO SHALL crearse ningún link

#### Scenario: El contador no responde

- **GIVEN** el almacén de contadores caído
- **WHEN** un usuario importa un texto
- **THEN** la importación SHALL completarse normalmente

#### Scenario: Guardar uno a uno no cuenta

- **GIVEN** un usuario que agotó sus importaciones de la ventana
- **WHEN** guarda un link suelto
- **THEN** la respuesta SHALL ser `201`
