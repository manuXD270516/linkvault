# notifications/web-push Specification

## Purpose

Define el alta y baja de suscripciones Web Push (VAPID) y el envío de avisos push desde el worker sin acoplar el
dominio de notificaciones a un SDK concreto en los casos de uso HTTP.

## Requirements

### Requirement: Alta de suscripción

`POST /api/notifications/push-subscriptions` autenticado SHALL aceptar el payload estándar de suscripción del navegador
(endpoint URL + claves `p256dh` y `auth`), validarlo y persistirlo asociado al usuario. Responderá `201` (alta) o `200`
(idempotente si el mismo endpoint ya existía para ese usuario). Sin sesión → `401`.

#### Scenario: Primera suscripción

- **GIVEN** Ana autenticada
- **WHEN** registra una suscripción válida
- **THEN** la respuesta SHALL ser `201`
- **AND** un aviso posterior elegible SHALL poder usar ese endpoint

#### Scenario: Mismo endpoint otra vez

- **GIVEN** Ana ya registró el endpoint E
- **WHEN** vuelve a registrar E
- **THEN** la respuesta SHALL ser `200`
- **AND** NO SHALL duplicarse la fila lógica de suscripción para E

### Requirement: Baja de suscripción

`DELETE /api/notifications/push-subscriptions` autenticado SHALL eliminar la suscripción identificada por **endpoint**
(query o cuerpo documentado) del usuario. Responderá `204` aunque ya no existiera (idempotente). NO SHALL borrar
suscripciones de otro usuario.

#### Scenario: Baja propia

- **GIVEN** Ana con suscripción E
- **WHEN** elimina E por endpoint
- **THEN** `204`
- **AND** un aviso posterior NO SHALL intentar push a E para Ana

### Requirement: Envío con VAPID

El worker SHALL enviar web push solo con las claves VAPID de configuración (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`). Un endpoint que responda `410`/`404` SHALL provocar el borrado de esa suscripción. Los logs NO SHALL
registrar las claves VAPID privadas ni el `auth` de la suscripción.

#### Scenario: Endpoint muerto

- **GIVEN** una suscripción cuyo endpoint responde `410 Gone` al push
- **WHEN** el worker intenta entregar
- **THEN** esa suscripción SHALL eliminarse
- **AND** el job de ese canal MAY completarse sin reintento infinito

### Requirement: Clave pública al cliente

`GET /api/notifications/push-vapid-public-key` (autenticado) SHALL devolver la clave pública VAPID (`200`) para que el
SPA suscriba al push. Si faltan claves de configuración, SHALL responder `503` con código de error tipado (sin filtrar
secretos). Sin sesión → `401`. NO SHALL devolver la clave privada.

#### Scenario: SPA obtiene la pública

- **GIVEN** Ana autenticada y VAPID configurado
- **WHEN** pide la clave pública
- **THEN** `200` con la pública
- **AND** el cuerpo NO SHALL contener la privada

#### Scenario: VAPID ausente

- **GIVEN** el proceso sin `VAPID_PUBLIC_KEY` usable
- **WHEN** Ana pide la clave pública
- **THEN** la respuesta SHALL ser `503`
