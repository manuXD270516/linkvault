import rootPackage from '../../../../package.json';

/** Versión del `package.json` raíz, incluida en el bundle por el build. */
export const PACKAGE_VERSION: string = rootPackage.version;

/** `APP_VERSION` si el build o el entorno la inyectan; si no, la del `package.json` raíz (D9). */
export function resolveAppVersion(appVersion: string | undefined): string {
  return appVersion ?? PACKAGE_VERSION;
}
