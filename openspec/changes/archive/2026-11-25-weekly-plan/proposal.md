## Why

El owner pidió el 2026-11-25 nuevas features y actividades para la plataforma con patrones agénticos y multiagénticos, y
empezar la implementación de la propuesta mejor votada por el panel interno (cita literal en `design.md`, «Aprobación
humana»). El panel (cuatro proponentes, un crítico y cinco jurados) eligió **C1 `weekly-plan` («Tu semana»)**: primera
en los cinco rankings (208/250) y con siete condiciones obligatorias del jurado.

El problema que ataca es el de la persona que busca trabajo con el tablero lleno: LinkVault ya sabe qué oferta guardada
vence pronto (`preview.expiresAt`, frescura de ADR-037), qué postulación lleva diez días quieta (`statusChangedAt`,
ADR-039) y en qué ofertas alguien del grupo «conoce a alguien» (`knowSomeoneUserIds`), pero cada dato vive en una
pantalla distinta y nadie los junta en «qué hago esta semana». Ninguna herramienta del mercado trabaja al grupo como
unidad; la asistencia con revisión humana funciona y la acción automática en nombre del usuario no.

## What Changes

- **Plan semanal personal, calculado al leer** (`GET /api/applications/weekly-plan`): como mucho **3 acciones** para la
  semana ISO en curso (UTC), cada una con su motivo, elegidas por un **planificador determinista** (`RuleBasedPlanner`)
  detrás del puerto `WeeklyPlanner`. Tres reglas: **postular antes de que cierre** (guardada o «me interesa» que vence
  en 7 días o con encaje alto), **hacer seguimiento** (postulada o en proceso, quieta 10 días o más) y **alguien de tu
  grupo conoce a alguien** (solo el **conteo**). Sin cron, sin LLM y sin escrituras al leer.
- **Decisiones del usuario** (`POST /api/applications/weekly-plan/decisions`): «Hecho», «Ahora no»
  (solo esta semana) y «Ocultar sugerencia», en una **colección propia** `weekly_plan_decisions` con clave `(userId, weekKey, candidateId)`. **Nunca**
  cambian el estado de la postulación (sin dual-write) y caducan solas (TTL).
- **Método de lote nuevo en `LinksFacade`** (`planSignalsOf`): frescura (`closedAt`, `preview.expiresAt`) y conteo de
  «conozco a alguien» en los grupos de quien pregunta, en un número fijo de consultas, sin identidades.
- **Borrador de seguimiento por plantilla** (C4 absorbida) en la acción de seguimiento: texto copiable armado en el SPA
  con `$localize`, sin envío, sin destinatario, sin `mailto`.
- **Tarjeta «Tu semana»** arriba del tablero de postulaciones, también en el móvil, con estados cargando, vacío honesto
  («No hay nada urgente esta semana») y error; botones de 44 px; i18n ES/EN.
- **Borrado de cuenta**: la cascada elimina también `weekly_plan_decisions`.
- **Seed demo**: una oferta guardada que vence pronto, para que Ana vea las tres reglas en local.
- **Diseñado y fuera de las tareas** (sección «Cortes siguientes» de `design.md`): planificador LLM por `runTask` que
  solo elige `candidateId` de un enum cerrado, validador determinista, eval, memoria episódica, cron del lunes con
  aviso, vista de grupo opt-in y el segundo corte C3 (`group-weekly-brief`).

## Capabilities

### New Capabilities

- `applications/weekly-plan`: plan semanal on-read, reglas, tope de acciones, decisiones en colección propia, contrato.
- `web/weekly-plan`: tarjeta «Tu semana» en el tablero, estados, acciones, borrador de seguimiento, móvil e i18n.

### Modified Capabilities

- `links/sharing`: requirement nuevo de señales de plan por lote para otros módulos (la fachada gana `planSignalsOf`).
- `users/account-deletion`: requirement nuevo, la cascada borra las decisiones del plan semanal.
- `platform/demo-seed`: requirement nuevo, el dataset demo cubre las tres reglas de «Tu semana».

## Impact

- `apps/api`: `applications` (dominio `weekly-plan/`, dos casos de uso, puerto y repositorio de decisiones, rutas
  nuevas en `ApplicationsController`), `links` (`LinksFacade.planSignalsOf` y dos métodos de repositorio), `users`
  (cascada), `seed` (un link más).
- `libs/shared`: `weekly-plan.schema.ts` (zod) exportado desde el índice.
- `apps/web`: `core/applications/weekly-plan.*` (API y store) y `features/applications/weekly-plan-card.*`;
  catálogo i18n re-extraído y `messages.en.xlf`.
- `apps/web-e2e`: `weekly-plan.spec.ts` (perfil `local`).
- Sin cambios de despliegue, CI, compose, variables de entorno, `libs/ai` ni worker. ADR nuevo: **ADR-068**.
- **Plan**: fila **candidata** en `docs/design-v0.2.md` §6; no está en `openspec-changes.yaml` y no se fusiona hasta
  que el owner abra una ventana; no altera la precedencia de la fila 35.
