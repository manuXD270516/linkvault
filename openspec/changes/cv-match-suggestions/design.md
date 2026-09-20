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

*Coste asumido y medido:* un CI escrito desnudo se escapa. Es la razón de que exista la métrica de fuga.

### D9. Las dos métricas de redacción no se tratan igual

`pii_leak_rate > 0` es **suelo duro**: rompe el CI incluso con `--update-baseline`. `redaction_skill_loss` admite línea
base ajustable a propósito. No son lo mismo: una fuga es un dato personal que salió; la sobre-redacción es calidad que
se negocia. Darles el mismo trato convertiría la fuga en negociable.

Se calculan **siempre como si el proveedor fuera externo y sin contactar a nadie**, para que corran en cada PR con el
mock.

### D10. La reinyección repone **todo**, incluso el nombre

La redacción protege frente al proveedor, no frente al dueño del dato: en `suggestions[].after` vuelven nombre,
dirección y documento. Un marcador que el modelo no devuelve convierte la salida en inválida — devolver `[ADDRESS_3]`
dentro de un texto que la persona va a pegar en su CV es peor que reintentar.

### D11. `fitScore` es derivado y no es un cambio de estado

Sigue al **último** análisis, no al mejor, y **nunca viaja sin `fitScoreDegraded`**. Actualizarlo no sube `version`, no
toca `statusChangedAt` y no escribe historial: si lo hiciera, un análisis que termina mientras alguien tiene la pantalla
abierta le devolvería un `409` por algo que no hizo.

Ausencia es **campo ausente, nunca `0`**: "todavía no lo analizaste" y "no encajas nada" no pueden verse igual.

### D12. El SSE lleva el paso y nada más

`analysis.step` lleva identificador, link, paso y momento. **Ni informe, ni skills, ni `score`, ni fragmentos.** El
último paso dice que terminó y quien lo recibe pide el resultado a la API. Así el CV queda fuera del canal *por
construcción*, no por cuidado al redactar cada evento.

Se reparte por el canal compartido para que llegue a todas las instancias de la API, no solo a la que corre el análisis.

### D13. Un diálogo, no una ruta nueva

El SPA no tiene detalle de oferta —los links se abren en pestaña nueva—, así que el análisis vive en un diálogo sobre la
lista. Inventar `/ofertas/:id` habría prometido una pantalla que no existe.

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

- **Q1. ¿Hace falta un reanálisis voluntario?** Hoy un análisis `done` no degradado se reutiliza y no existe "forzar
  rehacer". Si el debate lo quiere, hace falta un gesto explícito en el contrato y en la pantalla, más una decisión sobre
  si consume cuota. *Se puede responder sin tocar el resto del diseño.*
- **Q2. Umbrales del badge (75 / 50).** Inventados, sin respaldo en ningún ADR. Cambiarlos no toca el contrato.
- **Q3. Tamaño de la ventana de cuota** (24 h por configuración) y su valor por defecto.

**No** son preguntas abiertas, porque cambiarlas movería las specs: si un análisis degradado puntúa `fitScore` (sí, con
su marca), qué pasa con los análisis hechos al revocar (se conservan; la vía de borrado es borrar el CV) y si un
consentimiento caducado sigue valiendo (no). El debate puede revocarlas, pero son decisiones, no huecos.
