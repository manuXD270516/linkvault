## Purpose

Define el envío de correo transaccional de LinkVault mediante un puerto Mailer con adaptadores por entorno, plantillas
en español e inglés y configuración documentada de remitente y DNS, sin acoplar el dominio de auth a un proveedor.

## ADDED Requirements

### Requirement: Puerto Mailer único

La aplicación SHALL enviar correo solo a través de un puerto `Mailer` (o nombre equivalente) inyectado. Ningún caso de
uso de auth SHALL importar el SDK de Resend ni un cliente SMTP directamente. El puerto SHALL aceptar al menos las
plantillas `email-verification` y `password-reset` con variables tipadas (`displayName`, `actionUrl`, caducidad
humana) y un locale `es` o `en`.

#### Scenario: Auth no importa el SDK del proveedor

- **WHEN** se inspeccionan los imports de los casos de uso de verificación y recuperación
- **THEN** NO SHALL aparecer el SDK de Resend ni un cliente SMTP de bajo nivel
- **AND** el envío SHALL realizarse vía el puerto Mailer

### Requirement: Adaptadores Resend, SMTP/Mailpit y captura

Con `MAIL_PROVIDER=resend`, el adaptador SHALL enviar vía API de Resend usando `RESEND_API_KEY` y `MAIL_FROM`. Con
`MAIL_PROVIDER=smtp`, SHALL enviar por SMTP a `MAIL_SMTP_HOST`:`MAIL_SMTP_PORT` (Mailpit en local). Con
`MAIL_PROVIDER=capture` (tests), SHALL guardar los mensajes en memoria consultables por el harness sin red externa. Un
valor de proveedor desconocido o una clave Resend ausente cuando el proveedor es `resend` SHALL impedir el arranque de
`api` nombrando la variable sin mostrar secretos.

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

### Requirement: Plantillas en español e inglés

Cada plantilla transaccional de este change SHALL existir en `es` y `en` (asunto + **texto plano**). En V0 NO SHALL
incluirse cuerpo HTML enriquecido. El locale del envío SHALL ser `outputLanguage` del usuario cuando se conoce; si no,
`es`. Ningún log SHALL registrar el cuerpo completo del correo ni el token en claro.

#### Scenario: Correo de verificación en inglés

- **GIVEN** un usuario con `outputLanguage` `en` pendiente de verificar
- **WHEN** se envía el correo de verificación
- **THEN** el asunto y el cuerpo capturados SHALL estar en inglés
- **AND** la URL de acción SHALL apuntar a `WEB_BASE_URL` con la ruta de verificación del SPA

#### Scenario: Forgot sin usuario usa español por defecto

- **WHEN** se solicita forgot-password para un email sin cuenta (respuesta genérica)
- **THEN** NO SHALL enviarse correo
- **AND** si hubiera envío por error de implementación, el locale por defecto documentado SHALL ser `es`

### Requirement: Remitente placeholder y DNS documentado

`.env.example` SHALL declarar `MAIL_FROM`, `MAIL_PROVIDER`, variables SMTP y `RESEND_API_KEY` con valores placeholder
seguros para local. `docs/RUNBOOK.md` SHALL documentar los registros DNS (SPF, DKIM y, si aplica, DMARC) necesarios
para el dominio del From con Resend. La ausencia de DNS real NO SHALL impedir validar ni fusionar el change; el
arranque local con Mailpit NO SHALL exigir esos registros.

#### Scenario: Ejemplo de entorno documenta el correo

- **WHEN** se inspecciona `.env.example`
- **THEN** SHALL incluir `MAIL_PROVIDER`, `MAIL_FROM` y la configuración SMTP o Resend según el comentario local
- **AND** NO SHALL contener una API key real de Resend

#### Scenario: RUNBOOK describe SPF/DKIM

- **WHEN** un operador abre el RUNBOOK en la sección de correo
- **THEN** SHALL encontrar los pasos para publicar SPF/DKIM (y DMARC si aplica) del dominio From
- **AND** SHALL quedar claro que sin ellos el proveedor puede rechazar o marcar spam, sin bloquear el desarrollo local
