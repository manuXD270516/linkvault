import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import type { ZodType } from 'zod';

/**
 * Valida el valor del control con un schema de `@linkvault/shared`, para que el cliente aplique las mismas reglas que
 * la API. Solo lo importan páginas lazy: zod no entra en el bundle inicial.
 */
export function zodValidator(schema: ZodType): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null =>
    schema.safeParse(control.value).success ? null : { schema: true };
}
