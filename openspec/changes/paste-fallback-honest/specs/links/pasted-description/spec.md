## MODIFIED Requirements

### Requirement: Lo pegado tiene que parecer una oferta

Un texto vacío o de solo espacios SHALL responder `400`, y uno de más de 20 000 caracteres, `400` con código
`text_too_long`. Si el texto queda vacío tras quitarle los datos de contacto, o la extracción responde que no es una
vacante, la respuesta SHALL ser `422` con código `not_a_job_posting`.

Cuando la IA no lee el texto, la respuesta SHALL decir por qué, sin mezclar casos:

- **Cuota diaria de IA de quien pega agotada:** `429` con código `ai_quota_exceeded` y `Retry-After` hasta el instante
  de vuelta que da la IA. Solo si ese instante falta, 24 horas.
- **Falta el permiso de quien pega para proveedores externos, y ese permiso es lo primero que falta** (motivo de falta de
  consentimiento, o condición del proveedor `consent_required`): `409` con código `ai_consent_required`, sin
  `Retry-After`.
- **El proveedor agotó su cupo** (condición del proveedor `rate_limited`): `503` con código `ai_capacity_exhausted`,
  sin `Retry-After`, porque no se sabe cuándo vuelve.
- **La lectura automática no está disponible por configuración o por política de datos** (condición `rejected`, o
  `no_providers` sin condición porque ninguna IA configurada es capaz de esta tarea): `503` con código
  `extraction_disabled`, sin `Retry-After`.
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

#### Scenario: Falta el permiso para proveedores externos

- **GIVEN** una cadena con un solo proveedor externo y un usuario que no dio el permiso para enviarle datos
- **WHEN** pega una oferta
- **THEN** la respuesta SHALL ser `409` con código `ai_consent_required`
- **AND** el proveedor externo NO SHALL recibir el texto

#### Scenario: Falta el permiso y el proveedor tiene el circuito abierto

- **GIVEN** un usuario sin el permiso y el único proveedor externo con el circuito abierto
- **WHEN** pega una oferta
- **THEN** la respuesta SHALL ser `409` con código `ai_consent_required`

#### Scenario: Un degradado sin caso propio

- **GIVEN** un degradado `providers_failed` sin condición del proveedor
- **WHEN** alguien pega una oferta
- **THEN** la respuesta SHALL ser `503` con código `extraction_unavailable` y `Retry-After: 60`

### Requirement: Límite de pegados

Pegar descripciones SHALL estar acotado por usuario en una ventana de tiempo. Al superarse, SHALL responder `429` con
código `too_many_attempts` y `Retry-After`. El límite SHALL fallar cerrado: si el contador no responde, la petición
SHALL rechazarse con `503` `extraction_unavailable`, no con un aviso de «demasiados pegados» a quien no pegó ninguno, y
NO SHALL ejecutarse la IA. Un pegado que termina sin que la IA lea el texto —con cualquier `503`, con `409`
`ai_consent_required` o con `429` `ai_quota_exceeded`— SHALL devolver su intento, porque el intento se consume antes de
llamar a la IA.

#### Scenario: Ventana agotada

- **GIVEN** un usuario que ya agotó sus pegados de la ventana
- **WHEN** pega otra oferta
- **THEN** la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After`

#### Scenario: El contador no responde

- **GIVEN** el almacén de contadores caído
- **WHEN** un usuario pega una oferta
- **THEN** la respuesta SHALL ser `503` con código `extraction_unavailable`
- **AND** NO SHALL ejecutarse la IA

#### Scenario: Un fallo de la IA no gasta un pegado

- **GIVEN** un usuario con un pegado restante en la ventana
- **WHEN** pega una oferta y la IA no responde
- **THEN** SHALL poder volver a pegar dentro de la misma ventana

#### Scenario: Ni el cupo, ni la cuota, ni la falta de permiso gastan un pegado

- **GIVEN** un usuario con un pegado restante en la ventana
- **WHEN** pega una oferta y la respuesta es `503` `ai_capacity_exhausted`, `503` `extraction_disabled`, `409`
  `ai_consent_required` o `429` `ai_quota_exceeded`
- **THEN** SHALL poder volver a pegar dentro de la misma ventana
