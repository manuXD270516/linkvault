## ADDED Requirements

### Requirement: Cliente extensión usa el mismo guardado

Un cliente autenticado distinto del SPA (extensión Chromium) SHALL poder invocar
`POST /api/links` con el mismo schema de request/response y las mismas reglas de membresía,
dedupe y errores que un cliente web. Este requisito NO introduce campos nuevos en el body.

#### Scenario: Extensión guarda URL canónica

- **GIVEN** un access token válido emitido para cliente extensión
- **WHEN** envía `POST /api/links` con una URL de plataforma soportada
- **THEN** la respuesta SHALL ser `201` con el mismo shape que documenta «Guardar un link»
