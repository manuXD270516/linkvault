// Circuit breaker por proveedor (D10 de ai-gateway-core, ADR-018 §7; compartido en Redis por ADR-030 §8).
// Solo tipos. Los métodos son asíncronos para que la implementación Redis pueda leer y escribir el estado compartido.

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
  /** Solo errores de proveedor (red, código de error, timeout). */
  recordFailure(providerId: string): Promise<void>;
  /**
   * Devuelve un permiso de half-open ya concedido sin tocar la ventana de errores. `runTask` lo llama cuando aborta
   * `ctx.signal`; sin permiso concedido no hace nada.
   */
  release(providerId: string): Promise<void>;
}
