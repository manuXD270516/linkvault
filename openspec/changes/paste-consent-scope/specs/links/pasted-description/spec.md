## RENAMED Requirements

- FROM: `### Requirement: El texto pegado es un dato personal`
- TO: `### Requirement: El texto pegado puede traer datos personales`

## MODIFIED Requirements

### Requirement: El texto pegado puede traer datos personales

El texto recibido NO SHALL persistirse en ninguna colección, cola, caché ni registro, ni aparecer en los logs, en el
ledger de IA ni en los avisos del canal de eventos. Antes de la IA SHALL quitársele cualquier email y teléfono. SHALL
tratarse como contenido que puede traer datos personales de otras personas, y no como un dato de quien lo pega: la
lectura SHALL hacerse con una tarea de sensibilidad `incidental` (`ai/data-protection`). En consecuencia, NO SHALL
exigir el permiso de IA externa de quien pega, que habla solo de su CV; SHALL enviarse a un proveedor externo **solo**
si ese proveedor pide no recolectar los datos, tenga o no quien pega ese permiso; y, si se envía, SHALL pasar por la
redacción de datos personales. Los campos que se derivan de él sí se guardan, y NO SHALL reproducir nombres de
personas.

#### Scenario: Texto con datos de contacto

- **WHEN** se pega una oferta que incluye el email, el teléfono y el nombre del reclutador, y una marca única sembrada
- **THEN** ni la base de datos, ni la cola, ni los logs, ni el ledger SHALL contener el texto, la marca, el email ni el
  teléfono
- **AND** la entrada que recibe la IA NO SHALL contener el email ni el teléfono
- **AND** el resumen guardado NO SHALL contener el nombre del reclutador

#### Scenario: Con consentimiento, el proveedor externo es elegible

- **GIVEN** un usuario que aceptó enviar sus datos a proveedores externos
- **AND** una cadena con un proveedor externo que pide no recolectar los datos antes que uno local
- **WHEN** pega una oferta
- **THEN** la lectura SHALL poder ir al proveedor externo, con los datos personales redactados

#### Scenario: Sin consentimiento, sin proveedor externo

- **GIVEN** un usuario que no aceptó enviar sus datos a proveedores externos
- **AND** una cadena con un proveedor externo que no pide no recolectar los datos antes que uno local
- **WHEN** pega una oferta
- **THEN** la lectura NO SHALL enviarse al proveedor externo
- **AND** la falta de permiso NO SHALL ser el motivo: con el permiso dado tampoco se enviaría

#### Scenario: Sin consentimiento, el externo que pide no recolectar lee lo pegado

- **GIVEN** un usuario que no aceptó enviar sus datos a proveedores externos
- **AND** una cadena con un proveedor externo que pide no recolectar los datos antes que uno local
- **WHEN** pega una oferta
- **THEN** la lectura SHALL poder ir al proveedor externo, con los datos personales redactados

#### Scenario: Ni con consentimiento va a un externo que no pide no recolectar

- **GIVEN** un usuario que aceptó enviar sus datos a proveedores externos
- **AND** una cadena con un proveedor externo que no pide no recolectar los datos antes que uno local
- **WHEN** pega una oferta
- **THEN** la lectura NO SHALL enviarse a ese proveedor externo

#### Scenario: Solo hay externos que no piden no recolectar

- **GIVEN** una cadena cuyo único proveedor es externo y no pide no recolectar los datos
- **WHEN** un usuario, con o sin el permiso de IA externa, pega una oferta
- **THEN** ninguna petición SHALL salir hacia ese proveedor
- **AND** la respuesta SHALL ser `503` con código `extraction_disabled`

#### Scenario: Sin consentimiento nunca se pide el permiso

- **GIVEN** un usuario que no aceptó enviar sus datos a proveedores externos
- **WHEN** pega una oferta con cualquier cadena configurada
- **THEN** la respuesta NO SHALL ser `409` con código `ai_consent_required`

### Requirement: Lo pegado tiene que parecer una oferta

Un texto vacío o de solo espacios SHALL responder `400`, y uno de más de 20 000 caracteres, `400` con código
`text_too_long`. Si el texto queda vacío tras quitarle los datos de contacto, o la extracción responde que no es una
vacante, la respuesta SHALL ser `422` con código `not_a_job_posting`.

Cuando la IA no lee el texto, la respuesta SHALL decir por qué, sin mezclar casos:

- **Cuota diaria de IA de quien pega agotada:** `429` con código `ai_quota_exceeded` y `Retry-After` hasta el instante
  de vuelta que da la IA. Solo si ese instante falta, 24 horas.
- **Falta el permiso de quien pega para proveedores externos, y ese permiso es lo primero que falta** (motivo de falta de
  consentimiento, o condición del proveedor `consent_missing`): `409` con código `ai_consent_required`, sin
  `Retry-After`. Este caso queda como **defensa**: la lectura de lo pegado no exige ese permiso («El texto pegado puede
  traer datos personales»), así que hoy no se produce, y SHALL responderse así si alguna vez la lectura volviera a
  exigirlo.
- **El proveedor agotó su cupo** (condición del proveedor `rate_limited`): `503` con código `ai_capacity_exhausted`,
  sin `Retry-After`, porque no se sabe cuándo vuelve.
- **La lectura automática no está disponible por configuración o por política de datos** (condición `rejected`, o
  `no_providers` sin condición porque ninguna IA configurada es capaz de esta tarea, o porque ningún proveedor externo
  configurado pide no recolectar los datos): `503` con código `extraction_disabled`, sin `Retry-After`.
- **Cualquier otro fallo de la IA** (condición `unavailable`, plazo agotado, consentimiento ilegible, o cualquier
  degradado que no encaje en los casos anteriores): `503` con código `extraction_unavailable` y `Retry-After: 60`.

En todos esos casos el link NO SHALL cambiar, y ninguna respuesta SHALL contener el texto pegado.

#### Scenario: Se pegó otra cosa

- **WHEN** alguien pega la conversación del chat en vez de la oferta
- **THEN** la respuesta SHALL ser `422` con código `not_a_job_posting`
- **AND** el preview NO SHALL cambiar

#### Scenario: Texto vacío

- **WHEN** se pega un texto vacío o de solo espacios
- **THEN** la respuesta SHALL ser `400`

#### Scenario: Solo había un teléfono

- **WHEN** se pega un texto que, sin sus datos de contacto, queda vacío
- **THEN** la respuesta SHALL ser `422` con código `not_a_job_posting`
- **AND** NO SHALL ejecutarse la IA

#### Scenario: La IA no está disponible

- **GIVEN** una cadena de proveedores que degrada porque el proveedor no responde
- **WHEN** alguien pega una oferta
- **THEN** la respuesta SHALL ser `503` con código `extraction_unavailable` y `Retry-After: 60`
- **AND** el link NO SHALL cambiar

#### Scenario: Cuota de IA agotada

- **GIVEN** un usuario que agotó su cuota diaria de lectura de textos pegados, y cuya ejecución más antigua sale de la
  ventana dentro de 3 horas
- **WHEN** pega otra oferta
- **THEN** la respuesta SHALL ser `429` con código `ai_quota_exceeded` y un `Retry-After` de 3 horas, no de 24

#### Scenario: Cupo del proveedor agotado

- **GIVEN** el único proveedor respondiendo `429`
- **WHEN** alguien pega una oferta
- **THEN** la respuesta SHALL ser `503` con código `ai_capacity_exhausted` y sin `Retry-After`
- **AND** el link NO SHALL cambiar

#### Scenario: Ningún proveedor acepta la política de datos

- **GIVEN** el único proveedor respondiendo `404` porque ninguno de sus proveedores acepta `data_collection: deny`
- **WHEN** alguien pega una oferta
- **THEN** la respuesta SHALL ser `503` con código `extraction_disabled` y sin `Retry-After`

#### Scenario: Ninguna IA capaz

- **GIVEN** `AI_CHAIN=none`
- **WHEN** alguien pega una oferta
- **THEN** la respuesta SHALL ser `503` con código `extraction_disabled` y sin `Retry-After`

#### Scenario: Sin permiso y con un externo que no pide no recolectar

- **GIVEN** una cadena con un solo proveedor, externo, que no pide no recolectar los datos, y un usuario que no dio el
  permiso para enviar datos a proveedores externos
- **WHEN** pega una oferta
- **THEN** la respuesta SHALL ser `503` con código `extraction_disabled` y sin `Retry-After`
- **AND** el proveedor externo NO SHALL recibir el texto
- **AND** la respuesta NO SHALL ser `409` con código `ai_consent_required`

#### Scenario: Sin permiso y con el circuito abierto

- **GIVEN** un usuario sin el permiso y el único proveedor, externo y que pide no recolectar los datos, con el circuito
  abierto
- **WHEN** pega una oferta
- **THEN** la respuesta SHALL ser `503`, con el código de la condición que recuerda el circuito: `ai_capacity_exhausted`
  si es `rate_limited`, `extraction_disabled` si es `rejected` y `extraction_unavailable` con `Retry-After: 60` si es
  `unavailable`, o si el circuito no recuerda ninguna (cuenta como `unavailable`)
- **AND** la respuesta NO SHALL ser `409` con código `ai_consent_required`

#### Scenario: Un degradado sin caso propio

- **GIVEN** un degradado `providers_failed` sin condición del proveedor
- **WHEN** alguien pega una oferta
- **THEN** la respuesta SHALL ser `503` con código `extraction_unavailable` y `Retry-After: 60`
