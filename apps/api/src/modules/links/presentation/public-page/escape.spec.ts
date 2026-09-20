import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape';

describe('escapeHtml', () => {
  it.each([
    ['un cierre de título', '</title>', '&lt;/title&gt;'],
    [
      'un script entero',
      '<script>alert(1)</script>',
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    ],
    ['comillas simples', "L'Oréal", 'L&#39;Oréal'],
    ['comillas dobles', 'Acme "Bolivia"', 'Acme &quot;Bolivia&quot;'],
    [
      'un valor que se sale de un atributo',
      '" onload="alert(1)',
      '&quot; onload=&quot;alert(1)',
    ],
    ['un ampersand', 'I+D & calidad', 'I+D &amp; calidad'],
    ['una entidad ya escrita', '&amp;', '&amp;amp;'],
    ['acentos y eñes', 'Ingeniería señor ñu', 'Ingeniería señor ñu'],
    ['un emoji', 'Backend 🚀', 'Backend 🚀'],
    ['una cadena vacía', '', ''],
  ])('escapa %s', (_case, text, expected) => {
    expect(escapeHtml(text)).toBe(expected);
  });

  it('no deja ningún carácter peligroso sin escapar', () => {
    const escaped = escapeHtml(`<a href="x" onclick='y'>&</a>`);

    expect(escaped).not.toMatch(/[<>"']/);
  });
});
