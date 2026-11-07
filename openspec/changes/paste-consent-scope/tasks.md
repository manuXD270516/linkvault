## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos de los casos de test que el
implementador crea (ver la tabla «Casos de prueba derivados de los escenarios» de `design.md`). Ninguna prueba llama a
un proveedor real: `AI_CHAIN=mock` y `AI_MOCK_MODE=replay` en CI.

- [ ] 0.1 [infra] Q1 respondida por el owner y anotada con fecha:
  - en ADR-063 §1, en una línea que empiece por «Respuesta del owner (Q1), AAAA-MM-DD:»;
  - en `design.md` (Open Questions);
  - y, si la respuesta es (b), con una línea en ADR-048 §Consecuencias, como hicieron ADR-053, ADR-055 y ADR-060, y con
    la fila «∥ 35b» del change en `docs/design-v0.2.md` §6.

  Con (a), el change no pasa de aquí hasta archivar 35c (`verify-reusable-workflow`). Verificar:
  `grep -cE "Respuesta del owner \(Q1\), 20[0-9]{2}-" docs/adr/ADR-063.md` devuelve `1` (antes de anotarla, `0`).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada, con las
  respuestas de Q2, Q3, Q4 y Q5 (o su recomendación tomada por defecto, anotada como tal) y, **en una línea propia que
  confirma el owner (Q6, B3)**, esta frase literal con su fecha: «Acepto que los nombres de terceros de lo pegado
  lleguen sin redactar a OpenRouter con `data_collection: deny`». La Q7 de `paste-fallback-honest` no vale como esa
  confirmación. Verificar: `design.md` lleva la sección del debate de la última iteración, con «Convergencia: SI», y
  una sección «Aprobación humana (AAAA-MM-DD)»: `grep -n "^Convergencia: SI\|^## Aprobación humana"
  openspec/changes/paste-consent-scope/design.md` devuelve las dos líneas, y `grep -c "Acepto que los nombres de
  terceros de lo pegado lleguen sin redactar" docs/adr/ADR-063.md` devuelve `1`, en la línea fechada de §Riesgos
  aceptados. Falsación: sin esa línea, o si el owner la rechaza, el change no pasa de aquí y vuelve al debate (Q6).
- [ ] 0.3 [infra] `paste-fallback-honest` está fusionado en `main` y la rama de aplicación se corta de `main` después
  de esa fusión (design D9). Verificar: `git log --oneline --merges origin/main | grep -i "paste-fallback-honest"`
  devuelve su merge, y `git merge-base --is-ancestor <sha de ese merge> HEAD` sale con `0`. Falsación: desde una rama
  cortada antes del merge, el mismo comando sale con `1`, y el change no se aplica.
- [ ] 0.4 [infra] Si la Q2 se respondió con la (b), corregir antes de aplicar D5 de `design.md`, ADR-063 §2 y §4 y los
  deltas de `ai/provider-routing` y `links/pasted-description` (el filtro de no recolección pasa a aplicarse solo sin
  consentimiento), y volver a validar. Con la (a) o sin respuesta, nada. Verificar: `node
  D:/projects/linkvault/node_modules/@fission-ai/openspec/bin/openspec.js validate paste-consent-scope --strict
  --no-interactive` en verde y la respuesta de Q2 anotada en `design.md`.

## 1. `libs/ai`: sensibilidad `incidental` (design D2-D5, D8)

- [ ] 1.1 [ai] `domain/task.ts`: `DataSensitivity = 'personal' | 'incidental' | 'public'` (por defecto `personal`) y los
  tres predicados de D3: `requiresExternalConsent`, `treatsInputAsPersonal` y `requiresNoDataCollection`, sobre
  `dataSensitivityOf(task)`. Los tres leen una sola tabla `SENSITIVITY_RULES = { … } as const satisfies
  Record<DataSensitivity, SensitivityRules>` (C1), sin ramas por valor. Exportarlos desde `src/index.ts` junto a
  `DataSensitivity`. Verificar con `domain/task.spec.ts` (nuevo): «personal, incidental and public map to their rules»
  (la tabla de D3 entera) y «a task without sensitivity is personal for every predicate». `pnpm nx run ai:test --
  task.spec` y `pnpm nx run ai:typecheck` en verde. Falsación: añadir `'other'` a `DataSensitivity` sin su fila y ver
  fallar `ai:typecheck`; restaurar.
- [ ] 1.2 [ai] Sustituir las comparaciones sueltas del camino de ejecución por los predicados, sin cambiar el
  comportamiento de `personal` ni de `public`: `routing-policy.ts` (`:75`, `:111`), `run-task.usecase.ts` (`:479`,
  `:679`) y `task-registry.ts` (`:53`, mensaje «a personal or incidental task cannot be cacheable»). Verificar:
  `pnpm nx run ai:test -- routing-policy.spec run-task.usecase.spec task-registry.spec` en verde sin tocar ningún
  test existente, y «Tarea incidental declarada cacheable» nuevo en `task-registry.spec.ts`.
- [ ] 1.3 [ai] Lo mismo en `evals/recording/record-fixtures.ts` (`:83`, `:136`) y `audit-personal-fixtures.ts`
  (`:41`), que hoy leen el campo crudo (D3). El rechazo nombra la sensibilidad efectiva. Verificar con
  `record-fixtures.spec.ts`: «an incidental task cannot be recorded against a real upstream», y con
  `audit-personal-fixtures.spec.ts`: «the audit also checks incidental tasks» (un fixture `recorded:openrouter:…` de
  una tarea `incidental` da un problema que nombra tarea y fichero). `pnpm nx run ai:test -- record-fixtures.spec
  audit-personal-fixtures.spec` en verde.
- [ ] 1.4 [ai] Guardia de D3 (C1): `domain/task-sensitivity.guard.spec.ts` recorre los `.ts` de `libs/ai/src` que no
  son `*.spec.ts` y falla nombrando fichero y línea si, fuera de `domain/task.ts`, encuentra un literal `'personal'`,
  `'incidental'` o `'public'` (comillas simples o dobles) o el identificador `DEFAULT_DATA_SENSITIVITY`. La única
  excepción es la propiedad `dataSensitivity: '…'` de `tasks/*.task.ts`. Casos: «no sensitivity literal outside
  domain/task.ts» y «no file outside domain/task.ts compares data sensitivity». Verificar: `pnpm nx run ai:test --
  task-sensitivity.guard` en verde. Falsaciones, restaurando cada una:
  - `task.dataSensitivity === 'personal'` en `record-fixtures.ts`: el test falla nombrando
    `evals/recording/record-fixtures.ts` y la línea;
  - `const s = dataSensitivityOf(task); if (s !== 'personal') …` en `run-task.usecase.ts` (comparación sobre una
    variable local): falla nombrando `application/run-task.usecase.ts`;
  - `switch (dataSensitivityOf(task)) { case 'incidental': … }` en `task-registry.ts`: falla nombrando
    `application/task-registry.ts`.
- [ ] 1.5 [ai] `domain/ports/llm-provider.port.ts`: `dataCollectionDenied?: boolean` en `ProviderCapabilities`,
  documentado como dato de política con la definición de C5 (cada petición restringe el enrutamiento a servicios que
  declaran no recolectar ni conservar los datos); `satisfies()` no lo mira. `AiTask.requires` pasa a
  `Partial<Pick<ProviderCapabilities, 'jsonMode' | 'toolUse' | 'maxContextTokens'>>` (C9), y lo mismo en `ChainRequest`
  y `ProviderEligibility` si repiten el tipo. `OpenRouterProvider` declara `dataCollectionDenied: this.dataCollection
  === 'deny'`. Verificar con `openrouter.provider.spec.ts`: «deny declares dataCollectionDenied» y «omit does not declare
  dataCollectionDenied»; con `byok-provider.factory.spec.ts`: «BYOK vendors declare dataCollectionDenied only for
  OpenRouter :free» (OpenRouter `:free` sí; OpenRouter de pago, OpenAI y Anthropic no). `pnpm nx run ai:test --
  openrouter.provider.spec byok-provider.factory.spec` y `pnpm nx run ai:typecheck` en verde. Falsación: poner
  `requires: { external: true }` en una tarea y ver fallar `ai:typecheck`; restaurar.
- [ ] 1.6 [ai] `selectEligible` aplica el filtro de D5: con `requiresNoDataCollection`, descarta todo externo sin
  `dataCollectionDenied`, con o sin consentimiento, también en la cadena hipotética. Verificar con
  `routing-policy.spec.ts`: «Tarea incidental sin consentimiento», «Tarea incidental: el externo que no pide no
  recolectar queda fuera aun con permiso», «Tarea incidental cuyo único externo no pide no recolectar» (cadena vacía,
  `consentWouldEnable` `false`), «consentWouldEnable is false for an incidental task» y «a provider that does not
  declare dataCollectionDenied is treated as not denying». Más el invariante de C8, «an incidental chain does not
  depend on consent»: con una tarea `incidental`, `buildChain` devuelve los mismos ids, en el mismo orden, con el
  permiso en `true` y en `false`, recorriendo **todos los universos de los escenarios del spec** de `ai/provider-routing`
  (local solo, externo con y sin `dataCollectionDenied`, BYOK, circuito abierto, capacidades insuficientes). `pnpm nx
  run ai:test -- routing-policy.spec` en verde. Falsaciones, restaurando cada una: quitar la condición
  `requiresNoDataCollection` del filtro y ver caer el segundo, el tercero y el invariante; aplicar a `incidental` el
  filtro del permiso y ver caer «Tarea incidental sin consentimiento» y el invariante.
- [ ] 1.7 [ai] `runTask` con una tarea `incidental` (sin cambios de código si 1.2 y 1.6 están bien; esta tarea los
  prueba juntos). Verificar con `run-task.usecase.spec.ts`: «incidental task reaches a no-data-collection external
  provider without consent, redacted» (el `user` enviado lleva `[EMAIL_1]` y no el email), «an incidental task without
  fixture is logged without its input» e «incidental task with only non-denying external providers degrades
  no_providers without condition» (sin `providerCondition`, sin `consentWouldEnable`). `pnpm nx run ai:test --
  run-task.usecase.spec` en verde. Falsación: devolver la rama de redacción de `attempt` a `requiresExternalConsent` y
  ver caer el primero; restaurar.
- [ ] 1.8 [ai] `tasks/extract-pasted-job.task.ts`: `dataSensitivity: 'incidental'`, `cacheable: false`, mismo prompt
  `v1`; el comentario de cabecera cita ADR-063 en lugar de «Por eso es `personal` (ADR-018 §11)». En
  `extract-pasted-job.task.spec.ts`: el contrato pasa a `incidental`; «Sin consentimiento, sin proveedor externo» y «Con
  consentimiento, el proveedor externo es elegible» conservan su título y cambian como sus escenarios de
  `links/pasted-description` (el externo del primero no declara `dataCollectionDenied`, el del segundo sí), y se añaden
  «Sin consentimiento, el externo que pide no recolectar lee lo pegado» (redactado), «Ni con consentimiento va a un
  externo que no pide no recolectar», «Solo
  externos que no piden no recolectar: no_providers sin condición» y «Sin consentimiento, el pegado nunca degrada por
  falta de permiso». `pnpm nx run ai:test -- extract-pasted-job` en verde. Falsación: volver a `personal` y ver caer el
  primero y el último; restaurar.
- [ ] 1.9 [ai] Comprobación de no regresión del eval (D8), sin `--update-baseline`: `pnpm nx run ai:eval-ci` con salida
  0, y `git status --porcelain` limpio después. Si sale distinto, no se actualiza la línea base: se para y se vuelve al
  debate (D8).

## 2. API: el pegado ya no depende del permiso (design D6)

- [ ] 2.1 [backend] `run-task-pasted-extraction.ts`: la viñeta «Consentimiento de quien pega» del comentario de
  cabecera («lo pegado es un dato personal suyo y la tarea es `personal`…») se reescribe con el motivo real (C10, D6):
  `RunContext` exige el dato, se pasa el del perfil para no inventarlo (ADR-023 descartó el `false` fijo), para
  `extract-pasted-job` (`incidental`, ADR-063) no decide la cadena, y se conserva para que la (b) de la Q2 siga siendo
  posible. Sin cambios de comportamiento. En `run-task-pasted-extraction.spec.ts`, el bloque «consent of whoever pastes» deja de
  simular la regla vieja (`:322-358`): «the paste runs the incidental task», «the consent of whoever pastes is still
  passed in the context» (con y sin permiso) y, sin cambios, los casos del `409` de `paste-fallback-honest`. Ajustar
  el `dataSensitivity: 'personal'` del doble (`:100`). Verificar: `pnpm nx run api:test --
  run-task-pasted-extraction.spec` en verde.
- [ ] 2.2 [backend] `links.controller.pasted.spec.ts` (IA de la suite en `replay`): «a paste without consent reads with
  the suite AI» (usuario sin permiso, `200` con los campos del golden). Verificar: `pnpm nx run api:test --
  links.controller.pasted.spec` en verde. Si falla solo por los tiempos de carga local conocidos, repetir aislado con
  `--parallel=1 --skip-nx-cache`; manda el CI.
- [ ] 2.3 [backend] Prueba de punta a punta del pegado con un externo (C7). En la suite del controlador
  (`links-test-app.ts`, que ya admite sustituir `RUN_TASK`), un `RUN_TASK` construido con el `runTask` **real** de
  `libs/ai` sobre un proveedor falso `external: true, dataCollectionDenied: true` (como `FakeLlmProvider` de
  `libs/ai/src/application/testing/`, exportado para tests si hace falta). Caso: «a paste without consent reaches the
  injected no-data-collection external provider» (usuario sin permiso, `200`; el proveedor recibió una petición, sin
  el email que llevaba lo pegado). Verificar: `pnpm nx run api:test -- links.controller.pasted.spec` en verde.
  Falsación: devolver `extract-pasted-job` a `personal` y ver el caso responder `409 ai_consent_required`; restaurar.
  **Si montar ese `RUN_TASK` pasa de una hora**, la tarea se declara regresión (prueba de regresión aparte, en una
  tarea 2.3b que se añade aquí) y se dice en el PR. No se recorta la falsación.

## 3. SPA: aviso de adónde va lo pegado (design D7)

- [ ] 3.1 [frontend] `paste-description.dialog.html`: debajo de `@@links.paste.explanation`, un `<p>` con
  `i18n="@@links.paste.externalNotice"`, `data-testid="paste-external-notice"` y el texto ES de D7, sin botón ni
  casilla. Verificar con `paste-description.dialog.spec.ts`: «shows where the pasted text may go before sending» (el
  aviso está antes de enviar y no contiene controles). `pnpm nx run web:test --
  --include="**/paste-description.dialog.spec.ts" --skip-nx-cache` en verde.
- [ ] 3.2 [frontend] i18n según ADR-050: `pnpm nx run web:extract-i18n` regenera `messages.xlf`; `messages.en.xlf`
  recibe `links.paste.externalNotice` con el texto EN de D7 y su `source`. Verificar: `pnpm nx run web:i18n-check`
  en verde, y `grep -c "links.paste.externalNotice" apps/web/src/locale/messages.en.xlf` devuelve `1`.
- [ ] 3.3 [frontend] `locale/privacy-text.ts` (C2, C4):
  - `PRIVACY_UNIT_IDS.pasteExternalNotice = 'links.paste.externalNotice'`, incluido en el bloque «forbidden promises»
    de `privacy-text.spec.ts`. **No** se añade a `ENUMERATION_SCREENS`: el aviso no enumera;
  - exportar `namedRedactedTypes(text, language): RedactedDataTypeId[]`, con la misma detección de tipos que ya usa
    `checkEnumeration`, que pasa a llamarla;
  - casos nuevos: «El aviso del pegado no promete anonimato ni enumera lo que se sustituye» (`checkForbiddenPromises`
    vacío en ES y EN), «namedRedactedTypes returns no type for the paste notice» (`[]` en ES y EN) y «El aviso del
    pegado dice que el resto se envía tal cual» (exige en ES «el resto se envía tal cual y puede identificar a
    personas» y en EN «the rest is sent as-is and may identify people»).

  Verificar: `pnpm nx run web:test -- --include="**/privacy-text.spec.ts" --skip-nx-cache` en verde. Falsaciones,
  restaurando cada una: añadir «de forma anónima» al `target` inglés y ver caer el primero, nombrando `en` y
  `links.paste.externalNotice`; cambiar «datos de contacto» por «tu email» en el `source` y ver que
  `namedRedactedTypes` devuelve `['email']` y el caso falla nombrando unidad, idioma (`es`) y tipo (`email`); quitar
  la frase de «tal cual» del `target` inglés y ver caer el tercero, nombrando `en`.
- [ ] 3.4 [frontend] Revisión a 360 px (Q3): el diálogo con el aviso, en el móvil emulado o con la ventana a 360 px,
  sin texto cortado y con las acciones visibles tras desplazar. Verificar: captura anotada en el PR. Si el aviso queda
  largo, se anota para la Q3 del owner, y la frase de «tal cual» no se recorta.

## 4. Documentación

- [ ] 4.1 [infra] `README.md` («Pegar la descripción», `:862-877`): la tarea es `incidental` (ADR-063); sin permiso de
  Perfil; solo externos que piden no recolectar; redacción siempre hacia externos. Quitar la «Condición pendiente…»
  del `ai_consent_required`, que ya resolvió `paste-fallback-honest`. Verificar: `grep -n "consentimiento de quien
  pega" README.md` no devuelve nada y `grep -n "ADR-063" README.md` devuelve la línea nueva.
- [ ] 4.2 [infra] `docs/RUNBOOK.md` (Paso 6 ter, viñeta «Es un dato personal», y la fila de la tabla de problemas del
  `503 extraction_unavailable` del pegado, que todavía dice «hasta que exista `ai_consent_required`»):
  - la misma corrección que la 4.1;
  - qué pasa si `AI_CHAIN` solo tiene externos que no piden no recolectar (`503 extraction_disabled`);
  - **cupo y circuito compartidos (C6):** el cupo de la cuenta de OpenRouter y el circuito del proveedor los comparten
    todas las tareas y todas las personas, y un `ai_capacity_exhausted` del pegado puede venir de lecturas del encaje;
  - **cuota propia del pegado en staging (D11, Q5):** `AI_QUOTAS=…,extract-pasted-job=N` en `.env.staging`, con el N
    que decida el owner y la regla de `.env.staging` de 35b (copia fuera del host actualizada). El compose ya pasa
    `AI_QUOTAS`: no se toca ningún fichero del repositorio;
  - **paso del owner (C5):** comprobar en la configuración de la cuenta de OpenRouter de la plataforma que no registra
    los prompts, y anotarlo con fecha («Cuenta de OpenRouter de la plataforma sin registro de prompts, comprobado el
    AAAA-MM-DD»).

  Verificar: `grep -n "consentimiento de quien pega\|hasta que exista .ai_consent_required." docs/RUNBOOK.md` no
  devuelve nada; `grep -n "ADR-063" docs/RUNBOOK.md` devuelve la viñeta; `grep -n "extract-pasted-job=" docs/RUNBOOK.md`
  devuelve la cuota; y `grep -nE "sin registro de prompts, comprobado el 20[0-9]{2}-" docs/RUNBOOK.md` devuelve la
  línea del owner. Con la Q1 = (b), las dos últimas se cumplen antes de la 10.7.
- [ ] 4.3 [infra] `docs/catalogo-de-uso.md` y `docs/guia-de-uso/README.md`: si alguno dice que el pegado necesita el
  permiso de IA externa, corregirlo. Verificar: `grep -n -i "pega" docs/catalogo-de-uso.md docs/guia-de-uso/README.md
  | grep -i "permiso\|consentim"` no devuelve ninguna línea que lo afirme (anotar la salida).

## 5. Cierre

- [ ] 5.1 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar con su salida. Si
  `web:i18n-check` falla porque el formato movió ubicaciones del catálogo, re-extraer en un commit `chore(web):
  re-extract i18n catalog` (ADR-050 §5) y repetir.
- [ ] 5.2 [infra] `node D:/projects/linkvault/node_modules/@fission-ai/openspec/bin/openspec.js validate
  paste-consent-scope --strict --no-interactive` y `validate --all --strict --no-interactive` en verde, y `bash
  infra/ci/repo-checks.sh` con salida 0.
- [ ] 5.3 [infra] ADR-063 pasa de «Propuesto» a «Aceptado» con la fecha de la aprobación de 0.2, y las líneas de
  ADR-014, ADR-018 y ADR-023 §Enmiendas y de ADR-060 §Consecuencias pasan de «propuesto» a «aceptado el AAAA-MM-DD».
  Verificar: `head -3 docs/adr/ADR-063.md` y `grep -n "ADR-063" docs/adr/ADR-014.md docs/adr/ADR-018.md
  docs/adr/ADR-023.md docs/adr/ADR-060.md` (cuatro líneas, ninguna con «propuesto»).

## 6. Fusión (design D10, según la Q1)

- [ ] 6.1 [infra] **Fusión del change**, justo antes de fusionar el PR. Verificar:
  - con la Q1 = (a): `ls openspec/changes/archive | grep verify-reusable-workflow` devuelve el archivo de 35c;
  - con la Q1 = (b): el PR lleva una confirmación escrita del owner **con la fecha del día de la fusión**, en la forma
    «11.6 hecha el AAAA-MM-DD; PR-2 de 35b = #NNN; 10.7 no hecha; sin `e2e-remote` hoy; `paste-fallback-honest`
    fusionado en #NNN»; `git log --oneline origin/main` contiene el merge del PR-2 de 35b y el de
    `paste-fallback-honest` con esos números; `gh run list --workflow e2e.yml --status in_progress` no lista ninguna
    corrida con el job `e2e-remote (staging)` en marcha;
  - en todos los casos, cabeza del PR actualizada y CI en verde sobre ella si `main` cambió
    `apps/web/src/locale/messages.xlf` o `libs/ai/src/domain/task.ts` desde la última corrida (ADR-050 §5).

  Falsación: con la (b), si la confirmación declara la 10.7 hecha, falta, es de otro día, no nombra el merge de
  `paste-fallback-honest` o hay una corrida `e2e-remote` en curso, el PR no se fusiona y queda para después de 35c.
- [ ] 6.2 [infra] Con la Q1 = (b), tras fusionar y antes de la 10.7 de 35b: repetir la 9.4 de `e2e-suite` sobre el
  commit desplegado con este change (sirve la 6.4 de `paste-fallback-honest` si se corrió sobre un commit que ya lo
  contiene, D10). Verificar: el resultado, con el SHA del commit desplegado, queda anotado en el PR de archivo (6.3).
  Con la (a), no aplica.
- [ ] 6.3 [infra] **PR de archivo** (clase 2 de D10): lleva las anotaciones posteriores a la fusión y se fusiona
  después del PR de archivo de `paste-fallback-honest` (D9). Con la (b): después de la 10.7, nunca entre el
  PR-2 de 35b y su 11.6, nunca durante su 9.1-9.4, nunca los días 7 y 14 de la medición y nunca el día de una corrida
  `e2e-remote`, con la confirmación del owner del día en la forma «10.7 hecha el AAAA-MM-DD; PR-2 de 35b = #NNN; 9.1-9.4
  no en curso; sin `e2e-remote` hoy». Verificar: `ls openspec/changes/archive | grep paste-fallback-honest` devuelve
  su archivo; `gh run list --workflow e2e.yml --created <AAAA-MM-DD> --json databaseId` y, por cada corrida, `gh run
  view <id> --json jobs --jq '.jobs[] | select(.name | startswith("e2e-remote")) | .conclusion'` sale vacío o
  `skipped`; y `git log --oneline --merges origin/main` lista cada fusión de este change con su confirmación en su PR.
  Falsación: con el archivo de `paste-fallback-honest` todavía sin fusionar, o el día 7 de la medición, el PR de
  archivo no se fusiona.
- [ ] 6.4 [infra] **Vueltas atrás** (clase 3 de D10), solo si hacen falta: revertir este change devuelve la tarea a
  `personal` y el pegado a la opción (d) de la Q7. Siguen las reglas de la 6.3, con la confirmación del owner fechada el
  día de la fusión (la forma de la 6.3 si la 10.7 ya se hizo; la de la 6.1 si no). Verificar: el PR de la vuelta atrás
  lleva esa confirmación, la comprobación de `gh run list` de la 6.3 sale limpia para ese día y el PR aparece en la
  lista de la 6.3. Falsación: un revert propuesto el día 14 de la medición no se fusiona.
