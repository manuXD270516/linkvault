import { ConsoleLogger, Logger, type LoggerService } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryAiLogger } from '../../application/testing/in-memory-ports';
import { AI_LOGGER_CONTEXT, NestAiLogger } from './nest-ai-logger';

// Logging del módulo de IA (D12 de ai-gateway-core): adaptador de Nest y logger en memoria de los tests.

afterEach(() => {
  Logger.overrideLogger(new ConsoleLogger());
});

describe('InMemoryAiLogger', () => {
  it('captures debug and warn entries in order with their fields', () => {
    const logger = new InMemoryAiLogger();

    logger.debug('cache miss', { task: 'classify-skills' });
    logger.warn('provider error', {
      providerId: 'openrouter',
      httpStatus: 503,
    });
    logger.debug('no fields');

    expect(logger.entries).toEqual([
      {
        level: 'debug',
        message: 'cache miss',
        fields: { task: 'classify-skills' },
      },
      {
        level: 'warn',
        message: 'provider error',
        fields: { providerId: 'openrouter', httpStatus: 503 },
      },
      { level: 'debug', message: 'no fields', fields: undefined },
    ]);
    expect(logger.warnings).toEqual([logger.entries[1]]);
  });
});

describe('NestAiLogger', () => {
  it('delegates debug and warn to the Nest Logger with the fields merged and the message as msg', () => {
    const nest = new Logger(AI_LOGGER_CONTEXT);
    const debug = vi.spyOn(nest, 'debug').mockImplementation(() => undefined);
    const warn = vi.spyOn(nest, 'warn').mockImplementation(() => undefined);
    const logger = new NestAiLogger(nest);

    logger.debug('cache miss', { task: 'classify-skills', skipped: undefined });
    logger.warn('provider error', {
      providerId: 'openrouter',
      httpStatus: 503,
      msg: 'not the message',
    });
    logger.debug('no fields');

    expect(debug.mock.calls).toEqual([
      [{ task: 'classify-skills', msg: 'cache miss' }],
      [{ msg: 'no fields' }],
    ]);
    expect(warn.mock.calls).toEqual([
      [{ providerId: 'openrouter', httpStatus: 503, msg: 'provider error' }],
    ]);
  });

  it('by default logs through the application logger with the AiModule context', () => {
    const calls: { level: string; params: unknown[] }[] = [];
    const service: LoggerService = {
      log: (...params: unknown[]) => calls.push({ level: 'log', params }),
      error: (...params: unknown[]) => calls.push({ level: 'error', params }),
      warn: (...params: unknown[]) => calls.push({ level: 'warn', params }),
      debug: (...params: unknown[]) => calls.push({ level: 'debug', params }),
    };
    Logger.overrideLogger(service);

    const logger = new NestAiLogger();
    logger.debug('quota count', { task: 'classify-skills' });
    logger.warn('quota count failed', { errorName: 'Error' });

    expect(calls).toEqual([
      {
        level: 'debug',
        params: [{ task: 'classify-skills', msg: 'quota count' }, 'AiModule'],
      },
      {
        level: 'warn',
        params: [{ errorName: 'Error', msg: 'quota count failed' }, 'AiModule'],
      },
    ]);
  });
});
