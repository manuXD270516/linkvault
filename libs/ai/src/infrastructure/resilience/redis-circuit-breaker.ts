import type { ProviderFailureKind } from '../../domain/errors';
import type {
  CircuitBreaker,
  ProviderFailure,
} from '../../domain/ports/circuit-breaker.port';
import { dominantFailureKind } from '../../domain/provider-condition';
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

/**
 * Estado compartido de un circuito. `failureKinds` va en paralelo a `failures` y `openKind` junto a `openedAt`
 * (ADR-060 §3). Un JSON anterior sin esos campos se lee como `unavailable`.
 */
interface StoredCircuit {
  failures: number[];
  failureKinds: ProviderFailureKind[];
  openedAt: number | null;
  openKind: ProviderFailureKind;
}

const FAILURE_KINDS: readonly string[] = [
  'rate_limited',
  'rejected',
  'unavailable',
];

function asKind(value: unknown): ProviderFailureKind {
  return typeof value === 'string' && FAILURE_KINDS.includes(value)
    ? (value as ProviderFailureKind)
    : 'unavailable';
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
        const probeInFlight =
          (await this.client.exists(circuitProbeKey(id))) > 0;
        if (!this.admitsProbe(circuit.openedAt, probeInFlight, now)) {
          open.add(id);
        }
      }
      return open;
    } catch {
      return null;
    }
  }

  async openConditions(): Promise<ReadonlyMap<string, ProviderFailure>> {
    try {
      const ids = await this.client.smembers(AI_CIRCUIT_IDS_KEY);
      const conditions = new Map<string, ProviderFailure>();
      const now = this.clock.now();
      for (const id of ids) {
        const circuit = await this.load(id);
        if (circuit === null || circuit.openedAt === null) continue;
        const probeInFlight =
          (await this.client.exists(circuitProbeKey(id))) > 0;
        if (!this.admitsProbe(circuit.openedAt, probeInFlight, now)) {
          conditions.set(id, { kind: circuit.openKind });
        }
      }
      return conditions;
    } catch {
      // Falla abierta: sin clases, el degradado no lleva condición y dice lo de siempre.
      return new Map();
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

  async recordFailure(
    providerId: string,
    failure: ProviderFailure = { kind: 'unavailable' },
  ): Promise<void> {
    try {
      const now = this.clock.now();
      const circuit: StoredCircuit = (await this.load(providerId)) ?? {
        failures: [],
        failureKinds: [],
        openedAt: null,
        openKind: 'unavailable',
      };

      if (circuit.openedAt !== null) {
        const probeKey = circuitProbeKey(providerId);
        const probeInFlight = (await this.client.exists(probeKey)) > 0;
        if (probeInFlight) {
          circuit.openedAt = now;
          circuit.openKind = failure.kind;
          await this.client.del(probeKey);
          await this.save(providerId, circuit);
        }
        return;
      }

      // La clase sigue a su instante: se poda y se vacía junto con `failures`.
      const kept = circuit.failures
        .map((at, index) => ({ at, kind: circuit.failureKinds[index] }))
        .filter(({ at }) => now - at < this.windowMs);
      circuit.failures = kept.map(({ at }) => at);
      circuit.failureKinds = kept.map(({ kind }) => kind ?? 'unavailable');
      circuit.failures.push(now);
      circuit.failureKinds.push(failure.kind);
      if (circuit.failures.length >= this.failureThreshold) {
        circuit.openKind = dominantFailureKind(circuit.failureKinds);
        circuit.failures = [];
        circuit.failureKinds = [];
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
    return now - openedAt >= this.halfOpenAfterMs && !probeInFlight;
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
    const circuit = parsed as Partial<StoredCircuit> & { failures: unknown[] };
    // Las clases siguen a `failures` posición por posición. Si faltan, se completan con `unavailable` desde el
    // principio (las guardadas quedan con los errores más recientes); si sobran, valen las más recientes.
    const storedKinds = Array.isArray(circuit.failureKinds)
      ? (circuit.failureKinds as unknown[]).map(asKind)
      : [];
    const total = circuit.failures.length;
    const aligned: ProviderFailureKind[] =
      storedKinds.length >= total
        ? storedKinds.slice(storedKinds.length - total)
        : [
            ...Array<ProviderFailureKind>(total - storedKinds.length).fill(
              'unavailable',
            ),
            ...storedKinds,
          ];
    const failures: number[] = [];
    const failureKinds: ProviderFailureKind[] = [];
    circuit.failures.forEach((at, index) => {
      if (typeof at !== 'number') return;
      failures.push(at);
      failureKinds.push(aligned[index] ?? 'unavailable');
    });
    return {
      failures,
      failureKinds,
      openKind: asKind(circuit.openKind),
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
    const empty = circuit.openedAt === null && circuit.failures.length === 0;
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
