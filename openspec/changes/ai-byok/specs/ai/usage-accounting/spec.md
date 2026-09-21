## ADDED Requirements

### Requirement: BYOK no consume la cuota de plataforma

Al aplicar el límite diario por usuario y tarea, el sistema SHALL contar únicamente ejecuciones `success` cuyo `providerId` **no** empiece por `byok:`. Un `success` servido por un proveedor BYOK NO SHALL incrementar ese conteo. Si el conteo de no-BYOK alcanzó el límite y el usuario tiene al menos un BYOK elegible (consentimiento + clave + capacidades), `runTask` SHALL continuar hacia la cadena. Si no hay BYOK elegible, SHALL degradar con `quota_exceeded` como hoy.

#### Scenario: Solo BYOK tras agotar plataforma

- **GIVEN** límite 1 de `match-cv`, un `success` previo con `providerId: openrouter`, y Ana con BYOK OpenAI usable
- **WHEN** Ana ejecuta de nuevo `match-cv`
- **THEN** la ejecución NO SHALL degradar por cuota solo por ese success de plataforma
- **AND** MAY completarse vía `byok:<ana>:openai`

#### Scenario: Sin BYOK sigue la cuota

- **GIVEN** el mismo límite agotado por successes de plataforma y Ana sin claves BYOK
- **WHEN** ejecuta la tarea
- **THEN** SHALL devolverse `quota_exceeded`
