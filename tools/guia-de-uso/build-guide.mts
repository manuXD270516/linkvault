/**
 * Arma `docs/guia-de-uso/README.md` a partir de `resultados.json` (lo que `capture.mts` vio y si cada caso salió OK o
 * FALLO), `meta.mts` (ruta, entrada, esperado y prueba de cada caso) y el texto fijo de este fichero.
 *
 *   node --import tsx tools/guia-de-uso/build-guide.mts --sha=<commit probado> --date=2026-11-25
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { META } from './meta.mts';
import type { CaseResult } from './lib.mts';

const args = process.argv.slice(2);
const sha = args.find((a) => a.startsWith('--sha='))?.slice(6) ?? 'desconocido';
const date = args.find((a) => a.startsWith('--date='))?.slice(7) ?? '';
const unit = args.find((a) => a.startsWith('--unit='))?.slice(7) ?? '';

const results = JSON.parse(
  readFileSync(join('tools', 'guia-de-uso', 'resultados.json'), 'utf8'),
) as CaseResult[];
const total = results.length;
const failed = results.filter((r) => !r.ok);
const shots = results.reduce((n, r) => n + r.shots.length, 0);

function anchor(r: CaseResult): string {
  return `caso-${r.id.toLowerCase()}`;
}

const sections: string[] = [];
for (const r of results) {
  if (!sections.includes(r.section)) {
    sections.push(r.section);
  }
}

function sectionAnchor(section: string): string {
  return section
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .trim()
    .replace(/ +/g, '-');
}

const out: string[] = [];
const push = (text = ''): void => {
  out.push(text);
};

push(
  '# Guía funcional de pruebas locales de LinkVault, con capturas de toda la app',
);
push();
push(
  'Recorrido por **todas las pantallas, formularios, diálogos y estados** de la aplicación de `main`, pensado para repetirse a mano en local antes del despliegue. Cada paso dice la ruta, qué se escribe y qué botón se pulsa, qué debe pasar, qué pasó y qué prueba automatizada lo cubre (o «sin prueba automatizada»), con una captura antes y otra después de rellenar. El orden es el que encuentra una persona nueva ([`docs/catalogo-de-uso.md`](../catalogo-de-uso.md)).',
);
push();
push(`- **Fecha de las capturas y de las pruebas:** ${date}.`);
push(`- **Commit probado:** \`${sha}\` (\`origin/main\`).`);
push(
  `- **Casos:** ${total} (${total - failed.length} OK, ${failed.length} FALLO). **Capturas:** ${shots}.`,
);
push(
  '- **Cómo se hicieron las capturas:** `tools/guia-de-uso/capture.mts` (ver [`tools/guia-de-uso/README.md`](../../tools/guia-de-uso/README.md)). Esta guía la arma `tools/guia-de-uso/build-guide.mts` con lo que vio ese script; no se edita a mano.',
);
push();
push('## Índice');
push();
push('1. [Lista de comprobación](#lista-de-comprobación)');
push('2. [Entorno local paso a paso](#entorno-local-paso-a-paso)');
push('3. [Convenciones de la guía](#convenciones-de-la-guía)');
sections.forEach((section, index) => {
  push(`${index + 4}. [${section}](#${sectionAnchor(section)})`);
});
push(
  `${sections.length + 4}. [Lo que no tiene pantalla o no se pudo probar en esta pila](#lo-que-no-tiene-pantalla-o-no-se-pudo-probar-en-esta-pila)`,
);
push(`${sections.length + 5}. [Pruebas automatizadas](#pruebas-automatizadas)`);
push(`${sections.length + 6}. [Hallazgos](#hallazgos)`);
push(
  `${sections.length + 7}. [Qué cambió respecto de la guía de septiembre](#qué-cambió-respecto-de-la-guía-de-septiembre)`,
);
push();
push('---');
push();

// ------------------------------------------------------------------------------------------------ checklist
push('## Lista de comprobación');
push();
push(
  `Resultado de la corrida del ${date}. Cada fila lleva al paso con su detalle. **FALLO** es lo que no coincide con la spec o el catálogo; está explicado en [Hallazgos](#hallazgos). Para repetir la guía a mano, cambia la última columna por tu resultado.`,
);
push();
push('| Caso | Qué se prueba | Resultado | Tu resultado |');
push('| ---- | ------------- | --------- | ------------ |');
for (const r of results) {
  const meta = META[r.id];
  const verdict = r.ok ? 'OK' : `**FALLO** (${meta?.h ?? 'ver hallazgos'})`;
  push(`| [${r.id}](#${anchor(r)}) | ${r.title} | ${verdict} | [ ] |`);
}
push();
push(
  `**Resumen:** ${total} casos, ${total - failed.length} OK, ${failed.length} FALLO${failed.length > 0 ? ` (${failed.map((f) => f.id).join(', ')})` : ''}.`,
);
push();

// ------------------------------------------------------------------------------------------------ entorno
push('## Entorno local paso a paso');
push();
push(
  'Hay dos formas de tener LinkVault en local: la **pila aislada de la suite e2e** (la que usó esta guía; sin tocar tu `.env` ni la pila de desarrollo) y la **forma normal de desarrollo** del README. Prerrequisitos: Node.js de `.nvmrc` (22.x), pnpm de `packageManager` (`corepack enable`), Docker con Compose v2 y, en Windows, el redistribuible de Visual C++ x64.',
);
push();
push('### A. Pila aislada de la suite e2e (la de esta guía)');
push();
push(
  'Fuente: `apps/web-e2e/README.md`. Monta Mongo (réplica de un nodo), Redis, el almacén S3, Mailpit, `api`, `worker` y `web` desde el código del checkout, en su propio bloque de puertos:',
);
push();
push('| Servicio | Dirección |');
push('| -------- | --------- |');
push('| web | http://localhost:4300 |');
push('| API | http://localhost:3100 |');
push('| worker (salud) | http://localhost:3101 |');
push('| Mailpit (UI y API) | http://localhost:8125 (SMTP 1125) |');
push('| Mongo / Redis | 27117 / 6479 |');
push('| Almacén S3 | 9100 y 9101 |');
push();
push(
  '1. `pnpm install --frozen-lockfile` y, una vez, `pnpm exec playwright install chromium`.',
);
push(
  '2. Comprueba que el bloque de puertos de arriba está libre (el runner lo comprueba y se niega a arrancar si no).',
);
push('3. Levanta la pila y déjala en pie:');
push();
push('   ```bash');
push(
  '   # macOS/Linux o Git Bash; en Windows no uses `pnpm nx run …` con --keep-stack: Nx termina las aplicaciones al salir',
);
push('   TSX_TSCONFIG_PATH=apps/web-e2e/scripts/tsconfig.json \\');
push(
  '     node --import tsx apps/web-e2e/scripts/e2e-stack.ts --keep-stack --list',
);
push('   ```');
push();
push(
  '   (`--list` solo lista las pruebas, así que el runner termina en verde y la pila queda levantada. En Linux/macOS vale también `pnpm nx run web-e2e:e2e-stack --keep-stack`, que además ejecuta la suite.) El runner tarda unos 2 minutos: levanta la infraestructura con `pnpm infra:up`, sirve `api` y `worker` con `nx serve` y `web` con `nx serve web -c production`.',
);
push();
push(
  '4. Abre http://localhost:4300. No hay cuentas: cada paso de la guía las crea (`@example.test`).',
);
push(
  '5. Apaga todo al terminar (solo mata lo que esa corrida lanzó y borra los volúmenes del proyecto):',
);
push();
push('   ```bash');
push('   TSX_TSCONFIG_PATH=apps/web-e2e/scripts/tsconfig.json \\');
push('     node --import tsx apps/web-e2e/scripts/e2e-stack.ts --down');
push('   ```');
push();
push(
  '**Configuración** (`apps/web-e2e/e2e.env`, fija y versionada; no se edita):',
);
push();
push(
  '- **IA:** `AI_CHAIN=mock` con `AI_MOCK_MODE=replay`. Solo responde a entradas que tienen fixture; nada sale de la máquina. Por eso la oferta y el CV del encaje son los versionados del camino crítico (`libs/ai/src/infrastructure/fixture-inputs/critical-path.json`) y lo que se pega es el caso `oferta-entre-chat` del golden de `extract-pasted-job`.',
);
push(
  '- **Flags apagados:** `FEATURE_SEARCH`, `FEATURE_DISCOVERY`, `FEATURE_LINK_FRESHNESS`, `FEATURE_GROUP_DIGEST`. Buscar y Descubrir solo muestran «no disponible».',
);
push(
  '- **Claves vacías:** sin `VAPID_*` (push) ni `AI_VAULT_KEY` (claves propias de IA).',
);
push(
  '- **Registro:** el producto limita las altas a 10 cada 15 minutos por IP. Esta guía usa 5 (Ana, Beto, Carla, Diego y un intento repetido); una pila nueva parte de cero.',
);
push();
push('### B. Forma normal de desarrollo (README)');
push();
push(
  'Fuentes: `README.md` («Prerrequisitos», «Puesta en marcha»), `docs/RUNBOOK.md`, `docs/demo.md` y `.env.example`. Con esta forma tienes **todo encendido** y la demo cargada, así que se pueden probar también Buscar, Descubrir, frescura, resumen semanal, push y claves propias (los casos que esta pila no alcanza).',
);
push();
push('```bash');
push('pnpm install');
push('cp .env.example .env            # y edita lo de abajo');
push(
  'COMPOSE_PROFILES=demo pnpm infra:up      # mongo, redis, almacén S3, mailpit, meilisearch y los buckets',
);
push(
  'ALLOW_DEMO_SEED=true pnpm nx run api:seed-demo   # cuentas y datos de la demo (idempotente)',
);
push('pnpm nx serve api      # http://localhost:3000');
push('pnpm nx serve worker   # http://localhost:3001');
push('pnpm nx serve web      # http://localhost:4200');
push('```');
push();
push(
  'Cambios en `.env` para recorrer todo (cada variable está documentada en `.env.example`):',
);
push();
push('```dotenv');
push('AI_CHAIN=mock');
push(
  'AI_MOCK_MODE=synth        # devuelve el fixture si existe y, si no, una salida sintética determinista',
);
push('FEATURE_SEARCH=true');
push('FEATURE_DISCOVERY=true');
push(
  'DISCOVERY_CHAIN=mock      # `live` consulta Get on Board y Remote OK de verdad',
);
push('FEATURE_LINK_FRESHNESS=true');
push('FEATURE_GROUP_DIGEST=true');
push('VAPID_PUBLIC_KEY=<npx web-push generate-vapid-keys>');
push('VAPID_PRIVATE_KEY=<idem>');
push(
  "AI_VAULT_KEY=<node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\">",
);
push('```');
push();
push(
  'Comprobación: `curl http://localhost:3000/health` y `curl http://localhost:3001/health` → `200`. Correo (verificación, recuperación, avisos): Mailpit en http://localhost:8025. Con la demo, entra con `ana@demo.linkvault.local` / `Demo-pass-Ana-12345!` o `bob@demo.linkvault.local` / `Demo-pass-Bob-12345!` (grupo «Demo LatAm», código `SEEDD3M2`). Las cuentas de la demo nacen sin email verificado y su CV es un PDF sin texto: para el encaje sube uno real. Para partir de cero, `docker compose down -v`.',
);
push();
push(
  'Con la forma B, lo que esta guía llama «http://localhost:4300» es http://localhost:4200, la API es http://localhost:3000 y Mailpit http://localhost:8025. Con `AI_MOCK_MODE=synth` el encaje, el pegado y el plan de estudio funcionan con datos propios (salida sintética, no es IA real).',
);
push();
push('### C. Build en inglés');
push();
push(
  '`apps/web/project.json` define el locale `en`, pero ningún target lo construye ni lo sirve (ADR-050 deja pendiente publicarlo), y la pila solo sirve el español. Para las capturas en inglés se construyó el build a mano y se sirvió aparte, con un proxy de `/api` hacia la API de la pila:',
);
push();
push('```bash');
push(
  'pnpm nx run web:build:production --localize=en --output-path=dist/guia-web-en --skip-nx-cache',
);
push(
  'node --import tsx tools/guia-de-uso/serve-en.mts      # http://localhost:4301/en/',
);
push('```');
push();
push(
  'Las rutas siguen en español (`/en/grupos`, `/en/perfil`…); solo cambian los textos. Para repetir la tanda en inglés a mano, abre http://localhost:4301/en/login.',
);
push();

push('## Convenciones de la guía');
push();
push(
  '- **Escritorio:** Chromium de Playwright a 1280×800; las capturas son de página completa (pueden ser más altas) salvo las de diálogos, que son del viewport.',
);
push(
  '- **Móvil:** Pixel 7 emulado (412×915 CSS; las capturas miden 1082 px de ancho por la densidad de píxeles). Sección «En el móvil».',
);
push(
  '- **Idiomas:** español por defecto (casi toda la guía) y una tanda en inglés con el build `--localize=en` (sección «Inglés y modo oscuro»).',
);
push(
  '- **Modo claro y oscuro:** la aplicación **solo tiene tema claro** (`styles.scss` fija `color-scheme: light`); el caso `W10` lo comprueba con `prefers-color-scheme: dark` (hallazgo H6).',
);
push(
  '- **Datos, todos inventados:** Ana (`ana+guia@example.test`), Beto (`beto+guia@example.test`), Carla (`carla+guia@example.test`) y Diego (`diego+guia@example.test`); ofertas en el dominio reservado `.invalid`, que no existe (el worker no puede leerlas y no sale ninguna petición a una bolsa real).',
);
push(
  '- **Máscaras:** las zonas rosas tapan contraseñas, el código de invitación, las claves de IA, el texto del CV, los fragmentos del CV en el informe de encaje y los extractos de los correos de Mailpit (pueden llevar el enlace con token).',
);
push(
  '- **Orden:** los pasos dependen de los anteriores (la cuenta, el grupo, la oferta y el CV se crean por el camino). Una pila nueva y el orden de la guía reproducen todo.',
);
push();

// ------------------------------------------------------------------------------------------------ casos
let n = 3;
for (const section of sections) {
  n += 1;
  push(`## ${section}`);
  push();
  for (const r of results.filter((x) => x.section === section)) {
    const meta = META[r.id];
    push(`### ${r.id}. ${r.title}`);
    push(`<a id="${anchor(r)}"></a>`);
    push();
    if (meta === undefined) {
      throw new Error(`falta meta para el caso ${r.id}`);
    }
    push(`- **Ruta:** ${meta.r}`);
    push(`- **Se escribe y se pulsa:** ${meta.e}`);
    push(`- **Esperado:** ${meta.x}`);
    if (r.ok) {
      push(`- **Visto:** ${r.seen}`);
      push('- **Resultado:** OK');
    } else {
      push(`- **Visto:** ${r.seen}`);
      push(
        `- **Resultado:** **FALLO** (hallazgo ${meta.h ?? 'sin identificar'}, ver [Hallazgos](#hallazgos))`,
      );
    }
    push(`- **Prueba automatizada:** ${meta.t}`);
    push();
    for (const shot of r.shots) {
      const alt = shot
        .replace(/^\d+-/, '')
        .replace(/\.png$/, '')
        .replace(/-/g, ' ');
      push(`![${alt}](img/${shot})`);
    }
    push();
  }
}
void n;

// ------------------------------------------------------------------------------------------------ no probado
push('## Lo que no tiene pantalla o no se pudo probar en esta pila');
push();
push(
  'Con la forma B del entorno (todo encendido) se prueban a mano los casos con ✔; con la pila aislada no.',
);
push();
push('| Catálogo | Qué falta | Por qué | Cómo probarlo a mano |');
push('| -------- | --------- | ------- | -------------------- |');
push(
  '| 13. Lectura automática de ofertas reales | Ver una oferta leída de verdad | Solo se usan dominios `.invalid`; se ve el caso «No pudimos leer esta oferta». | ✔ B: guardar una oferta de getonbrd.com (con red saliente). |',
);
push(
  '| 33. Plan de estudio con contenido | `/plan/:analysisId` con ítems por semanas y «Exportar Markdown» | En `replay`, el único encaje con fixture (`critical-path`) no tiene habilidades que falten, así que no se ofrece «Ver plan de estudio». Se prueba la pantalla de un análisis inexistente (`M05`). | ✔ B (`synth`): informe con «Habilidades que faltan» → «Ver plan de estudio». |',
);
push(
  '| 35. Buscar con resultados; 36. Salario leído del texto | Resultados, filtros y el CLI | `FEATURE_SEARCH=false` y sin Meilisearch. | ✔ B: perfil `demo` y `FEATURE_SEARCH=true`. |',
);
push(
  '| 37. Descubrir con resultados | Tarjetas de resultado y «Guardar en» con confirmación | `FEATURE_DISCOVERY=false`. | ✔ B: `FEATURE_DISCOVERY=true`, `DISCOVERY_CHAIN=mock` (dos resultados fijos). |',
);
push(
  '| 22/23. Frescura automática | El worker cerrando ofertas vencidas y caducando postulaciones | `FEATURE_LINK_FRESHNESS=false`; el caso `P04` siembra el cierre en Mongo. | ✔ B: `FEATURE_LINK_FRESHNESS=true` y esperar la pasada horaria. |',
);
push(
  '| 40. Push del navegador | «Push activado» y la notificación del sistema | Sin claves VAPID; además Chromium sin interfaz deniega el permiso (caso `T03`). | ✔ B: claves VAPID y un navegador con interfaz. |',
);
push(
  '| 41. Resumen semanal | El correo «Resumen semanal · {grupo}» | `FEATURE_GROUP_DIGEST=false` y depende del cron (procesa la semana ISO anterior). | ✔ B: `FEATURE_GROUP_DIGEST=true` y `GROUP_DIGEST_CRON`. |',
);
push(
  '| 34. Claves propias (BYOK) guardadas | «Configurada · hint …xxxx», «Rotar clave», «Revocar» | Sin `AI_VAULT_KEY` el guardado responde 503 (caso `B03`). | ✔ B: con `AI_VAULT_KEY`. |',
);
push(
  '| Análisis con IA externa real | Un proveedor externo de verdad | La pila usa solo el mock; el permiso cambia textos y enrutado (`B01`). | Fuera de local (necesita una clave real). |',
);
push(
  '| 42 y 43. Extensión del navegador | Popup de Chromium y Firefox | No forma parte de la pila de la suite. | ✔ B: `pnpm nx build extension` y cargarla (catálogo, pasos 42 y 43). |',
);
push(
  '| 45. Salud y métricas; 46. Reencolar lecturas; 36. Salario | `/health`, `/metrics` y los CLI | Sin pantalla. | `curl http://localhost:3100/health` y `/metrics`; CLI del catálogo. |',
);
push(
  '| 39. Avisos por email (todos) | Estancada y resumen | Solo se vieron «Nuevo link en tu grupo» y «Actualización de postulación en el grupo» (caso `T04`). | ✔ B con la demo (cuenta con email verificado). |',
);
push();

// ------------------------------------------------------------------------------------------------ pruebas
push('## Pruebas automatizadas');
push();
push(`Ejecutadas el ${date} sobre el commit \`${sha}\`.`);
push();
push(
  '**Lote 1 de la suite e2e (el único admitido y reproducible).** `pnpm nx run web-e2e:e2e-stack` (monta su pila aislada, ejecuta y la apaga):',
);
push();
push('| Spec | Proyecto | Resultado |');
push('| ---- | -------- | --------- |');
push('| `critical-path.spec.ts` | `chromium` (escritorio) | pasa |');
push('| `critical-path.spec.ts` | `mobile` (Pixel 7) | pasa |');
push();
push(
  'Corrida completa: 2 tests pasados en 52,2 s. Cubre registro, grupo, invitación, guardar y completar una oferta, «Postulé», subir el CV y el encaje con el informe del fixture de replay.',
);
push();
if (unit !== '') {
  push('**Pruebas unitarias de `web`** (`pnpm nx run web:test`, Vitest):');
  push();
  push(unit);
  push();
}
push(
  '**El resto de specs de `apps/web-e2e/src/`** (`applications`, `auth`, `auth-email-recovery`, `byok`, `comments`, `cv`, `deploy-prod`, `freshness`, `groups`, `home`, `links`, `match`, `notifications`, `public-share`, `search`, `share-notice-time`) **no se volvieron a ejecutar** en esta pasada: según `apps/web-e2e/README.md` solo lo etiquetado `@lot1` cuenta como verificado, y el resto sigue por el camino antiguo (pila de otra sesión, puertos fijos). La columna «Prueba automatizada» de cada caso los nombra como referencia; su último resultado conocido está en la guía de septiembre (`git show 0f307c6e:docs/guia-de-uso/README.md`).',
);
push();

// ------------------------------------------------------------------------------------------------ hallazgos
push('## Hallazgos');
push();
push(
  'Lo que no funciona como dice la spec o el catálogo, o se vio mal. **No se corrigió nada** (`apps/**` y `libs/**` requieren un change de OpenSpec).',
);
push();
push('**Producto e interfaz**');
push();
push(
  '- **H1. «Analizar mi encaje» sin CV no dice que falta el CV.** Caso [M01](#caso-m01). Ruta: `/grupos/:id` → «Analizar mi encaje» con una cuenta sin CV (Beto). El diálogo abre con «Ningún CV marcado» y el botón «Analizar» activo; al pulsarlo, la API responde `409 {"code":"no_cv","message":"Upload a CV before analysing a job"}` y el diálogo dice «No pudimos analizar ahora.» con «Reintentar». El catálogo (paso 31) promete «Necesitas un CV guardado…» y el diálogo tiene ese estado (`match-no-cv`, con «Subir CV»), pero no se llega a él. Evidencia: `encaje-sin-cv` y `encaje-sin-cv-analizar`.',
);
push(
  '- **H2. Tras verificar el email, el aviso de la barra puede seguir hasta recargar (intermitente).** Caso [V03](#caso-v03). Ruta: con sesión abierta, abrir en la misma pestaña el enlace `/verificar-email?token=…` → «Email verificado» → «Ir a la aplicación». En 2 de las 6 corridas completas de esta pasada, `/grupos` siguió mostrando «Tu email aún no está verificado…» hasta recargar; en las otras 4 desapareció. Causa probable (sin tocar código): `VerifyEmailPage` solo vuelve a pedir el perfil si ya hay sesión **cuando termina la verificación**; con una recarga completa, la restauración de la sesión y la verificación corren en paralelo y el perfil guardado puede ser anterior. La corrida final salió bien, así que no hay captura del estado malo; el script la toma sola (`grupos-aviso-persiste-tras-verificar`) si ocurre.',
);
push(
  '- **H3. Cambiar la contraseña: los mensajes de error se superponen y uno queda viejo.** Caso [F03](#caso-f03), captura `perfil-contrasena-nueva-corta`. Tras un intento con la contraseña actual equivocada («La contraseña actual no es correcta») y otro con la nueva demasiado corta, la pantalla muestra a la vez el aviso viejo y el nuevo, con los textos montados uno sobre otro.',
);
push(
  '- **H4. Pegar un texto que no es una oferta da un error genérico (solo en `replay`).** Caso [K06](#caso-k06). Con `AI_MOCK_MODE=replay` un texto sin fixture lanza `FixtureMissing` y el diálogo dice «Algo salió mal. Inténtalo de nuevo» en vez de «Eso no parece una oferta de trabajo…» (que sí existe en el código). Es una limitación del mock, no del producto: con `synth` o con IA real, el mensaje depende de la respuesta. Se deja anotado porque el mensaje correcto no se puede ver con esta pila.',
);
push(
  '- **H5. Guardar una clave de IA sin bóveda da un error genérico.** Caso [B03](#caso-b03). Con `AI_VAULT_KEY` vacía la API responde 503 y el perfil dice «Algo salió mal. Inténtalo de nuevo» en vez de decir que las claves propias no están disponibles. Ya era el H3 de septiembre; el change `usage-guide-fixes` lo difirió (en producción `AI_VAULT_KEY` es obligatoria).',
);
push(
  '- **H6. No hay modo oscuro.** Caso [W10](#caso-w10). Con `prefers-color-scheme: dark` la interfaz sigue clara (`color-scheme: light` fijo en `apps/web/src/styles.scss`, tema Material solo claro). Ninguna spec lo promete; se anota para quien espere el modo oscuro.',
);
push(
  '- **H7. Los campos de fecha salen como `mm/dd/yyyy`.** Caso [K05](#caso-k05), captura `corregir-oferta-relleno`: «Publicada el» y «Cierra el» muestran el orden de mes y día estadounidense en una interfaz en español. Visto en Chromium sin interfaz con `locale es-ES`; puede depender del sistema. Era el H7 de septiembre, diferido por `usage-guide-fixes`.',
);
push(
  '- **H8. La interfaz en inglés no se puede levantar con los targets del proyecto.** `apps/web/project.json` define el locale `en` pero no hay target que lo construya ni lo sirva (ADR-050 lo deja pendiente; el catálogo ya lo anota). Para esta guía se construyó con `--localize=en` y se sirvió con `tools/guia-de-uso/serve-en.mts`. Las rutas siguen en español en el build en inglés.',
);
push();
push(
  '**Corregido desde septiembre** (comprobado en esta pasada): el nombre de quien escribió una oferta ya no llega a quien la guarda desde el enlace público (`E03`: «Escrito por otra persona»), el texto de ayuda de «Grupo para avisos de estado» ya no se monta sobre «Preferencias guardadas» (`T01`), el aviso «Compartido · Deshacer» se cierra al navegar (`A05`) y el campo de URL ya no queda en rojo tras guardar (`K01`).',
);
push();
push(
  '**No se pudo probar en esta pila** (ver [la tabla](#lo-que-no-tiene-pantalla-o-no-se-pudo-probar-en-esta-pila)): plan de estudio con contenido, Buscar y Descubrir con resultados, frescura automática, resumen semanal, push real, claves propias guardadas, IA externa real, extensión y CLI.',
);
push();
push('**Pruebas**');
push();
push(
  '- **H9.** Los specs del camino antiguo (`home.spec.ts`, `groups.spec.ts`) llevaban `http://localhost:4200` escrito a mano en septiembre y fallaban contra la pila del bloque; esta pasada no los volvió a ejecutar (ver [Pruebas automatizadas](#pruebas-automatizadas)).',
);
push(
  '- **H10.** Con `AI_MOCK_MODE=replay`, `critique-suggestions` no tiene fixture para el informe del camino crítico: el worker registra «critique-suggestions failed (FixtureMissing); keeping generator report» y el informe queda con las sugerencias del generador; no se nota en la pantalla (ya anotado en septiembre).',
);
push();

// ------------------------------------------------------------------------------------------------ cambios
push('## Qué cambió respecto de la guía de septiembre');
push();
push(
  'La guía de septiembre (2026-09-28, sobre `0f307c6e`) tenía 30 pasos y 100 capturas, todas de escritorio salvo cuatro del móvil, y probaba solo el camino feliz. Desde entonces cambiaron 25 ficheros de `apps/web/src` y se archivaron changes nuevos (`object-store`, `ai-usage-consent-reason`, `usage-guide-fixes`, `angular-22-2`…). Ahora:',
);
push();
push(
  '- **Se rehízo todo con capturas nuevas** (las 100 anteriores se borraron; ninguna imagen queda sin referenciar).',
);
push(
  '- **Se agregaron los estados que faltaban:** validaciones de login, registro, recuperación y restablecimiento; enlaces inválidos y usados; rutas inexistentes; error de URL y de nota larga; archivos de CV rechazados, CV sin texto y CV por defecto inservible; ofertas ya existentes; pegar y deshacer, «Volver a lo anterior», quitar oferta y nota; tablero vacío, fecha futura, cierre de postulaciones y dejar de seguir; comentarios largos y borrar lo ajeno; volver a compartir un enlace público; lista privada con oferta ya en un grupo, oferta cerrada y «Reabrir», importar un chat; Buscar y Descubrir con consulta vacía; grupo de avisos de estado; código de invitación regenerado, expulsar con código viejo, ceder la propiedad, salir, borrar y grupo inexistente; borrar la cuenta con validaciones y con «único propietario».',
);
push(
  '- **Se agregaron tandas completas:** móvil (Pixel 7) en 12 pantallas, inglés en 9, y la comprobación del modo oscuro.',
);
push(
  '- **Se agregó** la lista de comprobación, el entorno paso a paso (pila aislada y forma de desarrollo del README) y el script de capturas reproducible (`tools/guia-de-uso/`).',
);
push(
  '- **Se quitó** el paso 15 «Plan de estudio» como sin captura: sigue sin ser alcanzable con `replay`, y ahora está en «Lo que no se pudo probar», con la pantalla del análisis inexistente (`M05`).',
);
push(
  '- **Se cerraron** los hallazgos H1, H2, H4, H5 y H6 de septiembre (los corrigió `usage-guide-fixes`); siguen H3 (ahora H5) y H7 (ahora H7), y hay hallazgos nuevos (H1, H2, H3, H6 de esta guía).',
);
push();

writeFileSync(join('docs', 'guia-de-uso', 'README.md'), `${out.join('\n')}\n`);
process.stdout.write(`guía escrita: ${total} casos, ${shots} capturas\n`);
