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
`analysisId`, `linkId`, `cvId`, `status` (`running`, `done` o `failed`), `requestedAt`, `analyzedAt` cuando terminó,
`stale`, `cvChanged`, y el informe cuando `status` es `done`.

- **El análisis vigente** SHALL ser el más reciente de quien llama sobre esa oferta, **con el CV que fuera**; si no
  existe ninguno, la respuesta SHALL ser `404` con código `analysis_not_found`, que NO SHALL confundirse con
  `link_not_found`.
- Un análisis SHALL marcarse `cvChanged` `true` cuando se hizo con un CV que ya no es el que se usaría hoy —porque se
  marcó otro por defecto—, para que nadie lea como actual un informe hecho con otro CV. SHALL seguir devolviéndose
  entero.
- Un análisis que no pudo completarse por un fallo de la plataforma —el texto del CV ilegible en el almacén, el trabajo
  perdido— SHALL quedar en `status` `failed` con código `internal_error`, y NO SHALL quedarse en `running` para
  siempre: pasado su plazo máximo SHALL darse por fallido.
- Un análisis SHALL marcarse `stale` `true` cuando la oferta cambió después de hacerlo, es decir cuando su
  `previewVersion` ya no es la que se analizó. Un análisis `stale` SHALL seguir devolviéndose entero.
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

#### Scenario: La oferta cambió después del análisis

- **GIVEN** un análisis terminado y una oferta que después se completó pegando su descripción
- **WHEN** Ana consulta el análisis
- **THEN** la respuesta SHALL ser `200` con `stale` `true` y el informe completo

#### Scenario: El análisis se hizo con otro CV

- **GIVEN** un análisis terminado y Ana marcando después otro CV por defecto
- **WHEN** consulta el análisis de esa oferta
- **THEN** la respuesta SHALL ser `200` con ese análisis, su `cvId` y `cvChanged` `true`

### Requirement: Los pasos que anuncia un análisis

El análisis SHALL declarar un **conjunto cerrado de pasos** y SHALL anunciar cada uno al alcanzarlo, para que una
espera de decenas de segundos se pueda contar: `reading-job` (se prepara la vacante), `comparing-cv` (se compara con el
CV), `drafting-suggestions` (se redactan las sugerencias) y uno final, que SHALL ser `done` con informe completo,
`done-degraded` con informe básico o `failed` cuando no se pudo terminar.

- Los pasos SHALL anunciarse en ese orden y **cada análisis SHALL terminar siempre en uno de los tres finales**,
  también cuando falla.
- Un análisis degradado NO SHALL anunciar `drafting-suggestions`, porque no redacta ninguna: saltarse un paso SHALL ser
  parte del contrato y no un aviso perdido.
- Ningún paso SHALL llevar el informe, el `score`, ninguna sugerencia ni nada del texto del CV o de la oferta: quien lo
  recibe SHALL pedir el resultado a la API.
- Un paso que nadie escucha NO SHALL retrasar ni hacer fallar el análisis.

#### Scenario: Un análisis completo cuenta sus pasos

- **GIVEN** un análisis de Ana que termina con informe completo
- **WHEN** se recorren sus pasos anunciados
- **THEN** SHALL ser `reading-job`, `comparing-cv`, `drafting-suggestions` y `done`, en ese orden

#### Scenario: Un análisis básico se salta las sugerencias

- **GIVEN** un análisis que degrada porque no hay proveedores
- **WHEN** se recorren sus pasos anunciados
- **THEN** NO SHALL incluir `drafting-suggestions`
- **AND** el último SHALL ser `done-degraded`

#### Scenario: Un análisis que no se pudo terminar

- **GIVEN** un análisis que falla por un error de la plataforma
- **WHEN** se recorren sus pasos anunciados
- **THEN** el último SHALL ser `failed`

#### Scenario: Los pasos no llevan el informe

- **WHEN** se inspecciona cualquier paso anunciado
- **THEN** NO SHALL contener el `score`, ninguna sugerencia ni ningún texto del CV o de la oferta

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
  degradado y SHALL llevar `consentRequired` `true`, que SHALL ser `true` **solo** cuando dar el consentimiento habría
  hecho elegible a algún proveedor. Así se distingue "te falta autorizarlo" de "la IA no está disponible".
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
- **THEN** el informe SHALL venir degradado con `consentRequired` `true`
- **AND** ningún proveedor SHALL recibir ninguna petición

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

#### Scenario: El consentimiento es el de quien pide

- **GIVEN** una oferta de un grupo donde Ana tiene consentimiento y Beto no
- **WHEN** Beto pide su análisis
- **THEN** SHALL aplicarse la falta de consentimiento de Beto, no el de Ana

### Requirement: Degradación honesta, nunca silencio

Cuando no hay proveedor que produzca un informe válido —porque la cadena está vacía, porque todos fallaron o porque la
cuota de IA se agotó—, el análisis NO SHALL fallar: SHALL terminar en `done` con un informe marcado `degraded` `true`,
su `degradedReason` y **sin ninguna sugerencia**.

- El informe degradado SHALL calcularse cruzando por diccionario las habilidades de la vacante con las del CV, y SHALL
  traer `score`, `matchedSkills` y `missingSkills` obtenidos así.
- `suggestions` SHALL ser una lista vacía. Un informe con `degraded` `true` y alguna sugerencia NO SHALL guardarse ni
  devolverse.
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

#### Scenario: El motivo distingue los casos

- **GIVEN** un degradado por falta de consentimiento y otro por caída de los proveedores
- **WHEN** se consultan los dos informes
- **THEN** sus `degradedReason` SHALL ser distintos

### Requirement: Qué se guarda de un análisis y qué no sale nunca

Cada análisis terminado SHALL guardarse con quien lo pidió, la oferta, el CV usado, la `previewVersion` analizada de la
oferta, la versión del prompt, el proveedor y el modelo que lo resolvieron, el estado, el informe validado, `degraded`
con su motivo, la marca de si salió a un proveedor externo, la fecha y la duración.

- **NO SHALL guardarse** el texto del CV, el texto de la oferta, el prompt renderizado, ninguna credencial ni ningún
  dato de otra persona. El único texto del CV que queda guardado SHALL ser el `cvFragment` de cada evidencia, acotado a
  300 caracteres, porque sin él la sugerencia no se puede justificar.
- **Ninguna respuesta de la API SHALL incluir** el texto del CV más allá de esos fragmentos, el prompt renderizado, la
  credencial de ningún proveedor ni el análisis de otra persona.
- **Ningún registro**, en ningún nivel ni en ningún proceso, SHALL contener texto del CV, texto del informe, el prompt
  renderizado ni credenciales. SHALL poder registrarse el identificador del análisis, el de la oferta, el del CV, el
  proveedor, el estado, el motivo de degradación, la duración y el recuento de sugerencias.
- Terminado un análisis, su `score` y su marca de degradado SHALL quedar disponibles como puntuación de encaje de la
  postulación de esa persona sobre esa oferta, cuando exista.

#### Scenario: Lo guardado no lleva el CV

- **GIVEN** un análisis terminado con sugerencias
- **WHEN** se mira lo guardado
- **THEN** NO SHALL contener el texto del CV ni el de la oferta ni el prompt enviado
- **AND** el único texto del CV SHALL ser el fragmento de cada evidencia

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

La API SHALL limitar cuántos análisis puede pedir cada persona por tarea en una ventana de 24 horas, con un límite
definido por configuración. Superado el límite, `POST /api/links/:linkId/match` SHALL responder `429` con código
`too_many_attempts` y cabecera `Retry-After`, sin encolar trabajo ni contactar a ningún proveedor.

- El contador SHALL **fallar abierto**: si no puede consultarse, la petición SHALL seguir adelante.
- El intento SHALL consumirse **solo cuando el análisis queda pedido**: un `404`, un `409` o un `400` NO SHALL
  consumirlo.
- Un análisis que termina degradado por falta de IA —cadena vacía o proveedores caídos— SHALL devolver el intento al
  contador: no se cobra a la persona lo que no llegó a analizarse.
- Una petición que devuelve un análisis ya hecho sin volver a ejecutarlo NO SHALL consumir intento.

#### Scenario: Límite alcanzado

- **GIVEN** Ana con su ventana de análisis agotada
- **WHEN** pide otro análisis
- **THEN** la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After`
- **AND** NO SHALL quedar ningún análisis pedido

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

### Requirement: Repetir el análisis

Pedir dos veces el análisis de la misma oferta SHALL comportarse de forma previsible y sin gastar trabajo de más.

- Mientras haya un análisis en `running` de la misma persona, la misma oferta y el mismo CV, un `POST` nuevo SHALL
  responder `202` con **el mismo `analysisId`**, NO SHALL encolar un segundo trabajo y NO SHALL consumir otro intento.
- Si ya existe un análisis `done` **no degradado** de esa persona, esa oferta y ese CV, hecho con la misma
  `previewVersion` de la oferta y la misma versión de prompt, el `POST` SHALL responder `200` con ese análisis, sin
  ejecutar nada y sin consumir intento.
- Si el análisis existente está **degradado**, si la oferta cambió (`previewVersion` distinta) o si la versión del
  prompt cambió, el `POST` SHALL ejecutar un análisis nuevo.
- Si el CV cambia —porque se marca otro por defecto o se sube uno nuevo—, el `POST` siguiente SHALL ejecutar un
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

#### Scenario: Reintentar un análisis degradado

- **GIVEN** un análisis `done` degradado de Ana sobre esa oferta
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

#### Scenario: Borrar un CV no toca los análisis de otro

- **GIVEN** Ana con dos CV, cada uno con análisis propios
- **WHEN** elimina uno de los CV
- **THEN** los análisis del otro CV SHALL seguir intactos
