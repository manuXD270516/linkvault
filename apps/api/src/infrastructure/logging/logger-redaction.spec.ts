import { Writable } from 'node:stream';
import { Controller, Get, Module } from '@nestjs/common';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  InjectPinoLogger,
  Logger,
  LoggerModule,
  PinoLogger,
} from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildLoggerParams,
  isPublicRouteLog,
  isPublicRouteRequest,
  stripReferer,
} from './logger-params';

const SECRETS = {
  authorization: 'Bearer header-authorization-s3cr3t',
  cookie: 'session=header-cookie-s3cr3t',
  rootApiKey: 'root-api-key-s3cr3t',
  nestedRefreshToken: 'one-level-refresh-token-s3cr3t',
  deepApiKey: 'two-levels-api-key-s3cr3t',
  setCookie: 'refresh=set-cookie-s3cr3t',
  currentPassword: 'current-password-s3cr3t',
  newPassword: 'new-password-s3cr3t',
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$password-hash-s3cr3t',
  inviteCode: 'INV1T3S3CR3T',
  inviteFragment: 'fragment-s3cr3t',
  vaultKeyEnv: 'ai-vault-key-env-s3cr3t',
  ciphertext: 'vault-ciphertext-s3cr3t',
  vaultKeyBytes: 'vault-key-bytes-s3cr3t',
} as const;

/** Peticiones con `referer` (escenarios de "Logs sin secretos"), identificadas por `x-probe`. */
const REFERERS = [
  {
    scenario: 'Petición desde la página de unirse con un código',
    probe: 'referer-join',
    referer: `http://localhost:4200/unirse?codigo=${SECRETS.inviteCode}#${SECRETS.inviteFragment}`,
    logged: 'http://localhost:4200/unirse',
  },
  {
    scenario: 'Referer con el código dentro de returnUrl',
    probe: 'referer-return-url',
    referer: `http://localhost:4200/login?returnUrl=%2Funirse%3Fcodigo%3D${SECRETS.inviteCode}`,
    logged: 'http://localhost:4200/login',
  },
  {
    scenario: 'Referer que no es una URL absoluta',
    probe: 'referer-relative',
    referer: `/unirse?codigo=${SECRETS.inviteCode}#${SECRETS.inviteFragment}`,
    logged: '/unirse',
  },
] as const;

const DEPTHS = [
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'apiKey',
  'accessToken',
  'refreshToken',
  'AI_VAULT_KEY',
  'ciphertext',
  'vaultKey',
].flatMap((field) => [
  { field, depth: 0, value: { [field]: `${field}-depth0-s3cr3t` } },
  { field, depth: 1, value: { a: { [field]: `${field}-depth1-s3cr3t` } } },
  {
    field,
    depth: 2,
    value: { a: { b: { [field]: `${field}-depth2-s3cr3t` } } },
  },
]);

@Controller('log-probe')
class LogProbeController {
  constructor(
    @InjectPinoLogger('LogProbe') private readonly logger: PinoLogger,
  ) {}

  @Get()
  probe(): { ok: true } {
    this.logger.info({ apiKey: SECRETS.rootApiKey }, 'root object');
    this.logger.info(
      {
        session: {
          refreshToken: SECRETS.nestedRefreshToken,
          provider: { apiKey: SECRETS.deepApiKey },
        },
      },
      'nested object',
    );
    // Cuerpo de un cambio de contraseña y usuario con hash (D10 de auth-users), en el primer nivel de anidación.
    this.logger.info(
      {
        body: {
          currentPassword: SECRETS.currentPassword,
          newPassword: SECRETS.newPassword,
        },
        user: { passwordHash: SECRETS.passwordHash },
      },
      'password change',
    );
    // Material del vault BYOK (ADR-032 D10): nunca AI_VAULT_KEY, ciphertext ni vaultKey en claro.
    this.logger.info(
      {
        AI_VAULT_KEY: SECRETS.vaultKeyEnv,
        row: { ciphertext: SECRETS.ciphertext },
        crypto: { vault: { vaultKey: SECRETS.vaultKeyBytes } },
      },
      'byok vault',
    );
    for (const { value } of DEPTHS) {
      this.logger.info(value, 'depth matrix');
    }
    return { ok: true };
  }
}

class MemoryDestination extends Writable {
  readonly lines: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: () => void,
  ): void {
    this.lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
    callback();
  }
}

describe('log redaction', () => {
  const destination = new MemoryDestination();
  let app: NestFastifyApplication;

  beforeAll(async () => {
    @Module({
      imports: [
        LoggerModule.forRoot(
          buildLoggerParams({ LOG_LEVEL: 'info' }, destination),
        ),
      ],
      controllers: [LogProbeController],
    })
    class LogProbeModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [LogProbeModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { bufferLogs: true },
    );
    app.useLogger(app.get(Logger));
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onSend', async (_request, reply) => {
        reply.header('set-cookie', SECRETS.setCookie);
      });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({
      method: 'GET',
      url: '/log-probe',
      headers: {
        authorization: SECRETS.authorization,
        cookie: SECRETS.cookie,
        'x-probe': 'visible',
      },
    });
    expect(response.statusCode).toBe(200);

    for (const { probe, referer } of REFERERS) {
      const withReferer = await app.inject({
        method: 'GET',
        url: '/log-probe',
        headers: { referer, 'x-probe': probe },
      });
      expect(withReferer.statusCode).toBe(200);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  function output(): string {
    return destination.lines.join('\n');
  }

  function requestHeaders(probe: string): Record<string, unknown> | undefined {
    return destination.lines
      .map(
        (line) =>
          JSON.parse(line) as { req?: { headers?: Record<string, unknown> } },
      )
      .find((entry) => entry.req?.headers?.['x-probe'] === probe)?.req
      ?.headers;
  }

  it('keeps authorization and cookie keys in the request log with redacted values (Petición con cabeceras sensibles)', () => {
    const requestLog = { req: { headers: requestHeaders('visible') } };

    expect(requestLog.req.headers).toMatchObject({
      authorization: '[Redacted]',
      cookie: '[Redacted]',
    });
    expect(output()).not.toContain(SECRETS.authorization);
    expect(output()).not.toContain(SECRETS.cookie);
  });

  it('redacts set-cookie in the response log', () => {
    expect(output()).toContain('"set-cookie":"[Redacted]"');
    expect(output()).not.toContain(SECRETS.setCookie);
  });

  it('redacts apiKey at the root of the logged object', () => {
    expect(output()).toContain('root object');
    expect(output()).not.toContain(SECRETS.rootApiKey);
  });

  it('redacts refreshToken one level deep and apiKey two levels deep (Objeto anidado con secretos)', () => {
    expect(output()).toContain('nested object');
    expect(output()).not.toContain(SECRETS.nestedRefreshToken);
    expect(output()).not.toContain(SECRETS.deepApiKey);
  });

  it('Cambio de contraseña registrado', () => {
    expect(output()).toContain('password change');
    expect(output()).not.toContain(SECRETS.currentPassword);
    expect(output()).not.toContain(SECRETS.newPassword);
    expect(output()).not.toContain(SECRETS.passwordHash);
  });

  it('redacts AI_VAULT_KEY, ciphertext and vaultKey (BYOK vault material)', () => {
    expect(output()).toContain('byok vault');
    expect(output()).not.toContain(SECRETS.vaultKeyEnv);
    expect(output()).not.toContain(SECRETS.ciphertext);
    expect(output()).not.toContain(SECRETS.vaultKeyBytes);
  });

  it.each(DEPTHS)('redacts $field at depth $depth', ({ field, depth }) => {
    expect(output()).not.toContain(`${field}-depth${depth}-s3cr3t`);
  });

  it.each(REFERERS)('$scenario', ({ probe, logged }) => {
    expect(requestHeaders(probe)?.['referer']).toBe(logged);
    expect(output()).not.toContain(SECRETS.inviteCode);
    expect(output()).not.toContain(SECRETS.inviteFragment);
  });

  it('redacts a referer that is not a string', () => {
    expect(stripReferer(['http://localhost:4200/unirse?codigo=x'])).toBe(
      '[Redacted]',
    );
  });

  it('Petición sin referer', () => {
    const headers = requestHeaders('visible');
    expect(headers).toBeDefined();
    expect(headers).not.toHaveProperty('referer');
  });
});

// Rutas públicas (D4 de public-preview-share): su línea automática de petición se apaga, porque llevaría la dirección
// de origen, el `User-Agent` y el referente de quien abre una página que cualquiera puede abrir. De ellas se registra
// solo `{ slug, status }`, que escribe `PublicRouteLogger` sobre el logger raíz.
describe('el log automático de las rutas públicas', () => {
  it.each([
    ['/p', true],
    ['/p/k7m2p9r4t6vw', true],
    ['/p/a/b', true],
    ['/p/k7m2p9r4t6vw?utm_source=wa', true],
    ['/api/public/previews/k7m2p9r4t6vw', true],
    ['/api/links', false],
    ['/api/groups/1/links', false],
    ['/health', false],
    ['/', false],
    ['/perfil', false],
    [undefined, false],
  ])('ignora %s: %s', (url, expected) => {
    expect(isPublicRouteLog(url)).toBe(expected);
  });

  it('mira la URL que pidió el cliente, no la que queda tras el punto de montaje', () => {
    expect(
      isPublicRouteRequest({ url: '/', originalUrl: '/p/k7m2p9r4t6vw' } as {
        url?: string;
      }),
    ).toBe(true);
    expect(
      isPublicRouteRequest({ url: '/', originalUrl: '/api/links' } as {
        url?: string;
      }),
    ).toBe(false);
    expect(isPublicRouteRequest({ url: '/p/k7m2p9r4t6vw' })).toBe(true);
  });

  it('declara el ignore en los parámetros del logger', () => {
    const params = buildLoggerParams({ LOG_LEVEL: 'info' });
    const options = params.pinoHttp as { autoLogging?: unknown };

    expect(options.autoLogging).toEqual({ ignore: isPublicRouteRequest });
  });
});
