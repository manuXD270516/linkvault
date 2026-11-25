## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los títulos de test van en inglés y salen de los escenarios de `specs/`. Rutas de
`apps/api` relativas a `apps/api/src/modules/` y de `apps/worker` relativas a `apps/worker/src/modules/`, salvo que se
diga otra cosa. La ronda 1 del debate partió 3.7, 4.5 y 7.1 (H8).

- [x] 0.1 [infra] Debate critic/business/reflect de este change cerrado sin P0/V0 abiertos. Verificar: `design.md`
  lleva la última ronda del debate con «Convergencia: SI», P0 0 y V0 0, y las decisiones no triviales nuevas están en
  ADR-069.
  Estado (2026-11-25): debate en dos rondas, «Convergencia: SI (2026-11-25, ronda 2: 0 P0 / 0 V0)» en design.md; ADR-069 con las decisiones.
- [x] 0.2 [infra] Aprobación humana registrada. Verificar: la sección `## Aprobación humana` de design tiene fecha, cita
  literal del owner y alcance (apply en la rama, **no** la fusión). Falsación: si dijera que autoriza fusionar sin
  ventana, el revisor la rechaza.
  Estado (2026-11-25): aprobación literal «Aprobado» del owner registrada en design.md con alcance apply sin fusión.
- [x] 0.3 [infra] Plan y ADR coherentes. Verificar: `docs/design-v0.2.md` §6 tiene la fila `group-weekly-brief` como
  **Candidata**; `grep -c "group-weekly-brief" openspec-changes.yaml` = 0; `docs/adr/ADR-069.md` existe; `bash
  infra/ci/repo-checks.sh` y `openspec validate group-weekly-brief --strict --no-interactive` en verde.

## 1. Contrato y semana ISO en `libs/shared` (design D6, D7, D10)

  Estado (2026-11-25): fila 39 candidata, 0 apariciones en `openspec-changes.yaml`, ADR-069 existe; validate y repo-checks en verde.
- [x] 1.1 [backend] `libs/shared/src/time/iso-week.ts` con `startOfIsoWeekUtc`, `isoWeekKey`, `previousWeekKey`,
  `nextWeekKey`, `startOfWeekKeyUtc`, `windowForWeekKey`, `previousClosedIsoWeek` e `isoWeekKeySchema` (H12), movidas
  de `worker/notifications/domain/iso-week.ts` y `api/applications/domain/weekly-plan/week-key.ts`, exportadas desde
  el índice; `group-weekly-digest.event.ts` y `weekly-plan.schema.ts` usan `isoWeekKeySchema` en vez de su regex.
  Verificar con `iso-week.spec.ts`, que reúne los vectores de las dos copias: «2026-12-31T23:30Z is 2026-W53»,
  «2027-01-03 is 2026-W53», «2027-01-04 is 2027-W01», «previous of 2027-W01 is 2026-W53», «next of 2026-W53 is
  2027-W01», «Monday 00:00Z starts a new week», «window of 2026-W48 is Nov 23 to Nov 30» y «isoWeekKeySchema rejects
  2026-48»; `grep -rn "W\\\\d{2}" libs/shared/src` solo en `iso-week.ts`.
  Estado (2026-11-25): iso-week.ts + iso-week.spec.ts (14 tests, vectores de las dos copias) exportados desde el índice; evento y weekly-plan.schema usan isoWeekKeySchema; grep de la regex solo en iso-week.ts; shared:test verde; falsación: +2 en el cálculo de semana hace fallar 7 tests; restaurado.
- [x] 1.2 [backend] Depende de 1.1. El worker (`notifications`: digest, scheduler y sus specs) importa de
  `@linkvault/shared` y se borra `notifications/domain/iso-week.ts` con su spec. Verificar: `pnpm nx run worker:test`
  y `worker:typecheck` en verde; `grep -rn "function isoWeekKey" apps/worker` sin resultados.
  Estado (2026-11-25): worker importa de @linkvault/shared; iso-week.ts y su spec borrados; worker:test (646 pasan) y typecheck en verde, sin function isoWeekKey en apps/worker; falsación: windowForWeekKey con end +14 días hace fallar 1 test del digest; restaurado.
- [x] 1.3 [backend] Depende de 1.1. `applications` (weekly-plan) importa de `@linkvault/shared` y se borra
  `applications/domain/weekly-plan/week-key.ts` con su spec. Verificar: `pnpm nx run api:test` de `weekly-plan` y
  `api:lint` en verde; `grep -rn "function isoWeekKey" apps/api` sin resultados.
  Estado (2026-11-25): api importa isoWeekKey y nextWeekKey de @linkvault/shared; week-key.ts y su spec borrados; api:test weekly-plan 57 tests en verde, api:lint y typecheck en verde, sin function isoWeekKey en apps/api; falsación: nextWeekKey con +2 semanas hace fallar 2 tests de weekly-plan; restaurado.
- [x] 1.4 [backend] `libs/shared/src/schemas/group-weekly-brief.schema.ts`: constantes, `groupBriefFactSchema`,
  `groupBriefBulletSchema` y `groupWeeklyBriefSchema` de D7 (tope 4, sin `closed_last_week`), exportados desde el
  índice. Verificar con `group-weekly-brief.schema.spec.ts`: «accepts a brief with one fact of each kind», «rejects five
  bullets», «rejects a closed_last_week fact», «closing fact requires firstExpiresAt», «rejects a skill fact with count 1», «rejects a member id field in a
  fact» y «rejects a malformed linkId».
  Estado (2026-11-25): constantes, groupBriefFactSchema, groupBriefBulletSchema y groupWeeklyBriefSchema exportados; 7 escenarios en verde; falsación: sin .max(4) en viñetas falla «rejects five bullets»; restaurado.
- [x] 1.5 [backend] Depende de 1.4. `groupBriefFactViewSchema` variante por variante (H13), `groupBriefOfferSchema` y
  `groupWeeklyBriefResponseSchema` (sin `scanTruncated`). Verificar en `group-weekly-brief.schema.spec.ts`: «view of
  each kind has no linkIds», «view rejects open_offers», «offer accepts an optional expiresAt», «response accepts brief null» y «response rejects
  scanTruncated».
  Estado (2026-11-25): groupBriefFactViewSchema, groupBriefOfferSchema y groupWeeklyBriefResponseSchema (strict, sin scanTruncated); 5 escenarios de la tarea en verde en group-weekly-brief.schema.spec.ts.
- [x] 1.6 [backend] `libs/shared/src/group-weekly-brief/verify-group-weekly-brief.ts` (función pura, D6) con los
  códigos de D6. Verificar con `verify-group-weekly-brief.spec.ts`: «valid brief passes», «bullet citing a missing fact
  fails with bullet_fact_missing», «count different from linkIds fails with count_mismatch», «skill link outside open
  offers fails with not_subset_of_open», «closing until not asOf plus seven fails», «firstExpiresAt after until fails with closing_window_invalid»,
  «shared_last_week of another week
  fails» y «bullet citing open_offers fails». Falsación: con la comprobación de `count_mismatch` comentada, su test
  falla; se restaura.
  Estado (2026-11-25): verify-group-weekly-brief.ts con los 14 códigos de D6; 17 tests en verde; falsación: con count_mismatch comentado fallan «count different from linkIds fails with count_mismatch»; restaurado.
## 2. Dominio del cálculo en el worker (design D3, D5, D13)

Todo en `group-brief/domain/`, puro, sin `@nestjs/*`, `mongoose` ni `bullmq`.

- [x] 2.1 [backend] `skill-key.ts`: `skillKeyOf(name)` (NFKC, recorte, espacios colapsados, minúsculas; `null` si vacía
  o > 60) y `pickSkillLabel(forms)`. Verificar con `skill-key.spec.ts`: «Docker variants share a key», «empty and
  over-long names are ignored», «label is the most frequent form» y «label tie picks the lowest code unit order».
  Estado (2026-11-25): skill-key.ts con skillKeyOf y pickSkillLabel; 4 escenarios en verde; falsación: desempate invertido hace fallar «label tie picks the lowest code unit order»; restaurado.
- [x] 2.2 [backend] `group-brief-universe.ts` (tipo canónico: id opaco, `sharedAt` y `closedAt` como instantes ISO,
  `expiresAt` `YYYY-MM-DD | null`, habilidades ya validadas) y en `build-group-brief-facts.ts` los hechos `open_offers`
  y `closing_soon` (ventana `[asOf, asOf+7]` con `WEEKLY_PLAN_CLOSING_SOON_DAYS`, PO-9). Verificar con
  `build-group-brief-facts.spec.ts`: «expiresAt before asOf is not open», «closedAt is not open», «closing window
  includes asOf and asOf plus seven», «closing window excludes asOf plus eight», «firstExpiresAt is the earliest
  expiresAt» (R2-2) y «linkIds follow sharedAt desc then id
  desc».
  Estado (2026-11-25): group-brief-universe.ts (UniverseOffer/GroupBriefUniverse sin campos de miembro) y open_offers/closing_soon en build-group-brief-facts.ts; 6 escenarios en verde; falsación: ventana hasta asOf+8 hace fallar «closing window excludes asOf plus eight»; restaurado.
- [x] 2.3 [backend] Depende de 2.1 y 2.2. Hechos `skill_demand`. Verificar en `build-group-brief-facts.spec.ts`:
  «Docker in four of seven offers with skills», «offers without skills are not in total», «a skill listed twice in one
  offer counts once», «a skill in a single offer is not a fact» y «keeps at most five skill facts by count then key».
  Estado (2026-11-25): skill_demand en build-group-brief-facts.ts (clave NFKC, una vez por oferta, total honesto, máx. 5 por count desc y key asc); 5 escenarios + etiqueta en verde; falsación: total = todas las abiertas hace fallar «offers without skills are not in total»; restaurado.
- [x] 2.4 [backend] Depende de 2.2. Hecho `shared_last_week` y `scanTruncated`. Verificar en
  `build-group-brief-facts.spec.ts`: «shared_last_week counts closed offers too», «sharedAt two weeks ago is not
  counted» y «more than 500 relations marks scanTruncated»; y «universe type has no member fields», test de tipos
  (`expectTypeOf`) que falla si el universo gana `userId`, `sharedBy`, `note` o `tags`.
  Estado (2026-11-25): shared_last_week (cuenta cerradas, ventana W−1) y scanTruncated (>500) en build-group-brief-facts.ts; 3 escenarios + expectTypeOf de UniverseOffer en verde; falsación: scanTruncated=false fija hace fallar «more than 500 relations marks scanTruncated» y añadir userId a UniverseOffer rompe worker:typecheck; restaurado.
- [x] 2.5 [backend] `select-group-brief-bullets.ts` (orden de D5, tope 4, como mucho 2 de habilidad, `open_offers`
  fuera). Verificar con `select-group-brief-bullets.spec.ts`: «orders closing, skill, shared, second skill», «caps at
  four bullets», «at most two skill bullets», «only skills yields one bullet», «no facts yields no bullets» y «same
  universe and clock yield identical output»; y «every computed brief passes the verifier», que genera 200 universos
  con un PRNG sembrado y pasa cada resultado por `verifyGroupWeeklyBrief`. Falsación del tope: con
  `GROUP_BRIEF_MAX_BULLETS` a 5 y un tercer `skill_demand` permitido en el test, «caps at four bullets» falla; se
  restaura.
  Estado (2026-11-25): select-group-brief-bullets.ts y compute-group-brief.ts (ensamblado puro del documento del contrato); select-group-brief-bullets.spec.ts en verde (6 de selección, 3 de cálculo con 200 universos sembrados verificados con zod y verifyGroupWeeklyBrief); falsación: con tope 5 y 3 de habilidad fallan «caps at four bullets», «at most two skill bullets» y «every computed brief passes the verifier»; restaurado.
- [x] 2.6 [backend] Guardia de capas. Verificar: `pnpm nx run worker:lint` en verde con `group-brief/domain/**` sin
  `@nestjs/*`, `mongoose` ni `bullmq`. Falsación: añadir `import '@nestjs/common'` en `select-group-brief-bullets.ts`
  hace fallar el lint; se revierte.
  Estado (2026-11-25): worker:lint en verde con group-brief/domain/** sin @nestjs/*, mongoose ni bullmq; falsación: import '@nestjs/common' en select-group-brief-bullets.ts hace fallar el lint (no-restricted-imports de dominio); revertido.

## 3. Persistencia, caso de uso y planificación en el worker (design D1, D2, D4, D7)

- [ ] 3.1 [backend] `group-brief/application/ports/group-brief.ports.ts`: `GROUP_BRIEF_CATALOG`
  (`listGroupIds(afterId, limit)`, `currentBriefsOf(groupIds, weekKey)`, `scanGroupOffers(groupId, limit)`),
  `GROUP_BRIEF_STORE` (`replace(document): Promise<void>` y `clear(groupId, weekKey): Promise<void>`), `GROUP_BRIEF_CLOCK` y `GROUP_BRIEF_ENABLED`; dobles en memoria
  en `application/testing/`. Verificar: `worker:typecheck` en verde y `in-memory-group-brief.store.spec.ts`: «replace
  keeps a single brief per group and week» y «clear removes only that group and week».
- [ ] 3.2 [backend] `infrastructure/persistence/group-weekly-brief.document.ts` (`GroupWeeklyBriefDocument` con
  `ObjectId`, `Date` y `linkIds` string, y `toDocument(brief)` **sin `_id`**, H1 y N3), `group-weekly-brief.schemas.ts` (colección
  `group_weekly_briefs`, índice único `(groupId, weekKey)`, TTL 35 días sobre `computedAt`) y
  `mongo-group-brief.store.ts` (`replaceOne` + `upsert`, una clave duplicada se reintenta una vez sin `upsert`; `clear`
  = `deleteOne({ groupId, weekKey })`).
  Verificar en `mongo-group-brief.store.spec.ts` (replset en memoria): «replace upserts then replaces in place»,
  «concurrent replaces leave one document without error», «computedAt is stored as BSON date», «toDocument has no _id» y «writes the canonical
  EJSON fixture» (lee `libs/shared/src/testing/group-weekly-brief.document.ejson`, sin `_id`, con un `workspaceRoot()`
  compartido con 4.1 y lo compara con `EJSON.parse(texto, { relaxed: false })` y `toEqual`, N6). Falsación: guardar
  `computedAt` como string en `toDocument` hace fallar «computedAt is stored as BSON date»; se restaura.
- [ ] 3.3 [backend] `ensureGroupBriefIndexes()` (`await Model.init()`) llamado antes del primer tick (H3). Verificar en
  `mongo-group-brief.store.spec.ts`: «indexes exist on an empty collection before the first tick» (`listIndexes`, único
  y `expireAfterSeconds` = 3 024 000). Falsación: quitar la llamada hace fallar el test; se restaura.
- [ ] 3.4 [backend] `infrastructure/persistence/mongo-group-brief.catalog.ts`: grupos de 50 en 50 por `_id`, documentos
  de la semana de la página en una lectura, y `scanGroupOffers` (una lectura de `group_links` con proyección `linkId,
  sharedAt`, orden `sharedAt` desc e `_id` desc, límite 501; una de `job_links` con proyección `closedAt,
  preview.expiresAt, preview.skills`, cada habilidad validada con `jobSkillSchema`, H10). Verificar en
  `mongo-group-brief.catalog.spec.ts`: «scan projects only offer fields» (sin `note`, `tags`, `pinned`, `sharedBy` ni
  `knowSomeoneUserIds`), «invalid skill entries are dropped» y «scan makes two reads for 3 and 300 links». Falsación
  del último: un `findOne` por link hace fallar el conteo; se restaura.
- [ ] 3.5 [backend] `application/compute-group-weekly-briefs.usecase.ts`: `execute(now)` → `{ weekKey, groupsScanned,
  upserted, unchanged, cleared, rejected, bulletsByKind }` (PO-1): compara en el espacio del documento (EJSON canónico
  sin `_id` ni `computedAt`, N4) y sobrescribe un guardado ilegible; un día sin viñetas llama a `clear` (N1); un
  rechazo conserva lo guardado y registra `groupId`, `weekKey` y códigos.
  Verificar con `compute-group-weekly-briefs.usecase.spec.ts` (dobles en memoria): «first tick of the week creates the
  brief», «next day recomputes with the new asOf», «same day rerun is unchanged and writes nothing», «unreadable stored
  document is overwritten», «empty day clears the week», «rejected brief keeps the last saved one» (verificador forzado
  a fallar) y «disabled does nothing». Falsación: con el `clear` del día vacío sustituido por un `return`, «empty day
  clears the week» falla; se restaura.
- [ ] 3.6 [backend] Depende de 3.5. Línea de resumen por tick (PO-4). Verificar en
  `compute-group-weekly-briefs.usecase.spec.ts`: «tick summary counts bullets by kind» y «tick summary has no group
  ids» (la línea registrada no contiene ningún id del fixture). Falsación: añadir `groupId` al resumen hace fallar el
  segundo; se revierte.
- [ ] 3.7 [backend] Depende de 3.2-3.5. Prueba de privacidad y de contrato de punta a punta en
  `compute-group-weekly-briefs.int.spec.ts` (replset en memoria, adaptadores Mongo, cliente con `monitorCommands:
  true`, H15): grupo de Ana y Beto con nota, etiqueta, comentario, marca «conozco a alguien» y postulación privada.
  Verificar: la serialización del documento guardado no contiene los ids de Ana ni Beto, sus nombres, la nota, la
  etiqueta ni el comentario; ningún `commandStarted` apunta a `applications`; y «worker document reads back through
  fromDocument» valida contra `groupWeeklyBriefSchema` y `verifyGroupWeeklyBrief`. Falsación: añadir `sharedBy` a la
  proyección de 3.4 hace fallar el test; se revierte.
- [ ] 3.8 [backend] `FEATURE_GROUP_BRIEF` opcional en `worker-config.schema.ts` (`default('true')`, D2, H7) con su
  comentario; `.env.example` gana la línea con un comentario que explica por qué este flag va encendido por defecto, al
  revés que el digest; `apps/worker/src/test-support/test-config.ts` lo fija. Verificar en `load-worker-config.spec.ts`:
  «FEATURE_GROUP_BRIEF defaults to true» y «FEATURE_GROUP_BRIEF false is parsed»; `bash infra/ci/repo-checks.sh` en
  verde (`compose-env-contract` no exige la variable porque es opcional).
- [ ] 3.9a [backend] `infrastructure/scheduling/group-brief.scheduler.ts`: `tick()` con guardia de solapamiento que
  **nunca relanza**. Verificar con `group-brief.scheduler.spec.ts`: «overlapping tick is skipped» y «tick error is
  logged and swallowed». Falsación: relanzar el error en el `catch` hace fallar el segundo; se restaura.
- [ ] 3.9b [backend] Depende de 3.3 y 3.9a. `onApplicationBootstrap`: `await ensureGroupBriefIndexes()` dentro de un
  try/catch (N2: si falla, log y el módulo queda sin cron ni tick) y luego `void scheduler.tick().catch(log)` (H2). Verificar con `group-brief.bootstrap.spec.ts`: «app init resolves while the
  boot tick hangs» (tick que nunca resuelve; `app.init()` resuelve antes de un plazo de 2 s) y «indexes are ensured
  before the boot tick» (orden de llamadas) e «index failure disables the brief without failing boot» (índices forzados
  a fallar: `app.init()` resuelve, se registra el error y ni el cron ni el tick corren). Falsaciones: `await
  scheduler.tick()` hace fallar el primero por plazo; relanzar el error de los índices hace fallar `app.init()` en el
  tercero; se restauran.
- [ ] 3.9c [backend] Depende de 3.9b. Host `@Cron(GROUP_BRIEF_CRON, { timeZone: 'UTC' })` con `GROUP_BRIEF_CRON = '0 5 *
  * *'`, `group-brief.module.ts` con `ScheduleModule.forRoot()` en las mismas condiciones que `NotificationsModule`, y
  registro en el módulo raíz del worker; nada con `NODE_ENV=test` ni con el flag apagado. Verificar con
  `group-brief.module.spec.ts`: «registers no cron in test», «registers no cron when disabled» y «digest and brief
  crons are both registered once» (los dos módulos juntos, `SchedulerRegistry.getCronJobs()`); `worker:test` y
  `worker:lint` en verde.

## 4. Lectura en la api y borrado de grupo (design D8, D11)

- [ ] 4.1 [backend] `links/application/ports/group-weekly-brief-reader.port.ts` (`GROUP_WEEKLY_BRIEF_READER`,
  `findCurrent(groupId, weekKey)`), `InMemoryGroupWeeklyBriefReader` en `application/testing/` y
  `links/infrastructure/mongo-group-weekly-brief.reader.ts` con `fromDocument(doc)` + zod (H1; colección cruda, sin
  `autoIndex`). Verificar en `mongo-group-weekly-brief.reader.spec.ts`: «reads the canonical EJSON fixture written by
  the worker store» (mismo fixture y mismo `workspaceRoot()` que 3.2, `EJSON.parse(..., { relaxed: false })`, N6), «returns invalid for a document that fails the schema» y «malformed group
  id returns null without query».
- [ ] 4.2 [backend] `links/application/get-group-weekly-brief.usecase.ts` (D8: `membershipOf` de la fachada de `groups`,
  H11; `isoWeekKey` con `LINKS_CLOCK`; evaluador; ofertas que siguen en el grupo; `offers`/`moreCount`/`missingCount`; `expiresAt` solo en las ofertas de
  `closing_soon`, R2-2).
  Verificar con `get-group-weekly-brief.usecase.spec.ts`: «member gets the brief with offers», «no brief this week
  returns null even if last week exists», «stranger gets group_not_found», «closing offers carry expiresAt and others do not», «offer removed from the group counts as
  missing», «more than ten offers yields moreCount» y «corrupt document returns null».
- [ ] 4.3 [backend] Depende de 4.2. Lecturas fijas y solo lectura. Verificar en `get-group-weekly-brief.usecase.spec.ts`:
  «same number of reads for 1 bullet and 4 bullets of 40 offers» (contadores en los dobles) y «writes nothing».
  Falsación: resolver las fichas con una lectura por viñeta hace fallar el primero; se restaura.
- [ ] 4.4 [backend] `@Get(':id/weekly-brief')` en `links/presentation/group-links.controller.ts`, respuesta validada
  contra `groupWeeklyBriefResponseSchema`, y proveedores en `links.module.ts`. Verificar con
  `group-weekly-brief.controller.spec.ts`: «200 with brief for a member», «200 with brief null», «404 group_not_found
  for a stranger» y «404 for a malformed id».
- [ ] 4.5a [backend] `links/infrastructure/group-weekly-brief-deletion.hook.ts` (`GroupWeeklyBriefDeletionHook`, H9),
  registrado por `links` en `GroupDeletionHooks`, que borra `group_weekly_briefs` con `{ groupId }` en la misma sesión.
  Verificar en `group-weekly-brief-deletion.spec.ts`: «deleting a group removes its weekly briefs», «other groups keep
  their briefs» y «failing brief cleanup rolls back the whole deletion». Falsación: no registrar el hook hace fallar el
  primero; se restaura.
- [ ] 4.5b [backend] Borrado de cuenta. Verificar en el spec de la cascada de `users`: «account deletion leaves group
  weekly briefs untouched» (Ana, miembro que no es dueña, con la semana de su grupo guardada).

## 5. Seed demo (design D12, spec `platform/demo-seed`)

- [ ] 5.1 [backend] `apps/api/src/seed/demo-seed.dataset.ts` y `seed-demo.runner.ts`: habilidades de D12 en
  `openSalary`, `staleApp` y `closingSoon` por `ensurePreview`. Verificar en `seed-demo.runner.spec.ts`: «demo links
  carry the brief skills» y «second run does not duplicate skills»; y en `compute-group-weekly-briefs.int.spec.ts` (3.7)
  un caso con el mismo universo que el seed: «demo-like group yields closing, docker and typescript bullets in that
  relative order».

## 6. Tarjeta en el SPA (design D9, spec `web/group-weekly-brief`)

- [ ] 6.1 [frontend] `core/groups/group-weekly-brief.api.ts` (valida con `groupWeeklyBriefResponseSchema`) y
  `core/groups/group-weekly-brief.store.ts` (`@ngrx/signals`: `loading | ready | error`, `load(groupId)`, `retry()`).
  Verificar con `group-weekly-brief.api.spec.ts` y `group-weekly-brief.store.spec.ts`: «parses a brief», «invalid
  payload is an error», «retry after error loads the brief».
  Estado (2026-11-25): api (zod `parse`) y store `root` con `load`/`retry` y guarda de última petición; 8 tests en verde (api 3, store 5) con el fixture compartido `testing/group-brief-testing.ts`; falsación: devolver el cuerpo sin `parse` hace fallar «invalid payload is an error» en api y store; restaurado.
- [ ] 6.2 [frontend] `features/groups/group-weekly-brief-text.ts`: `groupBriefBulletText(fact, locale)`,
  `groupBriefHeaderText(...)` («Actualizada el …») y `formatUtcDate(date, locale)`, un mensaje `$localize` por
  variante (ids `@@groups.weeklyBrief.*`). Verificar con `group-weekly-brief-text.spec.ts` (ES): «skill bullet text»,
  «closing singular names the date, plural names the first date» (R2-2), «shared last week singular and plural» y «header with one open offer».
- [ ] 6.3 [frontend] `features/groups/group-weekly-brief-card.component.*`: cabecera, viñetas, pie, carga
  (`aria-busy`), vacío y error con «Reintentar». Verificar con `group-weekly-brief-card.component.spec.ts`: «fixture
  satisfies the response contract» (`groupWeeklyBriefResponseSchema.parse` sobre el fixture del test, H15), «shows
  three bullets and the header», «empty state text», «error state with retry» y «shows no member names or statuses».
- [ ] 6.4 [frontend] Desplegable de ofertas: «Ver ofertas (N)» / «Ocultar ofertas», `aria-expanded`/`aria-controls`,
  `min-h-11`, enlaces con `target="_blank"` y `rel="noopener noreferrer"`, `moreCount` y `missingCount`. Verificar en
  `group-weekly-brief-card.component.spec.ts`: «expands two offers as external links», «shows more and missing lines»,
  «no toggle when every offer left the group», «closing offers show their own date» (R2-2) y «toggle has min height
  class».
- [ ] 6.5 [frontend] Integración en `features/groups/group-detail.page.{ts,html}` encima de `<lv-link-list>`. Verificar
  en `group-detail.page.spec.ts`: «renders the weekly brief above the link list» y «brief error does not block the link
  list or saving».
- [ ] 6.6 [frontend] `pnpm nx run web:extract-i18n` y traducciones EN de D9 en `messages.en.xlf`. Verificar:
  `pnpm nx run web:i18n-check` en verde y un `describe` EN en `group-weekly-brief-text.spec.ts` que carga
  `messages.en.xlf` con `loadTranslations` y afirma «Docker appears in 4 of the 7 open offers with detected skills.», «3 offers
  were shared in the group last week.», «There is nothing to summarize for this week yet.», «2 offers close soon; the first on Thursday, November 26.» y
  «Updated on Monday, November 23 · 7 open
  offers».

## 7. End-to-end (perfil `local`)

- [ ] 7.1a [frontend] `apps/web-e2e/src/group-weekly-brief.spec.ts`, escritorio: la prueba crea su grupo y sus links
  por la API y escribe en Mongo el documento de la semana en curso con `replaceOne` + `upsert` (así no choca con un
  tick del worker que ya lo haya creado), sin usar `api:seed-demo` (D5 de `e2e-suite`). `apps/web-e2e/e2e.env` gana `FEATURE_GROUP_BRIEF=false` para que el
  worker del perfil local no recalcule ni borre el documento sembrado (N5; configuración de la suite, no un workflow de
  CI). Verificar: la tarjeta muestra
  la cabecera «Actualizada el …» y las viñetas, y «Ver ofertas (2)» despliega dos enlaces externos.
- [ ] 7.1b [frontend] Depende de 7.1a. Mismo spec en móvil emulado y estado vacío. Verificar: el botón «Ver ofertas»
  mide al menos 44 px y la tarjeta está encima del listado; en otro grupo sin documento se ve «Todavía no hay novedades
  para resumir esta semana.».

## 8. Documentación y cierre

- [ ] 8.1 [infra] `docs/RUNBOOK.md`: sección «La semana del grupo» con la colección, sus dos índices (creados al
  arrancar), el TTL, el tick (05:00 UTC y al arrancar, recálculo diario), `FEATURE_GROUP_BRIEF` y por qué en staging
  vale su valor por defecto, cómo leer y sumar por semana la línea de resumen del tick (PO-4), la consulta agregada de
  la métrica 1 (sin `groupId` en el resultado) y la de `scanTruncated`, que cambiar el TTL exige `collMod` porque `createIndexes` no modifica un índice existente (N2), qué significa
  `cleared` y que un rechazo conserva la versión anterior, cómo forzar un recálculo en local (reiniciar el
  worker, también tras `api:seed-demo`), el rollback y la nota para la invitación de 35b: mencionar la tarjeta y
  preguntar a las 2 semanas «¿La viste?» (PO-3). Verificar: `bash infra/ci/repo-checks.sh` en verde (`docs-stack-up`
  incluido).
- [ ] 8.2 [infra] Cierre. Verificar: `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde, `bash
  infra/ci/repo-checks.sh` en verde y `openspec validate group-weekly-brief --strict --no-interactive` en verde.
- [ ] 8.3 [infra] **Diferida: depende de 35b (`staging-host`); no bloquea el cierre de este change** (PO-5). Antes de
  invitar en 35b, medir en staging la cobertura de `preview.skills` sobre las ofertas abiertas de los grupos (consulta
  del RUNBOOK). Verificar: la cobertura queda anotada en el informe de 35b. Si es ≥ 50 %, nada más; si no llega, **se invita
  igual** (R2-4) y el informe de 35b reporta la viñeta de habilidades por separado del resto en la métrica 1.
