## Purpose

Fija cómo se respaldan los datos de staging (Mongo y los objetos del almacén) fuera del host: qué procesos lo hacen y
con qué credenciales, cómo se protege el respaldo de quien comprometa el host, cómo se avisa cuando falta, y cómo se
restaura y se ensaya la restauración, de modo que perder el host o la cuenta de Oracle cueste horas y no datos.

## ADDED Requirements

### Requirement: Respaldo nocturno cifrado fuera del host, en dos destinos

Staging SHALL respaldar cada noche la base de datos entera y los objetos de los buckets de CV y de snapshots, cifrados
por la herramienta de respaldo con una clave que no vive en ningún destino, en **dos destinos independientes**: uno
dentro de la cuenta de Oracle y otro **fuera** de ella. Cada destino SHALL recibir su propia pasada, de modo que el
fallo de uno no impida el otro.

- Antes de respaldar, la corrida SHALL esperar a que la base y el almacén estén sanos y SHALL comprobar la plataforma de
  las imágenes del respaldo.
- El volcado de la base SHALL hacerse **antes** que la lectura de los objetos, para que todo objeto que la base referencia esté en la copia. La base restaurada NO SHALL presentarse como un instante único: cada colección queda como estaba cuando se volcó, entre las horas de inicio y fin del volcado del manifiesto, y la ventana de reencolado del outbox lo cubre.
- Ningún dato en claro SHALL escribirse en un disco del host ni de un contenedor, **incluidos los registros de
  Docker**: los datos viajan por tuberías, los servicios que los sacan por su salida estándar no guardan registros, el
  orquestador no reproduce el flujo en su propia salida ni en su registro, y el área de trabajo, si hace falta, es
  memoria con tope.
- Una corrida SHALL valer solo si deja en el destino su **manifiesto**: identificador de la corrida, horas de inicio y
  fin del volcado de la base en ese destino, y tamaño y suma SHA-256 de cada flujo, comprobados al restaurar. Una corrida sin manifiesto NO SHALL contarse como respaldo.
- El intervalo SHALL ser nocturno (RPO de 24 h, aceptado por el owner el 2026-11-18), con una revisión con el tamaño
  real del repositorio a las dos semanas de tener invitados.

#### Scenario: Una corrida completa deja tres instantáneas y su manifiesto en cada destino

- **GIVEN** la pila de staging arriba y los dos destinos configurados
- **WHEN** corre el respaldo
- **THEN** cada destino SHALL listar una instantánea de la base, una de los objetos y una del manifiesto con el mismo
  identificador de corrida
- **AND** las sumas del manifiesto SHALL coincidir con las de los flujos guardados

#### Scenario: Un volcado interrumpido no deja una corrida válida

- **GIVEN** un volcado de la base de varios megabytes que termina con error a mitad
- **WHEN** corre el respaldo
- **THEN** ese destino NO SHALL tener manifiesto de esa corrida
- **AND** el respaldo SHALL terminar con error y avisar la falla
- **NOTE** restic puede dejar una **instantánea parcial** (o vacía) del flujo cuando el productor muere a mitad, porque guarda lo que alcanzó a leer; esa instantánea **sin manifiesto no cuenta como respaldo** y `restore.sh` la ignora: solo parte de corridas con manifiesto.

#### Scenario: Un destino caído no impide el otro

- **GIVEN** el destino de Oracle inalcanzable
- **WHEN** corre el respaldo
- **THEN** el destino fuera de Oracle SHALL recibir su corrida completa con manifiesto
- **AND** el respaldo SHALL terminar con error nombrando el destino que falló

#### Scenario: El orquestador no reproduce los datos en su salida

- **GIVEN** un flujo del respaldo con un marcador binario conocido
- **WHEN** corre el respaldo
- **THEN** el marcador NO SHALL aparecer en la salida estándar ni en la de errores del orquestador

#### Scenario: Los datos no quedan en los registros de Docker

- **GIVEN** un servicio del respaldo en marcha que saca el volcado por su salida estándar
- **WHEN** se inspecciona su contenedor
- **THEN** su controlador de registros SHALL ser `none`
- **AND** NO SHALL existir un fichero de registro de ese contenedor

### Requirement: Los procesos del respaldo no deshacen el aislamiento por proceso

Ningún proceso del respaldo ni de la restauración SHALL poder consultar los datos y además salir a Internet.

- Los procesos que leen o cargan la base o el almacén SHALL vivir en redes internas, sin salida, cada uno solo con el
  servicio que lee o carga, y SHALL existir solo mientras dura la corrida o la restauración.
- El proceso que envía a los destinos SHALL tener salida a Internet y NO SHALL pertenecer a ninguna red de datos ni
  alcanzar la dirección de metadatos del proveedor. Recibe el flujo en claro antes de cifrarlo: su imagen SHALL ser la
  oficial de la herramienta, fijada por digest.
- Ningún proceso del respaldo SHALL compartir red con `api` ni con `worker`.
- Cada servicio del respaldo SHALL declarar sus redes de forma explícita, sin `network_mode`, sin la red por defecto y
  sin puertos publicados; las redes de datos del respaldo SHALL ser internas.
- La separación SHALL comprobarse en cada cambio del repositorio con una comprobación permanente sobre la configuración
  de Compose resuelta.

#### Scenario: El lector de la base no sale a Internet ni ve a la API

- **GIVEN** el lector de la base en marcha
- **WHEN** resuelve `api` y abre una conexión a un sitio público
- **THEN** la resolución y la conexión SHALL fallar
- **AND** SHALL alcanzar a `mongo`

#### Scenario: El que envía no alcanza los datos ni la dirección de metadatos

- **GIVEN** el proceso que envía a los destinos en marcha
- **WHEN** resuelve `mongo`, `object-store` y `api`, y pide la dirección de metadatos del proveedor
- **THEN** las tres resoluciones SHALL fallar
- **AND** la petición a la dirección de metadatos SHALL terminar en error de conexión o de plazo

#### Scenario: El worker no ve a los procesos del respaldo

- **GIVEN** un lector del respaldo en marcha
- **WHEN** `worker` resuelve su nombre
- **THEN** la resolución SHALL fallar

#### Scenario: Una configuración que mezcla datos y salida rompe la comprobación

- **GIVEN** una copia de la configuración en la que el lector de la base también está en la red con salida
- **WHEN** corre la comprobación de repositorio del aislamiento del respaldo
- **THEN** SHALL fallar nombrando el servicio y la red

#### Scenario: Un servicio del respaldo sin redes explícitas o con registros rompe la comprobación

- **GIVEN** una copia de la configuración en la que el lector de la base no declara redes, o no tiene el controlador de
  registros `none`
- **WHEN** corre la comprobación de repositorio del aislamiento del respaldo
- **THEN** SHALL fallar nombrando el servicio y la regla

### Requirement: El respaldo lee sin escribir: usuario de solo lectura en la base, identidad de la aplicación en el almacén

El lector de la base SHALL autenticarse con un usuario propio que solo puede leer y volcar, nunca con las credenciales
de la aplicación ni con las del usuario raíz. El lector del almacén SHALL autenticarse con la **identidad S3 de la
aplicación** (las mismas variables que usa `api`), recibida solo por su entorno y nunca impresa ni pasada en los
argumentos de un proceso: el almacén medido no admite una identidad propia de solo lectura sin cambiar su
configuración (Q3 del change resuelta en (b) el 2026-11-18, ADR-066 §3).

- El usuario de la base SHALL asegurarse (crearse o actualizarse) de forma idempotente **en cada corrida** y en cada
  restauración, no solo sobre un volumen vacío.
- El lector del almacén NO SHALL tener salida a Internet ni compartir red con `api` o `worker`, NO SHALL guardar
  registros y SHALL existir solo mientras dura la corrida.
- Los scripts que ejecuta el lector del almacén NO SHALL usar órdenes de escritura de su herramienta S3 (borrar,
  purgar, sincronizar, mover, crear o subir) ni copiar con el almacén como destino. La comprobación de repositorio del
  aislamiento del respaldo SHALL fallar, nombrando el fichero y la línea, si alguno lo hace.
- Ningún paso del respaldo ni de la restauración SHALL crear, cambiar ni borrar identidades del almacén, ni cambiar la
  configuración medida del almacén.
- Esta garantía evita escrituras **solo por la construcción de los scripts**: la identidad que usa el lector puede
  escribir y borrar, y las interfaces internas del almacén siguen sin autenticación. NO SHALL presentarse como
  contención de un lector comprometido.

#### Scenario: El usuario de respaldo no puede escribir

- **GIVEN** el usuario de respaldo de la base
- **WHEN** intenta insertar un documento
- **THEN** la operación SHALL fallar por autorización

#### Scenario: El usuario de respaldo existe sobre un volumen viejo

- **GIVEN** un volumen de la base creado antes de este change, sin usuario de respaldo
- **WHEN** corre el respaldo
- **THEN** el volcado SHALL hacerse con el usuario de respaldo

#### Scenario: El lector de objetos lee con la identidad de la aplicación sin salir a Internet

- **GIVEN** la pila levantada y el lector de objetos del respaldo en marcha con la identidad S3 de la aplicación
- **WHEN** lista los dos buckets, lee un objeto de cada uno y abre una conexión a un sitio público
- **THEN** el listado y las lecturas SHALL funcionar
- **AND** la conexión externa SHALL fallar

#### Scenario: Un lector de objetos que borra rompe la comprobación

- **GIVEN** una copia de los scripts del lector de objetos con una orden de borrado sobre el bucket de CV
- **WHEN** corre la comprobación de repositorio del aislamiento del respaldo
- **THEN** SHALL fallar nombrando el fichero y la línea

#### Scenario: Un lector de objetos que copia hacia el almacén rompe la comprobación

- **GIVEN** una copia de los scripts del lector de objetos con una copia cuyo destino es el almacén
- **WHEN** corre la comprobación de repositorio del aislamiento del respaldo
- **THEN** SHALL fallar nombrando el fichero y la línea

#### Scenario: El respaldo no administra identidades del almacén

- **WHEN** se buscan en `infra/backup/` llamadas a la API de identidades del almacén o a su CLI
- **THEN** NO SHALL aparecer ninguna
- **AND** la configuración de Compose resuelta NO SHALL tener ningún servicio que asegure una identidad de respaldo

### Requirement: El borrado de los respaldos está protegido y la poda se hace fuera del host

La credencial de cada destino que vive en el host NO SHALL poder destruir de forma definitiva ningún dato del respaldo
antes de que se cumpla la ventana de protección del destino, ni suspender el versionado, cambiar el ciclo de vida o
tocar la retención. La eliminación definitiva SHALL ocurrir solo por una regla del propio destino al vencer esa ventana
o por la credencial de poda, que NO SHALL vivir en el host. La retención NO SHALL quedar bloqueada: el owner, con su
usuario administrador, SHALL poder quitarla.

- Un destino con versionado SHALL tener una regla que expire las versiones no actuales; NO SHALL haber versionado sin
  ciclo de vida.
- Con la credencial del host, la herramienta de respaldo SHALL poder respaldar, comprobar y listar sin errores.
- La poda SHALL aplicar la retención de 7 diarios y 4 semanales (Q3, 2026-11-18), nunca a diario.
- La continuidad de las instantáneas SHALL comprobarse fuera del host con una frecuencia de al menos una vez cada
  ventana de protección menos siete días, y la integridad de los metadatos de cada destino, una vez por mes. Fuera del
  host NO SHALL restaurarse, volcarse ni montarse ningún dato.
- La documentación SHALL tener el procedimiento para recuperar lo borrado dentro de la ventana de protección.
- Si la instantánea más vieja de un destino pasa del plazo de la poda vencida, el respaldo SHALL avisarlo sin dejar de
  respaldar.

#### Scenario: La credencial del host no destruye un paquete

- **GIVEN** un repositorio de respaldo con instantáneas y la credencial del host
- **WHEN** se intenta borrar de forma definitiva un paquete de datos del repositorio, o una versión suya
- **THEN** el destino SHALL rechazarlo, o el paquete SHALL seguir recuperable hasta el fin de la ventana de protección

#### Scenario: La credencial del host no cambia la protección

- **GIVEN** la credencial del host de un destino con versionado
- **WHEN** intenta suspender el versionado, cambiar el ciclo de vida o tocar la retención
- **THEN** las tres operaciones SHALL rechazarse

#### Scenario: La poda con la credencial de poda aplica la retención

- **GIVEN** un repositorio con más instantáneas que las que pide la retención
- **WHEN** se poda desde fuera del host con la credencial de poda
- **THEN** SHALL quedar a lo sumo 7 diarias y 4 semanales

#### Scenario: Un destino con versionado sin ciclo de vida se rechaza

- **WHEN** se revisa la configuración de un destino que tiene versionado y ninguna regla de expiración de versiones no
  actuales
- **THEN** el destino NO SHALL darse por apto y el respaldo NO SHALL configurarse contra él

#### Scenario: La poda vencida avisa sin cortar el respaldo

- **GIVEN** un destino cuya instantánea más vieja tiene más de 65 días
- **WHEN** corre el respaldo
- **THEN** SHALL dejar la corrida completa con manifiesto
- **AND** el monitor SHALL recibir el aviso de poda vencida

### Requirement: El respaldo tiene un tope de tamaño que lo hace fallar

Antes de enviar, el respaldo SHALL medir el tamaño del repositorio de cada destino, con las versiones retenidas si el
destino deja listarlas, y, si pasa el tope configurado, SHALL terminar con error, sin enviar a ese destino, y avisar la
falla con su clase. El tope por defecto SHALL quedar por debajo de los 10 GB por nivel de Object Storage de Always
Free, con margen para las versiones retenidas por la ventana de protección. El área de trabajo en memoria del lector de
objetos SHALL tener su propio tope, que también hace fallar y avisar.

#### Scenario: Un tope menor que el tamaño actual hace fallar el respaldo

- **GIVEN** un tope de tamaño configurado por debajo del tamaño actual del repositorio
- **WHEN** corre el respaldo
- **THEN** SHALL terminar con error de clase de tope de tamaño
- **AND** NO SHALL haber instantánea nueva en ese destino
- **AND** el monitor SHALL recibir la falla

### Requirement: Un respaldo que falla o que falta avisa

Cada corrida SHALL avisar su inicio, su éxito o su falla a un monitor externo de pings gratuito, cuya dirección es un
secreto (`BACKUP_PING_URL`). El monitor SHALL avisar por correo al owner cuando llega una falla y cuando no llega un
éxito dentro de su ventana. El aviso NO SHALL llevar datos: solo el identificador de la corrida y la clase de la falla.

#### Scenario: Una falla avisa con su clase

- **GIVEN** un respaldo que falla al volcar la base
- **WHEN** termina
- **THEN** el monitor SHALL recibir una falla con la clase del volcado y sin datos de la base

#### Scenario: Un respaldo que no corre produce un aviso

- **GIVEN** el programador del respaldo desactivado una noche
- **WHEN** vence la ventana del monitor sin un ping de éxito
- **THEN** el owner SHALL recibir el aviso por correo

### Requirement: La programación sobrevive a un reinicio y se instala siguiendo solo la documentación

El respaldo SHALL programarse en el host de modo que siga activo tras un reinicio, que espere a Docker, y que una
corrida perdida por estar el host apagado se recupere al arrancar. La programación SHALL instalarse siguiendo **solo**
la sección correspondiente de `infra/README.md`, y cada paso que haga falta y no esté escrito SHALL contarse como
defecto de la documentación y corregirse; la reconstrucción del host SHALL incluir ese paso y comprobar el siguiente
disparo. El respaldo, la restauración y su ensayo SHALL compartir un candado: dos de ellos NO SHALL solaparse; y cada uno SHALL
ejecutar una copia de sus scripts y de sus ficheros de Compose hecha al tomar el candado, de modo que un despliegue a
mitad de camino no cambie lo que ejecuta. La documentación SHALL escribir la franja horaria sin despliegues.

#### Scenario: Tras reiniciar el host el respaldo sigue programado

- **GIVEN** el respaldo programado
- **WHEN** se reinicia el host
- **THEN** el siguiente disparo SHALL seguir programado sin intervención

#### Scenario: Dos corridas no se solapan

- **GIVEN** una corrida en marcha
- **WHEN** se lanza otra, o una restauración, a mano
- **THEN** la segunda SHALL terminar sin tocar nada y decir que hay una en curso

#### Scenario: La instalación sigue solo el README

- **GIVEN** un host sin la programación del respaldo
- **WHEN** el operador sigue solo la sección del README
- **THEN** el respaldo SHALL quedar programado con su siguiente disparo visible
- **AND** cada paso que faltara SHALL quedar anotado como defecto y corregido

### Requirement: La restauración no pisa usuarios y concilia lo restaurado

La restauración SHALL elegir el destino del que restaura y partir de la última corrida con manifiesto cuyas sumas
coinciden, o de la que se elija; manifiestos o instantáneas duplicados de una misma corrida SHALL ser un error. SHALL:

- usar para el proyecto que restaura la misma imagen etiquetada por commit que corre en staging, y fallar si no la hay;
- en staging, exigir la confirmación escrita de que el despliegue continuo está desactivado;
- detener `api` y `worker` antes de tocar la base, y dejar `mongo` solo;
- restaurar la base dentro del propio contenedor de la base, **sin** las colecciones de usuarios del sistema
  (`admin.*`), sobre un volumen que la propia base inicializó con el usuario raíz del fichero de entorno, sin
  credenciales en los argumentos;
- aprovisionar los buckets y recién entonces volver a cargar los objetos por la API S3 con la identidad de la
  aplicación, con un proceso sin salida y sin registros;
- en staging, recrear la cola antes de reencolar, mostrar cuántos eventos se reencolarían por tipo y pedir
  confirmación; marcar como pendientes los eventos del outbox publicados desde la hora de inicio del volcado del
  destino restaurado menos la ventana (por defecto una hora); en el ensayo, solo contar;
- imprimir un informe de conciliación: CV de la base sin objeto, objetos sin documento, eventos reencolados y cabeceras
  de los CV distintas de las del manifiesto;
- recordar al terminar que el owner vuelva a aplicar los borrados que le consten posteriores al volcado.

#### Scenario: Restaurar no deja a la base sin usuario raíz

- **GIVEN** una corrida con manifiesto y un proyecto con volumen nuevo
- **WHEN** se restaura
- **THEN** la base SHALL llegar a sana con el usuario raíz del fichero de entorno
- **AND** el usuario de respaldo SHALL existir

#### Scenario: Una corrida con sumas que no coinciden no se restaura

- **GIVEN** una corrida cuyo flujo de la base no coincide con la suma de su manifiesto, o con dos manifiestos
- **WHEN** se pide restaurarla
- **THEN** la restauración SHALL terminar con error antes de tocar la base

#### Scenario: El trabajo en vuelo al volcar se vuelve a publicar una vez

- **GIVEN** una corrida en cuyo volcado hay eventos publicados en la hora previa, y una cola que ya tenía el job de uno
  de ellos
- **WHEN** se restaura en staging y se confirma el reencolado
- **THEN** la cola SHALL recrearse antes de reencolar
- **AND** cada evento de la ventana SHALL quedar con un solo job

#### Scenario: Un evento publicado durante el volcado se reencola

- **GIVEN** un evento publicado después de empezar el volcado de la base y antes del manifiesto, que quedó en el volcado
  como publicado
- **WHEN** se restaura en staging y se confirma el reencolado
- **THEN** ese evento SHALL quedar pendiente

#### Scenario: Restaurar staging sin desactivar el despliegue continuo se rechaza

- **WHEN** se pide restaurar en staging sin escribir la confirmación de que el despliegue continuo está desactivado
- **THEN** la restauración SHALL terminar sin tocar nada

#### Scenario: El ensayo no reencola

- **WHEN** se restaura en el proyecto de ensayo
- **THEN** el informe SHALL decir cuántos eventos se reencolarían por tipo
- **AND** ningún evento SHALL cambiar de estado

#### Scenario: El informe de conciliación sale aunque no haya diferencias

- **WHEN** termina una restauración sin diferencias entre la base y los objetos
- **THEN** el informe SHALL decir cero CV sin objeto, cero objetos sin documento y cero cabeceras distintas

#### Scenario: Sin imagen etiquetada por commit no se restaura

- **GIVEN** la `api` de staging corriendo con una etiqueta que no es de commit
- **WHEN** se pide restaurar
- **THEN** la restauración SHALL terminar con error antes de tocar nada

### Requirement: La restauración se ensaya en el host, aparte, con calendario fijo

La restauración SHALL ensayarse **en el host de staging**, en un proyecto de Compose aparte, con un override que no
tiene Traefik, ni `web`, ni `worker`, ni puertos publicados, y en el que el único servicio con salida es el que trae los
datos de los destinos, sin redes de datos; con volúmenes propios; y SHALL terminar con `down -v`. El ensayo NO SHALL
reiniciar ni recrear ningún contenedor de staging. Se comprueba con una cuenta permanente de ensayo con datos
sintéticos, cuya contraseña se lee por la entrada estándar.

- Calendario: antes de invitar (desde el destino de fuera de Oracle); después, mensual los dos primeros meses y luego
  trimestral, alternando el destino; y uno extra cada vez que cambie la imagen de la base o del almacén o los scripts
  del respaldo. Cada ensayo SHALL anotar el tiempo total (RTO medido).
- Una restauración NO SHALL hacerse fuera del host: el script SHALL negarse a usar un repositorio remoto si no existe
  el fichero de entorno del host y no se confirmó expresamente que se está en el host.

#### Scenario: El ensayo restaura sin tocar staging

- **GIVEN** la pila de staging arriba
- **WHEN** se ensaya la restauración de la última corrida
- **THEN** la cuenta de ensayo, sus links y su CV SHALL leerse en el proyecto aparte
- **AND** los contenedores de staging SHALL conservar su identificador, su hora de arranque y su número de reinicios

#### Scenario: El override de restauración no publica nada

- **WHEN** se resuelve la configuración del proyecto de restauración
- **THEN** ningún servicio SHALL publicar puertos
- **AND** el único servicio en una red con salida SHALL ser el que trae los datos de los destinos, y NO SHALL estar en
  ninguna red de datos
- **AND** ningún volumen SHALL compartirse con el proyecto de staging

#### Scenario: El ensayo no deja restos

- **WHEN** termina el ensayo
- **THEN** ni los proyectos ni los volúmenes de Compose SHALL mostrar nada del proyecto de restauración

#### Scenario: Restaurar un repositorio remoto fuera del host se rechaza

- **GIVEN** una máquina sin el fichero de entorno del host
- **WHEN** se lanza la restauración contra un repositorio remoto sin confirmar que es el host
- **THEN** el script SHALL negarse antes de leer ningún dato

### Requirement: Los secretos del respaldo existen solo por nombre en el repositorio

Las credenciales de los destinos, la clave del repositorio de respaldo, el usuario de respaldo de la base y la
dirección del monitor SHALL vivir solo en el fichero de entorno del host y en su copia fuera del
host; la credencial de poda, solo fuera del host. En el repositorio SHALL aparecer solo por nombre, con valores
ficticios en `.env.example`. Ningún script SHALL imprimirlas ni pasarlas en los argumentos de un proceso. La revisión
del fichero de entorno SHALL fallar nombrando la variable que falte o tenga mal formato, sin imprimir su valor.

#### Scenario: Falta una variable del respaldo

- **GIVEN** un fichero de entorno al que le falta la clave del repositorio de respaldo o la dirección del monitor
- **WHEN** se revisa con `infra/ci/check-env-file.mjs`
- **THEN** SHALL salir con error nombrando la variable y sin imprimir ningún valor

#### Scenario: Ninguna credencial en los argumentos

- **GIVEN** un respaldo en marcha
- **WHEN** se listan los argumentos de sus procesos en el host
- **THEN** ninguna credencial ni la clave del repositorio SHALL aparecer

### Requirement: El plazo de los datos borrados en las copias es uno solo y está escrito

El plazo máximo durante el que un dato borrado sigue en alguna copia SHALL calcularse con la retención, la frecuencia
de la poda, la ventana de protección y, si la hay, la papelera del destino, y SHALL escribirse en semanas, con el mismo
número, en la documentación del respaldo, en el aviso de operación y en el aviso de privacidad; una comprobación
permanente SHALL fallar si esos tres números difieren. El aviso a los invitados SHALL llevar el mismo número, y se
comprueba antes de fusionar.

#### Scenario: Un plazo distinto en un aviso rompe la comprobación

- **GIVEN** el aviso de privacidad con un número de semanas distinto del de la documentación del respaldo
- **WHEN** corre la comprobación de repositorio
- **THEN** SHALL fallar nombrando los dos ficheros y los dos números
