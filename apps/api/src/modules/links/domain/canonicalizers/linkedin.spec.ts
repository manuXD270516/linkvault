import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../url';
import { canonicalize } from './registry';

/** Canonicalización de una URL real tal y como la escribiría una persona: primero se normaliza, como en producción. */
function canonicalizeRaw(raw: string) {
  const normalized = normalizeUrl(raw);
  expect(normalized).not.toBeNull();
  return canonicalize(normalized?.normalizedUrl ?? '');
}

describe('linkedinCanonicalizer', () => {
  it('LinkedIn en sus tres formas', () => {
    const forms = [
      'https://www.linkedin.com/jobs/view/3811111111/',
      'https://linkedin.com/comm/jobs/view/3811111111',
      'https://www.linkedin.com/jobs/search/?currentJobId=3811111111',
    ];

    for (const form of forms) {
      expect(canonicalizeRaw(form)).toEqual({
        platform: 'linkedin',
        externalJobId: '3811111111',
      });
    }
  });

  // Tabla de URLs reales anonimizadas: identificadores y slugs cambiados, forma intacta.
  it.each([
    ['https://www.linkedin.com/jobs/view/3811111111/', '3811111111'],
    ['https://www.linkedin.com/jobs/view/3811111111', '3811111111'],
    [
      'https://www.linkedin.com/jobs/view/3811111111/?refId=abc&trackingId=xyz',
      '3811111111',
    ],
    [
      'https://www.linkedin.com/jobs/view/backend-developer-at-acme-3822222222',
      '3822222222',
    ],
    ['https://linkedin.com/comm/jobs/view/3833333333', '3833333333'],
    [
      'https://www.linkedin.com/comm/jobs/view/3833333333?trk=eml-jobs_jymbii_digest-header-0-jobcard',
      '3833333333',
    ],
    [
      'https://www.linkedin.com/jobs/search/?currentJobId=3844444444&keywords=backend',
      '3844444444',
    ],
    [
      'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3855555555',
      '3855555555',
    ],
    ['https://bo.linkedin.com/jobs/view/3866666666', '3866666666'],
  ])('reads the job id of %j', (raw, externalJobId) => {
    expect(canonicalizeRaw(raw)).toEqual({ platform: 'linkedin', externalJobId });
  });

  it.each([
    // Perfiles, empresas y búsquedas sin vacante abierta no son una oferta identificable.
    ['https://www.linkedin.com/in/ana-example'],
    ['https://www.linkedin.com/company/acme/jobs/'],
    ['https://www.linkedin.com/jobs/search/?keywords=backend'],
    ['https://www.linkedin.com/jobs/view/'],
    // Identificador que no es un número de vacante.
    ['https://www.linkedin.com/jobs/view/abc'],
    ['https://www.linkedin.com/jobs/search/?currentJobId=abc'],
  ])('leaves %j as generic', (raw) => {
    expect(canonicalizeRaw(raw)).toEqual({ platform: 'generic' });
  });
});
