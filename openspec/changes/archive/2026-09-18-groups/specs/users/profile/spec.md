## MODIFIED Requirements

### Requirement: Consulta del perfil propio

`GET /api/users/me` SHALL devolver el perfil del usuario del access token: `id`, `email`, `displayName`, `aiConsent`,
`outputLanguage`, `redactName` y `createdAt`, y ningún otro campo. El perfil completo SHALL consultarlo solo su dueño; de otro
usuario solo SHALL ser visible su `displayName`, y únicamente para los miembros de sus grupos (spec
`groups/membership`). Ningún otro campo, en particular el email, SHALL exponerse a terceros.

#### Scenario: Consulta correcta

- **GIVEN** un usuario autenticado
- **WHEN** llama a `GET /api/users/me`
- **THEN** la respuesta SHALL ser `200` con exactamente esos campos

#### Scenario: Un tercero no ve el perfil

- **GIVEN** dos usuarios miembros del mismo grupo
- **WHEN** uno consulta la lista de miembros del grupo
- **THEN** SHALL ver el `displayName` del otro
- **AND** la respuesta NO SHALL contener ningún email
