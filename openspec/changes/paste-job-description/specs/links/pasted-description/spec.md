## Purpose

Deja completar una oferta que no se pudo leer —o corregir una que se leyó mal— pegando su texto, que es lo que la persona
ya tiene delante, sin guardar nunca ese texto y tratándolo como el dato personal que puede ser.

## ADDED Requirements

### Requirement: Completar pegando la descripción

`POST /api/links/:id/pasted` SHALL aceptar, de quien puede ver el link, el texto de una oferta y, opcionalmente, su
título y su empresa escritos aparte. SHALL leer el texto con la extracción estructurada de IA dentro de la misma
petición y responder `200` con el link actualizado. Los campos obtenidos del texto SHALL entrar en el preview con origen
`pasted`, quién lo pegó y cuándo. El título y la empresa escritos aparte SHALL pasarse a la extracción como contexto,
para que no tenga que adivinarlos, y SHALL entrar con origen `manual` **solo si difieren de lo que el link ya tenía**:
un valor igual al actual se ignora, de modo que lo que venía precargado y nadie tocó no cambia de autor ni queda
fijado. Solo SHALL escribirse campos con valor: lo que la extracción no obtenga NO SHALL borrar lo que ya hubiera. `previewVersion` SHALL
subir. Quien no puede ver el link SHALL recibir `404` con código `link_not_found`.

#### Scenario: Oferta de LinkedIn completada pegando su texto

- **GIVEN** un link de LinkedIn en `failed` porque la bolsa no permite la lectura automática
- **WHEN** un miembro pega el texto de la oferta
- **THEN** la respuesta SHALL ser `200` con los campos leídos en el preview
- **AND** esos campos SHALL tener origen `pasted` y el nombre de quien pegó

#### Scenario: Cuerpo sin cabecera, con título y empresa escritos aparte

- **GIVEN** un texto copiado de la app que trae la descripción pero no el título ni la empresa
- **WHEN** un miembro lo pega junto con el título y la empresa que ve en la cabecera
- **THEN** el título y la empresa SHALL quedar con origen `manual`
- **AND** el resto de campos, con origen `pasted`
- **AND** el link SHALL quedar con título y empresa

#### Scenario: Título precargado sin tocar no se vuelve manual

- **GIVEN** un link cuyo título se leyó de la página
- **WHEN** alguien pega la descripción dejando el título precargado tal como estaba
- **THEN** el título NO SHALL pasar a origen `manual` ni a nombre de quien pega
- **AND** el link NO SHALL quedar en estado `manual` por ello

#### Scenario: Pegar no deja huecos

- **GIVEN** un link cuya empresa se leyó de la página
- **WHEN** alguien pega un texto del que no se obtiene la empresa
- **THEN** la empresa SHALL seguir siendo la leída de la página

#### Scenario: Link que no se puede ver

- **WHEN** alguien que no comparte grupo ni lista con ese link pega un texto
- **THEN** la respuesta SHALL ser `404` con código `link_not_found`

### Requirement: Estado tras pegar

Tras pegar, el estado SHALL derivarse de los campos: `manual` si hay algún campo escrito a mano, `enriched` si están
título y empresa, y `partial` si no. Un motivo de fallo que no se puede reintentar —la bolsa prohíbe la lectura o nos
bloquea— SHALL conservarse, de modo que pegar no ofrezca un reintento inútil.

#### Scenario: Estado tras completar con título y empresa

- **WHEN** lo pegado da título y empresa y nadie escribió nada a mano
- **THEN** el link SHALL quedar `enriched`

#### Scenario: El motivo de la bolsa se conserva

- **GIVEN** un link en `failed` porque la bolsa prohíbe la lectura automática
- **WHEN** alguien lo completa pegando su texto
- **THEN** el link SHALL conservar el motivo de lectura prohibida
- **AND** NO SHALL ofrecerse reintentar su lectura

### Requirement: Lo pegado tiene que parecer una oferta

Un texto vacío o de solo espacios SHALL responder `400`, y uno de más de 20 000 caracteres `400` con código
`text_too_long`. Si el texto queda vacío tras quitarle los datos de contacto, o la extracción responde que no es una
vacante, la respuesta SHALL ser `422` con código `not_a_job_posting`. Si la IA no responde a tiempo o degrada, la
respuesta SHALL ser `503` con código `extraction_unavailable` y cabecera `Retry-After`; si se agotó la cuota diaria de
IA de quien pega, `429` con código `ai_quota_exceeded` y `Retry-After`. En todos esos casos el link NO SHALL cambiar.

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

- **GIVEN** una cadena de proveedores que degrada
- **WHEN** alguien pega una oferta
- **THEN** la respuesta SHALL ser `503` con código `extraction_unavailable` y `Retry-After`
- **AND** el link NO SHALL cambiar

#### Scenario: Cuota de IA agotada

- **GIVEN** un usuario que agotó su cuota diaria de lectura de textos pegados
- **WHEN** pega otra oferta
- **THEN** la respuesta SHALL ser `429` con código `ai_quota_exceeded` y `Retry-After`

### Requirement: Deshacer un pegado

Cuando un pegado sustituya un campo, SHALL guardarse la entrada sustituida —su valor, su origen y su autor—, y quien
puede ver el link SHALL poder devolver el campo a ella, campo por campo o todos los de un mismo pegado de una vez. Pegar
NO SHALL tocar un campo escrito a mano, ni lo que ese campo guardaba para deshacerse. Deshacer SHALL llegar un nivel
atrás: si sobre un pegado se pegan otros dos, el primero ya no se recupera.

#### Scenario: La oferta equivocada, deshecha

- **GIVEN** un link cuyos campos pegó Beto
- **WHEN** Ana pega encima el texto de otra oferta y después se pide volver a lo anterior
- **THEN** los campos SHALL recuperar lo que pegó Beto, con su origen y su autor

#### Scenario: Deshacer todo un pegado

- **GIVEN** un link en el que Ana pegó una oferta que tocó varios campos
- **WHEN** se pide deshacer lo que pegó Ana
- **THEN** todos esos campos SHALL volver a lo que tenían antes, en una sola operación

#### Scenario: Volver a lo leído de la página

- **GIVEN** un campo leído de la página y sustituido por un pegado
- **WHEN** se pide volver a lo anterior
- **THEN** el campo SHALL recuperar el valor de la página y su extractor

### Requirement: El texto pegado es un dato personal

El texto recibido NO SHALL persistirse en ninguna colección, cola, caché ni registro, ni aparecer en los logs, en el
ledger de IA ni en los avisos del canal de eventos. Antes de la IA SHALL quitársele cualquier email y teléfono. SHALL
tratarse como dato personal de quien lo pega: NO SHALL enviarse a un proveedor de IA externo sin su consentimiento, y si
se envía, SHALL pasar por la redacción de datos personales. Los campos que se derivan de él sí se guardan, y NO SHALL
reproducir nombres de personas.

#### Scenario: Texto con datos de contacto

- **WHEN** se pega una oferta que incluye el email, el teléfono y el nombre del reclutador, y una marca única sembrada
- **THEN** ni la base de datos, ni la cola, ni los logs, ni el ledger SHALL contener el texto, la marca, el email ni el
  teléfono
- **AND** la entrada que recibe la IA NO SHALL contener el email ni el teléfono
- **AND** el resumen guardado NO SHALL contener el nombre del reclutador

#### Scenario: Con consentimiento, el proveedor externo es elegible

- **GIVEN** un usuario que aceptó enviar sus datos a proveedores externos
- **AND** una cadena con un proveedor externo antes que uno local
- **WHEN** pega una oferta
- **THEN** la lectura SHALL poder ir al proveedor externo, con los datos personales redactados

#### Scenario: Sin consentimiento, sin proveedor externo

- **GIVEN** un usuario que no aceptó enviar sus datos a proveedores externos
- **AND** una cadena con un proveedor externo antes que uno local
- **WHEN** pega una oferta
- **THEN** la lectura NO SHALL enviarse al proveedor externo

### Requirement: Límite de pegados

Pegar descripciones SHALL estar acotado por usuario en una ventana de tiempo, respondiendo `429` con código
`too_many_attempts` y `Retry-After` al superarse. El límite SHALL fallar cerrado: si el contador no responde, la
petición SHALL rechazarse con `503` `extraction_unavailable` —no con un aviso de "demasiados pegados" a quien no pegó
ninguno— y NO SHALL ejecutarse la IA. Un pegado que termina en `503` SHALL devolver su intento.

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
