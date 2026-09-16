// Errores tipados del módulo de IA (design-v0.2 §4.3 y §4.5, ADR-014). Solo contexto mínimo, sin lógica.

/** La salida del proveedor no cumple el `outputSchema` de la tarea. */
export class SchemaViolation extends Error {
  override readonly name = 'SchemaViolation';

  constructor(
    readonly taskName: string,
    readonly providerId: string,
    readonly issues: readonly string[],
  ) {
    super(`Output of task "${taskName}" from provider "${providerId}" violates its schema`);
  }
}

/** El proveedor falló, expiró o tiene el circuit breaker abierto. */
export class ProviderUnavailable extends Error {
  override readonly name = 'ProviderUnavailable';

  constructor(readonly providerId: string) {
    super(`Provider "${providerId}" is unavailable`);
  }
}

/** La cuota del usuario para la tarea y el proveedor está agotada. */
export class QuotaExceeded extends Error {
  override readonly name = 'QuotaExceeded';

  constructor(
    readonly taskName: string,
    readonly providerId: string,
  ) {
    super(`Quota exceeded for task "${taskName}" on provider "${providerId}"`);
  }
}

/** Modo `replay` sin fixture para la clave sha256(task + promptVersion + canonicalJSON(input)). */
export class FixtureMissing extends Error {
  override readonly name = 'FixtureMissing';

  constructor(readonly key: string) {
    super(`No replay fixture for key "${key}"`);
  }
}
