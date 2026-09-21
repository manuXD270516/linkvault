## Purpose

Responde la pregunta que justifica todo lo anterior —¿encajo en esta oferta y qué me falta?— cruzando el CV de una
persona con una vacante que ya puede ver. Define quién puede pedirlo, qué informe devuelve y por qué cada sugerencia
tiene que decir de dónde sale, cuándo el análisis sale de LinkVault y bajo qué permiso, qué queda guardado, y qué no
aparece nunca en una respuesta: el texto del CV, el prompt enviado al modelo ni ninguna credencial.

## ADDED Requirements

### Requirement: Pedir el análisis de una oferta

`POST /api/links/:linkId/match` SHALL pedir el análisis de encaje entre una oferta y un CV de quien llama, y SHALL
responder `202` con `analysisId`, `linkId`, `cvId`, `status` `running` y `requestedAt`. El análisis SHALL ejecutarse
fuera de la petición HTTP: la respuesta NO SHALL esperar a que termine.

- La ruta SHALL exigir sesión y SHALL estar permitida a **quien puede ver esa oferta**: los miembros del grupo donde
  está compartida y quien la tiene en su lista privada. Una oferta inexistente, que quien llama no puede ver, o con un
  `:linkId` mal formado SHALL responder `404` con código `link_not_found` y **el mismo cuerpo en los tres casos**.
- El cuerpo SHALL aceptar únicamente `cvId` opcional. **Sin `cvId`, el análisis SHALL usar el CV marcado por defecto**
  de quien llama. Un `cvId` de otra persona, inexistente o mal formado SHALL responder `404` con código `cv_not_found`.
  Un campo desconocido SHALL responder `400` con código `validation_error`.
- Sin ningún CV guardado, la respuesta SHALL ser `409` con código `no_cv`.
- Con el CV elegido en `pending`, la respuesta SHALL ser `409` con código `cv_not_ready`; en `failed`, `409` con código
  `cv_not_readable`. Ninguno de los dos SHALL encolar trabajo ni dejar ningún análisis guardado, que es lo único que
  podría contar para la cuota.
- Con una oferta de la que todavía no se leyó ninguna descripción —sin título y sin texto de la vacante—, la respuesta
  SHALL ser `409` con código `job_not_ready`, para que la salida sea completar la oferta y no reintentar a ciegas.
- El análisis SHALL ser **privado de quien lo pide**: otro miembro del mismo grupo NO SHALL poder verlo, ni por esta
  ruta ni por ninguna otra, aunque comparta la oferta.

#### Scenario: Análisis pedido con el CV por defecto

- **GIVEN** Ana con sesión, un CV `extracted` marcado por defecto y una oferta de su grupo ya leída
- **WHEN** llama a `POST /api/links/<id>/match` con el cuerpo vacío
- **THEN** la respuesta SHALL ser `202` con `status` `running` y el `cvId` del CV marcado
- **AND** el análisis SHALL quedar pedido sin que la respuesta espere a su resultado

#### Scenario: Análisis con otro CV mío

- **GIVEN** Ana con dos CV `extracted`
- **WHEN** pide el análisis enviando el `cvId` del que no está marcado
- **THEN** la respuesta SHALL ser `202` con ese `cvId`

#### Scenario: Todavía no hay CV

- **GIVEN** Beto con sesión y sin ningún CV
- **WHEN** pide el análisis de una oferta suya
- **THEN** la respuesta SHALL ser `409` con código `no_cv`
- **AND** NO SHALL quedar ningún análisis guardado

#### Scenario: El CV aún se está leyendo

- **GIVEN** Ana con un único CV en `pending`
- **WHEN** pide el análisis
- **THEN** la respuesta SHALL ser `409` con código `cv_not_ready`

#### Scenario: El CV no se pudo leer

- **GIVEN** Ana con su CV marcado en `failed`
- **WHEN** pide el análisis sin indicar `cvId`
- **THEN** la respuesta SHALL ser `409` con código `cv_not_readable`
- **AND** SHALL distinguirse por su código de la respuesta de un CV en `pending`

#### Scenario: La oferta no es suya

- **GIVEN** una oferta que Beto no comparte con Ana por ningún grupo ni lista
- **WHEN** Ana pide su análisis
- **THEN** la respuesta SHALL ser `404` con código `link_not_found`
- **AND** el cuerpo SHALL ser idéntico al de una oferta inexistente y al de un `:linkId` mal formado

#### Scenario: La oferta todavía no se ha leído

- **GIVEN** una oferta guardada hace un minuto, sin título ni descripción
- **WHEN** quien la ve pide su análisis
- **THEN** la respuesta SHALL ser `409` con código `job_not_ready`

#### Scenario: El análisis no se comparte con el grupo

- **GIVEN** Ana y Beto, miembros del mismo grupo, y un análisis que hizo Ana sobre una oferta compartida
- **WHEN** Beto consulta esa oferta y sus análisis
- **THEN** NO SHALL obtener el análisis de Ana ni su puntuación

### Requirement: Consultar el análisis de una oferta

`GET /api/links/:linkId/match` SHALL devolver `200` con `linkId` y lo que quien llama tiene sobre esa oferta repartido
en **dos bloques distintos que nunca se mezclan ni se sustituyen**: `latest`, el **último análisis resuelto**, y
`running`, el análisis que esté ejecutándose, si lo hay.

- **El último análisis resuelto** SHALL ser el de **fecha de finalización más reciente** entre los análisis de quien
  llama sobre esa oferta que ya terminaron —en `done`, degradado o no, o en `failed`, incluido el que se dio por
  vencido—, **con el CV que fuera**. Para el que se dio por vencido, que nunca llegó a escribir una fecha de
  finalización, esa fecha SHALL ser **el instante en que venció su plazo**, derivado de su `requestedAt` y del plazo
  máximo: el vencimiento se deriva al leer y **NO SHALL escribir nada** para poder ordenarse.
- **Pedir un análisis nuevo NO SHALL vaciar `latest`**: mientras el nuevo se ejecuta, `latest` SHALL seguir siendo el
  informe que la persona estaba leyendo, y `running` SHALL contar cómo va el nuevo. Ninguna de las dos cosas SHALL
  desplazar a la otra: sin `latest` el reanálisis borraría de la pantalla lo que se estaba leyendo, y sin `running` el
  sondeo no vería avanzar al que corre.
- `latest` SHALL llevar `analysisId`, `cvId`, `status` (`done` o `failed`), el **último paso alcanzado**, `requestedAt`,
  `analyzedAt`, `stale`, `cvChanged`, `consentRequired`, **el código del fallo** cuando `status` es `failed`, **cuándo
  se podrá volver a intentar** cuando el informe degradó por cuota de IA agotada, y el informe cuando `status` es
  `done`.
- `running` SHALL llevar **solo** `analysisId`, `cvId`, `status` `running`, el **último paso alcanzado**, `requestedAt`
  y **el plazo máximo que ese análisis tiene antes de darse por vencido**. NO SHALL llevar informe, `consentRequired`,
  código de fallo ni hora de vuelta: ninguno de esos existe todavía y un análisis en curso NO SHALL tener que inventarse
  ninguno. `consentRequired` SHALL ser **obligatorio en `latest` y ausente en `running`**.
- **El plazo máximo SHALL publicarse siempre que venga `running`**, para que quien espera pueda calcular cuánto tiene
  sentido seguir esperando: junto a `requestedAt` determina el instante exacto en que ese análisis se dará por vencido.
  SHALL ser **el mismo plazo que rige el vencimiento** —el que esta misma respuesta aplica para leer `failed` un
  análisis colgado y para derivar su fecha de finalización—, nunca un número aparte que pueda discrepar de él: dos
  plazos distintos dejarían a la pantalla anunciando paciencia agotada mientras la API considera que el análisis sigue
  a tiempo, o al revés. Si la configuración del plazo cambia, el valor publicado SHALL cambiar con ella.
- Ese plazo SHALL vivir **en `running` y no en `latest` ni suelto en la raíz de la respuesta**. En `latest` describiría
  un análisis que ya terminó y cuyo plazo no rige nada; en la raíz se leería como un dato de la oferta y podría
  combinarse con el `requestedAt` de otro análisis. Donde se necesita es exactamente donde hay algo por lo que esperar,
  y ahí viaja al lado del `requestedAt` con el que se calcula. `latest` NO SHALL traerlo.
- Si hubiera más de un análisis ejecutándose —porque se cambió de CV mientras corría el anterior—, `running` SHALL ser
  el de `requestedAt` más reciente.
- Sin ningún análisis resuelto pero con uno en curso, la respuesta SHALL ser `200` con `running` y **sin** `latest`.
  Sin ninguno de los dos, la respuesta SHALL ser `404` con código `analysis_not_found`, que NO SHALL confundirse con
  `link_not_found`.
- **El código del fallo** SHALL viajar en `latest` siempre que su `status` sea `failed`, junto al `status` y no en su
  lugar: sin un campo propio, la razón del fallo no tendría por dónde llegar a la pantalla que debe distinguir una
  avería nuestra de un encaje bajo.
- `consentRequired` SHALL devolverse **tal como quedó guardado al ejecutar el análisis**, sin recalcularse al leer: lo
  que ese informe explica es la situación de permiso que hubo cuando se produjo, no la de ahora.
- **Cuándo se podrá volver a intentar** SHALL devolverse **solo cuando el análisis degradó porque la cuota de IA se
  agotó**, y SHALL ser el momento que quedó guardado con el análisis, sin recalcularse al leer. En cualquier otro caso
  —informe completo, degradado por otro motivo, `running` o `failed`— NO SHALL venir. Sin él en esta respuesta, la
  pantalla que tiene que decir a qué hora se puede volver no tendría de dónde sacar esa hora.
- Un análisis SHALL marcarse `cvChanged` `true` cuando se hizo con un CV que ya no es el que se usaría hoy —porque se
  marcó otro por defecto—, para que nadie lea como actual un informe hecho con otro CV. SHALL seguir devolviéndose
  entero.
- Un análisis que no pudo completarse por un fallo de la plataforma —el texto del CV ilegible en el almacén, el trabajo
  perdido— SHALL quedar en `status` `failed` con código `internal_error` **en el campo del código del fallo**, y NO
  SHALL quedarse en `running` para siempre: **pasado su plazo máximo SHALL darse por vencido y leerse `failed`**.
- Ese plazo máximo SHALL ser **mayor que el plazo del trabajo que ejecuta el análisis**, contando todas las entregas que
  ese trabajo pueda tener. Ningún análisis SHALL poder darse por vencido mientras su ejecución todavía estuviera a
  tiempo de terminar: el vencimiento describe un trabajo que ya no va a volver, no uno que aún trabaja.
- Un análisis dado por vencido SHALL ser **terminal**: un resultado que llegue después NO SHALL cambiar lo que devuelve
  el `GET`, ni convertir en `done` algo que quien lo pidió ya leyó como avería. La única salida SHALL ser pedir un
  análisis nuevo.
- La respuesta SHALL llevar `Cache-Control: private, no-store`.
- Una oferta que quien llama no puede ver SHALL responder `404` con código `link_not_found`, aunque exista un análisis
  suyo anterior sobre ella.

#### Scenario: Consultar un análisis terminado

- **GIVEN** un análisis de Ana terminado sobre una oferta suya y ninguno en curso
- **WHEN** Ana llama a `GET /api/links/<id>/match`
- **THEN** la respuesta SHALL ser `200` con `latest` en `status` `done`, su informe y `analyzedAt`
- **AND** NO SHALL traer ningún `running`

#### Scenario: Consultar mientras corre el primero

- **GIVEN** un análisis pedido hace cinco segundos y ningún análisis resuelto antes sobre esa oferta
- **WHEN** Ana lo consulta
- **THEN** la respuesta SHALL ser `200` con `running` en `status` `running` y sin informe
- **AND** NO SHALL traer ningún `latest`

#### Scenario: Reanalizar no borra de pantalla lo que se estaba leyendo

- **GIVEN** un análisis `done` de Ana con su informe y un reanálisis recién pedido sobre la misma oferta
- **WHEN** Ana consulta mientras el nuevo se ejecuta
- **THEN** `latest` SHALL seguir siendo el análisis terminado, con su `analysisId` y su informe completo
- **AND** `running` SHALL ser el análisis nuevo, con su propio `analysisId` y su paso alcanzado

#### Scenario: Un análisis en curso no inventa el permiso

- **GIVEN** un análisis en curso que todavía no eligió proveedor
- **WHEN** Ana consulta
- **THEN** su `running` NO SHALL traer `consentRequired`, ni código de fallo, ni hora de vuelta, ni informe
- **AND** el `consentRequired` de un `latest` SHALL venir siempre

#### Scenario: La consulta publica cuánto puede durar la espera

- **GIVEN** un análisis de Ana en curso sobre una oferta suya
- **WHEN** Ana llama a `GET /api/links/<id>/match`
- **THEN** su `running` SHALL traer, junto a `requestedAt`, el plazo máximo que ese análisis tiene antes de darse por
  vencido
- **AND** ese plazo SHALL ser el mismo del que se deriva su vencimiento, no un valor aparte
- **AND** un `latest` NO SHALL traerlo

#### Scenario: El plazo publicado es el que de verdad se aplica

- **GIVEN** un despliegue con un proveedor local lento cuyo plazo máximo de análisis se configuró mucho más largo que
  el valor por defecto
- **WHEN** se consulta un análisis en curso
- **THEN** el plazo devuelto SHALL ser el configurado
- **AND** SHALL coincidir con el instante a partir del cual esa misma consulta empezaría a leer ese análisis como
  vencido

#### Scenario: Nunca pedí este análisis

- **GIVEN** una oferta que Ana puede ver y sobre la que no tiene ningún análisis resuelto ni ninguno en curso
- **WHEN** la consulta
- **THEN** la respuesta SHALL ser `404` con código `analysis_not_found`

#### Scenario: El análisis se quedó colgado

- **GIVEN** un análisis en `running` cuyo plazo máximo venció sin resultado
- **WHEN** Ana lo consulta
- **THEN** la respuesta SHALL ser `200` con `latest` en `status` `failed`
- **AND** el código del fallo SHALL venir en su propio campo con el valor `internal_error`

#### Scenario: El fallo viaja con su código

- **GIVEN** un análisis de Ana que terminó en `failed`
- **WHEN** Ana lo consulta
- **THEN** la respuesta SHALL traer el `status` `failed` **y** el campo del código del fallo
- **AND** un `latest` en `done` NO SHALL traer ese campo

#### Scenario: El plazo de la consulta no adelanta al del trabajo

- **GIVEN** un análisis cuya ejecución sigue dentro del plazo que tiene para terminar
- **WHEN** Ana lo consulta
- **THEN** la respuesta SHALL traer ese análisis como `running`
- **AND** NO SHALL leerse como vencido mientras su ejecución siga a tiempo

#### Scenario: Un resultado que llega tarde

- **GIVEN** un análisis que Ana ya leyó como `failed` por vencimiento
- **WHEN** su ejecución termina después y quiere guardar un informe
- **THEN** el `GET` SHALL seguir devolviendo ese `latest` en `failed` con código `internal_error`
- **AND** Ana NO SHALL ver convertirse en un análisis terminado lo que le presentamos como avería

#### Scenario: La consulta trae la hora de vuelta de un degradado por cuota de IA

- **GIVEN** un análisis `done` degradado porque la cuota de IA se agotó
- **WHEN** Ana llama a `GET /api/links/<id>/match`
- **THEN** su `latest` SHALL incluir cuándo se podrá volver a intentar, tal como quedó guardado
- **AND** la respuesta de un análisis degradado por otro motivo NO SHALL incluirlo

#### Scenario: La oferta cambió después del análisis

- **GIVEN** un análisis terminado y una oferta que después se completó pegando su descripción
- **WHEN** Ana consulta el análisis
- **THEN** la respuesta SHALL ser `200` con `latest` marcado `stale` `true` y el informe completo

#### Scenario: El análisis se hizo con otro CV

- **GIVEN** un análisis terminado y Ana marcando después otro CV por defecto
- **WHEN** consulta el análisis de esa oferta
- **THEN** la respuesta SHALL ser `200` con ese análisis en `latest`, su `cvId` y `cvChanged` `true`

### Requirement: El paso alcanzado por un análisis

El análisis SHALL declarar un **conjunto cerrado de pasos** y SHALL dejar constancia del último que alcanzó, de modo
que el `GET` del análisis lo devuelva junto al `status` **del bloque al que ese análisis pertenece** —`latest` o
`running`— y una espera de decenas de segundos se pueda contar:
`reading-job` (se prepara la vacante), `comparing-cv` (se compara con el CV), `drafting-suggestions` (se redactan las
sugerencias) y uno final, que SHALL ser `done` con informe completo, `done-degraded` con informe básico o `failed`
cuando no se pudo terminar.

- Los pasos SHALL alcanzarse en ese orden y **cada análisis SHALL terminar siempre en uno de los tres finales**, también
  cuando falla. El paso devuelto NO SHALL retroceder.
- Un análisis degradado NO SHALL alcanzar `drafting-suggestions`, porque no redacta ninguna: saltarse ese paso SHALL ser
  parte del contrato y no un aviso perdido, de modo que quien lo muestre pueda darlo por no pendiente.
- El paso SHALL viajar **solo** como paso: NO SHALL llevar el informe, el `score`, ninguna sugerencia ni nada del texto
  del CV o de la oferta. Quien quiera el resultado SHALL pedirlo a la API.
- El paso SHALL poder conocerse **preguntando por el análisis**, sin depender de ningún canal de avisos: contar la
  espera NO SHALL exigir haber estado escuchando en el momento exacto en que el paso ocurrió.
- Preguntar por el paso NO SHALL ejecutar nada, NO SHALL dejar ningún análisis nuevo que pueda contar para la cuota y
  NO SHALL retrasar ni hacer fallar el análisis, por seguido que se pregunte.

#### Scenario: Un análisis completo cuenta sus pasos

- **GIVEN** un análisis de Ana que termina con informe completo
- **WHEN** se consulta el análisis a lo largo de su ejecución
- **THEN** los pasos alcanzados SHALL ser `reading-job`, `comparing-cv`, `drafting-suggestions` y `done`, en ese orden

#### Scenario: Un análisis básico se salta las sugerencias

- **GIVEN** un análisis que degrada porque no hay proveedores
- **WHEN** se consultan sus pasos alcanzados
- **THEN** NO SHALL incluir `drafting-suggestions`
- **AND** el último SHALL ser `done-degraded`

#### Scenario: Un análisis que no se pudo terminar

- **GIVEN** un análisis que falla por un error de la plataforma
- **WHEN** se consulta su paso alcanzado
- **THEN** SHALL ser `failed`

#### Scenario: El paso no lleva el informe

- **WHEN** se inspecciona el paso que devuelve cualquier consulta
- **THEN** NO SHALL contener el `score`, ninguna sugerencia ni ningún texto del CV o de la oferta

#### Scenario: La espera se pregunta, no se escucha

- **GIVEN** Ana que abre la pantalla del análisis cuando ya iba por `comparing-cv`
- **WHEN** consulta el análisis
- **THEN** SHALL ver ese paso alcanzado sin haber estado escuchando nada antes

### Requirement: Un análisis pedido, una sola ejecución

Un análisis pedido SHALL **ejecutarse una sola vez**. El trabajo que lo resuelve NO SHALL reintentarse a ciegas: un
análisis que no se puede completar degrada o termina en fallo, y nunca vuelve a empezar por su cuenta. Así queda
garantizado que **un análisis pedido produce como mucho un envío del CV a un proveedor externo** y como mucho un consumo
de cuota de IA.

- Al empezar cada intento, la ejecución SHALL **releer el estado guardado del análisis** y SHALL abandonar sin hacer
  nada si ya está resuelto —`done` o `failed`—, si su plazo ya venció o **si el análisis ya no existe** porque se borró
  el CV con el que se hizo. Entregar el mismo trabajo tres veces SHALL dar exactamente el mismo resultado que entregarlo
  una.
- La garantía SHALL ser observable sobre el proveedor: para un mismo `analysisId`, el número de veces que el texto del
  CV llega a un proveedor externo NO SHALL crecer con el número de entregas del trabajo.
- Un análisis cuyo trabajo no vuelve NO SHALL quedarse en `running` para siempre: SHALL terminar en `failed` con código
  `internal_error`, y su salida SHALL ser pedir un análisis nuevo, no repetir el mismo.

#### Scenario: El mismo trabajo entregado tres veces

- **GIVEN** un análisis de Ana ya resuelto en `done`
- **WHEN** su trabajo se entrega dos veces más
- **THEN** ningún proveedor SHALL recibir una petición nueva
- **AND** el análisis guardado NO SHALL cambiar

#### Scenario: Un fallo no multiplica los envíos

- **GIVEN** un análisis que sale hacia un proveedor externo y cuya ejecución termina mal
- **WHEN** se cuenta cuántas veces salió el CV hacia ese proveedor
- **THEN** SHALL haber salido como mucho una vez
- **AND** el análisis SHALL haber degradado o terminado en `failed`, nunca vuelto a empezar

#### Scenario: El trabajo que no vuelve

- **GIVEN** un análisis en `running` cuyo trabajo se perdió
- **WHEN** vence su plazo
- **THEN** SHALL leerse `failed` con código `internal_error`
- **AND** NO SHALL quedarse en `running`

### Requirement: El informe de encaje y su evidencia obligatoria

El informe SHALL ser un `MatchReport` con `score` —un número entero de 0 a 100—, `matchedSkills`, `missingSkills` y
`suggestions`, y SHALL validarse contra su contrato antes de guardarse y antes de devolverse.

- `matchedSkills` SHALL ser la lista de habilidades pedidas por la vacante que están en el CV.
- Cada elemento de `missingSkills` SHALL llevar su `name` y su `importance`, `must` o `nice`, para que se distinga lo
  que descalifica de lo que suma.
- `suggestions` SHALL tener **como mucho 12 elementos**, cada uno con la sección del CV a la que se refiere, el texto
  propuesto, el motivo y su `evidence`.
- **Cada sugerencia SHALL llevar `evidence` con `jobRequirement` no vacío** —el requisito de la vacante que la motiva—,
  `importance` (`must` o `nice`) —el peso de ese requisito en la vacante— y `cvFragment`, que SHALL ser un fragmento
  del CV de como mucho 300 caracteres o **nulo** cuando la sugerencia propone algo que hoy no está en el CV. Una
  sugerencia sin `jobRequirement` es indistinguible de una invención: **una salida que la contenga NO SHALL guardarse
  ni devolverse**, SHALL tratarse como salida inválida del proveedor y el análisis SHALL seguir su curso hacia la
  reparación, el proveedor siguiente o la degradación.
- **`importance` SHALL ser obligatorio en cada `evidence`** y SHALL exigírsele también a la salida del proveedor: una
  sugerencia sin él, o con un valor fuera de `must` y `nice`, SHALL tratarse igual que una sin `jobRequirement`. Sin
  ese campo, ordenar las sugerencias por la importancia del requisito que atacan no tendría por dónde hacerse: la
  evidencia nombra el requisito, pero nada uniría esa sugerencia con el peso que `missingSkills` le da. El orden que la
  pantalla promete SHALL apoyarse en este campo y **no** en ninguna correspondencia adivinada por el nombre.
- Cuando el requisito de una sugerencia coincida con una habilidad de `missingSkills`, su `importance` SHALL ser la
  misma que la de esa habilidad: dos pesos distintos para el mismo requisito harían indefinible el orden.
- El informe NO SHALL inventar habilidades que no aparezcan ni en la vacante ni en el CV para rellenar `matchedSkills`.

#### Scenario: Informe completo

- **GIVEN** un análisis terminado con proveedor disponible
- **WHEN** Ana lo consulta
- **THEN** SHALL recibir `score` entre 0 y 100, `matchedSkills`, `missingSkills` con su `importance` y como mucho 12
  `suggestions`
- **AND** cada sugerencia SHALL traer su `evidence.jobRequirement` y su `evidence.importance`

#### Scenario: Una sugerencia sin de dónde sale

- **GIVEN** un proveedor que devuelve una sugerencia sin `evidence.jobRequirement`
- **WHEN** se procesa su respuesta
- **THEN** esa salida SHALL tratarse como inválida
- **AND** NO SHALL guardarse ningún informe con esa sugerencia ni devolverse al cliente

#### Scenario: Una sugerencia sin el peso de su requisito

- **GIVEN** un proveedor que devuelve una sugerencia con `evidence.jobRequirement` pero sin `evidence.importance`
- **WHEN** se valida su salida
- **THEN** SHALL tratarse como inválida y NO SHALL guardarse
- **AND** lo mismo SHALL ocurrir con una `evidence.importance` que no sea `must` ni `nice`

#### Scenario: El orden por importancia se puede calcular

- **GIVEN** un informe con sugerencias de requisitos imprescindibles y de requisitos deseables
- **WHEN** se ordenan por la importancia del requisito que atacan
- **THEN** el orden SHALL salir de la `evidence.importance` de cada sugerencia
- **AND** NO SHALL hacer falta adivinar a qué habilidad de `missingSkills` corresponde cada una

#### Scenario: Una sugerencia sobre algo que falta en el CV

- **GIVEN** una vacante que pide un requisito ausente del CV
- **WHEN** la sugerencia lo propone
- **THEN** su `evidence.cvFragment` SHALL ser nulo y su `evidence.jobRequirement` SHALL nombrar ese requisito

#### Scenario: Trece sugerencias

- **GIVEN** un proveedor que devuelve 13 sugerencias
- **WHEN** se valida su salida
- **THEN** SHALL tratarse como inválida y NO SHALL guardarse

#### Scenario: Habilidades que faltan con su peso

- **GIVEN** una vacante que exige una habilidad y valora otra
- **WHEN** ninguna de las dos está en el CV
- **THEN** `missingSkills` SHALL traerlas con `importance` `must` y `nice` respectivamente

### Requirement: El CV no sale sin permiso

La tarea de análisis SHALL declararse como tarea de datos `personal`. Sin el consentimiento de quien pide el análisis,
**ningún proveedor externo SHALL recibir nada del CV**: la ejecución SHALL quedarse en los proveedores locales y, si no
hay ninguno disponible, SHALL degradar. El consentimiento SHALL leerse del perfil de quien pide el análisis, nunca del
dueño del grupo ni de quien compartió la oferta.

- El consentimiento que cuenta SHALL ser el **vigente**: dado y sobre la versión vigente de su texto. Uno aceptado
  sobre una versión anterior SHALL tratarse igual que su ausencia.
- Con consentimiento, un proveedor externo SHALL recibir el input **pasado por la redacción de datos personales**,
  nunca el texto original.
- Un análisis que degrada por falta de consentimiento NO SHALL fallar en silencio: SHALL devolverse con su marca de
  degradado, con el **`degradedReason` propio de la falta de consentimiento** y con `consentRequired` `true`.
- Los dos SHALL darse **solo cuando dar el consentimiento habría hecho elegible a algún proveedor**. Si no hay ningún
  proveedor externo configurado, conceder el permiso no habría cambiado nada: el motivo SHALL ser el de que no hay
  proveedores y `consentRequired` SHALL ser `false`. Así se distingue "te falta autorizarlo" —que tiene arreglo y es
  suyo— de "la IA no está disponible", que no lo tiene.
- `consentRequired` SHALL quedar **guardado junto al análisis**, no derivarse en la lectura: el permiso puede cambiar
  después y, sin guardarlo, el motivo real por el que ese informe salió básico sería irrecuperable.
- El consentimiento SHALL comprobarse en el momento de ejecutar, no en el de pedir: uno retirado entre la petición y la
  ejecución SHALL impedir igualmente el envío a un proveedor externo.

#### Scenario: Sin consentimiento y con proveedor local

- **GIVEN** Ana sin consentimiento para proveedores externos y un proveedor local disponible
- **WHEN** pide el análisis
- **THEN** el análisis SHALL ejecutarse contra el proveedor local
- **AND** ningún proveedor externo SHALL recibir ninguna petición

#### Scenario: Sin consentimiento y sin proveedor local

- **GIVEN** Ana sin consentimiento y solo proveedores externos configurados
- **WHEN** pide el análisis
- **THEN** el informe SHALL venir degradado con el motivo de que faltaba el consentimiento y `consentRequired` `true`
- **AND** ningún proveedor SHALL recibir ninguna petición

#### Scenario: Faltar el permiso no explica una avería ajena

- **GIVEN** un entorno sin ningún proveedor externo configurado y Ana sin consentimiento
- **WHEN** pide el análisis
- **THEN** el motivo SHALL ser el de que no hay proveedores, no el de la falta de consentimiento
- **AND** `consentRequired` SHALL ser `false`, porque darlo no habría hecho elegible a nadie

#### Scenario: Con consentimiento hacia un proveedor externo

- **GIVEN** Ana con el consentimiento dado y un proveedor externo elegible
- **WHEN** se ejecuta su análisis
- **THEN** lo enviado SHALL ser el texto ya redactado
- **AND** NO SHALL contener su email, su teléfono, su dirección ni su documento de identidad

#### Scenario: Consentimiento retirado entre la petición y la ejecución

- **GIVEN** un análisis pedido con consentimiento y retirado antes de que el trabajo empiece
- **WHEN** el análisis se ejecuta
- **THEN** ningún proveedor externo SHALL recibir nada
- **AND** el resultado SHALL ser el que corresponda a no tener consentimiento

#### Scenario: El motivo del informe no cambia al cambiar el permiso

- **GIVEN** un análisis guardado con `consentRequired` `true`
- **WHEN** Ana da el consentimiento y vuelve a consultar ese mismo análisis
- **THEN** SHALL seguir devolviéndose con `consentRequired` `true`, tal como se guardó
- **AND** la forma de tener un informe completo SHALL ser pedir un análisis nuevo

#### Scenario: El consentimiento es el de quien pide

- **GIVEN** una oferta de un grupo donde Ana tiene consentimiento y Beto no
- **WHEN** Beto pide su análisis
- **THEN** SHALL aplicarse la falta de consentimiento de Beto, no el de Ana

### Requirement: Degradación honesta, nunca silencio

Cuando no hay proveedor que produzca un informe válido —porque la cadena está vacía, porque todos fallaron, porque la
cuota de IA se agotó o porque faltaba el consentimiento—, el análisis NO SHALL fallar: SHALL terminar en `done` con un
informe marcado `degraded` `true`, su `degradedReason` y **sin ninguna sugerencia**.

- `degradedReason` SHALL venir de un **conjunto cerrado** que distinga, como mínimo, esas cuatro situaciones: no hay
  ningún proveedor elegible, todos los proveedores fallaron, la cuota de IA se agotó y **faltaba el consentimiento**.
  Cada una tiene una salida distinta para quien la lee —esperar, reintentar, volver más tarde o dar el permiso—, y un
  motivo que las confunda le ofrece la salida equivocada.
- El informe degradado SHALL calcularse cruzando por diccionario las habilidades de la vacante con las del CV, y SHALL
  traer `score`, `matchedSkills` y `missingSkills` obtenidos así.
- `suggestions` SHALL ser una lista vacía. Un informe con `degraded` `true` y alguna sugerencia NO SHALL guardarse ni
  devolverse.
- **Cuando el motivo es que la cuota de IA se agotó**, el informe SHALL llevar además **cuándo se podrá volver a
  intentar**. Sin ese dato la pantalla solo puede invitar a reintentar en el vacío, que es la manera más rápida de
  gastar la cuota que ya está agotada. Ese momento SHALL guardarse con el análisis y devolverse tal cual en el `GET`.
- `degradedReason` SHALL decir cuál de los motivos fue, de forma que el SPA pueda explicarlo con palabras distintas y
  ofrecer la salida que corresponde.
- Un informe degradado NO SHALL presentarse ni guardarse como un análisis completo. **Mientras el motivo de su
  degradación siga vigente** SHALL devolverse tal cual a quien vuelva a pedir ese análisis, y en cuanto ese motivo deje
  de estarlo NO SHALL reutilizarse: el contrato de repetir el análisis dice cuándo ocurre cada cosa.
- `degradedReason` SHALL bastar, junto a la hora de vuelta cuando la haya, para **decidir sin adivinar** si el motivo
  sigue vigente: un motivo que no permita esa comprobación NO SHALL añadirse al conjunto cerrado.

#### Scenario: Toda la cadena falló

- **GIVEN** todos los proveedores elegibles devolviendo error
- **WHEN** se ejecuta el análisis de Ana
- **THEN** el análisis SHALL terminar en `done` con `degraded` `true` y su motivo
- **AND** el informe SHALL traer `score`, `matchedSkills` y `missingSkills`, y `suggestions` vacío

#### Scenario: Sin IA configurada

- **GIVEN** un entorno sin ningún proveedor de IA configurado
- **WHEN** Ana pide el análisis
- **THEN** SHALL recibir un informe degradado con el motivo de que no hay proveedores
- **AND** la respuesta NO SHALL ser un error

#### Scenario: Un degradado con sugerencias no se guarda

- **GIVEN** un informe degradado que trae una sugerencia
- **WHEN** se valida antes de guardarlo
- **THEN** SHALL rechazarse y NO SHALL devolverse

#### Scenario: El motivo distingue los cuatro casos

- **GIVEN** un degradado por falta de consentimiento, otro por caída de los proveedores, otro por cadena vacía y otro
  por cuota de IA agotada
- **WHEN** se consultan los cuatro informes
- **THEN** sus `degradedReason` SHALL ser distintos entre sí
- **AND** el de falta de consentimiento SHALL poder distinguirse del de que no hay proveedores

#### Scenario: La cuota de IA agotada dice cuándo volver

- **GIVEN** un análisis que degrada porque la cuota de IA se agotó
- **WHEN** Ana consulta el informe
- **THEN** SHALL traer cuándo se podrá volver a intentar
- **AND** ese momento SHALL ser el que quedó guardado con el análisis, sin recalcularse al leer

### Requirement: Qué se guarda de un análisis y qué no sale nunca

Cada análisis terminado SHALL guardarse con quien lo pidió, la oferta, el CV usado, la `previewVersion` analizada de la
oferta, la versión del prompt, el proveedor y el modelo que lo resolvieron, el estado, el último paso alcanzado, el
informe validado, `degraded` con su motivo, **el código del fallo cuando terminó en `failed`**, `consentRequired`,
cuándo se podrá volver a intentar si degradó por cuota de IA agotada, la marca de si salió a un proveedor externo, la
fecha de finalización y la duración.

- **El código del fallo** SHALL guardarse con el análisis, no derivarse al leer, para que el `GET` pueda devolverlo en
  su propio campo y la pantalla distinga una avería nuestra de un resultado. Un análisis en `done` NO SHALL guardar
  ninguno.
- La **fecha de finalización** SHALL guardarse con todo análisis que termine, degradado o no, porque de ella salen dos
  cosas que se derivan al leer y no se copian a ningún sitio: cuál es el último análisis y qué análisis caen dentro de
  la ventana de cuota.

- **NO SHALL guardarse** el texto del CV, el texto de la oferta, el prompt renderizado, ninguna credencial ni ningún
  dato de otra persona. El único texto del CV que queda guardado SHALL ser el `cvFragment` de cada evidencia, acotado a
  300 caracteres, porque sin él la sugerencia no se puede justificar.
- **Ninguna respuesta de la API SHALL incluir** el texto del CV más allá de esos fragmentos, el prompt renderizado, la
  credencial de ningún proveedor ni el análisis de otra persona.
- **Ningún registro**, en ningún nivel ni en ningún proceso, SHALL contener texto del CV, texto del informe, el prompt
  renderizado ni credenciales. SHALL poder registrarse el identificador del análisis, el de la oferta, el del CV, el
  proveedor, el estado, el motivo de degradación, la duración y el recuento de sugerencias.
- El análisis SHALL ser la **única fuente** de la puntuación de encaje de la postulación de esa persona sobre esa
  oferta: su `score` y su marca de degradado SHALL quedar legibles para ella y **nadie SHALL copiarlos** a la
  postulación. El análisis del que se deriva esa puntuación SHALL ser el de **fecha de finalización más reciente entre
  los que terminaron en `done`**, con la misma definición de «último» que usa la postulación; los que están en curso,
  los que terminaron en `failed` y los que se dieron por vencidos NO SHALL contar para derivarla.

#### Scenario: Lo guardado no lleva el CV

- **GIVEN** un análisis terminado con sugerencias
- **WHEN** se mira lo guardado
- **THEN** NO SHALL contener el texto del CV ni el de la oferta ni el prompt enviado
- **AND** el único texto del CV SHALL ser el fragmento de cada evidencia

#### Scenario: Lo guardado explica por qué salió básico

- **GIVEN** un análisis que degradó por falta de consentimiento
- **WHEN** se mira lo guardado
- **THEN** SHALL incluir su `degradedReason` y su `consentRequired`
- **AND** el `GET` SHALL devolverlos sin volver a mirar el perfil de quien lo pidió

#### Scenario: Lo guardado dice por qué falló

- **GIVEN** un análisis que terminó en `failed` por un error de la plataforma
- **WHEN** se mira lo guardado
- **THEN** SHALL incluir el código del fallo en su propio campo
- **AND** un análisis guardado en `done` NO SHALL tener ninguno

#### Scenario: Los registros no filtran el CV

- **GIVEN** los registros capturados a nivel `debug`
- **WHEN** Ana pide un análisis que sale a un proveedor externo
- **THEN** ninguna línea SHALL contener texto de su CV, texto del informe ni la credencial del proveedor
- **AND** las líneas SHALL nombrar el análisis por su identificador

#### Scenario: La respuesta no arrastra el prompt

- **WHEN** Ana consulta un análisis terminado
- **THEN** la respuesta NO SHALL contener ningún prompt renderizado ni ninguna credencial

#### Scenario: Un fragmento demasiado largo

- **GIVEN** un proveedor que devuelve un `cvFragment` de 2.000 caracteres
- **WHEN** se valida su salida
- **THEN** SHALL tratarse como inválida y NO SHALL guardarse

### Requirement: Cuota de análisis por persona

La API SHALL limitar cuántos análisis puede pedir cada persona en una ventana **configurable, de 24 horas por defecto**,
con un límite también definido por configuración. Superado el límite, `POST /api/links/:linkId/match` SHALL responder
`429` con código `too_many_attempts` y cabecera `Retry-After`, sin encolar trabajo, sin leer el CV del almacén y sin
contactar a ningún proveedor.

**Lo consumido SHALL derivarse del historial de análisis, exactamente igual que la puntuación de la postulación**:
SHALL ser el número de análisis de quien pide **cuya fecha de finalización cae dentro de la ventana** y que terminaron
en `done` con el informe **no degradado**, más los que **siguen en curso dentro de su plazo**. No hay nada que sumar al
aceptar, nada que restar al terminar y nada que devolver: el desenlace ocurre en el worker, el vencimiento se deriva al
leer sin escribir nada, y una devolución que tuviera que viajar de ahí a un contador de la API **no tendría quién la
hiciera**.

- **NO SHALL contarse** un análisis degradado, sea cual sea su `degradedReason` —cadena vacía, proveedores caídos, cuota
  de IA agotada o falta de consentimiento—, uno en `failed` ni uno dado por vencido. Esta cuota existe para acotar el uso
  de la IA: no se le cobra a nadie una avería nuestra, ni un permiso que todavía no dio, ni un límite que no es el suyo.
- **Un análisis en curso SHALL contar mientras corre** y SHALL **dejar de contar en cuanto se resuelve** si su informe
  salió degradado o si terminó en fallo. Sin esto, nada acotaría una ráfaga: como lo consumido se deriva de lo ya
  terminado, alguien podría lanzar de golpe un análisis por cada oferta que ve —cada uno con su envío del CV— antes de
  que ninguno cuente. Ocupar sitio mientras se trabaja no es cobrar una avería: lo que falla suelta su sitio solo, sin
  que nadie tenga que devolver nada.
- Un análisis en curso SHALL dejar de contar **también al vencer su plazo**, que se deriva de su `requestedAt`, de modo
  que un trabajo perdido NO SHALL ocupar sitio para siempre.
- En consecuencia, **solo cuenta de forma duradera el análisis que entregó un informe no degradado**, y cuenta desde que
  lo entregó, no desde que se pidió.
- **NO SHALL existir ningún contador aparte** —ni en memoria, ni en la caché, ni en ninguna clave— que pueda discrepar
  del historial. Ninguna operación SHALL incrementarlo, decrementarlo ni reconciliarlo, y ningún proceso SHALL quedar
  encargado de devolver intentos perdidos: **no hay estado que se pueda desincronizar porque no hay más estado que los
  propios análisis**.
- Un análisis que se pide **no consume nada por pedirse**: pasa a contar solo si termina entregando un informe no
  degradado, y deja de contar solo por salir de la ventana con el paso del tiempo.
- Una petición rechazada con `404`, `409` o `400` no deja ningún análisis guardado, así que **no cuenta**. Una petición
  que devuelve un análisis ya hecho sin volver a ejecutarlo tampoco añade ninguno, así que **tampoco cuenta**.
- `Retry-After` SHALL derivarse del mismo historial: el momento en que **el más antiguo de los análisis contados** deja
  de contar —porque sale de la ventana, si ya terminó, o porque vence su plazo, si sigue en curso—. Ninguna otra fuente
  SHALL usarse para calcularlo.
- El recuento SHALL **fallar abierto**: si no puede calcularse —la consulta falla o no responde—, la petición SHALL
  seguir adelante.

#### Scenario: Límite alcanzado

- **GIVEN** Ana con tantos análisis terminados con informe no degradado dentro de la ventana como permite el límite
- **WHEN** pide otro análisis
- **THEN** la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After`
- **AND** NO SHALL quedar ningún análisis pedido

#### Scenario: La ventana se configura

- **GIVEN** una configuración que no declara el tamaño de la ventana
- **WHEN** arranca la API
- **THEN** la ventana SHALL ser de 24 horas
- **AND** una configuración que declare otro tamaño SHALL usarse en su lugar

#### Scenario: Lo consumido se cuenta, no se lleva apuntado

- **GIVEN** Ana con varios análisis terminados dentro de la ventana
- **WHEN** se comprueba cómo sabe la API cuántos ha consumido
- **THEN** SHALL salir de contar sus análisis con informe no degradado dentro de la ventana
- **AND** NO SHALL existir ningún contador guardado aparte, ni ninguna operación que lo suba, lo baje o lo devuelva

#### Scenario: El recuento no se puede calcular

- **GIVEN** la consulta que cuenta los análisis de la ventana sin responder
- **WHEN** Ana pide un análisis
- **THEN** la respuesta SHALL ser `202`

#### Scenario: Un rechazo no cuenta

- **GIVEN** Ana sin ningún CV
- **WHEN** pide un análisis y recibe `409 no_cv`, y después sube un CV y lo pide otra vez
- **THEN** el segundo intento SHALL aceptarse
- **AND** el rechazo NO SHALL haber dejado ningún análisis que contar

#### Scenario: Un degradado no cuenta

- **GIVEN** Ana con un análisis terminado degradado porque no había proveedores
- **WHEN** se cuenta lo consumido en su ventana
- **THEN** ese análisis NO SHALL sumar
- **AND** NO SHALL hacer falta devolverle nada, porque nunca se le restó

#### Scenario: Una avería no se le cobra a quien la sufre

- **GIVEN** Ana con dos análisis, uno que terminó en `failed` con `internal_error` y otro que venció sin resultado
- **WHEN** se cuenta lo consumido en su ventana
- **THEN** ninguno de los dos SHALL sumar

#### Scenario: Un análisis en curso ocupa sitio mientras corre

- **GIVEN** Ana con un análisis pedido y todavía en `running` dentro de su plazo
- **WHEN** se cuenta lo consumido en su ventana
- **THEN** ese análisis SHALL sumar mientras corre
- **AND** SHALL dejar de sumar en cuanto termine degradado, termine en `failed` o venza su plazo, sin que nadie tenga
  que devolver nada

#### Scenario: Falta el permiso y no cuenta

- **GIVEN** un análisis de Ana que degradó porque faltaba su consentimiento
- **WHEN** Ana da el permiso y pide el análisis otra vez
- **THEN** el degradado anterior NO SHALL haber sumado en su ventana
- **AND** la petición nueva SHALL aceptarse

#### Scenario: La cuota de IA agotada no quema la de análisis

- **GIVEN** un análisis que degradó porque la cuota de IA se agotó
- **WHEN** se cuenta lo consumido en la ventana de Ana
- **THEN** ese análisis NO SHALL sumar
- **AND** reintentar mientras la cuota de IA siga agotada NO SHALL ir gastando esta cuota

#### Scenario: La espera se calcula del historial

- **GIVEN** Ana con la ventana llena y un `429`
- **WHEN** se mira de dónde sale su `Retry-After`
- **THEN** SHALL ser el momento en que el más antiguo de los análisis contados sale de la ventana

### Requirement: Repetir el análisis

Pedir dos veces el análisis de la misma oferta SHALL comportarse de forma previsible y sin gastar trabajo de más. Para
cada estado posible del análisis existente SHALL estar dicho si se reutiliza o se ejecuta uno nuevo, de modo que la
pantalla nunca pueda ofrecer un gesto que no hace nada.

- **En curso y dentro de su plazo**: mientras haya un análisis en `running` de la misma persona, la misma oferta y el
  mismo CV, un `POST` nuevo SHALL responder `202` con **el mismo `analysisId`** y NO SHALL encolar un segundo trabajo.
- **Completo y no degradado**, con el mismo CV, la misma `previewVersion` de la oferta y la misma versión de prompt: el
  `POST` SHALL responder `200` con ese análisis, sin ejecutar nada. **No SHALL existir ninguna forma de forzar un
  reanálisis cuando nada cambió**: repetir el mismo análisis sobre los mismos datos devolvería el mismo informe gastando
  cuota, así que la respuesta es el informe que ya hay.
- **Degradado con su motivo todavía vigente**: el `POST` **NO SHALL re-ejecutar** el análisis. SHALL responder `200`
  con **ese mismo informe básico** y su `analysisId`, y NO SHALL encolar trabajo, NO SHALL leer el texto del CV del
  almacén y NO SHALL contactar a ningún proveedor. Un degradado no cuenta para la cuota, así que sin esta regla
  "Reintentar" sería un bucle **infinito y gratis** que en cada vuelta saca el CV del almacén y encola trabajo para
  volver a degradar por el mismo motivo.
- **Un motivo SHALL considerarse vigente** en el momento del `POST` cuando se cumple alguna de estas dos condiciones, y
  solo entonces:
  - degradó **porque la cuota de IA se agotó** y la hora de vuelta guardada con ese análisis **todavía no ha llegado**;
  - degradó **por falta de consentimiento o porque no había ningún proveedor elegible**, y en este momento **sigue sin
    haber ninguno elegible**, sea porque el consentimiento sigue sin darse o sigue caducado, sea porque el circuito de
    los que habría sigue abierto.
- **Degradado con su motivo ya no vigente**: el `POST` SHALL ejecutar un análisis nuevo. Eso incluye que la hora de
  vuelta ya haya pasado, que se haya dado el consentimiento que faltaba, que el circuito se haya cerrado, que se haya
  configurado un proveedor y también el degradado **porque todos los proveedores fallaron** sin que ningún circuito siga
  abierto: ahí volver a intentarlo puede dar otro resultado. Un informe básico es una respuesta honesta, no un resultado
  que valga la pena conservar cuando la causa ya pasó.
- La comprobación de vigencia SHALL hacerse **antes de encolar nada**, en el propio proceso que atiende el `POST`, y
  SHALL apoyarse solo en tres cosas: lo guardado con el análisis —su `degradedReason` y su hora de vuelta—, el
  consentimiento de quien pide, y **si hoy habría algún proveedor elegible para esta tarea**. Esa última SHALL poder
  responderse **sin ejecutar la tarea y sin contactar a ningún proveedor**, y SHALL ser legible desde donde se atiende el
  `POST`: un estado de circuito que solo viviera en la memoria del proceso que ejecuta los análisis dejaría esta regla
  sin quien la aplicara, que es justo el defecto que corrige.
- Si esa consulta de elegibilidad **no puede responderse**, el motivo SHALL tratarse como **no vigente** y el `POST`
  SHALL ejecutar un análisis nuevo. Se prefiere gastar una ejecución que no sale a ningún proveedor externo antes que
  dejar a alguien atrapado en un informe básico con un botón que no hace nada; el coste queda acotado a una avería
  nuestra y a un gesto que la persona pide a mano.
- **Vencido**: un análisis que se dio por vencido NO SHALL considerarse reutilizable en ningún caso. El `POST` SHALL
  ejecutar uno nuevo, nunca devolver el vencido: devolverlo dejaría a quien pulsa "Reintentar" en un bucle que siempre
  responde lo mismo.
- **Fallido**: un análisis en `failed` SHALL comportarse igual que uno vencido y el `POST` SHALL ejecutar uno nuevo.
- **Cuando cambió algo**: si la oferta cambió (`previewVersion` distinta) o si la versión del prompt cambió, el `POST`
  SHALL ejecutar un análisis nuevo. Esta regla SHALL tener **precedencia sobre la del degradado vigente**: con otra
  oferta o otro prompt, el informe básico guardado ya no describe lo que se pregunta, aunque su motivo siga en pie.
- **Cuando cambió el CV** —porque se marca otro por defecto o se sube uno nuevo—, el `POST` siguiente SHALL ejecutar un
  análisis nuevo con el CV nuevo, **también con precedencia sobre la regla del degradado vigente**, y SHALL guardarlo
  aparte; el análisis anterior NO SHALL modificarse y SHALL seguir siendo el que devuelve el `GET` como último análisis
  resuelto —marcado con que se hizo con otro CV— hasta que el nuevo termine.

#### Scenario: Dos peticiones seguidas

- **GIVEN** un análisis de Ana en `running`
- **WHEN** Ana pide el mismo análisis otra vez
- **THEN** la respuesta SHALL ser `202` con el mismo `analysisId`
- **AND** NO SHALL encolarse un segundo trabajo

#### Scenario: Volver a pedir lo ya analizado

- **GIVEN** un análisis `done` no degradado de Ana sobre esa oferta con su CV actual
- **WHEN** Ana lo pide de nuevo sin que nada haya cambiado
- **THEN** la respuesta SHALL ser `200` con ese mismo análisis
- **AND** ningún proveedor SHALL recibir una petición
- **AND** NO SHALL existir ninguna forma de pedir que se rehaga igualmente

#### Scenario: Reintentar mientras la cuota de IA sigue agotada

- **GIVEN** un análisis degradado por cuota de IA agotada cuya hora de vuelta todavía no ha llegado
- **WHEN** Ana pulsa "Reintentar" y se pide el análisis otra vez
- **THEN** la respuesta SHALL ser `200` con ese mismo informe básico y su mismo `analysisId`
- **AND** NO SHALL encolarse ningún trabajo, NO SHALL leerse el texto del CV del almacén y ningún proveedor SHALL
  recibir nada

#### Scenario: Reintentar cuando la hora de vuelta ya pasó

- **GIVEN** el mismo análisis degradado por cuota de IA agotada, con su hora de vuelta ya cumplida
- **WHEN** Ana lo pide otra vez
- **THEN** SHALL ejecutarse un análisis nuevo con su propio `analysisId`

#### Scenario: Reintentar sin haber dado el permiso

- **GIVEN** un análisis degradado por falta de consentimiento y Ana que sigue sin darlo
- **WHEN** Ana lo pide otra vez, dos veces seguidas
- **THEN** las dos respuestas SHALL ser el mismo informe básico, con el mismo `analysisId`
- **AND** NO SHALL encolarse ningún trabajo en ninguna de las dos

#### Scenario: Reintentar después de dar el permiso

- **GIVEN** el mismo análisis degradado por falta de consentimiento y Ana dándolo después
- **WHEN** pide el análisis otra vez
- **THEN** SHALL ejecutarse un análisis nuevo

#### Scenario: Reintentar con el circuito todavía abierto

- **GIVEN** un análisis degradado porque no había ningún proveedor elegible y un circuito que sigue abierto
- **WHEN** Ana lo pide otra vez
- **THEN** la respuesta SHALL ser ese mismo informe básico, sin encolar trabajo

#### Scenario: Reintentar con el circuito ya cerrado

- **GIVEN** el mismo análisis y el circuito ya cerrado, con un proveedor elegible
- **WHEN** Ana lo pide otra vez
- **THEN** SHALL ejecutarse un análisis nuevo

#### Scenario: Reintentar un degradado porque todos fallaron

- **GIVEN** un análisis degradado porque todos los proveedores fallaron, sin ningún circuito abierto y con proveedores
  elegibles ahora
- **WHEN** Ana lo pide otra vez
- **THEN** SHALL ejecutarse un análisis nuevo

#### Scenario: La elegibilidad no se puede consultar

- **GIVEN** un análisis degradado por ausencia de proveedor y la consulta de elegibilidad sin responder
- **WHEN** Ana lo pide otra vez
- **THEN** SHALL ejecutarse un análisis nuevo, tratando el motivo como no vigente

#### Scenario: Volver a pedir un análisis vencido

- **GIVEN** un análisis de Ana que se dio por vencido y que ella leyó como `failed`
- **WHEN** Ana lo pide otra vez
- **THEN** SHALL ejecutarse un análisis nuevo con su propio `analysisId`
- **AND** la respuesta NO SHALL ser el análisis vencido otra vez

#### Scenario: Volver a pedir un análisis fallido

- **GIVEN** un análisis de Ana en `failed` con código `internal_error`
- **WHEN** Ana lo pide otra vez
- **THEN** SHALL ejecutarse un análisis nuevo

#### Scenario: La oferta se completó después

- **GIVEN** un análisis terminado y la oferta completada después con su descripción
- **WHEN** Ana pide el análisis de nuevo
- **THEN** SHALL ejecutarse un análisis nuevo sobre la oferta ya completa

#### Scenario: Cambiar de CV

- **GIVEN** un análisis terminado con el CV marcado y Ana marcando después otro CV
- **WHEN** Ana pide el análisis de esa misma oferta
- **THEN** SHALL ejecutarse uno nuevo con el CV recién marcado
- **AND** el análisis anterior SHALL seguir guardado tal cual, sin modificarse

### Requirement: Revocar el consentimiento y borrar el CV

Retirar el consentimiento SHALL tener efecto **sobre lo que todavía no ha salido**, no sobre lo ya hecho.

- Desde el momento de la revocación, ningún análisis SHALL enviar nada a un proveedor externo, incluidos los que ya
  estaban pedidos y aún no se han ejecutado.
- Los análisis ya guardados SHALL **conservarse**: son un resultado que la persona pidió y ya leyó, y borrarlos sin que
  lo pida le quitaría algo suyo. SHALL seguir consultándose y mostrando su marca de si salieron a un proveedor externo.
- La vía para que esos análisis desaparezcan SHALL ser **borrar el CV con el que se hicieron**: al eliminar un CV,
  SHALL eliminarse también los análisis hechos con él, incluidos sus fragmentos de evidencia.
- Ese borrado SHALL ser **atómico**: al terminar, o han desaparecido el CV y todos sus análisis, o no ha desaparecido
  ninguno de los dos. **NO SHALL existir ningún instante observable** —ni por un fallo a mitad, ni por una caída del
  proceso, ni por un reinicio— en el que el CV ya no esté y sus análisis, con sus fragmentos de texto del CV, sigan
  guardados. Es la única vía de borrado que el producto ofrece: un resto que sobreviva no tendría quién lo recogiera.
- Un borrado que falla a mitad SHALL dejarlo todo como estaba —el CV consultable y sus análisis también— y volver a
  intentarlo SHALL poder completarlo. Una eliminación **no SHALL depender de que un segundo paso posterior llegue a
  ejecutarse**.
- **Ninguna escritura del análisis SHALL crear el documento**: guardar el resultado y guardar el paso alcanzado SHALL
  actualizar **únicamente un documento que ya exista**, nunca insertarlo ni recrearlo. Sin esta regla, una ejecución en
  vuelo que termina **después** del borrado volvería a escribir el análisis con su fragmento de CV dentro, y existiría
  el instante que esta spec dice que no puede existir: el CV borrado y su texto otra vez guardado.
- Una escritura que no encuentra el documento SHALL **no hacer nada** y SHALL terminar sin error: el borrado ya
  respondió lo que tenía que responder y un resultado tardío no es una avería, es trabajo que ya no tiene destino. NO
  SHALL reintentarse, NO SHALL dejar rastro con texto del CV y NO SHALL devolver el análisis a la vida.
- Revocar el consentimiento NO SHALL borrar ningún CV ni ninguna postulación, y NO SHALL dejar ninguna operación a
  medias.

#### Scenario: Revocar no borra lo analizado

- **GIVEN** Ana con dos análisis terminados y el consentimiento dado
- **WHEN** retira el consentimiento
- **THEN** los dos análisis SHALL seguir consultándose igual
- **AND** ningún CV suyo SHALL borrarse

#### Scenario: Revocar corta lo que aún no salió

- **GIVEN** un análisis pedido y todavía en cola cuando Ana retira el consentimiento
- **WHEN** el trabajo se ejecuta
- **THEN** ningún proveedor externo SHALL recibir nada

#### Scenario: Borrar el CV borra sus análisis

- **GIVEN** Ana con un CV y tres análisis hechos con él
- **WHEN** elimina ese CV
- **THEN** los tres análisis SHALL eliminarse
- **AND** consultarlos SHALL responder `404` con código `analysis_not_found`

#### Scenario: O se borra todo o no se borra nada

- **GIVEN** Ana borrando un CV con análisis hechos con él, y un fallo a mitad del borrado
- **WHEN** se mira lo guardado después del fallo
- **THEN** SHALL verse el CV con todos sus análisis, o ni el CV ni ninguno de sus análisis
- **AND** NO SHALL verse nunca el CV eliminado con sus análisis todavía guardados

#### Scenario: El borrado no queda a la espera de un segundo paso

- **GIVEN** Ana borrando un CV y el proceso cayéndose justo después de que el borrado quede confirmado
- **WHEN** se consultan sus análisis al volver el servicio
- **THEN** NO SHALL quedar ninguno de los análisis de ese CV
- **AND** ningún fragmento de texto de ese CV SHALL seguir guardado

#### Scenario: Se purga y después llega un resultado tardío

- **GIVEN** Ana borrando un CV mientras un análisis hecho con él todavía se ejecuta
- **WHEN** esa ejecución termina después del borrado e intenta guardar su informe y su paso alcanzado
- **THEN** NO SHALL escribirse nada: ningún documento de análisis SHALL volver a existir
- **AND** ningún fragmento de texto de ese CV SHALL quedar guardado, y la escritura SHALL terminar sin error

#### Scenario: Borrar un CV no toca los análisis de otro

- **GIVEN** Ana con dos CV, cada uno con análisis propios
- **WHEN** elimina uno de los CV
- **THEN** los análisis del otro CV SHALL seguir intactos
