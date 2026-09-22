# web/privacy Specification

## Purpose

Ofrece en el SPA un aviso público de privacidad honesto (almacenamiento de CV, retención, IA/OpenRouter/BYOK y borrado) y
el flujo de peligro para borrar la cuenta desde el perfil, enlazado también desde mi CV.

## Requirements

### Requirement: Ruta pública de aviso de privacidad

El SPA SHALL exponer la ruta pública `/privacidad` (sin exigir sesión) con un aviso que explique, en lenguaje claro al
menos: qué se guarda del CV y dónde; la política de retención aplicable (o que el detalle de prod se documenta según
configuración); el uso de IA / OpenRouter / BYOK y el consentimiento; y cómo borrar la cuenta. El aviso NO SHALL
inventar garantías que el entorno actual no cumpla; cuando la configuración de producción tenga cifrado en reposo y/o
retención documentados, `/privacidad` MAY afirmarlos.

#### Scenario: Abrir /privacidad sin sesión

- **GIVEN** una persona sin sesión
- **WHEN** abre `/privacidad`
- **THEN** SHALL ver el aviso de privacidad
- **AND** NO SHALL redirigirse a `/login`

#### Scenario: El aviso cubre los temas obligatorios

- **WHEN** se revisa el contenido de `/privacidad`
- **THEN** SHALL mencionar almacenamiento de CV, retención, IA/OpenRouter/BYOK y borrado de cuenta
- **AND** NO SHALL afirmar cifrado en reposo ni caducidad automática del CV si el entorno documentado no los tiene

### Requirement: Borrar cuenta desde el perfil

Desde `/perfil`, en una sección de peligro claramente separada, el SPA SHALL ofrecer borrar la cuenta. El flujo SHALL
pedir confirmación explícita y la contraseña actual, llamar a `DELETE /api/users/me` con `{ password }`, y tras un
`204` SHALL cerrar la sesión local y navegar a `/login`. Un `401` de contraseña incorrecta SHALL mostrarse sin cerrar
sesión; un `409` de owner bloqueante SHALL explicar que debe transferir u abandonar el grupo antes de borrar.

#### Scenario: Borrado exitoso desde el perfil

- **GIVEN** Ana en `/perfil` sin grupos bloqueantes
- **WHEN** confirma el borrado, introduce la contraseña correcta y la API responde `204`
- **THEN** el SPA SHALL invalidar la sesión local
- **AND** SHALL navegar a `/login`

#### Scenario: Contraseña incorrecta en el flujo

- **GIVEN** Ana en el diálogo de borrado
- **WHEN** la API responde `401` por contraseña incorrecta
- **THEN** SHALL verse el error
- **AND** Ana SHALL seguir autenticada en `/perfil`

#### Scenario: Owner bloqueante

- **GIVEN** Ana única owner de un grupo con otros miembros
- **WHEN** la API responde `409`
- **THEN** el SPA SHALL mostrar un mensaje que indique el bloqueo por ownership
- **AND** NO SHALL cerrar la sesión

### Requirement: Enlaces a /privacidad desde perfil y mi CV

`/perfil` y `/mi-cv` SHALL mostrar un enlace visible a `/privacidad`. El detalle del copy de almacenamiento y retención
del CV en esas pantallas SHALL remitir a `/privacidad` en lugar de inventar promesas en la línea corta.

#### Scenario: Enlace desde el perfil

- **GIVEN** Ana en `/perfil`
- **WHEN** sigue el enlace a privacidad
- **THEN** SHALL llegar a `/privacidad`

#### Scenario: Enlace desde mi CV

- **GIVEN** Ana en `/mi-cv`
- **WHEN** sigue el enlace a privacidad
- **THEN** SHALL llegar a `/privacidad`
