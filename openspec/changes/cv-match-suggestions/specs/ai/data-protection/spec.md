## MODIFIED Requirements

### Requirement: Redacción para proveedores externos

Antes de enviar una tarea `personal` a un proveedor con `external: true`, el sistema SHALL sustituir en el input los emails,
los teléfonos (móviles de Bolivia, números con prefijo internacional `+` y números locales LatAm de 8 a 11 dígitos agrupados
con espacios, guiones o puntos), las URLs, las direcciones postales y los documentos de identidad por marcadores estables del
tipo `[EMAIL_1]`, `[PHONE_1]`, `[URL_1]`, `[ADDRESS_1]` e `[ID_1]`. Un mismo
valor SHALL recibir el mismo marcador en toda la ejecución. Fechas, años, rangos de años (`2019-2023`, `03.2020 - 06.2022`),
montos y números sin agrupación de teléfono NO SHALL redactarse, salvo los móviles bolivianos de 8 dígitos y los números que
cumplan las reglas de documento de identidad. Cuando un mismo fragmento cumpla a la vez las reglas de teléfono y las de
documento de identidad SHALL redactarse una sola vez, con el marcador de documento. Los proveedores con `external: false`
SHALL recibir el input sin redactar.

#### Scenario: Proveedor externo

- **GIVEN** una tarea `personal` y un proveedor con `external: true`
- **WHEN** el input contiene un email y un teléfono
- **THEN** el prompt enviado SHALL contener `[EMAIL_1]` y `[PHONE_1]`
- **AND** NO SHALL contener los valores originales

#### Scenario: Valor repetido

- **GIVEN** un input donde el mismo email aparece dos veces
- **WHEN** se redacta para un proveedor externo
- **THEN** ambas apariciones SHALL sustituirse por el mismo marcador

#### Scenario: Números que no son teléfonos

- **GIVEN** un input con `2024`, `Bs 8500`, `12/03/2025`, `2019-2023` y `03.2020 - 06.2022`
- **WHEN** se redacta para un proveedor externo
- **THEN** esos valores SHALL permanecer sin cambios

#### Scenario: Proveedor local

- **GIVEN** un proveedor con `external: false`
- **WHEN** el input contiene un email
- **THEN** el prompt enviado SHALL contener el email original

#### Scenario: Encabezado de un CV hacia un proveedor externo

- **GIVEN** una tarea `personal` con un CV cuyo encabezado trae email, móvil boliviano, `Av. Ballivián 1234, Zona Sur` y `CI: 4567890 LP`
- **WHEN** se redacta para un proveedor con `external: true`
- **THEN** el prompt enviado SHALL contener `[EMAIL_1]`, `[PHONE_1]`, `[ADDRESS_1]` e `[ID_1]`
- **AND** NO SHALL contener ninguno de los cuatro valores originales

### Requirement: Reinyección en la salida

Los marcadores presentes en cualquier texto de la salida validada SHALL sustituirse por sus valores originales antes de
devolver el resultado, incluidos los de nombre, dirección y documento, y también dentro de `suggestions[].after`: la
redacción protege el dato frente al proveedor, no frente a su dueño, de modo que la persona SHALL recibir siempre el texto
con sus valores reales aunque `redactName` esté activado. Una salida que contenga un marcador que no se emitió en esa
ejecución SHALL tratarse como salida inválida y su texto NO SHALL devolverse ni persistirse tal cual. La correspondencia
entre marcadores y valores SHALL existir solo en memoria durante la ejecución y SHALL descartarse al terminar, tanto si
termina con éxito como si falla.

#### Scenario: Marcador en la salida

- **GIVEN** un proveedor externo cuya salida contiene `[EMAIL_1]`
- **WHEN** `runTask` devuelve el resultado
- **THEN** la salida SHALL contener el email original y no el marcador

#### Scenario: Nombre redactado dentro de una sugerencia

- **GIVEN** un contexto con `redactName: true` y un proveedor externo cuya salida trae `suggestions[0].after` con `[NAME_1]`
- **WHEN** `runTask` devuelve el resultado
- **THEN** `suggestions[0].after` SHALL contener el nombre real de la persona
- **AND** ningún texto devuelto SHALL contener `[NAME_1]`

#### Scenario: Marcador inventado por el proveedor

- **GIVEN** una ejecución en la que solo se emitieron `[EMAIL_1]` y `[PHONE_1]`
- **WHEN** la salida del proveedor contiene `[ADDRESS_3]`
- **THEN** esa salida SHALL tratarse como inválida
- **AND** NO SHALL devolverse al usuario ni guardarse con el marcador dentro

### Requirement: Sin persistencia de prompts ni registro de secretos

El sistema NO SHALL persistir prompts renderizados en ningún almacén (ledger, caché, fixtures, logs), NO SHALL registrar en
logs las credenciales de proveedores ni las cabeceras de autorización, NO SHALL registrar en logs el texto de un CV ni
fragmentos de él (incluidos los textos de `evidence` y de `suggestions`) en ningún nivel de log, y los errores de proveedor
NO SHALL incluir el cuerpo de la respuesta.

#### Scenario: Log de una petición a OpenRouter

- **GIVEN** una credencial de OpenRouter configurada
- **WHEN** se ejecuta una tarea contra OpenRouter con los logs en nivel `debug`
- **THEN** ninguna línea de log SHALL contener la credencial ni el texto del prompt renderizado

#### Scenario: Entrada de caché

- **WHEN** se guarda una salida en la caché
- **THEN** la entrada SHALL contener solo la salida, el proveedor, el modelo y la versión de prompt

#### Scenario: Log de un análisis de CV

- **GIVEN** un análisis de encaje con los logs en nivel `debug`
- **WHEN** termina con éxito y cuando termina con error de proveedor
- **THEN** ninguna línea de log SHALL contener texto del CV, ni redactado ni sin redactar
- **AND** las líneas SHALL identificar la ejecución solo por tarea, proveedor, modelo, versión de prompt y clave

## ADDED Requirements

### Requirement: Detección de dirección postal

El sistema SHALL considerar dirección postal todo fragmento de una misma línea que empiece por un indicador de vía o de
domicilio (`Calle`, `C/`, `Avenida`, `Av.`, `Pasaje`, `Psje.`, `Camino`, `Carretera`, `Km`, `Zona`, `Barrio`,
`Urbanización`, `Condominio`, `Edificio`, `Torre`, `Manzana`, `Mz`, `Nro.`, `N°`, `#`, `Piso`, `Depto.`), sin distinguir
mayúsculas ni la presencia del punto de abreviatura, y siga con al menos un token más; el fragmento SHALL terminar en el
final de la línea o en el primer separador fuerte (`|`, `·`, `—`, `–`, tabulación) que aparezca después. NO SHALL
considerarse dirección el nombre de una ciudad, departamento, país o nacionalidad por sí solos, ni un indicador de vía que
forme parte de un valor ya sustituido por otro marcador.

#### Scenario: Dirección en el encabezado de un CV

- **GIVEN** una línea `Av. Ballivián 1234, Zona Sur, La Paz`
- **WHEN** se redacta para un proveedor externo
- **THEN** la línea completa SHALL sustituirse por `[ADDRESS_1]`

#### Scenario: Una ciudad no es una dirección

- **GIVEN** un input con `La Paz, Bolivia`, `Santa Cruz` y `disponible para remoto desde Cochabamba`
- **WHEN** se redacta para un proveedor externo
- **THEN** esos textos SHALL permanecer sin cambios, porque la ubicación es información de encaje y no domicilio

#### Scenario: La dirección termina en el separador

- **GIVEN** una línea `Calle 21 de Calacoto 500 — Desarrollador Senior`
- **WHEN** se redacta para un proveedor externo
- **THEN** la línea enviada SHALL ser `[ADDRESS_1] — Desarrollador Senior`

### Requirement: Detección de documento de identidad

El sistema SHALL considerar documento de identidad una secuencia de 5 a 10 dígitos, con o sin puntos de millar, cuando se
cumpla al menos una de estas dos condiciones: que vaya seguida de una extensión departamental boliviana (`LP`, `CB`, `SC`,
`OR`, `PT`, `TJ`, `CH`, `BE`, `PD`) o de un guion y un carácter alfanumérico de control; o que vaya precedida, en la misma
línea y a no más de 30 caracteres, de una palabra clave de documento (`CI`, `C.I.`, `carnet`, `carné`, `cédula`, `cédula de
identidad`, `DNI`, `documento de identidad`, `pasaporte`), con o sin dos puntos entre medias. Con la palabra clave
`pasaporte` SHALL admitirse además una secuencia de 6 a 10 caracteres alfanuméricos sin espacios internos. Un número que no
cumpla ninguna de las dos condiciones NO SHALL considerarse documento de identidad, y una palabra clave sin número en esa
ventana NO SHALL producir ninguna redacción.

#### Scenario: CI boliviano con extensión departamental

- **GIVEN** un input con `4567890 LP` y con `1234567-1E`
- **WHEN** se redacta para un proveedor externo
- **THEN** ambos SHALL sustituirse por marcadores `[ID_n]` distintos
- **AND** el input enviado NO SHALL contener ninguno de los dos valores

#### Scenario: Documento con palabra clave

- **GIVEN** un input con `DNI: 45.678.901` y con `Cédula de identidad 8901234`
- **WHEN** se redacta para un proveedor externo
- **THEN** ambos números SHALL sustituirse por marcadores `[ID_n]`

#### Scenario: Número suelto que no es documento

- **GIVEN** un input con `Gestioné un presupuesto de 850000`, `ISO 27001` y `Promoción 2019`
- **WHEN** se redacta para un proveedor externo
- **THEN** esos números SHALL permanecer sin cambios

#### Scenario: Número que parece documento y teléfono a la vez

- **GIVEN** un input con `CI 71234567`, que también cumple el formato de móvil boliviano
- **WHEN** se redacta para un proveedor externo
- **THEN** el número SHALL aparecer una sola vez sustituido, con el marcador `[ID_1]`
- **AND** el input enviado NO SHALL contener el número original

### Requirement: Vigencia del consentimiento para proveedores externos

El consentimiento para proveedores externos SHALL registrar el instante en que se dio (`consentedAt`) y la versión del texto
aceptado (`textVersion`), y el sistema SHALL tener en todo momento una versión vigente de ese texto. Una tarea `personal`
SHALL poder elegir un proveedor `external` solo si el consentimiento está activo y su `textVersion` es igual a la vigente;
si la versión aceptada es anterior, el consentimiento SHALL tratarse como no dado —el contexto llega al routing con el
consentimiento en falso— y la ejecución SHALL quedarse en proveedores locales o degradar hasta que la persona acepte el
texto vigente. Cambiar la redacción del texto de consentimiento SHALL exigir una versión nueva.

#### Scenario: Consentimiento sobre el texto vigente

- **GIVEN** un usuario con el consentimiento activo y `textVersion` igual a la versión vigente
- **WHEN** se ejecuta una tarea `personal`
- **THEN** los proveedores con `external: true` SHALL ser elegibles

#### Scenario: El texto de consentimiento cambió

- **GIVEN** un usuario cuyo consentimiento se aceptó sobre una versión anterior a la vigente
- **WHEN** se ejecuta una tarea `personal`
- **THEN** ningún proveedor con `external: true` SHALL ser elegible
- **AND** la ejecución SHALL usar un proveedor local o devolver un resultado degradado

#### Scenario: Texto modificado sin versión nueva

- **GIVEN** el texto de consentimiento publicado y la versión vigente registrada con el hash del texto que le corresponde
- **WHEN** el texto cambia sin cambiar la versión
- **THEN** la comprobación automatizada del texto de consentimiento SHALL fallar nombrando la versión

### Requirement: Efecto de la revocación del consentimiento

Revocar el consentimiento SHALL tener efecto inmediato sobre toda ejecución que todavía no haya enviado nada a un proveedor,
incluidas las que ya estaban pedidas y siguen en cola: ninguna tarea `personal` suya SHALL poder elegir a partir de ese
momento un proveedor `external`, y esas ejecuciones SHALL usar proveedores locales o degradar. Una ejecución cuyo envío a un proveedor externo ya se produjo antes de la revocación SHALL completarse y su
resultado SHALL conservarse, porque descartarlo no deshace el envío. La revocación NO SHALL borrar los análisis ya
guardados: se calcularon con un permiso vigente y son del usuario. El texto del control SHALL decir exactamente eso —que
revocar detiene los análisis futuros con proveedores externos y no borra los análisis ya hechos— y SHALL nombrar la vía que
sí los borra. La revocación SHALL dejar `consentedAt` y `textVersion` sin valor.

#### Scenario: Análisis posterior a la revocación

- **GIVEN** un usuario que revoca su consentimiento
- **WHEN** pide un análisis nuevo
- **THEN** ningún proveedor con `external: true` SHALL recibir su CV
- **AND** el resultado SHALL venir de un proveedor local o ser degradado

#### Scenario: Los análisis ya hechos siguen ahí

- **GIVEN** un usuario con análisis guardados y consentimiento activo
- **WHEN** revoca el consentimiento
- **THEN** sus análisis anteriores SHALL seguir siendo consultables
- **AND** el texto del control SHALL haberle advertido de que revocar no los borra

#### Scenario: Revocación con una ejecución ya enviada

- **GIVEN** una ejecución cuyo input redactado ya se envió a un proveedor externo
- **WHEN** el usuario revoca el consentimiento antes de que llegue la respuesta
- **THEN** esa ejecución SHALL completarse y su resultado SHALL guardarse
- **AND** ninguna ejecución posterior SHALL elegir un proveedor externo
