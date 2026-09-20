import { describe, expect, it } from 'vitest';
import { linkLabel } from './link-label';

describe('linkLabel', () => {
  it.each([
    [
      'https://www.linkedin.com/jobs/view/senior-backend-engineer-at-acme-3912345678/?utm_source=share',
      'senior backend engineer at acme 3912345678',
    ],
    [
      'https://co.computrabajo.com/trabajo-de-analista-de-datos-en-acme-1A2B3C',
      'trabajo de analista de datos en acme 1A2B3C',
    ],
    ['https://ejemplo.test/ofertas/analista.html', 'analista'],
    [
      'https://ejemplo.test/ofertas/desarrollador%20senior',
      'desarrollador senior',
    ],
    ['https://ejemplo.test/ofertas/analista/', 'analista'],
    ['https://www.getonboard.com/', 'getonboard.com'],
    ['https://ejemplo.test', 'ejemplo.test'],
    ['no-es-una-url', 'no-es-una-url'],
  ])('derives the label of %s', (url, expected) => {
    expect(linkLabel(url)).toBe(expected);
  });
});
