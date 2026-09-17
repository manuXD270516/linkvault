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
con espacios, guiones o puntos) y las URLs por marcadores estables del tipo `[EMAIL_1]`, `[PHONE_1]`, `[URL_1]`. Un mismo
valor SHALL recibir el mismo marcador en toda la ejecución. Fechas, años, rangos de años (`2019-2023`, `03.2020 - 06.2022`),
montos y números sin agrupación de teléfono NO SHALL redactarse, salvo los móviles bolivianos de 8 dígitos. Los proveedores con `external: false` SHALL recibir el input sin redactar.

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

### Requirement: Nombre propio configurable

El nombre propio de una persona SHALL mantenerse sin redactar salvo que el contexto indique `redactName: true` junto con el
nombre, en cuyo caso ese nombre SHALL sustituirse por `[NAME_1]` en tareas `personal` enviadas a proveedores externos.

#### Scenario: Redacción de nombre activada

- **GIVEN** un contexto con `redactName: true` y el nombre de la persona
- **WHEN** se redacta un input que contiene ese nombre para un proveedor externo
- **THEN** el prompt enviado SHALL contener `[NAME_1]` en lugar del nombre

### Requirement: Reinyección en la salida

Los marcadores presentes en cualquier texto de la salida validada SHALL sustituirse por sus valores originales antes de
devolver el resultado. La correspondencia entre marcadores y valores SHALL existir solo en memoria durante la ejecución.

#### Scenario: Marcador en la salida

- **GIVEN** un proveedor externo cuya salida contiene `[EMAIL_1]`
- **WHEN** `runTask` devuelve el resultado
- **THEN** la salida SHALL contener el email original y no el marcador

### Requirement: Sin persistencia de prompts ni registro de secretos

El sistema NO SHALL persistir prompts renderizados en ningún almacén (ledger, caché, fixtures, logs), NO SHALL registrar en
logs las credenciales de proveedores ni las cabeceras de autorización, y los errores de proveedor NO SHALL incluir el cuerpo
de la respuesta.

#### Scenario: Log de una petición a OpenRouter

- **GIVEN** una credencial de OpenRouter configurada
- **WHEN** se ejecuta una tarea contra OpenRouter con los logs en nivel `debug`
- **THEN** ninguna línea de log SHALL contener la credencial ni el texto del prompt renderizado

#### Scenario: Entrada de caché

- **WHEN** se guarda una salida en la caché
- **THEN** la entrada SHALL contener solo la salida, el proveedor, el modelo y la versión de prompt
