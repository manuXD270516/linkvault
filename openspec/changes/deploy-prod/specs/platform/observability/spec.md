## Purpose

Asegura observabilidad mínima en producción: métricas Prometheus sin secretos ni exposición pública a Internet, y logs
estructurados ya redactados. OpenTelemetry queda fuera de este change.

## ADDED Requirements

### Requirement: Métricas Prometheus en api y worker

`api` y `worker` SHALL exponer `GET /metrics` en formato Prometheus, sin autenticación a nivel de aplicación y fuera del
prefijo `/api`. La respuesta NO SHALL incluir secretos, tokens, emails, texto de CV, claves BYOK, hashes de contraseña
ni otros datos personales identificables. Las series SHALL describir salud operativa (p. ej. HTTP, colas, proceso) sin
etiquetas con PII.

El endpoint `/metrics` NO SHALL exponerse a Internet público: Traefik (u el borde) SHALL restringirlo a la red interna
de Docker o a una ACL allowlist equivalente (ver `platform/production-deploy`).

#### Scenario: Métricas sin auth en la app

- **GIVEN** `api` o `worker` en ejecución y un cliente en la red interna permitida
- **WHEN** ese cliente hace `GET /metrics` sin credenciales
- **THEN** SHALL responder 200 con cuerpo en formato Prometheus
- **AND** NO SHALL responder 401 ni 403 a nivel de aplicación

#### Scenario: Sin secretos ni PII en métricas

- **GIVEN** tráfico reciente con emails, tokens o subidas de CV
- **WHEN** se lee `GET /metrics`
- **THEN** el cuerpo NO SHALL contener emails, tokens, texto de CV, `Authorization`, cookies ni claves BYOK

#### Scenario: Metrics no públicos en Internet

- **GIVEN** el origen HTTPS público de Traefik
- **WHEN** un cliente externo intenta `GET /metrics` sin ACL interna
- **THEN** la ruta NO SHALL servirse como superficie pública documentada
- **AND** el acceso legítimo SHALL ser solo desde red interna o allowlist

### Requirement: Logs pino en producción sin secretos

En producción, `api` y `worker` SHALL emitir logs estructurados con pino y SHALL aplicar el redactor de secretos ya
existente (cabeceras y campos sensibles). Ningún log de producción SHALL contener valores de contraseñas, tokens,
`AI_VAULT_KEY`, claves BYOK, texto de CV ni query strings con códigos de invitación.

#### Scenario: Login fallido no filtra la contraseña

- **WHEN** `api` registra un intento de login fallido
- **THEN** la línea de log NO SHALL contener el valor de `password`
- **AND** las claves sensibles SHALL aparecer redactadas si se registran

#### Scenario: Redactor activo en prod

- **GIVEN** el proceso arrancado con perfil de producción
- **WHEN** se registra un objeto con `apiKey` y `refreshToken`
- **THEN** ninguno de esos valores SHALL aparecer en la salida
