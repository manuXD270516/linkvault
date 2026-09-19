import { describe, expect, it } from 'vitest';
import {
  PREVIEW_SOURCE_KINDS,
  type PreviewSourceKind,
} from '../schemas/preview.schema';
import { mayOverwrite } from './precedence';

// D3 de paste-job-description: escrito a mano > pegado > leído de la página, como un orden total. La tabla recorre
// **todos** los pares de orígenes, más el campo que nadie ha escrito: si alguien cambia el orden, esta tabla y los dos
// procesos que usan la función cambian a la vez.

const CASES: readonly {
  readonly previous: PreviewSourceKind | undefined;
  readonly incoming: PreviewSourceKind;
  readonly allowed: boolean;
  readonly why: string;
}[] = [
  {
    previous: undefined,
    incoming: 'auto',
    allowed: true,
    why: 'nadie lo había escrito',
  },
  {
    previous: undefined,
    incoming: 'pasted',
    allowed: true,
    why: 'nadie lo había escrito',
  },
  {
    previous: undefined,
    incoming: 'manual',
    allowed: true,
    why: 'nadie lo había escrito',
  },
  {
    previous: 'auto',
    incoming: 'auto',
    allowed: true,
    why: 'la página pudo cambiar',
  },
  {
    previous: 'auto',
    incoming: 'pasted',
    allowed: true,
    why: 'lo pegado pesa más que la página',
  },
  {
    previous: 'auto',
    incoming: 'manual',
    allowed: true,
    why: 'lo escrito a mano pesa más que todo',
  },
  {
    previous: 'pasted',
    incoming: 'auto',
    allowed: false,
    why: 'una relectura no pisa lo pegado',
  },
  {
    previous: 'pasted',
    incoming: 'pasted',
    allowed: true,
    why: 'alguien pega una versión mejor',
  },
  {
    previous: 'pasted',
    incoming: 'manual',
    allowed: true,
    why: 'lo escrito a mano pesa más que lo pegado',
  },
  {
    previous: 'manual',
    incoming: 'auto',
    allowed: false,
    why: 'una relectura no pisa lo escrito a mano',
  },
  {
    previous: 'manual',
    incoming: 'pasted',
    allowed: false,
    why: 'pegar no pisa lo escrito a mano',
  },
  {
    previous: 'manual',
    incoming: 'manual',
    allowed: true,
    why: 'una persona corrige lo que escribió otra',
  },
];

describe('mayOverwrite', () => {
  it.each(CASES)(
    '$incoming over $previous: $allowed ($why)',
    ({ previous, incoming, allowed }) => {
      expect(mayOverwrite(previous, incoming)).toBe(allowed);
    },
  );

  it('covers every pair of sources, plus the field nobody wrote', () => {
    const pairs = CASES.map(
      ({ previous, incoming }) => `${previous}>${incoming}`,
    );
    const expected = [undefined, ...PREVIEW_SOURCE_KINDS].flatMap((previous) =>
      PREVIEW_SOURCE_KINDS.map((incoming) => `${previous}>${incoming}`),
    );

    expect(new Set(pairs)).toEqual(new Set(expected));
    expect(pairs).toHaveLength(expected.length);
  });
});
