import { beforeEach, describe, expect, it } from 'vitest';
import { LinkNotFound, PreviewFieldUnknown } from '../domain/errors';
import { UpdateLinkPreview } from './update-link-preview.usecase';
import { InMemoryGroupLinkRepository } from './testing/in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './testing/in-memory-job-link.repository';
import { InMemoryUserLinkRepository } from './testing/in-memory-user-link.repository';
import {
  enrichedPreview,
  jobLinkDraft,
  objectId,
} from './testing/link-fixtures';
import {
  IN_MEMORY_SESSION,
  InMemoryGroupMembership,
  InMemoryLinkUserDirectory,
  MovableClock,
} from './testing/links-test-doubles';

// `PATCH /api/links/:id/preview` (tarea 6.3) con los dobles en memoria: quién puede editar, qué se guarda y qué pasa
// cuando un enriquecimiento escribe en medio.

const ANA = objectId(1);
const BETO = objectId(2);
const STRANGER = objectId(3);
const BACKEND = objectId(10);
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';

let clock: MovableClock;
let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let directory: InMemoryLinkUserDirectory;
let membership: InMemoryGroupMembership;
let updatePreview: UpdateLinkPreview;

beforeEach(() => {
  clock = new MovableClock();
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  directory = new InMemoryLinkUserDirectory().set(ANA, 'Ana').set(BETO, 'Beto');
  membership = new InMemoryGroupMembership()
    .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
    .withMember(BACKEND, BETO);
  updatePreview = new UpdateLinkPreview(
    links,
    groupLinks,
    userLinks,
    membership,
    directory,
    clock,
  );
});

/** Link ya leído y compartido en el grupo por Ana. */
async function sharedLink(): Promise<string> {
  const link = links.seed({
    ...jobLinkDraft(JOB_PAGE, { createdBy: ANA, now: clock.now() }),
    previewStatus: 'enriched',
    previewVersion: 2,
    ...enrichedPreview(ANA),
  });
  await groupLinks.share(
    {
      groupId: BACKEND,
      linkId: link.id,
      sharedBy: ANA,
      sharedAt: clock.now(),
    },
    IN_MEMORY_SESSION,
  );
  return link.id;
}

describe('UpdateLinkPreview', () => {
  it('Corregir el título', async () => {
    const linkId = await sharedLink();

    const summary = await updatePreview.execute(BETO, linkId, {
      fields: { title: 'Ingeniero de Backend' },
    });

    expect(summary.preview?.title).toBe('Ingeniero de Backend');
    expect(summary.previewStatus).toBe('manual');
    const title = summary.previewSources?.title;
    expect(title?.source).toBe('manual');
    expect(title?.source === 'manual' ? title.by : undefined).toEqual({
      userId: BETO,
      displayName: 'Beto',
    });
    expect(title?.source === 'manual' ? title.replaced : undefined).toEqual({
      value: 'Backend Engineer',
      extractor: 'json-ld',
    });
  });

  it('Estado tras editar a mano', async () => {
    // Y la versión sube: es lo que impide que un enriquecimiento en vuelo pise la corrección al terminar.
    const linkId = await sharedLink();

    const summary = await updatePreview.execute(BETO, linkId, {
      fields: { title: 'Otro' },
    });

    expect(summary.previewStatus).toBe('manual');
    expect((await links.findById(linkId))?.previewVersion).toBe(3);
  });

  it('Link que no se puede ver', async () => {
    const linkId = await sharedLink();

    await expect(
      updatePreview.execute(STRANGER, linkId, { fields: { title: 'Mío' } }),
    ).rejects.toBeInstanceOf(LinkNotFound);
    await expect(
      updatePreview.execute(ANA, objectId(999), { fields: { title: 'Mío' } }),
    ).rejects.toBeInstanceOf(LinkNotFound);
    await expect(
      updatePreview.execute(ANA, 'no-es-un-id', { fields: { title: 'Mío' } }),
    ).rejects.toBeInstanceOf(LinkNotFound);
  });

  it('Campo desconocido', async () => {
    const linkId = await sharedLink();

    await expect(
      updatePreview.execute(ANA, linkId, {
        fields: { image: 'https://example.com/a.png' },
      }),
    ).rejects.toThrow(PreviewFieldUnknown);
    // Nada se escribió: la versión sigue donde estaba.
    expect((await links.findById(linkId))?.previewVersion).toBe(2);
  });

  it('Volver a lo extraído', async () => {
    const linkId = await sharedLink();
    await updatePreview.execute(ANA, linkId, {
      fields: { title: 'Ingeniero de Backend' },
    });

    const summary = await updatePreview.execute(ANA, linkId, {
      revert: ['title'],
    });

    expect(summary.preview?.title).toBe('Backend Engineer');
    expect(summary.previewSources?.title?.source).toBe('auto');
  });

  it('can also be edited from the private list', async () => {
    const link = links.seed(
      jobLinkDraft(JOB_PAGE, { createdBy: ANA, now: clock.now() }),
    );
    await userLinks.save(
      { userId: ANA, linkId: link.id, savedAt: clock.now() },
      IN_MEMORY_SESSION,
    );

    const summary = await updatePreview.execute(ANA, link.id, {
      fields: { company: 'Acme' },
    });

    expect(summary.preview?.company).toBe('Acme');
    expect(summary.sharedBy).toBeUndefined();
  });

  it('an edit that asks for no change keeps the version, so nothing in flight dies for nothing', async () => {
    const linkId = await sharedLink();

    const summary = await updatePreview.execute(ANA, linkId, {});

    expect(summary.previewVersion).toBe(2);
    expect(summary.previewStatus).toBe('enriched');
  });

  it('la misma edición dos veces: la segunda no sube previewVersion', async () => {
    // El SPA reenvía el formulario entero. Si un valor que no se movió subiera la versión, el segundo guardado mataría
    // el enriquecimiento en vuelo a cambio de nada.
    const linkId = await sharedLink();
    await updatePreview.execute(BETO, linkId, {
      fields: { title: 'Ingeniero de Backend' },
    });
    expect((await links.findById(linkId))?.previewVersion).toBe(3);

    const summary = await updatePreview.execute(BETO, linkId, {
      fields: { title: 'Ingeniero de Backend' },
    });

    expect(summary.previewVersion).toBe(3);
    expect(summary.preview?.title).toBe('Ingeniero de Backend');
    expect((await links.findById(linkId))?.previewVersion).toBe(3);
  });

  it('redoes the edit over what an enrichment wrote in between, instead of dropping it', async () => {
    const linkId = await sharedLink();
    const original = links.updatePreview.bind(links);
    let raced = false;
    links.updatePreview = async (id, expectedVersion, changes) => {
      if (!raced) {
        raced = true;
        // Un enriquecimiento gana la carrera justo antes de esta escritura.
        await original(id, expectedVersion, {
          preview: { title: 'Título recién leído', company: 'Acme' },
          previewSources: {
            title: {
              value: 'Título recién leído',
              source: 'auto',
              extractor: 'json-ld',
              at: clock.now().toISOString(),
            },
          },
          now: clock.now(),
        });
      }
      return await original(id, expectedVersion, changes);
    };

    // El valor es distinto del guardado a propósito: una edición que reenvía lo que ya había no escribe nada, así que
    // no habría carrera que perder.
    const summary = await updatePreview.execute(ANA, linkId, {
      fields: { company: 'Acme Bolivia S.R.L.' },
    });

    expect(summary.preview?.company).toBe('Acme Bolivia S.R.L.');
    // Lo que escribió el enriquecimiento sigue ahí: la edición se rehízo encima, no lo descartó.
    expect(summary.preview?.title).toBe('Título recién leído');
  });
});
