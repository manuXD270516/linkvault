## MODIFIED Requirements

### Requirement: Consumo idempotente de la lectura del CV

El consumidor de `extract-cv` SHALL poder ejecutarse más de una vez sobre el mismo evento sin efectos adicionales, por
sí mismo y no por el `jobId` de la cola:

- un CV que ya no existe SHALL completar el job sin error y sin escribir nada;
- un CV cuyo estado ya no es `pending` SHALL completar el job sin error y sin volver a leer el archivo;
- un CV cuyo **objeto no existe** en el almacén SHALL completar el job **sin reintentos**, dejándolo en `failed` con
  motivo `internal_error`: un objeto que no está no aparece al siguiente intento. Esto SHALL distinguirse de que el
  almacén no responda, que sí es transitorio;
- **solo** un error del almacén que diga que **el objeto** no existe SHALL contar como objeto ausente. Que **el bucket
  de CV** no exista, o una respuesta de «no encontrado» que no se sepa atribuir al objeto, NO SHALL tratarse como
  objeto ausente: SHALL tratarse como un fallo de infraestructura y reintentarse, porque un bucket sin crear o mal
  nombrado dejaría en `failed` cada CV subido sin posibilidad de reintento;
- la escritura del resultado SHALL ir condicionada a que el CV siga en `pending`, y si no modifica nada el job SHALL
  completarse sin reintento.

Un fallo de infraestructura (la base o el almacén de objetos sin responder, o el bucket de CV ausente) SHALL
reintentarse según la política de la cola: tres intentos con espera creciente. Agotados, el CV SHALL quedar en `failed`
con motivo `internal_error` y un aviso con su identificador; NO SHALL quedar en `pending` indefinidamente.

El consumidor SHALL declarar de forma explícita `maxStalledCount: 1`, de modo que una muerte del proceso a mitad de
lectura reabra el archivo como mucho una vez más. Un job que la cola falla **sin reintento pendiente** —con un error
no recuperable, como el que da al superar ese límite de `stalled`, o ya terminado— SHALL dejar el CV en `failed` con
motivo `internal_error`, aunque no haya agotado sus intentos: NO SHALL quedar en `pending` indefinidamente. Un job que
falla con reintentos pendientes NO SHALL cambiar el CV.

#### Scenario: El mismo evento dos veces

- **GIVEN** un CV ya leído
- **WHEN** su evento vuelve a publicarse tras la retención de la cola
- **THEN** el texto y el estado SHALL quedar como estaban y el job SHALL completarse sin error

#### Scenario: CV borrado antes de leerse

- **GIVEN** un evento pendiente cuyo CV ya se borró
- **WHEN** el worker lo consume
- **THEN** el job SHALL completarse sin error y sin escribir nada

#### Scenario: El objeto no está

- **GIVEN** un CV cuyo archivo no existe en el almacén
- **WHEN** el worker consume su evento
- **THEN** el CV SHALL quedar en `failed` con motivo `internal_error`
- **AND** el job SHALL completarse sin reintentos

#### Scenario: El bucket de CV no existe

- **GIVEN** un CV en `pending` y el almacén respondiendo que el bucket de CV no existe
- **WHEN** el worker consume su evento
- **THEN** el job SHALL fallar y reintentarse según la política de la cola
- **AND** el CV NO SHALL quedar en `failed` en ese intento
- **AND** el aviso registrado SHALL nombrar el tipo de error y ningún dato del archivo ni su clave

#### Scenario: El almacén no responde

- **GIVEN** el almacén de objetos devolviendo un error de servicio
- **WHEN** el worker consume el evento
- **THEN** el job SHALL fallar y reintentarse según la política de la cola

#### Scenario: Dos ejecuciones a la vez

- **GIVEN** dos ejecuciones del mismo evento en paralelo
- **WHEN** ambas terminan de extraer
- **THEN** SHALL escribirse un solo resultado y la perdedora SHALL completarse sin error

#### Scenario: La base no responde

- **GIVEN** MongoDB caído durante los tres intentos del job
- **WHEN** se agotan
- **THEN** el CV SHALL quedar en `failed` con motivo `internal_error`
- **AND** el aviso registrado SHALL nombrar el CV por su identificador y ningún dato del archivo

#### Scenario: El límite de stalled está declarado

- **WHEN** se construye el consumidor de `extract-cv`
- **THEN** las opciones de su `Worker` SHALL llevar `maxStalledCount` igual a 1

#### Scenario: Un job perdido por stalled no deja el CV leyéndose

- **GIVEN** un CV en `pending` cuyo job la cola falla por superar el límite de `stalled` con intentos aún disponibles
- **WHEN** el consumidor recibe ese fallo
- **THEN** el CV SHALL quedar en `failed` con motivo `internal_error`
- **AND** el aviso registrado SHALL nombrar el CV por su identificador y ningún dato del archivo

#### Scenario: Un fallo con reintentos pendientes no toca el CV

- **GIVEN** un CV en `pending` cuyo job falla con un error transitorio y le quedan intentos
- **WHEN** el consumidor recibe ese fallo
- **THEN** el CV SHALL seguir en `pending`

### Requirement: Texto extraído, normalizado y acotado

El worker SHALL extraer el texto del PDF con `pdf-parse` y el del DOCX con `mammoth`, los dos **dentro del proceso
hijo** de la lectura aislada (requirement «La lectura corre aislada del proceso del worker»).

La extracción SHALL leer como mucho las **50 primeras páginas** de un PDF y SHALL dejar de acumular texto al llegar a
**1.000.000 de caracteres** crudos, entregando lo acumulado; ninguno de los dos topes SHALL convertir la lectura en un
fallo.

El texto SHALL guardarse normalizado: `\r\n` y `\r` pasan a `\n`, se quitan los caracteres de control salvo `\n` y
`\t`, se colapsan las líneas en blanco repetidas y se recortan los extremos.

El texto guardado SHALL tener como mucho 200.000 caracteres; si sobra, SHALL recortarse y marcarse como recortado **en
la base de datos**, marca que NO SHALL salir en ninguna respuesta. `textChars` SHALL contar los caracteres guardados. El
texto SHALL guardarse en el documento del CV y de él SHALL salir únicamente la vista previa.

#### Scenario: PDF con texto

- **GIVEN** un CV en PDF con una página de texto
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `extracted` con su texto guardado y `textChars` mayor que cero

#### Scenario: DOCX con texto

- **GIVEN** un CV en DOCX
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `extracted` con su texto guardado

#### Scenario: Texto larguísimo

- **GIVEN** un archivo cuyo texto supera los 200.000 caracteres
- **WHEN** el worker lo lee
- **THEN** SHALL guardarse exactamente 200.000 caracteres y el documento SHALL quedar marcado como recortado
- **AND** esa marca NO SHALL aparecer en el listado de la persona

#### Scenario: Saltos y caracteres de control

- **GIVEN** un archivo cuyo texto trae `\r\n`, caracteres de control y líneas en blanco repetidas
- **WHEN** el worker lo lee
- **THEN** el texto guardado SHALL tener solo `\n`, sin caracteres de control y sin líneas en blanco repetidas

#### Scenario: Un PDF de muchas páginas

- **GIVEN** un PDF generado de 200 páginas, cada una con una marca de página distinta
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `extracted`
- **AND** el texto SHALL contener las marcas de las páginas 1 a 50 y ninguna de la 51 en adelante

#### Scenario: Un PDF con texto sin fin

- **GIVEN** un PDF generado cuyo contenido produce más de 1.000.000 de caracteres de texto
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `extracted` con 200.000 caracteres y marcado como recortado
- **AND** la lectura SHALL terminar antes del plazo

### Requirement: La lectura tiene plazo y no monopoliza el worker

La extracción de un CV SHALL tener un plazo configurable (`CV_EXTRACTION_TIMEOUT_MS`, por defecto 30 s), contado desde
que el proceso que lee el archivo se anuncia listo, que **detiene** el trabajo: al vencer, ese proceso SHALL terminarse,
el CV SHALL quedar en `failed` con motivo `unreadable_file` y el job SHALL completarse **sin reintentos**. Un archivo
que agotó el plazo NO SHALL volver a abrirse por ese motivo.

Mientras dura una lectura, el event loop del worker SHALL seguir atendiendo el resto de su trabajo: las demás colas,
`GET /health`, `GET /health/live` y la renovación del bloqueo del propio job.

`extract-cv` SHALL ser una cola propia, distinta de la del enriquecimiento de links, con su concurrencia configurable
(`CV_EXTRACT_CONCURRENCY`, por defecto 1) y un `lockDuration` mayor que el plazo más el arranque y la gracia del
aislamiento, para que un CV legítimamente lento no se dé por `stalled` ni se reentregue. Con una concurrencia mayor que
1, el worker SHALL avisar al arrancar, en una línea sin datos de ningún CV, de que la memoria de lectura se multiplica.

#### Scenario: Extracción que no termina

- **GIVEN** un archivo que hace que el extractor no termine
- **WHEN** vence el plazo
- **THEN** el CV SHALL quedar en `failed` con motivo `unreadable_file` y el job SHALL completarse
- **AND** el job NO SHALL reintentarse

#### Scenario: El plazo detiene un bucle síncrono

- **GIVEN** un proceso de extracción que, tras anunciarse listo, ejecuta un bucle síncrono sin fin
- **WHEN** vence el plazo
- **THEN** el proceso SHALL haber terminado antes de que pase un segundo más
- **AND** ningún proceso de extracción SHALL seguir vivo después del desenlace

#### Scenario: El plazo empieza al anunciarse listo

- **GIVEN** un proceso de extracción que tarda en anunciarse listo menos que el plazo de arranque y responde antes del
  plazo de contenido contado desde ese momento
- **WHEN** termina la lectura
- **THEN** el desenlace SHALL ser el texto que publicó

#### Scenario: El worker responde mientras se lee un CV

- **GIVEN** un proceso de extracción que ejecuta un bucle síncrono
- **WHEN** se pide `GET /health/live` al worker antes de que venza el plazo
- **THEN** la respuesta SHALL llegar en menos de 1 s

#### Scenario: Un CV lento no para los links

- **GIVEN** un CV en extracción y links pendientes de enriquecer
- **WHEN** ambos trabajos están en curso
- **THEN** los links SHALL seguir procesándose por su propia cola

#### Scenario: Un CV lento no se duplica

- **GIVEN** una extracción que tarda casi todo el plazo
- **WHEN** termina
- **THEN** SHALL haberse ejecutado una sola vez y el job NO SHALL haberse reentregado por `stalled`

#### Scenario: Aviso con concurrencia mayor que 1

- **GIVEN** el worker configurado con `CV_EXTRACT_CONCURRENCY` igual a 2
- **WHEN** arranca
- **THEN** SHALL registrar un aviso sobre la memoria de lectura
- **AND** con `CV_EXTRACT_CONCURRENCY` igual a 1 NO SHALL registrarlo

## ADDED Requirements

### Requirement: La lectura corre aislada del proceso del worker

Cada lectura de un CV SHALL ejecutarse en un **proceso hijo nuevo**, que se termina al acabar y no se reutiliza para
otro CV. El proceso hijo SHALL arrancar:

- con un entorno sin ninguna variable del worker;
- con el modelo de permisos de Node activo, de modo que NO SHALL poder leer ficheros fuera de las rutas de la lista
  fijada en el design (design de `cv-extract-isolation`, D1: el script del hijo, la raíz de `node_modules` de la que
  resuelve sus bibliotecas y, solo si hace falta, el `package.json` del ámbito del script) —en particular, ni el entorno del
  worker a través de `/proc`—, ni escribir ficheros, ni lanzar procesos o hilos, ni cargar código nativo;
- con la generación de código desde cadenas desactivada;
- con el heap acotado a 256 MB de generación vieja y 16 MB por semiespacio;
- con su salida estándar y de errores descartadas: nada de lo que escriba SHALL llegar a los registros.

El proceso del worker SHALL arrancar con la activación del depurador por `SIGUSR1` desactivada
(`--disable-sigusr1`), tanto en la imagen como en `nx serve`, de modo que una señal del proceso hijo no abra el
inspector del worker. En la imagen, todo proceso Node que se lance en el contenedor del worker con su entorno (el
healthcheck, las sondas, una orden `exec`) SHALL heredar la misma desactivación, y `nx serve worker` NO SHALL arrancar
con el inspector abierto.

Este requirement NO promete cortar la red del proceso hijo: el mecanismo no lo permite en la versión de Node del
proyecto, y es un riesgo aceptado (ADR-058). Tampoco promete impedir que el hijo mande señales al worker, con el que
comparte usuario: una señal de terminación provoca el cierre ordenado y el reinicio del worker, y es una denegación de
servicio aceptada, acotada por `maxStalledCount: 1` (requirement «Consumo idempotente de la lectura del CV»).

El hijo SHALL anunciar que está listo antes de recibir los bytes, y su resultado SHALL llegar por un canal que el
worker lee sin poder fallar por su contenido. El desenlace SHALL clasificarse por las causas de esta tabla:

- **antes de anunciarse listo**, por la maquinaria —el script ausente, una biblioteca que no carga, la salida del hijo,
  5 s sin anunciarse, o un mensaje inválido—: fallo de infraestructura, que SHALL reintentarse según la política de la
  cola y, agotado, SHALL dejar el CV en `failed` con `internal_error`;
- **después de anunciarse listo**, por el contenido —plazo vencido, heap agotado, vigía de memoria, excepción del
  parser, tope de entrada superado, un mensaje inválido o la salida del hijo sin resultado—: `unreadable_file`, sin
  reintento.

El error de maquinaria SHALL llevar un mensaje fijo, sin causa encadenada ni texto que venga del hijo, salvo un código
de error que cumpla `^[A-Z0-9_]{1,64}$`. Un proceso hijo que termina por cualquiera de las causas de la tabla NO SHALL
terminar el proceso del worker.

#### Scenario: Heap agotado dentro del hijo

- **GIVEN** un proceso de extracción que reserva memoria del heap sin parar
- **WHEN** supera su límite
- **THEN** el CV SHALL quedar en `failed` con motivo `unreadable_file`
- **AND** el proceso del worker SHALL seguir vivo y consumiendo su cola

#### Scenario: El hijo sale por su cuenta

- **GIVEN** un proceso de extracción que termina con código 3 después de anunciarse listo
- **WHEN** el adaptador recibe su salida
- **THEN** el desenlace SHALL ser `unreadable_file`

#### Scenario: El hijo sale sin resultado

- **GIVEN** un proceso de extracción que termina con código 0 después de anunciarse listo, sin haber publicado resultado
- **WHEN** el adaptador recibe su salida
- **THEN** el desenlace SHALL ser `unreadable_file`

#### Scenario: Un mensaje inválido después de anunciarse listo

- **GIVEN** un proceso de extracción que, tras anunciarse listo, escribe en su canal una línea que no es del protocolo
- **WHEN** el adaptador la lee
- **THEN** el desenlace SHALL ser `unreadable_file`
- **AND** el proceso del worker SHALL seguir vivo

#### Scenario: Un segundo anuncio después de anunciarse listo

- **GIVEN** un proceso de extracción que, tras anunciarse listo, vuelve a anunciarse listo o publica un error de arranque
- **WHEN** el adaptador lo lee
- **THEN** el desenlace SHALL ser `unreadable_file`

#### Scenario: El resultado más largo llega entero

- **GIVEN** un proceso de extracción que publica 1.000.000 de caracteres cuya serialización ocupa el máximo posible
- **WHEN** el adaptador lo lee, en Linux o en Windows
- **THEN** el texto recibido SHALL ser idéntico al publicado

#### Scenario: Un mensaje inválido antes de anunciarse listo

- **GIVEN** un proceso de extracción que escribe en su canal una línea que no es del protocolo antes de anunciarse listo
- **WHEN** el adaptador la lee
- **THEN** el adaptador SHALL lanzar el error de maquinaria
- **AND** el proceso del worker SHALL seguir vivo

#### Scenario: El hijo no ve credenciales

- **GIVEN** el worker con variables de entorno de almacén y de IA definidas
- **WHEN** un proceso de extracción lee su `process.env`
- **THEN** SHALL encontrarlo sin ninguna de esas variables

#### Scenario: El hijo no lee el entorno del worker

- **GIVEN** un proceso de extracción en Linux
- **WHEN** intenta leer `/proc/<pid del worker>/environ` o un fichero fuera de sus rutas permitidas
- **THEN** la lectura SHALL fallar con acceso denegado

#### Scenario: El hijo no lanza procesos ni hilos

- **GIVEN** un proceso de extracción
- **WHEN** intenta lanzar un proceso o crear un hilo
- **THEN** SHALL fallar con acceso denegado

#### Scenario: Una señal del hijo no abre el depurador del worker

- **GIVEN** un proceso del worker lanzado como en la imagen, en Linux, y un proceso de extracción que, tras anunciarse
  listo, le manda `SIGUSR1`
- **WHEN** pasa medio segundo
- **THEN** el proceso del worker SHALL seguir vivo
- **AND** su inspector NO SHALL estar activo ni escuchar en el puerto de depuración que declara

#### Scenario: Una señal del hijo no abre el depurador de otro proceso del contenedor

- **GIVEN** un proceso Node hermano lanzado solo con el entorno de la imagen (sin el flag en su línea de órdenes), en
  Linux, y un proceso de extracción que, tras anunciarse listo, le manda `SIGUSR1`
- **WHEN** pasa medio segundo
- **THEN** el proceso hermano SHALL seguir vivo
- **AND** su inspector NO SHALL estar activo

#### Scenario: El worker se lanza sin el depurador por señal

- **WHEN** se revisan el `CMD` y el entorno de la imagen del worker y las opciones de `nx serve worker`
- **THEN** el `CMD` y las opciones de `nx serve worker` SHALL pasar `--disable-sigusr1` a Node
- **AND** el entorno de la imagen SHALL fijar `NODE_OPTIONS=--disable-sigusr1`
- **AND** `nx serve worker` SHALL arrancar sin el inspector abierto

#### Scenario: Lo que escribe el hijo no se registra

- **GIVEN** un proceso de extracción que escribe una cadena marcada en `stdout` y en `stderr`
- **WHEN** termina la lectura
- **THEN** ninguna línea de los registros capturados SHALL contener esa cadena

#### Scenario: El hijo no mete texto en el error

- **GIVEN** un proceso de extracción que, antes de anunciarse listo, publica un error con una cadena marcada en su
  código y en un campo extra
- **WHEN** el job falla por ese error de maquinaria
- **THEN** ni el mensaje del error, ni el motivo de fallo guardado en el job, ni los registros SHALL contener la cadena

#### Scenario: El script del hijo no existe

- **GIVEN** el adaptador configurado con una ruta de script inexistente
- **WHEN** el worker consume el evento de un CV en `pending`
- **THEN** el job SHALL fallar y reintentarse según la política de la cola
- **AND** el CV NO SHALL quedar en `failed` con `unreadable_file`

#### Scenario: Un hijo que no arranca agota sus intentos

- **GIVEN** un proceso de extracción que nunca se anuncia listo, en los tres intentos del job
- **WHEN** se agotan
- **THEN** el CV SHALL quedar en `failed` con motivo `internal_error`

#### Scenario: Un proceso por CV

- **GIVEN** dos CV leídos uno detrás de otro
- **WHEN** termina el segundo
- **THEN** cada uno SHALL haberse leído en un proceso distinto, y ninguno de los dos SHALL seguir vivo

#### Scenario: El cierre del worker no deja hijos

- **GIVEN** una lectura en curso
- **WHEN** el worker se cierra de forma ordenada
- **THEN** el proceso de extracción SHALL haber terminado

### Requirement: Topes de entrada y de memoria al leer

La lectura SHALL acotar lo que un archivo puede hacer consumir, además del plazo y del heap:

- un DOCX SHALL descomprimirse con un tope propio antes de entregarse a `mammoth`: como mucho **2.000 entradas** y
  **64 MiB** en total, contados sobre lo que **produce** el inflado (y el tamaño de las entradas sin comprimir), no
  sobre los tamaños que declara el archivo. Superar cualquiera de los dos, un ZIP64 que lo sea de verdad, una entrada
  cifrada, un método de compresión distinto de `stored` y `deflate`, un desplazamiento fuera del archivo o una
  cabecera local que no coincide con el directorio central SHALL dar `unreadable_file` sin inflar nada más. Un campo
  extra ZIP64 cuyos valores caben en 32 bits NO SHALL bastar para rechazar el archivo;
- un vigía SHALL terminar **el proceso hijo cuya** memoria residente crezca más de **512 MiB** sobre la que tenía al
  anunciarse listo, y el desenlace de esa lectura SHALL ser `unreadable_file`; las demás lecturas en curso NO SHALL
  verse afectadas. Donde el sistema no ofrece la memoria de otro proceso (sin `/proc`), el vigía SHALL desactivarse con
  un aviso y los demás topes SHALL seguir.

Los topes SHALL ser constantes del código del worker, no variables de entorno.

#### Scenario: Bomba de ZIP

- **GIVEN** un DOCX generado de menos de 5 MiB cuyo `word/document.xml` infla a más de 64 MiB
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `failed` con motivo `unreadable_file`, por el tope de inflado y no por el vigía
- **AND** la memoria residente del proceso del worker NO SHALL haber crecido más de 128 MiB durante la lectura

#### Scenario: Cabecera que miente

- **GIVEN** un DOCX generado cuyo directorio central declara 1 KiB para una entrada que infla a más de 64 MiB
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `failed` con motivo `unreadable_file`

#### Scenario: Demasiadas entradas

- **GIVEN** un DOCX generado con 2.001 entradas vacías
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `failed` con motivo `unreadable_file`

#### Scenario: Un DOCX normal cabe

- **GIVEN** el DOCX de texto de los fixtures de extracción, comprimido con `deflate`
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `extracted` con el mismo texto que el DOCX sin comprimir

#### Scenario: Un DOCX pequeño con campo extra ZIP64

- **GIVEN** el DOCX de texto de los fixtures con un campo extra ZIP64 cuyos valores caben en 32 bits
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `extracted`

#### Scenario: Memoria fuera del heap

- **GIVEN** un proceso de extracción que reserva búferes sin parar, fuera del heap de V8, en Linux
- **WHEN** su memoria residente supera en 512 MiB la que tenía al anunciarse listo
- **THEN** ese proceso SHALL terminarse y el desenlace SHALL ser `unreadable_file`
- **AND** el proceso del worker SHALL seguir vivo

#### Scenario: Una asignación enorme

- **GIVEN** un proceso de extracción que reserva y escribe búferes de 256 MiB sin parar, en Linux
- **WHEN** termina la lectura
- **THEN** el desenlace SHALL ser `unreadable_file`
- **AND** el proceso del worker SHALL seguir vivo y su memoria residente NO SHALL haber crecido más de 64 MiB

#### Scenario: Anidamiento profundo

- **GIVEN** un PDF generado con un array anidado 100.000 niveles
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `failed` con motivo `unreadable_file` o en `extracted`, antes del plazo
- **AND** el proceso del worker SHALL seguir vivo

#### Scenario: Expansión de entidades en el XML

- **GIVEN** un DOCX generado cuyo `word/document.xml` declara entidades anidadas que se expandirían a más de 1 GB
- **WHEN** el worker lo lee
- **THEN** la lectura SHALL terminar antes del plazo, en `failed` con `unreadable_file` o en `extracted` sin el texto
  expandido
- **AND** el proceso del worker SHALL seguir vivo

### Requirement: Métricas y registros de la lectura sin datos del CV

El worker SHALL publicar en `GET /metrics` un único contador de lecturas, `linkvault_cv_extractions_total`, con las
etiquetas `format` (`pdf`, `docx`), `outcome` (`text`, `unreadable`, `machinery_error`) y `cause`, cuyo valor SHALL
pertenecer al conjunto cerrado de su desenlace:

- con `text`: `none`, `pages_capped`, `raw_text_capped`;
- con `unreadable`: `parse_error`, `password`, `timeout`, `heap_limit`, `memory_ceiling`, `child_exit`,
  `input_budget`, `protocol`;
- con `machinery_error`: `boot_error`, `boot_timeout`, `protocol`.

Cada lectura que no termina en texto SHALL registrar una línea con formato, causa, duración y tamaño en bytes. Ninguna
etiqueta ni línea SHALL contener texto del CV, el nombre del archivo, su clave en el almacén, el mensaje de un error
del parser o del hijo, ni el detalle de una validación fallida; de un error de arranque solo SHALL registrarse su código
validado.

#### Scenario: Un plazo vencido se cuenta

- **GIVEN** una lectura de un PDF que vence el plazo
- **WHEN** se pide `GET /metrics` al worker
- **THEN** `linkvault_cv_extractions_total{format="pdf",outcome="unreadable",cause="timeout"}` SHALL haber subido en 1

#### Scenario: Un tope de páginas se cuenta

- **GIVEN** la lectura de un PDF de más de 50 páginas
- **WHEN** se pide `GET /metrics` al worker
- **THEN** `linkvault_cv_extractions_total{format="pdf",outcome="text",cause="pages_capped"}` SHALL haber subido en 1

#### Scenario: Las métricas no llevan el CV

- **GIVEN** lecturas terminadas de un PDF y un DOCX con un texto marcado y un nombre de archivo marcado
- **WHEN** se lee `GET /metrics`
- **THEN** el cuerpo NO SHALL contener ninguna palabra del texto marcado ni el nombre del archivo

#### Scenario: Un fallo del parser no se registra con su mensaje

- **GIVEN** un PDF generado que hace lanzar al parser un error cuyo mensaje contiene una cadena del documento
- **WHEN** el worker lo lee con el registro capturado a nivel `debug`
- **THEN** ninguna línea SHALL contener esa cadena
- **AND** la línea del caso de uso SHALL nombrar el CV por su identificador y el motivo `unreadable_file`

### Requirement: La imagen publicada lee un CV

El build del worker SHALL producir una entrada `cv-extract-probe.js` que genere en memoria un PDF y un DOCX de texto
sin datos personales, los lea con el adaptador aislado real (proceso hijo con sus permisos) y salga con código 0 solo
si los dos devuelven texto con el número de caracteres esperado, imprimiendo recuentos y nunca texto. La verificación
del artefacto SHALL ejecutarla dentro de la imagen del worker construida, y SHALL fallar si sale con código distinto
de 0.

El script del proceso hijo NO SHALL importar el framework del worker, su registro ni su configuración, y el
`package.json` generado del worker SHALL fijar las bibliotecas de lectura a versión exacta.

#### Scenario: La sonda pasa en la imagen

- **GIVEN** la imagen del worker construida para la arquitectura del destino
- **WHEN** la verificación del artefacto ejecuta `node cv-extract-probe.js` dentro de ella
- **THEN** SHALL salir con código 0 e imprimir los caracteres leídos de cada formato

#### Scenario: Sin el script del hijo, la verificación falla

- **GIVEN** una imagen del worker sin el script del proceso hijo de extracción
- **WHEN** la verificación del artefacto ejecuta la sonda
- **THEN** la sonda SHALL salir con código distinto de 0
- **AND** la verificación SHALL fallar nombrando la sonda de lectura de CV

#### Scenario: El hijo no carga el worker

- **GIVEN** el script del proceso hijo construido
- **WHEN** se revisan sus imports
- **THEN** NO SHALL importar `@nestjs/*`, `pino` ni el módulo de configuración del worker
