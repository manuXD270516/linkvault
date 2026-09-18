## MODIFIED Requirements

### Requirement: Editar la oferta a mano

Cada link SHALL ofrecer editar los campos de su preview a quien puede verlo, con un formulario que muestra el valor
actual de cada campo y de dónde salió, distinguiendo lo leído de la página ("Leído de la página"), lo deducido por la
IA ("Deducido por la IA"), lo sacado de un texto pegado ("Pegado por <nombre>") y lo escrito por una persona ("Escrito
por <nombre>"). Un campo editado a mano SHALL poder devolverse a su valor anterior, sea el leído de la página o el
pegado ("Volver a lo extraído" o "Volver a lo pegado"). Al guardar, la tarjeta SHALL mostrar los valores nuevos y decir
quién los escribió, porque el link es compartido y lo que una persona corrige lo ven las demás. Un error de la API SHALL
mostrarse sin perder lo escrito.

#### Scenario: Corregir el título

- **GIVEN** un miembro viendo un link con el título mal extraído
- **WHEN** lo corrige y guarda
- **THEN** la tarjeta SHALL mostrar el título nuevo marcado como escrito a mano

#### Scenario: Origen de cada campo

- **GIVEN** un link con el título escrito a mano, la empresa leída de la página y el salario deducido por la IA
- **WHEN** un miembro abre el formulario
- **THEN** SHALL ver "Escrito por" en el título, "Leído de la página" en la empresa y "Deducido por la IA" en el salario

#### Scenario: Quién lo escribió, en la tarjeta

- **GIVEN** un link cuyo título corrigió Ana
- **WHEN** otro miembro mira la tarjeta
- **THEN** SHALL ver que ese dato lo escribió Ana

#### Scenario: Volver a lo extraído

- **GIVEN** un campo corregido a mano
- **WHEN** un miembro pide volver a lo extraído
- **THEN** la tarjeta SHALL mostrar de nuevo el valor que traía la página

#### Scenario: Error al guardar

- **WHEN** la API responde con error al guardar la edición
- **THEN** SHALL mostrarse el mensaje y conservarse lo escrito

#### Scenario: Lo pegado se distingue

- **GIVEN** un link cuya empresa salió de un texto que pegó Beto
- **WHEN** un miembro abre el formulario
- **THEN** SHALL ver "Pegado por Beto" en la empresa

#### Scenario: Volver a lo pegado

- **GIVEN** un campo pegado que después se corrigió a mano
- **WHEN** un miembro pide volver a lo pegado
- **THEN** la tarjeta SHALL mostrar de nuevo el valor pegado

## ADDED Requirements

### Requirement: Pegar la descripción de una oferta

Cada link SHALL ofrecer "Pegar la descripción" a quien puede verlo, y SHALL destacarlo en las tarjetas que no se
pudieron leer porque la bolsa no lo permite o nos bloquea. El diálogo SHALL explicar "Pega el texto de la oferta tal
como la ves: lo leemos para completar la tarjeta y no lo guardamos", mostrar que se está leyendo mientras la API
responde, y actualizar la tarjeta al terminar sin recargar. Un `422` SHALL mostrar "Eso no parece una oferta de
trabajo", un `503` "No pudimos leerla ahora, inténtalo en un rato" y un `429` "Pegaste demasiadas ofertas seguidas,
espera un poco", conservando lo pegado en los tres casos.

#### Scenario: Completar una oferta de LinkedIn

- **GIVEN** un miembro viendo un link de LinkedIn con "Esta bolsa no permite la lectura automática de sus ofertas"
- **WHEN** pulsa "Pegar la descripción", pega el texto y confirma
- **THEN** la tarjeta SHALL mostrar el título y la empresa sin recargar
- **AND** esos campos SHALL decir que los pegó ese miembro

#### Scenario: Se pegó otra cosa

- **WHEN** la API responde `422` con `not_a_job_posting`
- **THEN** SHALL mostrarse "Eso no parece una oferta de trabajo"
- **AND** SHALL conservarse lo pegado

#### Scenario: Leyendo lo pegado

- **GIVEN** un miembro que acaba de confirmar lo pegado
- **WHEN** la API todavía no ha respondido
- **THEN** el diálogo SHALL mostrar que se está leyendo y NO SHALL permitir enviarlo dos veces
