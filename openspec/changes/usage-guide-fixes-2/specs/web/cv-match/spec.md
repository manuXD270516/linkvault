## MODIFIED Requirements

### Requirement: Falta tu CV

Cuando la API rechaza el análisis por el CV, el diálogo SHALL decir cuál es el problema y SHALL terminar siempre en una
acción:

- `no_cv`: **"Necesitas un CV guardado para analizar tu encaje."** con **"Subir mi CV"**, que lleva a `/mi-cv`;
- `cv_not_ready`: **"Estamos leyendo tu CV. Inténtalo en un momento."** con **"Reintentar"**;
- `cv_not_readable`: **"Tu CV no se pudo leer, así que no podemos compararlo."** con **"Ir a Mi CV"**.

Ninguno de estos tres SHALL presentarse como una avería, y ninguno SHALL dejar el diálogo sin salida.

Cuando el diálogo ya sabe al abrirse que la persona no tiene ningún CV —la lista de sus CV se cargó y está vacía— y
no hay en pantalla ni un informe ni un fallo devuelto por la API, SHALL mostrar directamente el estado de `no_cv`, con
**"Subir mi CV"**, sin ofrecer **"Analizar"** y sin pedir nada a la API de análisis. Ese estado SHALL tener prioridad
sobre los del permiso ("Comprobando el permiso…" y "No pudimos comprobar si diste permiso…"): sin CV no hay nada que
enviar. NO SHALL tapar un informe ni un fallo de la API ya mostrados. Si la lista de CV no se pudo cargar, el diálogo
NO SHALL suponer que falta: SHALL ofrecer "Analizar" como siempre, y un `no_cv` de la API SHALL llevar al mismo estado.

En el estado de `no_cv`, venga de la lista vacía o de la API, el diálogo NO SHALL mostrar la línea que dice por dónde
saldría el CV ("Se analizará con IA externa…" o "Se analizará dentro de LinkVault…"): sin CV no hay análisis que
enrutar.

#### Scenario: Sin CV

- **GIVEN** Beto sin ningún CV guardado
- **WHEN** abre "Analizar mi encaje" en una oferta de su grupo
- **THEN** SHALL ver "Necesitas un CV guardado para analizar tu encaje." y la acción "Subir mi CV", que lleva a `/mi-cv`
- **AND** NO SHALL ver "Analizar"
- **AND** NO SHALL ver la línea de por dónde saldría el CV
- **AND** el SPA NO SHALL haber pedido ningún análisis

#### Scenario: La lista se vacía con un informe en pantalla

- **GIVEN** Ana con el informe de su encaje en pantalla
- **WHEN** la lista de sus CV que el diálogo tiene cargada se queda vacía
- **THEN** el diálogo SHALL seguir mostrando el informe y NO SHALL pasar al estado de `no_cv`

#### Scenario: Sin CV y sin saber todavía el permiso

- **GIVEN** Beto sin ningún CV guardado y el permiso de IA externa sin poder comprobarse
- **WHEN** abre "Analizar mi encaje"
- **THEN** SHALL ver que necesita un CV guardado y la acción "Subir mi CV"
- **AND** NO SHALL ver el aviso de que no pudimos comprobar el permiso

#### Scenario: La API dice que no hay CV

- **GIVEN** Beto con el diálogo abierto sin que la lista de sus CV se haya podido cargar
- **WHEN** pulsa "Analizar" y la API responde `409` con código `no_cv`
- **THEN** SHALL ver que necesita un CV guardado y la acción que lleva a `/mi-cv`
- **AND** NO SHALL ver "No pudimos analizar ahora."

#### Scenario: El CV se está leyendo

- **GIVEN** Ana con su CV recién subido y todavía en lectura
- **WHEN** pide el análisis
- **THEN** SHALL ver que se está leyendo y la acción de reintentar

#### Scenario: El CV no se pudo leer

- **GIVEN** Ana con su CV marcado en fallo de lectura
- **WHEN** pide el análisis
- **THEN** SHALL ver que no se pudo leer y la acción que lleva a `/mi-cv`
- **AND** el mensaje SHALL distinguirse del de un CV que todavía se está leyendo

## ADDED Requirements

### Requirement: Los rechazos del análisis se reconocen por su código

El diálogo de encaje SHALL reconocer los rechazos de `POST` del análisis `job_not_ready`, `no_cv`, `cv_not_ready` y
`cv_not_readable` por el **código** de error de la respuesta, sea cual sea su status HTTP. Con el contrato vigente de
`cv/match`, los cuatro llegan como `409`, y cada uno SHALL llevar a su estado propio ("Todavía no hemos leído esta
oferta…", "Necesitas un CV guardado…", "Estamos leyendo tu CV…" y "Tu CV no se pudo leer…"), **nunca** a "No pudimos
analizar ahora.". Las pruebas del diálogo SHALL simular estos rechazos con el status que envía la API, no con uno
inventado.

#### Scenario: Oferta sin leer con el status real

- **GIVEN** Ana con su CV leído y una oferta que todavía no se leyó
- **WHEN** pulsa "Analizar" y la API responde `409` con código `job_not_ready`
- **THEN** SHALL ver "Todavía no hemos leído esta oferta, así que no hay con qué comparar tu CV." y "Pegar la
  descripción"
- **AND** NO SHALL ver "No pudimos analizar ahora."

#### Scenario: CV en lectura con el status real

- **GIVEN** Ana con su CV recién subido y todavía en lectura
- **WHEN** pulsa "Analizar" y la API responde `409` con código `cv_not_ready`
- **THEN** SHALL ver "Estamos leyendo tu CV. Inténtalo en un momento." y "Reintentar"

#### Scenario: CV ilegible con el status real

- **GIVEN** Ana con su CV marcado en fallo de lectura
- **WHEN** pulsa "Analizar" y la API responde `409` con código `cv_not_readable`
- **THEN** SHALL ver "Tu CV no se pudo leer, así que no podemos compararlo." y "Ir a Mi CV"

#### Scenario: Lo que manda es el código

- **GIVEN** el diálogo abierto con "Analizar" disponible
- **WHEN** la API rechaza el análisis con código `no_cv` y un status distinto de `409`
- **THEN** el diálogo SHALL mostrar igualmente "Necesitas un CV guardado para analizar tu encaje."

#### Scenario: Un fallo nuestro sigue siendo un fallo nuestro

- **GIVEN** el diálogo abierto con "Analizar" disponible
- **WHEN** la API responde `500`
- **THEN** el diálogo SHALL mostrar "No pudimos analizar ahora." con "Reintentar"
