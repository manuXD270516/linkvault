## MODIFIED Requirements

### Requirement: Infraestructura con un comando

El repositorio SHALL incluir una definición de contenedores que, con un solo comando y sin perfiles, levante MongoDB,
Redis, MinIO y **Mailpit** y espere a que los cuatro estén saludables. Las aplicaciones `api`, `worker` y `web` NO
SHALL formar parte de esa definición: se ejecutan en el host.

MinIO SHALL quedar saludable solo con **sus dos buckets** creados de forma idempotente: el de los snapshots del
enriquecimiento, con su regla de expiración, y el de los **CV**, **sin** regla de expiración —un CV no caduca solo— y
**sin** ninguna política de acceso anónimo. La comprobación de cada bucket SHALL ser **independiente** de la del otro,
de modo que un entorno que ya tenía el de snapshots creado SHALL crear igualmente el de CV.

Mailpit SHALL exponer SMTP para que `api` envíe correo en local y una UI de captura en el puerto documentado (por
defecto UI `8025`, SMTP `1025`, configurables).

#### Scenario: Arranque en limpio

- **GIVEN** un equipo sin volúmenes previos del proyecto
- **WHEN** se ejecuta el comando de arranque documentado en el README con espera de salud
- **THEN** el comando SHALL terminar con éxito con MongoDB, Redis, MinIO y Mailpit saludables
- **AND** NO SHALL haber ningún contenedor de `api`, `worker` ni `web`

#### Scenario: Los dos buckets existen

- **WHEN** la infraestructura queda saludable
- **THEN** SHALL existir el bucket de snapshots y el de CV
- **AND** repetir el arranque NO SHALL duplicar ni cambiar su configuración

#### Scenario: Volumen que ya existía

- **GIVEN** un volumen de MinIO con el bucket de snapshots ya creado y sin el de CV
- **WHEN** se levanta la infraestructura y se espera a que esté saludable
- **THEN** SHALL existir también el bucket de CV

#### Scenario: El bucket de CV no es público ni caduca

- **WHEN** se inspecciona el bucket de CV recién creado
- **THEN** NO SHALL tener acceso anónimo
- **AND** NO SHALL tener ninguna regla de expiración

#### Scenario: Apps en el host contra la infraestructura

- **GIVEN** la infraestructura saludable y un `.env` copiado de `.env.example`
- **WHEN** se arrancan `api` y `worker` en el host con el comando documentado
- **THEN** `GET /health` de ambos SHALL responder 200

#### Scenario: Mailpit recibe correo local

- **GIVEN** la infraestructura saludable y `api` con `MAIL_PROVIDER=smtp` hacia Mailpit
- **WHEN** se dispara un correo de verificación en desarrollo
- **THEN** el mensaje SHALL aparecer en la UI de Mailpit en el puerto documentado

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

Las variables de correo (`MAIL_PROVIDER`, `MAIL_FROM`, SMTP hacia Mailpit y `RESEND_API_KEY` placeholder) SHALL
declararse para el entorno local con `MAIL_PROVIDER=smtp` (o el valor documentado hacia Mailpit) y sin clave real de
Resend.

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

#### Scenario: Correo local documentado

- **WHEN** se inspecciona `.env.example`
- **THEN** SHALL incluir `MAIL_PROVIDER`, `MAIL_FROM` y la configuración SMTP de Mailpit
- **AND** `RESEND_API_KEY` SHALL estar vacía o comentada como placeholder
