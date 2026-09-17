// Errores tipados del módulo de IA (design-v0.2 §4.3 y §4.5, ADR-014). Solo contexto mínimo, sin lógica.

/**
 * Marca común de los errores de programación o configuración de desarrollo (D2 y D4 de ai-gateway-core): `runTask`
 * los propaga tal cual en lugar de convertirlos en `provider_error` o en un resultado `degraded`, para que el test o el
 * arranque que los provoca falle. Vive en `domain` para que `application` los reconozca sin importar `infrastructure`.
 */
export abstract class AiProgrammingError extends Error {}

/** La salida del proveedor no cumple el `outputSchema` de la tarea. */
export class SchemaViolation extends Error {
  override readonly name = 'SchemaViolation';

  constructor(
    readonly taskName: string,
    readonly providerId: string,
    readonly issues: readonly string[],
  ) {
    super(
      `Output of task "${taskName}" from provider "${providerId}" violates its schema`,
    );
  }
}

/**
 * El proveedor falló, expiró o tiene el circuit breaker abierto. `httpStatus` distingue una caída de un rechazo
 * (D6 de ai-gateway-core). Nunca lleva el cuerpo de la respuesta, la petición, cabeceras ni credenciales.
 */
export class ProviderUnavailable extends Error {
  override readonly name = 'ProviderUnavailable';

  constructor(
    readonly providerId: string,
    readonly httpStatus?: number,
  ) {
    super(
      httpStatus === undefined
        ? `Provider "${providerId}" is unavailable`
        : `Provider "${providerId}" is unavailable (HTTP ${httpStatus})`,
    );
  }
}

/** Modo `replay` sin fixture para la clave sha256(task + promptVersion + canonicalJSON(input)). */
export class FixtureMissing extends AiProgrammingError {
  override readonly name = 'FixtureMissing';

  constructor(readonly key: string) {
    super(`No replay fixture for key "${key}"`);
  }
}

/** Modo `synth` del mock para una tarea que no declara `sample` (ADR-018 §4). */
export class SynthUnsupported extends AiProgrammingError {
  override readonly name = 'SynthUnsupported';

  constructor(readonly taskName: string) {
    super(`Task "${taskName}" declares no sample for synth mode`);
  }
}

/** `degrade(input)` devolvió una salida que no cumple el `outputSchema`: error de programación (ADR-018 §1). */
export class InvalidDegradeOutput extends AiProgrammingError {
  override readonly name = 'InvalidDegradeOutput';

  constructor(
    readonly taskName: string,
    readonly issues: readonly string[],
  ) {
    super(`Degrade output of task "${taskName}" violates its output schema`);
  }
}

/** Uso incorrecto del mock: `runTask` no pasó la identidad de la ejecución o el mock está mal configurado (D4, D5). */
export class MockMisuse extends AiProgrammingError {
  override readonly name = 'MockMisuse';
}

/** Fixture de replay corrupto: error de quien lo escribió, distinto de un fixture ausente (D4, D5). */
export class InvalidFixture extends AiProgrammingError {
  override readonly name = 'InvalidFixture';

  constructor(
    readonly taskName: string,
    readonly key: string,
  ) {
    super(`Replay fixture "${taskName}/${key}.json" is malformed`);
  }
}
