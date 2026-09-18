import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type {
  AttemptOutcome,
  FixedWindowCounter,
  WindowLimit,
} from './fixed-window-counter';

// Contador de intentos por ventana fija en Redis (ADR-020 §5, D13 de link-enrichment). `consume` cuenta en un único
// MULTI (`SET k 0 PX ventana NX`, `INCR k`, `PTTL k`), así que N peticiones simultáneas no superan el límite.
//
// Cuando Redis no responde —caído, sin conexión o más de 200 ms por el `commandTimeout` del cliente— devuelve `null`
// (o `false`) en vez de lanzar: la política de fallo es de quien llama, no suya. Avisa una sola vez al empezar cada
// racha de fallos e informa al recuperarse; nunca registra la clave, que puede llevar el resumen de un email.

/** Lo que el contador necesita de un logger; `Logger` de Nest lo cumple. */
export interface FixedWindowCounterLogger {
  warn(message: string): void;
  log(message: string): void;
}

type RedisCommands = Pick<Redis, 'multi'>;

/** Resultados de `EXEC` de ioredis: `[error, valor]` por comando, o `null` si la transacción se abortó. */
type ExecResults = [error: Error | null, result: unknown][] | null;

function resultAt(results: ExecResults, index: number): unknown {
  const entry = results?.[index];
  if (!entry) {
    throw new Error('Redis transaction returned no result');
  }
  const [error, value] = entry;
  if (error) {
    throw error;
  }
  return value;
}

function integerAt(results: ExecResults, index: number): number {
  const value = resultAt(results, index);
  if (typeof value !== 'number') {
    throw new Error('Redis transaction returned a non-integer result');
  }
  return value;
}

export class RedisFixedWindowCounter implements FixedWindowCounter {
  private failing = false;

  constructor(
    private readonly client: RedisCommands,
    private readonly logger: FixedWindowCounterLogger = new Logger(
      RedisFixedWindowCounter.name,
    ),
  ) {}

  async consume(
    key: string,
    limit: WindowLimit,
  ): Promise<AttemptOutcome | null> {
    try {
      const outcome = await this.count(key, limit);
      this.reportRecovery();
      return outcome;
    } catch (error) {
      this.reportFailure(error);
      return null;
    }
  }

  async reset(key: string): Promise<boolean> {
    return await this.attempt(async () => {
      await this.client.multi().del(key).exec();
    });
  }

  async giveBack(key: string): Promise<boolean> {
    return await this.attempt(async () => {
      const results: ExecResults = await this.client.multi().decr(key).exec();
      // Si la ventana ya había expirado, DECR crea la clave en -1 y sin caducidad: se borra, y un contador que vuelve a
      // 0 también, para que la clave no acumule crédito ni quede eterna.
      if (integerAt(results, 0) <= 0) {
        await this.client.multi().del(key).exec();
      }
    });
  }

  private async count(
    key: string,
    limit: WindowLimit,
  ): Promise<AttemptOutcome> {
    const results: ExecResults = await this.client
      .multi()
      .set(key, '0', 'PX', limit.windowMs, 'NX')
      .incr(key)
      .pttl(key)
      .exec();
    const count = integerAt(results, 1);
    if (count <= limit.limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const remainingMs = integerAt(results, 2);
    // Sin caducidad (-1) no debería ocurrir; se anuncia la ventana completa en lugar de un valor inválido.
    const retryAfterMs = remainingMs > 0 ? remainingMs : limit.windowMs;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  private async attempt(work: () => Promise<void>): Promise<boolean> {
    try {
      await work();
      this.reportRecovery();
      return true;
    } catch (error) {
      this.reportFailure(error);
      return false;
    }
  }

  private reportFailure(error: unknown): void {
    if (this.failing) {
      return;
    }
    this.failing = true;
    const name = error instanceof Error ? error.name : 'UnknownError';
    this.logger.warn(`Attempt counter store unavailable (${name})`);
  }

  private reportRecovery(): void {
    if (!this.failing) {
      return;
    }
    this.failing = false;
    this.logger.log('Attempt counter store available again');
  }
}
