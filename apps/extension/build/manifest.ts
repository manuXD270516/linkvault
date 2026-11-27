export const GECKO_EXTENSION_ID = 'linkvault@linkvault.app';
export const GECKO_STRICT_MIN_VERSION = '121.0';

export type ExtensionTarget = 'chrome' | 'firefox';

export interface ExtensionManifestOptions {
  apiBaseUrl: string;
  target: ExtensionTarget;
}

function hostPermissionFor(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  return `${url.origin}/*`;
}

/** Pure composition of the final manifest from the parsed template; returns a copy. */
export function buildExtensionManifest(
  template: Readonly<Record<string, unknown>>,
  options: ExtensionManifestOptions,
): Record<string, unknown> {
  const manifest = structuredClone(template) as Record<string, unknown>;
  manifest['host_permissions'] = [hostPermissionFor(options.apiBaseUrl)];
  if (options.target === 'firefox') {
    manifest['browser_specific_settings'] = {
      gecko: {
        id: GECKO_EXTENSION_ID,
        strict_min_version: GECKO_STRICT_MIN_VERSION,
      },
    };
  }
  return manifest;
}
