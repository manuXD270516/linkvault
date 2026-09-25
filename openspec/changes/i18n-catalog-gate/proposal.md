## Why

El catálogo fuente versionado de `apps/web` (`src/locale/messages.xlf`) no es lo que produce `pnpm nx run web:extract-i18n`:
tiene otro orden, tres textos recortados a mano (`discovery.submit`, `discovery.destination.groupsError`,
`discovery.save.hint`) y números de línea desfasados. Hoy el contenido coincide: los mismos 668 identificadores están en las
fuentes, en `messages.xlf` y en `messages.en.xlf`, y todos tienen traducción. Pero **nada lo garantiza**. Ninguna etapa de CI
extrae los mensajes, y `translations.spec.ts` compara dos ficheros versionados entre sí, no el catálogo con las plantillas y
los `$localize`. Un texto nuevo sin re-extraer pasa todas las comprobaciones.

**Quién gana hoy, dicho con honestidad:** quien desarrolla, no el usuario final. La UI en inglés **no se publica**: el build
de producción (`nx build web --configuration=production`, `docker/web.Dockerfile`) no tiene `localize`, nginx no sirve
ninguna ruta `/en` y el SPA no tiene selector de idioma. Por eso ningún usuario ve hoy una pantalla sin traducir. El valor de
este change es que quien desarrolla puede fiarse de que `messages.en.xlf` está completo y al día, porque CI lo compara con
las fuentes. Así el catálogo inglés está listo el día que se decida publicarlo, y no se vuelve a editar a mano el catálogo
fuente.

Ese coste ya se vio el 2026-09-25: el diff de una extracción, con ~41 unidades `discovery.*`/`links.*` solo **movidas** de
sitio, se leyó como 40 unidades nuevas sin traducir y llevó a editar `messages.xlf` a mano, que es justo lo que crea el
desfase. Además, todas las specs de `web/*` dicen «cada unidad tiene `target` **tras extraer los mensajes**»; este change
convierte esa premisa en algo comprobado.

## What Changes

- `messages.xlf` pasa a ser **exactamente** la salida de la extracción: se regenera una vez y desde entonces nunca se edita a
  mano.
- Nueva comprobación reproducible en local y en CI, `pnpm nx run web:i18n-check`: extrae a un directorio temporal, compara
  con el catálogo versionado sin escribir en `apps/`, y si difieren falla explicando **qué** difiere (unidades nuevas,
  eliminadas, con texto cambiado, o sin cambios de unidades) y con qué comando se arregla.
- La verificación de los tres workflows (`ci`, `cd-staging`, `cd-prod`) ejecuta esa comprobación cuando `web` está afectado,
  entre los tests y la evaluación de IA, con las mismas condiciones que las demás etapas: acotada por afectación en `ci` y
  `cd-staging`, sobre todo el workspace en `cd-prod` (como el resto de su verificación desde `deploy-image-verification`).
- La puerta local que deben pasar los agentes (`CLAUDE.md`, `/lv:apply`, `docs/RUNBOOK.md`) y `make test` incluye
  `i18n-check`.
- `translations.spec.ts` gana una comprobación de **traducción vigente**: el texto español que `messages.en.xlf` guarda en
  cada `source` debe coincidir con el del catálogo (salvo espacios). Cambiar un texto español sin actualizar su original
  inglés falla. Complementa ADR-030 §12, según el cual cambiar lo que promete un texto obliga a un identificador nuevo.
- Sin cambio visible para el usuario: no se añade ni se modifica ninguna traducción.

## Capabilities

### New Capabilities
- `web/i18n`: el catálogo de traducciones del SPA como artefacto derivado de las fuentes. El catálogo fuente es igual a la
  extracción, y la traducción inglesa está completa y vigente respecto al texto español. Es común a todas las features de
  `web/*`.

### Modified Capabilities
- `platform/ci-pipeline`: «Etapas de verificación» incorpora la comprobación del catálogo de traducciones (solo cuando `web`
  está afectado) entre los tests y la evaluación de IA. Nuevo requirement «El CD verifica con las mismas etapas que la
  integración continua», para que ningún despliegue se salte una etapa. No se modifican «CD a staging en main» ni «CD a
  producción por tag semver»: los reescribe `deploy-image-verification`, y reemplazarlos también desde aquí haría que el
  change que se archive segundo borre lo del otro.

## Impact

- `apps/web/src/locale/messages.xlf` (regenerado), `apps/web/src/locale/translations.spec.ts`, funciones de comparación en
  `apps/web/src/locale/`, script en `apps/web/scripts/`, target `i18n-check` en `apps/web/project.json`,
  `.github/workflows/{ci,cd-staging,cd-prod}.yml`, `CLAUDE.md`, `.claude/commands/lv/apply.md`, `Makefile`,
  `docs/RUNBOOK.md` y `docs/adr/ADR-050.md`.
- Conflictos: cualquier rama abierta que toque `messages.xlf` (hoy `deploy-image-verification`) chocará con la regeneración.
  Se resuelven re-extrayendo; ver design.md.
- **Pendiente fuera de este change:** publicar la UI en inglés (build `localize` con `i18nMissingTranslation: "error"`,
  servirla en nginx y elegir idioma por selector o `Accept-Language`) es lo que de verdad le falta al usuario anglohablante.
  Si se hace, ese change es el lugar para la regla de lint de textos visibles sin marcar para i18n.
- Fuera de la secuencia de fases de `docs/design-v0.2.md` §6: es un chore de plataforma, como `fix-attempt-limiter-ci`, y no
  adelanta ninguna feature.
