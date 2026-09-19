import type { PipeTransform } from '@nestjs/common';
import {
  API_ERROR_CODE_ISSUE_PARAM,
  apiErrorCodeSchema,
  type ApiErrorCode,
} from '@linkvault/shared';
import type { z } from 'zod';

/**
 * Petición que no cumple su schema de `@linkvault/shared` (D8 de auth-users). Solo lleva los nombres de los campos
 * inválidos, nunca sus valores ni los mensajes de zod: el filtro de errores responde `400 validation_error` con ellos.
 *
 * `code` es otro que `validation_error` solo cuando el schema lo pide para todos sus issues (el `text_too_long` del texto
 * pegado, D5 de paste-job-description): ese código ya dice qué falla, y entonces no se nombran campos.
 */
export class RequestValidationError extends Error {
  override readonly name = 'RequestValidationError';

  constructor(
    readonly fields: readonly string[],
    readonly code: ApiErrorCode = 'validation_error',
  ) {
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
    const code = requestedErrorCode(result.error.issues);
    if (code !== undefined) {
      throw new RequestValidationError([], code);
    }
    throw new RequestValidationError(invalidFields(result.error.issues));
  }
}

/**
 * El código que piden los issues con `params.apiErrorCode`, si **todos** piden el mismo. Basta un issue sin él —un
 * campo desconocido, un tipo equivocado— para que la respuesta sea el `validation_error` que nombra los campos: un
 * código propio solo sirve cuando explica todo lo que falla.
 */
export function requestedErrorCode(
  issues: readonly z.core.$ZodIssue[],
): ApiErrorCode | undefined {
  const codes = new Set<ApiErrorCode | undefined>(
    issues.map((issue) =>
      issue.code === 'custom'
        ? apiErrorCodeSchema.safeParse(
            issue.params?.[API_ERROR_CODE_ISSUE_PARAM],
          ).data
        : undefined,
    ),
  );
  if (codes.size !== 1) return undefined;
  const [code] = codes;
  return code;
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
