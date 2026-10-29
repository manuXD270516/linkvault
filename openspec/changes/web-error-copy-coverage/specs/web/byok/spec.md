## ADDED Requirements

### Requirement: Bóveda de claves no disponible

Cuando guardar o rotar una clave responde `503 vault_unavailable` (entorno sin bóveda de claves, ADR-032 D4), `/perfil`
SHALL mostrar junto al formulario de claves el texto "LinkVault no tiene activado el guardado de claves de
IA. Tu clave no se guardó" (EN: "Saving AI keys is not enabled in LinkVault. Your key was not saved"), el texto común de
`vault_unavailable` de `web/request-errors`. El vendor SHALL seguir mostrándose como no configurado y la UI NO SHALL
mostrar "Algo salió mal. Inténtalo de nuevo" ni "LinkVault no está disponible en este momento. Inténtalo en unos
minutos": reintentar en unos minutos no cambia nada, porque la bóveda falta por configuración.

#### Scenario: Guardar una clave sin bóveda

- **GIVEN** Ana en `/perfil` sin clave Anthropic, en un entorno sin bóveda de claves
- **WHEN** pega una clave y pulsa "Guardar clave", y la API responde `503` con `vault_unavailable`
- **THEN** ve "LinkVault no tiene activado el guardado de claves de IA. Tu clave no se guardó"
- **AND** Anthropic sigue como no configurado
- **AND** NO ve "Algo salió mal. Inténtalo de nuevo" ni el texto de servicio no disponible
