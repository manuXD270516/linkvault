## ADDED Requirements

### Requirement: Pantalla de mi CV

`/mi-cv` SHALL ser una ruta con sesión, cargada de forma diferida, accesible desde la barra de navegación con el
nombre "Mi CV". SHALL mostrar los CV guardados y las acciones de subir, marcar, ver lo leído y eliminar. En la pantalla
SHALL decirse "CV guardado"; el número de versión NO SHALL usarse para identificarlos.

SHALL mostrar siempre, junto a la subida, la línea **"Tu CV solo lo ves tú. No sale de LinkVault; cuando analicemos
vacantes te pediremos permiso antes."**

Sin ningún CV SHALL mostrar "Sube tu CV y LinkVault podrá comparar tus habilidades con cada vacante." junto al botón de
subir. Mientras se carga la lista SHALL mostrar un estado de carga, y si la petición falla, el error con "Reintentar".

#### Scenario: Entrar sin CV

- **GIVEN** Ana con sesión y sin ningún CV
- **WHEN** abre `/mi-cv`
- **THEN** SHALL ver el texto de bienvenida, la línea de privacidad y el botón de subir
- **AND** NO SHALL ver ninguna tarjeta de CV

#### Scenario: La promesa está donde se pide el dato

- **WHEN** Ana abre `/mi-cv`
- **THEN** la línea de privacidad SHALL verse sin desplazarse ni abrir nada

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

El **botón "Subir CV" SHALL ser la vía principal**, con una zona para soltar el archivo como alternativa secundaria. El
selector SHALL aceptar `.pdf` y `.docx` **y también sus tipos MIME**, para que el selector de archivos de un móvil no
deje los documentos en gris.

El SPA SHALL enviar el archivo como `multipart/form-data` mostrando el **progreso de la subida**; mientras sube, el
control SHALL quedar deshabilitado con `aria-busy` y NO SHALL aceptar una segunda subida.

Antes de enviar SHALL comprobar la extensión y el tamaño para dar respuesta inmediata, y SHALL tratar la respuesta de la
API como la autoridad: un `413` o un `415` se muestran igual aunque la comprobación local hubiera pasado. Terminada la
subida, la lista SHALL incluir el CV nuevo sin recargar la página.

#### Scenario: Subida con progreso

- **WHEN** Ana elige un PDF de 2 MB
- **THEN** SHALL ver el progreso avanzar
- **AND** al terminar SHALL ver el CV nuevo arriba de la lista, marcado como el que se usará

#### Scenario: El botón manda

- **WHEN** Ana abre la pantalla
- **THEN** SHALL ver un botón de subir como acción principal, sin tener que descubrir que se puede soltar un archivo

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

#### Scenario: Tope de CV guardados

- **GIVEN** Ana con 5 CV guardados
- **WHEN** intenta subir otro y la API responde `409 too_many_cvs`
- **THEN** SHALL ver "Guardamos hasta 5 CV. Elimina uno para subir otro; si alguno no se pudo leer, empieza por ese."

#### Scenario: Límite alcanzado

- **GIVEN** la API respondiendo `429` con `Retry-After`
- **WHEN** Ana sube un CV
- **THEN** SHALL ver el mensaje de límite con la espera y la lista NO SHALL cambiar

### Requirement: Lista de CV guardados con su estado

Cada CV SHALL mostrarse en una tarjeta, del más reciente al más antiguo, identificado por **su nombre de archivo y su
fecha**, con su tamaño. El número de versión NO SHALL mostrarse.

Cada estado SHALL terminar en una acción o en una explicación de qué hacer:

- `pending`: "Estamos leyendo tu CV…";
- `extracted`: "Listo · tu CV se leyó bien", con la acción "Ver lo que leímos";
- `failed` con `unreadable_file`: "No pudimos abrir este archivo. Si tiene contraseña, quítasela y vuelve a subirlo.";
- `failed` con `no_text`: "Este archivo no tiene texto: parece un escaneo o una imagen. Sube el PDF original o
  expórtalo desde tu editor.";
- `failed` con `internal_error`: "No pudimos leerlo ahora. Vuelve a subirlo en un rato.".

El número de caracteres leídos NO SHALL mostrarse, y el texto del CV NO SHALL aparecer en la lista.

#### Scenario: Tres CV guardados

- **GIVEN** Ana con tres CV
- **WHEN** abre `/mi-cv`
- **THEN** SHALL verlos del más nuevo al más viejo, cada uno con su nombre y su fecha
- **AND** NO SHALL ver ningún número de versión ni ningún recuento de caracteres

#### Scenario: Un CV que no se pudo leer

- **GIVEN** un CV en `failed` con motivo `no_text`
- **WHEN** Ana lo mira
- **THEN** SHALL ver el mensaje del escaneo con lo que puede hacer, y la acción de eliminar

#### Scenario: Un CV protegido con contraseña

- **GIVEN** un CV en `failed` con motivo `unreadable_file`
- **WHEN** Ana lo mira
- **THEN** el mensaje SHALL decirle que le quite la contraseña y lo vuelva a subir

### Requirement: La marca dice para qué sirve

El CV marcado SHALL identificarse con el texto **"Este usaremos para comparar con las vacantes"**, y la acción que
mueve la marca SHALL llamarse "Usar este" y aparecer solo en los que no la tienen. Llamar a la API NO SHALL pedir
confirmación: no destruye nada. La marca SHALL moverse al responder, y si la API falla SHALL volver donde estaba con el
mensaje de error.

Si el CV marcado está `failed`, bajo él SHALL verse **"No pudimos leer este CV: no servirá para analizar vacantes"** y,
si hay otro CV en `extracted`, la acción **"Usar el que sí se leyó"**, que lo marca en un clic.

#### Scenario: Cambiar de CV

- **GIVEN** Ana con el más reciente marcado
- **WHEN** pulsa "Usar este" en otro
- **THEN** la marca SHALL pasar a ese y desaparecer del anterior

#### Scenario: La marca explica su consecuencia

- **WHEN** Ana mira el CV marcado
- **THEN** SHALL leer que ese es el que se usará para comparar con las vacantes

#### Scenario: El marcado no se pudo leer

- **GIVEN** Ana con el CV marcado en `failed` y otro en `extracted`
- **WHEN** abre la pantalla
- **THEN** SHALL ver el aviso de que ese CV no servirá para analizar vacantes
- **AND** SHALL poder marcar el que sí se leyó con una sola acción

#### Scenario: No hay otro que se leyera

- **GIVEN** Ana con un solo CV, marcado y en `failed`
- **WHEN** abre la pantalla
- **THEN** SHALL ver el aviso y NO SHALL ver la acción de usar otro

#### Scenario: La API falla al marcar

- **GIVEN** la API devolviendo `500`
- **WHEN** Ana pulsa "Usar este"
- **THEN** la marca SHALL quedarse donde estaba y SHALL verse el error

### Requirement: Ver lo que leímos

La acción "Ver lo que leímos" SHALL aparecer solo en los CV `extracted` y SHALL abrir un diálogo con la vista previa del
texto, desplazable, encabezado por "Así leímos tu CV. Si ves el texto desordenado, prueba a subir el PDF original."

El diálogo NO SHALL ofrecer copiar, descargar ni compartir ese texto, y el texto NO SHALL quedar en la pantalla al
cerrarlo.

#### Scenario: Mirar lo leído

- **GIVEN** un CV `extracted`
- **WHEN** Ana pulsa "Ver lo que leímos"
- **THEN** SHALL ver el principio del texto extraído y el aviso de qué hacer si está desordenado

#### Scenario: Sin botones de salida

- **WHEN** Ana abre ese diálogo
- **THEN** NO SHALL ver ninguna acción de copiar, descargar ni compartir

#### Scenario: No se ofrece sin texto

- **GIVEN** un CV en `pending` y otro en `failed`
- **WHEN** Ana los mira
- **THEN** ninguno SHALL ofrecer "Ver lo que leímos"

### Requirement: Mientras se lee, la pantalla se actualiza sola

Mientras algún CV esté `pending`, el SPA SHALL volver a pedir la lista cada 2 segundos durante como mucho 60 segundos, y
SHALL detener el sondeo en cuanto ninguno lo esté o al salir de la pantalla. Agotado ese tiempo sin resolverse, SHALL
mostrar "Sigue en proceso" con un botón "Actualizar".

#### Scenario: La lectura termina

- **GIVEN** un CV recién subido en "Estamos leyendo tu CV…"
- **WHEN** la extracción termina
- **THEN** la tarjeta SHALL pasar a "Listo · tu CV se leyó bien" sin recargar la página

#### Scenario: El sondeo se detiene

- **GIVEN** todos los CV ya leídos
- **WHEN** pasan 10 segundos
- **THEN** NO SHALL hacerse ninguna petición más

#### Scenario: Se acabó la paciencia

- **GIVEN** un CV que sigue `pending` tras 60 segundos
- **WHEN** vence el tiempo
- **THEN** SHALL verse "Sigue en proceso" con "Actualizar", y el sondeo SHALL haberse detenido

#### Scenario: Salir de la pantalla

- **GIVEN** un CV `pending` y el sondeo en marcha
- **WHEN** Ana navega a otra ruta
- **THEN** NO SHALL hacerse ninguna petición más

### Requirement: Eliminar un CV desde el SPA

"Eliminar" SHALL pedir confirmación nombrando el archivo y avisando de que "el archivo se borra y no se puede
recuperar"; si es el marcado, SHALL añadir "Pasará a usarse tu CV más reciente". Confirmado, el CV SHALL desaparecer de
la lista sin recargar; cancelado, NO SHALL ocurrir nada.

#### Scenario: Eliminar un CV

- **GIVEN** Ana con dos CV
- **WHEN** elimina el más antiguo y confirma
- **THEN** SHALL quedar una sola tarjeta en la lista

#### Scenario: Eliminar el marcado

- **GIVEN** Ana con dos CV y el más reciente marcado
- **WHEN** elimina el marcado
- **THEN** la confirmación SHALL avisar de que pasará a usarse su CV más reciente
- **AND** tras confirmar, el otro SHALL quedar marcado

#### Scenario: Cancelar el borrado

- **WHEN** Ana abre la confirmación y cancela
- **THEN** la lista SHALL quedar igual y NO SHALL enviarse ninguna petición

### Requirement: El SPA no ofrece descargar el CV

La pantalla NO SHALL ofrecer ninguna acción para descargar, abrir o compartir el archivo original de un CV, porque la
API no expone ninguna ruta que lo devuelva.

#### Scenario: Sin descarga

- **GIVEN** Ana con un CV guardado
- **WHEN** mira su tarjeta y su menú de acciones
- **THEN** NO SHALL encontrar ninguna acción de descargar ni de abrir el archivo

### Requirement: Textos de mi CV en español e inglés

Todos los textos de esta pantalla —bienvenida, línea de privacidad, estados de la lectura, acciones, avisos,
confirmaciones y errores— SHALL estar marcados para traducción y traducidos al inglés, con el español como idioma por
defecto.

#### Scenario: Traducciones completas

- **WHEN** se revisan los textos de `/mi-cv`
- **THEN** cada uno SHALL tener su unidad de traducción con su versión en inglés
