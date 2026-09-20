import { describe, expect, it } from 'vitest';
import { publicHttpUrl } from './public-http-url';

describe('publicHttpUrl', () => {
  it.each([
    [
      'una URL http',
      'http://bolsa.example/ofertas/backend',
      'http://bolsa.example/ofertas/backend',
    ],
    [
      'una URL https',
      'https://bolsa.example/ofertas/backend',
      'https://bolsa.example/ofertas/backend',
    ],
    [
      'con credenciales',
      'https://ana:secreto@bolsa.example/ofertas',
      'https://bolsa.example/ofertas',
    ],
    [
      'con utm_*',
      'https://bolsa.example/ofertas?utm_source=mail&utm_medium=email',
      'https://bolsa.example/ofertas',
    ],
    [
      'con un mc_eid que lleva un email',
      'https://bolsa.example/ofertas?mc_eid=ana%40example.com',
      'https://bolsa.example/ofertas',
    ],
    [
      'con los parámetros de la vacante intactos',
      'https://bolsa.example/ofertas?jk=42&currentJobId=7',
      'https://bolsa.example/ofertas?jk=42&currentJobId=7',
    ],
    [
      'con fragmento, que se conserva',
      'https://bolsa.example/ofertas?jk=42&utm_source=mail&mc_eid=ana%40example.com#detalle',
      'https://bolsa.example/ofertas?jk=42#detalle',
    ],
    [
      'con solo fragmento',
      'https://bolsa.example/ofertas#/vacante/42',
      'https://bolsa.example/ofertas#/vacante/42',
    ],
  ])('publica %s', (_name, url, expected) => {
    expect(publicHttpUrl(url)).toBe(expected);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['ftp:', 'ftp://bolsa.example/ofertas'],
    ['mailto:', 'mailto:ana@example.com'],
    ['una cadena que no es una URL', 'no-es-una-url'],
    ['una cadena vacía', ''],
  ])('no publica %s', (_name, url) => {
    expect(publicHttpUrl(url)).toBeNull();
  });

  it('quita a la vez las credenciales y el rastro, conservando el fragmento', () => {
    const published = publicHttpUrl(
      'https://ana:secreto@bolsa.example/ofertas?jk=42&utm_source=mail&mc_eid=ana%40example.com#detalle',
    );

    expect(published).toBe('https://bolsa.example/ofertas?jk=42#detalle');
    expect(published).not.toContain('ana');
    expect(published).not.toContain('secreto');
    expect(published).not.toContain('utm_source');
    expect(published).not.toContain('mc_eid');
  });
});
