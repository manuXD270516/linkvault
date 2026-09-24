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

**Un valor por defecto NO SHALL ser uno que se sepa que no funciona.** Cuando se nombre un recurso externo —un modelo,
un endpoint, un servicio— y el repositorio documente en otro sitio que ese recurso ya no responde, las dos cosas SHALL
corregirse a la vez: el ejemplo es lo que alguien copia sin leerlo entero, y un recurso muerto ahí no produce un error
claro sino una **degradación silenciosa**, que es la avería más cara de diagnosticar. Los valores por defecto de los
proveedores de IA, incluidos los de las claves propias de cada persona, SHALL apuntar a un recurso verificado, y la
verificación SHALL quedar anotada donde se opera.

**Sustituir un recurso muerto NO SHALL apagar una protección de privacidad por el camino.** Con OpenRouter, la política
`data_collection: deny` solo se fuerza cuando el modelo termina en `:free` (ADR-032 §4): un modelo verificado que no
cumpla esa condición arrancaría bien, respondería bien y haría viajar el texto del CV **sin esa política**, en
silencio, que es peor que el modelo muerto al que sustituye —el modelo muerto al menos falla—. Por tanto:

- El valor por defecto SHALL ser un modelo **verificado y compatible con la política**: disponible en la pasada anotada
  y de los que hacen que la petición lleve `data_collection: deny`.
- Si no existe ninguno que cumpla las dos cosas, la variable SHALL quedar **vacía**, y el arranque SHALL avisar de
  forma visible de que ese proveedor se queda sin modelo utilizable. Un hueco declarado es un estado honesto; NO SHALL
  rellenarse con un modelo que degrade la privacidad para que el ejemplo "tenga algo".
- La sustitución NO SHALL decidirse solo por disponibilidad: la comprobación de la política SHALL formar parte de lo
  que se verifica y se anota.

La comprobación automatizada de estos valores por defecto SHALL cubrir **todos los sitios donde vive el valor por
defecto** de cada variable —no solo `.env.example`—, incluido el compose de producción, donde los mismos modelos
aparecen como valor de sustitución (`${VAR:-…}`). Arreglar el ejemplo y dejar el compose con el modelo muerto dejaría
la avería exactamente donde más cuesta verla.

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

#### Scenario: El modelo que sustituye al muerto no apaga la política de datos

- **GIVEN** que la política `data_collection: deny` de OpenRouter solo se fuerza con modelos terminados en `:free`
- **WHEN** se elige el valor por defecto de la variable de modelo de OpenRouter
- **THEN** SHALL ser uno con el que la petición lleve `data_collection: deny`
- **AND** NO SHALL elegirse uno que, por no cumplir esa condición, haga viajar el texto del CV sin la política

#### Scenario: Sin candidato compatible la variable queda vacía

- **GIVEN** que ningún modelo está a la vez verificado como disponible y sujeto a `data_collection: deny`
- **WHEN** se fija el valor por defecto
- **THEN** la variable SHALL quedar vacía
- **AND** el arranque SHALL avisar de forma visible de que ese proveedor queda sin modelo utilizable
- **AND** NO SHALL rellenarse con un modelo que degrade la privacidad

#### Scenario: Un valor por defecto desmentido se detecta

- **GIVEN** un valor por defecto que la documentación del repositorio declara inservible
- **WHEN** corre la verificación del repositorio
- **THEN** SHALL fallar nombrando la variable, el valor y el archivo donde aparece
- **AND** NO SHALL depender de que alguien recuerde que las dos páginas tienen que coincidir

#### Scenario: La comprobación cubre todos los sitios del valor por defecto

- **GIVEN** la misma variable de modelo con valor por defecto en `.env.example` y en el compose de producción
- **WHEN** corre la comprobación de valores por defecto
- **THEN** SHALL inspeccionar los dos sitios
- **AND** corregir solo el ejemplo NO SHALL bastar para que pase
