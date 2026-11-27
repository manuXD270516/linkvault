import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExtensionManifest } from './manifest';

const template = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../manifest.template.json'), 'utf8'),
) as Record<string, unknown>;

const apiBaseUrl = 'http://localhost:3000/';

describe('buildExtensionManifest', () => {
  it('sets host_permissions to the API origin', () => {
    const manifest = buildExtensionManifest(template, { apiBaseUrl, target: 'chrome' });
    expect(manifest['host_permissions']).toEqual(['http://localhost:3000/*']);
  });

  it('adds gecko id and strict_min_version 121.0 only for firefox', () => {
    const firefox = buildExtensionManifest(template, { apiBaseUrl, target: 'firefox' });
    const chrome = buildExtensionManifest(template, { apiBaseUrl, target: 'chrome' });
    expect(firefox['browser_specific_settings']).toEqual({
      gecko: { id: 'linkvault@linkvault.app', strict_min_version: '121.0' },
    });
    expect('browser_specific_settings' in chrome).toBe(false);
  });

  it('keeps chrome background as module service worker without scripts', () => {
    const manifest = buildExtensionManifest(template, { apiBaseUrl, target: 'chrome' });
    const background = manifest['background'] as Record<string, unknown>;
    expect(background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect('scripts' in background).toBe(false);
  });

  it('declares background scripts next to the module service worker for firefox', () => {
    const manifest = buildExtensionManifest(template, { apiBaseUrl, target: 'firefox' });
    expect(manifest['background']).toEqual({
      scripts: ['background.js'],
      service_worker: 'background.js',
      type: 'module',
    });
  });

  it('does not mutate the template', () => {
    const before = structuredClone(template);
    buildExtensionManifest(template, { apiBaseUrl, target: 'chrome' });
    expect(template).toEqual(before);
    buildExtensionManifest(template, { apiBaseUrl, target: 'firefox' });
    expect(template).toEqual(before);
  });
});
