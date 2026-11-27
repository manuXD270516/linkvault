import { Writable } from 'node:stream';
import { Test } from '@nestjs/testing';
import { Logger, LoggerModule } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';
import { buildLoggerParams } from '../../../infrastructure/logging/logger-params';
import { NestAuthSecurityLog } from './nest-auth-security-log';

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

/** Escribe un aviso por el logger real de la app (pino con el nivel indicado) y devuelve las líneas de `AuthSecurity`. */
async function reissueThroughPino(
  level: 'info' | 'warn',
): Promise<Record<string, unknown>[]> {
  const destination = new MemoryDestination();
  const moduleRef = await Test.createTestingModule({
    imports: [
      LoggerModule.forRoot(
        buildLoggerParams({ LOG_LEVEL: level }, destination),
      ),
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.init();
  try {
    new NestAuthSecurityLog().refreshTokenReissued({
      userId: 'user-1',
      sessionId: 'session-1',
      reissueCount: 1,
    });
  } finally {
    await app.close();
  }
  return destination.lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry['context'] === 'AuthSecurity');
}

function writers() {
  const infos: string[] = [];
  const warnings: string[] = [];
  return {
    infos,
    warnings,
    log: new NestAuthSecurityLog({
      log: (message) => infos.push(message),
      warn: (message) => warnings.push(message),
    }),
  };
}

describe('NestAuthSecurityLog', () => {
  it('warns about a reused refresh token with userId and sessionId only', () => {
    const { warnings, log } = writers();

    log.refreshTokenReused({ userId: 'user-1', sessionId: 'session-1' });

    expect(warnings).toEqual([
      'Refresh token reuse detected, session revoked (userId=user-1, sessionId=session-1)',
    ]);
  });

  it('logs the first reissue at info level with ids only', () => {
    const { infos, warnings, log } = writers();

    log.refreshTokenReissued({
      userId: 'user-1',
      sessionId: 'session-1',
      reissueCount: 1,
    });

    expect(warnings).toEqual([]);
    expect(infos).toEqual([
      'Refresh token reissued after a lost rotation response (userId=user-1, sessionId=session-1, reissueCount=1)',
    ]);
  });

  it('warns from the second reissue', () => {
    const { infos, warnings, log } = writers();

    log.refreshTokenReissued({
      userId: 'user-1',
      sessionId: 'session-1',
      reissueCount: 2,
    });
    log.refreshTokenReissued({
      userId: 'user-1',
      sessionId: 'session-1',
      reissueCount: 3,
    });

    expect(infos).toEqual([]);
    expect(warnings).toEqual([
      'Refresh token reissued after a lost rotation response (userId=user-1, sessionId=session-1, reissueCount=2)',
      'Refresh token reissued after a lost rotation response (userId=user-1, sessionId=session-1, reissueCount=3)',
    ]);
  });

  it('reaches the production logs: the info line shows up with LOG_LEVEL info and not with warn', async () => {
    const visible = await reissueThroughPino('info');
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ level: 30 });
    expect(String(visible[0]?.['msg'])).toContain('reissueCount=1');

    // Prueba de que el test mira el nivel.
    expect(await reissueThroughPino('warn')).toEqual([]);
  });
});
