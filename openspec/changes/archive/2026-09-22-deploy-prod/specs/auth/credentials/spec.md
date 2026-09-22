## ADDED Requirements

### Requirement: IP del cliente detrás de Traefik de confianza

Cuando `api` corre detrás del proxy de confianza documentado (Traefik del compose prod), SHALL activar `trustProxy` (o
equivalente de Fastify) de forma que los límites por IP de login, registro y el contador de IP del join heredado usen la
IP del cliente, no la del proxy. La activación SHALL hacerse con la variable de entorno `TRUST_PROXY=true`, presente
**solo** en el compose de producción detrás de Traefik. Activar `trustProxy` sin ese proxy de confianza NO SHALL formar
parte del camino soportado; local/dev/tests genéricos SHALL dejar la variable ausente o en falso.

#### Scenario: Límite de login por IP del cliente

- **GIVEN** `api` detrás de Traefik con `TRUST_PROXY=true` según la documentación de prod
- **WHEN** llegan 50 logins fallidos desde la misma IP de cliente (vía cabeceras de proxy de confianza) en la ventana
- **THEN** el intento siguiente desde esa IP SHALL responder `429`
- **AND** peticiones desde otra IP de cliente NO SHALL compartir ese contador

#### Scenario: Join usa la misma IP de cliente

- **GIVEN** el stack prod con Traefik de confianza
- **WHEN** se aplican los límites por IP del flujo de unirse a un grupo
- **THEN** la IP contada SHALL ser la del cliente vista a través del proxy
- **AND** NO SHALL ser únicamente la IP interna de Traefik para todos los clientes

#### Scenario: Sin TRUST_PROXY fuera de compose prod

- **GIVEN** un arranque local o de test sin `TRUST_PROXY=true`
- **WHEN** se inspecciona la configuración de Fastify/Nest
- **THEN** `trustProxy` NO SHALL estar activado como en prod
- **AND** los límites NO SHALL confiar en `X-Forwarded-For` de clientes no autenticados por un proxy de confianza

### Requirement: Reseteo manual de contraseña por operador

`docs/RUNBOOK.md` SHALL documentar el procedimiento de reseteo manual de contraseña por un operador: generar un hash
Argon2id de la nueva contraseña, sustituirlo en el documento del usuario y revocar todas las sesiones de esa persona.
El procedimiento NO SHALL exigir email de recuperación (fuera de alcance de este change).

#### Scenario: Operador sigue el RUNBOOK

- **GIVEN** una persona que olvidó la contraseña y no hay email de recuperación
- **WHEN** el operador aplica el procedimiento del RUNBOOK
- **THEN** el documento del usuario SHALL quedar con un hash `$argon2id$` nuevo
- **AND** las sesiones previas SHALL quedar revocadas
- **AND** un login con la contraseña nueva SHALL responder `200`
