## MODIFIED Requirements

### Requirement: Tablero de postulaciones

`/postulaciones` SHALL ser una ruta con sesión, cargada de forma diferida, accesible desde la barra de navegación con el
texto "Postulaciones". SHALL mostrar las postulaciones propias en columnas, en este orden: "Interés" (que incluye
también las que estén en `saved`), "Postuladas", "En proceso", "Con oferta", "Aceptadas" y "Cerradas", que reúne las
rechazadas, retiradas y expiradas con una etiqueta que dice cuál es cada una. NO SHALL haber columna de guardadas. Cada
tarjeta SHALL mostrar el título de la oferta (o la etiqueta derivada de su URL si no lo tiene), su empresa, su
plataforma, la etapa en "En proceso", la fecha de postulación cuando la haya, y una marca cuando se comparte con los
grupos. Sin postulaciones SHALL mostrar "Aquí verás las ofertas que sigues. Pulsa «Me interesa» o «Postulé» en
cualquier oferta de tus grupos o de tu lista." con enlaces a `/grupos` y a `/mis-links`.

Cada tarjeta SHALL mostrar además el **encaje del análisis propio** sobre esa oferta, con la misma regla que el badge
de encaje del resto del SPA, para que la puntuación que ya se calcula tenga dónde verse mientras se sigue la oferta:

- con un análisis **completo**, la etiqueta y el número;
- con un análisis **básico** —el que llega marcado como degradado—, **solo la etiqueta**, nunca el número;
- **sin ningún análisis**, ningún badge: la tarjeta NO SHALL mostrar un cero ni ningún hueco que se lea como encaje
  nulo, porque "todavía no lo analizaste" y "no encajas nada" no pueden verse igual.

El badge de la tarjeta SHALL ser siempre el del análisis de quien mira, NO SHALL mostrar el informe, las habilidades ni
ninguna sugerencia, y NO SHALL convertirse en un criterio de orden ni de filtro de las columnas.

#### Scenario: Tablero vacío

- **GIVEN** un usuario que no sigue ninguna oferta
- **WHEN** abre `/postulaciones`
- **THEN** SHALL ver "Aquí verás las ofertas que sigues. Pulsa «Me interesa» o «Postulé» en cualquier oferta de tus
  grupos o de tu lista."

#### Scenario: Una tarjeta por postulación, en su columna

- **GIVEN** un usuario con una postulación en `interested`, otra en `in_process` con la etapa "Prueba técnica", otra en
  `offer`, otra en `rejected` y otra en `saved`
- **WHEN** abre `/postulaciones`
- **THEN** SHALL ver en "Interés" la de `interested` y la de `saved`, en "En proceso" la de "Prueba técnica", en "Con
  oferta" la de `offer` y en "Cerradas" la rechazada con la etiqueta "Rechazada"
- **AND** NO SHALL ver ninguna columna de guardadas

#### Scenario: El encaje de un análisis completo

- **GIVEN** una postulación de Ana con la puntuación de un análisis completo de 78
- **WHEN** abre `/postulaciones`
- **THEN** su tarjeta SHALL mostrar el número 78 con su etiqueta de encaje

#### Scenario: El encaje de un análisis básico no enseña número

- **GIVEN** una postulación de Ana con la puntuación de un análisis básico de 41
- **WHEN** abre `/postulaciones`
- **THEN** su tarjeta SHALL mostrar solo la etiqueta del encaje aproximado
- **AND** NO SHALL mostrar el número 41

#### Scenario: Sin análisis no hay badge en el tablero

- **GIVEN** una postulación de una oferta que Ana nunca analizó
- **WHEN** abre `/postulaciones`
- **THEN** su tarjeta NO SHALL mostrar ningún badge de encaje
- **AND** NO SHALL mostrar un 0

#### Scenario: Ruta diferida

- **WHEN** se carga la aplicación en `/grupos`
- **THEN** el código del tablero NO SHALL haberse descargado hasta navegar a `/postulaciones`
