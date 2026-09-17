# platform/local-environment Specification

## Purpose

Garantiza que cualquier persona pueda levantar la infraestructura de LinkVault con un solo comando, con la misma versión
mayor de MongoDB y la misma topología de replica set que usan los tests, y desarrollar las aplicaciones en su propia
máquina contra esa infraestructura sin configuración manual.

## Requirements

### Requirement: Infraestructura con un comando

El repositorio SHALL incluir una definición de contenedores que, con un solo comando y sin perfiles, levante MongoDB,
Redis y MinIO y espere a que los tres estén saludables. Las aplicaciones `api`, `worker` y `web` NO SHALL formar parte de
esa definición: se ejecutan en el host.

#### Scenario: Arranque en limpio

- **GIVEN** un equipo sin volúmenes previos del proyecto
- **WHEN** se ejecuta el comando de arranque documentado en el README con espera de salud
- **THEN** el comando SHALL terminar con éxito con MongoDB, Redis y MinIO saludables
- **AND** NO SHALL haber ningún contenedor de `api`, `worker` ni `web`

#### Scenario: Apps en el host contra la infraestructura

- **GIVEN** la infraestructura saludable y un `.env` copiado de `.env.example`
- **WHEN** se arrancan `api` y `worker` en el host con el comando documentado
- **THEN** `GET /health` de ambos SHALL responder 200

### Requirement: MongoDB siempre como replica set

MongoDB SHALL arrancar como replica set `rs0` de un nodo. La inicialización SHALL ser automática e idempotente: SHALL
completarse sola en el primer arranque y NO SHALL fallar sobre un volumen ya inicializado. El servicio NO SHALL
reportarse saludable hasta que el replica set tenga primario.

#### Scenario: Primer arranque

- **GIVEN** un volumen de datos vacío
- **WHEN** se levanta la infraestructura
- **THEN** el replica set `rs0` SHALL quedar inicializado sin intervención manual

#### Scenario: Reinicio sobre un volumen existente

- **GIVEN** un volumen con el replica set ya inicializado
- **WHEN** se vuelve a levantar la infraestructura
- **THEN** MongoDB SHALL quedar saludable sin errores de inicialización

#### Scenario: Transacción desde el host

- **GIVEN** la infraestructura saludable
- **WHEN** un proceso en el host se conecta con la URI documentada en `.env.example` y ejecuta una transacción
  multi-documento
- **THEN** la transacción SHALL confirmarse

### Requirement: Ollama solo bajo demanda

El servicio de Ollama SHALL estar detrás del perfil opcional `ai-local` y NO SHALL arrancar con el comando por defecto.

#### Scenario: Arranque por defecto

- **WHEN** se levanta la infraestructura sin activar perfiles
- **THEN** Ollama NO SHALL estar en ejecución

#### Scenario: Arranque con el perfil de IA local

- **WHEN** se levanta la infraestructura con el perfil `ai-local`
- **THEN** Ollama SHALL responder en su puerto publicado en el host

### Requirement: Web y API comparten origen en desarrollo

En desarrollo, las rutas de la API SHALL servirse bajo el prefijo `/api`, excepto `/health` y `/health/live`. El servidor
de desarrollo de `web` SHALL reenviar a la API toda petición bajo `/api`, de modo que el navegador vea un único origen.

#### Scenario: Petición de la SPA a la API

- **GIVEN** `api` y `web` en ejecución en el host
- **WHEN** el navegador pide `/api/<ruta-inexistente>` al origen de `web`
- **THEN** la respuesta SHALL ser un 404 emitido por la API, no el HTML de la SPA

#### Scenario: Salud fuera del prefijo

- **WHEN** se hace `GET /health` contra el puerto de la API
- **THEN** SHALL responder sin necesidad del prefijo `/api`

### Requirement: Configuración por entorno documentada

El repositorio SHALL incluir `.env.example` con todas las variables que leen `api` y `worker`, con valores válidos para
el entorno local y seguros por defecto. La selección de proveedores de IA SHALL expresarse con `AI_CHAIN` y
`AI_MOCK_MODE`; la variable `AI_PROVIDER` NO SHALL usarse. Ningún secreto real SHALL estar versionado.

#### Scenario: Valores por defecto seguros

- **WHEN** se inspecciona `.env.example`
- **THEN** `FEATURE_HEADLESS_EXTRACTION` SHALL valer `false`
- **AND** `AI_CHAIN` SHALL valer `mock`
- **AND** NO SHALL contener ninguna clave de API real ni la variable `AI_PROVIDER`
