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
lectura reabra el archivo como mucho una vez más. Un job que la cola da por perdido por `stalled` por encima de ese
límite SHALL dejar el CV en `failed` con motivo `internal_error`, aunque no haya agotado sus intentos: NO SHALL quedar
en `pending` indefinidamente.

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

### Requirement: Texto extraído, normalizado y acotado

El worker SHALL extraer el texto del PDF con pdf.js de Mozilla en una versión mantenida (paquete `pdfjs-dist`, o
`unpdf` si el spike del change lo decide), fijada a versión exacta en `package.json`, y el del DOCX con `mammoth`. El
worker NO SHALL depender de `pdf-parse`. pdf.js SHALL ejecutarse con la evaluación de código desactivada
(`isEvalSupported: false`), sin fuentes del sistema y sin ninguna URL remota.

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

#### Scenario: El texto conserva su forma con el parser nuevo

- **GIVEN** los PDF de texto generados por los fixtures de extracción
- **WHEN** el worker los lee
- **THEN** el texto normalizado SHALL ser igual, línea a línea, al que producía `pdf-parse` sobre los mismos archivos

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

#### Scenario: La dependencia vieja no vuelve

- **GIVEN** el `package.json` raíz y el código del worker
- **WHEN** se revisan sus dependencias e imports
- **THEN** ninguno SHALL nombrar `pdf-parse`
- **AND** la versión del parser de PDF SHALL estar escrita sin `^` ni `~`

### Requirement: La lectura tiene plazo y no monopoliza el worker

La extracción de un CV SHALL tener un plazo configurable (`CV_EXTRACTION_TIMEOUT_MS`, por defecto 30 s) que **detiene**
el trabajo: al vencer, el hilo que lee el archivo SHALL terminarse, el CV SHALL quedar en `failed` con motivo
`unreadable_file` y el job SHALL completarse **sin reintentos**. Un archivo que agotó el plazo NO SHALL volver a abrirse
por ese motivo.

Mientras dura una lectura, el event loop del worker SHALL seguir atendiendo el resto de su trabajo: las demás colas,
`GET /health`, `GET /health/live` y la renovación del bloqueo del propio job.

`extract-cv` SHALL ser una cola propia, distinta de la del enriquecimiento de links, con su concurrencia configurable
(`CV_EXTRACT_CONCURRENCY`, por defecto 1) y un `lockDuration` mayor que el plazo, para que un CV legítimamente lento no
se dé por `stalled` ni se reentregue.

#### Scenario: Extracción que no termina

- **GIVEN** un archivo que hace que el extractor no termine
- **WHEN** vence el plazo
- **THEN** el CV SHALL quedar en `failed` con motivo `unreadable_file` y el job SHALL completarse
- **AND** el job NO SHALL reintentarse

#### Scenario: El plazo detiene un bucle síncrono

- **GIVEN** un hilo de extracción que ejecuta un bucle síncrono sin fin
- **WHEN** vence el plazo
- **THEN** el hilo SHALL haber emitido su salida (`exit`) antes de que pase un segundo más
- **AND** ningún hilo de extracción SHALL seguir vivo después del desenlace

#### Scenario: El worker responde mientras se lee un CV

- **GIVEN** un hilo de extracción que ejecuta un bucle síncrono sin fin
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

## ADDED Requirements

### Requirement: La lectura corre aislada del proceso del worker

Cada lectura de un CV SHALL ejecutarse en un hilo (`worker_threads`) **nuevo**, que se termina al acabar y no se
reutiliza para otro CV. El hilo SHALL arrancar con:

- heap acotado (`resourceLimits`: 256 MB de generación vieja, 32 MB de joven, 4 MB de pila);
- un entorno vacío (`env: {}`), sin argumentos de ejecución heredados: NO SHALL poder leer ninguna variable de entorno
  del worker;
- su salida estándar y de errores capturadas y descartadas: nada de lo que escriba el hilo SHALL llegar a los registros.

El hilo SHALL anunciar que está listo antes de recibir los bytes. El desenlace SHALL clasificarse así:

- **por el contenido** —plazo vencido, heap agotado, vigía de memoria, excepción del parser, tope de entrada superado, o
  el hilo que termina tras anunciarse listo—: `unreadable_file`, sin reintento;
- **por la maquinaria** —el script del hilo ausente, el hilo que no se anuncia listo en 5 s, una biblioteca que no
  carga, un mensaje fuera del protocolo—: fallo de infraestructura, que SHALL reintentarse según la política de la cola
  y, agotado, SHALL dejar el CV en `failed` con `internal_error`.

Un hilo que muere, por cualquier causa, NO SHALL terminar el proceso del worker.

#### Scenario: Heap agotado dentro del hilo

- **GIVEN** un hilo de extracción que reserva memoria del heap sin parar
- **WHEN** supera su límite
- **THEN** el CV SHALL quedar en `failed` con motivo `unreadable_file`
- **AND** el proceso del worker SHALL seguir vivo y consumiendo su cola

#### Scenario: El hilo sale por su cuenta

- **GIVEN** un hilo de extracción que termina con código 3 después de anunciarse listo
- **WHEN** el adaptador recibe su salida
- **THEN** el desenlace SHALL ser `unreadable_file`

#### Scenario: El hilo no ve credenciales

- **GIVEN** el worker con variables de entorno de almacén y de IA definidas
- **WHEN** un hilo de extracción lee `process.env`
- **THEN** SHALL encontrarlo sin ninguna de esas variables

#### Scenario: Lo que escribe el hilo no se registra

- **GIVEN** un hilo de extracción que escribe una cadena marcada en `stdout` y en `stderr`
- **WHEN** termina la lectura
- **THEN** ninguna línea de los registros capturados SHALL contener esa cadena

#### Scenario: El script del hilo no existe

- **GIVEN** el adaptador configurado con una ruta de script inexistente
- **WHEN** el worker consume el evento de un CV en `pending`
- **THEN** el job SHALL fallar y reintentarse según la política de la cola
- **AND** el CV NO SHALL quedar en `failed` con `unreadable_file`

#### Scenario: Un hilo que no arranca agota sus intentos

- **GIVEN** un hilo de extracción que nunca se anuncia listo, en los tres intentos del job
- **WHEN** se agotan
- **THEN** el CV SHALL quedar en `failed` con motivo `internal_error`

#### Scenario: Un hilo por CV

- **GIVEN** dos CV leídos uno detrás de otro
- **WHEN** termina el segundo
- **THEN** cada uno SHALL haberse leído en un hilo distinto, y ninguno de los dos hilos SHALL seguir vivo

### Requirement: Topes de entrada y de memoria al leer

La lectura SHALL acotar lo que un archivo puede hacer consumir, además del plazo y del heap:

- un DOCX SHALL descomprimirse con un tope propio antes de entregarse a `mammoth`: como mucho **2.000 entradas** y
  **64 MiB** inflados en total, contados sobre lo que **produce** el inflado y no sobre los tamaños que declara el
  archivo. Superar cualquiera de los dos, o un ZIP64, una entrada cifrada, un método de compresión distinto de
  `stored` y `deflate`, o un desplazamiento fuera del archivo, SHALL dar `unreadable_file` sin inflar nada más;
- un vigía SHALL terminar el hilo si la memoria residente del proceso crece más de **512 MiB** sobre la que tenía al
  empezar la lectura, y el desenlace SHALL ser `unreadable_file`.

Los topes SHALL ser constantes del código del worker, no variables de entorno.

#### Scenario: Bomba de ZIP

- **GIVEN** un DOCX generado de menos de 5 MiB cuyo `word/document.xml` infla a más de 64 MiB
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `failed` con motivo `unreadable_file`
- **AND** la memoria residente del proceso NO SHALL haber crecido más de 128 MiB durante la lectura

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

#### Scenario: Memoria fuera del heap

- **GIVEN** un hilo de extracción que reserva búferes sin parar, fuera del heap de V8
- **WHEN** la memoria residente del proceso supera en 512 MiB la del comienzo de la lectura
- **THEN** el hilo SHALL terminarse y el desenlace SHALL ser `unreadable_file`
- **AND** el proceso del worker SHALL seguir vivo

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

El worker SHALL publicar en `GET /metrics`:

- `linkvault_cv_extractions_total` con las etiquetas `format` (`pdf`, `docx`), `outcome` (`text`, `unreadable`,
  `machinery_error`) y `cause` (`none`, `parse_error`, `password`, `timeout`, `heap_limit`, `memory_ceiling`,
  `thread_exit`, `input_budget`, `boot_error`, `boot_timeout`, `protocol`);
- `linkvault_cv_extraction_duration_seconds`, histograma con las etiquetas `format` y `outcome`;
- `linkvault_cv_extraction_capped_total` con las etiquetas `format` y `cap` (`pages`, `raw_text`).

Cada hilo terminado por plazo, heap, vigía o salida, y cada fallo de maquinaria, SHALL registrar una línea con formato,
causa, duración y tamaño en bytes. Ninguna etiqueta ni línea SHALL contener texto del CV, el nombre del archivo, su
clave en el almacén ni el mensaje de un error del parser o del hilo; de un error de arranque solo SHALL registrarse su
código.

#### Scenario: Un plazo vencido se cuenta

- **GIVEN** una lectura que vence el plazo
- **WHEN** se pide `GET /metrics` al worker
- **THEN** `linkvault_cv_extractions_total{format="pdf",outcome="unreadable",cause="timeout"}` SHALL haber subido en 1

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
sin datos personales, los lea con el adaptador aislado real y salga con código 0 solo si los dos devuelven texto con el
número de caracteres esperado, imprimiendo recuentos y nunca texto. La verificación del artefacto SHALL ejecutarla
dentro de la imagen del worker construida, y SHALL fallar si sale con código distinto de 0.

#### Scenario: La sonda pasa en la imagen

- **GIVEN** la imagen del worker construida para la arquitectura del destino
- **WHEN** la verificación del artefacto ejecuta `node cv-extract-probe.js` dentro de ella
- **THEN** SHALL salir con código 0 e imprimir los caracteres leídos de cada formato

#### Scenario: Sin el bundle del hilo, la verificación falla

- **GIVEN** una imagen del worker sin el script del hilo de extracción
- **WHEN** la verificación del artefacto ejecuta la sonda
- **THEN** la sonda SHALL salir con código distinto de 0
- **AND** la verificación SHALL fallar nombrando la sonda de lectura de CV
