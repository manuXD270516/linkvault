## Why

El panel interno de nuevas features del 2026-11-25 dejó a **C3 `group-weekly-brief` («La semana del grupo»)** segunda,
a 3 puntos de 250 de la ganadora (`weekly-plan`, ya fusionada y archivada con el PR #98), y los cinco jurados la
propusieron como el corte siguiente. `weekly-plan` la dejó diseñada como su quinto corte (design archivado, «Cortes
siguientes» §5).

El problema: un grupo de 3 a 5 personas que comparte ofertas por LinkVault acumula decenas de links y nadie tiene el
panorama. Los datos ya están en las ofertas —cuáles cierran pronto (`preview.expiresAt`), cuáles cerró el detector de
frescura (`closedAt`, ADR-037), qué habilidades piden (`preview.skills`), cuándo entraron al grupo (`sharedAt`)— pero
el listado del grupo los muestra de a uno, tarjeta por tarjeta. Una tarjeta con 3 a 5 viñetas **verificadas** («4 de 7
ofertas piden Docker», «2 cierran hasta el domingo») le da al grupo de qué hablar el lunes sin que nadie tenga que
contar a mano, y sin exponer nada de lo que cada miembro hace con esas ofertas.

## What Changes

- **Tabla de hechos semanal por grupo, calculada una vez en el worker** por `(groupId, weekKey ISO UTC)`: un tick
  diario a las 05:00 UTC y otro al arrancar el worker calculan solo los grupos que todavía no tienen la semana en
  curso; una inserción con índice único la hace idempotente. Colección nueva `group_weekly_briefs`, con TTL de 35 días.
- **Solo datos de ofertas**: ofertas abiertas, las que cierran en los próximos 7 días, habilidades más pedidas, las
  que entraron la semana pasada y las que cerraron la semana pasada. **Nunca** notas, comentarios, etiquetas,
  «conozco a alguien», postulaciones ni nombres o identificadores de miembros. «No la sigue nadie» queda **fuera** del
  MVP por privacidad (design D4; Q2 para una variante sin fuga).
- **Viñetas por plantilla, sin LLM**: como mucho 5, cada una cita un `factId` de la tabla; el texto lo arma el SPA con
  i18n desde el hecho citado.
- **Evaluador determinista** en `libs/shared` (`verifyGroupWeeklyBrief`): cada viñeta cita un hecho existente, los
  conteos coinciden con sus listas de ofertas y los subconjuntos son coherentes. El worker no guarda una semana que no
  lo pase y la api no sirve una que no lo pase.
- **Lectura en la api** (`GET /api/groups/:id/weekly-brief`): solo lee; para miembros; resuelve las ofertas de cada
  viñeta que siguen en el grupo, en un número fijo de lecturas.
- **Tarjeta «La semana del grupo»** en `/grupos/:id`, encima del listado de links: fecha del cálculo, número de ofertas
  abiertas, viñetas y «Ver ofertas (N)» desplegable con enlaces a cada oferta; estados de carga, vacío y error; móvil,
  44 px e i18n ES/EN con tuteo.
- **Borrar un grupo** se lleva sus semanas en la misma transacción (hook de borrado de `links`).
- **`isoWeekKey` unificada** en `libs/shared` (hoy duplicada en el worker y en `applications`, R5 de `weekly-plan`).
- **Seed demo**: habilidades en tres ofertas para que el grupo demo muestre al menos tres viñetas.
- **Diseñado y fuera de las tareas** (design, «Cortes siguientes»): síntesis LLM `summarize-group-week` por `runTask`
  que cita `factId` y pasa por el mismo evaluador, con tope de llamadas **en código**; el bloque en el correo del
  `group-digest`; y la variante de «no la sigue nadie» si el debate la acepta.

## Capabilities

### New Capabilities

- `groups/weekly-brief`: cálculo semanal en el worker, tabla de hechos, viñetas, evaluador, retención y lectura por la
  api.
- `web/group-weekly-brief`: tarjeta «La semana del grupo» en el detalle del grupo, estados, textos ES/EN y enlaces a
  las ofertas.

### Modified Capabilities

- `groups/group-management`: requirement nuevo, el borrado del grupo se lleva sus semanas.
- `platform/demo-seed`: requirement nuevo, el grupo demo alimenta la semana del grupo con al menos tres viñetas.

## Impact

- `libs/shared`: `time/iso-week.ts` (movida), `schemas/group-weekly-brief.schema.ts` y
  `group-weekly-brief/verify-group-weekly-brief.ts`, exportados desde el índice.
- `apps/worker`: módulo nuevo `group-brief` (dominio puro, caso de uso, catálogo Mongo de solo lectura más escritor de
  la colección, host `@Cron` y arranque); flag opcional `FEATURE_GROUP_BRIEF` con valor por defecto `true` (Q1);
  `notifications` importa `isoWeekKey` de `libs/shared`.
- `apps/api`: `links` (caso de uso y ruta de lectura, repositorio de solo lectura de `group_weekly_briefs`, el hook de
  borrado de grupo borra también sus semanas); `applications` importa `isoWeekKey` de `libs/shared`; `seed` (habilidades
  en tres links demo).
- `apps/web`: `core/groups/group-weekly-brief.*` (API y store) y `features/groups/group-weekly-brief-card.*`; catálogo
  i18n re-extraído y `messages.en.xlf`.
- `apps/web-e2e`: `group-weekly-brief.spec.ts` (perfil `local`, semana escrita en Mongo por la prueba).
- Sin cambios de despliegue, CI, compose, variables obligatorias, `libs/ai` ni correo. Costo 0: lecturas de Mongo y
  una inserción por grupo y semana. ADR nuevo: **ADR-069**.
- **Plan**: fila **candidata 39** en `docs/design-v0.2.md` §6; no está en `openspec-changes.yaml` y no se fusiona hasta
  que el owner lo diga; no altera la precedencia de la fila 35.
