## MODIFIED Requirements

### Requirement: Adaptadores Resend, SMTP/Mailpit y captura

Con `MAIL_PROVIDER=resend`, el adaptador SHALL enviar vía API de Resend usando `RESEND_API_KEY` y `MAIL_FROM`. Con
`MAIL_PROVIDER=smtp`, SHALL enviar por SMTP a `MAIL_SMTP_HOST`:`MAIL_SMTP_PORT` (Mailpit en local). Con
`MAIL_PROVIDER=capture` (tests), SHALL guardar los mensajes en memoria consultables por el harness sin red externa. Un
valor de proveedor desconocido o una clave Resend ausente cuando el proveedor es `resend` SHALL impedir el arranque de
`api` nombrando la variable sin mostrar secretos.

**El adaptador SMTP SHALL saber autenticarse.** Hasta este change creaba el transporte sin credenciales y sin cifrado,
así que solo servía para un relay que autorizara por red o por IP, y **no** para una submission con usuario y
contraseña, que es lo que ofrecen la mayoría de proveedores de correo. Eso no se notaba mientras nadie salvo el autor
recibía correos. Por tanto, con `MAIL_PROVIDER=smtp`:

- SHALL admitir credenciales `MAIL_SMTP_USER` y `MAIL_SMTP_PASSWORD`. Sin ninguna de las dos, el envío SHALL seguir
  siendo sin autenticación, como hasta ahora (Mailpit en local, relay por red).
- Las dos credenciales SHALL darse **juntas**: una sin la otra SHALL impedir el arranque nombrando la que falta, y NO
  SHALL descubrirse al enviar el primer correo.
- SHALL admitir TLS implícito y la negociación de TLS sobre la conexión en claro, según la configuración documentada.
- Con credenciales configuradas, la conexión SHALL ir cifrada **antes** de enviarlas y el certificado del servidor
  SHALL verificarse. Enviar la contraseña sin cifrar o a un servidor cuyo certificado no se ha comprobado NO SHALL
  ocurrir ni como degradación silenciosa: SHALL fallar el envío.
- Ni la contraseña ni el usuario SHALL aparecer en logs, en mensajes de error de arranque ni en respuestas.
- Un envío que el servidor rechaza SHALL registrarse con su **clase** —credenciales rechazadas, cuota del proveedor
  agotada, o rechazo sin clasificar— y el código de respuesta del servidor, **sin** credenciales. Con un proveedor
  gratuito de cupo diario, "la cuota se agotó" y "la contraseña caducó" piden reacciones distintas, y un log que solo
  diga "fallo de envío" obliga a adivinar cuál.

**Lo anterior SHALL cumplirse en los dos procesos que envían correo**: `api` (verificación y recuperación) y `worker`
(notificaciones de producto). Los dos validan su configuración de correo al arrancar con las mismas reglas, y un
proceso que arrancara aceptando una configuración que el otro rechaza dejaría la mitad de los correos sin entregar.

#### Scenario: Arranque local con SMTP a Mailpit

- **GIVEN** `.env` con `MAIL_PROVIDER=smtp` y host/puerto de Mailpit
- **WHEN** arranca `api`
- **THEN** el arranque SHALL completarse
- **AND** un envío de verificación en desarrollo local SHALL poder comprobarse como smoke en la UI de Mailpit

#### Scenario: Resend sin clave

- **WHEN** `api` arranca con `MAIL_PROVIDER=resend` y sin `RESEND_API_KEY`
- **THEN** el arranque SHALL fallar nombrando `RESEND_API_KEY` sin mostrar otros secretos

#### Scenario: Captura en test y CI

- **GIVEN** el Mailer de captura (`MAIL_PROVIDER=capture` o DI de test)
- **WHEN** un caso de uso envía `password-reset` en el harness de CI
- **THEN** el harness SHALL poder leer el destinatario, el locale y la URL de acción con el token
- **AND** el test NO SHALL depender de Mailpit ni de red externa

#### Scenario: SMTP con usuario y contraseña entrega el correo

- **GIVEN** un servidor SMTP que exige autenticación sobre una conexión cifrada, y `MAIL_SMTP_USER` y
  `MAIL_SMTP_PASSWORD` válidos
- **WHEN** `api` envía el correo de verificación y `worker` envía una notificación
- **THEN** el servidor SHALL aceptar los dos mensajes tras autenticarse
- **AND** la autenticación SHALL haber ocurrido sobre la conexión ya cifrada

#### Scenario: Credenciales a medias impiden arrancar

- **WHEN** `api` o `worker` arrancan con `MAIL_PROVIDER=smtp`, `MAIL_SMTP_USER` definido y sin `MAIL_SMTP_PASSWORD`
- **THEN** el arranque SHALL fallar nombrando `MAIL_SMTP_PASSWORD`
- **AND** el mensaje NO SHALL mostrar el valor de `MAIL_SMTP_USER` ni de ningún otro secreto

#### Scenario: Las credenciales no viajan sin cifrar ni a un certificado sin verificar

- **GIVEN** credenciales SMTP configuradas y un servidor que no ofrece cifrado o presenta un certificado que no se
  puede verificar
- **WHEN** se intenta enviar un correo
- **THEN** el envío SHALL fallar
- **AND** las credenciales NO SHALL haberse transmitido

#### Scenario: Un rechazo del servidor se registra con su clase y sin secretos

- **GIVEN** credenciales SMTP configuradas y un servidor que rechaza la autenticación, o que rechaza el envío por
  cuota agotada
- **WHEN** `api` o `worker` intentan enviar un correo
- **THEN** el log del fallo SHALL nombrar la clase del rechazo y el código de respuesta del servidor
- **AND** NO SHALL contener el valor de `MAIL_SMTP_USER` ni de `MAIL_SMTP_PASSWORD`

#### Scenario: SMTP sin credenciales sigue funcionando como relay

- **GIVEN** `MAIL_PROVIDER=smtp` sin `MAIL_SMTP_USER` ni `MAIL_SMTP_PASSWORD`
- **WHEN** arrancan `api` y `worker` y envían un correo
- **THEN** el arranque SHALL completarse y el envío SHALL hacerse sin autenticación
