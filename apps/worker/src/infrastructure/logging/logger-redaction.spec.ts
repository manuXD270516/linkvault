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
import { buildLoggerParams } from './logger-params';

const SECRETS = {
  authorization: 'Bearer header-authorization-s3cr3t',
  cookie: 'session=header-cookie-s3cr3t',
  rootApiKey: 'root-api-key-s3cr3t',
  nestedRefreshToken: 'one-level-refresh-token-s3cr3t',
  deepApiKey: 'two-levels-api-key-s3cr3t',
  setCookie: 'refresh=set-cookie-s3cr3t',
} as const;

const DEPTHS = ['password', 'apiKey', 'accessToken', 'refreshToken'].flatMap(
  (field) => [
    { field, depth: 0, value: { [field]: `${field}-depth0-s3cr3t` } },
    { field, depth: 1, value: { a: { [field]: `${field}-depth1-s3cr3t` } } },
    {
      field,
      depth: 2,
      value: { a: { b: { [field]: `${field}-depth2-s3cr3t` } } },
    },
  ],
);

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
  });

  afterAll(async () => {
    await app.close();
  });

  function output(): string {
    return destination.lines.join('\n');
  }

  it('keeps authorization and cookie keys in the request log with redacted values', () => {
    const requestLog = destination.lines
      .map(
        (line) =>
          JSON.parse(line) as { req?: { headers?: Record<string, unknown> } },
      )
      .find((entry) => entry.req?.headers?.['x-probe'] === 'visible');

    expect(requestLog?.req?.headers).toMatchObject({
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

  it('redacts refreshToken one level deep and apiKey two levels deep', () => {
    expect(output()).toContain('nested object');
    expect(output()).not.toContain(SECRETS.nestedRefreshToken);
    expect(output()).not.toContain(SECRETS.deepApiKey);
  });

  it.each(DEPTHS)('redacts $field at depth $depth', ({ field, depth }) => {
    expect(output()).not.toContain(`${field}-depth${depth}-s3cr3t`);
  });
});
