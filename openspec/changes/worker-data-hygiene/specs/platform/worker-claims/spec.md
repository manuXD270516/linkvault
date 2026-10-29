## Purpose

Define las marcas que usan los detectores periódicos del worker —frescura de links, aviso de grupo por auto-expire
(ASN) y postulaciones estancadas— para que, con cualquier número de réplicas corriendo los mismos crons a la vez, cada
clave se procese una sola vez, ninguna toma ajena se pierda por error, las tomas abandonadas caduquen sin que caduque
ningún «ya se avisó» y los datos existentes migren sin perder ninguno (ADR-061).

## ADDED Requirements

### Requirement: Toma atómica de una marca con clave única

Cada colección de marcas del worker SHALL tener un índice único sobre su clave: `linkId` en `link_freshness_claims`, y
`applicationId` + `statusChangedAt` en `application_status_group_notify_claims` y `application_stale_claims`. Tomar una
marca SHALL ser una única operación atómica que solo tiene éxito si la marca no existe o está libre (su lease venció y,
en ASN y stale, no está confirmada); una marca ocupada o confirmada SHALL responderse como «no tomada», sin error. Con
cualquier número de réplicas intentando tomar la misma clave a la vez, SHALL ganar exactamente una. El lease de una toma
SHALL contarse desde el instante en que se toma, no desde el comienzo de la pasada. Cada toma SHALL llevar un testigo
propio, y liberar una marca SHALL borrar solo la toma con ese testigo y sin confirmar. Confirmar un aviso de ASN o de
stale SHALL dejar la marca confirmada aunque la toma propia haya vencido o la marca haya sido liberada por otra réplica.

#### Scenario: Dos réplicas toman la misma clave a la vez

- **GIVEN** dos réplicas del worker con conexiones distintas y ninguna marca para la postulación P con su `statusChangedAt`
- **WHEN** las dos intentan tomar la marca de stale de esa clave al mismo tiempo
- **THEN** exactamente una SHALL obtener la toma
- **AND** la colección SHALL contener un solo documento para esa clave

#### Scenario: Dos réplicas corren el detector de stale a la vez

- **GIVEN** 30 postulaciones estancadas sin avisar y dos réplicas del worker
- **WHEN** las dos ejecutan el detector de stale al mismo tiempo
- **THEN** cada postulación SHALL encolarse una sola vez entre las dos réplicas
- **AND** SHALL quedar exactamente una marca confirmada por postulación

#### Scenario: Marca ocupada

- **GIVEN** una marca tomada hace 10 segundos con un lease de 60 segundos
- **WHEN** otra réplica intenta tomarla
- **THEN** la respuesta SHALL ser «no tomada» y NO SHALL lanzarse un error

#### Scenario: Marca vencida tomada por una sola réplica

- **GIVEN** una marca sin confirmar cuyo lease venció
- **WHEN** dos réplicas intentan tomarla a la vez
- **THEN** exactamente una SHALL obtener la toma

#### Scenario: Toma tardía en una pasada lenta

- **GIVEN** una pasada que empezó hace 50 minutos y toma ahora la marca de la clave K con un lease de 10 minutos
- **WHEN** otra réplica intenta tomar K enseguida
- **THEN** la respuesta SHALL ser «no tomada»

#### Scenario: Marca confirmada

- **GIVEN** una marca de ASN confirmada para la postulación P con su `statusChangedAt`
- **WHEN** una réplica intenta tomarla
- **THEN** la respuesta SHALL ser «no tomada»

#### Scenario: Liberar no borra una toma ajena

- **GIVEN** la réplica A tomó una marca, su lease venció y la réplica B la tomó después
- **WHEN** A libera su toma porque su encolado falló
- **THEN** la marca de B SHALL seguir existiendo con el testigo de B

#### Scenario: Confirmar tras perder el lease conserva el aviso

- **GIVEN** la réplica A tomó una marca de stale, encoló el aviso y su lease venció antes de confirmar, y B la tomó
- **WHEN** A confirma y después B libera porque su encolado falló
- **THEN** la marca SHALL quedar confirmada

#### Scenario: Confirmar después de que la otra réplica liberó

- **GIVEN** la réplica A tomó una marca de stale y encoló el aviso, su lease venció, B la tomó y B la liberó porque su encolado falló
- **WHEN** A confirma
- **THEN** la marca SHALL existir y estar confirmada

#### Scenario: Frescura no se repite en el mismo tick

- **GIVEN** la réplica A procesó y confirmó el link L hace 2 minutos
- **WHEN** la réplica B, en el mismo tick, intenta tomar la marca de L
- **THEN** la respuesta SHALL ser «no tomada»
- **AND** en el tick siguiente, una hora después, la marca de L SHALL poder tomarse

#### Scenario: Frescura liberada tras un fallo

- **GIVEN** una réplica tomó la marca del link L y el efecto falló
- **WHEN** libera su toma
- **THEN** la marca de L SHALL poder tomarse de nuevo enseguida

### Requirement: Las tomas abandonadas caducan y las marcas duraderas no

Una marca sin confirmar —una toma en curso o abandonada, o una marca de frescura, que nunca se confirma como duradera—
SHALL llevar un instante de caducidad (`leaseUntil`) y SHALL borrarse automáticamente 24 horas después de él. Una marca
confirmada de ASN o de stale NO SHALL caducar por tiempo, lleve o no un `leaseUntil`, porque es el registro de que el
aviso ya se emitió.

#### Scenario: Toma abandonada

- **GIVEN** una toma sin confirmar cuyo `leaseUntil` pasó hace más de 24 horas
- **WHEN** corre el monitor de caducidad de Mongo
- **THEN** la marca SHALL desaparecer

#### Scenario: Aviso ya emitido

- **GIVEN** una marca de stale confirmada hace 400 días para una postulación que no cambió de estado
- **WHEN** corre el monitor de caducidad de Mongo
- **THEN** la marca SHALL seguir existiendo
- **AND** el detector NO SHALL volver a avisar por esa postulación

#### Scenario: Confirmada con un leaseUntil pasado

- **GIVEN** una marca de ASN confirmada que conserva un `leaseUntil` de hace 2 días, escrita por una réplica de la versión anterior
- **WHEN** corre el monitor de caducidad de Mongo
- **THEN** la marca SHALL seguir existiendo

### Requirement: Índices antes del primer tick, con migración de los datos existentes

Al arrancar y antes del primer tick de sus detectores, el worker SHALL, por cada colección de marcas, completar el
instante de caducidad de las marcas existentes sin confirmar que no lo tengan, eliminar los duplicados de una misma
clave conservando de forma determinista una confirmada si la hay, y crear sus índices. Ningún error de esta migración
SHALL impedir que el worker arranque. Si al final no existe el índice único de una colección, los detectores que usan
esa colección —el de frescura usa también la de ASN— NO SHALL ejecutar su tick, SHALL registrar un aviso que nombra la
colección y SHALL reintentar la migración en el tick siguiente; el resto del worker SHALL seguir procesando sus colas.
Una marca escrita por la versión anterior, sin instante de caducidad, SHALL poder tomarse cuando su lease contado desde
su `claimedAt` haya vencido.

#### Scenario: Duplicados heredados con una confirmada

- **GIVEN** dos documentos de stale para la misma postulación y el mismo `statusChangedAt`, uno confirmado y otro no
- **WHEN** arranca el worker
- **THEN** SHALL quedar un solo documento, el confirmado
- **AND** SHALL existir el índice único de la clave

#### Scenario: Dos réplicas arrancan a la vez sobre duplicados

- **GIVEN** duplicados en las tres colecciones de marcas
- **WHEN** dos réplicas arrancan al mismo tiempo
- **THEN** las dos SHALL terminar con los índices creados
- **AND** cada clave SHALL conservar el mismo superviviente que con una sola réplica

#### Scenario: Índice imposible de crear

- **GIVEN** que la creación del índice único de `application_stale_claims` falla en cada intento
- **WHEN** llega el tick del detector de stale
- **THEN** el detector NO SHALL encolar ningún aviso en ese tick
- **AND** SHALL registrarse un aviso que nombra la colección
- **AND** las colas de enriquecimiento SHALL seguir consumiéndose

#### Scenario: Error inesperado al crear un índice

- **GIVEN** que la creación de un índice de marcas falla con un error que no es de clave duplicada
- **WHEN** arranca el worker
- **THEN** el worker SHALL terminar de arrancar
- **AND** SHALL registrarse un aviso con la colección y el código del error, sin claves ni documentos

#### Scenario: Compuerta de ASN cerrada

- **GIVEN** que no existe el índice único de `application_status_group_notify_claims` y sí el de `link_freshness_claims`
- **WHEN** llega el tick del detector de frescura
- **THEN** el detector NO SHALL ejecutar el tick
- **AND** SHALL registrarse un aviso que nombra `application_status_group_notify_claims`

#### Scenario: Marca heredada sin caducidad

- **GIVEN** una marca de frescura sin `leaseUntil` escrita por la versión anterior con `claimedAt` hace 5 minutos y lease de 60 segundos
- **WHEN** una réplica nueva intenta tomarla
- **THEN** SHALL obtener la toma
