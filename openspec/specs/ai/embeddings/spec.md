# ai/embeddings Specification

## Purpose

Provee embeddings de texto dentro de `libs/ai` para búsqueda semántica F2, con mock determinista, redacción PII hacia
proveedores externos y contabilidad en el ledger, sin SDKs fuera de la carpeta de providers.

## Requirements

### Requirement: Puerto EmbeddingProvider

`libs/ai` SHALL exponer un puerto `EmbeddingProvider` con operación `embed(texts: string[]): Promise<number[][]>` (o
equivalente tipado) y capacidades declaradas (p. ej. `embeddings`, dimensionalidad, `external`). Ningún módulo fuera de
`libs/ai/infrastructure/providers` SHALL importar el SDK del proveedor de embeddings (misma regla
`no-restricted-imports` que el resto de IA).

#### Scenario: Adaptador aislado

- **GIVEN** un adaptador de embeddings de un proveedor concreto
- **WHEN** se inspecciona el grafo de imports de `apps/**` y del resto de `libs/**` fuera de providers
- **THEN** NO SHALL existir import directo del SDK de ese proveedor

### Requirement: Entrada de aplicación embedTexts (distinta de runTask)

La generación de embeddings para indexación o para la query de búsqueda SHALL invocarse **solo** a través de
`embedTexts(texts, ctx)` en el módulo IA. `runTask` SHALL permanecer reservado a tareas LLM / salidas estructuradas;
NO SHALL usarse una tarea `embed` vía `runTask` como puerta de embeddings. El routing de `embedTexts` SHALL respetar
`AI_EMBED_CHAIN`, consentimiento cuando el proveedor sea `external`, cuotas y circuit breaker alineados a ADR-014 /
ADR-036.

Para embeds de indexación en background, el consentimiento SHALL evaluarse respecto al **dueño del agregado**
(`ownerUserId`), no a una identidad de sistema del worker. El embedding del texto de query SHALL declararse con
sensibilidad `personal`.

#### Scenario: Indexación pide embeddings por embedTexts

- **GIVEN** el worker de indexación necesita un vector para un documento `cv`
- **WHEN** solicita el embedding
- **THEN** SHALL llamar a `embedTexts` de `libs/ai`
- **AND** NO SHALL llamar a `runTask` para obtener el vector
- **AND** NO SHALL construir el cliente HTTP del proveedor en el módulo `search`

#### Scenario: Consentimiento del dueño en indexación

- **GIVEN** un CV de Ana y un proveedor de embeddings `external`
- **WHEN** el worker genera el embedding en background
- **THEN** SHALL aplicarse el consentimiento / política de Ana como dueña
- **AND** el texto SHALL pasar por `PiiRedactor` antes del proveedor externo

### Requirement: Mock determinista de embeddings

En tests y CI (`AI_EMBED_CHAIN` con mock / `AI_MOCK_MODE=replay`), el sistema SHALL producir vectores deterministas a
partir de una clave estable del input (mismo espíritu que el mock LLM: no depender del texto del prompt renderizado).
El modo `synth` MAY generar vectores sintéticos en desarrollo; `synth` NO SHALL usarse en producción. Dimensionalidad
del mock SHALL ser fija y documentada.

#### Scenario: Replay estable

- **GIVEN** el mismo texto y la misma configuración de mock/replay
- **WHEN** se pide embed dos veces
- **THEN** los vectores SHALL ser idénticos bit a bit (o con tolerancia documentada de float)

### Requirement: PII y sensibilidad en embeddings

Las peticiones de embedding que lleven texto de CV, notas personales, comentarios o la query de búsqueda SHALL
declararse con sensibilidad `personal`. Antes de un proveedor `external: true`, el texto SHALL pasar por `PiiRedactor`.
NO SHALL persistirse el texto crudo del input de embedding ni loguearse. Los vectores resultantes MAY almacenarse en
Meilisearch como parte del documento de búsqueda; NO SHALL loguearse el vector completo en nivel info.

#### Scenario: CV a proveedor externo

- **GIVEN** texto de CV con email y un proveedor de embeddings externo
- **WHEN** se genera el embedding
- **THEN** el proveedor SHALL recibir el texto con marcadores PII
- **AND** NO SHALL recibir el email en claro

#### Scenario: Proveedor local

- **GIVEN** Ollama u otro proveedor `external: false`
- **WHEN** se genera el embedding de un CV
- **THEN** MAY enviarse el texto sin redactar al proceso local
- **AND** el ledger SHALL registrar la ejecución

#### Scenario: Query de búsqueda como personal

- **GIVEN** Ana busca con `q` que contiene un email
- **WHEN** se embebe la query hacia un proveedor `external`
- **THEN** el texto SHALL pasar por `PiiRedactor`
- **AND** la sensibilidad SHALL ser `personal`

### Requirement: Ledger de uso de embeddings

Cada intento de embedding (éxito o fallo) SHALL registrarse en el ledger de uso de IA con tarea/operación, proveedor,
tokens o unidades estimadas si aplica, latencia y `outcome`, sin incluir el texto embebido ni PII.

#### Scenario: Fallo de proveedor contabilizado

- **GIVEN** el proveedor de embeddings responde error
- **WHEN** termina el intento
- **THEN** SHALL existir una fila de ledger con `outcome` de error de proveedor
- **AND** NO SHALL contener el texto de entrada

