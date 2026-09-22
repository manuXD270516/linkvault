## ADDED Requirements

### Requirement: Orquestador de prod usa liveness y readiness

El orquestador de producción (compose y Traefik / healthchecks de contenedor documentados) SHALL usar `GET /health/live`
como comprobación de **liveness** y `GET /health` como comprobación de **readiness** para los servicios `api` y
`worker`. El `HEALTHCHECK` embebido en las imágenes SHALL cubrir solo liveness; compose (u orquestador) SHALL poseer la
readiness. NO SHALL tratar como listo para tráfico un contenedor cuya readiness (`/health`) falle, aunque liveness
responda 200.

#### Scenario: Liveness del contenedor de api

- **GIVEN** el stack de producción arrancado
- **WHEN** el orquestador evalúa la liveness de `api`
- **THEN** SHALL consultar `GET /health/live`
- **AND** un 200 SHALL considerarse proceso vivo

#### Scenario: Readiness del contenedor de worker

- **GIVEN** Redis caído y el worker aún vivo
- **WHEN** el orquestador evalúa la readiness de `worker`
- **THEN** SHALL consultar `GET /health`
- **AND** un 503 SHALL impedir marcar el servicio como listo para tráfico
