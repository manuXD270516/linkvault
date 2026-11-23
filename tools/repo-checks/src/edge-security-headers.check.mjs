/**
 * Comprobación: las cabeceras de seguridad del borde y del SPA siguen donde ADR-057 las puso (D8, regla estática).
 *
 * Qué mira, y falla nombrando el fichero y el router, el `location` o la directiva:
 *
 *  1. todo router con `websecure` en `infra/traefik/dynamic.yml` lleva el middleware `edge-hsts`, y éste tiene
 *     `stsSeconds >= 604800`, `stsIncludeSubdomains: true` y no `stsPreload: true`. **Sin excepción**: HSTS no tiene
 *     vuelta atrás (D7, F2), así que `stsSeconds: 0` falla como cualquier valor menor, haya o no un comentario;
 *  2. el router `web` conserva `spa-referrer-policy` (la tarea 6.11 de 35b depende de él);
 *  3. el bloque `server` de `docker/web/nginx.conf` declara, con `always`, las seis cabeceras del SPA; ningún
 *     `location` declara un `add_header` (trampa de herencia de nginx); y `Cache-Control` es la ÚNICA cabecera del
 *     `server` sin `always` (para que un 404 no reciba `immutable`). Excepción única y fechada, de vuelta atrás de la
 *     CSP: `Content-Security-Policy-Report-Only` en lugar de la aplicada solo con una línea
 *     `# csp-report-only: AAAA-MM-DD <motivo>`; esa línea solo vale si NO hay una `Content-Security-Policy` aplicada;
 *  4. la CSP de nginx (la aplicada o, bajo la excepción, la `-Report-Only`) lleva `frame-ancestors 'none'`, no tiene
 *     `'unsafe-eval'` y su `script-src` (o `default-src`, si falta) solo admite `'self'`/`'none'`;
 *  5. `apps/web/project.json` tiene `inlineCritical: false` en la configuración de producción;
 *  6. `libs/shared/src/zod-jitless.ts` llama a `z.config({ jitless: true })` y ningún otro fichero de `libs/shared/src`
 *     importa `zod` como valor: los esquemas importan `z` de ese módulo, así la configuración corre antes de construir
 *     ninguno (sin ella zod sondea `new Function('')` por carga y la CSP informa una violación).
 *
 * Qué NO comprueba: que la política sea buena para el SPA (eso lo mide el barrido de la tarea 7.1) ni que nginx la sirva
 * (tarea 3.2 y staging).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { WORKSPACE_ROOT, relativeToRoot } from './lib/compose.mjs';
import { fail, pass } from './lib/report.mjs';

const NAME = 'edge-security-headers';
const DYNAMIC = join(WORKSPACE_ROOT, 'infra/traefik/dynamic.yml');
const NGINX = join(WORKSPACE_ROOT, 'docker/web/nginx.conf');
const WEB_PROJECT = join(WORKSPACE_ROOT, 'apps/web/project.json');
const SHARED_SRC = join(WORKSPACE_ROOT, 'libs/shared/src');

const HSTS_MIN_SECONDS = 604800;
const CSP = 'content-security-policy';
const CSP_REPORT_ONLY = 'content-security-policy-report-only';
const OTHER_SPA_HEADERS = [
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
];
const EXCEPTION_LINE =
  /^[ \t]*#[ \t]*csp-report-only:[ \t]*(\d{4}-\d{2}-\d{2})[ \t]+(\S.*)$/m;

const findings = [];
let looked = 0;

// ---------------------------------------------------------------------------------------------------------------
// Traefik
// ---------------------------------------------------------------------------------------------------------------
function checkTraefik() {
  const file = relativeToRoot(DYNAMIC);
  const document = parse(readFileSync(DYNAMIC, 'utf8'));
  const routers = Object.entries(document?.http?.routers ?? {});
  const hsts = document?.http?.middlewares?.['edge-hsts']?.headers;

  // Regla 1: edge-hsts en todo router de websecure (every websecure router has edge-hsts).
  for (const [name, router] of routers) {
    looked += 1;
    const secure = (router?.entryPoints ?? []).includes('websecure');
    if (secure && !(router?.middlewares ?? []).includes('edge-hsts')) {
      findings.push(
        `${file}: el router '${name}' (websecure) no lista el middleware 'edge-hsts'`,
      );
    }
  }

  // Regla 1: el middleware (edge-hsts is at least seven days with subdomains and without preload).
  if (hsts === undefined) {
    findings.push(`${file}: falta el middleware 'edge-hsts' (headers)`);
  } else {
    looked += 1;
    const seconds = hsts.stsSeconds;
    if (typeof seconds !== 'number' || seconds < HSTS_MIN_SECONDS) {
      findings.push(
        `${file}: edge-hsts max-age ${String(seconds)} < ${HSTS_MIN_SECONDS}: HSTS no tiene vuelta atrás y no admite excepción (ADR-057 D7)`,
      );
    }
    if (hsts.stsIncludeSubdomains !== true) {
      findings.push(`${file}: edge-hsts debe tener stsIncludeSubdomains: true`);
    }
    if (hsts.stsPreload === true) {
      findings.push(
        `${file}: edge-hsts no puede tener stsPreload: true (imposible sobre sslip.io, ADR-057 D7)`,
      );
    }
  }

  // Regla 2: el router web conserva spa-referrer-policy (the web router keeps spa-referrer-policy).
  looked += 1;
  const webMiddlewares =
    routers.find(([name]) => name === 'web')?.[1]?.middlewares ?? [];
  if (!webMiddlewares.includes('spa-referrer-policy')) {
    findings.push(
      `${file}: el router 'web' perdió el middleware 'spa-referrer-policy' (la 6.11 de staging-host depende de él)`,
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// nginx: un analizador mínimo de bloques y directivas
// ---------------------------------------------------------------------------------------------------------------

/**
 * Convierte el texto en un árbol `{ head, line, children }`. Respeta comillas, `#` de comentario y los saltos de línea
 * para numerar. Las directivas son `{ tokens, line }`.
 */
function parseNginx(text) {
  const root = { head: '', line: 0, children: [] };
  const stack = [root];
  let tokens = [];
  let current = '';
  let quote = null;
  let line = 1;
  let startLine = 1;
  const flushWord = () => {
    if (current !== '') {
      tokens.push(current);
      current = '';
    }
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\n') line += 1;
    if (quote !== null) {
      if (char === quote) {
        quote = null;
        tokens.push(current);
        current = '';
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      flushWord();
      quote = char;
      if (tokens.length === 0) startLine = line;
      continue;
    }
    if (char === '#') {
      flushWord();
      while (i + 1 < text.length && text[i + 1] !== '\n') i += 1;
      continue;
    }
    if (/\s/.test(char)) {
      flushWord();
      continue;
    }
    if (char === ';') {
      flushWord();
      stack[stack.length - 1].children.push({ tokens, line: startLine });
      tokens = [];
      continue;
    }
    if (char === '{') {
      flushWord();
      const block = { head: tokens.join(' '), line: startLine, children: [] };
      stack[stack.length - 1].children.push(block);
      stack.push(block);
      tokens = [];
      continue;
    }
    if (char === '}') {
      flushWord();
      if (stack.length > 1) stack.pop();
      tokens = [];
      continue;
    }
    if (tokens.length === 0 && current === '') startLine = line;
    current += char;
  }
  return root;
}

function isBlock(node) {
  return Array.isArray(node.children);
}

/** `add_header` anidados bajo `block`, con la ruta de bloques que los contiene. */
function nestedAddHeaders(block, trail = []) {
  const found = [];
  for (const child of block.children) {
    if (isBlock(child)) {
      found.push(...nestedAddHeaders(child, [...trail, child.head]));
    } else if (trail.length > 0 && child.tokens[0] === 'add_header') {
      found.push({ node: child, trail });
    }
  }
  return found;
}

function parseCsp(value) {
  const directives = new Map();
  for (const part of value.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

function checkNginx() {
  const file = relativeToRoot(NGINX);
  const text = readFileSync(NGINX, 'utf8');
  const tree = parseNginx(text);
  const server = tree.children.find(
    (node) => isBlock(node) && node.head === 'server',
  );
  if (server === undefined) {
    findings.push(`${file}: no declara ningún bloque 'server'`);
    return;
  }
  looked += 1;

  // Cabeceras del nivel `server`.
  const headers = server.children
    .filter((node) => !isBlock(node) && node.tokens[0] === 'add_header')
    .map((node) => ({
      name: (node.tokens[1] ?? '').toLowerCase(),
      value: node.tokens[2] ?? '',
      always: node.tokens[3] === 'always',
      line: node.line,
    }));
  const byName = (name) => headers.filter((header) => header.name === name);

  // Regla 3: ningún location declara add_header (no nginx location declares add_header).
  for (const { node, trail } of nestedAddHeaders(server, [])) {
    findings.push(
      `${file}:${node.line}: el bloque '${trail.join(' > ')}' declara 'add_header ${node.tokens[1] ?? ''}': nginx no hereda los add_header del server en un location que declare los suyos`,
    );
  }

  // Regla 3: Report-Only y su excepción fechada.
  const enforced = byName(CSP);
  const reportOnly = byName(CSP_REPORT_ONLY);
  const exception = EXCEPTION_LINE.exec(text);
  let policy;
  if (enforced.length > 0) {
    if (exception !== null) {
      findings.push(
        `${file}: la línea '# csp-report-only: ${exception[1]} …' convive con una Content-Security-Policy aplicada: es una excepción olvidada (vale solo sin ninguna aplicada, aunque haya una -Report-Only adicional)`,
      );
    }
    policy = enforced[0];
  } else if (reportOnly.length > 0) {
    if (exception === null) {
      findings.push(
        `${file}: Content-Security-Policy-Report-Only sin la línea '# csp-report-only: AAAA-MM-DD <motivo>' que la admite como vuelta atrás`,
      );
    }
    policy = reportOnly[0];
  } else {
    findings.push(
      `${file}: el bloque server no declara Content-Security-Policy`,
    );
  }

  // Regla 3: las seis cabeceras, con always.
  const required = [
    policy === undefined ? CSP : policy.name,
    ...OTHER_SPA_HEADERS,
  ];
  for (const name of required) {
    const present = byName(name);
    if (present.length === 0) {
      findings.push(
        `${file}: el bloque server no declara la cabecera '${name}' del SPA`,
      );
    }
  }

  // Regla 3: Cache-Control es la única sin always.
  const cacheControl = byName('cache-control');
  if (cacheControl.length === 0) {
    findings.push(
      `${file}: el bloque server no declara 'Cache-Control' (map $lv_cache_control)`,
    );
  }
  for (const header of cacheControl) {
    if (header.always) {
      findings.push(
        `${file}:${header.line}: 'Cache-Control' lleva 'always': un 404 recibiría 'immutable' (E3); es la única cabecera del server sin always`,
      );
    }
  }
  for (const header of headers) {
    if (header.name !== 'cache-control' && !header.always) {
      findings.push(
        `${file}:${header.line}: la cabecera '${header.name}' del server no lleva 'always' (solo Cache-Control lo omite)`,
      );
    }
  }

  // Regla 4: la política.
  if (policy !== undefined) {
    looked += 1;
    const directives = parseCsp(policy.value);
    if (!(directives.get('frame-ancestors') ?? []).includes("'none'")) {
      findings.push(
        `${file}:${policy.line}: la CSP del SPA no tiene frame-ancestors 'none'`,
      );
    }
    for (const [name, sources] of directives) {
      if (sources.includes("'unsafe-eval'")) {
        findings.push(
          `${file}:${policy.line}: la CSP del SPA tiene 'unsafe-eval' en ${name}`,
        );
      }
    }
    const scriptDirective = directives.has('script-src')
      ? 'script-src'
      : 'default-src';
    const scriptSources = directives.get(scriptDirective);
    if (scriptSources === undefined) {
      findings.push(
        `${file}:${policy.line}: la CSP del SPA no declara script-src ni default-src`,
      );
    } else {
      for (const source of scriptSources) {
        if (source !== "'self'" && source !== "'none'") {
          findings.push(
            `${file}:${policy.line}: ${scriptDirective} de la CSP del SPA admite ${source}: solo 'self' (sin script en línea ni externo)`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Build de web
// ---------------------------------------------------------------------------------------------------------------
function checkWebBuild() {
  const file = relativeToRoot(WEB_PROJECT);
  const project = JSON.parse(readFileSync(WEB_PROJECT, 'utf8'));
  const optimization =
    project.targets?.build?.configurations?.production?.optimization;
  looked += 1;
  if (optimization?.styles?.inlineCritical !== false) {
    findings.push(
      `${file}: build.configurations.production.optimization.styles.inlineCritical debe ser false (el CSS crítico mete un onload en línea que la CSP bloquea y deja la página sin estilos)`,
    );
  }
}

function sharedSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sharedSources(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

function checkSharedJitless() {
  const jitlessFile = join(SHARED_SRC, 'zod-jitless.ts');
  looked += 1;
  if (
    !/z\.config\(\s*\{\s*jitless:\s*true\s*\}\s*\)/.test(
      readFileSync(jitlessFile, 'utf8'),
    )
  ) {
    findings.push(
      relativeToRoot(jitlessFile) +
        ': debe llamar a z.config({ jitless: true })',
    );
  }
  for (const file of sharedSources(SHARED_SRC)) {
    if (file === jitlessFile) continue;
    looked += 1;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/^import\s+(?!type\b)[^;]*from\s+['"]zod['"]/.test(line)) {
        findings.push(
          relativeToRoot(file) +
            ':' +
            (index + 1) +
            ": importa 'zod' directamente: los esquemas de @linkvault/shared importan z de zod-jitless, que corre antes de construir ninguno (ADR-057)",
        );
      }
    });
  }
}

checkTraefik();
checkNginx();
checkWebBuild();
checkSharedJitless();

if (findings.length > 0) {
  fail(
    NAME,
    findings,
    'ver ADR-057 y openspec/changes/edge-security-headers/design.md (D1-D8)',
  );
}

pass(
  NAME,
  `${looked} comprobaciones sobre ${relativeToRoot(DYNAMIC)}, ${relativeToRoot(NGINX)} y ${relativeToRoot(WEB_PROJECT)}`,
);
