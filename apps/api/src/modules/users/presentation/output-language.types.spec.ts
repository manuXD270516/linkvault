import type { OutputLanguage as AiOutputLanguage } from '@linkvault/ai';
import type { outputLanguageSchema } from '@linkvault/shared';
import { describe, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type { OutputLanguage as DomainOutputLanguage } from '../domain/user-profile';

// D8 de auth-users: `libs/ai` mantiene su tipo `OutputLanguage` sin depender de `libs/shared`. Este test de tipos (lo
// comprueba `tsc` en `nx run api:typecheck`) impide que el contrato HTTP, el dominio de `users` y `libs/ai` diverjan.

describe('outputLanguage types', () => {
  it('the shared contract and libs/ai accept the same languages', () => {
    expectTypeOf<
      z.infer<typeof outputLanguageSchema>
    >().toEqualTypeOf<AiOutputLanguage>();
  });

  it('the users domain accepts the same languages as libs/ai', () => {
    expectTypeOf<DomainOutputLanguage>().toEqualTypeOf<AiOutputLanguage>();
  });
});
