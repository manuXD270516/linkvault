import { describe, expect, it } from 'vitest';
import { extractUrls } from './link-text';
import { MAX_URL_LENGTH } from './limits';

describe('extractUrls', () => {
  it('Chat de WhatsApp pegado', () => {
    const chat = [
      '[17/9/2026, 10:02] Ana: chicos, miren esta https://www.linkedin.com/jobs/view/3811111111/',
      '[17/9/2026, 10:03] Beto: la misma que pasé ayer https://www.linkedin.com/jobs/view/3811111111/',
      '[17/9/2026, 10:05] Ana: y esta también (https://bo.computrabajo.com/acme/ofertas-de-trabajo/oferta-de-trabajo-de-backend-en-la-paz-a1b2c3d4e5f60718)',
    ].join('\n');

    expect(extractUrls(chat)).toEqual({
      urls: [
        'https://www.linkedin.com/jobs/view/3811111111/',
        'https://bo.computrabajo.com/acme/ofertas-de-trabajo/oferta-de-trabajo-de-backend-en-la-paz-a1b2c3d4e5f60718',
      ],
      unrecognized: 0,
    });
  });

  it('Texto sin URLs', () => {
    const chat = [
      '[17/9/2026, 10:02] Ana: ¿alguien sabe de algo para backend?',
      '[17/9/2026, 10:03] Beto: te aviso si veo algo, llámame al 700-00000',
    ].join('\n');

    expect(extractUrls(chat)).toEqual({ urls: [], unrecognized: 0 });
  });

  it('Enlace que no se puede leer', () => {
    const chat = 'Ana: se cortó http://\nBeto: y este ftp://example.com/job';

    expect(extractUrls(chat)).toEqual({ urls: [], unrecognized: 2 });
  });

  it.each([
    ['mira esto: https://example.com/jobs/1.', 'https://example.com/jobs/1'],
    ['(https://example.com/jobs/1)', 'https://example.com/jobs/1'],
    ['[https://example.com/jobs/1],', 'https://example.com/jobs/1'],
    ['«https://example.com/jobs/1»', 'https://example.com/jobs/1'],
    ['"https://example.com/jobs/1"', 'https://example.com/jobs/1'],
    ["'https://example.com/jobs/1'", 'https://example.com/jobs/1'],
    ['{https://example.com/jobs/1}!', 'https://example.com/jobs/1'],
    ['¿esta? https://example.com/jobs/1?', 'https://example.com/jobs/1'],
    ['https://example.com/jobs/1…', 'https://example.com/jobs/1'],
  ])('trims the closing punctuation of %j', (text, url) => {
    expect(extractUrls(text).urls).toEqual([url]);
  });

  it('keeps the query parameters of a url followed by a comma', () => {
    expect(
      extractUrls('mira https://example.com/jobs?jk=abc, y también otra').urls,
    ).toEqual(['https://example.com/jobs?jk=abc']);
  });

  it('drops repeated urls that normalize to the same one, keeping the first form', () => {
    const chat = [
      'Ana: https://www.Example.com/jobs/1?utm_source=wa',
      'Beto: https://example.com/jobs/1/',
      'Ana: https://example.com/jobs/1#apply',
    ].join('\n');

    expect(extractUrls(chat).urls).toEqual([
      'https://www.Example.com/jobs/1?utm_source=wa',
    ]);
  });

  it('keeps the order in which the urls appear', () => {
    const chat = [
      'https://example.com/jobs/3',
      'https://example.com/jobs/1',
      'https://example.com/jobs/2',
    ].join(' · ');

    expect(extractUrls(chat).urls).toEqual([
      'https://example.com/jobs/3',
      'https://example.com/jobs/1',
      'https://example.com/jobs/2',
    ]);
  });

  it('finds urls glued to the text of the chat', () => {
    const chat = 'Ana:https://example.com/jobs/1\nBeto: 10:05https://example.com/jobs/2';

    expect(extractUrls(chat).urls).toEqual([
      'https://example.com/jobs/1',
      'https://example.com/jobs/2',
    ]);
  });

  it('counts a url longer than the maximum as unrecognized instead of failing', () => {
    const tooLong = `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`;
    const chat = `Ana: ${tooLong}\nBeto: https://example.com/jobs/1`;

    expect(extractUrls(chat)).toEqual({
      urls: ['https://example.com/jobs/1'],
      unrecognized: 1,
    });
  });

  it('ignores the rest of the text, including phone numbers and names', () => {
    const chat =
      '[17/9/2026, 10:02] Ana Quispe (+591 700-00000): postulé aquí https://example.com/jobs/1';

    expect(extractUrls(chat)).toEqual({
      urls: ['https://example.com/jobs/1'],
      unrecognized: 0,
    });
  });
});
