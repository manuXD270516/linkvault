// Circuit breaker por proveedor (D10 de ai-gateway-core, ADR-018 §7; compartido en Redis por ADR-030 §8).
// Solo tipos. Los métodos son asíncronos para que la implementación Redis pueda leer y escribir el estado compartido.

import type { ProviderFailureKind } from '../errors';

/** Lo que `recordFailure` recuerda de un fallo: su clase (ADR-060 §3). Sin cuerpo ni mensaje del proveedor. */
export interface ProviderFailure {
  kind: ProviderFailureKind;
}

export interface CircuitBreaker {
  /**
   * Instantánea de circuitos abiertos que aún no admiten prueba; la recibe la política de routing.
   * Si Redis no responde, SHALL devolver un conjunto vacío (fallar abierto) para no bloquear `runTask`.
   */
  openIds(): Promise<ReadonlySet<string>>;
  /**
   * Instantánea de solo lectura para la consulta de elegibilidad. `null` cuando no se pudo obtener
   * (p. ej. Redis caído): distinto de «ningún circuito abierto».
   */
  snapshotOpenIds(): Promise<ReadonlySet<string> | null>;
  /** Se llama justo antes de `complete()`: en half-open concede un único permiso de prueba. */
  tryAcquire(providerId: string): Promise<boolean>;
  /** Cualquier respuesta del proveedor, válida o no según el schema. */
  recordSuccess(providerId: string): Promise<void>;
  /**
   * Solo errores de proveedor (red, código de error, timeout). Sin `failure` vale `{ kind: 'unavailable' }`.
   * Todas las clases cuentan igual en la ventana: la clase solo se recuerda (ADR-060 §3).
   */
  recordFailure(providerId: string, failure?: ProviderFailure): Promise<void>;
  /**
   * Clase recordada (dominante de su ventana) de cada circuito abierto, con la misma regla que `snapshotOpenIds()`.
   * Si el almacén no responde, SHALL devolver un mapa vacío (fallar abierto).
   */
  openConditions(): Promise<ReadonlyMap<string, ProviderFailure>>;
  /**
   * Devuelve un permiso de half-open ya concedido sin tocar la ventana de errores. `runTask` lo llama cuando aborta
   * `ctx.signal`; sin permiso concedido no hace nada.
   */
  release(providerId: string): Promise<void>;
}
