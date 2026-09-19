import { describe, expect, it } from 'vitest';
import { IMPORT_TEXT_MAX_LENGTH } from './link.schema';
import {
  API_ERROR_CODE_ISSUE_PARAM,
  PASTED_TEXT_MAX_LENGTH,
  pastedDescriptionRequestSchema,
} from './pasted-description.schema';

// Contrato de `POST /api/links/:id/pasted` (requisito "Lo pegado tiene que parecer una oferta").

describe('pastedDescriptionRequestSchema', () => {
  it('takes the text alone, without its outer spaces', () => {
    expect(
      pastedDescriptionRequestSchema.parse({
        text: '\n  Backend Engineer en Acme  \n',
      }),
    ).toEqual({ text: 'Backend Engineer en Acme' });
  });

  it('takes the title and the company written apart', () => {
    expect(
      pastedDescriptionRequestSchema.parse({
        text: 'Buscamos backend con Node.',
        title: ' Backend Engineer ',
        company: 'Acme',
      }),
    ).toEqual({
      text: 'Buscamos backend con Node.',
      title: 'Backend Engineer',
      company: 'Acme',
    });
  });

  it.each(['', '   ', '\n\t '])('refuses an empty text (%j)', (text) => {
    const result = pastedDescriptionRequestSchema.safeParse({ text });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['text']]);
    expect(result.error?.issues.some((issue) => issue.code === 'custom')).toBe(
      false,
    );
  });

  it('takes twenty thousand characters and asks for text_too_long above them', () => {
    expect(PASTED_TEXT_MAX_LENGTH).toBe(20_000);
    expect(PASTED_TEXT_MAX_LENGTH).toBe(IMPORT_TEXT_MAX_LENGTH);
    expect(
      pastedDescriptionRequestSchema.safeParse({
        text: 'a'.repeat(PASTED_TEXT_MAX_LENGTH),
      }).success,
    ).toBe(true);

    const result = pastedDescriptionRequestSchema.safeParse({
      text: 'a'.repeat(PASTED_TEXT_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'custom',
      path: ['text'],
      params: { [API_ERROR_CODE_ISSUE_PARAM]: 'text_too_long' },
    });
  });

  it('measures the text without its outer spaces', () => {
    expect(
      pastedDescriptionRequestSchema.safeParse({
        text: `   ${'a'.repeat(PASTED_TEXT_MAX_LENGTH)}   `,
      }).success,
    ).toBe(true);
  });

  it('refuses an empty title or company, and anything else in the body', () => {
    expect(
      pastedDescriptionRequestSchema.safeParse({ text: 'Oferta', title: '  ' })
        .success,
    ).toBe(false);
    expect(
      pastedDescriptionRequestSchema.safeParse({ text: 'Oferta', company: '' })
        .success,
    ).toBe(false);
    expect(
      pastedDescriptionRequestSchema.safeParse({
        text: 'Oferta',
        location: 'La Paz',
      }).success,
    ).toBe(false);
    expect(pastedDescriptionRequestSchema.safeParse({}).success).toBe(false);
  });
});
