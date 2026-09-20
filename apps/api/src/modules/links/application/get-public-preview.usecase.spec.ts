import { beforeEach, describe, expect, it } from 'vitest';
import { publicJobPreviewSchema } from '@linkvault/shared';
import type { JobLink } from '../domain/job-link';
import { GetPublicPreview } from './get-public-preview.usecase';
import { InMemoryGroupLinkRepository } from './testing/in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './testing/in-memory-job-link.repository';
import { jobLinkDraft, objectId } from './testing/link-fixtures';
import { IN_MEMORY_SESSION } from './testing/links-test-doubles';

// `GET /api/public/previews/:slug` y la página pública (tarea 4.7 de public-preview-share). Dos lecturas indexadas y
// ninguna escritura; el mapeo va por lista explícita de campos, así que lo que no está en la lista no puede salir.

const ANA = objectId(1);
const BACKEND = objectId(10);
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const now = new Date('2026-09-19T10:00:00.000Z');

let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let preview: GetPublicPreview;

beforeEach(() => {
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  preview = new GetPublicPreview(groupLinks, links);
});

/** Vacante compartida en un grupo y publicada; devuelve su slug. */
async function published(
  url = JOB_PAGE,
  changes: Partial<JobLink> = {},
): Promise<{ slug: string; linkId: string }> {
  const link = links.seed({ ...jobLinkDraft(url), ...changes });
  await groupLinks.share(
    { groupId: BACKEND, linkId: link.id, sharedBy: ANA, sharedAt: now },
    IN_MEMORY_SESSION,
  );
  const share = await groupLinks.publish(BACKEND, link.id, ANA, now);
  return { slug: share?.slug ?? '', linkId: link.id };
}

describe('GetPublicPreview', () => {
  it('Preview público', async () => {
    const { slug } = await published(JOB_PAGE, {
      previewStatus: 'enriched',
      preview: {
        title: 'Backend Senior',
        company: 'Acme',
        location: 'La Paz',
        modality: 'remote',
        seniority: 'senior',
        salary: { min: 8000, max: 12_000, currency: 'BOB', period: 'month' },
        postedAt: '2026-09-01',
        expiresAt: '2026-10-01',
      },
    });

    const response = await preview.execute(slug);

    expect(response?.slug).toBe(slug);
    expect(response?.link).toEqual({
      platform: 'linkedin',
      displayUrl: JOB_PAGE,
      title: 'Backend Senior',
      company: 'Acme',
      location: 'La Paz',
      modality: 'remote',
      seniority: 'senior',
      salary: { min: 8000, max: 12_000, currency: 'BOB', period: 'month' },
      postedAt: '2026-09-01',
      expiresAt: '2026-10-01',
    });
    expect(publicJobPreviewSchema.parse(response?.link)).toEqual(
      response?.link,
    );
  });

  it('no publica nada que no esté en la lista de campos', async () => {
    const { slug } = await published(JOB_PAGE, {
      previewStatus: 'enriched',
      preview: {
        title: 'Backend Senior',
        company: 'Acme',
        summary: 'Escríbele a Ana, la reclutadora, al 700-12345',
        skills: [{ name: 'Node', required: true }],
        languages: [{ name: 'Inglés', level: 'B2' }],
      },
      previewSources: {
        title: {
          value: 'Backend Senior',
          source: 'manual',
          by: ANA,
          at: now.toISOString(),
        },
      },
    });

    const response = await preview.execute(slug);

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('summary');
    expect(serialized).not.toContain('Ana');
    expect(serialized).not.toContain('skills');
    expect(serialized).not.toContain('languages');
    expect(serialized).not.toContain('previewSources');
    expect(serialized).not.toContain('previewStatus');
    expect(serialized).not.toContain(BACKEND);
    expect(response?.link).not.toHaveProperty('id');
  });

  it('Oferta sin preview todavía', async () => {
    const { slug } = await published();

    await expect(preview.execute(slug)).resolves.toEqual({
      slug,
      link: { platform: 'linkedin', displayUrl: JOB_PAGE },
    });
  });

  it('Slug quemado', async () => {
    const { slug, linkId } = await published();
    await groupLinks.unpublish(BACKEND, linkId);

    await expect(preview.execute(slug)).resolves.toBeNull();
  });

  it.each([
    ['uno inexistente', 'zzzzzzzzzzzz'],
    ['uno mal formado', 'NO-ES-UN-SLUG'],
    ['uno vacío', ''],
    ['un intento de recorrido', '../../etc/passwd'],
  ])('Slug %s responde null', async (_case, slug) => {
    await expect(preview.execute(slug)).resolves.toBeNull();
  });

  it('Slug mal formado no cuesta ninguna lectura', async () => {
    const before = groupLinks.findByPublicSlugCalls;

    await preview.execute('NO-ES-UN-SLUG');

    expect(groupLinks.findByPublicSlugCalls).toBe(before);
  });

  it('URL original con credenciales y rastro', async () => {
    const { slug } = await published(
      'https://ana:secreto@bolsa.example/ofertas?jk=42&utm_source=mail&mc_eid=ana%40example.com#detalle',
    );

    const response = await preview.execute(slug);

    expect(response?.link.displayUrl).toBe(
      'https://bolsa.example/ofertas?jk=42#detalle',
    );
    expect(JSON.stringify(response)).not.toContain('secreto');
    expect(JSON.stringify(response)).not.toContain('mc_eid');
  });

  it('URL original que no se puede publicar', async () => {
    // El alta ya rechaza una URL que no es `http(s)`, así que esto solo puede venir de un documento viejo o de una
    // escritura ajena; aun así la página tiene que servirse, sin enlace a la oferta original.
    const { slug } = await published(JOB_PAGE, {
      displayUrl: 'ftp://bolsa.example/ofertas/backend',
    });

    const response = await preview.execute(slug);

    expect(response).not.toBeNull();
    expect(response?.link).not.toHaveProperty('displayUrl');
  });

  it('No llama a ningún otro puerto: dos lecturas y ninguna escritura', async () => {
    const { slug } = await published();
    const before = {
      bySlug: groupLinks.findByPublicSlugCalls,
      byId: links.findByIdCalls,
      find: groupLinks.findCalls,
      list: groupLinks.listByGroupCalls,
      count: groupLinks.countByGroupCalls,
      relations: groupLinks.size,
    };

    await preview.execute(slug);

    expect(groupLinks.findByPublicSlugCalls).toBe(before.bySlug + 1);
    expect(links.findByIdCalls).toBe(before.byId + 1);
    expect(groupLinks.findCalls).toBe(before.find);
    expect(groupLinks.listByGroupCalls).toBe(before.list);
    expect(groupLinks.countByGroupCalls).toBe(before.count);
    expect(groupLinks.size).toBe(before.relations);
  });
});
