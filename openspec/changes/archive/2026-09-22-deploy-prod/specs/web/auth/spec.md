## ADDED Requirements

### Requirement: Perfil enlaza a privacidad y al borrado de cuenta

`/perfil` SHALL incluir un enlace visible a `/privacidad` y SHALL exponer el flujo de peligro para borrar la cuenta
(confirmación + contraseña + llamada a la API + logout a `/login`). El detalle de textos, estados de error y comportamiento
de la UI del borrado y del aviso SHALL definirse en `web/privacy`; este requirement solo exige que el perfil los
exponga y enlace.

#### Scenario: Desde el perfil se llega a privacidad

- **GIVEN** Ana autenticada en `/perfil`
- **WHEN** sigue el enlace de privacidad
- **THEN** SHALL navegar a `/privacidad`

#### Scenario: Desde el perfil se puede iniciar el borrado

- **GIVEN** Ana en `/perfil`
- **WHEN** abre la sección de peligro de borrar cuenta
- **THEN** SHALL poder confirmar e introducir la contraseña según `web/privacy`
- **AND** un borrado exitoso SHALL terminar en `/login` sin sesión
