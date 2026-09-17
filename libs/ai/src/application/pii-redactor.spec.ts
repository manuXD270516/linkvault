import { describe, expect, it } from 'vitest';
import { PiiRedactor } from './pii-redactor';

// Escenarios de specs/ai/data-protection/spec.md y D11 de ai-gateway-core.

const redactor = new PiiRedactor();

/** Espacio no separable, habitual al copiar desde PDF o Word. */
const NBSP = String.fromCharCode(0xa0);

function redactText(text: string): string {
  return redactor.redact(text).value;
}

describe('PiiRedactor: email', () => {
  it('Valor repetido', () => {
    const { value } = redactor.redact({
      text: 'Escríbeme a ana.perez@example.com o, mejor, a ana.perez@example.com.',
      contact: 'ana.perez@example.com',
    });

    expect(value).toEqual({
      text: 'Escríbeme a [EMAIL_1] o, mejor, a [EMAIL_1].',
      contact: '[EMAIL_1]',
    });
  });

  it('numbers distinct emails in order of appearance', () => {
    expect(redactText('a@b.io, c.d+tag@mail.example.bo y a@b.io')).toBe(
      '[EMAIL_1], [EMAIL_2] y [EMAIL_1]',
    );
  });

  it.each(['usuario@localhost', 'precio 10@mes', '@handle', 'correo: nombre@'])(
    'leaves %s unchanged',
    (text) => {
      expect(redactText(text)).toBe(text);
    },
  );
});

describe('PiiRedactor: URL', () => {
  const positives: ReadonlyArray<[string, string, string]> = [
    [
      'https with path and query',
      'Portafolio: https://ana.dev/proyectos?id=3',
      'Portafolio: [URL_1]',
    ],
    ['http', 'Ver http://example.com/cv.pdf', 'Ver [URL_1]'],
    [
      'scheme URL followed by prose punctuation',
      'Mi web (https://ana.dev/about). Gracias',
      'Mi web ([URL_1]). Gracias',
    ],
    [
      'LinkedIn profile without scheme',
      'linkedin.com/in/ana-perez-123, disponible',
      '[URL_1], disponible',
    ],
    [
      'LinkedIn profile with www and country subdomain',
      'www.linkedin.com/in/ana y bo.linkedin.com/in/ana',
      '[URL_1] y [URL_2]',
    ],
    [
      'GitHub profile without scheme',
      'Código en github.com/anaperez.',
      'Código en [URL_1].',
    ],
    [
      'LinkedIn profile with scheme',
      'https://www.linkedin.com/in/ana-perez/',
      '[URL_1]',
    ],
    ['domain with www', 'Portfolio: www.anaperez.dev', 'Portfolio: [URL_1]'],
    [
      'domain without scheme with a path',
      'Ver anaperez.dev/portfolio.',
      'Ver [URL_1].',
    ],
    ['domain with a country second-level TLD', 'mi-sitio.com.bo', '[URL_1]'],
    [
      'personal .io domain next to a technology name',
      'Socket.IO en anaperez.io',
      'Socket.IO en [URL_1]',
    ],
    [
      'technology site written with www or a subdomain',
      'www.socket.io y docs.socket.io',
      '[URL_1] y [URL_2]',
    ],
    ['bare platform domain', 'github.com sin perfil', '[URL_1] sin perfil'],
  ];

  it.each(positives)('redacts %s', (_label, text, expected) => {
    expect(redactText(text)).toBe(expected);
  });

  it('gives the same marker to a repeated URL and different markers to different ones', () => {
    expect(redactText('github.com/ana, https://ana.dev y github.com/ana')).toBe(
      '[URL_1], [URL_2] y [URL_1]',
    );
  });

  it('redacts the QA portfolio and phone line without leaving the domain or the area code', () => {
    const redacted = redactText(
      'Portfolio: www.anaperez.dev · Tel (011) 4123-4567',
    );

    expect(redacted).toBe('Portfolio: [URL_1] · Tel [PHONE_1]');
    expect(redacted).not.toContain('anaperez');
    expect(redacted).not.toContain('(011)');
  });

  it('keeps emails whole when their domain has a listed TLD', () => {
    expect(redactText('ana@anaperez.dev y anaperez.dev')).toBe(
      '[EMAIL_1] y [URL_1]',
    );
  });

  it('numbers emails and URLs independently', () => {
    expect(redactText('ana@example.com https://ana.dev')).toBe(
      '[EMAIL_1] [URL_1]',
    );
  });

  it.each([
    'Experiencia con Node.js y Vue.js',
    'Trabajé en GitHub y LinkedIn',
    'versión 2.3.1',
    'Node.js',
    'ASP.NET',
    'Vue.js',
    'APIs con ASP.NET Core y ASP.NET/MVC',
    'Tiempo real con socket.io y Redis',
    'Socket.IO sobre Node.js',
    'Migración a v2.0',
    'Frameworks, e.g. Angular',
    'anaperez.devs no es un dominio',
  ])('leaves %s unchanged', (text) => {
    expect(redactText(text)).toBe(text);
  });
});

describe('PiiRedactor: Bolivian mobile and international numbers', () => {
  const positives: ReadonlyArray<[string, string]> = [
    ['+591 71234567', '[PHONE_1]'],
    ['71234567', '[PHONE_1]'],
    ['+54 9 11 1234-5678', '[PHONE_1]'],
    ['Cel: 61234567.', 'Cel: [PHONE_1].'],
    ['(+591) 71234567', '[PHONE_1]'],
    ['591-71234567', '[PHONE_1]'],
    ['+591.712.34567', '[PHONE_1]'],
    ['+1 (415) 555-2671', '[PHONE_1]'],
    ['+34 612 34 56 78, llamar tarde', '[PHONE_1], llamar tarde'],
    ['+5491112345678', '[PHONE_1]'],
    ['(71234567)', '([PHONE_1])'],
    [`+591${NBSP}71234567`, '[PHONE_1]'],
  ];

  it.each(positives)('redacts %s', (text, expected) => {
    expect(redactText(text)).toBe(expected);
  });

  it.each([
    ['7 digits', '1234567'],
    ['8 digits not starting with 6 or 7', '81234567'],
    ['9 digits starting with 7', '712345678'],
    ['8 digits inside a longer number', '171234567'],
    ['8 digits glued to letters', 'REF71234567'],
    ['plus with too few digits', '+12 345'],
    ['plus with a small quantity', '+5 años de experiencia'],
    ['C++ with a version', 'C++ 17'],
  ])('leaves %s unchanged', (_label, text) => {
    expect(redactText(text)).toBe(text);
  });

  it('gives the same marker to a repeated number', () => {
    expect(redactText('71234567 / 71234567 / +591 61234567')).toBe(
      '[PHONE_1] / [PHONE_1] / [PHONE_2]',
    );
  });

  it('splits two consecutive international numbers instead of skipping them', () => {
    expect(redactText('+54 9 11 1234-5678 +591 71234567')).toBe(
      '[PHONE_2] [PHONE_1]',
    );
  });
});

describe('PiiRedactor: LatAm local numbers and exclusions', () => {
  it('Números que no son teléfonos', () => {
    const input = {
      text: 'En 2024 cobraba Bs 8500; firmé el 12/03/2025. Trabajé 2019-2023 y 03.2020 - 06.2022.',
      values: [
        '2024',
        'Bs 8500',
        '12/03/2025',
        '2019-2023',
        '03.2020 - 06.2022',
      ],
    };

    expect(redactor.redact(input).value).toEqual(input);
  });

  const positives: ReadonlyArray<[string, string]> = [
    ['11 1234-5678', '[PHONE_1]'],
    ['55 1234 5678', '[PHONE_1]'],
    ['9 1234 5678', '[PHONE_1]'],
    ['Fijo: 4-4123456', 'Fijo: [PHONE_1]'],
    ['011.1234.5678', '[PHONE_1]'],
    ['55 1234 5678 o 55 1234 5678', '[PHONE_1] o [PHONE_1]'],
    [`11${NBSP}1234-5678`, '[PHONE_1]'],
    ['11 2020-5678', '[PHONE_1]'],
    ['+54 9 11 2019-5678', '[PHONE_1]'],
    ['2019-2023: 11 1234-5678', '2019-2023: [PHONE_1]'],
    ['Bs 8500 al 55 1234 5678', 'Bs 8500 al [PHONE_1]'],
    ['(011) 4123-4567', '[PHONE_1]'],
    ['Tel (11) 4123 4567.', 'Tel [PHONE_1].'],
  ];

  it.each(positives)('redacts %s', (text, expected) => {
    expect(redactText(text)).toBe(expected);
  });

  const negatives: ReadonlyArray<[string, string]> = [
    ['year range with spaced en dash', '2019 – 2023'],
    ['month.year range', '03.2020 - 06.2022'],
    ['month/year range without spaces', '03/2020-06/2022'],
    ['year range', '2019-2023'],
    ['lone year', 'Desde 2024'],
    ['list of years', '2019 2020 2021'],
    ['date dd/mm/aaaa', '12/03/2025'],
    ['date dd.mm.aaaa', '15.03.2024'],
    ['date aaaa-mm-dd', '2024-01-15'],
    ['amount in Bs', 'Bs 8500'],
    ['amount in Bs. with thousands', 'Bs. 12.500.000'],
    ['amount in USD with spaces', 'USD 12 500 000'],
    ['amount in dollars', '$ 1.500.000,50'],
    ['7 digits in groups', '1234 567'],
    ['5 digits in groups', '12 345'],
    ['version number', 'Node 22.11.0'],
    ['12 digits without separators', '123456789012'],
  ];

  it.each(negatives)('leaves %s unchanged', (_label, text) => {
    expect(redactText(text)).toBe(text);
  });
});

describe('PiiRedactor: person name', () => {
  it('Redacción de nombre activada', () => {
    const { value } = redactor.redact(
      {
        text: 'Ana María Pérez, desarrolladora. Contacto de ANA MARÍA  PÉREZ: ana@example.com',
      },
      { redactName: true, personName: 'Ana María Pérez' },
    );

    expect(value).toEqual({
      text: '[NAME_1], desarrolladora. Contacto de [NAME_1]: [EMAIL_1]',
    });
  });

  it('keeps the name when redactName is not enabled', () => {
    const text = 'Ana Pérez, desarrolladora';

    expect(redactor.redact(text).value).toBe(text);
    expect(redactor.redact(text, { personName: 'Ana Pérez' }).value).toBe(text);
    expect(
      redactor.redact(text, { redactName: false, personName: 'Ana Pérez' })
        .value,
    ).toBe(text);
  });

  it.each([undefined, '', '   '])(
    'keeps the text when redactName is enabled without a usable name (%j)',
    (personName) => {
      const text = 'Ana Pérez, desarrolladora';

      expect(
        redactor.redact(text, { redactName: true, personName }).value,
      ).toBe(text);
    },
  );

  it('matches whole words only and treats regex characters literally', () => {
    const options = { redactName: true, personName: 'Ana' };

    expect(redactor.redact('Ana, Anabel y Mariana', options).value).toBe(
      '[NAME_1], Anabel y Mariana',
    );
    expect(
      redactor.redact('J.R. Smith y JxRx Smith', {
        redactName: true,
        personName: 'J.R. Smith',
      }).value,
    ).toBe('[NAME_1] y JxRx Smith');
  });
});

describe('PiiRedactor: reinjection', () => {
  it('Marcador en la salida', () => {
    const redaction = redactor.redact(
      {
        text: 'Ana Pérez · ana@example.com · +591 71234567 · github.com/anaperez',
      },
      { redactName: true, personName: 'Ana Pérez' },
    );
    const output = {
      summary: 'Perfil de [NAME_1] ([EMAIL_1])',
      contacts: [{ phone: '[PHONE_1]', links: ['[URL_1]', 'sin marcador'] }],
      score: 7,
      tags: null,
    };

    expect(redaction.reinject(output)).toEqual({
      summary: 'Perfil de Ana Pérez (ana@example.com)',
      contacts: [
        {
          phone: '+591 71234567',
          links: ['github.com/anaperez', 'sin marcador'],
        },
      ],
      score: 7,
      tags: null,
    });
  });

  it('reinjects the first form of a name seen with different casing', () => {
    const redaction = redactor.redact('ANA PÉREZ y luego Ana Pérez', {
      redactName: true,
      personName: 'ana pérez',
    });

    expect(redaction.value).toBe('[NAME_1] y luego [NAME_1]');
    expect(redaction.reinject('[NAME_1]')).toBe('ANA PÉREZ');
  });

  it('leaves unknown markers unchanged', () => {
    const redaction = redactor.redact('ana@example.com');

    expect(redaction.reinject('[EMAIL_1] [EMAIL_2] [PHONE_1]')).toBe(
      'ana@example.com [EMAIL_2] [PHONE_1]',
    );
  });

  it('round-trips the redacted input', () => {
    const input = {
      text: 'Ana: ana@example.com, 11 1234-5678, 2019-2023, https://ana.dev',
    };
    const redaction = redactor.redact(input, {
      redactName: true,
      personName: 'Ana',
    });

    expect(redaction.reinject(redaction.value)).toEqual(input);
  });

  it('does not keep the marker map accessible after the execution', () => {
    const email = 'ana@example.com';
    const redaction = redactor.redact({ text: email });

    // El redactor no guarda estado entre ejecuciones.
    expect(Object.keys(redactor)).toEqual([]);
    expect(JSON.stringify(redactor)).toBe('{}');
    // El resultado solo expone el valor redactado y la función de reinyección; el mapa vive en su cierre.
    expect(Object.keys(redaction).sort()).toEqual(['reinject', 'value']);
    expect(JSON.stringify(redaction)).not.toContain(email);
    // Otra ejecución no puede resolver los marcadores de la anterior.
    expect(redactor.redact({ text: 'otro texto' }).reinject('[EMAIL_1]')).toBe(
      '[EMAIL_1]',
    );
  });
});

describe('PiiRedactor: structure', () => {
  it('redacts strings at any depth without touching keys or other values', () => {
    const input = {
      'ana@example.com': 1,
      nested: [
        { email: 'ana@example.com', years: 3, active: true, none: null },
      ],
    };

    expect(redactor.redact(input).value).toEqual({
      'ana@example.com': 1,
      nested: [{ email: '[EMAIL_1]', years: 3, active: true, none: null }],
    });
  });

  it('does not mutate the input', () => {
    const input = { text: 'ana@example.com' };

    redactor.redact(input);

    expect(input).toEqual({ text: 'ana@example.com' });
  });
});
