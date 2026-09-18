import {
  PASTED_TEXT_MAX_LENGTH,
  pastedDescriptionRequestSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  RequestValidationError,
  ZodValidationPipe,
} from './zod-validation.pipe';

function validationErrorOf(run: () => unknown): RequestValidationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RequestValidationError);
    return error as RequestValidationError;
  }
  throw new Error('expected a RequestValidationError');
}

describe('ZodValidationPipe', () => {
  it('returns the schema output (normalized email, trimmed displayName)', () => {
    const pipe = new ZodValidationPipe(registerRequestSchema);

    expect(
      pipe.transform({
        email: '  Ana@Example.com ',
        password: 'a-valid-password',
        displayName: '  Ana ',
      }),
    ).toEqual({
      email: 'ana@example.com',
      password: 'a-valid-password',
      displayName: 'Ana',
    });
  });

  it('names the invalid fields without their values (Registro inválido)', () => {
    const pipe = new ZodValidationPipe(registerRequestSchema);

    const error = validationErrorOf(() =>
      pipe.transform({
        email: 'ana-at-example.com',
        password: 'a-valid-password',
        displayName: '   ',
      }),
    );

    expect(error.fields).toEqual(['email', 'displayName']);
    const serialized = JSON.stringify({ ...error, message: error.message });
    expect(serialized).not.toContain('ana-at-example.com');
    expect(serialized).not.toContain('a-valid-password');
  });

  it('names password when it matches the email', () => {
    const pipe = new ZodValidationPipe(registerRequestSchema);

    const error = validationErrorOf(() =>
      pipe.transform({
        email: 'ana@example.com',
        password: 'ana@example.com',
        displayName: 'Ana',
      }),
    );

    expect(error.fields).toEqual(['password']);
  });

  it('names an unknown field by its key (Campo no editable)', () => {
    const pipe = new ZodValidationPipe(updateProfileRequestSchema);

    const error = validationErrorOf(() =>
      pipe.transform({ email: 'otro@example.com' }),
    );

    expect(error.fields).toEqual(['email']);
  });

  it('names nested fields with dots and does not repeat them', () => {
    const pipe = new ZodValidationPipe(updateProfileRequestSchema);

    const error = validationErrorOf(() =>
      pipe.transform({
        aiConsent: { externalProviders: 'yes', extra: true },
        outputLanguage: 'fr',
      }),
    );

    expect(error.fields).toEqual([
      'aiConsent.externalProviders',
      'aiConsent.extra',
      'outputLanguage',
    ]);
  });

  it('names no field for an empty or missing body', () => {
    const pipe = new ZodValidationPipe(updateProfileRequestSchema);

    expect(validationErrorOf(() => pipe.transform({})).fields).toEqual([]);
    expect(validationErrorOf(() => pipe.transform(undefined)).fields).toEqual(
      [],
    );
  });

  it('answers the code its schema asks for when that is all that fails', () => {
    const pipe = new ZodValidationPipe(pastedDescriptionRequestSchema);

    const error = validationErrorOf(() =>
      pipe.transform({ text: 'a'.repeat(PASTED_TEXT_MAX_LENGTH + 1) }),
    );

    expect(error.code).toBe('text_too_long');
    expect(error.fields).toEqual([]);
  });

  it('keeps validation_error when anything else fails too', () => {
    const pipe = new ZodValidationPipe(pastedDescriptionRequestSchema);

    const tooLongAndUnknown = validationErrorOf(() =>
      pipe.transform({
        text: 'a'.repeat(PASTED_TEXT_MAX_LENGTH + 1),
        location: 'La Paz',
      }),
    );
    const empty = validationErrorOf(() => pipe.transform({ text: '  ' }));

    expect(tooLongAndUnknown.code).toBe('validation_error');
    expect([...tooLongAndUnknown.fields].sort()).toEqual(['location', 'text']);
    expect(empty.code).toBe('validation_error');
    expect(empty.fields).toEqual(['text']);
  });
});
