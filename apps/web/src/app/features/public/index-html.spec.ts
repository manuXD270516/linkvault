import indexHtml from '../../../index.html' with { loader: 'text' };

/** Etiquetas `<meta>` del documento, por `property` o por `name`. */
function metaTags(html: string): Map<string, string> {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return new Map(
    Array.from(document.getElementsByTagName('meta'))
      .map((tag): [string, string] => [
        tag.getAttribute('property') ?? tag.getAttribute('name') ?? '',
        tag.getAttribute('content') ?? '',
      ])
      .filter(([key]) => key !== ''),
  );
}

describe('index.html del SPA', () => {
  it('Tarjeta genérica en vez de tarjeta vacía', () => {
    const meta = metaTags(indexHtml);

    expect(meta.get('og:site_name')).toBe('LinkVault');
    expect(meta.get('og:title')).toBe('LinkVault');
    expect(meta.get('og:description')).toBe(
      'Guarda aquí las ofertas que te pasan por WhatsApp y no las pierdas.',
    );
    // La misma imagen que usa la página pública de la api (`WEB_BASE_URL/assets/og-default.png`).
    expect(meta.get('og:image')).toBe('/assets/og-default.png');
  });

  it('La tarjeta de respaldo no dice nada de nadie', () => {
    const meta = metaTags(indexHtml);
    const open = [...meta].filter(([key]) => key.startsWith('og:') || key.startsWith('twitter:'));

    expect(open.length).toBeGreaterThan(0);
    for (const [key, content] of open) {
      // Fijas para todas las rutas: nada que salga de una oferta, de una persona o de un enlace público.
      expect.soft(content, key).not.toMatch(/\{\{|\$\{|slug|oferta pública/i);
      expect.soft(content, key).not.toMatch(/Ana|Beto|Acme|Backend Bolivia/);
      expect.soft(content, key).not.toContain('/p/');
    }
  });
});
