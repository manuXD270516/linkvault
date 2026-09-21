## MODIFIED Requirements

### Requirement: La espera se ve por dentro

Un análisis tarda decenas de segundos, así que el diálogo NO SHALL mostrar solo un girador sin texto: SHALL **preguntar a la API el estado del análisis cada 3 segundos** y SHALL mostrar el paso que devuelva esa consulta, con los nombres **"Leyendo la oferta"**, **"Comparando con tu CV"**, **"Redactando sugerencias"**, **"Revisando sugerencias…"** y **"Mejorando sugerencias…"**, marcando como hechos los pasos ya pasados.

- La **ventana de espera SHALL derivarse del plazo máximo que la API declara para un análisis**, que es el mismo tras el cual la API lo da por vencido, y **NO SHALL ser una constante del SPA**.
- Mientras el análisis siga en `running` y dentro de ese plazo, el diálogo NO SHALL mostrar el aviso de paciencia agotada.
- Si el SPA no conoce ese plazo, NO SHALL inventarse uno más corto: SHALL seguir preguntando y SHALL esperar a que la API declare el análisis vencido o terminado.
- El sondeo SHALL ser **obligatorio y suficiente**: el diálogo NO SHALL depender de ningún canal de eventos en vivo para avanzar. Si hay un canal abierto, MAY adelantar el mismo paso al recibir `analysis.step` de ese análisis; si el canal no está o no llega el aviso, el comportamiento SHALL ser idéntico al del sondeo solo.
- Mientras la consulta no devuelva ningún paso, el diálogo NO SHALL quedarse en blanco: SHALL mostrar **"Estamos analizando tu encaje…"**.
- Agotada la ventana sin resultado, SHALL mostrar **"Sigue en proceso. Vuelve en un momento."** con el botón **"Actualizar"**, que pregunta otra vez y reanuda otra ventana de espera.
- El sondeo SHALL detenerse en cuanto el análisis termina o el diálogo se cierra.
- Un paso que el análisis se salta NO SHALL quedar en pantalla como pendiente para siempre.
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

#### Scenario: La espera dura lo que dura el plazo de la API

- **GIVEN** un despliegue con un proveedor local lento cuyo plazo de análisis es mucho mayor que un minuto y medio
- **WHEN** Ana espera dentro de ese plazo
- **THEN** el diálogo NO SHALL mostrar el aviso de paciencia agotada solo porque pasó un minuto y medio del reloj del SPA

#### Scenario: Se acabó la paciencia

- **GIVEN** un análisis que sigue en `running` después del plazo que publicó la API
- **WHEN** Ana mira el diálogo
- **THEN** SHALL ver "Sigue en proceso. Vuelve en un momento." y el botón "Actualizar"

#### Scenario: Actualizar reanuda la espera

- **GIVEN** el aviso de paciencia agotada
- **WHEN** Ana pulsa "Actualizar" y el análisis sigue en curso
- **THEN** el diálogo SHALL volver a preguntar y SHALL abrir otra ventana de espera

#### Scenario: Salir corta el sondeo

- **GIVEN** un sondeo en marcha
- **WHEN** Ana cierra el diálogo
- **THEN** NO SHALL seguir habiendo consultas de estado de ese análisis

#### Scenario: El canal adelanta, el sondeo basta

- **GIVEN** Ana con el diálogo abierto y el canal caído
- **WHEN** el análisis avanza de paso
- **THEN** el siguiente sondeo SHALL mostrar el paso
- **AND** el diálogo NO SHALL quedar bloqueado por la falta del aviso

#### Scenario: El comportamiento no cambia según haya o no ningún canal de eventos abierto

- **GIVEN** dos clientes, uno con canal y otro sin él
- **WHEN** el mismo análisis avanza
- **THEN** ambos SHALL acabar mostrando los mismos pasos
- **AND** ninguno SHALL depender del canal para terminar

### Requirement: Qué no hace aún esta pantalla

El diálogo SHALL limitarse a **leer** el informe, a dejar **copiar** el texto de una sugerencia y a marcar **«no me convence»**. NO SHALL ofrecer aplicar una sugerencia al archivo del CV, aceptarla ni rechazarla como diff, NO SHALL ofrecer descargar el informe ni compartirlo, y NO SHALL nombrar ninguna pantalla ni control que no exista. NO SHALL mostrar `judgeScore` ni `judgeModel` al usuario.

#### Scenario: Sin acciones que no existen

- **GIVEN** un informe con sugerencias en pantalla
- **WHEN** Ana revisa las acciones del diálogo y de cada sugerencia
- **THEN** NO SHALL encontrar aplicar, aceptar, rechazar, puntuar, descargar ni compartir
- **AND** SHALL encontrar "Copiar" y «no me convence» en cada sugerencia

## ADDED Requirements

### Requirement: El paso también llega solo

Mientras el diálogo de un análisis propio está abierto, la pantalla SHALL poder actualizar el paso al recibir `analysis.step` de ese análisis. Un aviso de otro análisis o de otra persona NO SHALL cambiar el diálogo. Si el aviso no llega, el sondeo SHALL seguir mostrando el paso.

#### Scenario: Llega el paso de su análisis

- **GIVEN** Ana con el diálogo abierto sobre su análisis
- **WHEN** recibe `analysis.step` de ese análisis
- **THEN** el diálogo SHALL mostrar ese paso sin esperar al siguiente sondeo

#### Scenario: El aviso de otro no entra

- **GIVEN** el diálogo de Ana abierto
- **WHEN** llega un `analysis.step` de otro análisis
- **THEN** el paso mostrado NO SHALL cambiar por ese aviso
