## MODIFIED Requirements

### Requirement: Pegar la descripción de una oferta

Cada link SHALL ofrecer «Pegar la descripción» a quien puede verlo, en un diálogo que funcione igual desde cualquier
pantalla que muestre el link. El diálogo SHALL explicar «Pega el texto de la oferta tal como la ves: lo leemos para
completar la tarjeta y no lo guardamos». SHALL ofrecer además los campos de título y empresa, precargados con lo que ya
tenga la tarjeta, porque lo que se copia desde la app del móvil casi nunca trae la cabecera, y SHALL enviar solo los
que la persona haya cambiado. Mientras la API responde, SHALL mostrar «Leyendo… puede tardar unos segundos» sin
permitir enviarlo dos veces. Al terminar, la tarjeta SHALL actualizarse sin recargar y ofrecer «Deshacer lo que pegó
<nombre>», que devuelve de una vez todos los campos de ese pegado; si la API devuelve vacío el autor del pegado, SHALL
decir «Deshacer lo que pegó otra persona».

Cada error SHALL decir lo que pasa, con estos textos:

| Respuesta | Texto |
| --- | --- |
| `422` | «Eso no parece una oferta de trabajo. Copia la descripción de la oferta, no la conversación» |
| `503` `extraction_unavailable` | «No pudimos leerla ahora, inténtalo en un rato» |
| `503` `ai_capacity_exhausted` con `Retry-After` | «Se agotaron las lecturas gratuitas de la IA. Vuelven {cuándo}» |
| `503` `ai_capacity_exhausted` sin `Retry-After` | «Se agotaron por ahora las lecturas gratuitas de la IA y no sabemos cuándo vuelven» |
| `503` `extraction_disabled` | «La lectura automática no está disponible» |
| `409` `ai_consent_required` | «Para leerla con la IA hace falta tu permiso para enviar datos a proveedores externos», con la acción «Dar permiso en Perfil», que lleva a `/perfil` |
| `429` por límite de pegados | «Pegaste demasiadas ofertas seguidas, espera un poco» |
| `429` `ai_quota_exceeded` | «Llegaste a tu límite de lecturas con IA. Podrás volver a pegar {cuándo}» |

{cuándo} SHALL calcularse con el `Retry-After` y decirse en la hora local: «hoy a las HH:mm» si cae hoy, «mañana a las
HH:mm» si cae mañana y una fecha corta en otro caso. Ningún texto SHALL invitar a reintentar «en un rato» cuando la
respuesta no es `extraction_unavailable`. En todos los errores SHALL conservarse lo pegado.

#### Scenario: Completar una oferta de LinkedIn

- **GIVEN** un miembro viendo un link de LinkedIn con «LinkedIn no nos deja leer sus ofertas. Pega su descripción para
  completarla»
- **WHEN** pulsa «Pegar la descripción», pega el texto, escribe el título y la empresa que ve en la app, y confirma
- **THEN** la tarjeta SHALL mostrar el título y la empresa sin recargar
- **AND** los demás campos SHALL decir que salieron de la descripción que pegó ese miembro

#### Scenario: Se pegó otra cosa

- **WHEN** la API responde `422` con `not_a_job_posting`
- **THEN** SHALL mostrarse «Eso no parece una oferta de trabajo. Copia la descripción de la oferta, no la conversación»
- **AND** SHALL conservarse lo pegado

#### Scenario: Leyendo lo pegado

- **GIVEN** un miembro que acaba de confirmar lo pegado
- **WHEN** la API todavía no ha respondido
- **THEN** el diálogo SHALL mostrar «Leyendo… puede tardar unos segundos»
- **AND** NO SHALL permitir enviarlo dos veces

#### Scenario: Límite de lecturas del día

- **GIVEN** son las 10:00 en la hora local
- **WHEN** la API responde `429` con `ai_quota_exceeded` y `Retry-After: 10800`
- **THEN** SHALL mostrarse «Llegaste a tu límite de lecturas con IA. Podrás volver a pegar hoy a las 13:00»
- **AND** SHALL conservarse lo pegado

#### Scenario: Cupo gratuito agotado hasta mañana

- **GIVEN** son las 20:00 en la hora local
- **WHEN** la API responde `503` con `ai_capacity_exhausted` y `Retry-After: 46800`
- **THEN** SHALL mostrarse «Se agotaron las lecturas gratuitas de la IA. Vuelven mañana a las 09:00»
- **AND** NO SHALL mostrarse «inténtalo en un rato»
- **AND** SHALL conservarse lo pegado

#### Scenario: Cupo agotado sin hora

- **WHEN** la API responde `503` con `ai_capacity_exhausted` sin `Retry-After`
- **THEN** SHALL mostrarse «Se agotaron por ahora las lecturas gratuitas de la IA y no sabemos cuándo vuelven»

#### Scenario: Lectura automática no disponible

- **WHEN** la API responde `503` con `extraction_disabled`
- **THEN** SHALL mostrarse «La lectura automática no está disponible»
- **AND** NO SHALL mostrarse «inténtalo en un rato»

#### Scenario: Falta el permiso

- **WHEN** la API responde `409` con `ai_consent_required`
- **THEN** SHALL mostrarse el texto del permiso con la acción «Dar permiso en Perfil»
- **AND** al pulsarla SHALL cerrarse el diálogo y abrirse `/perfil`

#### Scenario: Deshacer un pegado de alguien fuera de tus grupos

- **GIVEN** Carla con un link cuyo último pegado es de Ana, con quien no comparte ningún grupo
- **WHEN** mira la tarjeta
- **THEN** SHALL ver «Deshacer lo que pegó otra persona»
- **AND** al pulsarlo SHALL devolverse de una vez todos los campos de ese pegado

## ADDED Requirements

### Requirement: Completar a mano desde el pegado

Tras cualquier error del envío en el diálogo de pegar, ya sea propio del pegado o común (sin conexión, error
genérico), el diálogo SHALL ofrecer «Completar a mano» sin que la persona tenga que cerrarlo. Al pulsarlo, el diálogo
de pegar SHALL cerrarse y abrir la corrección a mano del mismo link, desde cualquier pantalla. En esa corrección:

- el título y la empresa que la persona **cambió** en el diálogo de pegar SHALL aparecer como valores ya modificados
  del formulario, y se enviarán como edición manual si se guarda;
- el texto pegado SHALL mostrarse como referencia de solo lectura, en un panel plegable titulado «Lo que pegaste (solo
  para consultar: no se guarda ni se envía)».

El texto pegado NO SHALL entrar en el store, en la petición de edición, en el almacenamiento del navegador ni en los
logs. SHALL desaparecer al cerrar la corrección.

#### Scenario: Del cupo agotado a completar a mano

- **GIVEN** un miembro que pegó una oferta, escribió la empresa «Acme» y recibió `503` `ai_capacity_exhausted`
- **WHEN** pulsa «Completar a mano»
- **THEN** SHALL abrirse la corrección a mano del mismo link, con la empresa «Acme» como valor modificado
- **AND** el panel «Lo que pegaste» SHALL contener el texto pegado, sin poder editarse

#### Scenario: Lo pegado no viaja al guardar a mano

- **GIVEN** la corrección a mano abierta desde el pegado, con el texto pegado en el panel de referencia
- **WHEN** la persona escribe el puesto y guarda
- **THEN** la petición de edición SHALL contener el puesto y la empresa
- **AND** NO SHALL contener el texto pegado

#### Scenario: Completar a mano tras un texto que no parecía una oferta

- **WHEN** la API responde `422` con `not_a_job_posting`
- **THEN** el diálogo SHALL ofrecer «Completar a mano»

#### Scenario: Completar a mano sin conexión

- **WHEN** el envío falla sin conexión
- **THEN** el diálogo SHALL ofrecer «Completar a mano»
- **AND** SHALL conservarse lo pegado
