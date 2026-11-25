## Purpose

«La semana del grupo»: una tabla de hechos sobre las ofertas de cada grupo, calculada una vez por semana ISO UTC en el
worker, con viñetas por plantilla que citan esos hechos, un evaluador determinista que verifica cada viñeta y una
lectura de solo lectura en la api. Solo usa datos de las ofertas; nunca datos de lo que hace cada miembro.

## ADDED Requirements

### Requirement: Cálculo semanal en el worker, una vez por grupo y semana

Con `FEATURE_GROUP_BRIEF` en `true` (valor por defecto si la variable falta), el worker SHALL ejecutar un tick a las
05:00 UTC de cada día y otro al arrancar. Cada tick SHALL calcular la semana del grupo, para la semana ISO UTC en curso
(`weekKey` = `isoWeekKey(now)`, `asOf` = fecha UTC de `now`), **solo** para los grupos que todavía no tienen documento
de esa `weekKey` en `group_weekly_briefs`, y SHALL insertarla con índice único `(groupId, weekKey)`. Una semana ya
guardada NO SHALL recalcularse ni reescribirse. Un error de clave duplicada SHALL tratarse como «ya existe», sin error.
Si el cálculo no produce ninguna viñeta, NO SHALL guardarse nada y el grupo SHALL volver a intentarse en el tick
siguiente. Con `FEATURE_GROUP_BRIEF` en `false` NO SHALL registrarse el cron ni el tick de arranque. En `NODE_ENV=test`
NO SHALL registrarse ninguno de los dos. Un tick NO SHALL empezar mientras otro del mismo proceso sigue en curso. El
cálculo NO SHALL llamar a ningún proveedor de IA ni enviar correos o avisos.

#### Scenario: El lunes se calcula la semana de cada grupo

- **GIVEN** los grupos G1 y G2 con ofertas abiertas, sin documentos de `2026-W48`, y el reloj en el lunes 2026-11-23
  05:00 UTC
- **WHEN** corre el tick
- **THEN** SHALL existir un documento para `(G1, 2026-W48)` y otro para `(G2, 2026-W48)`, ambos con `asOf`
  `2026-11-23`

#### Scenario: Un segundo tick de la misma semana no cambia nada

- **GIVEN** el documento de `(G1, 2026-W48)` guardado el lunes, y el martes G1 recibe tres ofertas nuevas
- **WHEN** corre el tick del martes
- **THEN** el documento de `(G1, 2026-W48)` SHALL seguir idéntico, con el mismo `computedAt`

#### Scenario: Dos ticks a la vez

- **GIVEN** dos ejecuciones del cálculo de la misma semana que empiezan a la vez sobre G1
- **WHEN** terminan las dos
- **THEN** SHALL existir exactamente un documento para `(G1, weekKey)` y ninguna de las dos SHALL terminar con error

#### Scenario: Grupo sin viñetas se reintenta al día siguiente

- **GIVEN** un grupo creado el miércoles sin ofertas
- **WHEN** corre el tick del jueves
- **THEN** NO SHALL guardarse documento para ese grupo
- **AND** si el viernes el grupo tiene una oferta que cierra en 3 días, el tick del sábado SHALL guardar su semana con
  `asOf` del sábado

#### Scenario: Worker caído el lunes

- **GIVEN** el worker detenido durante todo el lunes y ningún documento de la semana en curso
- **WHEN** el worker arranca el martes
- **THEN** el tick de arranque SHALL calcular la semana en curso de los grupos con viñetas

#### Scenario: Feature apagada

- **GIVEN** `FEATURE_GROUP_BRIEF=false`
- **WHEN** arranca el worker y llegan las 05:00 UTC
- **THEN** NO SHALL escribirse ningún documento en `group_weekly_briefs`

#### Scenario: Valor por defecto

- **GIVEN** un entorno del worker sin `FEATURE_GROUP_BRIEF`
- **WHEN** se carga la configuración
- **THEN** `FEATURE_GROUP_BRIEF` SHALL valer `true` y el worker SHALL arrancar

### Requirement: Tabla de hechos solo con datos de las ofertas

El cálculo de un grupo SHALL leer como mucho sus 500 `group_links` más recientes por `sharedAt` (marcando
`scanTruncated` si hay más) con proyección `linkId` y `sharedAt`, y de cada link solo `closedAt`, `preview.expiresAt` y
`preview.skills`, en dos lecturas sea cual sea el número de ofertas. Una oferta SHALL considerarse **abierta** si no
tiene `closedAt` y su `expiresAt` es `null` o no anterior a `asOf`. Los hechos SHALL ser:

- `open_offers`: las abiertas, con `count` y `linkIds`;
- `closing_soon`: las abiertas con `expiresAt` entre `asOf` y `asOf` + 6 días, ambos incluidos, con `from` = `asOf` y
  `until` = `asOf` + 6 días; solo si hay al menos una;
- `skill_demand:<skillKey>`: por habilidad mencionada en al menos 2 abiertas, con `skillKey` (nombre en NFKC,
  recortado, con espacios colapsados y en minúsculas; vacío o de más de 60 caracteres se ignora), `skillLabel` (la
  forma original más frecuente; empate, la menor por unidades de código), `count` (ofertas que la mencionan, una vez
  por oferta), `total` (abiertas con al menos una habilidad válida) y `linkIds`; como mucho 5, por `count` desc y
  `skillKey` asc;
- `shared_last_week`: los `group_links` con `sharedAt` en la semana ISO anterior a `weekKey`, abiertos o no, con su
  `weekKey`; solo si hay al menos uno;
- `closed_last_week`: las ofertas del grupo con `closedAt` en la semana ISO anterior a `weekKey`, con su `weekKey`;
  solo si hay al menos una.

Cada lista de `linkIds` SHALL ir en el orden `sharedAt` desc e identificador desc, sin repetidos. El cálculo NO SHALL
leer `applications`, `knowSomeoneUserIds`, `note`, `tags`, `pinned`, `sharedBy`, comentarios ni datos de usuarios, y el
documento guardado NO SHALL contener ningún identificador, nombre o texto escrito por un miembro.

#### Scenario: Abiertas y cierre de calendario

- **GIVEN** con `asOf` `2026-11-23`, una oferta sin `closedAt` ni `expiresAt`, otra con `expiresAt` `2026-11-20` sin
  `closedAt` y otra con `closedAt`
- **WHEN** se calculan los hechos
- **THEN** `open_offers` SHALL tener `count` 1 con solo la primera

#### Scenario: Ventana de cierre de siete días

- **GIVEN** con `asOf` `2026-11-23`, ofertas abiertas con `expiresAt` `2026-11-23`, `2026-11-29` y `2026-11-30`
- **WHEN** se calculan los hechos
- **THEN** `closing_soon` SHALL tener `count` 2 con las dos primeras, `from` `2026-11-23` y `until` `2026-11-29`

#### Scenario: Habilidades normalizadas y denominador honesto

- **GIVEN** siete abiertas con habilidades leídas, de las que cuatro mencionan «Docker», «docker », «DOCKER» y
  «Docker» (una de ellas dos veces), y dos abiertas sin habilidades
- **WHEN** se calculan los hechos
- **THEN** SHALL existir `skill_demand:docker` con `skillLabel` «Docker», `count` 4 y `total` 7

#### Scenario: Una habilidad en una sola oferta no es hecho

- **GIVEN** «Rust» mencionada solo en una oferta abierta
- **WHEN** se calculan los hechos
- **THEN** NO SHALL existir `skill_demand:rust`

#### Scenario: Semana anterior

- **GIVEN** con `weekKey` `2026-W48`, dos `group_links` con `sharedAt` en `2026-W47` (uno de ellos ya cerrado), uno en
  `2026-W46`, y una oferta del grupo con `closedAt` en `2026-W47`
- **WHEN** se calculan los hechos
- **THEN** `shared_last_week` SHALL tener `count` 2 y `weekKey` `2026-W47`
- **AND** `closed_last_week` SHALL tener `count` 1 y `weekKey` `2026-W47`

#### Scenario: Nada de los miembros en el documento

- **GIVEN** un grupo de Ana y Beto con una oferta compartida por Ana con nota «me la pasó mi primo», la etiqueta
  «favorita», un comentario de Beto, la marca «conozco a alguien» de Beto y una postulación privada de Ana
- **WHEN** se guarda la semana del grupo
- **THEN** la serialización JSON del documento NO SHALL contener el identificador de Ana ni el de Beto, sus nombres,
  «me la pasó mi primo», «favorita» ni el texto del comentario
- **AND** el cálculo NO SHALL haber leído la colección `applications`

#### Scenario: Grupo con más de 500 links

- **GIVEN** un grupo con 520 links
- **WHEN** se calcula su semana
- **THEN** los hechos SHALL cubrir los 500 más recientes y el documento SHALL tener `scanTruncated` `true`

### Requirement: Viñetas por plantilla que citan hechos

Cada viñeta SHALL ser `{ factId, source: 'template' }`, sin texto ni números propios, y SHALL citar un hecho del mismo
documento. La selección SHALL ser determinista, en este orden y saltando lo que no existe: `closing_soon`, el primer
`skill_demand`, `shared_last_week`, `closed_last_week`, el segundo `skill_demand`. SHALL haber como mucho 5 viñetas y
como mucho 2 de habilidad. `open_offers` NO SHALL ser viñeta. Con los mismos datos y el mismo reloj, el resultado SHALL
ser idéntico.

#### Scenario: Orden y tope

- **GIVEN** hechos `closing_soon`, tres `skill_demand`, `shared_last_week` y `closed_last_week`
- **WHEN** se seleccionan las viñetas
- **THEN** SHALL ser 5, en el orden `closing_soon`, primer `skill_demand`, `shared_last_week`, `closed_last_week`,
  segundo `skill_demand`
- **AND** el tercer `skill_demand` NO SHALL ser viñeta

#### Scenario: Solo habilidades

- **GIVEN** solo `open_offers` y un `skill_demand`
- **WHEN** se seleccionan las viñetas
- **THEN** SHALL haber una viñeta, la del `skill_demand`

#### Scenario: Determinista

- **GIVEN** el mismo universo de ofertas y el mismo reloj
- **WHEN** se calculan los hechos y las viñetas dos veces
- **THEN** los dos resultados SHALL ser iguales campo a campo

### Requirement: Evaluador determinista de la semana

`verifyGroupWeeklyBrief` SHALL aceptar una semana solo si: los `factId` son únicos, hay exactamente un `open_offers` y
cada `factId` corresponde a su `kind`; cada viñeta cita un hecho existente distinto de `open_offers`, sin repetidas, de
1 a 5 y como mucho 2 de habilidad; en cada hecho `count` es igual al número de `linkIds`, sin repetidos; los `linkIds`
de `closing_soon` y de cada `skill_demand` están entre los de `open_offers`; en `skill_demand` se cumple `2 ≤ count ≤
total ≤` el `count` de `open_offers`; `closing_soon` tiene `from` = `asOf` y `until` = `asOf` + 6 días; y los
`weekKey` de `shared_last_week` y `closed_last_week` son la semana anterior a la del documento. Si no, SHALL devolver
las violaciones con un código por cada una. El worker NO SHALL guardar una semana que no pase, y la api NO SHALL
servirla. El registro de una violación SHALL incluir solo `groupId`, `weekKey` y los códigos, nunca el contenido.

#### Scenario: Semana válida

- **GIVEN** una semana calculada por el worker a partir de cualquier universo de ofertas
- **WHEN** se verifica
- **THEN** el resultado SHALL ser válido

#### Scenario: Viñeta que cita un hecho inexistente

- **GIVEN** una semana con una viñeta `skill_demand:kotlin` y sin ese hecho
- **WHEN** se verifica
- **THEN** SHALL ser inválida con la violación `bullet_fact_missing`

#### Scenario: Número que no coincide

- **GIVEN** un `closing_soon` con `count` 3 y dos `linkIds`
- **WHEN** se verifica
- **THEN** SHALL ser inválida con la violación `count_mismatch`

#### Scenario: Oferta fuera de las abiertas

- **GIVEN** un `skill_demand` con un `linkId` que no está en `open_offers`
- **WHEN** se verifica
- **THEN** SHALL ser inválida con la violación `not_subset_of_open`

#### Scenario: El worker no guarda una semana inválida

- **GIVEN** un cálculo cuyo resultado no pasa el evaluador
- **WHEN** termina el tick
- **THEN** NO SHALL existir documento para ese grupo y semana
- **AND** el log SHALL registrar el `groupId`, la `weekKey` y los códigos de violación, sin títulos ni habilidades

### Requirement: Lectura de la semana del grupo

`GET /api/groups/:id/weekly-brief` SHALL responder a un miembro del grupo `200` con `weekKey` (la semana ISO UTC en
curso según el reloj de la api) y `brief`. `brief` SHALL ser `null` si no hay documento de esa semana o si el documento
no pasa el schema o el evaluador; NO SHALL usarse el de una semana anterior. Si hay documento válido, `brief` SHALL
traer `asOf`, `openOffers` (el `count` de `open_offers`), `scanTruncated` y, por cada viñeta en su orden, `factId`, el
hecho citado sin `linkIds`, `offers` (las primeras 10 ofertas del hecho que **siguen** en el grupo, en el orden del
hecho, con `linkId`, `displayUrl` y título y empresa si los tienen), `moreCount` (las demás que siguen en el grupo) y
`missingCount` (las del hecho que ya no están en el grupo). Quien no es miembro, o un `:id` mal formado, SHALL recibir
`404` con código `group_not_found`. La lectura SHALL hacer un número fijo de lecturas —pertenencia, documento,
relaciones del grupo y fichas— que no dependa del número de viñetas ni de ofertas, y NO SHALL escribir nada.

#### Scenario: Miembro ve la semana

- **GIVEN** el grupo G con su documento de la semana en curso con tres viñetas
- **WHEN** un miembro pide `GET /api/groups/G/weekly-brief`
- **THEN** la respuesta SHALL ser `200` con `brief` y tres viñetas, cada una con su hecho y sus ofertas

#### Scenario: Sin semana todavía

- **GIVEN** un grupo sin documento de la semana en curso y con el de la semana anterior
- **WHEN** un miembro pide su semana
- **THEN** la respuesta SHALL ser `200` con la `weekKey` en curso y `brief` `null`

#### Scenario: Extraño

- **GIVEN** un usuario que no es miembro del grupo
- **WHEN** pide su semana
- **THEN** la respuesta SHALL ser `404` con código `group_not_found`

#### Scenario: Oferta quitada del grupo después del cálculo

- **GIVEN** un `closing_soon` con `count` 2 y una de sus dos ofertas quitada del grupo el martes
- **WHEN** un miembro pide la semana el miércoles
- **THEN** esa viñeta SHALL traer el hecho con `count` 2, una sola oferta en `offers`, `moreCount` 0 y `missingCount` 1

#### Scenario: Más de diez ofertas en una viñeta

- **GIVEN** un `skill_demand` con `count` 14, todas en el grupo
- **WHEN** un miembro pide la semana
- **THEN** la viñeta SHALL traer 10 ofertas y `moreCount` 4

#### Scenario: Documento corrupto

- **GIVEN** un documento de la semana en curso cuya viñeta cita un hecho inexistente
- **WHEN** un miembro pide la semana
- **THEN** la respuesta SHALL ser `200` con `brief` `null`

#### Scenario: Lecturas fijas

- **GIVEN** una semana con 1 viñeta de 2 ofertas y otra con 5 viñetas de 40 ofertas cada una
- **WHEN** un miembro pide cada una
- **THEN** el número de lecturas SHALL ser el mismo en los dos casos
- **AND** ninguna colección SHALL haber sido escrita

### Requirement: Retención de la semana del grupo

Cada documento de `group_weekly_briefs` SHALL caducar a los 35 días de su `computedAt` por un índice TTL
(`expireAfterSeconds` 3 024 000), declarado junto con el índice único `(groupId, weekKey)`. Como los documentos no
tienen datos de usuario, el borrado de una cuenta NO SHALL tocarlos.

#### Scenario: Índices declarados

- **GIVEN** la colección creada por el worker
- **WHEN** se listan sus índices
- **THEN** SHALL existir el índice único `(groupId, weekKey)` y el TTL sobre `computedAt` con `expireAfterSeconds`
  3 024 000

#### Scenario: Borrar una cuenta no toca las semanas

- **GIVEN** Ana, miembro de un grupo con su semana guardada
- **WHEN** Ana borra su cuenta
- **THEN** el documento de la semana de ese grupo SHALL seguir existiendo sin cambios
