## MODIFIED Requirements

### Requirement: Aislamiento de la capa de dominio

Ningún archivo bajo una carpeta `domain/` de cualquier proyecto SHALL importar paquetes de infraestructura. La lista
prohibida SHALL ser cerrada e incluir al menos `@nestjs/*`, `mongoose`, `mongodb`, `bullmq`, `ioredis`, `fastify`,
`@fastify/*`, `@aws-sdk/*`, `minio`, `pino` y `nestjs-pino`. Además, ningún archivo bajo
`apps/api/src/modules/<módulo>/{domain,application,infrastructure}/` SHALL importar código de otro módulo de
`apps/api/src/modules/`, salvo, **solo desde `application/` e `infrastructure/`**, su facade de aplicación
(`**/application/*.facade`), sus errores de dominio (`**/domain/errors`) y sus dobles de test
(`**/application/testing/**`), que son su única entrada pública. La capa `domain/` mantiene la prohibición absoluta: no
puede importar nada de otro módulo. La capa
`presentation/` SHALL poder importar el módulo Nest de otro (`**/presentation/*.module`) para el cableado de la
inyección de dependencias. El incumplimiento
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

#### Scenario: Un módulo usa la entrada pública de otro

- **GIVEN** un archivo bajo `apps/api/src/modules/groups/infrastructure/`
- **WHEN** ese archivo importa `users/application/users.facade` o `users/domain/errors`
- **THEN** el lint SHALL pasar

#### Scenario: Un módulo lee el repositorio de otro

- **GIVEN** un archivo bajo `apps/api/src/modules/groups/application/`
- **WHEN** ese archivo importa `users/infrastructure/mongo-user.repository`
- **THEN** el lint SHALL fallar

#### Scenario: El dominio no usa la entrada pública de otro

- **GIVEN** un archivo bajo `apps/api/src/modules/auth/domain/`
- **WHEN** ese archivo importa `users/domain/errors`
- **THEN** el lint SHALL fallar

#### Scenario: Cableado de Nest entre módulos

- **GIVEN** un archivo bajo `apps/api/src/modules/groups/presentation/`
- **WHEN** ese archivo importa `users/presentation/users.module`
- **THEN** el lint SHALL pasar

#### Scenario: Un test usa el doble en memoria de otro módulo

- **GIVEN** un archivo bajo `apps/api/src/modules/groups/infrastructure/`
- **WHEN** ese archivo importa `users/application/testing/in-memory-user.repository`
- **THEN** el lint SHALL pasar
