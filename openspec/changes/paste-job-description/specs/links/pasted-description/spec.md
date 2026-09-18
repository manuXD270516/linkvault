## Purpose

Deja completar una oferta que no se pudo leer —o corregir una que se leyó mal— pegando su texto, que es lo que la persona
ya tiene delante, sin guardar nunca ese texto de un tercero.

## ADDED Requirements

### Requirement: Completar pegando la descripción

`POST /api/links/:id/pasted` SHALL aceptar el texto de una oferta de quien puede ver el link, leerlo con la extracción
estructurada de IA dentro de la misma petición y responder `200` con el link actualizado. Los campos obtenidos SHALL
entrar en el preview con origen `pasted`, quién lo pegó y cuándo, y `previewVersion` SHALL subir. Si lo leído completa
los campos obligatorios, el link SHALL quedar `enriched`; si no, `partial`. Quien no puede ver el link SHALL recibir
`404` con código `link_not_found`.

#### Scenario: Oferta de LinkedIn completada pegando su texto

- **GIVEN** un link de LinkedIn en `failed` porque la bolsa no permite la lectura automática
- **WHEN** un miembro pega el texto de la oferta
- **THEN** la respuesta SHALL ser `200` con el título y la empresa en el preview
- **AND** esos campos SHALL tener origen `pasted` y el nombre de quien pegó
- **AND** el link SHALL quedar `enriched`

#### Scenario: Texto que solo da el título

- **WHEN** lo pegado permite sacar el título pero no la empresa
- **THEN** el link SHALL quedar `partial` con el título

#### Scenario: Link que no se puede ver

- **WHEN** alguien que no comparte grupo ni lista con ese link pega un texto
- **THEN** la respuesta SHALL ser `404` con código `link_not_found`

### Requirement: Lo pegado tiene que parecer una oferta

Si la extracción responde que el texto no es una vacante, la respuesta SHALL ser `422` con código `not_a_job_posting` y
el link NO SHALL cambiar. Un texto vacío o más largo del máximo SHALL responder `400`. Si la IA no responde a tiempo o
degrada, la respuesta SHALL ser `503` con código `extraction_unavailable` y el link NO SHALL cambiar.

#### Scenario: Se pegó otra cosa

- **WHEN** alguien pega la conversación del chat en vez de la oferta
- **THEN** la respuesta SHALL ser `422` con código `not_a_job_posting`
- **AND** el preview NO SHALL cambiar

#### Scenario: Texto vacío

- **WHEN** se pega un texto vacío o de solo espacios
- **THEN** la respuesta SHALL ser `400`

#### Scenario: La IA no está disponible

- **GIVEN** una cadena de proveedores que degrada
- **WHEN** alguien pega una oferta
- **THEN** la respuesta SHALL ser `503` con código `extraction_unavailable`
- **AND** el link NO SHALL cambiar

### Requirement: El texto pegado no se guarda

El texto recibido NO SHALL persistirse en ninguna colección, cola, caché ni registro de fixtures, ni aparecer en los
logs, en el ledger de IA ni en los avisos del canal de eventos. Antes de enviarlo a la IA SHALL quitársele cualquier
email y teléfono, con la misma regla que se aplica al texto de las páginas.

#### Scenario: Texto con datos de contacto

- **WHEN** se pega una oferta que incluye el email y el teléfono del reclutador
- **THEN** ni la base de datos, ni la cola, ni los logs, ni el ledger SHALL contener el texto, el email ni el teléfono
- **AND** la entrada que recibe la IA NO SHALL contener el email ni el teléfono

### Requirement: Límite de pegados

Pegar descripciones SHALL estar acotado por usuario en una ventana de tiempo, respondiendo `429` con código
`too_many_attempts` y `Retry-After` al superarse. El límite SHALL fallar cerrado: si el contador no responde, la
petición SHALL rechazarse, porque cada pegado es una ejecución de IA a cuenta de quien lo pide.

#### Scenario: Ventana agotada

- **GIVEN** un usuario que ya agotó sus pegados de la ventana
- **WHEN** pega otra oferta
- **THEN** la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After`

#### Scenario: El contador no responde

- **GIVEN** el almacén de contadores caído
- **WHEN** un usuario pega una oferta
- **THEN** la respuesta SHALL ser `429`
- **AND** NO SHALL ejecutarse la IA
