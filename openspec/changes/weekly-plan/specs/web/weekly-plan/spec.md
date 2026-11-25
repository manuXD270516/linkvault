## Purpose

Tarjeta «Tu semana» del SPA: muestra arriba del tablero de postulaciones las acciones del plan semanal con su motivo,
deja marcarlas y ofrece un borrador de seguimiento copiable, sin actuar nunca hacia fuera.

## ADDED Requirements

### Requirement: Tarjeta «Tu semana» en el tablero

Cuando el tablero de `/postulaciones` tiene al menos una postulación, el SPA SHALL mostrar encima de las columnas, a todo
el ancho y también en pantallas móviles, la tarjeta «Tu semana» con las acciones de `GET /api/applications/weekly-plan`.
Cada acción SHALL mostrar el nombre de la oferta (título, o `displayUrl` sin título) como enlace, su motivo en una sola
línea y los botones «Hecho», «Ahora no» y «Ocultar sugerencia», cada uno con un área táctil de al menos 44 px de alto.
La tarjeta SHALL tener estado de carga, estado vacío y estado de error con «Reintentar»; un error del plan NO SHALL
impedir usar el tablero. El estado vacío SHALL mostrar «No hay nada urgente esta semana.», la línea fija «Aquí verás
cuando una oferta guardada esté por cerrar, una postulación lleve 10 días sin novedades o alguien de tu grupo conozca a
alguien.» (EN: «This is where you will see when a saved offer is about to close, an application has gone 10 days
without news, or someone in your group knows someone there.») y, si `doneThisWeek` > 0, «Hiciste N esta semana.». Con
el tablero vacío la tarjeta NO SHALL mostrarse. Todos los textos SHALL estar en el catálogo i18n en español e inglés.

#### Scenario: Tres acciones visibles

- **GIVEN** Ana con un plan de tres acciones
- **WHEN** abre `/postulaciones`
- **THEN** SHALL ver la tarjeta «Tu semana» encima de las columnas con tres acciones, cada una con su motivo y los
  botones «Hecho», «Ahora no» y «Ocultar sugerencia»

#### Scenario: Vacío honesto

- **GIVEN** Ana con postulaciones y un plan sin acciones
- **WHEN** abre `/postulaciones`
- **THEN** la tarjeta SHALL decir «No hay nada urgente esta semana.»
- **AND** SHALL decir «Aquí verás cuando una oferta guardada esté por cerrar, una postulación lleve 10 días sin
  novedades o alguien de tu grupo conozca a alguien.»

#### Scenario: Vacío en inglés

- **GIVEN** la interfaz en inglés y un plan sin acciones
- **WHEN** Ana abre `/postulaciones`
- **THEN** la tarjeta SHALL decir «This is where you will see when a saved offer is about to close, an application has
  gone 10 days without news, or someone in your group knows someone there.»

#### Scenario: Error del plan

- **GIVEN** `GET /api/applications/weekly-plan` responde `500`
- **WHEN** Ana abre `/postulaciones`
- **THEN** la tarjeta SHALL mostrar «No pudimos armar tu semana.» y «Reintentar»
- **AND** las columnas del tablero SHALL mostrarse y Ana SHALL poder mover una postulación de columna

#### Scenario: Móvil

- **GIVEN** un viewport de 390 px de ancho
- **WHEN** Ana abre `/postulaciones` con un plan de tres acciones
- **THEN** la tarjeta SHALL estar encima de las columnas y cada botón de acción SHALL medir al menos 44 px de alto

### Requirement: Motivos de las acciones

El motivo de cada acción SHALL armarse en el SPA desde `reason`, con un mensaje i18n por variante de singular y plural
elegido en código, con estos textos:

| `reason` | Español | English |
|---|---|---|
| `closing_soon`, `daysLeft` 0 | `Cierra hoy: postula hoy.` | `Closes today: apply today.` |
| `closing_soon`, `daysLeft` 1 | `Cierra en 1 día: postula antes.` | `Closes in 1 day: apply before then.` |
| `closing_soon`, `daysLeft` N > 1 | `Cierra en N días: postula antes.` | `Closes in N days: apply before then.` |
| `high_fit` | `Encaja N/100 según tu análisis: postula.` | `Fits N/100 according to your analysis: apply.` |
| `quiet` | `N días sin novedades: manda un seguimiento.` | `N days with no news: send a follow-up.` |
| `know_someone`, `count` 1 | `1 persona de tu grupo conoce a alguien ahí: pregunta en el grupo.` | `1 person in your group knows someone there: ask in the group.` |
| `know_someone`, `count` N > 1 | `N personas de tu grupo conocen a alguien ahí: pregunta en el grupo.` | `N people in your group know someone there: ask in the group.` |

#### Scenario: Motivos en español

- **GIVEN** acciones con motivos `closing_soon` (`daysLeft` 4), `quiet` (`daysQuiet` 12) y `know_someone` (`count` 2)
- **WHEN** Ana ve la tarjeta en español
- **THEN** SHALL leer «Cierra en 4 días: postula antes.», «12 días sin novedades: manda un seguimiento.» y «2 personas
  de tu grupo conocen a alguien ahí: pregunta en el grupo.»

#### Scenario: Cierra hoy

- **GIVEN** una acción `closing_soon` con `daysLeft` 0
- **WHEN** Ana ve la tarjeta en español
- **THEN** SHALL leer «Cierra hoy: postula hoy.»

#### Scenario: Singular

- **GIVEN** acciones `closing_soon` con `daysLeft` 1 y `know_someone` con `count` 1
- **WHEN** Ana ve la tarjeta en inglés
- **THEN** SHALL leer «Closes in 1 day: apply before then.» y «1 person in your group knows someone there: ask in the
  group.»

### Requirement: Acciones de la tarjeta

«Hecho», «Ahora no» y «Ocultar sugerencia» SHALL enviar `POST /api/applications/weekly-plan/decisions` con `done`,
`snoozed` y `dismissed` respectivamente, deshabilitar los botones de esa acción mientras la petición viaja y reemplazar
el plan por el de la respuesta. Si la respuesta es `404` con `weekly_plan_action_not_found`, el SPA SHALL recargar el
plan sin mostrar error; ante cualquier otro error SHALL mostrar «No pudimos guardar tu elección. Prueba de nuevo.» y
volver a habilitar los botones. El enlace del nombre de la oferta SHALL abrir el detalle de la postulación en el
tablero, salvo en `ask_know_someone`, donde SHALL navegar a `/grupos/:groupId`. Tras «Hecho» en una acción
`apply_before_close`, la tarjeta SHALL mostrar «¿Ya postulaste? Muévela a Postulada» con un enlace que abre el detalle de
esa postulación, sin cambiar su estado. Tras mover una postulación de columna con éxito, el SPA SHALL recargar el plan.
Ningún control de la tarjeta SHALL abrir la oferta externa, enviar mensajes ni cambiar el estado de una postulación.

#### Scenario: Marcar hecho

- **GIVEN** la tarjeta con tres acciones
- **WHEN** Ana pulsa «Hecho» en la primera
- **THEN** el SPA SHALL enviar la decisión `done` con su `candidateId`
- **AND** la tarjeta SHALL mostrar el plan de la respuesta, sin esa acción

#### Scenario: Ahora no y ocultar

- **GIVEN** la tarjeta con dos acciones
- **WHEN** Ana pulsa «Ahora no» en una y «Ocultar sugerencia» en la otra
- **THEN** el SPA SHALL enviar `snoozed` y `dismissed` respectivamente

#### Scenario: Sugerencia de mover tras postular

- **GIVEN** una acción `apply_before_close`
- **WHEN** Ana pulsa «Hecho»
- **THEN** la tarjeta SHALL mostrar «¿Ya postulaste? Muévela a Postulada»
- **AND** al pulsar su enlace SHALL abrirse el detalle de esa postulación sin ninguna petición de cambio de estado

#### Scenario: La acción ya no aplica

- **GIVEN** la decisión responde `404` con `weekly_plan_action_not_found`
- **WHEN** Ana pulsa «Hecho»
- **THEN** el SPA SHALL pedir de nuevo `GET /api/applications/weekly-plan` y no SHALL mostrar un error

#### Scenario: Fallo al guardar

- **GIVEN** la decisión responde `500`
- **WHEN** Ana pulsa «Ocultar sugerencia»
- **THEN** la tarjeta SHALL mostrar «No pudimos guardar tu elección. Prueba de nuevo.» y los botones SHALL volver a
  estar habilitados

#### Scenario: Mover en el tablero recarga el plan

- **GIVEN** una acción `apply_before_close` de una postulación `saved`
- **WHEN** Ana la mueve a la columna Postulada y el cambio responde con éxito
- **THEN** el SPA SHALL pedir de nuevo el plan

#### Scenario: Abrir quien conoce a alguien

- **GIVEN** una acción `ask_know_someone` con `groupId` G
- **WHEN** Ana pulsa el nombre de la oferta
- **THEN** el SPA SHALL navegar a `/grupos/G`

### Requirement: Borrador de seguimiento por plantilla

En una acción `follow_up` el SPA SHALL ofrecer «Preparar seguimiento», que muestra un borrador en el idioma de la
interfaz armado localmente, y un botón «Copiar» que lo copia al portapapeles. El borrador SHALL ser exactamente, en
español: «Hola:» / «Me postulé a {título} en {empresa} el {fecha}. Sigo con mucho interés en el puesto.» (sin fecha de
postulación: «Hace un tiempo me postulé a {título} en {empresa}. Sigo con mucho interés en el puesto.») / «¿Me podrían
contar en qué estado está el proceso de selección?»; y en inglés: «Hello,» / «I applied for {título} at {empresa} on
{fecha}. I am still very interested in the role.» (sin fecha: «I applied for {título} at {empresa} a while ago. I am
still very interested in the role.») / «Could you tell me where the selection process currently stands?». Sin título
SHALL usar «la vacante» / «the position» y sin empresa «su empresa» / «your company». El borrador NO SHALL decir
«adjunto mi CV» ni «como conversamos». El SPA NO SHALL llamar a la IA, NO SHALL proponer destinatario ni enlace
`mailto` y NO SHALL guardar el borrador.

#### Scenario: Copiar el borrador

- **GIVEN** una acción `follow_up` de «Mobile Developer» en «Startup Andes» sin fecha de postulación
- **WHEN** Ana pulsa «Preparar seguimiento» y después «Copiar» con la interfaz en español
- **THEN** el portapapeles SHALL contener «Hace un tiempo me postulé a Mobile Developer en Startup Andes. Sigo con
  mucho interés en el puesto.»
- **AND** la última línea SHALL ser «¿Me podrían contar en qué estado está el proceso de selección?»
- **AND** NO SHALL haberse hecho ninguna petición HTTP por esa acción

#### Scenario: Sin título ni empresa

- **GIVEN** una acción `follow_up` sin título ni empresa, con la interfaz en inglés
- **WHEN** Ana abre el borrador
- **THEN** SHALL nombrar «the position» y «your company»
- **AND** NO SHALL contener «mailto», «attached» ni «as we discussed»
