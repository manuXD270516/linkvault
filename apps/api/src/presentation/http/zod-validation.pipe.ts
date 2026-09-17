import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Petición que no cumple su schema de `@linkvault/shared` (D8 de auth-users). Solo lleva los nombres de los campos
 * inválidos, nunca sus valores ni los mensajes de zod: el filtro de errores responde `400 validation_error` con ellos.
 */
export class RequestValidationError extends Error {
  override readonly name = 'RequestValidationError';

  constructor(readonly fields: readonly string[]) {
    super('Request validation failed');
  }
}

/**
 * Valida y transforma un argumento (normalmente `@Body()`) con un schema zod y devuelve la salida del schema (email
 * normalizado, `displayName` sin espacios exteriores...). Uso: `@Body(new ZodValidationPipe(registerRequestSchema))`.
 */
export class ZodValidationPipe<Schema extends z.ZodType>
  implements PipeTransform<unknown, z.output<Schema>>
{
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.output<Schema> {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    throw new RequestValidationError(invalidFields(result.error.issues));
  }
}

/**
 * Nombres de los campos con issues, sin repetir y en el orden de los issues. Un campo anidado se nombra con puntos
 * (`aiConsent.externalProviders`); un campo desconocido, por su clave. Los issues sin ruta (cuerpo vacío o que no es un
 * objeto) no nombran ningún campo.
 */
export function invalidFields(issues: readonly z.core.$ZodIssue[]): string[] {
  const fields = new Set<string>();
  for (const issue of issues) {
    const path = issue.path.filter(
      (segment): segment is string | number => typeof segment !== 'symbol',
    );
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        fields.add([...path, key].join('.'));
      }
    } else if (path.length > 0) {
      fields.add(path.join('.'));
    }
  }
  return [...fields];
}
