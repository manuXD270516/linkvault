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
  `cv_not_readable`. Ninguno de los dos SHALL encolar trabajo ni consumir cuota.
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

`GET /api/links/:linkId/match` SHALL devolver `200` con el análisis vigente de quien llama sobre esa oferta: su
`analysisId`, `linkId`, `cvId`, `status` (`running`, `done` o `failed`), el **último paso alcanzado**, `requestedAt`,
`analyzedAt` cuando terminó, `stale`, `cvChanged`, `consentRequired` y el informe cuando `status` es `done`.

- **El análisis vigente** SHALL ser el más reciente de quien llama sobre esa oferta, **con el CV que fuera**; si no
  existe ninguno, la respuesta SHALL ser `404` con código `analysis_not_found`, que NO SHALL confundirse con
  `link_not_found`.
- `consentRequired` SHALL devolverse **tal como quedó guardado al ejecutar el análisis**, sin recalcularse al leer: lo
  que ese informe explica es la situación de permiso que hubo cuando se produjo, no la de ahora.
- Un análisis SHALL marcarse `cvChanged` `true` cuando se hizo con un CV que ya no es el que se usaría hoy —porque se
  marcó otro por defecto—, para que nadie lea como actual un informe hecho con otro CV. SHALL seguir devolviéndose
  entero.
- Un análisis que no pudo completarse por un fallo de la plataforma —el texto del CV ilegible en el almacén, el trabajo
  perdido— SHALL quedar en `status` `failed` con código `internal_error`, y NO SHALL quedarse en `running` para
  siempre: **pasado su plazo máximo SHALL darse por vencido y leerse `failed`**.
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

- **GIVEN** un análisis de Ana terminado sobre una oferta suya
- **WHEN** Ana llama a `GET /api/links/<id>/match`
- **THEN** la respuesta SHALL ser `200` con `status` `done`, su informe y `analyzedAt`

#### Scenario: Consultar mientras corre

- **GIVEN** un análisis pedido hace cinco segundos
- **WHEN** Ana lo consulta
- **THEN** la respuesta SHALL ser `200` con `status` `running` y sin informe

#### Scenario: Nunca pedí este análisis

- **GIVEN** una oferta que Ana puede ver y sobre la que nunca pidió análisis
- **WHEN** la consulta
- **THEN** la respuesta SHALL ser `404` con código `analysis_not_found`

#### Scenario: El análisis se quedó colgado

- **GIVEN** un análisis en `running` cuyo plazo máximo venció sin resultado
- **WHEN** Ana lo consulta
- **THEN** la respuesta SHALL ser `200` con `status` `failed` y código `internal_error`

#### Scenario: El plazo de la consulta no adelanta al del trabajo

- **GIVEN** un análisis cuya ejecución sigue dentro del plazo que tiene para terminar
- **WHEN** Ana lo consulta
- **THEN** la respuesta SHALL ser `200` con `status` `running`
- **AND** NO SHALL leerse como vencido mientras su ejecución siga a tiempo

#### Scenario: Un resultado que llega tarde

- **GIVEN** un análisis que Ana ya leyó como `failed` por vencimiento
- **WHEN** su ejecución termina después y quiere guardar un informe
- **THEN** el `GET` SHALL seguir devolviendo `failed` con código `internal_error`
- **AND** Ana NO SHALL ver convertirse en un análisis terminado lo que le presentamos como avería

#### Scenario: La oferta cambió después del análisis

- **GIVEN** un análisis terminado y una oferta que después se completó pegando su descripción
- **WHEN** Ana consulta el análisis
- **THEN** la respuesta SHALL ser `200` con `stale` `true` y el informe completo

#### Scenario: El análisis se hizo con otro CV

- **GIVEN** un análisis terminado y Ana marcando después otro CV por defecto
- **WHEN** consulta el análisis de esa oferta
- **THEN** la respuesta SHALL ser `200` con ese análisis, su `cvId` y `cvChanged` `true`

### Requirement: El paso alcanzado por un análisis

El análisis SHALL declarar un **conjunto cerrado de pasos** y SHALL dejar constancia del último que alcanzó, de modo
que el `GET` del análisis lo devuelva junto a su `status` y una espera de decenas de segundos se pueda contar:
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
- Preguntar por el paso NO SHALL ejecutar nada, NO SHALL consumir intento y NO SHALL retrasar ni hacer fallar el
  análisis, por seguido que se pregunte.

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
  nada si ya está resuelto —`done` o `failed`— o si su plazo ya venció. Entregar el mismo trabajo tres veces SHALL dar
  exactamente el mismo resultado que entregarlo una.
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
- **Cada sugerencia SHALL llevar `evidence` con `jobRequirement` no vacío** —el requisito de la vacante que la motiva—
  y `cvFragment`, que SHALL ser un fragmento del CV de como mucho 300 caracteres o **nulo** cuando la sugerencia
  propone algo que hoy no está en el CV. Una sugerencia sin `jobRequirement` es indistinguible de una invención:
  **una salida que la contenga NO SHALL guardarse ni devolverse**, SHALL tratarse como salida inválida del proveedor y
  el análisis SHALL seguir su curso hacia la reparación, el proveedor siguiente o la degradación.
- El informe NO SHALL inventar habilidades que no aparezcan ni en la vacante ni en el CV para rellenar `matchedSkills`.

#### Scenario: Informe completo

- **GIVEN** un análisis terminado con proveedor disponible
- **WHEN** Ana lo consulta
- **THEN** SHALL recibir `score` entre 0 y 100, `matchedSkills`, `missingSkills` con su `importance` y como mucho 12
  `suggestions`
- **AND** cada sugerencia SHALL traer su `evidence.jobRequirement`

#### Scenario: Una sugerencia sin de dónde sale

- **GIVEN** un proveedor que devuelve una sugerencia sin `evidence.jobRequirement`
- **WHEN** se procesa su respuesta
- **THEN** esa salida SHALL tratarse como inválida
- **AND** NO SHALL guardarse ningún informe con esa sugerencia ni devolverse al cliente

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
- Un informe degradado NO SHALL presentarse ni guardarse como un análisis completo, y NO SHALL reutilizarse en una
  petición posterior.

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
informe validado, `degraded` con su motivo, `consentRequired`, cuándo se podrá volver a intentar si degradó por cuota de
IA agotada, la marca de si salió a un proveedor externo, la fecha y la duración.

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
  postulación.

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

La API SHALL limitar cuántos análisis puede pedir cada persona por tarea en una ventana **configurable, de 24 horas por
defecto**, con un límite también definido por configuración. Superado el límite,
`POST /api/links/:linkId/match` SHALL responder `429` con código `too_many_attempts` y cabecera `Retry-After`, sin
encolar trabajo ni contactar a ningún proveedor.

- El contador SHALL **fallar abierto**: si no puede consultarse, la petición SHALL seguir adelante.
- El intento SHALL consumirse **solo cuando el análisis queda pedido**: un `404`, un `409` o un `400` NO SHALL
  consumirlo.
- El intento SHALL **devolverse siempre que el análisis no llegue a entregar un informe completo**, y eso incluye el
  fallo interno, el vencimiento, la degradación por falta de IA —cadena vacía o proveedores caídos—, la degradación por
  cuota de IA agotada y la degradación por falta de consentimiento. Esta cuota existe para acotar el uso de la IA: no se
  le cobra a nadie una avería nuestra, ni un permiso que todavía no dio, ni un límite que no es el suyo.
- En consecuencia, **solo consume intento el análisis que termina con un informe no degradado**.
- La devolución del intento por cuota de IA agotada SHALL evitar el bucle en el que cada reintento quema un intento de
  esta cuota mientras la de IA sigue agotada: el informe dice cuándo volver y esta cuota no se gasta entretanto.
- Una petición que devuelve un análisis ya hecho sin volver a ejecutarlo NO SHALL consumir intento.

#### Scenario: Límite alcanzado

- **GIVEN** Ana con su ventana de análisis agotada
- **WHEN** pide otro análisis
- **THEN** la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After`
- **AND** NO SHALL quedar ningún análisis pedido

#### Scenario: La ventana se configura

- **GIVEN** una configuración que no declara el tamaño de la ventana
- **WHEN** arranca la API
- **THEN** la ventana SHALL ser de 24 horas
- **AND** una configuración que declare otro tamaño SHALL usarse en su lugar

#### Scenario: Contador caído

- **GIVEN** el contador de intentos sin responder
- **WHEN** Ana pide un análisis
- **THEN** la respuesta SHALL ser `202`

#### Scenario: Un rechazo no gasta intento

- **GIVEN** Ana sin ningún CV
- **WHEN** pide un análisis y recibe `409 no_cv`, y después sube un CV y lo pide otra vez
- **THEN** el segundo intento SHALL aceptarse

#### Scenario: Un degradado se devuelve al contador

- **GIVEN** Ana con un intento consumido cuyo análisis terminó degradado porque no había proveedores
- **WHEN** vuelve a pedirlo
- **THEN** el intento SHALL estar disponible otra vez

#### Scenario: Una avería no se le cobra a quien la sufre

- **GIVEN** Ana con dos análisis pedidos, uno que terminó en `failed` con `internal_error` y otro que venció sin
  resultado
- **WHEN** se consulta su contador
- **THEN** ninguno de los dos SHALL haber consumido intento

#### Scenario: Falta el permiso y no cuesta intento

- **GIVEN** un análisis de Ana que degradó porque faltaba su consentimiento
- **WHEN** Ana da el permiso y pide el análisis otra vez
- **THEN** el intento anterior SHALL estar disponible
- **AND** la petición nueva SHALL aceptarse

#### Scenario: La cuota de IA agotada no quema la de análisis

- **GIVEN** un análisis que degradó porque la cuota de IA se agotó
- **WHEN** se consulta el contador de análisis de Ana
- **THEN** ese análisis NO SHALL haber consumido intento
- **AND** reintentar mientras la cuota de IA siga agotada NO SHALL ir gastando los intentos de esta cuota

### Requirement: Repetir el análisis

Pedir dos veces el análisis de la misma oferta SHALL comportarse de forma previsible y sin gastar trabajo de más. Para
cada estado posible del análisis existente SHALL estar dicho si se reutiliza o se ejecuta uno nuevo, de modo que la
pantalla nunca pueda ofrecer un gesto que no hace nada.

- **En curso y dentro de su plazo**: mientras haya un análisis en `running` de la misma persona, la misma oferta y el
  mismo CV, un `POST` nuevo SHALL responder `202` con **el mismo `analysisId`**, NO SHALL encolar un segundo trabajo y
  NO SHALL consumir otro intento.
- **Completo y no degradado**, con el mismo CV, la misma `previewVersion` de la oferta y la misma versión de prompt: el
  `POST` SHALL responder `200` con ese análisis, sin ejecutar nada y sin consumir intento. **No SHALL existir ninguna
  forma de forzar un reanálisis cuando nada cambió**: repetir el mismo análisis sobre los mismos datos devolvería el
  mismo informe gastando cuota, así que la respuesta es el informe que ya hay.
- **Degradado**, sea cual sea su motivo: el `POST` SHALL ejecutar un análisis nuevo. Un informe básico es una respuesta
  honesta, no un resultado que valga la pena conservar cuando se puede volver a intentar.
- **Vencido**: un análisis que se dio por vencido NO SHALL considerarse reutilizable en ningún caso. El `POST` SHALL
  ejecutar uno nuevo, nunca devolver el vencido: devolverlo dejaría a quien pulsa "Reintentar" en un bucle que siempre
  responde lo mismo.
- **Fallido**: un análisis en `failed` SHALL comportarse igual que uno vencido y el `POST` SHALL ejecutar uno nuevo.
- **Cuando cambió algo**: si la oferta cambió (`previewVersion` distinta) o si la versión del prompt cambió, el `POST`
  SHALL ejecutar un análisis nuevo.
- **Cuando cambió el CV** —porque se marca otro por defecto o se sube uno nuevo—, el `POST` siguiente SHALL ejecutar un
  análisis nuevo con el CV nuevo y SHALL guardarlo aparte; el análisis anterior NO SHALL modificarse y SHALL seguir
  consultándose hasta que el nuevo termine, marcado con que se hizo con otro CV.

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

#### Scenario: Reintentar un análisis degradado

- **GIVEN** un análisis `done` degradado de Ana sobre esa oferta
- **WHEN** Ana lo pide otra vez
- **THEN** SHALL ejecutarse un análisis nuevo

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

#### Scenario: Borrar un CV no toca los análisis de otro

- **GIVEN** Ana con dos CV, cada uno con análisis propios
- **WHEN** elimina uno de los CV
- **THEN** los análisis del otro CV SHALL seguir intactos
