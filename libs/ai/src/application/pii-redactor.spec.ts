import { describe, expect, it } from 'vitest';
import {
  REDACTED_DATA_TYPE_IDS,
} from '@linkvault/shared';
import {
  DETECTED_PII_KINDS,
  findInventedPiiMarkers,
  PII_KINDS,
  PiiRedactor,
} from './pii-redactor';

// Escenarios de specs/ai/data-protection/spec.md, D8/D10 de cv-match-suggestions y D11 de ai-gateway-core.

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
    ['capitalized TLD at the end of the text', 'anaperez.Me', '[URL_1]'],
    [
      'capitalized TLD followed by a comma',
      'Contacto: anaperez.Me, Lima',
      'Contacto: [URL_1], Lima',
    ],
    [
      'capitalized TLD followed by a path',
      'anaperez.Me/cv y más',
      '[URL_1] y más',
    ],
    [
      'lowercase TLD followed by a word',
      'Anaperez.dev es mi sitio',
      '[URL_1] es mi sitio',
    ],
    [
      'uppercase TLD followed by a word',
      'ANAPEREZ.DEV ES MI SITIO',
      '[URL_1] ES MI SITIO',
    ],
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
    'NestJS.Me encargué del backend',
    'Angular.Co mencé en 2020',
    'Json.NET',
    'Rx.NET',
    'Akka.NET',
    'Hangfire.io',
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
    // El apellido suelto "Smith" sí se sustituye si pasa las exclusiones (5.11); "J.R." no encaja en "JxRx".
    expect(
      redactor.redact('J.R. Smith y JxRx Smith', {
        redactName: true,
        personName: 'J.R. Smith',
      }).value,
    ).toBe('[NAME_1] y JxRx [NAME_1]');
  });
});

describe('PiiRedactor: reinjection', () => {
  it('Marcador en la salida', () => {
    const redaction = redactor.redact(
      {
        text: 'Ana Pérez · ana@example.com · +591 71234567 · github.com/anaperez · Av. Ballivián 1234 · CI: 4567890 LP',
      },
      { redactName: true, personName: 'Ana Pérez' },
    );
    expect(redaction.value).toEqual({
      text: '[NAME_1] · [EMAIL_1] · [PHONE_1] · [URL_1] · [ADDRESS_1] · CI: [ID_1]',
    });
    const output = {
      summary: 'Perfil de [NAME_1] ([EMAIL_1]) en [ADDRESS_1] doc [ID_1]',
      contacts: [{ phone: '[PHONE_1]', links: ['[URL_1]', 'sin marcador'] }],
      score: 7,
      tags: null,
    };

    expect(redaction.reinject(output)).toEqual({
      summary:
        'Perfil de Ana Pérez (ana@example.com) en Av. Ballivián 1234 doc 4567890 LP',
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
    // El resultado solo expone el valor redactado, los marcadores emitidos (sin valores) y la reinyección.
    expect(Object.keys(redaction).sort()).toEqual([
      'emittedMarkers',
      'reinject',
      'value',
    ]);
    expect(JSON.stringify(redaction)).not.toContain(email);
    expect([...redaction.emittedMarkers]).toEqual(['[EMAIL_1]']);
    // Otra ejecución no puede resolver los marcadores de la anterior.
    expect(redactor.redact({ text: 'otro texto' }).reinject('[EMAIL_1]')).toBe(
      '[EMAIL_1]',
    );
  });

  it('Nombre redactado dentro de una sugerencia', () => {
    const redaction = redactor.redact(
      { cvText: 'Ana Paz Flores · ana@example.com' },
      { redactName: true, personName: 'Ana Paz Flores' },
    );
    const output = {
      suggestions: [
        {
          after: 'Experiencia de [NAME_1] en [EMAIL_1]',
          reason: 'encaje',
        },
      ],
    };

    expect(redaction.reinject(output)).toEqual({
      suggestions: [
        {
          after: 'Experiencia de Ana Paz Flores en ana@example.com',
          reason: 'encaje',
        },
      ],
    });
    expect(JSON.stringify(redaction.reinject(output))).not.toContain('[NAME_1]');
  });

  it('discards the marker map when the caller throws after redact', () => {
    const email = 'ana@example.com';
    let redaction: ReturnType<typeof redactor.redact<{ text: string }>> | undefined;
    try {
      redaction = redactor.redact({ text: email });
      throw new Error('boom');
    } catch {
      expect(redaction).toBeDefined();
      expect(JSON.stringify(redaction)).not.toContain(email);
      expect(Object.keys(redaction!).sort()).toEqual([
        'emittedMarkers',
        'reinject',
        'value',
      ]);
    }
  });
});

describe('PiiRedactor: canonical kinds', () => {
  it('derives PiiKind from the shared canonical list', () => {
    expect(PII_KINDS).toEqual(
      REDACTED_DATA_TYPE_IDS.map((id) => id.toUpperCase()),
    );
  });

  it('covers every canonical redacted type with a detector', () => {
    // Añadir un tipo a la lista canónica sin tocar el redactor rompe este test.
    expect([...DETECTED_PII_KINDS].sort()).toEqual([...PII_KINDS].sort());
  });

  it('numbers ADDRESS and ID independently and does not re-redact markers', () => {
    const { value, emittedMarkers } = redactor.redact(
      'Av. Ballivián 1234 · CI: 4567890 LP',
    );

    expect(value).toBe('[ADDRESS_1] · CI: [ID_1]');
    expect(emittedMarkers).toEqual(new Set(['[ADDRESS_1]', '[ID_1]']));

    // Un marcador ya presente en el input no se vuelve a redactar ni a renumerar.
    const again = redactor.redact(
      'resto [ADDRESS_1] y [ID_1] sin reescritura',
    ).value;
    expect(again).toBe('resto [ADDRESS_1] y [ID_1] sin reescritura');
  });
});

describe('PiiRedactor: address', () => {
  it('Dirección en el encabezado de un CV', () => {
    expect(redactText('Av. Ballivián 1234, Zona Sur, La Paz')).toBe(
      '[ADDRESS_1]',
    );
  });

  it.each([
    ['AV BALLIVIAN 1234', '[ADDRESS_1]'],
    ['Calle', 'Calle'],
    ['textoCalle 12', 'textoCalle 12'],
    ['Calle sin numero', 'Calle sin numero'],
  ])('table case %s', (text, expected) => {
    expect(redactText(text)).toBe(expected);
  });

  it('Indicador numérico en prosa', () => {
    expect(redactText('Zona de influencia: 4 departamentos')).toBe(
      'Zona de influencia: 4 departamentos',
    );
    expect(redactText('N° de empleados a cargo: 12')).toBe(
      'N° de empleados a cargo: 12',
    );
    expect(redactText('Torre de control de calidad')).toBe(
      'Torre de control de calidad',
    );
    expect(redactText('Av. Ballivián 1234, Zona 12')).toBe('[ADDRESS_1]');
  });

  it('handles #450 inside an address and rejects C# / F# / spaced hash', () => {
    expect(redactText('Calle Falsa #450')).toBe('[ADDRESS_1]');
    expect(redactText('#450')).toBe('[ADDRESS_1]');
    expect(redactText('C#')).toBe('C#');
    expect(redactText('F#')).toBe('F#');
    expect(redactText('# 450')).toBe('# 450');
  });

  it('La dirección termina en el separador', () => {
    expect(redactText('Calle 21 de Calacoto 500 — Desarrollador Senior')).toBe(
      '[ADDRESS_1] — Desarrollador Senior',
    );
    expect(redactText('Calle 21 de Calacoto 500 | Desarrollador Senior')).toBe(
      '[ADDRESS_1] | Desarrollador Senior',
    );
    expect(
      redactText('Calle 21 de Calacoto 500\tDesarrollador Senior'),
    ).toBe('[ADDRESS_1]\tDesarrollador Senior');
    expect(redactText('Av. Ballivián 1234, Zona Sur, La Paz')).toBe(
      '[ADDRESS_1]',
    );
  });

  it('Un lenguaje de programación no es una dirección', () => {
    const line =
      'Lenguajes: C#, C/C++, F#, .NET 8, Python 3.11, Km de código en producción';
    const redacted = redactText(line);

    expect(redacted).toBe(line);
    expect(redacted).toContain('C#');
    expect(redacted).toContain('C/C++');
    expect(redacted).toContain('F#');
    expect(redacted).toContain('.NET');
  });

  it('Una ciudad no es una dirección', () => {
    expect(redactText('La Paz, Bolivia')).toBe('La Paz, Bolivia');
    expect(redactText('Santa Cruz')).toBe('Santa Cruz');
    expect(redactText('disponible para remoto desde Cochabamba')).toBe(
      'disponible para remoto desde Cochabamba',
    );
  });

  it('does not fire an address indicator inside an already emitted URL marker', () => {
    const { value } = redactor.redact(
      'Ver https://maps.example.com/Calle-12 y luego otra cosa',
    );

    expect(value).toContain('[URL_1]');
    expect(value).not.toContain('[ADDRESS_');
    expect(value).not.toContain('maps.example.com');
  });
});

describe('PiiRedactor: identity document', () => {
  it('CI boliviano con extensión departamental', () => {
    const redacted = redactText('CI 4567890 LP y control 1234567-1E');

    expect(redacted).toMatch(/\[ID_1\].*\[ID_2\]/);
    expect(redacted).not.toContain('4567890');
    expect(redacted).not.toContain('1234567-1E');
  });

  it('Documento con palabra clave', () => {
    expect(redactText('DNI: 45.678.901')).toBe('DNI: [ID_1]');
    expect(redactText('Cédula de identidad 8901234')).toBe(
      'Cédula de identidad [ID_1]',
    );
    expect(redactText('Pasaporte AB123456')).toBe('Pasaporte [ID_1]');
  });

  it('does not redact when the keyword is too far or has no number', () => {
    const far =
      'CI' + 'x'.repeat(40) + '71234567';
    expect(redactText(far)).toBe(far);
    expect(redactText('CI sin número cerca')).toBe('CI sin número cerca');
  });

  it('Número suelto que no es documento', () => {
    expect(redactText('Gestioné un presupuesto de 850000')).toBe(
      'Gestioné un presupuesto de 850000',
    );
    expect(redactText('ISO 27001')).toBe('ISO 27001');
    expect(redactText('Promoción 2019')).toBe('Promoción 2019');
  });

  it('Número que parece documento y teléfono a la vez', () => {
    const redacted = redactText('CI 71234567');

    expect(redacted).toBe('CI [ID_1]');
    expect(redacted).not.toContain('71234567');
    expect(redacted).not.toContain('[PHONE_');
  });
});

describe('PiiRedactor: name precision', () => {
  it('Límite de palabra', () => {
    const options = { redactName: true, personName: 'Ana Paz Flores' };

    expect(redactor.redact('Pazos', options).value).toBe('Pazos');
    expect(redactor.redact('Capaz de liderar', options).value).toBe(
      'Capaz de liderar',
    );
    expect(redactor.redact('Floresta Urbana', options).value).toBe(
      'Floresta Urbana',
    );
    expect(redactor.redact('Cruzada comercial', options).value).toBe(
      'Cruzada comercial',
    );
  });

  it('El apellido coincide con la ciudad', () => {
    const options = { redactName: true, personName: 'Ana Paz Flores' };
    const header = redactor.redact('Ana Paz Flores', options).value;
    const location = redactor.redact(
      'La Paz, Bolivia — disponible para remoto',
      options,
    ).value;

    expect(header).toBe('[NAME_1]');
    expect(location).toBe('La Paz, Bolivia — disponible para remoto');
    expect(location).not.toContain('[NAME_');
  });

  it('Santa Cruz sigue siendo Santa Cruz', () => {
    const options = { redactName: true, personName: 'Beto Cruz Vargas' };
    const text =
      'Santa Cruz de la Sierra y traslado a Santa Cruz en 2021';

    expect(redactor.redact(text, options).value).toBe(text);
  });

  it('El apellido dentro del nombre del empleador', () => {
    const options = { redactName: true, personName: 'Ana Paz Flores' };
    const text =
      'Constructora Flores S.R.L. — Jefa de proyecto y Banco Los Andes S.A.';
    const redacted = redactor.redact(text, options).value;

    expect(redacted).toContain('Constructora Flores S.R.L.');
    expect(redacted).toContain('Banco Los Andes S.A.');
    expect(redacted).toContain('Flores');
  });

  it('La palabra corriente en minúscula', () => {
    const options = { redactName: true, personName: 'Luis Campos Cruz' };

    expect(
      redactor.redact('normalicé 40 campos del formulario', options).value,
    ).toBe('normalicé 40 campos del formulario');
    expect(
      redactor.redact('validación cruz de inventarios', options).value,
    ).toBe('validación cruz de inventarios');
  });

  it('La dirección con el apellido dentro se sigue redactando', () => {
    const options = { redactName: true, personName: 'Ana Paz Flores' };
    const redacted = redactor.redact('Av. Las Flores 220, Zona Sur', options)
      .value;

    expect(redacted).toBe('[ADDRESS_1]');
  });
});

describe('findInventedPiiMarkers', () => {
  it('is observable outside the pipeline module', () => {
    const invented = findInventedPiiMarkers(
      { after: 'pega [ADDRESS_3] aquí' },
      new Set(['[EMAIL_1]', '[PHONE_1]']),
    );

    expect(invented).toEqual(['[ADDRESS_3]']);
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
