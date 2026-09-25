## Context

Ver proposal.md (Why). Estado medido el 2026-09-25 sobre `main` (00640a3) y sobre `deploy-image-verification` (72a24d0):

- `web:extract-i18n` (`@angular/build:extract-i18n`, XLIFF 1.2) **es determinista**: dos ejecuciones seguidas producen los
  mismos 283 328 bytes. Salida con LF, rutas con `/` y unidades ordenadas por fichero fuente y posición, sin nada propio de la
  máquina. Además `.gitattributes` normaliza todo a LF en disco y en el índice. Cubre plantillas y `$localize` (113 usos en
  16 ficheros TS).
- La extracción compila la aplicación (necesita `libs/shared` coherente) y tarda unos 6 s en local, sin caché. Acepta
  `--output-path` (probado con `tmp/`, que está en `.gitignore`).
- Cada `<trans-unit>` lleva `<context-group purpose="location">` con fichero y **números de línea**. Mover líneas cambia el
  catálogo aunque no cambie ningún texto. Cuatro unidades tienen id numérico autogenerado: los submensajes ICU.
- En el historial, 29 de 41 commits que tocan fuentes de `apps/web/src/app` ya tocaron también `messages.xlf`.
- `translations.spec.ts` compara `messages.xlf` con `messages.en.xlf` (mismas unidades, todas con `target`) con el
  `DOMParser` de jsdom. `messages.en.xlf` guarda una copia del `source` español por unidad, sin ubicaciones.
- La verificación está copiada en tres workflows: `ci.yml`, `cd-staging.yml` y `cd-prod.yml`. Los dos de CD tienen su propio
  job `verify` del que depende el despliegue. Patrón de cada comprobación: un target Nx y `pnpm nx affected -t <target>`,
  reproducible en local (p. ej. `ai:eval-ci`, `nx:run-commands`, `node --import tsx`, `TSX_TSCONFIG_PATH`).
- La UI inglesa no se publica (sin `localize` en el build de producción ni ruta en nginx): ver proposal.md.

## Goals / Non-Goals

**Goals:**
- Que el catálogo fuente no pueda quedarse atrás de las fuentes sin que falle la verificación, ni en CI ni antes de
  desplegar.
- Que el fallo diga qué pasa en términos de traducción (qué unidades son nuevas y cuáles cambiaron de texto) y no en líneas
  de diff, que es lo que confundió en el incidente del 2026-09-25.
- Que cambiar un texto español sin actualizar su original inglés falle en los tests.
- Que quien desarrolla vea el fallo en local, con la misma puerta que ya usa, antes de abrir el PR.

**Non-Goals:**
- Publicar la UI en inglés (build `localize`, ruta en nginx, selector o `Accept-Language`). Queda pendiente como change
  aparte (proposal.md, Impact).
- Cambiar de formato (XLIFF 2, JSON) o de herramienta de traducción.
- Comprobar la *calidad* de las traducciones, o que todo texto visible esté marcado para i18n. Una regla de lint para
  textos sin marcar pertenece al change que publique la UI inglesa.
- Superficies visibles que no pasan por el catálogo del SPA: los emails (`apps/api/.../mail/mail-templates.ts`, por
  `MailLocale`) y el HTML de `/p/:slug` que sirve la API. Este gate no las cubre.
- Modificar los escenarios «Traducciones completas» de cada spec de `web/*`: siguen valiendo, y este change hace cierta la
  premisa «tras extraer los mensajes» de todos a la vez.

## Decisions

### D1. El catálogo fuente es la salida literal del executor, sin normalizar

`messages.xlf` se compara **byte a byte** con lo que produce `@angular/build:extract-i18n`, ubicaciones y orden incluidos.

- *Alternativa: post-procesar la extracción* (quitar `context-group` de ubicación, ordenar por id) para que el catálogo solo
  cambie cuando cambia un texto. Da menos ruido y menos conflictos de merge por números de línea, pero añade un script
  propio entre Angular y el fichero que habría que mantener en cada actualización de Angular. Además, el fichero dejaría de
  ser «lo que produce la extracción», que es la regla más fácil de enseñar y de comprobar. **Rechazada por ahora**, con un
  criterio medible para revisarla. Si en 30 días **`main` se pone en rojo dos o más veces, o cinco o más PR fallan en CI,
  por un fallo «sin cambios de unidades»**, se abre un change para post-procesar sin ubicaciones. Esa fricción es la que
  mide la clasificación de D3, sin instrumentación nueva.
- *Alternativa: comparación semántica* (mismos ids y textos, ignorando ubicación y orden). Deja el fichero divergir en
  ubicaciones y reintroduce el ruido que causó el incidente. **Rechazada.**
- Coste aceptado: un cambio de fuentes que desplaza líneas con textos i18n obliga a re-extraer. D3 hace que ese caso se
  reconozca al instante, D6 lo detecta en local, y el historial dice que ya se hace en ~70 % de los commits.

### D2. Target `web:i18n-check`: extrae a `tmp/` y compara, nunca escribe en `apps/`

`nx:run-commands` en `apps/web/project.json` con `"parallel": false`, `cwd` en la raíz y `cache: false`. Tres comandos, en
este orden:

1. Borrar `tmp/i18n-check` (`node -e "fs.rmSync('tmp/i18n-check',{recursive:true,force:true})"`), para que nunca se lea
   una extracción anterior.
2. `nx run web:extract-i18n --output-path=tmp/i18n-check`.
3. `node --import tsx apps/web/scripts/check-i18n-catalog.ts`, con `TSX_TSCONFIG_PATH` apuntando a un `tsconfig` propio de
   `apps/web/scripts/` (tipos de Node), como `ai:eval-ci`. El script vive **fuera de `src/`**, porque
   `tsconfig.app.json` incluye `src/**/*.ts` sin tipos de Node y un `import 'node:fs'` rompería el typecheck y el build de
   la app. Si `tmp/i18n-check/messages.xlf` no existe, sale con código ≠ 0 y un mensaje explícito; nunca da verde.

`cache: false`, como `eval-ci`: cuesta unos segundos, y una caché con `inputs` mal declarados daría un verde falso, justo el
fallo que este change quiere eliminar.

- *Alternativa: en CI, `extract-i18n` + `git diff --exit-code`.* Es más corta, pero ensucia el working tree en local, depende
  de git y su mensaje es un diff de líneas: exactamente lo que se malinterpretó. **Rechazada.**

### D3. Comparación en funciones puras con el parser inyectado; el mensaje clasifica

Las funciones viven en `apps/web/src/locale/i18n-catalog.ts` y las cubre `web:test`. Reciben el `DOMParser` como
parámetro: en los tests se usa el global de jsdom del entorno de Angular, y en el script,
`new JSDOM('').window.DOMParser`. jsdom ya es devDependency directa, así que no hace falta ninguna dependencia nueva.

- `compareCatalogs(parser, extracted, committed)`: el **veredicto** es la igualdad de bytes (de strings). Solo si difieren,
  parsea las unidades por id (id → serialización de `<source>`) y clasifica en **nuevas**, **eliminadas**, **texto
  cambiado** (comparación exacta del `source`, espacios incluidos, porque el catálogo debe ser la salida literal) o **sin
  cambios de unidades** (difieren ubicación, orden o formato). Como el veredicto no depende del parseo, un fallo de parseo
  nunca convierte un rojo en verde.
- El script imprime la clasificación con los ids de las tres primeras clases, recuerda que las unidades nuevas o con texto
  cambiado necesitan su traducción en `messages.en.xlf`, y termina siempre con el comando de arreglo:
  `pnpm nx run web:extract-i18n`.
- Limitación documentada: en los submensajes ICU (id numérico autogenerado a partir del contenido), un cambio de texto
  aparece como una unidad nueva y una eliminada, no como «texto cambiado».

### D4. «Traducción vigente» como función pura, aplicada a los ficheros reales

`staleSources(parser, sourceXliff, enXliff): string[]`, en el mismo módulo, devuelve los ids cuyo `source` inglés difiere
del español tras colapsar los espacios en blanco (`\s+` → un espacio y `trim`). Tiene tests propios con XLIFF mínimos (los
dos escenarios de la spec, con el rojo cubierto como regresión), y `translations.spec.ts` la aplica a los ficheros reales
exigiendo `[]`. Así se toleran, sin tocarlas, las 5 unidades que hoy difieren solo en espacios (`discovery.submit`,
`discovery.destination.groupsError`, `discovery.save.hint`, `search.filter.salaryRange.hint`,
`search.filter.openOnly`; verificado).

Compara el contenido serializado del `source`, placeholders incluidos. Renombrar la expresión de una interpolación cambia su
`equiv-text` y obliga a actualizar el original inglés aunque la traducción siga valiendo. Es un falso positivo barato
(copiar el `source`) y se acepta frente a la complejidad de ignorar atributos.

Relación con ADR-030 §12: allí, cambiar lo que *promete* un texto obliga a un id nuevo. D4 cubre el resto de cambios de
texto con el mismo id: obliga a que la unidad inglesa aparezca en el diff que se revisa.

### D5. En los tres workflows: después de Test, antes de Eval

Step `i18n catalog` en `ci.yml` **y** en los jobs `verify` de `cd-staging.yml` y `cd-prod.yml`. Si solo estuviera en
`ci.yml`, `cd-staging` (que corre en paralelo en cada push a `main`) desplegaría un catálogo atrasado aunque `ci` estuviera
en rojo. En `ci` y `cd-staging` es `pnpm nx affected -t i18n-check`: como el target solo existe en `web`, `affected` lo
limita a cuando `web` está afectado, igual que `eval-ci` con `ai`. En `cd-prod` es `pnpm nx run-many --all -t i18n-check`,
como el resto de su verificación desde `deploy-image-verification`: con `affected`, un tag no ejecutaría nada. Va después de
Test porque los tests de `web` fallan antes, y con un mensaje más directo, por una traducción incompleta; y antes de Build,
para no gastar el build en una rama que ya se sabe roja.

En la spec, un requirement **nuevo** de `platform/ci-pipeline` dice que la verificación de cada CD ejecuta todas las etapas
de «Etapas de verificación» y prevalece sobre cualquier enumeración de etapas. **No se modifican** «CD a staging en main» ni
«CD a producción por tag semver». `deploy-image-verification` (fusionado en `main` y aún sin archivar) los reescribe enteros,
y un MODIFIED sustituye el bloque completo al archivar: el change que se archivara segundo borraría los cambios del otro. El
YAML sigue copiado en tres sitios; unificarlo en un workflow reutilizable queda fuera de alcance.

### D6. Regla escrita y puerta local

- `CLAUDE.md` (Frontend): «`messages.xlf` no se edita a mano: se regenera con `pnpm nx run web:extract-i18n`. Las
  traducciones se editan en `messages.en.xlf`».
- `CLAUDE.md` (Flujo de trabajo): excepción explícita a «nunca edites `apps/**` sin change activo» para un PR que solo
  contiene la salida de `web:extract-i18n` y arregla `main` (ADR-050 §5). Sin ella, un agente que sigue `CLAUDE.md` abriría
  un change completo solo para re-extraer.
- La puerta local incluye el nuevo target: `-t lint,typecheck,test,i18n-check` en `CLAUDE.md` (Calidad),
  `.claude/commands/lv/apply.md`, `docs/RUNBOOK.md` y `make test`. `affected`/`run-many` solo lo ejecutan donde existe.
- ADR-050 registra D1–D6 y el protocolo de `main` en rojo (Risks).

## Risks / Trade-offs

- [Conflictos de merge textuales en `messages.xlf` entre ramas paralelas] → Se resuelven **re-extrayendo** tras el merge,
  nunca a mano. El check lo exige.
- [Conflicto que git no detecta: el PR A desplaza líneas de una plantilla y el PR B cambia un texto más abajo. Los hunks de
  `messages.xlf` no se solapan, git fusiona sin avisar y `main` queda en rojo sin culpa de ningún PR] → Protocolo en
  ADR-050:
  1. Antes de fusionar un PR que toca `apps/web`, si `main` incorporó cambios en `apps/web/src/locale/messages.xlf` desde el
     último CI del PR, se actualiza la rama y se vuelve a pasar CI. Es la única forma de que aparezca el desfase silencioso;
     otros avances de `main` no lo requieren.
  2. Si `main` ya está en rojo por esto, se arregla hacia delante con un PR `chore(web): re-extract i18n catalog` que solo
     contiene la salida de `web:extract-i18n`. Es la única excepción a «ningún cambio en `apps/**` sin change activo»,
     porque es un artefacto generado sin edición manual.
  3. Queda como recomendación, no como tarea, activar «Require branches to be up to date» en la protección de `main`. Es un
     ajuste del repositorio en GitHub y lo decide su dueño.

  Cada caso cuenta para el criterio de revisión de D1.
- [La regeneración inicial choca con `deploy-image-verification`, que edita `messages.xlf`] → La tarea 1.1 regenera sobre
  el `main` vigente. Si esa rama se fusiona antes, simplemente se parte de su resultado; si se fusiona después, es ella quien
  re-extrae tras traer `main`. El check lo exige en cualquier caso, y este change no queda bloqueado por la otra rama.
- [Una actualización de Angular cambia el formato de la extracción (espaciado, orden)] → El check falla con «sin cambios de
  unidades» y se arregla re-extrayendo en el mismo PR de la actualización. No es un falso rojo: el catálogo realmente
  difiere.
- [La extracción compila la app: la verificación tarda unos segundos más cuando `web` está afectado] → Aceptado. Es del
  orden del step `Check prompt assets`.
- [Mientras la UI inglesa no se publique, `messages.xlf` no entra en el bundle, pero un catálogo atrasado bloquea igualmente
  un tag urgente a producción] → Aceptado por la paridad CI/CD. Se arregla en minutos con el PR de re-extracción.
- [En `cd-prod` (tag), `nrwl/nx-set-shas` podría no encontrar una ejecución verde en `main` y tomar como base el commit
  anterior, acotando todas las etapas `affected`, no solo esta] → Sin verificar y anterior a este change. Se trata aparte.
- [El script corre fuera del typecheck de la app] → El script solo cablea E/S con un `tsconfig` propio; la lógica vive en
  `src/locale/` y la cubren typecheck y los tests.

## Migration Plan

1. Regenerar `messages.xlf` en el PR de este change, sobre el `main` vigente. Los ids no cambian (verificado: 668 = 668 =
   668), así que `messages.en.xlf` no necesita traducciones nuevas.
2. Rollback: revertir el PR. La regeneración no cambia ids ni textos traducidos, y la UI publicada es solo ES, así que no
   afecta a ningún usuario.
