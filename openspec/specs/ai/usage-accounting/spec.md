# ai/usage-accounting Specification

## Purpose

Deja constancia de cada intento de uso de IA con su resultado, tokens, coste estimado y latencia, para poder medir la
calidad y el coste de cada proveedor, y limita cuántas ejecuciones de cada tarea puede consumir un usuario por día, sin que
el registro o el límite puedan dejar la IA fuera de servicio.

## Requirements

### Requirement: Registro de cada intento

Cada intento de un proveedor dentro de `runTask` SHALL registrarse en el ledger con usuario (si existe), tarea, proveedor,
modelo, tokens de entrada y salida, coste estimado, latencia, versión de prompt, hash de la ejecución, fecha y `outcome`
(`success`, `schema_error` o `provider_error`). Un resultado degradado por cadena vacía o agotada SHALL registrar un único
`degraded` con su motivo; una cuota superada SHALL registrar un único `quota` y ningún `degraded`. Los registros `degraded` y
`quota` SHALL tener proveedor y modelo nulos y tokens, coste y latencia a 0. Una respuesta servida desde la caché NO SHALL
registrarse.

#### Scenario: Ejecución exitosa

- **WHEN** `runTask` obtiene una salida válida del primer proveedor
- **THEN** el ledger SHALL tener un registro con `outcome: "success"` y los tokens, coste y latencia de ese intento

#### Scenario: Fallo seguido de éxito

- **GIVEN** un primer proveedor que falla por error de red y un segundo que responde bien
- **WHEN** se ejecuta `runTask`
- **THEN** el ledger SHALL tener un registro `provider_error` del primero y uno `success` del segundo, en ese orden

#### Scenario: Resultado degradado

- **WHEN** `runTask` devuelve un resultado degradado con motivo `providers_failed`
- **THEN** el ledger SHALL tener un registro `degraded` con ese motivo y proveedor nulo

### Requirement: Registro no bloqueante

Un fallo o una lentitud del almacén del ledger NO SHALL hacer fallar ni retrasar de forma apreciable la ejecución: `runTask`
SHALL devolver su resultado sin esperar a que el registro se confirme.

#### Scenario: Ledger no disponible

- **GIVEN** la base de datos del ledger no disponible
- **WHEN** se ejecuta una tarea con un proveedor sano
- **THEN** `runTask` SHALL devolver el resultado en menos de 1 segundo por encima de la latencia del proveedor

### Requirement: Coste estimado

El coste estimado de un intento SHALL calcularse con los tokens reportados y los costes por mil tokens de entrada y de salida
declarados en las capacidades del proveedor.

#### Scenario: Proveedor gratuito

- **GIVEN** un proveedor con costes por mil tokens iguales a 0
- **WHEN** se registra un intento exitoso
- **THEN** el coste estimado SHALL ser 0

### Requirement: El ledger no guarda contenido

El ledger NO SHALL guardar el input, la salida, el prompt renderizado ni ningún fragmento de ellos; solo el hash de la
ejecución y las métricas.

#### Scenario: Input con datos personales

- **GIVEN** un input que contiene un email
- **WHEN** se registra el intento
- **THEN** ningún campo del registro SHALL contener el email ni el texto del input

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
