import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(rootDir, '../../dist/apps/extension');

const DEFAULT_API_BASE_URL = 'http://localhost:3000';

function hostPermissionFor(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  return `${url.origin}/*`;
}

function extensionManifestPlugin(apiBaseUrl: string): Plugin {
  return {
    name: 'linkvault-extension-manifest',
    closeBundle() {
      mkdirSync(outDir, { recursive: true });
      const template = JSON.parse(
        readFileSync(resolve(rootDir, 'manifest.template.json'), 'utf8'),
      ) as Record<string, unknown>;
      template['host_permissions'] = [hostPermissionFor(apiBaseUrl)];
      writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(template, null, 2)}\n`);
      cpSync(resolve(rootDir, 'public/_locales'), resolve(outDir, '_locales'), {
        recursive: true,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(rootDir, '../..'), '');
  const apiBaseUrl = (env['EXTENSION_API_BASE_URL'] ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');

  return {
    root: rootDir,
    base: './',
    publicDir: false,
    define: {
      __EXTENSION_API_BASE_URL__: JSON.stringify(apiBaseUrl),
    },
    build: {
      outDir,
      emptyOutDir: true,
      target: 'chrome120',
      modulePreload: false,
      cssCodeSplit: false,
      rollupOptions: {
        input: {
          popup: resolve(rootDir, 'popup.html'),
          background: resolve(rootDir, 'src/background/service-worker.ts'),
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'background' ? 'background.js' : 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
    plugins: [extensionManifestPlugin(apiBaseUrl)],
  };
});
