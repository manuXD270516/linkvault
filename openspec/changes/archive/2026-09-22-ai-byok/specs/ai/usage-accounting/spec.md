## MODIFIED Requirements

### Requirement: Cuotas diarias por usuario y tarea

Cada tarea PUEDE tener un límite diario de ejecuciones por usuario definido en configuración (`AI_QUOTAS`). El conteo SHALL incluir únicamente ejecuciones `success` de las últimas 24 horas cuyo `providerId` **no** empiece por `byok:`. Un `success` servido por un proveedor BYOK NO SHALL incrementar ese conteo.

Cuando el conteo de no-BYOK alcanza el límite:
- si el usuario tiene al menos un BYOK elegible (consentimiento vigente + clave descifrable + capacidades), `runTask` SHALL continuar con una cadena **restringida solo a esos `byok:*`** (ningún proveedor de plataforma SHALL recibir la petición en esa ejecución);
- si no hay BYOK elegible, SHALL devolver `quota_exceeded` sin contactar a ningún proveedor.

Las ejecuciones sin usuario y las tareas sin límite NO SHALL estar sujetas a cuota. Si el conteo no puede completarse, la cuota SHALL permitir la ejecución. Esta regla **no** modifica la cuota de análisis de producto (`MATCH_ANALYSES_PER_USER`), que sigue aplicando con independencia de BYOK.

#### Scenario: Límite alcanzado

- **GIVEN** un límite de 2 ejecuciones diarias de `classify-skills` y un usuario con 2 `success` no-BYOK en las últimas 24 horas, sin claves BYOK
- **WHEN** ese usuario ejecuta `classify-skills`
- **THEN** SHALL devolverse `status: "degraded"` con motivo `quota_exceeded`
- **AND** ningún proveedor SHALL recibir una petición
- **AND** el ledger SHALL tener un único registro `quota` para esa ejecución

#### Scenario: Límite alcanzado con BYOK

- **GIVEN** el mismo límite agotado por successes de plataforma y Ana con BYOK OpenAI usable
- **WHEN** Ana ejecuta la tarea
- **THEN** la ejecución NO SHALL degradar por cuota
- **AND** solo proveedores `byok:<ana>:` SHALL poder recibir la petición
- **AND** el OpenRouter (u otro) de plataforma NO SHALL recibirla

#### Scenario: Success BYOK no cuenta

- **GIVEN** límite 1 y un único `success` previo con `providerId` `byok:<ana>:openai`
- **WHEN** se evalúa la cuota de plataforma
- **THEN** el conteo NO SHALL incluir ese success

#### Scenario: Ejecución sin usuario

- **GIVEN** un límite configurado para una tarea
- **WHEN** se ejecuta la tarea con un contexto sin usuario
- **THEN** la cuota NO SHALL aplicarse

#### Scenario: Conteo no disponible

- **GIVEN** un límite configurado y la base de datos del ledger no disponible
- **WHEN** un usuario ejecuta la tarea
- **THEN** la ejecución SHALL continuar hacia los proveedores
