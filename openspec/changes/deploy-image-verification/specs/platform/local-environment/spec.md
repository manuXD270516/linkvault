## MODIFIED Requirements

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

**Un valor por defecto del ejemplo NO SHALL ser uno que se sepa que no funciona.** Cuando el ejemplo nombre un recurso
externo —un modelo, un endpoint, un servicio— y el repositorio documente en otro sitio que ese recurso ya no responde,
las dos cosas SHALL corregirse a la vez: el ejemplo es lo que alguien copia sin leerlo entero, y un recurso muerto ahí
no produce un error claro sino una **degradación silenciosa**, que es la avería más cara de diagnosticar. Los valores
por defecto de los proveedores de IA, incluidos los de las claves propias de cada persona, SHALL apuntar a un recurso
verificado, y la verificación SHALL quedar anotada donde se opera.

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

#### Scenario: El ejemplo no reparte un modelo muerto

- **GIVEN** que la documentación operativa registra que un modelo concreto ya no existe
- **WHEN** se inspecciona `.env.example`
- **THEN** ninguna variable de modelo SHALL tener ese valor por defecto
- **AND** el valor por defecto SHALL ser uno cuya disponibilidad esté verificada y anotada

#### Scenario: Un valor por defecto desmentido se detecta

- **GIVEN** un valor por defecto del ejemplo que la documentación del repositorio declara inservible
- **WHEN** corre la verificación del repositorio
- **THEN** SHALL fallar nombrando la variable y el valor
- **AND** NO SHALL depender de que alguien recuerde que las dos páginas tienen que coincidir
