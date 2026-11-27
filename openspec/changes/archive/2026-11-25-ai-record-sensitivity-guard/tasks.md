## 0. Antes de aplicar

Change sin `design.md` (no hay decisiones; es un `fix(ai)`), así que no pasa por el debate critic/business/reflect. Cada
tarea cabe en menos de una hora. Los títulos de test salen de los escenarios del delta de `specs/ai/deterministic-mock`
y siguen la convención de los archivos que los alojan (los escenarios del grabador y de la auditoría ya se nombran en
español en `record-fixtures.spec.ts` y `audit-personal-fixtures.spec.ts`). Rutas relativas a `libs/ai/src/evals/recording/`.

- [x] 0.1 [infra] Aprobación humana registrada. Verificar: `grep -c "## Aprobación humana (" proposal.md` = 1, y la
  sección, con fecha, cita literalmente el pedido del owner y dice que autoriza el apply en la rama, **no** la fusión.
  Falsación: si la sección faltara o dijera que autoriza fusionar, el revisor rechaza el apply; ningún PR de esta rama
  se fusiona sin una ventana abierta por el owner.
  Estado (2026-11-25): hecho. `proposal.md` tiene la sección `## Aprobación humana (2026-11-25)` (`grep -c` = 1) con la
  cita «Aprobado todo ello avancemos» y el alcance: apply en la rama y PR; la fusión, cuando el owner lo diga.

## 1. Arreglo

- [x] 1.1 [ai] Tests que reproducen el bug, en rojo contra el código actual. Con un helper de test que devuelva una copia
  de una tarea `personal` real (p. ej. `classifySkillsTask`) **sin** la propiedad `dataSensitivity` (no con
  `dataSensitivity: undefined`, para que el caso sea el de «no declarada»):
  - En `record-fixtures.spec.ts`: «Una tarea sin sensibilidad declarada se trata como personal al grabar» (upstream
    distinto del mock: `recordFixtures` lanza `PersonalTaskUpstreamRejected` con `sensitivity === 'personal'`, el
    upstream en memoria recibe 0 peticiones y no hay archivos en el directorio de fixtures) y «Una tarea sin
    sensibilidad declarada se graba redactada contra el mock» (upstream `mock` con una salida que contiene un email:
    `recorded` vacío, el caso en `failed` con `pii type email`, el mensaje no contiene el valor y no se escribe el archivo).
  - En `audit-personal-fixtures.spec.ts`: «Una tarea sin sensibilidad declarada entra en la auditoría de fixtures»
    (fixture con `source: recorded:openrouter:<model>` bajo el directorio de la tarea sin el campo: `checked` = 1 y un
    issue que nombra el fixture y la tarea).
  Verificar: `pnpm nx test ai --skip-nx-cache -- src/evals/recording` deja **exactamente** esos tres tests en rojo (el
  primero porque el upstream recibe la petición o no se lanza el error, el segundo porque el fixture se escribe, el
  tercero porque `checked` = 0) y el resto en verde. Pegar en el estado de la tarea los tres nombres que fallan.
  Estado (2026-11-25): hecho. Contra el código sin arreglo, `Tests  3 failed | 16 passed (19)`; fallan exactamente
  «Una tarea sin sensibilidad declarada se trata como personal al grabar», «Una tarea sin sensibilidad declarada se
  graba redactada contra el mock» y «Una tarea sin sensibilidad declarada entra en la auditoría de fixtures». Los otros
  16 pasan.

- [x] 1.2 [ai] Arreglo con `dataSensitivityOf` y su falsación. En `record-fixtures.ts`, las líneas del rechazo (hoy 83)
  y de la comprobación de redacción (hoy 136) pasan a `dataSensitivityOf(task) === 'personal'`, y el segundo argumento
  de `PersonalTaskUpstreamRejected` (hoy 86) pasa a `dataSensitivityOf(task)`; en `audit-personal-fixtures.ts` (hoy 41),
  el filtro pasa a `dataSensitivityOf(e.task) === 'personal'`. Importar desde `../../domain/task`.
  Verificar: los tres tests de 1.1 en verde junto con el resto de `src/evals/recording`, y
  `grep -rnE "\.dataSensitivity\s*[!=]==" libs/ai/src --include=*.ts | grep -v "\.spec\.ts"` no devuelve nada.
  Falsación (sin commitear): revertir **de a un sitio** a la comparación literal y correr los tests de
  `src/evals/recording` con `--skip-nx-cache`: el sitio del rechazo hace fallar «…se trata como personal al grabar»;
  el de la comprobación de redacción, «…se graba redactada contra el mock»; el de la auditoría, «…entra en la
  auditoría de fixtures». Si alguno de los tres revertidos deja todo en verde, el test correspondiente no protege y se
  corrige antes de seguir. Restaurar y confirmar `git diff` limpio de la falsación.
  Estado (2026-11-25): hecho. Con el arreglo: `Tests  19 passed (19)` y el grep no devuelve nada. Falsación de a un
  sitio (`--skip-nx-cache`, cada una `1 failed | 18 passed`): rechazo (83) revierte y falla solo «…se trata como
  personal al grabar»; argumento de `PersonalTaskUpstreamRejected` (86) falla ese mismo test; redacción (136) falla solo
  «…se graba redactada contra el mock»; auditoría (41) falla solo «…entra en la auditoría de fixtures». Cada sitio
  restaurado y diff final igual al del arreglo.

- [x] 1.3 [ai] Cierre. Verificar: `pnpm nx affected -t lint,typecheck,test` en verde (con `AI_CHAIN=mock` y
  `AI_MOCK_MODE=replay`, como en CI), `node node_modules/@fission-ai/openspec/bin/openspec.js validate
  ai-record-sensitivity-guard --strict --no-interactive` y `bash infra/ci/repo-checks.sh` con rc=0, y el diff del PR
  limitado a `libs/ai/src/evals/recording/**` más este change (sin prompts, fixtures ni línea base del eval).
  Estado (2026-11-25): hecho. `nx run ai:test`: 82 archivos, 897 tests en verde. `openspec validate … --strict` y
  `repo-checks.sh` con rc=0. `nx affected -t lint,typecheck,test --base=origin/main`: lint y typecheck en verde; `api:test`
  dio timeouts de hook por carga (21 tests, 5000 ms), se repitió con `-- --maxWorkers=2`: 3855 pasan y falla uno solo,
  `outbox-port-isolation.spec.ts` por timeout de 5000 ms, que corrido aislado pasa (4/4); `api` no depende del cambio
  (solo se tocó `libs/ai/src/evals/recording/**`). `ai:eval --all --provider=mock` (sin `--update-baseline`):
  `schema_validity_rate=1` en las 6 tareas, sin diferencias en línea base ni reportes. Diff limitado a
  `libs/ai/src/evals/recording/**` y este change.
