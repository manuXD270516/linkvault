import { createHash } from 'node:crypto';

/**
 * Bloque de puertos de la suite (design D4). El bloque por defecto vive en `apps/web-e2e/e2e.env`; una anulación por
 * flag lo desplaza, y a partir del bloque **efectivo** se recalculan las URIs que llegan a las aplicaciones.
 */
export interface PortBlock {
  readonly web: number;
  readonly api: number;
  readonly worker: number;
  readonly mongo: number;
  readonly redis: number;
  readonly objectStore: number;
  readonly mailpitSmtp: number;
  readonly mailpitUi: number;
  /** Inspector de `api` y de `worker`: solo se usan con `--stack-fault=inspect`, pero son del bloque (D3, D4). */
  readonly apiInspector: number;
  readonly workerInspector: number;
}

export type PortName = keyof PortBlock;

/** Orden fijo: el nombre del proyecto de compose depende de él. */
export const PORT_NAMES: readonly PortName[] = [
  'web',
  'api',
  'worker',
  'mongo',
  'redis',
  'objectStore',
  'mailpitSmtp',
  'mailpitUi',
  'apiInspector',
  'workerInspector',
];

/** Inspector fijo del bloque (design D4): no tiene flag. */
export const INSPECTOR_PORTS = { apiInspector: 9329, workerInspector: 9330 } as const;

/**
 * Variables de `e2e.env` que fijan el bloque por defecto. `web` no tiene variable propia: su puerto es el de
 * `WEB_BASE_URL`, el origen del SPA que las aplicaciones ya reciben.
 */
export const BLOCK_ENV_KEYS = {
  web: 'WEB_BASE_URL',
  api: 'API_PORT',
  worker: 'WORKER_HEALTH_PORT',
  mongo: 'MONGO_PORT',
  redis: 'REDIS_PORT',
  objectStore: 'OBJECT_STORE_PORT',
  mailpitSmtp: 'MAILPIT_SMTP_PORT',
  mailpitUi: 'MAILPIT_UI_PORT',
} as const;

export type OverridablePort = keyof typeof BLOCK_ENV_KEYS;

/** Flags de anulación del bloque (design D3), nunca variables de entorno. */
export const PORT_FLAGS: Readonly<Record<OverridablePort, string>> = {
  web: '--web-port',
  api: '--api-port',
  worker: '--worker-port',
  mongo: '--mongo-port',
  redis: '--redis-port',
  objectStore: '--object-store-port',
  mailpitSmtp: '--mailpit-smtp-port',
  mailpitUi: '--mailpit-ui-port',
};

export function parsePort(value: string, source: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${source}: "${value}" is not a port number`);
  }
  const port = Number(value);
  if (port < 1 || port > 65_535) {
    throw new Error(`${source}: ${port} is out of range`);
  }
  return port;
}

/** Bloque efectivo: el de `e2e.env` desplazado por los flags. Falla si dos servicios comparten puerto. */
export function resolveBlock(
  suiteEnv: Readonly<Record<string, string>>,
  overrides: Partial<Record<OverridablePort, number>>,
): PortBlock {
  const fromEnv = (name: OverridablePort): number => {
    const override = overrides[name];
    if (override !== undefined) {
      return override;
    }
    const key = BLOCK_ENV_KEYS[name];
    const value = suiteEnv[key];
    if (value === undefined || value === '') {
      throw new Error(`apps/web-e2e/e2e.env does not declare ${key}`);
    }
    if (name === 'web') {
      return parsePort(new URL(value).port, `e2e.env ${key}`);
    }
    return parsePort(value, `e2e.env ${key}`);
  };
  const block: PortBlock = {
    web: fromEnv('web'),
    api: fromEnv('api'),
    worker: fromEnv('worker'),
    mongo: fromEnv('mongo'),
    redis: fromEnv('redis'),
    objectStore: fromEnv('objectStore'),
    mailpitSmtp: fromEnv('mailpitSmtp'),
    mailpitUi: fromEnv('mailpitUi'),
    apiInspector: INSPECTOR_PORTS.apiInspector,
    workerInspector: INSPECTOR_PORTS.workerInspector,
  };
  const seen = new Map<number, PortName>();
  for (const name of PORT_NAMES) {
    const port = block[name];
    const previous = seen.get(port);
    if (previous !== undefined) {
      throw new Error(`port ${port} is assigned to both ${previous} and ${name}`);
    }
    seen.set(port, name);
  }
  return block;
}

export function blockPorts(block: PortBlock): number[] {
  return PORT_NAMES.map((name) => block[name]);
}

/**
 * Ruta del checkout normalizada (design D4): letra de unidad en minúscula, barras `/` y sin separador final, para que
 * `D:\projects\…`, `d:/projects/…` y `d:\projects\…\` den el mismo nombre de proyecto.
 */
export function normalizeCheckoutPath(path: string): string {
  let normalized = path.replace(/\\/g, '/');
  normalized = normalized.replace(/^([A-Za-z]):/, (_match, drive: string) => `${drive.toLowerCase()}:`);
  while (normalized.length > 1 && normalized.endsWith('/') && !/^[a-z]:\/$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/** `linkvault-e2e-<hash8>`: SHA-256 de «ruta normalizada del checkout + bloque efectivo» (design D4). */
export function composeProjectName(checkoutPath: string, block: PortBlock): string {
  const blockKey = PORT_NAMES.map((name) => `${name}=${block[name]}`).join(',');
  const hash = createHash('sha256').update(`${normalizeCheckoutPath(checkoutPath)}\n${blockKey}`).digest('hex');
  return `linkvault-e2e-${hash.slice(0, 8)}`;
}
