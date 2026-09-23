// Guards del seed de demostración (ADR-042 / D4): fallar sin escribir si el entorno no es local.

/** Hosts Mongo permitidos para `api:seed-demo` (fail closed). */
export const DEMO_SEED_MONGO_HOST_ALLOWLIST: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'mongo',
  'host.docker.internal',
]);

export class DemoSeedGuardError extends Error {
  override readonly name = 'DemoSeedGuardError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * URI de Mongo que usará el seed: `MONGO_URI` (config de api) o, si falta, `MONGODB_URI`
 * (nombre del design/ADR). Vacío → guard falla.
 */
export function resolveDemoSeedMongoUri(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const mongoUri = env['MONGO_URI']?.trim();
  if (mongoUri !== undefined && mongoUri !== '') {
    return mongoUri;
  }
  const mongodbUri = env['MONGODB_URI']?.trim();
  if (mongodbUri !== undefined && mongodbUri !== '') {
    return mongodbUri;
  }
  return undefined;
}

/**
 * Extrae **cada** host de un URI `mongodb://` / `mongodb+srv://` (réplicas, credenciales, IPv6).
 * Lanza `DemoSeedGuardError` si el URI no es reconocible.
 */
export function mongoHostsFromUri(uri: string): string[] {
  const match = /^mongodb(\+srv)?:\/\//i.exec(uri);
  if (match === null) {
    throw new DemoSeedGuardError(
      'MONGO_URI must start with mongodb:// or mongodb+srv://',
    );
  }
  const withoutScheme = uri.slice(match[0].length);
  const at = withoutScheme.lastIndexOf('@');
  const afterCreds = at === -1 ? withoutScheme : withoutScheme.slice(at + 1);
  const authorityEnd = afterCreds.search(/[/?]/);
  const authority =
    authorityEnd === -1 ? afterCreds : afterCreds.slice(0, authorityEnd);
  if (authority.trim() === '') {
    throw new DemoSeedGuardError('MONGO_URI has no hosts');
  }
  return authority.split(',').map((part) => hostOfAuthorityPart(part.trim()));
}

/**
 * Comprueba NODE_ENV, ALLOW_DEMO_SEED y allowlist de hosts Mongo. No escribe nada.
 * Lanza `DemoSeedGuardError` si debe abortar.
 */
export function assertDemoSeedAllowed(
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (env['NODE_ENV'] === 'production') {
    throw new DemoSeedGuardError(
      'demo seed refused: NODE_ENV=production',
    );
  }
  if (env['ALLOW_DEMO_SEED'] !== 'true') {
    throw new DemoSeedGuardError(
      'demo seed refused: set ALLOW_DEMO_SEED=true',
    );
  }
  const uri = resolveDemoSeedMongoUri(env);
  if (uri === undefined) {
    throw new DemoSeedGuardError(
      'demo seed refused: MONGO_URI (or MONGODB_URI) is missing',
    );
  }
  const hosts = mongoHostsFromUri(uri);
  const forbidden = hosts.filter(
    (host) => !DEMO_SEED_MONGO_HOST_ALLOWLIST.has(host),
  );
  if (forbidden.length > 0) {
    throw new DemoSeedGuardError(
      `demo seed refused: Mongo host(s) not in allowlist: ${forbidden.join(', ')}`,
    );
  }
}

function hostOfAuthorityPart(hostPort: string): string {
  if (hostPort === '') {
    throw new DemoSeedGuardError('MONGO_URI has an empty host entry');
  }
  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']');
    if (end === -1) {
      throw new DemoSeedGuardError('MONGO_URI has a malformed IPv6 host');
    }
    return hostPort.slice(1, end);
  }
  const colon = hostPort.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(hostPort.slice(colon + 1))) {
    return hostPort.slice(0, colon);
  }
  return hostPort;
}
