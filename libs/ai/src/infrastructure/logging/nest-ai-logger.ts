import { Logger } from '@nestjs/common';
import type { AiLogFields, AiLogger } from '../../domain/ports/ai-logger.port';

// Adaptador de `AiLogger` sobre `Logger` de @nestjs/common (D12 de ai-gateway-core). En el worker, `Logger` va a pino
// (nestjs-pino): un objeto como primer argumento se fusiona como campos del registro y `msg` es el mensaje. Solo recibe
// identificadores y métricas; nunca prompts, inputs, cuerpos HTTP ni credenciales (lo garantiza quien llama).

export const AI_LOGGER_CONTEXT = 'AiModule';

type NestLogger = Pick<Logger, 'debug' | 'warn'>;

export class NestAiLogger implements AiLogger {
  constructor(
    private readonly logger: NestLogger = new Logger(AI_LOGGER_CONTEXT),
  ) {}

  debug(message: string, fields?: AiLogFields): void {
    this.logger.debug(entry(message, fields));
  }

  warn(message: string, fields?: AiLogFields): void {
    this.logger.warn(entry(message, fields));
  }
}

/** Campos definidos y, al final, `msg`: un campo llamado `msg` no puede sustituir al mensaje. */
function entry(
  message: string,
  fields: AiLogFields | undefined,
): Record<string, string | number | boolean | null> {
  const record: Record<string, string | number | boolean | null> = {};
  for (const [name, value] of Object.entries(fields ?? {})) {
    if (value !== undefined) record[name] = value;
  }
  record['msg'] = message;
  return record;
}
