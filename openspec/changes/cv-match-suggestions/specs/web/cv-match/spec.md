## Purpose

La pantalla donde una persona descubre si encaja en una oferta y qué le falta. Enseña el informe con la evidencia de
cada sugerencia a la vista, dice con todas las letras cuándo el análisis fue básico y cuándo hace falta su permiso, y
distingue siempre un problema nuestro de un encaje bajo, que es un resultado y no un error.

## ADDED Requirements

### Requirement: Pedir el análisis desde la oferta

Cada oferta que una persona puede ver —en `/grupos/:id` y en `/mis-links`— SHALL ofrecer la acción **"Analizar mi
encaje"**, que SHALL abrir un diálogo titulado **"Tu encaje con esta oferta"** con el nombre de la vacante y SHALL
pedir el análisis al abrirse.

- El diálogo SHALL decir, antes de empezar, **con qué CV se va a analizar**, nombrándolo por su archivo, y SHALL
  ofrecer "Cambiar de CV", que lleva a `/mi-cv`.
- Mientras el análisis está en marcha, la acción NO SHALL aceptar una segunda petición y SHALL quedar deshabilitada con
  `aria-busy`.
- Si la oferta todavía no se ha leído y la API responde `job_not_ready`, el diálogo SHALL mostrar **"Todavía no hemos
  leído esta oferta, así que no hay con qué comparar tu CV."** y SHALL ofrecer **"Pegar la descripción"**, que abre el
  formulario que ya existe para completarla.
- Cerrar el diálogo NO SHALL cancelar el análisis: al volver a abrirlo SHALL verse su estado actual.
- El análisis SHALL ser privado: la tarjeta de la oferta NO SHALL mostrar el encaje de ningún otro miembro del grupo.

#### Scenario: Empezar el análisis

- **GIVEN** Ana con un CV leído y una oferta ya leída en su grupo
- **WHEN** pulsa "Analizar mi encaje"
- **THEN** SHALL abrirse el diálogo con el nombre de la vacante y el del CV que se usará
- **AND** el análisis SHALL quedar pedido sin que Ana tenga que pulsar nada más

#### Scenario: La oferta no se ha leído

- **GIVEN** una oferta sin título ni descripción
- **WHEN** Ana pulsa "Analizar mi encaje"
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

Un análisis tarda decenas de segundos, así que el diálogo NO SHALL mostrar solo un girador sin texto: SHALL mostrar el
paso en curso conforme llega por el canal de eventos, con los nombres **"Leyendo la oferta"**, **"Comparando con tu
CV"** y **"Redactando sugerencias"**, y SHALL marcar como hechos los pasos ya pasados.

- Si el canal de eventos no está disponible o no llega ningún paso, el diálogo NO SHALL quedarse en blanco: SHALL
  mostrar **"Estamos analizando tu encaje…"** y SHALL preguntar el estado del análisis cada 3 segundos durante como
  mucho 90 segundos.
- Agotado ese tiempo sin resultado, SHALL mostrar **"Sigue en proceso. Vuelve en un momento."** con el botón
  **"Actualizar"**, que pregunta otra vez y reanuda otra ventana de espera.
- El sondeo SHALL detenerse en cuanto el análisis termina o el diálogo se cierra.
- Un paso que el análisis se salta —redactar sugerencias, cuando el análisis termina siendo básico— NO SHALL quedar en
  pantalla como pendiente para siempre.
- Ningún paso mostrado SHALL contener texto del CV ni de la oferta.

#### Scenario: Los pasos en vivo

- **GIVEN** Ana con el diálogo abierto y el canal de eventos funcionando
- **WHEN** llegan los avisos de progreso del análisis
- **THEN** SHALL ver el paso en curso y los anteriores marcados como hechos

#### Scenario: El canal se cae

- **GIVEN** el canal de eventos que no se puede abrir
- **WHEN** Ana pide el análisis
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

Terminado el análisis, el diálogo SHALL mostrar, en este orden: el badge de encaje con su puntuación, las habilidades
que coinciden, las que faltan y las sugerencias.

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
- **THEN** SHALL ver la puntuación, las habilidades que coinciden, las que faltan y las sugerencias

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

#### Scenario: Todas a la vista

- **GIVEN** un informe con doce sugerencias
- **WHEN** Ana lo mira
- **THEN** SHALL poder leerlas todas desplazándose, sin paginar

### Requirement: El badge de encaje

La puntuación SHALL mostrarse como un badge con **el número siempre visible** y una etiqueta que lo explique: **"Encaje
alto"** a partir de 75, **"Encaje medio"** entre 50 y 74, y **"Encaje bajo"** por debajo de 50.

- El badge SHALL verse en el diálogo y también en la **tarjeta de la oferta** una vez analizada, para que la lista se
  pueda recorrer de un vistazo.
- En un análisis básico la etiqueta SHALL ser **"Encaje aproximado"**, nunca una de las tres anteriores.
- El badge NO SHALL apoyarse solo en el color: su etiqueta SHALL decir lo mismo en texto.
- La tarjeta SHALL mostrar el badge solo del análisis propio; sin análisis, NO SHALL mostrar ningún badge.

#### Scenario: Encaje alto

- **GIVEN** un informe con puntuación 82
- **WHEN** Ana lo mira
- **THEN** SHALL ver el número 82 y la etiqueta "Encaje alto"

#### Scenario: Encaje bajo

- **GIVEN** un informe con puntuación 31
- **WHEN** Ana lo mira
- **THEN** SHALL ver el número 31 y la etiqueta "Encaje bajo"
- **AND** NO SHALL verse ningún mensaje de error

#### Scenario: El badge llega a la tarjeta

- **GIVEN** un análisis terminado de una oferta de su grupo
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
  con IA no está disponible ahora."**; el límite diario de IA, **"Alcanzaste tu límite de análisis con IA por hoy."**
- SHALL ofrecer **"Reintentar"** cuando el motivo puede pasarse solo, y el mensaje del límite SHALL decir cuándo se
  podrá de nuevo.
- NO SHALL mostrarse ninguna sección de sugerencias vacía ni ningún hueco donde deberían estar.

#### Scenario: La IA no está disponible

- **GIVEN** un informe degradado porque todos los proveedores fallaron
- **WHEN** Ana lo mira
- **THEN** SHALL ver "Análisis básico", la explicación de que solo se compararon habilidades y "Reintentar"
- **AND** NO SHALL ver ninguna sección de sugerencias

#### Scenario: Límite diario de IA

- **GIVEN** un informe degradado por el límite diario de IA
- **WHEN** Ana lo mira
- **THEN** SHALL ver el mensaje del límite con cuándo podrá volver a analizar

#### Scenario: Un básico no se disfraza

- **GIVEN** un informe degradado con puntuación 64
- **WHEN** Ana lo mira
- **THEN** el badge SHALL decir "Encaje aproximado" y NO SHALL decir "Encaje medio"

### Requirement: Falta tu permiso

Cuando el informe venga degradado porque falta el consentimiento para proveedores de IA externos, el diálogo SHALL
decirlo con **"Para analizar tu CV con IA necesitamos tu permiso."**, SHALL explicar en una línea qué implica —"Se
envía el texto de tu CV con tu email, tus teléfonos, tu dirección y tu documento sustituidos por marcadores. El texto
completo y el interruptor están en Perfil."— y SHALL ofrecer **"Dar permiso"**, que lleva a `/perfil`.

- El resumen NO SHALL prometer nada que el texto de `/perfil` no diga, en particular que lo enviado vaya anónimo o que
  el proveedor externo no lo conserve.

- Bajo ese aviso SHALL verse igualmente el análisis básico que sí se pudo hacer, con su cruce de habilidades.
- El aviso NO SHALL aparecer cuando la degradación tiene otro motivo.
- Este aviso NO SHALL pedir el permiso en el propio diálogo: la autorización es una preferencia del perfil.
- Vuelto desde `/perfil`, "Analizar mi encaje" SHALL seguir disponible en la oferta para pedirlo otra vez.

#### Scenario: Sin permiso

- **GIVEN** Ana sin consentimiento y un informe degradado que lo señala
- **WHEN** abre el diálogo
- **THEN** SHALL ver el aviso del permiso, qué implica darlo y la acción que lleva a `/perfil`
- **AND** SHALL ver debajo el cruce de habilidades del análisis básico

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
- **WHEN** pulsa "Analizar mi encaje"
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

- `429`: el mensaje de límite con la espera que devuelve la API y la acción de reintentar cuando pase;
- un `5xx`, un fallo de red o un análisis terminado en fallo interno: **"No pudimos analizar ahora."** con
  **"Reintentar"**.

Un informe con puntuación baja NO SHALL mostrarse como error, NO SHALL llevar icono ni color de error y NO SHALL
ofrecer "Reintentar" como si algo hubiera fallado. Ningún mensaje de error SHALL contener texto del CV.

#### Scenario: Límite de análisis alcanzado

- **GIVEN** la API respondiendo `429` con su espera
- **WHEN** Ana pide un análisis
- **THEN** SHALL ver el mensaje de límite con la espera y la opción de reintentar después

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

El diálogo SHALL limitarse a **leer** el informe. NO SHALL ofrecer aplicar una sugerencia al CV, aceptarla, rechazarla,
puntuarla, descargarla ni compartir el informe, porque ninguna de esas vías existe todavía, y NO SHALL nombrar ninguna
pantalla ni control que no exista.

#### Scenario: Sin acciones que no existen

- **GIVEN** un informe con sugerencias en pantalla
- **WHEN** Ana revisa las acciones del diálogo y de cada sugerencia
- **THEN** NO SHALL encontrar aplicar, aceptar, rechazar, puntuar, descargar ni compartir

### Requirement: Textos del análisis en español e inglés

Todos los textos de esta pantalla —la acción de la tarjeta, el título del diálogo, los pasos de la espera, los rótulos
del informe y de la evidencia, las etiquetas del badge, los avisos de análisis básico, de permiso y de CV, y los
mensajes de error— SHALL estar marcados para traducción y traducidos al inglés, con el español como idioma por defecto.

#### Scenario: Traducciones completas

- **WHEN** se comprueban los textos del análisis tras extraer los mensajes
- **THEN** cada unidad de traducción SHALL tener su versión en inglés
