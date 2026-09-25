## 1. Catálogo fuente regenerado

- [x] 1.1 [frontend] Regenerar `apps/web/src/locale/messages.xlf` con `pnpm nx run web:extract-i18n` sobre el `main` vigente,
  sin retocarlo. Si `deploy-image-verification` ya está fusionada, se parte de su resultado; si no, será ella quien
  re-extraiga tras traer `main` (design.md, Risks). Verificar que el conjunto de ids no cambia respecto a `HEAD`, que
  coincide con el de `messages.en.xlf` y que una segunda extracción no produce diff.

## 2. Comparación del catálogo

- [x] 2.1 [frontend] `apps/web/src/locale/i18n-catalog.ts` con `compareCatalogs(parser, extracted, committed)` (D3): veredicto
  por igualdad de bytes y clasificación en nuevas, eliminadas, texto cambiado o sin cambios de unidades. Verificar con
  `i18n-catalog.spec.ts`, con XLIFF mínimos escritos en el test, los escenarios de `web/i18n` «Catálogo al día», «Texto
  nuevo sin extraer», «Texto nuevo en código sin extraer», «Texto español cambiado sin extraer», «Solo se movieron
  líneas» y «Catálogo editado a mano», más un caso de bytes distintos con el XML roto (debe dar distinto, nunca igual).
- [x] 2.2 [frontend] `apps/web/scripts/check-i18n-catalog.ts`, fuera de `src/`, con su `tsconfig` (tipos de Node) para
  `TSX_TSCONFIG_PATH`. Lee `tmp/i18n-check/messages.xlf` y `apps/web/src/locale/messages.xlf`, usa
  `new JSDOM('').window.DOMParser` y llama a `compareCatalogs`. Imprime la clasificación, el recordatorio de traducir en
  `messages.en.xlf` y el comando `pnpm nx run web:extract-i18n`, y sale con código ≠ 0 si difieren o si falta el fichero
  extraído. Verificar a mano: un catálogo con un id quitado da rojo nombrándolo, y sin `tmp/i18n-check` da rojo con mensaje
  explícito.
- [x] 2.3 [infra] Target `i18n-check` en `apps/web/project.json` (`nx:run-commands`, `"parallel": false`, `cache: false`,
  `cwd` en la raíz; D2): borrar `tmp/i18n-check`, extraer con `--output-path=tmp/i18n-check` y ejecutar el script de 2.2.
  Verificar que:
  - `pnpm nx run web:i18n-check` pasa con el catálogo de 1.1;
  - falla con «sin cambios de unidades» tras insertar una línea en blanco encima de un texto i18n de una plantilla;
  - falla nombrando la unidad tras añadir un `$localize` con id nuevo;
  - en todos los casos `git status` no muestra cambios fuera de lo que se tocó a propósito (revertido después).

## 3. Traducción vigente

- [x] 3.1 [frontend] `staleSources(parser, sourceXliff, enXliff)` en `i18n-catalog.ts` (D4). Verificar en
  `i18n-catalog.spec.ts` los escenarios «Texto español cambiado sin revisar la traducción» (devuelve `discovery.submit`)
  y «Solo cambian espacios» (devuelve `[]`), con XLIFF mínimos.
- [x] 3.2 [frontend] En `translations.spec.ts`, prueba de traducción vigente que exige `staleSources(...)` igual a `[]`
  sobre los ficheros reales, y referencia en las pruebas existentes a los escenarios «Unidad sin traducir» y «Unidad
  huérfana en inglés» (`has exactly the units extracted from the Spanish source`). Verificar con
  `pnpm nx run web:test --skip-nx-cache --include="**/translations.spec.ts"` que pasa con los catálogos actuales, incluidas
  las 5 unidades que difieren solo en espacios.

## 4. CI, CD y reglas

- [x] 4.1 [infra] Step `i18n catalog` entre `Test` y `Eval (replay)` en `ci.yml` y en los jobs `verify` de
  `cd-staging.yml` (`pnpm nx affected -t i18n-check`) y `cd-prod.yml` (`pnpm nx run-many --all -t i18n-check`) (D5).
  Verificar:
  - que `pnpm nx show projects --affected --files=apps/api/src/main.ts --with-target=i18n-check` no devuelve `web`
    (escenario «Cambio que no afecta a web»);
  - en el PR de este change, que el step de `ci` corre (se toca `apps/web`) y pasa con el catálogo regenerado en Windows
    (evidencia del mismo veredicto en Linux);
  - en un commit temporal del PR que añade una unidad sin extraer, que falla nombrándola y no ejecuta Eval ni Build.
    Revertir ese commit antes del merge;
  - de forma estática, en `cd-staging.yml` y `cd-prod.yml`, que el step `i18n catalog` está dentro del job `verify` entre
    `Test` y `Eval (replay)` y que `build-verify-publish` mantiene `needs: verify` (escenarios «Catálogo de traducciones
    atrasado no despliega staging» y «… producción»; la confirmación real llega con el primer push a `main` que toque
    `web` y con el primer tag).
- [x] 4.2 [infra] Regla y puerta local de D6:
  - `CLAUDE.md`: regla en Frontend, excepción de re-extracción en Flujo de trabajo (ADR-050 §5) y `i18n-check` en Calidad;
  - `.claude/commands/lv/apply.md`, `docs/RUNBOOK.md` (puertas de cierre) y `make test` con `i18n-check`.

  Verificar que ninguna puerta de cierre del repo sigue diciendo solo `lint,typecheck,test`
  (`grep -rn "lint,typecheck,test" CLAUDE.md Makefile docs/RUNBOOK.md .claude/commands`) y que
  `openspec validate --all` pasa.

## 5. Cierre

- [x] 5.1 `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde y `pnpm nx run web:test` completo en verde.
