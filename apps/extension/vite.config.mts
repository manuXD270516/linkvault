import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { buildExtensionManifest } from './build/manifest';

const rootDir = dirname(fileURLToPath(import.meta.url));

const DEFAULT_API_BASE_URL = 'http://localhost:3000';

function extensionManifestPlugin(
  apiBaseUrl: string,
  outDir: string,
  target: 'chrome' | 'firefox',
): Plugin {
  return {
    name: 'linkvault-extension-manifest',
    closeBundle() {
      mkdirSync(outDir, { recursive: true });
      const template = JSON.parse(
        readFileSync(resolve(rootDir, 'manifest.template.json'), 'utf8'),
      ) as Record<string, unknown>;
      const manifest = buildExtensionManifest(template, { apiBaseUrl, target });
      writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      cpSync(resolve(rootDir, 'public/_locales'), resolve(outDir, '_locales'), {
        recursive: true,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const target: 'chrome' | 'firefox' = mode === 'firefox' ? 'firefox' : 'chrome';
  const outDir = resolve(
    rootDir,
    target === 'firefox'
      ? '../../dist/apps/extension-firefox'
      : '../../dist/apps/extension',
  );
  // Load shared .env then mode-specific (firefox falls back to keys in root .env).
  const env = {
    ...loadEnv('development', resolve(rootDir, '../..'), ''),
    ...loadEnv(mode, resolve(rootDir, '../..'), ''),
  };
  const apiBaseUrl = (env['EXTENSION_API_BASE_URL'] ?? DEFAULT_API_BASE_URL).replace(
    /\/$/,
    '',
  );

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
      target: target === 'firefox' ? 'firefox121' : 'chrome120',
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
    plugins: [extensionManifestPlugin(apiBaseUrl, outDir, target)],
  };
});
