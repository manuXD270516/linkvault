import type {
  AttemptOutcome,
  FixedWindowCounter,
  WindowLimit,
} from '../fixed-window-counter';

// Contador por ventana fija en memoria, para los tests de integración de `api` (ADR-021 §4: esa suite no levanta Redis).
// No es un adaptador de producción: el real es `RedisFixedWindowCounter`. Aplica las mismas reglas —ventana fija por
// clave, conteo antes de actuar, `Retry-After` entero y como mínimo 1— para que un límite probado con él se comporte
// igual contra Redis.
//
// Nunca devuelve `null`: aquí el almacén siempre responde. Que un contador caído deje pasar la importación y niegue la
// relectura se prueba en el adaptador de `links`, con un doble que sí falla.

interface Counter {
  count: number;
  expiresAt: number;
}

export class InMemoryFixedWindowCounter implements FixedWindowCounter {
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  consume(key: string, limit: WindowLimit): Promise<AttemptOutcome | null> {
    const now = this.now();
    const counter = this.live(key, now) ?? {
      count: 0,
      expiresAt: now + limit.windowMs,
    };
    counter.count += 1;
    this.counters.set(key, counter);
    if (counter.count <= limit.limit) {
      return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
    }
    return Promise.resolve({
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((counter.expiresAt - now) / 1000),
      ),
    });
  }

  reset(key: string): Promise<boolean> {
    this.counters.delete(key);
    return Promise.resolve(true);
  }

  giveBack(key: string): Promise<boolean> {
    const counter = this.live(key, this.now());
    if (counter !== undefined) {
      counter.count -= 1;
      if (counter.count <= 0) {
        this.counters.delete(key);
      }
    }
    return Promise.resolve(true);
  }

  private live(key: string, now: number): Counter | undefined {
    const counter = this.counters.get(key);
    if (counter !== undefined && counter.expiresAt <= now) {
      this.counters.delete(key);
      return undefined;
    }
    return counter;
  }
}
