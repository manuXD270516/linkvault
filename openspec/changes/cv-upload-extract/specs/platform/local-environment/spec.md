## MODIFIED Requirements

### Requirement: Infraestructura con un comando

El repositorio SHALL incluir una definición de contenedores que, con un solo comando y sin perfiles, levante MongoDB,
Redis y MinIO y espere a que los tres estén saludables. Las aplicaciones `api`, `worker` y `web` NO SHALL formar parte de
esa definición: se ejecutan en el host.

MinIO SHALL quedar saludable solo con **sus dos buckets** creados de forma idempotente: el de los snapshots del
enriquecimiento, con su regla de expiración, y el de los **CV**, **sin** regla de expiración —un CV no caduca solo— y
**sin** ninguna política de acceso anónimo.

#### Scenario: Arranque en limpio

- **GIVEN** un equipo sin volúmenes previos del proyecto
- **WHEN** se ejecuta el comando de arranque documentado en el README con espera de salud
- **THEN** el comando SHALL terminar con éxito con MongoDB, Redis y MinIO saludables
- **AND** NO SHALL haber ningún contenedor de `api`, `worker` ni `web`

#### Scenario: Los dos buckets existen

- **WHEN** la infraestructura queda saludable
- **THEN** SHALL existir el bucket de snapshots y el de CV
- **AND** repetir el arranque NO SHALL duplicar ni cambiar su configuración

#### Scenario: El bucket de CV no es público ni caduca

- **WHEN** se inspecciona el bucket de CV recién creado
- **THEN** NO SHALL tener acceso anónimo
- **AND** NO SHALL tener ninguna regla de expiración

#### Scenario: Apps en el host contra la infraestructura

- **GIVEN** la infraestructura saludable y un `.env` copiado de `.env.example`
- **WHEN** se arrancan `api` y `worker` en el host con el comando documentado
- **THEN** `GET /health` de ambos SHALL responder 200

### Requirement: Configuración por entorno documentada

El repositorio SHALL incluir `.env.example` con todas las variables que leen `api` y `worker`, con valores válidos para
el entorno local y seguros por defecto. La selección de proveedores de IA SHALL expresarse con `AI_CHAIN` y
`AI_MOCK_MODE`; la variable `AI_PROVIDER` NO SHALL usarse. Ningún secreto real SHALL estar versionado.

Las URLs públicas de la página (`PUBLIC_PAGE_BASE_URL`) y del SPA (`WEB_BASE_URL`) SHALL declararse como variables, con
los valores del entorno local, y NO SHALL deducirse de la cabecera `Host` de una petición.

Las variables del almacenamiento de objetos (`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`S3_SNAPSHOTS_BUCKET` y `S3_BUCKET`) SHALL validarse en el arranque de **quien las lee**: `worker` todas, y `api` las
que necesita para los CV, incluida `S3_BUCKET`. El plazo y la concurrencia de la lectura de un CV
(`CV_EXTRACTION_TIMEOUT_MS`, `CV_EXTRACT_CONCURRENCY`) SHALL ser variables de `worker` con valores locales en el
ejemplo.

#### Scenario: Valores por defecto seguros

- **WHEN** se inspecciona `.env.example`
- **THEN** `FEATURE_HEADLESS_EXTRACTION` SHALL valer `false`
- **AND** `AI_CHAIN` SHALL valer `mock`
- **AND** NO SHALL contener ninguna clave de API real ni la variable `AI_PROVIDER`

#### Scenario: URLs públicas declaradas

- **WHEN** se inspecciona `.env.example`
- **THEN** SHALL incluir `PUBLIC_PAGE_BASE_URL` y `WEB_BASE_URL` con las URLs del entorno local
- **AND** `api` SHALL negarse a arrancar si falta alguna de las dos

#### Scenario: El bucket de CV es obligatorio para la API

- **WHEN** se arranca `api` sin `S3_BUCKET`
- **THEN** el proceso SHALL terminar con código distinto de cero nombrando la variable, sin mostrar su valor

#### Scenario: La lectura del CV se configura en el worker

- **WHEN** se inspecciona `.env.example`
- **THEN** SHALL incluir `CV_EXTRACTION_TIMEOUT_MS` y `CV_EXTRACT_CONCURRENCY` con valores válidos para el entorno local
