## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los títulos de test van en inglés y salen de los escenarios de `specs/`. Rutas de
`apps/api` relativas a `apps/api/src/modules/` y de `apps/worker` relativas a `apps/worker/src/modules/`, salvo que se
diga otra cosa.

- [ ] 0.1 [infra] Debate critic/business/reflect de este change cerrado sin P0/V0 abiertos. Verificar: `design.md`
  lleva la sección `## Debate iteración N (fecha)` de la última iteración con «Convergencia: SI», P0 0 y V0 0, y las
  decisiones no triviales nuevas están en ADR-069.
- [ ] 0.2 [infra] Aprobación humana registrada y Q1-Q4 respondidas o aceptadas con su recomendación. Verificar: la
  sección `## Aprobación humana` de design tiene fecha, cita literal del owner y alcance (apply en la rama, **no** la
  fusión). Falsación: si dijera que autoriza fusionar sin ventana, el revisor la rechaza.
- [ ] 0.3 [infra] Plan y ADR coherentes. Verificar: `docs/design-v0.2.md` §6 tiene la fila `group-weekly-brief` como
  **Candidata**; `grep -c "group-weekly-brief" openspec-changes.yaml` = 0; `docs/adr/ADR-069.md` existe; `bash
  infra/ci/repo-checks.sh` y `openspec validate group-weekly-brief --strict --no-interactive` en verde.

## 1. Contrato y semana ISO en `libs/shared` (design D6, D7, D10)

- [ ] 1.1 [backend] `libs/shared/src/time/iso-week.ts` con `startOfIsoWeekUtc`, `isoWeekKey`, `previousWeekKey`,
  `nextWeekKey`, `startOfWeekKeyUtc`, `windowForWeekKey` y `previousClosedIsoWeek`, movidas de
  `worker/notifications/domain/iso-week.ts` y `api/applications/domain/weekly-plan/week-key.ts`, exportadas desde
  `libs/shared/src/index.ts`. Verificar con `iso-week.spec.ts`, que reúne los vectores de las dos copias: «2026-12-31T23:30Z
  is 2026-W53», «2027-01-03 is 2026-W53», «2027-01-04 is 2027-W01», «previous of 2027-W01 is 2026-W53», «next of
  2026-W53 is 2027-W01», «Monday 00:00Z starts a new week» y «window of 2026-W48 is Nov 23 to Nov 30».
- [ ] 1.2 [backend] Depende de 1.1. El worker (`notifications`: digest, scheduler y sus specs) importa de
  `@linkvault/shared` y se borra `notifications/domain/iso-week.ts` con su spec. Verificar: `pnpm nx run worker:test`
  y `worker:typecheck` en verde; `grep -rn "function isoWeekKey" apps/worker` sin resultados.
- [ ] 1.3 [backend] Depende de 1.1. `applications` (weekly-plan) importa de `@linkvault/shared` y se borra
  `applications/domain/weekly-plan/week-key.ts` con su spec. Verificar: `pnpm nx run api:test` de `weekly-plan` y
  `api:lint` en verde (el dominio puede importar `@linkvault/shared`); `grep -rn "function isoWeekKey" apps/api` sin
  resultados.
- [ ] 1.4 [backend] `libs/shared/src/schemas/group-weekly-brief.schema.ts` con las constantes y schemas de D7, exportado
  desde el índice. Verificar con `group-weekly-brief.schema.spec.ts`: «accepts a brief with one fact of each kind»,
  «rejects six bullets», «rejects a skill fact with count 1», «rejects a member id field in a fact» (campo extra,
  `strictObject`), «rejects a malformed linkId» y «response accepts brief null».
- [ ] 1.5 [backend] `libs/shared/src/group-weekly-brief/verify-group-weekly-brief.ts` (función pura, D6) con códigos de
  violación (`duplicate_fact_id`, `open_offers_missing`, `fact_id_kind_mismatch`, `bullet_fact_missing`,
  `bullet_cites_open_offers`, `duplicate_bullet`, `too_many_bullets`, `too_many_skill_bullets`, `count_mismatch`,
  `duplicate_link_id`, `not_subset_of_open`, `skill_total_invalid`, `closing_window_invalid`, `previous_week_invalid`).
  Verificar con `verify-group-weekly-brief.spec.ts`: «valid brief passes», «bullet citing a missing fact fails with
  bullet_fact_missing», «count different from linkIds fails with count_mismatch», «skill link outside open offers fails
  with not_subset_of_open», «closing until not asOf plus six fails», «shared_last_week of another week fails» y
  «bullet citing open_offers fails». Falsación: con la comprobación de `count_mismatch` comentada, su test falla; se
  restaura.

## 2. Dominio del cálculo en el worker (design D3, D5, D13)

Todo en `group-brief/domain/`, puro, sin `@nestjs/*`, `mongoose` ni `bullmq`.

- [ ] 2.1 [backend] `skill-key.ts`: `skillKeyOf(name)` (NFKC, recorte, espacios colapsados, minúsculas; `null` si vacía
  o > 60) y `pickSkillLabel(forms)`. Verificar con `skill-key.spec.ts`: «Docker variants share a key», «empty and
  over-long names are ignored», «label is the most frequent form» y «label tie picks the lowest code unit order».
- [ ] 2.2 [backend] `group-brief-universe.ts` (tipo canónico: id opaco, `sharedAt` y `closedAt` como instantes ISO,
  `expiresAt` `YYYY-MM-DD | null`, habilidades) y en `build-group-brief-facts.ts` los hechos `open_offers` y
  `closing_soon`. Verificar con `build-group-brief-facts.spec.ts`: «expiresAt before asOf is not open», «closedAt is
  not open», «closing window includes asOf and asOf plus six», «closing window excludes asOf plus seven» y «linkIds
  follow sharedAt desc then id desc».
- [ ] 2.3 [backend] Depende de 2.1 y 2.2. Hechos `skill_demand`. Verificar en `build-group-brief-facts.spec.ts`:
  «Docker in four of seven offers with skills», «offers without skills are not in total», «a skill listed twice in one
  offer counts once», «a skill in a single offer is not a fact» y «keeps at most five skill facts by count then key».
- [ ] 2.4 [backend] Depende de 2.2. Hechos `shared_last_week` y `closed_last_week` y `scanTruncated`. Verificar en
  `build-group-brief-facts.spec.ts`: «shared_last_week counts closed offers too», «sharedAt two weeks ago is not
  counted», «closed_last_week uses closedAt in the previous ISO week» y «more than 500 relations marks scanTruncated».
  Además, «universe type has no member fields»: test de tipos (`expectTypeOf`) que falla si el universo gana `userId`,
  `sharedBy`, `note` o `tags`.
- [ ] 2.5 [backend] `select-group-brief-bullets.ts` (orden de D5, tope 5, como mucho 2 de habilidad, `open_offers`
  fuera). Verificar con `select-group-brief-bullets.spec.ts`: «orders closing, skill, shared, closed, second skill»,
  «caps at five bullets», «at most two skill bullets», «only skills yields one bullet», «no facts yields no bullets» y
  «same universe and clock yield identical output»; y «every computed brief passes the verifier», que genera 200
  universos con un PRNG sembrado y pasa cada resultado por `verifyGroupWeeklyBrief`. Falsación del tope: con
  `GROUP_BRIEF_MAX_BULLETS` a 6 en el test, «caps at five bullets» falla; se restaura.
- [ ] 2.6 [backend] Guardia de capas. Verificar: `pnpm nx run worker:lint` en verde con `group-brief/domain/**` sin
  `@nestjs/*`, `mongoose` ni `bullmq`. Falsación: añadir `import '@nestjs/common'` en `select-group-brief-bullets.ts`
  hace fallar el lint; se revierte.

## 3. Persistencia, caso de uso y planificación en el worker (design D1, D2, D4)

- [ ] 3.1 [backend] `group-brief/application/ports/group-brief.ports.ts`: `GROUP_BRIEF_CATALOG`
  (`listGroupsWithoutBrief(weekKey, afterId, limit)`, `scanGroupOffers(groupId, limit)`), `GROUP_BRIEF_STORE`
  (`insertIfAbsent(brief): 'inserted' | 'exists'`), `GROUP_BRIEF_CLOCK` y `GROUP_BRIEF_ENABLED`; dobles en memoria en
  `application/testing/`. Verificar: `worker:typecheck` en verde y `in-memory-group-brief.store.spec.ts`: «second
  insert of the same key returns exists».
- [ ] 3.2 [backend] `infrastructure/persistence/group-weekly-brief.schemas.ts` (colección `group_weekly_briefs`, índice
  único `(groupId, weekKey)`, TTL 35 días sobre `computedAt`, `autoIndex`) y `mongo-group-brief.store.ts`. Verificar en
  `mongo-group-brief.store.spec.ts` (replset en memoria): «insertIfAbsent inserts once», «duplicate key returns exists
  without throwing» y «declares the unique and TTL indexes» (`listIndexes`, `expireAfterSeconds` = 3 024 000).
- [ ] 3.3 [backend] `infrastructure/persistence/mongo-group-brief.catalog.ts`: grupos de 50 en 50 por `_id` sin
  documento de la semana (una lectura de grupos y una de `group_weekly_briefs` por página) y `scanGroupOffers` (una
  lectura de `group_links` con proyección `linkId, sharedAt`, orden `sharedAt` desc e `_id` desc, límite 501; una de
  `job_links` con proyección `closedAt, preview.expiresAt, preview.skills`). Verificar en
  `mongo-group-brief.catalog.spec.ts`: «lists only groups without a brief for the week», «scan projects only offer
  fields» (el documento leído no trae `note`, `tags`, `pinned`, `sharedBy` ni `knowSomeoneUserIds`) y «scan makes two
  reads for 3 and 300 links». Falsación del último: un `findOne` por link hace fallar el conteo; se restaura.
- [ ] 3.4 [backend] `application/compute-group-weekly-briefs.usecase.ts`: `execute(now)` → `{ groupsScanned, inserted,
  existing, empty, rejected }`; verifica con `verifyGroupWeeklyBrief` antes de insertar y registra solo `groupId`,
  `weekKey` y códigos. Verificar con `compute-group-weekly-briefs.usecase.spec.ts` (dobles en memoria): «computes the
  current week for groups without brief», «second run in the same week changes nothing», «group without bullets is not
  stored and is retried next day», «brief rejected by the verifier is not stored» (verificador forzado a fallar),
  «disabled does nothing» y «log line carries no titles or skills».
- [ ] 3.5 [backend] Depende de 3.2-3.4. Prueba de privacidad de punta a punta en
  `compute-group-weekly-briefs.int.spec.ts` (replset en memoria, adaptadores Mongo): grupo de Ana y Beto con nota,
  etiqueta, comentario, marca «conozco a alguien» y postulación privada (escenario «Nada de los miembros en el
  documento»). Verificar: la serialización del documento guardado no contiene los ids de Ana ni Beto, sus nombres, la
  nota, la etiqueta ni el comentario; un espía sobre `connection.collection` comprueba que nunca se pidió
  `applications`. Falsación: añadir `sharedBy` a la proyección de 3.3 hace fallar el test; se revierte.
- [ ] 3.6 [backend] `FEATURE_GROUP_BRIEF` opcional en `worker-config.schema.ts` (`default('true')`, D2, Q1) con su
  comentario. Verificar en `load-worker-config.spec.ts`: «FEATURE_GROUP_BRIEF defaults to true» y «FEATURE_GROUP_BRIEF
  false is parsed»; `bash infra/ci/repo-checks.sh` en verde (`compose-env-contract` no exige la variable porque es
  opcional).
- [ ] 3.7 [backend] `infrastructure/scheduling/group-brief.scheduler.ts` (`tick()` con guardia de solapamiento y
  captura de errores), host `@Cron(GROUP_BRIEF_CRON, { timeZone: 'UTC' })` con `GROUP_BRIEF_CRON = '0 5 * * *'`, tick
  en `onApplicationBootstrap`, y `group-brief.module.ts` registrado en el módulo raíz del worker; nada de eso con
  `NODE_ENV=test` ni con el flag apagado. Verificar con `group-brief.module.spec.ts`: «registers no cron in test»,
  «registers no cron when disabled», «overlapping tick is skipped» y «tick error is logged and swallowed»; `worker:test`
  y `worker:lint` en verde.

## 4. Lectura en la api y borrado de grupo (design D8, D11)

- [ ] 4.1 [backend] `links/application/ports/group-weekly-brief-reader.port.ts` (`GROUP_WEEKLY_BRIEF_READER`,
  `findOne(groupId, weekKey): Promise<unknown | null>`), `InMemoryGroupWeeklyBriefReader` en `application/testing/` y
  `links/infrastructure/mongo-group-weekly-brief.reader.ts` (colección cruda, sin `autoIndex`). Verificar en
  `mongo-group-weekly-brief.reader.spec.ts`: «returns the document of the week» y «malformed group id returns null
  without query».
- [ ] 4.2 [backend] `links/application/get-group-weekly-brief.usecase.ts` (D8: pertenencia, `isoWeekKey` con
  `LINKS_CLOCK`, zod y verificador, ofertas que siguen en el grupo, `offers`/`moreCount`/`missingCount`). Verificar con
  `get-group-weekly-brief.usecase.spec.ts`: «member gets the brief with offers», «no brief this week returns null even
  if last week exists», «stranger gets group_not_found», «offer removed from the group counts as missing», «more than
  ten offers yields moreCount» y «corrupt document returns null».
- [ ] 4.3 [backend] Depende de 4.2. Lecturas fijas y solo lectura. Verificar en `get-group-weekly-brief.usecase.spec.ts`:
  «same number of reads for 1 bullet and 5 bullets of 40 offers» (contadores en los dobles) y «writes nothing» (los
  dobles de escritura no reciben llamadas). Falsación: resolver las fichas con una lectura por viñeta hace fallar el
  primero; se restaura.
- [ ] 4.4 [backend] `@Get(':id/weekly-brief')` en `links/presentation/group-links.controller.ts`, respuesta validada
  contra `groupWeeklyBriefResponseSchema`, y proveedores en `links.module.ts`. Verificar con
  `group-weekly-brief.controller.spec.ts`: «200 with brief for a member», «200 with brief null», «404 group_not_found
  for a stranger» y «404 for a malformed id».
- [ ] 4.5 [backend] `links/infrastructure/group-links-deletion.hook.ts` borra `group_weekly_briefs` con `{ groupId }`
  en la misma sesión. Verificar en `group-links-deletion.spec.ts`: «deleting a group removes its weekly briefs», «other
  groups keep their briefs» y «failing brief cleanup rolls back the whole deletion». Y en el spec de borrado de cuenta:
  «account deletion leaves group weekly briefs untouched».

## 5. Seed demo (design D12, spec `platform/demo-seed`)

- [ ] 5.1 [backend] `apps/api/src/seed/demo-seed.dataset.ts` y `seed-demo.runner.ts`: habilidades de D12 en
  `openSalary`, `staleApp` y `closingSoon` por `ensurePreview`. Verificar en `seed-demo.runner.spec.ts`: «demo links
  carry the brief skills» y «second run does not duplicate skills»; y en `compute-group-weekly-briefs.int.spec.ts` (3.5)
  un caso con el mismo universo que el seed: «demo-like group yields closing, docker and typescript bullets».

## 6. Tarjeta en el SPA (design D9, spec `web/group-weekly-brief`)

- [ ] 6.1 [frontend] `core/groups/group-weekly-brief.api.ts` (valida con `groupWeeklyBriefResponseSchema`) y
  `core/groups/group-weekly-brief.store.ts` (`@ngrx/signals`: `loading | ready | error`, `load(groupId)`, `retry()`).
  Verificar con `group-weekly-brief.api.spec.ts` y `group-weekly-brief.store.spec.ts`: «parses a brief», «invalid
  payload is an error», «retry after error loads the brief».
- [ ] 6.2 [frontend] `features/groups/group-weekly-brief-text.ts`: `groupBriefBulletText(fact, locale)`,
  `groupBriefHeaderText(...)` y `formatUtcDate(date, locale)`, un mensaje `$localize` por variante (ids
  `@@groups.weeklyBrief.*`). Verificar con `group-weekly-brief-text.spec.ts` (ES): «skill bullet text», «closing
  singular and plural with long date», «shared and closed last week singular and plural», «header with one open
  offer» y «header with scanTruncated».
- [ ] 6.3 [frontend] `features/groups/group-weekly-brief-card.component.*`: cabecera, viñetas, pie, carga
  (`aria-busy`), vacío y error con «Reintentar». Verificar con `group-weekly-brief-card.component.spec.ts`: «shows three
  bullets and the header», «empty state text», «error state with retry» y «shows no member names or statuses» (el DOM
  no contiene los `displayName` del fixture del grupo).
- [ ] 6.4 [frontend] Desplegable de ofertas: «Ver ofertas (N)» / «Ocultar ofertas», `aria-expanded`/`aria-controls`,
  `min-h-11`, enlaces con `target="_blank"` y `rel="noopener noreferrer"`, `moreCount` y `missingCount`. Verificar en
  `group-weekly-brief-card.component.spec.ts`: «expands two offers as external links», «shows more and missing lines»,
  «no toggle when every offer left the group» y «toggle has min height class».
- [ ] 6.5 [frontend] Integración en `features/groups/group-detail.page.{ts,html}` encima de `<lv-link-list>`. Verificar
  en `group-detail.page.spec.ts`: «renders the weekly brief above the link list» y «brief error does not block the link
  list or saving».
- [ ] 6.6 [frontend] `pnpm nx run web:extract-i18n` y traducciones EN de D9 en `messages.en.xlf`. Verificar:
  `pnpm nx run web:i18n-check` en verde y un `describe` EN en `group-weekly-brief-text.spec.ts` que carga
  `messages.en.xlf` con `loadTranslations` y afirma «4 of 7 offers with known requirements mention Docker.», «3 new
  offers last week.», «1 offer closed last week.» y «Calculated on Monday, November 23 · 7 open offers».

## 7. End-to-end (perfil `local`)

- [ ] 7.1 [frontend] `apps/web-e2e/src/group-weekly-brief.spec.ts`: la prueba crea su grupo y sus links por la API y
  escribe en Mongo el documento de la semana en curso (como `links.spec.ts` escribe fechas), sin usar `api:seed-demo`
  (D5 de `e2e-suite`). Verificar en escritorio y móvil emulado: la tarjeta muestra la cabecera y las viñetas, «Ver
  ofertas (2)» despliega dos enlaces externos, el botón mide al menos 44 px, y con `brief` `null` (otro grupo) se ve el
  vacío.

## 8. Documentación y cierre

- [ ] 8.1 [infra] `docs/RUNBOOK.md`: sección «La semana del grupo» con la colección, sus dos índices, el TTL, el tick
  (05:00 UTC y al arrancar), `FEATURE_GROUP_BRIEF` y por qué en staging vale su valor por defecto, cómo recalcular una
  semana en local (borrar su documento y reiniciar el worker; también tras `api:seed-demo`), el rollback y las
  consultas agregadas de la métrica 1 (sin `groupId` en el resultado). Verificar: `bash infra/ci/repo-checks.sh` en
  verde (`docs-stack-up` incluido).
- [ ] 8.2 [infra] Cierre. Verificar: `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde, `bash
  infra/ci/repo-checks.sh` en verde y `openspec validate group-weekly-brief --strict --no-interactive` en verde.
