import { describe, expect, it } from 'vitest';
import { scrubContactDetails } from './contact-scrub';

// Higiene de contactos (D7 de link-enrichment, D4 de paste-job-description). Estos casos fijan el comportamiento tal
// como estaba en el worker: la entrada de `extract-job` sale de aquí, así que un cambio invalidaría sus fixtures.

describe('scrubContactDetails', () => {
  it('leaves the recruiter email and phone out', () => {
    expect(
      scrubContactDetails(
        'Arquitecto(a) de Soluciones. Envía tu CV a empleos@empresa.example o llama al +591 70000000.',
      ),
    ).toBe('Arquitecto(a) de Soluciones. Envía tu CV a o llama al .');
  });

  it('leaves mailto:, tel: and whatsapp: out, whole', () => {
    const scrubbed = scrubContactDetails(
      'Contacto: mailto:rrhh@empresa.example o tel:+59170000000 o whatsapp:+59171111111',
    );

    expect(scrubbed).toBe('Contacto: o o');
    expect(scrubbed).not.toContain('rrhh');
  });

  it('takes phones with an area code in brackets and separated by spaces or dashes', () => {
    expect(scrubContactDetails('Tel. (02) 2441234 / 591-2-244-1234 fin')).toBe(
      'Tel. / fin',
    );
  });

  it('does not mistake a salary for a phone number', () => {
    // El punto es separador de millares en español: aceptarlo como separador de teléfono borraría el salario.
    expect(
      scrubContactDetails(
        'Salario: 15.000 - 20.000 Bs. Rango anual 20.000.000 COP. Rango 15 000 - 20 000 Bs.',
      ),
    ).toBe(
      'Salario: 15.000 - 20.000 Bs. Rango anual 20.000.000 COP. Rango 15 000 - 20 000 Bs.',
    );
  });

  it('keeps numbers too short to be a phone', () => {
    expect(scrubContactDetails('Código 123456, 3 años de experiencia')).toBe(
      'Código 123456, 3 años de experiencia',
    );
  });

  it('joins the text in a single line and trims it, as it always did', () => {
    // No se corrige aunque pierda los saltos de línea: cambiarlo invalidaría los fixtures de páginas de `extract-job`.
    expect(scrubContactDetails('  Backend\n\n  Engineer\t en Acme  ')).toBe(
      'Backend Engineer en Acme',
    );
  });

  it('leaves nothing of a text that only had contact details', () => {
    expect(scrubContactDetails(' +591 70000000 \n rrhh@empresa.example ')).toBe(
      '',
    );
  });

  it('changes nothing on a text already scrubbed', () => {
    const once = scrubContactDetails(
      'Oferta: Backend. Escribe a rrhh@empresa.example o al 70000000.\nSalario 15.000 Bs.',
    );

    expect(scrubContactDetails(once)).toBe(once);
  });
});
