## Purpose

La pantalla donde una persona descubre si encaja en una oferta y qué le falta. Enseña el informe con la evidencia de
cada sugerencia a la vista, dice antes de empezar por dónde va a salir su CV, dice con todas las letras cuándo el
análisis fue básico y cuándo hace falta su permiso, y distingue siempre un problema nuestro de un encaje bajo, que es
un resultado y no un error.

## ADDED Requirements

### Requirement: Pedir el análisis desde la oferta

Cada oferta que una persona puede ver —en `/grupos/:id` y en `/mis-links`— SHALL ofrecer la acción **"Analizar mi
encaje"**, que SHALL abrir un diálogo titulado **"Tu encaje con esta oferta"** con el nombre de la vacante. Abrir el
diálogo **NO SHALL pedir ningún análisis**: el diálogo SHALL enseñar primero qué va a pasar y SHALL esperar a que la
persona lo pida con la acción **"Analizar"**.

- Antes de empezar, y siempre, el diálogo SHALL decir **con qué CV se va a analizar**, nombrándolo por su archivo, y
  **por dónde va a salir ese CV**, con una de estas dos líneas y nunca las dos: con el permiso vigente, **"Se analizará
  con IA externa (OpenRouter)."**; sin permiso vigente, **"Se analizará dentro de LinkVault."**
- Mientras el SPA no conozca el estado del permiso, NO SHALL mostrar ninguna de las dos líneas ni SHALL ofrecer
  "Analizar" afirmando por dónde saldrá: SHALL esperar a saberlo.
- El diálogo SHALL ofrecer **"Cambiar de CV"**, que lleva a `/mi-cv`, y, sin permiso vigente, **"Dar permiso"**, que
  lleva a `/perfil`. Volver de cualquiera de las dos SHALL devolver a la oferta con el diálogo abierto mostrando el
  estado ya actualizado, y **NO SHALL disparar ningún análisis** por sí solo.
- Sin permiso vigente, el diálogo SHALL poder analizar igualmente: "Dar permiso" SHALL ser una salida, nunca un
  requisito para pulsar "Analizar".
- Mientras el análisis está en marcha, la acción NO SHALL aceptar una segunda petición y SHALL quedar deshabilitada con
  `aria-busy`.
- Si la oferta todavía no se ha leído y la API responde `job_not_ready`, el diálogo SHALL mostrar **"Todavía no hemos
  leído esta oferta, así que no hay con qué comparar tu CV."** y SHALL ofrecer **"Pegar la descripción"**, que abre el
  formulario que ya existe para completarla.
- Cerrar el diálogo NO SHALL cancelar el análisis: al volver a abrirlo SHALL verse su estado actual.
- El análisis SHALL ser privado: la tarjeta de la oferta NO SHALL mostrar el encaje de ningún otro miembro del grupo.

#### Scenario: Abrir el diálogo no manda nada a ningún sitio

- **GIVEN** Ana con un CV leído y una oferta ya leída en su grupo
- **WHEN** pulsa "Analizar mi encaje"
- **THEN** SHALL abrirse el diálogo con el nombre de la vacante y el del CV que se usará
- **AND** NO SHALL pedirse ningún análisis hasta que Ana pulse "Analizar"

#### Scenario: Con el permiso vigente se dice que sale fuera

- **GIVEN** Ana con el consentimiento vigente para proveedores externos
- **WHEN** abre el diálogo de una oferta
- **THEN** SHALL leer "Se analizará con IA externa (OpenRouter)." antes de pulsar nada

#### Scenario: Sin permiso se dice que se queda dentro

- **GIVEN** Ana sin consentimiento vigente
- **WHEN** abre el diálogo de una oferta
- **THEN** SHALL leer "Se analizará dentro de LinkVault." y SHALL ver "Dar permiso"
- **AND** SHALL poder pulsar "Analizar" sin dar el permiso

#### Scenario: Volver de Perfil no dispara nada

- **GIVEN** Ana en el diálogo, que pulsa "Dar permiso" y activa el consentimiento en `/perfil`
- **WHEN** vuelve a la oferta
- **THEN** el diálogo SHALL reabrirse mostrando "Se analizará con IA externa (OpenRouter)."
- **AND** NO SHALL haberse pedido ningún análisis

#### Scenario: Volver de Mi CV no dispara nada

- **GIVEN** Ana en el diálogo, que pulsa "Cambiar de CV" y marca otro CV en `/mi-cv`
- **WHEN** vuelve a la oferta
- **THEN** el diálogo SHALL reabrirse nombrando el CV recién marcado
- **AND** NO SHALL haberse pedido ningún análisis

#### Scenario: La oferta no se ha leído

- **GIVEN** una oferta sin título ni descripción
- **WHEN** Ana pulsa "Analizar"
- **THEN** SHALL ver que no hay con qué comparar su CV
- **AND** SHALL poder pegar la descripción desde ahí mismo

#### Scenario: Cerrar y volver

- **GIVEN** un análisis en marcha
- **WHEN** Ana cierra el diálogo y lo vuelve a abrir
- **THEN** SHALL ver el estado en que está, sin pedir otro análisis

#### Scenario: El encaje es de cada quien

- **GIVEN** Ana y Beto viendo la misma oferta del mismo grupo
- **WHEN** Ana termina su análisis
- **THEN** la tarjeta que ve Beto NO SHALL mostrar el encaje de Ana

### Requirement: La espera se ve por dentro

Un análisis tarda decenas de segundos, así que el diálogo NO SHALL mostrar solo un girador sin texto: SHALL **preguntar
a la API el estado del análisis cada 3 segundos durante como mucho 90 segundos** y SHALL mostrar el paso que devuelva
esa consulta, con los nombres **"Leyendo la oferta"**, **"Comparando con tu CV"** y **"Redactando sugerencias"**,
marcando como hechos los pasos ya pasados.

- El sondeo SHALL ser **la única vía** por la que esta pantalla cuenta la espera: el diálogo NO SHALL depender de
  ningún canal de eventos en vivo para avanzar, y su comportamiento NO SHALL cambiar según haya uno abierto o no.
- Mientras la consulta no devuelva ningún paso, el diálogo NO SHALL quedarse en blanco: SHALL mostrar **"Estamos
  analizando tu encaje…"**.
- Agotados los 90 segundos sin resultado, SHALL mostrar **"Sigue en proceso. Vuelve en un momento."** con el botón
  **"Actualizar"**, que pregunta otra vez y reanuda otra ventana de espera.
- El sondeo SHALL detenerse en cuanto el análisis termina o el diálogo se cierra.
- Un paso que el análisis se salta —redactar sugerencias, cuando el análisis termina siendo básico— NO SHALL quedar en
  pantalla como pendiente para siempre.
- Ningún paso mostrado SHALL contener texto del CV ni de la oferta.

#### Scenario: Los pasos conforme avanza

- **GIVEN** Ana con el análisis pedido
- **WHEN** las consultas de estado devuelven pasos sucesivos
- **THEN** SHALL ver el paso en curso y los anteriores marcados como hechos

#### Scenario: Todavía no hay paso que mostrar

- **GIVEN** un análisis recién pedido cuya consulta aún no devuelve ningún paso
- **WHEN** Ana mira el diálogo
- **THEN** SHALL ver "Estamos analizando tu encaje…" y ningún error en pantalla
- **AND** el informe SHALL aparecer igualmente cuando el análisis termine

#### Scenario: Un paso que no llega porque no toca

- **GIVEN** un análisis que termina siendo básico y nunca redacta sugerencias
- **WHEN** termina
- **THEN** el paso de redactar sugerencias NO SHALL quedarse en pantalla como pendiente

#### Scenario: Se acabó la paciencia

- **GIVEN** un análisis que sigue en marcha tras 90 segundos
- **WHEN** vence la espera
- **THEN** SHALL verse "Sigue en proceso. Vuelve en un momento." con "Actualizar"
- **AND** el sondeo SHALL haberse detenido

#### Scenario: Actualizar reanuda la espera

- **GIVEN** el aviso de "Sigue en proceso" con el sondeo detenido
- **WHEN** Ana pulsa "Actualizar" y el análisis sigue en marcha
- **THEN** SHALL preguntarse el estado y SHALL reanudarse la espera

#### Scenario: Salir corta el sondeo

- **GIVEN** un análisis en marcha con el diálogo abierto
- **WHEN** Ana cierra el diálogo
- **THEN** NO SHALL hacerse ninguna petición más de estado

### Requirement: El informe en pantalla

Terminado el análisis, el diálogo SHALL mostrar, en este orden: el badge de encaje, las habilidades que coinciden, las
que faltan y las sugerencias.

- Las habilidades que faltan SHALL mostrarse separando **lo imprescindible de lo deseable**, con los rótulos
  "Imprescindible" y "Suma puntos", nunca con los nombres internos.
- Sin ninguna habilidad coincidente SHALL mostrarse "Ninguna de las habilidades que pide esta oferta está en tu CV";
  sin ninguna que falte, "Tienes todas las habilidades que pide esta oferta".
- Si la oferta cambió después del análisis, SHALL mostrarse **"Esta oferta cambió desde tu análisis"** con la acción
  **"Volver a analizar"**.
- Si el informe se hizo con un CV que ya no es el marcado, SHALL mostrarse **"Lo analizaste con otro CV"** nombrando
  ese archivo, también con **"Volver a analizar"**, para que nadie lea como actual un informe de otro CV.
- El diálogo NO SHALL mostrar el texto completo del CV ni ofrecer verlo: para eso está `/mi-cv`.

#### Scenario: Informe completo

- **GIVEN** un análisis terminado con coincidencias, huecos y sugerencias
- **WHEN** Ana lo mira
- **THEN** SHALL ver el badge de encaje, las habilidades que coinciden, las que faltan y las sugerencias

#### Scenario: Lo imprescindible se distingue

- **GIVEN** un informe con una habilidad que falta marcada como imprescindible y otra como deseable
- **WHEN** Ana lo mira
- **THEN** SHALL verlas bajo rótulos distintos, "Imprescindible" y "Suma puntos"

#### Scenario: Nada coincide

- **GIVEN** un informe sin habilidades coincidentes
- **WHEN** Ana lo mira
- **THEN** SHALL ver que ninguna de las que pide la oferta está en su CV

#### Scenario: La oferta cambió

- **GIVEN** un análisis marcado como desactualizado porque la oferta cambió
- **WHEN** Ana abre el diálogo
- **THEN** SHALL ver el aviso y la acción de volver a analizar

#### Scenario: El informe es de otro CV

- **GIVEN** un análisis hecho con un CV que Ana ya no tiene marcado
- **WHEN** abre el diálogo
- **THEN** SHALL ver que lo analizó con otro CV, nombrándolo, y la acción de volver a analizar

#### Scenario: El CV no se enseña aquí

- **WHEN** Ana mira el informe
- **THEN** NO SHALL ver el texto completo de su CV ni ninguna acción para verlo en este diálogo

### Requirement: Las sugerencias enseñan de dónde salen

Cada sugerencia SHALL mostrarse con la sección del CV a la que se refiere, el texto propuesto, el motivo y **su
evidencia a la vista, sin abrir ni desplegar nada**: el requisito de la oferta que la motiva, bajo el rótulo **"Lo pide
la oferta"**, y el fragmento del CV al que se refiere, bajo **"En tu CV dice"**.

- Encima del bloque de sugerencias SHALL leerse siempre la advertencia **"Estas propuestas las redactó una IA a partir
  de tu CV y de la oferta. Revísalas: solo tú sabes qué es cierto."**
- Junto a esa advertencia SHALL leerse qué puede hacer hoy con ellas: **"Por ahora los cambios los aplicas tú en tu
  CV."**
- Cada sugerencia SHALL ofrecer **"Copiar"**, que pone su texto propuesto en el portapapeles y SHALL confirmarlo.
  "Copiar" NO SHALL modificar el CV, NO SHALL guardar nada en el análisis y NO SHALL presentarse como aceptar la
  sugerencia.
- Las sugerencias SHALL ordenarse por la **importancia del requisito que atacan**, primero las de un requisito
  imprescindible y después las de uno deseable, y las primeras SHALL verse sin desplazar el diálogo.
- Cuando la sugerencia no se refiere a nada que esté hoy en el CV, en lugar del fragmento SHALL mostrarse **"Esto no
  aparece en tu CV"**.
- Ninguna sugerencia SHALL mostrarse sin su requisito de la oferta.
- Las sugerencias SHALL mostrarse todas, hasta las 12 que como mucho llegan, sin paginación.

#### Scenario: Una sugerencia con su evidencia

- **GIVEN** una sugerencia con su requisito de la oferta y un fragmento del CV
- **WHEN** Ana la mira
- **THEN** SHALL ver los dos rótulos con su contenido sin pulsar nada

#### Scenario: Una sugerencia sobre algo que no está

- **GIVEN** una sugerencia cuyo fragmento del CV es nulo
- **WHEN** Ana la mira
- **THEN** SHALL ver "Esto no aparece en tu CV" en lugar del fragmento
- **AND** SHALL seguir viendo qué requisito de la oferta la motiva

#### Scenario: Queda claro quién lo escribió

- **GIVEN** un informe con sugerencias en pantalla
- **WHEN** Ana mira el bloque de sugerencias
- **THEN** SHALL leer, encima de todas, que las redactó una IA a partir de su CV y de la oferta y que debe revisarlas
- **AND** SHALL leer que por ahora los cambios los aplica ella en su CV

#### Scenario: Copiar una sugerencia

- **GIVEN** una sugerencia con su texto propuesto
- **WHEN** Ana pulsa "Copiar"
- **THEN** el texto propuesto SHALL quedar en el portapapeles y SHALL confirmarse
- **AND** ni su CV ni el análisis SHALL cambiar

#### Scenario: Lo más importante va primero

- **GIVEN** un informe con sugerencias de requisitos imprescindibles y de requisitos deseables
- **WHEN** Ana lo abre
- **THEN** las primeras sugerencias SHALL ser las de los requisitos imprescindibles
- **AND** SHALL verse sin desplazar el diálogo

#### Scenario: Todas a la vista

- **GIVEN** un informe con doce sugerencias
- **WHEN** Ana lo mira
- **THEN** SHALL poder leerlas todas desplazándose, sin paginar

### Requirement: El badge de encaje

La puntuación SHALL mostrarse como un badge con **el número visible** y una etiqueta que lo explique: **"Encaje
alto"** a partir de 75, **"Encaje medio"** entre 50 y 74, y **"Te falta bastante para esta oferta"** por debajo de 50.
El rótulo del tramo bajo SHALL hablar del hueco con la oferta y **NO SHALL calificar a la persona**.

- Bajo el badge SHALL leerse siempre la línea fija **"Cuánto de lo que pide esta oferta ya aparece en tu CV."**, para
  que nadie tenga que adivinar qué mide el número.
- En un análisis básico el badge SHALL mostrar **solo la etiqueta "Encaje aproximado — comparamos listas de
  habilidades"** y **NO SHALL mostrar ningún número**, ni en el diálogo ni en la tarjeta: ese número sale de un cruce
  por diccionario y no está ganado.
- El badge SHALL verse en el diálogo y también en la **tarjeta de la oferta** una vez analizada, para que la lista se
  pueda recorrer de un vistazo, con la misma regla: etiqueta y número en el análisis completo, solo etiqueta en el
  básico.
- El badge NO SHALL apoyarse solo en el color: su etiqueta SHALL decir lo mismo en texto.
- La tarjeta SHALL mostrar el badge solo del análisis propio; sin análisis, NO SHALL mostrar ningún badge.

#### Scenario: Encaje alto

- **GIVEN** un informe completo con puntuación 82
- **WHEN** Ana lo mira
- **THEN** SHALL ver el número 82 y la etiqueta "Encaje alto"

#### Scenario: El tramo bajo habla del hueco, no de la persona

- **GIVEN** un informe completo con puntuación 31
- **WHEN** Ana lo mira
- **THEN** SHALL ver el número 31 y la etiqueta "Te falta bastante para esta oferta"
- **AND** NO SHALL verse ningún mensaje de error

#### Scenario: El badge dice qué mide

- **WHEN** Ana mira el badge de cualquier informe
- **THEN** SHALL leer bajo él "Cuánto de lo que pide esta oferta ya aparece en tu CV."

#### Scenario: Un análisis básico no enseña número

- **GIVEN** un informe degradado con puntuación 64
- **WHEN** Ana lo mira en el diálogo y después mira la tarjeta de esa oferta
- **THEN** en los dos SHALL ver "Encaje aproximado — comparamos listas de habilidades"
- **AND** en ninguno SHALL ver el número 64

#### Scenario: El badge llega a la tarjeta

- **GIVEN** un análisis completo terminado de una oferta de su grupo
- **WHEN** Ana vuelve a la lista
- **THEN** la tarjeta de esa oferta SHALL mostrar su badge con el número

#### Scenario: Sin análisis no hay badge

- **GIVEN** una oferta que Ana nunca analizó
- **WHEN** mira su tarjeta
- **THEN** NO SHALL ver ningún badge de encaje

#### Scenario: El color no es la única señal

- **WHEN** se revisa el badge
- **THEN** su etiqueta SHALL decir el nivel en texto además del color

### Requirement: Un análisis básico se dice con todas las letras

Cuando el informe venga degradado, el diálogo SHALL encabezarlo con **"Análisis básico"** y explicar en una línea qué
falta, sin disfrazarlo de análisis completo.

- SHALL decir que se comparó lista de habilidades contra lista de habilidades, con **"Comparamos las habilidades de la
  oferta con las de tu CV, sin sugerencias."**
- El motivo SHALL nombrarse con palabras distintas según cuál sea: los proveedores caídos o ausentes, **"El análisis
  con IA no está disponible ahora."**; el límite diario de IA, **"Alcanzaste tu límite de análisis con IA por hoy.
  Volverás a tener análisis completos a partir de las <hora>."**, con la hora que devuelve la API.
- SHALL ofrecer **"Reintentar"** cuando el motivo puede pasarse solo.
- El mensaje del límite diario de IA SHALL distinguirse del mensaje de límite de la API que rechaza la petición, y
  ninguno de los dos SHALL confundirse con una avería.
- NO SHALL mostrarse ninguna sección de sugerencias vacía ni ningún hueco donde deberían estar, y tampoco la
  advertencia de que las redactó una IA, porque no hay ninguna.

#### Scenario: La IA no está disponible

- **GIVEN** un informe degradado porque todos los proveedores fallaron
- **WHEN** Ana lo mira
- **THEN** SHALL ver "Análisis básico", la explicación de que solo se compararon habilidades y "Reintentar"
- **AND** NO SHALL ver ninguna sección de sugerencias

#### Scenario: Límite diario de IA

- **GIVEN** un informe degradado por el límite diario de IA
- **WHEN** Ana lo mira
- **THEN** SHALL ver "Alcanzaste tu límite de análisis con IA por hoy. Volverás a tener análisis completos a partir de
  las <hora>." con la hora que devuelve la API

#### Scenario: Un básico no se disfraza

- **GIVEN** un informe degradado con puntuación 64
- **WHEN** Ana lo mira
- **THEN** el badge SHALL decir "Encaje aproximado — comparamos listas de habilidades"
- **AND** NO SHALL decir "Encaje medio" ni mostrar el número

### Requirement: Falta tu permiso

Cuando el informe venga degradado porque falta el consentimiento para proveedores de IA externos, el diálogo SHALL
decirlo con **"Para analizar tu CV con IA necesitamos tu permiso."**, SHALL explicar en una línea qué implica —"Se
envía el texto de tu CV con tu email, tus teléfonos, tu dirección y tu documento sustituidos por marcadores; el resto
del CV se envía tal cual. El texto completo y el interruptor están en Perfil."— y SHALL ofrecer **"Dar permiso"**, que
lleva a `/perfil`.

- El resumen NO SHALL prometer nada que el texto de `/perfil` no diga, en particular que lo enviado vaya anónimo o que
  el proveedor externo no lo conserve.
- Bajo ese aviso SHALL verse igualmente el análisis básico que sí se pudo hacer, con su cruce de habilidades.
- El aviso NO SHALL aparecer cuando la degradación tiene otro motivo.
- Este aviso NO SHALL pedir el permiso en el propio diálogo: la autorización es una preferencia del perfil.
- Vuelto desde `/perfil`, el diálogo SHALL reabrirse sobre la oferta mostrando el estado actualizado y SHALL esperar a
  que Ana pulse "Analizar", sin pedir nada por su cuenta.

#### Scenario: Sin permiso

- **GIVEN** Ana sin consentimiento y un informe degradado que lo señala
- **WHEN** abre el diálogo
- **THEN** SHALL ver el aviso del permiso, qué implica darlo y la acción que lleva a `/perfil`
- **AND** SHALL ver debajo el cruce de habilidades del análisis básico

#### Scenario: El resumen no sugiere anonimato

- **WHEN** se revisa el resumen de qué implica dar el permiso
- **THEN** SHALL decir que el resto del CV se envía tal cual
- **AND** NO SHALL decir que lo enviado va anónimo ni que el proveedor externo no lo conserva

#### Scenario: Ir a dar el permiso

- **GIVEN** el aviso del permiso en pantalla
- **WHEN** Ana pulsa "Dar permiso"
- **THEN** el SPA SHALL navegar a `/perfil`

#### Scenario: El permiso no se pide aquí

- **WHEN** Ana mira el aviso
- **THEN** NO SHALL ver ningún interruptor de consentimiento dentro del diálogo

#### Scenario: Otra degradación no habla de permisos

- **GIVEN** un informe degradado porque los proveedores fallaron
- **WHEN** Ana lo mira
- **THEN** NO SHALL ver ningún aviso sobre el consentimiento

### Requirement: Falta tu CV

Cuando la API rechaza el análisis por el CV, el diálogo SHALL decir cuál es el problema y SHALL terminar siempre en una
acción:

- `no_cv`: **"Necesitas un CV guardado para analizar tu encaje."** con **"Subir mi CV"**, que lleva a `/mi-cv`;
- `cv_not_ready`: **"Estamos leyendo tu CV. Inténtalo en un momento."** con **"Reintentar"**;
- `cv_not_readable`: **"Tu CV no se pudo leer, así que no podemos compararlo."** con **"Ir a Mi CV"**.

Ninguno de estos tres SHALL presentarse como una avería, y ninguno SHALL dejar el diálogo sin salida.

#### Scenario: Sin CV

- **GIVEN** Beto sin ningún CV guardado
- **WHEN** pulsa "Analizar"
- **THEN** SHALL ver que necesita un CV guardado y la acción que lleva a `/mi-cv`

#### Scenario: El CV se está leyendo

- **GIVEN** Ana con su CV recién subido y todavía en lectura
- **WHEN** pide el análisis
- **THEN** SHALL ver que se está leyendo y la acción de reintentar

#### Scenario: El CV no se pudo leer

- **GIVEN** Ana con su CV marcado en fallo de lectura
- **WHEN** pide el análisis
- **THEN** SHALL ver que no se pudo leer y la acción que lleva a `/mi-cv`
- **AND** el mensaje SHALL distinguirse del de un CV que todavía se está leyendo

### Requirement: Una avería no se confunde con un encaje bajo

Los fallos SHALL mostrarse como fallos nuestros y **nunca** como un resultado del análisis:

- `429` de la API, que rechaza la petición antes de encolar nada: **"Pediste muchos análisis seguidos. Podrás pedir
  otro a partir de las <hora>."**, con la hora calculada a partir de la espera que devuelve la API y la acción de
  reintentar cuando pase;
- un `5xx`, un fallo de red o un análisis terminado en fallo interno: **"No pudimos analizar ahora."** con
  **"Reintentar"**.

El mensaje del `429` SHALL distinguirse del mensaje del límite diario de IA de un análisis básico —uno dice que no se
aceptó la petición, el otro que el análisis salió sin IA— y los dos SHALL distinguirse de **"No pudimos analizar
ahora."**, que es una avería nuestra.

Un informe con puntuación baja NO SHALL mostrarse como error, NO SHALL llevar icono ni color de error y NO SHALL
ofrecer "Reintentar" como si algo hubiera fallado. Ningún mensaje de error SHALL contener texto del CV.

#### Scenario: Límite de peticiones de la API

- **GIVEN** la API respondiendo `429` con su espera
- **WHEN** Ana pide un análisis
- **THEN** SHALL ver "Pediste muchos análisis seguidos. Podrás pedir otro a partir de las <hora>." con esa hora
- **AND** SHALL poder reintentar cuando pase

#### Scenario: Los dos límites no se confunden

- **GIVEN** un `429` de la API en una oferta y un informe degradado por el límite diario de IA en otra
- **WHEN** Ana mira los dos mensajes
- **THEN** SHALL ser textos distintos, cada uno con su hora de vuelta
- **AND** ninguno SHALL decir "No pudimos analizar ahora."

#### Scenario: Avería del servidor

- **GIVEN** la API devolviendo `500`
- **WHEN** Ana pide un análisis
- **THEN** SHALL ver "No pudimos analizar ahora." con "Reintentar"

#### Scenario: El análisis terminó en fallo

- **GIVEN** un análisis que terminó con un fallo interno
- **WHEN** Ana abre el diálogo
- **THEN** SHALL ver "No pudimos analizar ahora." con "Reintentar"

#### Scenario: Un encaje bajo no es una avería

- **GIVEN** un informe con puntuación 12 y varias habilidades imprescindibles ausentes
- **WHEN** Ana lo mira
- **THEN** SHALL verlo como un resultado, con sus huecos y sus sugerencias
- **AND** NO SHALL ver ningún mensaje de error ni ninguna invitación a reintentar por avería

#### Scenario: Los errores no filtran el CV

- **GIVEN** cualquiera de los mensajes de error de esta pantalla
- **WHEN** se revisan sus textos
- **THEN** ninguno SHALL contener texto del CV

### Requirement: Lo que esta pantalla todavía no hace

El diálogo SHALL limitarse a **leer** el informe y a dejar copiar el texto de una sugerencia. NO SHALL ofrecer aplicar
una sugerencia al CV, aceptarla, rechazarla ni puntuarla, porque ninguna de esas vías existe todavía, NO SHALL ofrecer
descargar el informe ni compartirlo, y NO SHALL nombrar ninguna pantalla ni control que no exista.

#### Scenario: Sin acciones que no existen

- **GIVEN** un informe con sugerencias en pantalla
- **WHEN** Ana revisa las acciones del diálogo y de cada sugerencia
- **THEN** NO SHALL encontrar aplicar, aceptar, rechazar, puntuar, descargar ni compartir
- **AND** SHALL encontrar "Copiar" en cada sugerencia

### Requirement: Textos del análisis en español e inglés

Todos los textos de esta pantalla —la acción de la tarjeta, el título del diálogo, la línea de por dónde va a salir el
CV, los pasos de la espera, los rótulos del informe y de la evidencia, la advertencia de que las sugerencias las
redactó una IA, la acción de copiar, las etiquetas del badge con su línea de qué mide, los avisos de análisis básico,
de permiso y de CV, y los mensajes de error— SHALL estar marcados para traducción y traducidos al inglés, con el
español como idioma por defecto.

#### Scenario: Traducciones completas

- **WHEN** se comprueban los textos del análisis tras extraer los mensajes
- **THEN** cada unidad de traducción SHALL tener su versión en inglés
