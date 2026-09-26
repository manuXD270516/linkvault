## ADDED Requirements

### Requirement: Solo una corrida real de main despliega a staging, y el modo de prueba nunca despliega

Los workflows de CD SHALL admitir un **modo de prueba** que construye y verifica el artefacto sin publicarlo, y ese modo
NO SHALL desplegar **nunca**, haya o no destino configurado. Un despliegue en modo de prueba solo podría llevarse una
imagen que esa corrida no publicó —otra, verificada por otra corrida o por ninguna—, así que la exclusión SHALL
expresarse como condición propia del despliegue y NO SHALL confiarse a que la descarga de la imagen falle.

En el CD a staging, además, **solo una corrida real sobre `main` SHALL desplegar**. Una corrida lanzada a mano desde
otra referencia NO SHALL desplegar a staging: `:staging` se mueve solo desde `main`, y un staging que corre código que no
está en `main` deja de describir lo que se va a publicar.

En el CD a staging, el resultado de esas corridas SHALL decirse con la misma honestidad que el resto de desenlaces del
CD:

- Un artefacto verificado en modo de prueba o fuera de `main` SHALL terminar **en verde** y SHALL decir de forma visible
  que **no se desplegó** y por qué —por ser modo de prueba o por no ser `main`—, **aunque haya destino configurado**.
  Leer "había destino y no se desplegó" como un despliegue fallido es un **rojo falso**: el mismo defecto, en la
  dirección contraria, que ADR-048 §3 cerró para la ausencia de destino.
- Un artefacto que no pasa la verificación SHALL seguir siendo **fallo** en modo de prueba, con las mismas reglas de
  causa que fuera de él.
- Un destino configurado **a medias** SHALL seguir siendo **fallo** también en modo de prueba y fuera de `main`: es un
  defecto de configuración que no depende del modo. Por eso el destino a medias SHALL evaluarse **antes** que el modo
  de la corrida: evaluado después, el modo lo convertiría en verde.
- El desenlace de estas corridas SHALL derivarse de la **misma** decisión que deriva los demás desenlaces del CD, y el
  nombre visible y el estado de commit SHALL decir lo mismo. Una segunda lógica de decisión solo para este caso NO
  SHALL aceptarse: dos lógicas que deciden lo mismo divergen.

El CD a producción ya no despliega en modo de prueba. Decir su desenlace con esta misma honestidad lo adoptará cuando
tenga destino: hoy no lo tiene, y sin destino su modo de prueba termina en «sin destino», que ya es verde.

**Y la spec SHALL nombrar el límite de este guardia en vez de dejar que se lea como un control de acceso.** Las
condiciones de arriba evitan **accidentes** —un modo de prueba que despliega de verdad, una rama que pisa staging—, y
NO SHALL presentarse como una autorización. Quien tiene permiso de escritura en el repositorio puede escribir, en
cualquier rama, un workflow que lea los mismos secretos y abra una sesión en el host; y el usuario de despliegue puede
manejar Docker, que en el host equivale a root. Por tanto **quien tiene escritura en el repositorio tiene root en
staging**, y eso SHALL quedar escrito junto a este guardia y en la documentación del destino, con la lista de quién
tiene hoy ese permiso. Prometer que el guardia protege el host sería el mismo defecto que ADR-048 persigue: una
garantía que se ve satisfecha y no lo está.

#### Scenario: Modo de prueba con destino de staging configurado

- **GIVEN** los secretos del destino de staging configurados por completo
- **WHEN** se lanza el CD a staging en modo de prueba y el artefacto pasa la verificación
- **THEN** NO SHALL ejecutarse ningún paso que toque el host de staging
- **AND** la corrida SHALL terminar en éxito
- **AND** el nombre visible y el estado de commit SHALL decir que no se desplegó por ser modo de prueba
- **AND** NO SHALL decir que el despliegue falló ni que no se completó

#### Scenario: El modo de prueba sobre main no despliega lo que publicó otra corrida

- **GIVEN** un commit de `main` cuyas imágenes ya publicó la corrida disparada por su push, y un destino de staging
  configurado
- **WHEN** se lanza sobre ese mismo commit el CD a staging en modo de prueba
- **THEN** NO SHALL desplegarse a staging
- **AND** las imágenes que ya estaban en el registro NO SHALL usarse como si esta corrida las hubiera publicado

#### Scenario: Una corrida manual desde una rama no despliega a staging

- **GIVEN** un destino de staging configurado
- **WHEN** se lanza a mano el CD a staging desde una rama distinta de `main`, fuera del modo de prueba
- **THEN** NO SHALL desplegarse a staging
- **AND** la corrida SHALL decir de forma visible que no se desplegó por no ser `main`

#### Scenario: Un artefacto roto sigue siendo fallo en modo de prueba

- **GIVEN** un destino configurado y una imagen que no arranca
- **WHEN** se lanza el CD en modo de prueba
- **THEN** la corrida SHALL fallar señalando que el artefacto no pasó la verificación

#### Scenario: Un destino a medias sigue fallando en modo de prueba y fuera de main

- **GIVEN** un destino de staging configurado solo en parte
- **WHEN** se lanza el CD a staging en modo de prueba, o a mano desde una rama distinta de `main`
- **THEN** la corrida SHALL fallar nombrando lo que falta
- **AND** NO SHALL decir que no se desplegó por ser modo de prueba o por no ser `main`

#### Scenario: El límite del guardia queda escrito

- **GIVEN** el guardia que impide desplegar en modo de prueba y fuera de `main`
- **WHEN** se evalúa qué protege
- **THEN** la spec y la documentación del destino SHALL decir que evita accidentes y que NO autoriza
- **AND** SHALL decir que quien tiene escritura en el repositorio tiene root en staging
- **AND** la documentación del destino SHALL decir quién tiene hoy ese permiso

### Requirement: Los secretos del despliegue a staging no forman parte del código del script remoto

Los pasos del CD a staging que ejecutan órdenes o copian ficheros en el host de destino SHALL recibir los valores
secretos —el token de lectura del registro y cualquier otro— **como datos**, y NO SHALL insertarlos en el texto del
script que se ejecuta en el host ni en ningún parámetro que se convierta en una orden remota. Un valor insertado en el
texto de un script se convierte en **código**: un carácter de shell dentro de él cambia lo que se ejecuta en la máquina
de staging, y el valor queda escrito en la orden completa. El CD a producción lo adoptará cuando tenga destino.

- Un secreto que contenga metacaracteres de shell SHALL usarse de forma literal y NO SHALL ejecutar nada.
- **Lo que el script usa como ruta o como código SHALL ir en el repositorio**, no en un secreto: visible en la revisión
  y fuera del alcance de quien solo configura secretos. El directorio del compose en el host SHALL ser una ruta fija
  escrita en el repositorio. Lo que el script solo usa como **dato** —la dirección del host, el usuario, las claves—
  puede guardarse como secreto, y SHALL validarse su forma antes de usarlo **aceptando solo formas conocidas**: rechazar
  únicamente las formas peligrosas que se conocen deja pasar las que no se han pensado.
- El **token** del registro SHALL pasarse al cliente por la entrada estándar y NO SHALL aparecer como argumento de
  ninguna orden, porque los argumentos de un proceso los ve cualquiera que liste los procesos del host. El **usuario**
  del registro, aunque no sea confidencial, es el valor de un secreto: SHALL viajar al host también como dato, por la
  entrada estándar, y NO SHALL formar parte de la orden remota, porque la shell remota interpreta esa orden antes de que
  ninguna validación del script pueda verla. La sesión del registro SHALL cerrarse al terminar el despliegue, también
  cuando falla, para que la credencial no quede guardada en el host.
- La credencial de lectura del registro SHALL formar parte del destino: las imágenes del proyecto son privadas y sin
  ella el host no puede descargarlas. Un destino sin ella SHALL tratarse como configurado **a medias**, y el
  despliegue NO SHALL tener una rama que continúe sin autenticarse.
- La **identidad del host** SHALL comprobarse en cada conexión, de forma estricta, contra su **clave pública** fijada de
  antemano y obtenida por un canal que no sea la propia red, y esa clave SHALL formar parte del destino: un destino sin
  ella SHALL tratarse como configurado a medias. Aceptar la clave que el host presente, o la que se obtenga en la misma
  corrida, entregaría la sesión de despliegue a quien conteste primero.

#### Scenario: Un secreto con metacaracteres no ejecuta nada

- **GIVEN** el token o el usuario de lectura del registro configurados con un valor que contiene una sustitución de
  órdenes de shell
- **WHEN** corre el despliegue a staging
- **THEN** la orden contenida en ese valor NO SHALL ejecutarse en el host
- **AND** el despliegue SHALL fallar al autenticarse contra el registro, sin tocar la pila en ejecución

#### Scenario: El token del registro no aparece como argumento

- **WHEN** el despliegue se autentica contra el registro de imágenes en el host
- **THEN** el token SHALL llegar por la entrada estándar
- **AND** NO SHALL figurar en los argumentos de ninguna orden ni en la lista de procesos del host
- **AND** al terminar el despliegue la sesión del registro SHALL estar cerrada en el host

#### Scenario: Un host que no presenta la clave fijada no recibe nada

- **GIVEN** un destino de staging cuya clave de host configurada no coincide con la que presenta el host
- **WHEN** corre el despliegue a staging
- **THEN** la primera conexión con el host SHALL fallar antes de copiar ningún fichero o ejecutar ninguna orden
- **AND** los contenedores en ejecución SHALL seguir siendo los de antes

#### Scenario: Sin clave del host o sin credencial del registro el destino está a medias

- **GIVEN** los secretos de conexión del destino de staging configurados, y la clave del host o la credencial de
  lectura del registro ausentes
- **WHEN** corre el CD a staging
- **THEN** SHALL fallar nombrando lo que falta
- **AND** NO SHALL tratarse como "no hay destino"

### Requirement: El despliegue lleva al host la configuración del mismo commit que las imágenes

Cuando el CD despliega, SHALL dejar en el host, **antes** de arrancar nada, el compose de producción y los ficheros que
ese compose monta **exactamente como están en el commit cuyas imágenes se despliegan**. Desplegar imágenes de un commit
con la configuración de otro es un artefacto que nadie ha verificado: la verificación del corredor levanta esas
imágenes con el compose de su propio commit, y el host las levantaría con el que alguien copió a mano la última vez.

El orden SHALL ser el que deja la pila en ejecución intacta mientras quede algo que pueda fallar:

1. comprobar que el directorio del compose existe en el host; el despliegue NO SHALL crearlo;
2. copiar la configuración del commit a un directorio propio de ese commit dentro del directorio del compose, sin
   tocar la configuración instalada;
3. autenticarse contra el registro, comprobar que las imágenes existen para la arquitectura del host y descargarlas,
   **usando la configuración recién copiada**, porque es la que declara qué imágenes hacen falta;
4. solo entonces instalar esa configuración en su sitio;
5. y arrancar.

- Lo que el repositorio no contiene y vive solo en el host —el fichero de entorno con los secretos, los volúmenes de
  datos, el almacén de certificados— NO SHALL modificarse ni borrarse al llevar la configuración.
- Si algún paso anterior a la instalación falla, el despliegue SHALL fallar nombrando lo que no se pudo hacer, y la
  configuración instalada y los contenedores en ejecución SHALL seguir siendo los de antes.
- El host SHALL conservar la configuración copiada de los **últimos despliegues**, en un número fijo y documentado, y
  el procedimiento para volver a la anterior sin depender del repositorio ni del corredor SHALL estar escrito.

#### Scenario: Un cambio del compose llega al host en el mismo despliegue

- **GIVEN** un merge a `main` que modifica `docker-compose.prod.yml`
- **WHEN** el CD despliega ese commit a staging
- **THEN** el compose del host SHALL ser idéntico byte a byte al del commit desplegado
- **AND** los ficheros que el compose monta SHALL ser también los de ese commit

#### Scenario: El entorno del host no se toca

- **GIVEN** el fichero de entorno con los secretos de staging en el host
- **WHEN** el CD lleva la configuración y despliega
- **THEN** ese fichero SHALL quedar idéntico al de antes del despliegue

#### Scenario: Sin directorio del compose no se toca nada

- **GIVEN** un host en el que no existe el directorio fijo del compose
- **WHEN** corre el despliegue
- **THEN** SHALL fallar nombrando el directorio antes de copiar nada
- **AND** NO SHALL crearlo

#### Scenario: Una descarga fallida no deja instalada la configuración nueva

- **GIVEN** una configuración copiada al host que declara una imagen que no se puede descargar
- **WHEN** corre el despliegue
- **THEN** SHALL fallar nombrando la imagen
- **AND** la configuración instalada y los contenedores en ejecución SHALL seguir siendo los de antes del despliegue

#### Scenario: El procedimiento para volver a la configuración anterior sin el corredor está escrito

- **GIVEN** staging desplegado y la configuración de los últimos despliegues conservada en el host
- **WHEN** un operador busca en la documentación de operación cómo volver al despliegue anterior sin el corredor
- **THEN** SHALL encontrar las órdenes para instalar la configuración de ese despliegue y arrancar con el tag de su
  commit
- **AND** SHALL encontrar cuántos despliegues se conservan
