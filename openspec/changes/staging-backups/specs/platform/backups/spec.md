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

- El volcado de la base SHALL ser consistente en un instante (con el registro de operaciones del replica set) y SHALL
  hacerse **antes** que la lectura de los objetos, para que todo objeto que la base referencia esté en la copia.
- Ningún dato en claro SHALL escribirse en un disco del host ni de un contenedor: los datos viajan por tuberías y, si
  hace falta un área de trabajo, en memoria con tope.
- Una corrida SHALL valer solo si deja en el destino su **manifiesto**: identificador de la corrida, hora, y tamaño y
  suma SHA-256 de cada flujo, comprobados al restaurar. Una corrida sin manifiesto NO SHALL contarse como respaldo.
- El intervalo SHALL ser nocturno (RPO de 24 h, aceptado por el owner el 2026-11-18), con una revisión con el tamaño
  real del repositorio a las dos semanas de tener invitados.

#### Scenario: Una corrida completa deja tres instantáneas y su manifiesto en cada destino

- **GIVEN** la pila de staging arriba y los dos destinos configurados
- **WHEN** corre el respaldo
- **THEN** cada destino SHALL listar una instantánea de la base, una de los objetos y una del manifiesto con el mismo
  identificador de corrida
- **AND** las sumas del manifiesto SHALL coincidir con las de los flujos guardados

#### Scenario: Un volcado interrumpido no deja una corrida válida

- **GIVEN** un volcado de la base que termina con error a mitad
- **WHEN** corre el respaldo
- **THEN** ese destino NO SHALL tener manifiesto de esa corrida
- **AND** el respaldo SHALL terminar con error y avisar la falla

#### Scenario: Un destino caído no impide el otro

- **GIVEN** el destino de Oracle inalcanzable
- **WHEN** corre el respaldo
- **THEN** el destino fuera de Oracle SHALL recibir su corrida completa con manifiesto
- **AND** el respaldo SHALL terminar con error nombrando el destino que falló

### Requirement: Los procesos del respaldo no deshacen el aislamiento por proceso

Ningún proceso del respaldo SHALL tener a la vez acceso a los datos y salida a Internet.

- Los procesos que leen la base o el almacén SHALL vivir en redes internas, sin salida, cada uno solo con el servicio
  que lee, y SHALL existir solo mientras dura la corrida.
- El proceso que envía a los destinos SHALL tener salida a Internet y NO SHALL pertenecer a ninguna red de datos.
- Ningún proceso del respaldo SHALL compartir red con `api` ni con `worker`.
- La separación SHALL comprobarse en cada cambio del repositorio con una comprobación permanente sobre la configuración
  de Compose resuelta.

#### Scenario: El lector de la base no sale a Internet ni ve a la API

- **GIVEN** el lector de la base en marcha
- **WHEN** resuelve `api` y abre una conexión a un sitio público
- **THEN** la resolución y la conexión SHALL fallar
- **AND** SHALL alcanzar a `mongo`

#### Scenario: El que envía no alcanza los datos

- **GIVEN** el proceso que envía a los destinos en marcha
- **WHEN** resuelve `mongo`, `object-store` y `api`
- **THEN** las tres resoluciones SHALL fallar

#### Scenario: El worker no ve a los procesos del respaldo

- **GIVEN** un lector del respaldo en marcha
- **WHEN** `worker` resuelve su nombre
- **THEN** la resolución SHALL fallar

#### Scenario: Una configuración que mezcla datos y salida rompe la comprobación

- **GIVEN** una copia de la configuración en la que el lector de la base también está en la red con salida
- **WHEN** corre la comprobación de repositorio del aislamiento del respaldo
- **THEN** SHALL fallar nombrando el servicio y la red

### Requirement: El respaldo lee con credenciales de solo lectura propias

El lector de la base SHALL autenticarse con un usuario propio que solo puede leer y volcar, y el lector del almacén con
una identidad S3 propia que solo puede listar y leer los dos buckets. Ninguno SHALL usar las credenciales de la
aplicación ni las del usuario raíz.

- El usuario de la base SHALL asegurarse (crearse o actualizarse) de forma idempotente **en cada corrida** y en cada
  restauración, no solo sobre un volumen vacío.
- La identidad S3 SHALL sobrevivir a un reinicio del almacén, y su creación NO SHALL cambiar la configuración medida
  del almacén sin repetir las celdas de la matriz que ADR-052 §2 exige.

#### Scenario: El usuario de respaldo no puede escribir

- **GIVEN** el usuario de respaldo de la base
- **WHEN** intenta insertar un documento
- **THEN** la operación SHALL fallar por autorización

#### Scenario: El usuario de respaldo existe sobre un volumen viejo

- **GIVEN** un volumen de la base creado antes de este change, sin usuario de respaldo
- **WHEN** corre el respaldo
- **THEN** el volcado SHALL hacerse con el usuario de respaldo

#### Scenario: La identidad S3 de respaldo no puede escribir ni borrar

- **GIVEN** la identidad S3 de respaldo
- **WHEN** intenta subir un objeto y borrar otro en el bucket de CV
- **THEN** las dos operaciones SHALL rechazarse
- **AND** listar y leer un objeto de cada bucket SHALL funcionar

### Requirement: El borrado de los respaldos está protegido y la poda se hace fuera del host

La credencial de cada destino que vive en el host NO SHALL poder destruir de forma definitiva ningún dato del respaldo
antes de que se cumpla la ventana de protección del destino. La eliminación definitiva SHALL ocurrir solo por una regla
del propio destino al vencer esa ventana o por la credencial de poda, que NO SHALL vivir en el host.

- Un destino con versionado SHALL tener una regla que expire las versiones no actuales; NO SHALL haber versionado sin
  ciclo de vida.
- Con la credencial del host, la herramienta de respaldo SHALL poder respaldar, comprobar y listar sin errores.
- La poda SHALL aplicar la retención de 7 diarios y 4 semanales (Q3, 2026-11-18), nunca a diario.
- La continuidad de las instantáneas SHALL comprobarse fuera del host al menos una vez por mes.

#### Scenario: La credencial del host no destruye un paquete

- **GIVEN** un repositorio de respaldo con instantáneas y la credencial del host
- **WHEN** se intenta borrar de forma definitiva un paquete de datos del repositorio
- **THEN** el destino SHALL rechazarlo, o el paquete SHALL seguir recuperable hasta el fin de la ventana de protección

#### Scenario: La poda con la credencial de poda aplica la retención

- **GIVEN** un repositorio con más instantáneas que las que pide la retención
- **WHEN** se poda desde fuera del host con la credencial de poda
- **THEN** SHALL quedar a lo sumo 7 diarias y 4 semanales

#### Scenario: Un destino con versionado sin ciclo de vida se rechaza

- **WHEN** se revisa la configuración de un destino que tiene versionado y ninguna regla de expiración de versiones no
  actuales
- **THEN** el destino NO SHALL darse por apto y el respaldo NO SHALL configurarse contra él

### Requirement: El respaldo tiene un tope de tamaño que lo hace fallar

Antes de enviar, el respaldo SHALL medir el tamaño del repositorio de cada destino y, si pasa el tope configurado, SHALL
terminar con error, sin enviar a ese destino, y avisar la falla con su clase. El tope por defecto SHALL quedar por
debajo de los 10 GB por nivel de Object Storage de Always Free, con margen para las versiones retenidas por la ventana
de protección. El área de trabajo en memoria del lector de objetos SHALL tener su propio tope, que también hace fallar
y avisar.

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

### Requirement: La programación sobrevive a un reinicio y se reconstruye desde la documentación

El respaldo SHALL programarse en el host de modo que siga activo tras un reinicio y que una corrida perdida por estar el
host apagado se recupere al arrancar. `infra/README.md` SHALL documentar cómo instalarlo, y la reconstrucción del host
SHALL incluir ese paso y comprobar el siguiente disparo. Dos corridas NO SHALL solaparse.

#### Scenario: Tras reiniciar el host el respaldo sigue programado

- **GIVEN** el respaldo programado
- **WHEN** se reinicia el host
- **THEN** el siguiente disparo SHALL seguir programado sin intervención

#### Scenario: Dos corridas no se solapan

- **GIVEN** una corrida en marcha
- **WHEN** se lanza otra a mano
- **THEN** la segunda SHALL terminar sin respaldar y decir que hay una en curso

### Requirement: La restauración no pisa usuarios y concilia lo restaurado

La restauración SHALL partir de la última corrida con manifiesto cuyas sumas coinciden, o de la que se elija, y SHALL:

- detener `api` y `worker` antes de tocar la base, y dejar `mongo` solo;
- restaurar la base **sin** las colecciones de usuarios del sistema (`admin.*`), sobre un volumen que la propia base
  inicializó con el usuario raíz del fichero de entorno;
- volver a cargar los objetos por la API S3 en un almacén con la misma clave de cifrado del fichero de entorno;
- marcar como pendientes los eventos del outbox publicados en las 24 h anteriores al volcado, para que el relay los
  vuelva a publicar (los consumidores son idempotentes por la spec `platform/outbox`);
- imprimir un informe de conciliación: CV de la base sin objeto, objetos sin documento y eventos reencolados.

#### Scenario: Restaurar no deja a la base sin usuario raíz

- **GIVEN** una corrida con manifiesto y un proyecto con volumen nuevo
- **WHEN** se restaura
- **THEN** la base SHALL llegar a sana con el usuario raíz del fichero de entorno
- **AND** el usuario de respaldo SHALL existir

#### Scenario: Una corrida con sumas que no coinciden no se restaura

- **GIVEN** una corrida cuyo flujo de la base no coincide con la suma de su manifiesto
- **WHEN** se pide restaurarla
- **THEN** la restauración SHALL terminar con error antes de tocar la base

#### Scenario: El trabajo en vuelo al volcar se vuelve a publicar

- **GIVEN** una corrida en cuyo volcado hay eventos publicados en las 24 h previas
- **WHEN** se restaura
- **THEN** esos eventos SHALL quedar pendientes y el informe SHALL decir cuántos

#### Scenario: El informe de conciliación sale aunque no haya diferencias

- **WHEN** termina una restauración sin diferencias entre la base y los objetos
- **THEN** el informe SHALL decir cero CV sin objeto y cero objetos sin documento

### Requirement: La restauración se ensaya en el host, aparte, antes de invitar y cada mes

La restauración SHALL ensayarse **en el host de staging**, en un proyecto de Compose aparte, con un override que no
tiene Traefik, ni `web`, ni `worker`, ni puertos publicados, ni redes con salida, y con volúmenes propios; y SHALL
terminar con `down -v`. El ensayo NO SHALL reiniciar la pila de staging. SHALL hacerse antes de invitar y después cada
mes, y cada vez SHALL anotar el tiempo total (RTO medido). Una restauración con datos reales NO SHALL hacerse fuera del
host: el script SHALL negarse a restaurar un repositorio remoto si no corre en el host.

#### Scenario: El ensayo restaura sin tocar staging

- **GIVEN** la pila de staging arriba
- **WHEN** se ensaya la restauración de la última corrida
- **THEN** las cuentas, los links y un CV de las cuentas de prueba SHALL leerse en el proyecto aparte
- **AND** los contenedores de staging SHALL conservar su hora de creación

#### Scenario: El override de restauración no publica nada

- **WHEN** se resuelve la configuración del proyecto de restauración
- **THEN** ningún servicio SHALL publicar puertos
- **AND** ningún servicio SHALL estar en una red con salida
- **AND** ningún volumen SHALL compartirse con el proyecto de staging

#### Scenario: El ensayo no deja restos

- **WHEN** termina el ensayo
- **THEN** ni los proyectos ni los volúmenes de Compose SHALL mostrar nada del proyecto de restauración

#### Scenario: Restaurar un repositorio remoto fuera del host se rechaza

- **GIVEN** una máquina que no es el host de staging
- **WHEN** se lanza la restauración contra un repositorio remoto
- **THEN** el script SHALL negarse antes de leer ningún dato

### Requirement: Los secretos del respaldo existen solo por nombre en el repositorio

Las credenciales de los destinos, la clave del repositorio de respaldo, el usuario de respaldo de la base, la identidad
S3 de respaldo y la dirección del monitor SHALL vivir solo en el fichero de entorno del host y en su copia fuera del
host; la credencial de poda, solo fuera del host. En el repositorio SHALL aparecer solo por nombre, con valores
ficticios en `.env.example`. Ningún script SHALL imprimirlas ni pasarlas en los argumentos de un proceso. La revisión
del fichero de entorno SHALL fallar nombrando la variable que falte o tenga mal formato, sin imprimir su valor.

#### Scenario: Falta una variable del respaldo

- **GIVEN** un fichero de entorno al que le falta la clave del repositorio de respaldo
- **WHEN** se revisa con `infra/ci/check-env-file.mjs`
- **THEN** SHALL salir con error nombrando la variable y sin imprimir ningún valor

#### Scenario: Ninguna credencial en los argumentos

- **GIVEN** un respaldo en marcha
- **WHEN** se listan los argumentos de sus procesos en el host
- **THEN** ninguna credencial ni la clave del repositorio SHALL aparecer
