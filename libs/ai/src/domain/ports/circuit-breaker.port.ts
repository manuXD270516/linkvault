// Circuit breaker por proveedor (D10 de ai-gateway-core, ADR-018 §7). Solo tipos.

export interface CircuitBreaker {
  /** Instantánea de circuitos abiertos que aún no admiten prueba; la recibe la política de routing. */
  openIds(): ReadonlySet<string>;
  /** Se llama justo antes de `complete()`: en half-open concede un único permiso de prueba. */
  tryAcquire(providerId: string): boolean;
  /** Cualquier respuesta del proveedor, válida o no según el schema. */
  recordSuccess(providerId: string): void;
  /** Solo errores de proveedor (red, código de error, timeout). */
  recordFailure(providerId: string): void;
}
