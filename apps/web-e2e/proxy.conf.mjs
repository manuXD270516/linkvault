// Proxy de `web` para la suite end-to-end (design D3, fase 3; antigua tarea 2.2): `/api` → la `api` del bloque de la
// suite. El runner sirve `nx serve web -c production` con este fichero en lugar de `apps/web/proxy.conf.json` (que
// apunta a la `api` de desarrollo, `3000`), y el puerto llega por `API_PORT`, la misma variable del entorno de la suite
// (`apps/web-e2e/e2e.env`, recalculada por el runner si se anula con `--api-port`) con la que escucha la `api`.
const apiPort = process.env['API_PORT'];

if (apiPort === undefined || !/^\d+$/.test(apiPort)) {
  throw new Error(
    'apps/web-e2e/proxy.conf.mjs: API_PORT is not set; this proxy is only for the e2e runner (pnpm nx run web-e2e:e2e-stack)',
  );
}

export default {
  '/api': {
    target: `http://localhost:${apiPort}`,
    secure: false,
    changeOrigin: false,
    logLevel: 'warn',
  },
};
