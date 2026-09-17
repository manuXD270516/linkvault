import type { z } from 'zod';

/**
 * Variable de entorno rechazada. Nunca incluye el valor recibido: `detail` solo lleva identificadores o textos fijos
 * (p. ej. los problemas de `parseAiConfig`, D12 de ai-gateway-core), nunca valores de credenciales.
 */
export interface InvalidVariable {
  readonly name: string;
  readonly reason: 'missing' | 'invalid';
  readonly detail?: string;
}

export type EnvParseResult<T> =
  | { readonly ok: true; readonly config: T }
  | { readonly ok: false; readonly invalid: readonly InvalidVariable[] };

/**
 * Valida `env` contra `schema` leyendo solo las claves que el schema declara. Una cadena vacía cuenta como
 * ausente, para que `VAR=` en un `.env` no pase por valor válido.
 */
export function parseEnv<S extends z.ZodObject>(
  schema: S,
  env: Readonly<Record<string, string | undefined>>,
): EnvParseResult<z.output<S>> {
  const input: Record<string, string | undefined> = {};
  for (const name of Object.keys(schema.shape)) {
    const value = env[name];
    input[name] = value === '' ? undefined : value;
  }

  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, config: result.data };
  }

  const invalid = new Map<string, InvalidVariable>();
  for (const issue of result.error.issues) {
    const [name] = issue.path;
    if (typeof name !== 'string' || invalid.has(name)) {
      continue;
    }
    invalid.set(name, {
      name,
      reason: input[name] === undefined ? 'missing' : 'invalid',
    });
  }
  return { ok: false, invalid: [...invalid.values()] };
}

/** Mensaje de error de arranque: nombres de variables, motivo y detalle, sin valores. */
export function formatInvalidVariables(
  service: string,
  invalid: readonly InvalidVariable[],
): string {
  const list = invalid
    .map(
      (variable) =>
        `${variable.name} (${variable.reason}${variable.detail === undefined ? '' : `: ${variable.detail}`})`,
    )
    .join(', ');
  return `[${service}] Invalid configuration, check these environment variables: ${list}\n`;
}
