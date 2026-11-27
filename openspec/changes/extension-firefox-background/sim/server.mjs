// Sirve el build de Firefox + la página de simulación en :4310 y hace proxy de /api a la API de la pila e2e (:3100).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const [,, distDir, simDir] = process.argv;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const up = http.request({ host: '127.0.0.1', port: 3100, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:3100' } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up); return;
  }
  const path = decodeURIComponent(req.url.split('?')[0]).split('/').filter((x) => x && x !== '..').join('/');
  for (const base of [simDir, distDir]) {
    try { const body = await readFile(join(base, path || 'sim.html')); res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }); res.end(body); return; } catch {}
  }
  res.writeHead(404); res.end('not found');
}).listen(4310, '127.0.0.1', () => console.log('sim on http://localhost:4310'));
