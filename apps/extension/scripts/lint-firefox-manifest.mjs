/**
 * Contract lint for the Firefox MV3 build (FF >= 121).
 * Firefox does not support background.service_worker in MV3 (MDN manifest.json/background; bug 1573659): it starts
 * the background as an event page from background.scripts. MDN recommends declaring both keys for a cross-browser
 * extension; Firefox 121+ starts the background page when both are present. web-ext 8.x still flags service_worker
 * as unsupported, so this contract lint replaces `web-ext lint`; AMO's online validator stays the authority at
 * submit time.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.cwd(), 'dist/apps/extension-firefox');
const manifestPath = resolve(outDir, 'manifest.json');

function fail(message) {
  process.stderr.write(`[extension:lint-firefox] ${message}\n`);
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  fail(`missing ${manifestPath}; run extension:build-firefox first`);
}

/** @type {Record<string, unknown>} */
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.manifest_version !== 3) {
  fail(`manifest_version must be 3, got ${String(manifest.manifest_version)}`);
}

const background = manifest.background;
const scripts = /** @type {{ scripts?: unknown }} */ (background)?.scripts;
if (
  typeof background !== 'object' ||
  background === null ||
  /** @type {{ service_worker?: unknown }} */ (background).service_worker !== 'background.js' ||
  /** @type {{ type?: unknown }} */ (background).type !== 'module' ||
  !Array.isArray(scripts) ||
  scripts.length !== 1 ||
  scripts[0] !== 'background.js'
) {
  fail(
    'background must be { scripts: ["background.js"], service_worker: "background.js", type: "module" }',
  );
}

const gecko =
  /** @type {{ browser_specific_settings?: { gecko?: { id?: string; strict_min_version?: string } } }} */ (
    manifest
  ).browser_specific_settings?.gecko;

if (gecko?.id !== 'linkvault@linkvault.app') {
  fail(`gecko.id must be linkvault@linkvault.app, got ${String(gecko?.id)}`);
}

const minVersion = gecko?.strict_min_version ?? '';
if (!/^12[1-9]\./.test(minVersion) && !/^1[3-9]\d\./.test(minVersion)) {
  fail(`gecko.strict_min_version must be ≥ 121.0, got ${minVersion}`);
}

const hosts = manifest.host_permissions;
if (!Array.isArray(hosts) || hosts.length === 0) {
  fail('host_permissions must be a non-empty array');
}

for (const relative of ['background.js', 'popup.html', '_locales/es/messages.json']) {
  if (!existsSync(resolve(outDir, relative))) {
    fail(`missing required file ${relative}`);
  }
}

process.stdout.write(
  `[extension:lint-firefox] OK ${JSON.stringify({
    geckoId: gecko.id,
    strictMinVersion: gecko.strict_min_version,
    host_permissions: hosts,
  })}\n`,
);
