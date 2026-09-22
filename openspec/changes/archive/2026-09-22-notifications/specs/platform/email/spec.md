## ADDED Requirements

### Requirement: Plantillas de notificación de producto

El puerto Mailer SHALL aceptar además los `templateId` `group-new-link`, `application-status` y `application-stale`,
cada uno con variables tipadas suficientes para el aviso (nombres de grupo/persona/oferta según el tipo, URL profunda a
`WEB_BASE_URL`, locale `es`|`en`) en **texto plano**. Auth sigue sin importar SDKs de correo.

#### Scenario: Plantilla de nuevo link

- **WHEN** el worker envía `group-new-link` vía Mailer
- **THEN** el mensaje capturado SHALL incluir asunto y cuerpo en el locale del destinatario
- **AND** SHALL incluir una URL bajo `WEB_BASE_URL` hacia el grupo o el link
- **AND** NO SHALL incluir HTML enriquecido
