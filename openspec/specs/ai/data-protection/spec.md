# ai/data-protection Specification

## Purpose

Evita que datos personales y secretos salgan del perímetro de LinkVault o queden persistidos al usar IA: cada tarea declara
si trata datos personales, los proveedores externos reciben esos datos sustituidos por marcadores, y ni los prompts
renderizados ni las credenciales se guardan o se registran.

## Requirements

### Requirement: Sensibilidad de datos por tarea

Cada tarea SHALL declarar su sensibilidad de datos como `personal` o `public`, con `personal` como valor por defecto. La
redacción de PII y la exigencia de consentimiento para proveedores externos SHALL aplicarse solo a tareas `personal`.

#### Scenario: Tarea sin sensibilidad declarada

- **GIVEN** una tarea registrada sin sensibilidad explícita
- **WHEN** se consulta su sensibilidad
- **THEN** SHALL ser `personal`

#### Scenario: Tarea pública hacia proveedor externo

- **GIVEN** una tarea `public` y un proveedor externo
- **WHEN** el input contiene una URL
- **THEN** el prompt enviado SHALL contener la URL original

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

### Requirement: Nombre propio configurable

El nombre propio de una persona SHALL mantenerse sin redactar salvo que el contexto indique `redactName: true` junto con el
nombre, en cuyo caso ese nombre SHALL sustituirse por `[NAME_1]` en tareas `personal` enviadas a proveedores externos.

Ese interruptor nace activado, de modo que el detector de nombre se aplica **a todo el mundo por defecto** y una coincidencia
de más no es una rareza sino el caso corriente. En Bolivia `Paz`, `Cruz`, `Flores`, `Campos` y `Vargas` son apellidos
corrientes **y a la vez ciudades, nombres de empresa y palabras comunes**: sustituirlos donde no nombran a la persona
destruye la señal de ubicación —que decide remoto o presencial— y la del empleador, y lo hace **sin que se note**, porque el
informe sale igual, solo que peor. Por eso el detector SHALL cumplir estas reglas de precisión:

1. **Límites de palabra.** Toda coincidencia SHALL empezar y terminar en límite de palabra, sin distinguir mayúsculas de
   minúsculas. `Paz` NO SHALL coincidir dentro de `Pazos`, `Capaz` ni `Cruzada`, y `Flores` NO SHALL coincidir dentro de
   `Floresta`.
2. **El nombre completo siempre; los fragmentos, solo si pasan las exclusiones.** El nombre tal como lo declara el contexto
   SHALL sustituirse en cada aparición completa. Un **fragmento suelto** del nombre (un nombre de pila o un apellido por
   separado) SHALL sustituirse solo si no cae en ninguna de las tres exclusiones siguientes.
3. **Topónimo.** Un fragmento que forme parte de un topónimo NO SHALL sustituirse: ni cuando va precedido inmediatamente de
   una partícula de topónimo (`La`, `Las`, `El`, `Los`, `San`, `Santa`, `Villa`, `Puerto`), ni cuando forma parte de un
   topónimo de la lista cerrada de ciudades y departamentos que el sistema reconoce (`La Paz`, `El Alto`, `Santa Cruz`,
   `Santa Cruz de la Sierra`, `Cochabamba`, `Oruro`, `Potosí`, `Tarija`, `Sucre`, `Chuquisaca`, `Beni`, `Trinidad`,
   `Pando`, `Cobija`, `Montero`).
4. **Nombre de organización.** Un fragmento que caiga dentro del nombre de una organización NO SHALL sustituirse. SHALL
   considerarse nombre de organización el fragmento de la misma línea que lleve un designador societario (`S.A.`, `SA`,
   `S.R.L.`, `SRL`, `Ltda.`, `S.A.S.`, `Inc.`, `LLC`, `& Cía.`) o que vaya encabezado por una palabra de organización
   (`Banco`, `Constructora`, `Consultora`, `Cooperativa`, `Empresa`, `Grupo`, `Fundación`, `Universidad`, `Colegio`,
   `Instituto`, `Clínica`, `Hospital`, `Ministerio`, `Agencia`, `Editorial`).
5. **Palabra corriente.** Un fragmento escrito **en minúscula** que coincida con una palabra corriente del idioma NO SHALL
   sustituirse: `paz`, `cruz`, `flores`, `campos`, `torres`, `luna`, `rosa`, `león`, `prado`, `castillo`, `nieves`, `mar`.

**Desempate declarado: cuando un apellido coincide con una ciudad, prevalece la ciudad.** Esa aparición NO SHALL
sustituirse, aunque eso deje el apellido visible ahí. La razón es asimétrica y deliberada: el nombre **no aporta ninguna
señal de encaje**, así que perderlo no cuesta nada y conservarlo en un topónimo cuesta poco; la ubicación sí la aporta, y
perderla estropea el análisis en silencio. La aparición que de verdad identifica —el nombre completo, en el encabezado del
CV— queda cubierta por la regla 2. La misma preferencia SHALL aplicarse a los otros dos casos: ante la duda entre redactar
un fragmento del nombre y conservar un topónimo, el nombre de un empleador o una palabra corriente, NO SHALL redactarse.

Estas exclusiones SHALL aplicarse **solo al detector de nombre**. Los demás detectores (email, teléfono, URL, dirección y
documento) NO SHALL verse afectados: una dirección que contenga el apellido de la persona SHALL seguir sustituyéndose por
`[ADDRESS_n]` según sus propias reglas.

#### Scenario: Redacción de nombre activada

- **GIVEN** un contexto con `redactName: true` y el nombre de la persona
- **WHEN** se redacta un input que contiene ese nombre para un proveedor externo
- **THEN** el prompt enviado SHALL contener `[NAME_1]` en lugar del nombre

#### Scenario: El apellido coincide con la ciudad

- **GIVEN** un contexto con `redactName: true` y el nombre `Ana Paz Flores`, y un CV cuyo encabezado dice `Ana Paz Flores` y cuya línea de ubicación dice `La Paz, Bolivia — disponible para remoto`
- **WHEN** se redacta para un proveedor externo
- **THEN** el encabezado SHALL contener `[NAME_1]`
- **AND** la línea de ubicación SHALL seguir diciendo `La Paz, Bolivia` sin ningún marcador

#### Scenario: Santa Cruz sigue siendo Santa Cruz

- **GIVEN** un contexto con `redactName: true` y el nombre `Beto Cruz Vargas`, y un CV que menciona `Santa Cruz de la Sierra` y `traslado a Santa Cruz en 2021`
- **WHEN** se redacta para un proveedor externo
- **THEN** las dos menciones SHALL permanecer sin cambios
- **AND** NO SHALL aparecer ningún `[NAME_n]` en ellas

#### Scenario: El apellido dentro del nombre del empleador

- **GIVEN** un contexto con `redactName: true` y el nombre `Ana Paz Flores`, y un CV con la experiencia `Constructora Flores S.R.L. — Jefa de proyecto` y `Banco Los Andes S.A.`
- **WHEN** se redacta para un proveedor externo
- **THEN** `Constructora Flores S.R.L.` SHALL permanecer sin cambios, porque perder el empleador destruye la señal de experiencia
- **AND** el input enviado SHALL seguir conteniendo `Flores` dentro de ese nombre de empresa

#### Scenario: Límite de palabra

- **GIVEN** un contexto con `redactName: true` y el nombre `Ana Paz Flores`, y un input con `Pazos`, `Capaz de liderar`, `Floresta Urbana` y `Cruzada comercial`
- **WHEN** se redacta para un proveedor externo
- **THEN** esos cuatro textos SHALL permanecer sin cambios

#### Scenario: La palabra corriente en minúscula

- **GIVEN** un contexto con `redactName: true` y el nombre `Luis Campos Cruz`, y un input con `normalicé 40 campos del formulario` y `validación cruz de inventarios`
- **WHEN** se redacta para un proveedor externo
- **THEN** esos textos SHALL permanecer sin cambios

#### Scenario: La dirección con el apellido dentro se sigue redactando

- **GIVEN** un contexto con `redactName: true` y el nombre `Ana Paz Flores`, y una línea `Av. Las Flores 220, Zona Sur`
- **WHEN** se redacta para un proveedor externo
- **THEN** la línea SHALL sustituirse por `[ADDRESS_1]` según las reglas de dirección
- **AND** NO SHALL quedar ningún fragmento suelto de la línea en el input enviado

### Requirement: Reinyección en la salida

Los marcadores presentes en cualquier texto de la salida validada SHALL sustituirse por sus valores originales antes de
devolver el resultado, incluidos los de nombre, dirección y documento, y también dentro de `suggestions[].after`: la
redacción protege el dato frente al proveedor, no frente a su dueño, de modo que la persona SHALL recibir siempre el texto
con sus valores reales aunque `redactName` esté activado. Una salida que, después de reponer los valores, conserve en algún
texto un fragmento con forma de marcador —el caso de un marcador que la ejecución no emitió y que el proveedor se inventó—
SHALL tratarse como salida inválida y SHALL recorrer el **mismo camino** que cualquier otra salida inválida: una reparación
con el mismo proveedor y, si vuelve a fallar, el proveedor siguiente de la cadena; agotada la cadena, un resultado
degradado. Esta comprobación SHALL ser observable desde fuera del módulo y NO SHALL depender de en qué capa se realice.
Ningún texto que contenga un marcador literal SHALL devolverse al llamador, persistirse ni escribirse en un fixture. La
correspondencia entre marcadores y valores SHALL existir solo en memoria durante la ejecución y SHALL descartarse al
terminar, tanto si termina con éxito como si falla.

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
- **AND** el mismo proveedor SHALL recibir una petición de reparación, como con cualquier otra salida inválida

#### Scenario: El proveedor insiste con el marcador inventado

- **GIVEN** un proveedor cuya salida trae `[ADDRESS_3]` también después de la reparación
- **WHEN** queda otro proveedor en la cadena
- **THEN** ese proveedor SHALL recibir la petición
- **AND** si ninguno devuelve una salida sin marcadores inventados, el resultado SHALL ser degradado

#### Scenario: Un marcador inventado nunca llega al usuario ni al disco

- **GIVEN** una cadena en la que todos los proveedores devuelven `[ADDRESS_3]` dentro de `suggestions[0].after`
- **WHEN** termina la ejecución
- **THEN** ningún texto devuelto, persistido o escrito en un fixture SHALL contener `[ADDRESS_3]`

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

- **GIVEN** una tarea `public` con el resultado declarado cacheable
- **WHEN** se guarda una salida en la caché
- **THEN** la entrada SHALL contener solo la salida, el proveedor, el modelo y la versión de prompt

#### Scenario: Log de un análisis de CV

- **GIVEN** un análisis de encaje con los logs en nivel `debug`
- **WHEN** termina con éxito y cuando termina con error de proveedor
- **THEN** ninguna línea de log SHALL contener texto del CV, ni redactado ni sin redactar
- **AND** las líneas SHALL identificar la ejecución solo por tarea, proveedor, modelo, versión de prompt y clave

### Requirement: El resultado de una tarea personal no se cachea

Cada tarea SHALL declarar si su resultado es cacheable, y una tarea `personal` NO SHALL ser cacheable: declarar cacheable
una tarea `personal` SHALL ser un error de programación que impida el arranque, nombrando la tarea. El resultado de una
tarea `personal` NO SHALL escribirse en ninguna caché compartida entre procesos ni leerse de ella, ni siquiera cuando la
salida ya viene con los valores repuestos: precisamente entonces contiene el texto del CV y el nombre, la dirección y el
documento reales que la redacción protege frente al proveedor, y ninguna limpieza de datos personales alcanza esa entrada
cuando la persona borra su CV. En consecuencia, dos ejecuciones de una tarea `personal` con la misma identidad de ejecución
SHALL contactar a un proveedor las dos veces, y una tarea `personal` NO SHALL devolver nunca `cached: true`.

#### Scenario: Dos ejecuciones idénticas de una tarea personal

- **GIVEN** una ejecución exitosa de una tarea `personal` con proveedores reales
- **WHEN** se ejecuta de nuevo la misma tarea con el mismo input y el mismo idioma de salida
- **THEN** un proveedor SHALL recibir la petición por segunda vez
- **AND** el resultado SHALL devolverse con `cached: false`

#### Scenario: La caché nunca recibe la salida de una tarea personal

- **GIVEN** un almacén de caché compartido disponible
- **WHEN** una tarea `personal` termina con éxito y su salida lleva los valores reinyectados
- **THEN** el almacén NO SHALL recibir ninguna escritura para esa ejecución
- **AND** NO SHALL recibir ninguna lectura para esa identidad de ejecución

#### Scenario: Tarea personal declarada cacheable

- **GIVEN** una tarea registrada como `personal` y con el resultado declarado cacheable
- **WHEN** arranca el proceso que la registra
- **THEN** el arranque SHALL fallar con un error de programación que nombra la tarea
- **AND** ninguna ejecución SHALL llegar a producirse

#### Scenario: Una tarea pública sigue cacheando

- **GIVEN** una tarea `public` con el resultado declarado cacheable
- **WHEN** se ejecuta dos veces con el mismo input
- **THEN** la segunda SHALL devolver la salida desde la caché sin contactar a ningún proveedor

### Requirement: Detección de dirección postal

El sistema SHALL considerar dirección postal todo fragmento de una misma línea que empiece por un indicador de vía o de
domicilio (`Calle`, `C/`, `Avenida`, `Av.`, `Pasaje`, `Psje.`, `Camino`, `Carretera`, `Km`, `Zona`, `Barrio`,
`Urbanización`, `Condominio`, `Edificio`, `Torre`, `Manzana`, `Mz`, `Nro.`, `N°`, `Piso`, `Depto.`), sin distinguir
mayúsculas ni la presencia del punto de abreviatura, y siga con al menos un token más; el fragmento SHALL terminar en el
final de la línea o en el primer separador fuerte (`|`, `·`, `—`, `–`, tabulación) que aparezca después.

Un indicador SHALL contar solo si cumple las tres condiciones siguientes, y NO SHALL contar si falla alguna:

1. Va **precedido de inicio de línea o de un separador** (espacio, coma, punto y coma, dos puntos, tabulación o separador
   fuerte); un indicador pegado al texto anterior no cuenta.
2. Va **seguido de un separador**, y no de otra letra o símbolo pegado: `C/` SHALL exigir un espacio después, de modo que
   `C/C++` no es un indicador.
3. Hay **al menos un dígito** después del indicador dentro del mismo fragmento. Los indicadores que nombran un número o
   una subdivisión numerada (`Km`, `Zona`, `Barrio`, `Manzana`, `Mz`, `Torre`, `Nro.`, `N°`, `Piso`, `Depto.`) SHALL
   exigir además que ese dígito sea **lo primero que los siga**, separado como mucho por un espacio, un punto de
   abreviatura o dos puntos.

`#` NO SHALL ser indicador por sí solo: SHALL contar únicamente escrito como `#` seguido inmediatamente de dígitos y
precedido de inicio de línea o separador.

NO SHALL considerarse dirección el nombre de una ciudad, departamento, país o nacionalidad por sí solos, ni un indicador de
vía que forme parte de un valor ya sustituido por otro marcador, ni un lenguaje de programación, una tecnología o una
habilidad: `C#`, `C/C++`, `F#` y `.NET` SHALL permanecer sin cambios.

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

#### Scenario: Un lenguaje de programación no es una dirección

- **GIVEN** una línea `Lenguajes: C#, C/C++, F#, .NET 8, Python 3.11, Km de código en producción`
- **WHEN** se redacta para un proveedor externo
- **THEN** la línea SHALL permanecer sin cambios
- **AND** el input enviado SHALL seguir conteniendo `C#` y `C/C++`

#### Scenario: Indicador numérico en prosa

- **GIVEN** un input con `Zona de influencia: 4 departamentos`, `N° de empleados a cargo: 12`, `Torre de control de calidad` y una línea de ubicación `Zona Sur, La Paz`
- **WHEN** se redacta para un proveedor externo
- **THEN** esos textos SHALL permanecer sin cambios, porque el indicador no va seguido del número que lo convertiría en domicilio
- **AND** `Zona 12` dentro de la misma línea que un indicador de vía SHALL seguir formando parte de `[ADDRESS_1]`

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

### Requirement: Contenido obligatorio del texto de consentimiento

El texto de consentimiento vigente SHALL decir, además de qué valores se sustituyen por marcadores antes de enviar el CV,
las cuatro cosas siguientes, y una comprobación automatizada SHALL fallar nombrando la que falte:

1. Que **el resto del CV se envía tal cual**: empresas, cargos, formación, fechas y logros viajan sin sustituir.
2. Que ese resto **puede identificar a la persona** aunque los valores sustituidos no viajen.
3. Que **no puede comprobarse qué hace el proveedor con lo enviado** ni garantizarse que no lo conserve.
4. Cómo se revoca el permiso y qué efecto tiene revocarlo.

El texto NO SHALL afirmar ni sugerir que lo enviado va anonimizado, despersonalizado o no identificable, ni usar esas
palabras ni equivalentes referidas a lo que sale hacia el proveedor; la comprobación automatizada SHALL fallar si aparecen.
Enumerar únicamente lo que se sustituye, sin los cuatro puntos anteriores, NO SHALL considerarse texto válido: el silencio
sobre el resto del CV invita a deducir un anonimato que no existe.

Y la enumeración SHALL ser **una sola en todo el producto**. **Toda** enumeración de lo que se sustituye que el producto
muestre —en cualquier pantalla, diálogo, aviso o ayuda, y en cualquier idioma publicado— SHALL listar exactamente los mismos
tipos, sin omitir ninguno ni añadir otros. Tres pantallas con tres listas distintas no describen tres redacciones distintas:
describen una sola, dos veces mal, y quien lee no puede saber cuál de las tres está leyendo. Reglas:

- La lista canónica SHALL **derivarse de los tipos que el redactor sustituye** para proveedores externos, no escribirse a
  mano en cada pantalla. Añadir un detector nuevo sin actualizar una enumeración SHALL hacer fallar la comprobación.
- Si un tipo se sustituye solo cuando un interruptor está activado —el caso del nombre propio—, toda enumeración SHALL
  nombrarlo igualmente y SHALL decir en qué estado nace el interruptor. Callarlo porque «depende» deja a la persona
  creyendo que su nombre viaja cuando no viaja, o al revés.
- La comprobación automatizada SHALL recorrer un **inventario declarado** de todas las enumeraciones que el producto
  publica, y SHALL fallar nombrando la pantalla y el tipo que falta o que sobra. Cubrir solo una de ellas NO SHALL bastar:
  una comprobación que mira una pantalla y deja dos sin mirar da por buenas justo las que se desvían.

Los textos concretos de cada pantalla los fijan las capacidades de `web/*`; esta capacidad fija la obligación y la
comprobación que la sostiene.

#### Scenario: Texto que solo enumera lo que se sustituye

- **GIVEN** un texto de consentimiento que dice qué se sustituye y no dice nada del resto del CV
- **WHEN** se ejecuta la comprobación automatizada del texto
- **THEN** SHALL fallar nombrando los puntos que faltan
- **AND** esa versión del texto NO SHALL poder publicarse como vigente

#### Scenario: Texto que promete anonimato

- **GIVEN** un texto de consentimiento que dice que el CV se envía «de forma anónima»
- **WHEN** se ejecuta la comprobación automatizada del texto
- **THEN** SHALL fallar nombrando la formulación de anonimato encontrada

#### Scenario: Texto completo

- **GIVEN** un texto que enumera lo sustituido, advierte de que el resto del CV se envía tal cual y puede identificar a la persona, dice que no puede comprobarse qué hace el proveedor con lo enviado y explica cómo se revoca
- **WHEN** se ejecuta la comprobación automatizada del texto
- **THEN** SHALL pasar

#### Scenario: Una pantalla enumera de menos

- **GIVEN** el texto de consentimiento que nombra la URL entre lo sustituido y otra pantalla que enumera lo mismo sin nombrarla
- **WHEN** se ejecuta la comprobación automatizada
- **THEN** SHALL fallar nombrando la pantalla que la omite y el tipo `url`

#### Scenario: Una enumeración calla el nombre propio

- **GIVEN** una enumeración que no nombra el nombre propio, pese a que el interruptor que lo sustituye nace activado
- **WHEN** se ejecuta la comprobación automatizada
- **THEN** SHALL fallar nombrando la pantalla y el tipo `name`
- **AND** SHALL exigir que la enumeración diga en qué estado nace el interruptor

#### Scenario: Un detector nuevo que las pantallas no nombran

- **GIVEN** el redactor con un tipo nuevo entre los que sustituye y una sola de las enumeraciones publicadas actualizada
- **WHEN** se ejecuta la comprobación automatizada
- **THEN** SHALL fallar nombrando cada pantalla que no lo lista
- **AND** NO SHALL bastar con que la enumeración del texto de consentimiento esté al día

#### Scenario: Una traducción que enumera distinto

- **GIVEN** una enumeración cuya versión en español lista los seis tipos y cuya traducción inglesa lista cinco
- **WHEN** se ejecuta la comprobación automatizada
- **THEN** SHALL fallar nombrando el idioma, la pantalla y el tipo que falta

### Requirement: Efecto de la revocación del consentimiento

Revocar el consentimiento SHALL tener efecto inmediato sobre toda ejecución que todavía no haya enviado nada a un proveedor,
incluidas las que ya estaban pedidas y siguen en cola: ninguna tarea `personal` suya SHALL poder elegir a partir de ese
momento un proveedor `external`, y esas ejecuciones SHALL usar proveedores locales o degradar. Una ejecución cuyo envío a un proveedor externo ya se produjo antes de la revocación SHALL completarse y su
resultado SHALL conservarse, porque descartarlo no deshace el envío. La revocación NO SHALL borrar los análisis ya
guardados: se calcularon con un permiso vigente y son del usuario. El texto del control de revocación SHALL decir
exactamente eso —que revocar detiene los análisis futuros con proveedores externos y no borra los análisis ya hechos— y
SHALL nombrar la vía que sí los borra. Ese texto SHALL quedar cubierto por la misma comprobación automatizada que el texto
de consentimiento, que SHALL fallar si no dice que revocar no borra los análisis ya hechos o si no nombra la vía que sí los
borra. La revocación SHALL dejar `consentedAt` y `textVersion` sin valor.

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

#### Scenario: Texto de revocación que calla el borrado

- **GIVEN** un texto del control de revocación que dice que se detienen los análisis futuros y no dice qué pasa con los ya hechos
- **WHEN** se ejecuta la comprobación automatizada del texto
- **THEN** SHALL fallar nombrando lo que falta
- **AND** esa versión del texto NO SHALL poder publicarse como vigente

#### Scenario: Revocación con una ejecución ya enviada

- **GIVEN** una ejecución cuyo input redactado ya se envió a un proveedor externo
- **WHEN** el usuario revoca el consentimiento antes de que llegue la respuesta
- **THEN** esa ejecución SHALL completarse y su resultado SHALL guardarse
- **AND** ninguna ejecución posterior SHALL elegir un proveedor externo

### Requirement: Secretos BYOK fuera de logs y respuestas

El sistema NO SHALL escribir en logs la clave en claro, el material descifrado, `AI_VAULT_KEY`, ni el `ciphertext` del
vault. Las respuestas HTTP de gestión de claves NO SHALL incluir más que `vendor`, `keyHint`, timestamps y el **estado
de disponibilidad** de ese vendor. El redactor de logs de api y worker SHALL cubrir al menos las claves de objeto
`apiKey`, `authorization`, `AI_VAULT_KEY`, `ciphertext` y `vaultKey`.

El estado de disponibilidad SHALL ser **un hecho sobre la configuración del servidor**, no sobre la clave de nadie: dice
si ese vendor puede construirse en esta instancia, y NO SHALL revelar ningún valor de configuración —ni el modelo, ni
un endpoint, ni la existencia o ausencia de una credencial de plataforma—. Se añade a la lista porque la interfaz tiene
que distinguir "no forzamos `data_collection: deny`" de "este vendor no está disponible", y deducirlo en el cliente
obligaría a reimplementar allí el criterio del servidor: dos verdades que divergirían el día que una cambiara.

El límite sigue siendo **cerrado**. Ampliarlo con un campo no lo convierte en una lista abierta: cualquier otro dato
sobre una clave o sobre la configuración de IA sigue estando fuera, y la prohibición sobre la clave en claro y el
`ciphertext` queda **intacta**.

#### Scenario: Log de error de proveedor

- **GIVEN** un BYOK que falla con error HTTP del vendor
- **WHEN** se registra el fallo
- **THEN** el mensaje de log NO SHALL contener la apiKey ni un Bearer token completo

#### Scenario: La disponibilidad viaja, el secreto no

- **GIVEN** una persona con una clave BYOK guardada para un vendor
- **WHEN** consulta sus claves por HTTP
- **THEN** la respuesta SHALL traer el vendor, su pista, sus timestamps y su estado de disponibilidad
- **AND** NO SHALL traer la clave en claro ni el `ciphertext` del vault

#### Scenario: La disponibilidad no filtra la configuración

- **GIVEN** un vendor que esta instancia no puede construir por su configuración
- **WHEN** se consulta el estado de ese vendor
- **THEN** la respuesta SHALL decir que no está disponible
- **AND** NO SHALL decir qué valor de configuración falta ni cuál tiene, ni revelar credenciales de plataforma

#### Scenario: Ampliar el límite no lo abre

- **GIVEN** la lista de lo que una respuesta de gestión de claves puede incluir
- **WHEN** se añade un dato que no sea vendor, pista, timestamp o disponibilidad
- **THEN** SHALL considerarse fuera del límite
- **AND** la ampliación de este change NO SHALL leerse como permiso para devolver cualquier otro dato
