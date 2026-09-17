## MODIFIED Requirements

### Requirement: Aislamiento de la capa de dominio

Ningún archivo bajo una carpeta `domain/` de cualquier proyecto SHALL importar paquetes de infraestructura. La lista
prohibida SHALL ser cerrada e incluir al menos `@nestjs/*`, `mongoose`, `mongodb`, `bullmq`, `ioredis`, `fastify`,
`@fastify/*`, `@aws-sdk/*`, `minio`, `pino` y `nestjs-pino`. Además, ningún archivo bajo
`apps/api/src/modules/<módulo>/domain/` SHALL importar código de otro módulo de `apps/api/src/modules/`. El incumplimiento
SHALL ser detectado por el lint.

#### Scenario: El dominio importa el framework

- **GIVEN** un archivo bajo una carpeta `domain/` de `apps/api`
- **WHEN** ese archivo importa `@nestjs/common`, `mongoose` o `bullmq`
- **THEN** el lint SHALL fallar

#### Scenario: La infraestructura importa el framework

- **GIVEN** un archivo bajo una carpeta `infrastructure/` del mismo módulo
- **WHEN** ese archivo importa `@nestjs/common`, `mongoose` o `bullmq`
- **THEN** el lint SHALL pasar

#### Scenario: El dominio importa otro módulo

- **GIVEN** un archivo bajo `apps/api/src/modules/auth/domain/`
- **WHEN** ese archivo importa un archivo de `apps/api/src/modules/users/`
- **THEN** el lint SHALL fallar

#### Scenario: El dominio importa su propio módulo

- **GIVEN** un archivo bajo `apps/api/src/modules/auth/domain/`
- **WHEN** ese archivo importa otro archivo de `apps/api/src/modules/auth/domain/`
- **THEN** el lint SHALL pasar
