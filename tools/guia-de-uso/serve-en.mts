/**
 * Sirve el build en inglés de `web` junto a la pila e2e (la pila sirve solo el build en español).
 *
 * `apps/web/project.json` define el locale `en` pero ningún target lo construye ni lo sirve (ADR-050 deja pendiente
 * publicarlo), así que esta guía construye el build en inglés a mano y lo sirve aquí, con un proxy de `/api` hacia la
 * API de la pila. No es parte del producto: es solo para capturar las pantallas en inglés.
 *
 *   pnpm nx run web:build:production --localize=en --output-path=dist/guia-web-en
 *   node --import tsx tools/guia-de-uso/serve-en.mts            # http://localhost:4301/en/
 *
 * Variables: `EN_PORT` (4301), `API_ORIGIN` (http://localhost:3100), `EN_DIR` (dist/guia-web-en/browser).
 */
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.env['EN_PORT'] ?? '4301');
const apiOrigin = new URL(process.env['API_ORIGIN'] ?? 'http://localhost:3100');
const root = resolve(process.env['EN_DIR'] ?? 'dist/guia-web-en/browser');

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    const upstream = httpRequest(
      {
        host: apiOrigin.hostname,
        port: apiOrigin.port,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers: {
          ...req.headers,
          host: `${apiOrigin.hostname}:${apiOrigin.port}`,
        },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502).end();
    });
    req.pipe(upstream);
    return;
  }
  if (!url.pathname.startsWith('/en/')) {
    res.writeHead(302, { location: `/en${url.pathname}${url.search}` }).end();
    return;
  }
  const relative = normalize(decodeURIComponent(url.pathname)).replace(
    /^([/\\])+/,
    '',
  );
  let file = join(root, relative);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    file = join(root, 'en', 'index.html'); // fallback del SPA
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  writeFileSync(join(root, '..', 'serve-en.pid'), String(process.pid));
  process.stdout.write(
    `build en inglés en http://localhost:${port}/en/ (API ${apiOrigin.origin})\n`,
  );
});
