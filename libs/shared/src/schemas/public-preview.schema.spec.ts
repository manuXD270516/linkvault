import { describe, expect, it } from 'vitest';
import {
  OG_DESCRIPTION_MAX_LENGTH,
  OG_TITLE_MAX_LENGTH,
  publicJobPreviewSchema,
  publicPreviewResponseSchema,
} from './public-preview.schema';

const SLUG = 'k7m2p9r4t6vw';

const publishable = {
  platform: 'linkedin' as const,
  displayUrl: 'https://bolsa.example/ofertas?jk=42',
  title: 'Backend Senior',
  company: 'Acme',
  location: 'La Paz',
  modality: 'remote' as const,
  seniority: 'senior' as const,
  salary: { min: 8000, max: 12_000, currency: 'BOB', period: 'month' as const },
  postedAt: '2026-09-01',
  expiresAt: '2026-10-01',
};

describe('publicJobPreviewSchema', () => {
  it('acepta la vacante entera con sus campos publicables', () => {
    expect(publicJobPreviewSchema.parse(publishable)).toEqual(publishable);
  });

  it('acepta un link que todavía no se ha leído', () => {
    expect(publicJobPreviewSchema.parse({ platform: 'generic' })).toEqual({
      platform: 'generic',
    });
  });

  // Lo que NO sale nunca (D6, ADR-027 §3): un `strictObject` lo rechaza en vez de dejarlo pasar en silencio.
  it.each([
    ['summary', { summary: 'Buscamos a alguien para el equipo de Ana' }],
    ['skills', { skills: [{ name: 'Node', required: true }] }],
    ['languages', { languages: [{ name: 'Inglés', level: 'B2' }] }],
    [
      'previewSources',
      { previewSources: { title: { source: 'auto', extractor: 'json-ld' } } },
    ],
    ['previewStatus', { previewStatus: 'enriched' }],
    ['previewVersion', { previewVersion: 3 }],
    ['lastEnrichmentError', { lastEnrichmentError: { reason: 'blocked' } }],
    ['sharedBy', { sharedBy: { userId: 'u1', displayName: 'Ana' } }],
    ['sharedAt', { sharedAt: '2026-09-01T00:00:00.000Z' }],
    ['note', { note: { text: 'Esta es la que te dije' } }],
    ['comments', { comments: { count: 2 } }],
    ['groupId', { groupId: '000000000000000000000001' }],
    ['groupName', { groupName: 'Backend Bolivia' }],
    ['id', { id: '000000000000000000000002' }],
    ['normalizedUrl', { normalizedUrl: 'https://bolsa.example/ofertas' }],
  ])('rechaza %s', (_name, extra) => {
    const result = publicJobPreviewSchema.safeParse({
      ...publishable,
      ...extra,
    });

    expect(result.success).toBe(false);
  });
});

describe('publicPreviewResponseSchema', () => {
  it('lleva el slug y la vacante', () => {
    const parsed = publicPreviewResponseSchema.parse({
      slug: SLUG,
      link: publishable,
    });

    expect(parsed.slug).toBe(SLUG);
    expect(parsed.link.title).toBe('Backend Senior');
  });

  it('rechaza un slug mal formado', () => {
    expect(
      publicPreviewResponseSchema.safeParse({
        slug: 'NO-ES-UN-SLUG',
        link: publishable,
      }).success,
    ).toBe(false);
  });

  it('declara los cortes de las etiquetas Open Graph', () => {
    expect(OG_TITLE_MAX_LENGTH).toBe(100);
    expect(OG_DESCRIPTION_MAX_LENGTH).toBe(200);
  });
});
