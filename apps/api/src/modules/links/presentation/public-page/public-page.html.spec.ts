import type { PublicJobPreview } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_PAGE_TEXTS,
  publicPageGoneHtml,
  publicPageHtml,
  publicPageTooManyHtml,
  type PublicPageUrls,
} from './public-page.html';

// Plantilla de la página pública (tareas 6.3 a 6.5 de public-preview-share). Función pura: no toca la petición, así que
// cada estado se comprueba sobre la cadena que devuelve.

const SLUG = 'k7m2p9r4t6vw';
const urls: PublicPageUrls = {
  pageUrl: `http://localhost:3000/p/${SLUG}`,
  webUrl: `http://localhost:4200/oferta/${SLUG}`,
  webBaseUrl: 'http://localhost:4200',
};

const full: PublicJobPreview = {
  platform: 'linkedin',
  displayUrl: 'https://bolsa.example/ofertas?jk=42',
  title: 'Backend Senior',
  company: 'Acme',
  location: 'La Paz',
  modality: 'remote',
  seniority: 'senior',
  salary: { min: 8000, max: 12_000, currency: 'BOB', period: 'month' },
  postedAt: '2026-09-01',
  expiresAt: '2026-10-01',
};

/** Contenido de la etiqueta `og:*` o `twitter:*` pedida. */
function metaOf(html: string, property: string): string | undefined {
  const match = new RegExp(
    `<meta property="${property}" content="([^"]*)">`,
  ).exec(html);
  return match?.[1];
}

describe('publicPageHtml: el <head>', () => {
  it('declara el idioma, el noindex y el juego completo de etiquetas', () => {
    const html = publicPageHtml(full, urls);

    expect(html.startsWith('<!doctype html><html lang="es">')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(metaOf(html, 'og:site_name')).toBe('LinkVault');
    expect(metaOf(html, 'og:type')).toBe('website');
    expect(metaOf(html, 'og:locale')).toBe('es_ES');
    expect(metaOf(html, 'og:url')).toBe(urls.pageUrl);
    expect(metaOf(html, 'og:title')).toBe('Backend Senior');
    expect(metaOf(html, 'og:description')).toContain('Acme');
    expect(metaOf(html, 'og:image')).toBe(
      'http://localhost:4200/assets/og-default.png',
    );
    expect(metaOf(html, 'og:image:width')).toBe('1200');
    expect(metaOf(html, 'og:image:height')).toBe('630');
    expect(metaOf(html, 'twitter:card')).toBe('summary_large_image');
    expect(metaOf(html, 'twitter:title')).toBe('Backend Senior');
    expect(metaOf(html, 'twitter:description')).toBe(
      metaOf(html, 'og:description'),
    );
  });

  it('Host falsificado: `og:url` sale de la configuración', () => {
    const html = publicPageHtml(full, urls);

    expect(metaOf(html, 'og:url')).toBe(`http://localhost:3000/p/${SLUG}`);
    expect(html).not.toContain('evil.example');
  });

  it('Título con HTML dentro', () => {
    const html = publicPageHtml(
      { ...full, title: '</title><script>alert(1)</script>', company: 'A"B' },
      urls,
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(metaOf(html, 'og:title')).toContain('&lt;/title&gt;');
    expect(html).toContain('A&quot;B');
  });
});

describe('publicPageHtml: el <body>', () => {
  it('pinta la oferta con sus campos', () => {
    const html = publicPageHtml(full, urls);

    expect(html).toContain('<h1>Backend Senior</h1>');
    expect(html).toContain('<dt>Empresa</dt><dd>Acme</dd>');
    expect(html).toContain('<dt>Ubicación</dt><dd>La Paz</dd>');
    expect(html).toContain('<dt>Salario</dt><dd>8.000 – 12.000 BOB al mes</dd>');
    expect(html).toContain('<dt>Modalidad</dt><dd>Remoto</dd>');
    expect(html).toContain('<dt>Nivel</dt><dd>Senior</dd>');
    expect(html).toContain('<dt>Publicada el</dt><dd>2026-09-01</dd>');
    expect(html).toContain('<dt>Cierra el</dt><dd>2026-10-01</dd>');
  });

  it('lleva el enlace a la oferta original', () => {
    const html = publicPageHtml(full, urls);

    expect(html).toContain(
      '<a href="https://bolsa.example/ofertas?jk=42" rel="noopener noreferrer nofollow">Ver la oferta original</a>',
    );
  });

  it('omite el enlace a la oferta original cuando no hay URL publicable', () => {
    const html = publicPageHtml({ platform: 'generic' }, urls);

    expect(html).not.toContain(PUBLIC_PAGE_TEXTS.original);
  });

  it('lleva el CTA con su promesa y el enlace de respaldo', () => {
    const html = publicPageHtml(full, urls);

    expect(html).toContain('Guardar en LinkVault');
    expect(html).toContain(
      'Guarda aquí las ofertas que te pasan por WhatsApp y no las pierdas.',
    );
    expect(html).toContain(
      `<a href="${urls.webUrl}">Ver la oferta en LinkVault</a>`,
    );
  });

  it('La página no ejecuta JavaScript', () => {
    const html = publicPageHtml(
      { ...full, title: '</title><script>alert(1)</script>' },
      urls,
    );

    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toContain('</script>');
    expect(html).toContain(
      `<meta http-equiv="refresh" content="0; url=${urls.webUrl}">`,
    );
  });

  it('pesa menos de 4 kB', () => {
    const html = publicPageHtml(
      {
        ...full,
        title: 'Ingeniero de plataforma senior '.repeat(4),
        company: 'Una empresa con un nombre bastante largo S.R.L.',
        location: 'Santa Cruz de la Sierra, Bolivia',
      },
      urls,
    );

    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(4096);
  });

  it('una oferta sin ningún campo se sirve igual', () => {
    const html = publicPageHtml({ platform: 'generic' }, urls);

    expect(html).toContain('<h1>');
    expect(html).not.toContain('<dl>');
    expect(html).toContain('Guardar en LinkVault');
  });
});

describe('las variantes de error', () => {
  it('el 404 dice qué pasó y qué hacer, sin OG y sin redirect', () => {
    const html = publicPageGoneHtml(urls);

    expect(html).toContain('Este enlace ya no está disponible');
    expect(html).toContain('Pídeselo de nuevo a quien te lo envió');
    expect(html).not.toContain('og:');
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it('el 429 dice que se reintente en un momento', () => {
    const html = publicPageTooManyHtml(urls);

    expect(html).toContain('Demasiadas peticiones. Inténtalo en un momento.');
    expect(html).not.toContain('og:');
    expect(html).not.toContain('http-equiv="refresh"');
  });

  it('los tres estados son documentos HTML sin JavaScript', () => {
    for (const html of [
      publicPageHtml(full, urls),
      publicPageGoneHtml(urls),
      publicPageTooManyHtml(urls),
    ]) {
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).not.toMatch(/<script\b/i);
      expect(html).toContain('<html lang="es">');
    }
  });

  it('el 404 no dice nada del enlace que se pidió', () => {
    const html = publicPageGoneHtml(urls);

    expect(html).not.toContain(SLUG);
  });
});
