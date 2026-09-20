## ADDED Requirements

### Requirement: Pantalla de mi CV

`/mi-cv` SHALL ser una ruta con sesión, cargada de forma diferida, accesible desde la barra de navegación con el
nombre "Mi CV". SHALL mostrar las versiones guardadas y las acciones de subir, marcar por defecto, descargar y
eliminar.

Sin ningún CV SHALL mostrar "Sube tu CV y LinkVault podrá comparar tus habilidades con cada vacante." junto al botón de
subir. Mientras se carga la lista SHALL mostrar un estado de carga, y si la petición falla, el error con "Reintentar".

#### Scenario: Entrar sin CV

- **GIVEN** Ana con sesión y sin ningún CV
- **WHEN** abre `/mi-cv`
- **THEN** SHALL ver el texto de bienvenida y el botón de subir
- **AND** NO SHALL ver ninguna tarjeta de versión

#### Scenario: Ruta con sesión

- **GIVEN** una persona sin sesión
- **WHEN** abre `/mi-cv`
- **THEN** SHALL ir a `/login` y volver a `/mi-cv` tras entrar

#### Scenario: La lista no carga

- **GIVEN** la API devolviendo `500` al pedir la lista
- **WHEN** Ana abre `/mi-cv`
- **THEN** SHALL ver el error con "Reintentar"
- **AND** al pulsar "Reintentar" SHALL volver a pedirla

### Requirement: Subir el CV con progreso

El SPA SHALL permitir elegir un archivo o soltarlo sobre la zona de subida, aceptando `.pdf` y `.docx`, y SHALL enviarlo
como `multipart/form-data` mostrando el **progreso de la subida**. Mientras sube, el control SHALL quedar deshabilitado
con `aria-busy` y NO SHALL aceptar una segunda subida.

Antes de enviar SHALL comprobar la extensión y el tamaño para dar respuesta inmediata, y SHALL tratar la respuesta de la
API como la autoridad: un `413` o un `415` se muestran igual aunque la comprobación local hubiera pasado. Terminada la
subida, la lista SHALL incluir la versión nueva sin recargar la página.

#### Scenario: Subida con progreso

- **WHEN** Ana elige un PDF de 2 MB
- **THEN** SHALL ver el progreso avanzar
- **AND** al terminar SHALL ver la versión nueva arriba de la lista, marcada como la de por defecto

#### Scenario: Archivo que no admitimos, detectado en el SPA

- **WHEN** Ana elige un `.odt`
- **THEN** SHALL ver "Solo aceptamos PDF o DOCX" y NO SHALL enviarse ninguna petición

#### Scenario: Archivo demasiado grande, detectado en el SPA

- **WHEN** Ana elige un archivo de 7 MB
- **THEN** SHALL ver "Ese archivo pesa más de 5 MB" y NO SHALL enviarse ninguna petición

#### Scenario: La API rechaza lo que el SPA dejó pasar

- **GIVEN** un archivo con extensión `.pdf` que no es un PDF
- **WHEN** Ana lo sube y la API responde `415`
- **THEN** SHALL ver "Solo aceptamos PDF o DOCX" y la lista NO SHALL cambiar

#### Scenario: Tope de versiones

- **GIVEN** Ana con 5 CV guardados
- **WHEN** intenta subir otro y la API responde `409 too_many_cvs`
- **THEN** SHALL ver "Guardamos hasta 5 CV. Elimina uno para subir otro."

#### Scenario: Límite alcanzado

- **GIVEN** la API respondiendo `429` con `Retry-After`
- **WHEN** Ana sube un CV
- **THEN** SHALL ver el mensaje de límite con la espera y la lista NO SHALL cambiar

### Requirement: Lista de versiones con su estado

Cada versión SHALL mostrarse en una tarjeta, de la más reciente a la más antigua, con su número de versión, el nombre
del archivo, su tamaño, su fecha y un distintivo del estado de la lectura:

- `pending`: "Estamos leyendo tu CV…";
- `extracted`: "Listo · N caracteres leídos";
- `failed` con `unreadable_file`: "No pudimos abrir este archivo. Puede estar dañado o protegido con contraseña.";
- `failed` con `no_text`: "Este archivo no tiene texto: parece un escaneo o una imagen. Sube el PDF original o
  expórtalo desde tu editor.";
- `failed` con `internal_error`: "No pudimos leerlo ahora. Vuelve a subirlo en un rato.".

La versión de por defecto SHALL llevar una marca visible. NO SHALL mostrarse en ningún sitio el texto del CV.

#### Scenario: Tres versiones

- **GIVEN** Ana con las versiones 1, 2 y 3
- **WHEN** abre `/mi-cv`
- **THEN** SHALL verlas de la 3 a la 1, con la 3 marcada como la de por defecto

#### Scenario: Un CV que no se pudo leer

- **GIVEN** una versión en `failed` con motivo `no_text`
- **WHEN** Ana la mira
- **THEN** SHALL ver el mensaje del escaneo y las acciones de descargar y eliminar

### Requirement: Mientras se lee, la pantalla se actualiza sola

Mientras alguna versión esté `pending`, el SPA SHALL volver a pedir la lista cada 2 segundos durante como mucho 60
segundos, y SHALL detener el sondeo en cuanto ninguna lo esté o al salir de la pantalla. Agotado ese tiempo sin
resolverse, SHALL mostrar "Sigue en proceso" con un botón "Actualizar".

#### Scenario: La lectura termina

- **GIVEN** una versión recién subida en "Estamos leyendo tu CV…"
- **WHEN** la extracción termina
- **THEN** la tarjeta SHALL pasar a "Listo · N caracteres leídos" sin recargar la página

#### Scenario: El sondeo se detiene

- **GIVEN** todas las versiones ya leídas
- **WHEN** pasan 10 segundos
- **THEN** NO SHALL hacerse ninguna petición más

#### Scenario: Se acabó la paciencia

- **GIVEN** una versión que sigue `pending` tras 60 segundos
- **WHEN** vence el tiempo
- **THEN** SHALL verse "Sigue en proceso" con "Actualizar", y el sondeo SHALL haberse detenido

#### Scenario: Salir de la pantalla

- **GIVEN** una versión `pending` y el sondeo en marcha
- **WHEN** Ana navega a otra ruta
- **THEN** NO SHALL hacerse ninguna petición más

### Requirement: Marcar el CV por defecto desde el SPA

La acción "Usar este" SHALL aparecer en las versiones que no son la de por defecto y SHALL llamar a la API **sin pedir
confirmación**: no destruye nada. La marca SHALL moverse en la lista al responder, y si la API falla SHALL volver donde
estaba con el mensaje de error.

#### Scenario: Cambiar de versión

- **GIVEN** Ana con la versión 3 marcada
- **WHEN** pulsa "Usar este" en la versión 1
- **THEN** la marca SHALL pasar a la versión 1 y desaparecer de la 3

#### Scenario: La API falla al marcar

- **GIVEN** la API devolviendo `500`
- **WHEN** Ana pulsa "Usar este"
- **THEN** la marca SHALL quedarse donde estaba y SHALL verse el error

#### Scenario: No se ofrece en el que ya lo es

- **WHEN** Ana mira la versión marcada
- **THEN** NO SHALL ver "Usar este" en esa tarjeta

### Requirement: Descargar y eliminar desde el SPA

"Descargar" SHALL traer el archivo original con su nombre. "Eliminar" SHALL pedir confirmación nombrando el archivo y
avisando de que "el archivo se borra y no se puede recuperar"; si es el de por defecto, SHALL añadir "Pasará a usarse tu
CV más reciente". Confirmado, la versión SHALL desaparecer de la lista sin recargar; cancelado, NO SHALL ocurrir nada.

#### Scenario: Eliminar una versión

- **GIVEN** Ana con dos versiones
- **WHEN** elimina la más antigua y confirma
- **THEN** SHALL quedar una sola tarjeta en la lista

#### Scenario: Eliminar la marcada

- **GIVEN** Ana con las versiones 1 y 2, y la 2 marcada
- **WHEN** elimina la 2
- **THEN** la confirmación SHALL avisar de que pasará a usarse su CV más reciente
- **AND** tras confirmar, la versión 1 SHALL quedar marcada

#### Scenario: Cancelar el borrado

- **WHEN** Ana abre la confirmación y cancela
- **THEN** la lista SHALL quedar igual y NO SHALL enviarse ninguna petición

#### Scenario: Descargar

- **WHEN** Ana pulsa "Descargar"
- **THEN** SHALL obtener el archivo con el nombre que subió

### Requirement: Textos de mi CV en español e inglés

Todos los textos de esta pantalla —bienvenida, estados de la lectura, acciones, confirmaciones y errores— SHALL estar
marcados para traducción y traducidos al inglés, con el español como idioma por defecto.

#### Scenario: Traducciones completas

- **WHEN** se revisan los textos de `/mi-cv`
- **THEN** cada uno SHALL tener su unidad de traducción con su versión en inglés
