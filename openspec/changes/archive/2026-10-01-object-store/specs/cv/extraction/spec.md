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

### Requirement: El borrado del archivo también se consume de la cola

El consumidor de `delete-cv-file` SHALL borrar del almacén de objetos el archivo del CV nombrado por el evento
`CvDeleted.v1`, componiendo su clave con la misma función que la usó al guardarlo. Borrar un objeto que ya no está SHALL
considerarse un acierto, de modo que consumir el evento dos veces SHALL ser inofensivo. Un fallo del almacén SHALL
reintentarse según la política de la cola y NO SHALL dar el borrado por hecho. Que **el bucket de CV no exista** NO
SHALL contar como objeto ya borrado: SHALL tratarse como fallo del almacén, porque con un bucket mal nombrado el
archivo real seguiría en el suyo.

#### Scenario: El archivo desaparece

- **GIVEN** un CV borrado y su evento publicado
- **WHEN** el worker lo consume
- **THEN** el objeto NO SHALL existir en el bucket

#### Scenario: El mismo borrado dos veces

- **WHEN** el evento se consume dos veces
- **THEN** la segunda vez SHALL completarse sin error

#### Scenario: El almacén no responde

- **GIVEN** el almacén de objetos caído
- **WHEN** el worker consume el evento
- **THEN** el job SHALL fallar y reintentarse, y el objeto SHALL borrarse cuando el almacén vuelva

#### Scenario: El bucket de CV no existe al borrar

- **GIVEN** el almacén respondiendo que el bucket de CV no existe
- **WHEN** el worker consume un evento de borrado
- **THEN** el job SHALL fallar y reintentarse
- **AND** el borrado NO SHALL darse por hecho
