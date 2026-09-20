# Diseño — `cv-match-suggestions`

## Context

Ver `proposal.md` §Why. Lo que condiciona el diseño, que no está ahí:

- **La cañería de IA ya existe y no se toca.** `libs/ai` tiene `runTask`, routing por capacidades, breaker, cuotas,
  caché, mock determinista y `PiiRedactor`. Este change **añade una tarea** (`match-cv`) y **dos detectores** al
  redactor; no reabre la pasarela.
- **Ambas mitades del dato ya están.** `link-enrichment` produce `JobPreview`; `cv-upload-extract` produce el texto del
  CV. Nadie las ha puesto juntas todavía.
- **`ADR-029` fija dos cosas ya decididas por el autor**: los proveedores (Ollama local y OpenRouter `:free`, sin BYOK) y
  que el bucle de juez, el feedback y el diff de aceptar/rechazar **no** van aquí, sino en `cv-suggestions-review`.
- **La restricción que manda sobre todas.** `cv-upload-extract` prometió por escrito que el CV no sale sin autorización,
  y esa promesa está hoy en pantalla. Este change solo puede romperla construyendo primero la autorización de la que
  habla. Por eso el consentimiento no es una casilla: es la mitad del trabajo.
- Los tres contratos que las specs comparten y que el código debe respetar tal cual: el conjunto cerrado de pasos que
  declara `cv/match`, `aiConsent.textVersion` como lo que el SPA envía al activar, y `fitScoreDegraded` como compañero
  inseparable de `fitScore`.

## Goals / Non-Goals

**Goals:**

- Que una persona vea, sobre una oferta concreta, su encaje y qué le falta, con **cada sugerencia trazable** a un
  requisito de la vacante.
- Que la salida del CV hacia un tercero sea **una decisión suya, informada, fechada y revocable**, y que el sistema no
  pueda saltársela ni por error de rutina.
- Que la redacción de PII deje de ser una promesa y pase a ser **dos números en un reporte**.
- Que cuando la IA no esté, el producto **diga que no está** en vez de fingir un análisis.

**Non-Goals:**

- El bucle evaluator–optimizer, `critique-suggestions`, `judgeScore`/`judgeModel`, el feedback "no me convence" y el
  diff de aceptar o rechazar sugerencias: `cv-suggestions-review` (ADR-029).
- BYOK: `ai-byok`.
- Reanálisis automático cuando cambia la oferta o el CV. Se **detecta** y se dice; no se relanza solo.
- Comparar un CV contra varias ofertas a la vez, ni ranking de ofertas por encaje.

## Decisions

### D1. El análisis es asíncrono: `POST` → `202`, y el resultado se pide con un `GET`

Un `match-cv` con dos modelos encadenados tarda decenas de segundos: mantener la petición HTTP abierta ata el resultado
a que el navegador siga vivo. Se acepta el trabajo con `202`, se cuenta el progreso por SSE y **el resultado se pide con
un `GET` propio**.

*Alternativa descartada:* devolver el informe en la respuesta del `POST`. Además de la espera, dejaba la pantalla sin
salida cuando el canal SSE se cae — que es justo cuando más falta hace poder preguntar "¿y entonces?".

*Alternativa descartada:* solo SSE, sin `GET`. Un evento perdido sería un resultado perdido.

### D2. El trabajo corre en el worker, disparado por outbox

Igual que la extracción del CV (ADR-009): el `POST` escribe el análisis en estado `running` y su evento en
`outbox_events` **dentro de la misma transacción**, y el relay lo publica. Nada de llamar a la cola desde el controlador.

Y con la lección de `cv-upload-extract` incorporada: el `jobId` se declara en `OUTBOX_ROUTES` y queda cubierto por el
test que recorre todas las rutas replicando las reglas de BullMQ. Ese defecto ya se pagó una vez.

### D3. El consentimiento se comprueba **al ejecutar**, no al pedir

Entre el `POST` y el momento en que el worker llama al proveedor pasan segundos o minutos. Si alguien revoca en esa
ventana, lo que vale es la decisión más reciente: el worker **vuelve a leer** el consentimiento inmediatamente antes de
elegir proveedor.

*Consecuencia aceptada:* una ejecución **ya enviada** al externo se completa y se guarda. Descartar el resultado no
deshace el envío, y fingir que no ocurrió sería menos honesto que guardarlo.

### D4. Un consentimiento sobre una versión anterior del texto **no autoriza nada**

Si el texto cambió es porque cambió qué se envía, a quién, o qué se redacta. Mantener vigente la aceptación de un texto
que ya no describe la realidad es exactamente el fallo que el consentimiento debería impedir.

*Coste asumido:* cambiar una coma obliga a que todo el mundo vuelva a aceptar. Se mitiga atando la versión al **hash del
contenido**, de modo que solo se versiona cuando el contenido cambia de verdad, y versionando por **contenido y no por
idioma**: reescribir el inglés también obliga a versionar, porque en inglés se lee la misma promesa.

*Consecuencia en pantalla, que costó un choque entre specs:* con la versión caducada, `/perfil` **no puede presentar el
permiso como activo**. Avisa de que el texto cambió y pide leerlo de nuevo, mostrando la fecha y la versión aceptadas.

### D5. El cliente manda la versión que mostró; el servidor nunca la estampa

Activar exige `textVersion`, y si no es la vigente responde `409 consent_text_outdated`. Si el servidor rellenara la
versión vigente por su cuenta, registraría la aceptación de un texto que la persona **no llegó a ver** —un SPA cacheado
basta para eso—, y el registro de consentimiento valdría cero.

### D6. Degradar es un resultado, no un error, y se distingue de "te falta permiso"

`RuleBasedMatcher` cruza skills por diccionario y devuelve `degraded: true`, `degradedReason` y **cero sugerencias**.
Junto al informe viaja `consentRequired`, para que la pantalla pueda decir *"te falta autorizar"* en vez de *"la IA
falló"*. Sin ese campo el SPA tendría que adivinar, y adivinaría mal justo en el caso que tiene arreglo.

Un informe degradado **con** sugerencias es una contradicción: no se guarda.

### D7. Cada sugerencia arrastra su evidencia, y sin ella la salida es inválida

`evidence.jobRequirement` obligatorio; `cvFragment` nullable y acotado a 300 caracteres. Una salida sin evidencia entra
en el camino de reparación y, si insiste, se pasa al siguiente proveedor. **Una sugerencia sin procedencia es
indistinguible de una invención**, y el producto está opinando sobre la vida laboral de alguien.

El `cvFragment` es, además, el **único texto del CV que queda persistido** fuera de `cv_documents`: acotarlo es acotar la
superficie de datos personales.

### D8. Dos detectores nuevos, deliberadamente conservadores

- **Documento de identidad**: solo con extensión departamental o palabra clave cerca (`CI`, `DNI`, `cédula`). Un número
  suelto de 7–8 dígitos **no** es documento.
- **Dirección**: acotada por separador fuerte, no hasta fin de línea. **Ciudad, departamento y país no son dirección.**

*Por qué así:* redactar de más **destruye la señal que el análisis necesita** —la ubicación decide remoto o presencial, y
un número puede ser un salario— y el daño no se ve, porque el informe sale igual, solo que peor. Por eso la
sobre-redacción se mide, no se estima.

Un indicador solo cuenta si va precedido de inicio de línea o separador y seguido de dígitos: sin esa condición, `C#`,
`C/C++` y `.NET` se redactaban como si fueran direcciones, y `Zona` o `N°` disparaban en prosa corriente. **Un lenguaje
de programación no es una dirección** — y las specs llegaron a consagrar la pérdida de `C/C++` como resultado esperado,
que es la forma en que un defecto se convierte en comportamiento oficial (*iteración 1, critic 15*).

*Coste asumido y medido:* un documento escrito sin ninguna palabra clave ni extensión se escapa. Queda **declarado como
hueco conocido**, con su motivo y su decisión humana, no como un número que el CI pueda ir subiendo.

### D9. Las tres métricas de redacción no se tratan igual

`pii_leak_rate > 0` es **suelo duro**: rompe el CI incluso con `--update-baseline`. `redaction_skill_loss` admite línea
base ajustable a propósito. No son lo mismo: una fuga es un dato personal que salió; la sobre-redacción es calidad que
se negocia. Darles el mismo trato convertiría la fuga en negociable.

La primera versión, sin embargo, **no podía estar verde nunca**: exigía meter en el golden el documento desnudo que D8
asume que se escapa, y a la vez que cualquier fuga rompiera el CI (*iteración 1, critic 2*). Los huecos aceptados se
declaran **aparte**, quedan fuera del suelo duro y se cuentan en una tercera métrica informativa que los lista. Y
ninguna opción del corredor puede crear o ampliar esa declaración: sacar una fuga del suelo duro exige una decisión
humana escrita, nunca un `--update-baseline`.

### D9-bis. El resultado de una tarea `personal` no se cachea

La caché de `libs/ai` guarda lo que `runTask` devuelve, y eso está **ya reinyectado**: la entrada habría quedado días
con el `cvFragment` y con el nombre, la dirección y el documento reales, en una caché compartida que nadie borra al
borrar el CV (*iteración 1, critic 1*). Contradecía de frente a D7.

Una tarea declara si es cacheable y una `personal` nunca lo es; declararla cacheable impide arrancar. Se descartó
cachear con clave por usuario, TTL corto y borrado en cascada: más piezas y más sitios donde olvidarse, para ahorrar una
ejecución que se pide una vez por oferta.

Se calculan **siempre como si el proveedor fuera externo y sin contactar a nadie**, para que corran en cada PR con el
mock.

### D10. La reinyección repone **todo**, incluso el nombre

La redacción protege frente al proveedor, no frente al dueño del dato: en `suggestions[].after` vuelven nombre,
dirección y documento. Un marcador que el modelo no devuelve convierte la salida en inválida — devolver `[ADDRESS_3]`
dentro de un texto que la persona va a pegar en su CV es peor que reintentar.

### D11. `fitScore` se deriva al leer; nadie lo escribe

La primera versión lo **escribía** en la postulación al terminar el análisis, y esa escritura no tenía camino: el
análisis acaba en el worker, la escritura vivía en la API y no existía ningún evento que las uniera. La promesa no podía
ejecutarse (*iteración 1, critic 5*).

Se deriva al responder, del último análisis de esa persona sobre ese link. Eso elimina de un golpe el dual-write, la
ventana de desincronización, las puntuaciones huérfanas al borrar un CV y el `409` que le habría llegado a quien tuviera
la pantalla abierta. *Coste:* una lectura más al componer la postulación.

Sigue al **último** análisis, no al mejor, y **nunca viaja sin `fitScoreDegraded`**. Ausencia es **campo ausente, nunca
`0`**: "todavía no lo analizaste" y "no encajas nada" no pueden verse igual.

### D12. La espera se pregunta, no se escucha

El análisis deja escrito el paso que alcanza y el `GET` lo devuelve; la pantalla lo consulta mientras dura. **El aviso
en vivo por SSE se difiere a `cv-suggestions-review`** (ADR-030 §9).

El diseño del evento era correcto —llevaba el paso y nada más, dejando el CV fuera del canal por construcción— pero
había **tres** mecanismos para contar una espera de unos cuarenta segundos: el canal, un sondeo de respaldo obligatorio
y un botón de actualizar. El sondeo solo cumple la promesa, y quitar el canal elimina una superficie nueva por la que
algo del CV podría escaparse. El bucle de juez del change siguiente tiene más pasos y ahí sí lo justifica.

### D12-bis. Un análisis pedido, un solo envío, y el vencido es terminal

La cola reintentaba tres veces y cada reintento reejecutaba el análisis entero: hasta **tres envíos del CV** a un
proveedor externo por un único análisis pedido (*iteración 1, critic 8*). La propiedad que se exige es observable: el
número de veces que el CV llega a un proveedor externo no crece con el número de entregas del trabajo.

Y los dos plazos —el de la API y el del worker— no estaban relacionados, así que un análisis vencido se leía como
fallido pero seguía "en curso": volver a pedirlo devolvía el mismo y fallaba otra vez, con un botón que no hacía nada
(*critic 9*). El plazo de la API es mayor que el del worker con sus reintentos, un vencido no se reutiliza y un
resultado que llega tarde no sobrescribe lo que la persona ya vio.

### D12-ter. Solo consume cuota el análisis que entrega un informe

Se le cobraban a la persona **nuestras** averías: un fallo interno o un vencimiento gastaban intento. Peor, un degradado
por cuota de IA agotada no se reutilizaba, así que cada reintento quemaba un intento más de la cuota de la API mientras
la de IA seguía agotada, hasta gastar el día entero en informes básicos (*iteración 1, critic 10*).

### D13. Un diálogo, no una ruta nueva

El SPA no tiene detalle de oferta —los links se abren en pestaña nueva—, así que el análisis vive en un diálogo sobre la
lista. Inventar `/ofertas/:id` habría prometido una pantalla que no existe.

### D14. La pantalla no envía nada sin que se lo pidan, y lo que enseña se puede usar

El diálogo disparaba el análisis **al abrirse**: un clic en una tarjeta mandaba el CV a un tercero sin anunciarlo, y sin
permiso gastaba un intento de cuota que jamás podía funcionar (*iteración 1, business 3*). En un change cuya tesis es
que la persona decide cuándo sale su CV, la pantalla lo enviaba sin preguntar. Ahora dice antes con qué CV y **por dónde
va a salir**, y espera.

Y las sugerencias dejan de ser un escaparate: se **copian**, se ordenan por la importancia del requisito que atacan y
llevan encima que **las redactó una IA y hay que revisarlas**. ADR-029 justificó el corte en dos diciendo que esta mitad
entrega valor sola; sin poder usar lo que se enseña, no era verdad (*business 4 y 5*).

### D15. Una promesa desmentida obliga a un identificador de traducción nuevo

La línea de privacidad de `/mi-cv` tiene un identificador estable. Cambiar el texto español conservándolo habría dejado
la traducción inglesa diciendo *"today no AI reads it"* mientras el CV viaja a OpenRouter, y los escenarios que la
verificaban eran todos del lado español (*iteración 1, critic 6*).

Regla que el proyecto hereda: **una traducción heredada es una promesa que sobrevive a su desmentido.** Cambiar el
contenido de una frase que promete algo obliga a un identificador nuevo, con una comprobación que mira original y
traducciones.

## Risks / Trade-offs

- **Los modelos `:free` de OpenRouter cambian de disponibilidad sin aviso** → el breaker y la degradación cubren la
  caída. Lo que **no** cubren es una bajada silenciosa de calidad; eso lo verán las métricas de `cv-suggestions-review`.
  Riesgo aceptado en ADR-029.
- **El texto redactado de un CV sale a un tercero.** No hay mitigación que lo elimine: se acota (solo `:free` con
  `data_collection: "deny"`, solo con consentimiento vigente, solo lo redactado) y se dice con todas las letras en el
  texto del consentimiento, que **prohíbe** prometer que el proveedor no conserva lo enviado.
- **Un CI desnudo se escapa al detector** → medido por `pii_leak_rate`, con suelo duro en CI.
- **Sobre-redacción que empeora el análisis sin que se note** → `redaction_skill_loss` con línea base.
- **Reutilizar un análisis `done` puede devolver algo viejo** si la oferta o el CV cambiaron → se marcan `stale` y
  `cvChanged` y la pantalla lo dice. Ver Q1.
- **Una espera larga sin canal** → sondeo cada 3 s hasta 90 s y luego un botón "Actualizar"; nunca una rueda infinita.

## Open Questions

- **Q1 — cerrada en el debate con un "no".** No hay reanálisis voluntario cuando nada cambió: un análisis completo se
  reutiliza. Era una decisión disfrazada de pregunta, y dejarla abierta habría puesto en pantalla un botón que no hacía
  nada. El contrato de repetir el análisis cubre ahora **todos** los estados —en curso, completo, degradado, vencido y
  fallido— diciendo en cada uno si se reutiliza o se ejecuta uno nuevo, para que la pantalla no pueda ofrecer un gesto
  muerto.
- **Q2. Umbrales del badge (75 / 50).** Siguen inventados y sin respaldo. Moverlos no cambia ningún contrato, así que se
  quedan como están hasta que haya datos reales.
- **Q3 — cerrada.** La ventana de cuota es **configurable, 24 horas por defecto**. Estaba fijada como 24 h en la spec y
  configurable en las tareas, que es peor que cualquiera de las dos.
- **Q4 (nueva, va a la implementación).** Qué modelo `:free` concreto entra y **dónde se comprueba
  `data_collection: "deny"`**, que ADR-018 §12 exige y hoy nadie verifica: todo el change corre contra el mock. Si el
  modelo elegido no tiene endpoint que acepte esa opción, el proveedor falla, el breaker abre y la degradación es
  **permanente y silenciosa** mientras `/perfil` afirma que el CV va a OpenRouter. Se cierra con una pasada manual real
  anotada en el RUNBOOK, no con un valor por defecto elegido a ciegas.

**No** son preguntas abiertas, porque cambiarlas movería las specs: si un análisis degradado puntúa `fitScore` (sí, con
su marca), qué pasa con los análisis hechos al revocar (se conservan; la vía de borrado es borrar el CV) y si un
consentimiento caducado sigue valiendo (no). El debate puede revocarlas, pero son decisiones, no huecos.
