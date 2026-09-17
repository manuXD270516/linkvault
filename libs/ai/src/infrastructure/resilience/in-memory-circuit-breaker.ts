import type { CircuitBreaker } from '../../domain/ports/circuit-breaker.port';
import type { Clock } from '../../domain/ports/clock.port';

// Circuit breaker en memoria por proceso y por proveedor (D10 de ai-gateway-core, ADR-018 §7).
// Cerrado: ventana deslizante de marcas de error. Abierto: sin peticiones hasta `halfOpenAfterMs`. Half-open: un único
// permiso de prueba que se toma con `tryAcquire` justo antes de `complete()`; si nadie lo toma, sigue disponible.

export interface InMemoryCircuitBreakerOptions {
  /** Errores de proveedor dentro de la ventana que abren el circuito. Por defecto 5. */
  failureThreshold?: number;
  /** Tamaño de la ventana deslizante en ms. Por defecto 60 000. */
  windowMs?: number;
  /** Tiempo abierto antes de admitir una prueba, en ms. Por defecto 30 000. */
  halfOpenAfterMs?: number;
}

export const DEFAULT_FAILURE_THRESHOLD = 5;
export const DEFAULT_FAILURE_WINDOW_MS = 60_000;
export const DEFAULT_HALF_OPEN_AFTER_MS = 30_000;

interface ProviderCircuit {
  /** Marcas de error (ms) dentro de la ventana, solo mientras está cerrado. */
  failures: number[];
  /** Instante de apertura (ms); `null` si está cerrado. */
  openedAt: number | null;
  /** Hay un permiso de prueba concedido cuyo resultado aún no se ha registrado. */
  probeInFlight: boolean;
}

export class InMemoryCircuitBreaker implements CircuitBreaker {
  private readonly circuits = new Map<string, ProviderCircuit>();
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly halfOpenAfterMs: number;

  constructor(
    private readonly clock: Clock,
    options: InMemoryCircuitBreakerOptions = {},
  ) {
    this.failureThreshold =
      options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.windowMs = options.windowMs ?? DEFAULT_FAILURE_WINDOW_MS;
    this.halfOpenAfterMs =
      options.halfOpenAfterMs ?? DEFAULT_HALF_OPEN_AFTER_MS;
  }

  openIds(): ReadonlySet<string> {
    const now = this.clock.now();
    const ids = new Set<string>();
    for (const [id, circuit] of this.circuits) {
      if (circuit.openedAt !== null && !this.admitsProbe(circuit, now)) {
        ids.add(id);
      }
    }
    return ids;
  }

  tryAcquire(providerId: string): boolean {
    const circuit = this.circuits.get(providerId);
    if (circuit === undefined || circuit.openedAt === null) return true;
    if (!this.admitsProbe(circuit, this.clock.now())) return false;
    circuit.probeInFlight = true;
    return true;
  }

  recordSuccess(providerId: string): void {
    const circuit = this.circuits.get(providerId);
    if (circuit === undefined || circuit.openedAt === null) return;
    this.circuits.delete(providerId);
  }

  recordFailure(providerId: string): void {
    const now = this.clock.now();
    const circuit = this.circuitOf(providerId);

    if (circuit.openedAt !== null) {
      // Solo la prueba en half-open reabre; un error tardío de una petición previa a la apertura no alarga la espera.
      if (circuit.probeInFlight) {
        circuit.openedAt = now;
        circuit.probeInFlight = false;
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
      circuit.probeInFlight = false;
    }
  }

  release(providerId: string): void {
    const circuit = this.circuits.get(providerId);
    if (circuit === undefined || circuit.openedAt === null) return;
    // Devuelve el permiso sin reabrir ni contar un error: el circuito sigue en half-open.
    circuit.probeInFlight = false;
  }

  private admitsProbe(circuit: ProviderCircuit, now: number): boolean {
    return (
      circuit.openedAt !== null &&
      now - circuit.openedAt >= this.halfOpenAfterMs &&
      !circuit.probeInFlight
    );
  }

  private circuitOf(providerId: string): ProviderCircuit {
    let circuit = this.circuits.get(providerId);
    if (circuit === undefined) {
      circuit = { failures: [], openedAt: null, probeInFlight: false };
      this.circuits.set(providerId, circuit);
    }
    return circuit;
  }
}
