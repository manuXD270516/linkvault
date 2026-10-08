## MODIFIED Requirements

### Requirement: Invitación a compartir tras el gesto

En el detalle de un grupo, tras "Me interesa" o "Postulé", si la postulación resultante es privada, SHALL mostrarse un
aviso que dice el alcance: tras "Postulé", "¿Que tus grupos vean que postulaste a esta oferta? También quien entre
después."; tras "Me interesa", "¿Que tus grupos vean que te interesa esta oferta? También quien entre después.". SHALL
ofrecer "Compartir", que activa la visibilidad `group`, y "Qué verán", que muestra la misma explicación que el
interruptor del panel. Tras compartir SHALL mostrarse "Compartido · Deshacer", y "Deshacer" SHALL volver a `private`.
Las dos acciones SHALL actuar sobre la postulación del gesto que abrió el aviso; si la API responde `404` con
`application_not_found`, NO SHALL mostrarse ningún error. Los avisos SHALL anunciarse a los lectores de pantalla y NO
SHALL cerrarse antes de 10 segundos ni mientras tengan el foco; pasados los 10 segundos, SHALL cerrarse en cuanto el
foco no esté en ellos. Un aviso pertenece al detalle del grupo donde se abrió: al navegar a otra página —un cambio de
path— SHALL cerrarse en ese momento, con el mismo desenlace que si se hubiera dejado ir —sin pulsar "Compartir", la
postulación sigue privada; sin pulsar "Deshacer", sigue compartida y se puede cambiar desde el interruptor del panel— y
NO SHALL verse en ninguna otra página. Un cambio solo de la query (por ejemplo, los filtros del grupo) NO SHALL
cerrarlo. Un aviso que llegue cuando la persona ya salió de la página del gesto —porque la API tardó— NO SHALL
abrirse. Si no se pulsa "Compartir", la postulación SHALL seguir privada. En `/mis-links` NO SHALL
mostrarse el aviso.

#### Scenario: Compartir tras el gesto

- **GIVEN** un miembro en el detalle de un grupo con una tarjeta que no sigue
- **WHEN** pulsa "Me interesa"
- **THEN** SHALL ver "¿Que tus grupos vean que te interesa esta oferta? También quien entre después." con "Compartir" y
  "Qué verán"
- **AND** al pulsar "Compartir", la postulación SHALL quedar con visibilidad `group` y SHALL verse "Compartido ·
  Deshacer"

#### Scenario: Deshacer compartir

- **GIVEN** un miembro que acaba de pulsar "Compartir" en el aviso
- **WHEN** pulsa "Deshacer" en "Compartido · Deshacer"
- **THEN** la postulación SHALL volver a visibilidad `private`
- **AND** su avatar NO SHALL verse en la tarjeta del grupo

#### Scenario: Texto tras "Postulé"

- **GIVEN** un miembro en el detalle de un grupo con una tarjeta que no sigue
- **WHEN** pulsa "Postulé" y responde "Hoy"
- **THEN** SHALL ver "¿Que tus grupos vean que postulaste a esta oferta? También quien entre después."

#### Scenario: El aviso espera

- **GIVEN** el aviso de compartir visible con el foco en "Compartir"
- **WHEN** pasan 15 segundos
- **THEN** el aviso SHALL seguir visible

#### Scenario: Sin foco, se va a los 10 segundos

- **GIVEN** el aviso "Compartido · Deshacer" visible y el foco fuera de él
- **WHEN** pasan 10 segundos
- **THEN** el aviso SHALL cerrarse
- **AND** la postulación SHALL seguir compartida

#### Scenario: Al salir del grupo, el aviso no acompaña

- **GIVEN** el aviso "Compartido · Deshacer" visible en el detalle de un grupo, antes de 10 segundos
- **WHEN** el miembro navega a "Postulaciones", a sus insights o a "Mi CV"
- **THEN** el aviso NO SHALL verse en esa página
- **AND** la postulación SHALL seguir compartida

#### Scenario: Cambiar los filtros no lo cierra

- **GIVEN** el aviso "Compartido · Deshacer" visible en el detalle de un grupo, antes de 10 segundos
- **WHEN** el miembro cambia un filtro del grupo y solo cambia la query de la URL
- **THEN** el aviso SHALL seguir visible

#### Scenario: Navegar mientras se comparte

- **GIVEN** un miembro que pulsa "Compartir" en el aviso del detalle de un grupo
- **WHEN** navega a otra página antes de que la API responda
- **THEN** NO SHALL abrirse "Compartido · Deshacer" en la página nueva
- **AND** la postulación SHALL quedar como la deje la respuesta de la API

#### Scenario: Salir sin compartir

- **GIVEN** el aviso "¿Que tus grupos vean que postulaste a esta oferta? También quien entre después." visible
- **WHEN** el miembro navega a otra página sin pulsar "Compartir"
- **THEN** el aviso SHALL cerrarse
- **AND** la postulación SHALL seguir privada

#### Scenario: Se dejó de seguir entretanto

- **GIVEN** el aviso de compartir visible y la postulación ya dejada de seguir en otra pestaña
- **WHEN** el usuario pulsa "Compartir" y la API responde `404` con `application_not_found`
- **THEN** NO SHALL mostrarse ningún error y la tarjeta SHALL volver a ofrecer "Me interesa" y "Postulé"

#### Scenario: Sin pulsar, sigue privada

- **GIVEN** un miembro en el detalle de un grupo con una tarjeta que no sigue
- **WHEN** pulsa "Postulé", responde "Hoy" y deja que el aviso desaparezca
- **THEN** la postulación SHALL seguir privada

#### Scenario: En Mis links no se ofrece

- **GIVEN** un usuario en `/mis-links` con una tarjeta que no sigue
- **WHEN** pulsa "Me interesa"
- **THEN** NO SHALL mostrarse el aviso de compartir

#### Scenario: Ya estaba compartida

- **GIVEN** una tarjeta que el usuario sigue con visibilidad `group` en "Interés"
- **WHEN** pulsa "Postulé" y responde "Hoy"
- **THEN** NO SHALL mostrarse el aviso

