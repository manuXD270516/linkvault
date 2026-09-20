import type { CircuitBreaker } from '../../domain/ports/circuit-breaker.port';
import type { Clock } from '../../domain/ports/clock.port';
import {
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_FAILURE_WINDOW_MS,
  DEFAULT_HALF_OPEN_AFTER_MS,
  type InMemoryCircuitBreakerOptions,
} from './in-memory-circuit-breaker';

// Circuit breaker compartido entre procesos sobre Redis (cv-match-suggestions 4.2, ADR-030 §8).
// Misma semántica que `InMemoryCircuitBreaker`: ventana deslizante, apertura, half-open con un único permiso.
// El permiso de prueba se materializa con `SET NX` sobre una clave aparte, para que dos procesos no tomen el mismo.

export const AI_CIRCUIT_KEY_PREFIX = 'ai:circuit:v1:';
export const AI_CIRCUIT_IDS_KEY = `${AI_CIRCUIT_KEY_PREFIX}ids`;

export function circuitStateKey(providerId: string): string {
  return `${AI_CIRCUIT_KEY_PREFIX}${providerId}`;
}

export function circuitProbeKey(providerId: string): string {
  return `${AI_CIRCUIT_KEY_PREFIX}${providerId}:probe`;
}

interface StoredCircuit {
  failures: number[];
  openedAt: number | null;
}

/**
 * Lo que el adaptador necesita de Redis, declarado aquí en vez de con `Pick<Redis, …>`: un `Redis` de ioredis lo
 * cumple, y un doble de test también, sin arrastrar las sobrecargas del cliente real.
 */
export interface CircuitBreakerRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<'OK' | null>;
  set(
    key: string,
    value: string,
    mode: 'PX',
    ms: number,
    condition: 'NX',
  ): Promise<'OK' | null>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  exists(...keys: string[]): Promise<number>;
}

export type RedisCircuitBreakerOptions = InMemoryCircuitBreakerOptions;

export class RedisCircuitBreaker implements CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly halfOpenAfterMs: number;

  constructor(
    private readonly client: CircuitBreakerRedisClient,
    private readonly clock: Clock,
    options: RedisCircuitBreakerOptions = {},
  ) {
    this.failureThreshold =
      options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.windowMs = options.windowMs ?? DEFAULT_FAILURE_WINDOW_MS;
    this.halfOpenAfterMs =
      options.halfOpenAfterMs ?? DEFAULT_HALF_OPEN_AFTER_MS;
  }

  async openIds(): Promise<ReadonlySet<string>> {
    const snapshot = await this.snapshotOpenIds();
    return snapshot ?? new Set();
  }

  async snapshotOpenIds(): Promise<ReadonlySet<string> | null> {
    try {
      const ids = await this.client.smembers(AI_CIRCUIT_IDS_KEY);
      const open = new Set<string>();
      const now = this.clock.now();
      for (const id of ids) {
        const circuit = await this.load(id);
        if (circuit === null || circuit.openedAt === null) continue;
        const probeInFlight = (await this.client.exists(circuitProbeKey(id))) > 0;
        if (!this.admitsProbe(circuit.openedAt, probeInFlight, now)) {
          open.add(id);
        }
      }
      return open;
    } catch {
      return null;
    }
  }

  async tryAcquire(providerId: string): Promise<boolean> {
    try {
      const circuit = await this.load(providerId);
      if (circuit === null || circuit.openedAt === null) return true;
      const now = this.clock.now();
      const probeInFlight =
        (await this.client.exists(circuitProbeKey(providerId))) > 0;
      if (!this.admitsProbe(circuit.openedAt, probeInFlight, now)) return false;
      // Un único permiso entre procesos: `NX` falla si otro ya lo tomó. El `PX` libera el permiso si el proceso muere.
      const taken = await this.client.set(
        circuitProbeKey(providerId),
        '1',
        'PX',
        this.halfOpenAfterMs,
        'NX',
      );
      return taken === 'OK';
    } catch {
      // Redis caído: fallar abierto para no bloquear la cadena.
      return true;
    }
  }

  async recordSuccess(providerId: string): Promise<void> {
    try {
      const circuit = await this.load(providerId);
      if (circuit === null || circuit.openedAt === null) return;
      await this.clear(providerId);
    } catch {
      // Sin estado compartido el circuito se recuperará solo al vencer.
    }
  }

  async recordFailure(providerId: string): Promise<void> {
    try {
      const now = this.clock.now();
      const circuit = (await this.load(providerId)) ?? {
        failures: [],
        openedAt: null,
      };

      if (circuit.openedAt !== null) {
        const probeKey = circuitProbeKey(providerId);
        const probeInFlight = (await this.client.exists(probeKey)) > 0;
        if (probeInFlight) {
          circuit.openedAt = now;
          await this.client.del(probeKey);
          await this.save(providerId, circuit);
        }
        return;
      }

      circuit.failures = circuit.failures.filter(
        (at) => now - at < this.windowMs,
      );
      circuit.failures.push(now);
      if (circuit.failures.length >= this.failureThreshold) {
        circuit.failures = [];
        circuit.openedAt = now;
        await this.client.del(circuitProbeKey(providerId));
      }
      await this.save(providerId, circuit);
    } catch {
      // Fallo de Redis: no se cuenta el error en el breaker compartido.
    }
  }

  async release(providerId: string): Promise<void> {
    try {
      const circuit = await this.load(providerId);
      if (circuit === null || circuit.openedAt === null) return;
      await this.client.del(circuitProbeKey(providerId));
    } catch {
      // Sin permiso que devolver.
    }
  }

  private admitsProbe(
    openedAt: number,
    probeInFlight: boolean,
    now: number,
  ): boolean {
    return (
      now - openedAt >= this.halfOpenAfterMs && !probeInFlight
    );
  }

  private async load(providerId: string): Promise<StoredCircuit | null> {
    const raw = await this.client.get(circuitStateKey(providerId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as StoredCircuit).failures)
    ) {
      return null;
    }
    const circuit = parsed as StoredCircuit;
    return {
      failures: circuit.failures.filter((at) => typeof at === 'number'),
      openedAt:
        typeof circuit.openedAt === 'number' || circuit.openedAt === null
          ? circuit.openedAt
          : null,
    };
  }

  private async save(
    providerId: string,
    circuit: StoredCircuit,
  ): Promise<void> {
    const empty =
      circuit.openedAt === null && circuit.failures.length === 0;
    if (empty) {
      await this.clear(providerId);
      return;
    }
    await this.client.set(circuitStateKey(providerId), JSON.stringify(circuit));
    await this.client.sadd(AI_CIRCUIT_IDS_KEY, providerId);
  }

  private async clear(providerId: string): Promise<void> {
    await this.client.del(
      circuitStateKey(providerId),
      circuitProbeKey(providerId),
    );
    await this.client.srem(AI_CIRCUIT_IDS_KEY, providerId);
  }
}
