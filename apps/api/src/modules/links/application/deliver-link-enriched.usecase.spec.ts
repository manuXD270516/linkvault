import { beforeEach, describe, expect, it } from 'vitest';
import { DeliverLinkEnriched } from './deliver-link-enriched.usecase';
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
  InMemoryEnrichmentBroadcaster,
  InMemoryGroupMembership,
  InMemoryLinkUserDirectory,
  MovableClock,
} from './testing/links-test-doubles';

// Reparto de un aviso de enriquecimiento (tareas 6.7 y 6.9). Lo que se comprueba aquí es quién recibe el aviso y qué
// lleva dentro; cómo llega a una pestaña es del canal de eventos, que es plataforma.

const ANA = objectId(1);
const BETO = objectId(2);
const STRANGER = objectId(3);
const CARLA = objectId(4);
const BACKEND = objectId(10);
const OTHER_GROUP = objectId(11);
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';

let clock: MovableClock;
let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let broadcaster: InMemoryEnrichmentBroadcaster;
let directory: InMemoryLinkUserDirectory;
let deliver: DeliverLinkEnriched;

beforeEach(() => {
  clock = new MovableClock();
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  broadcaster = new InMemoryEnrichmentBroadcaster();
  directory = new InMemoryLinkUserDirectory()
    .set(ANA, 'Ana')
    .set(BETO, 'Beto')
    .set(CARLA, 'Carla');
  const membership = new InMemoryGroupMembership()
    .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
    .withMember(BACKEND, BETO)
    .withMember(OTHER_GROUP, STRANGER, 'owner', 'De otro');
  deliver = new DeliverLinkEnriched(
    links,
    groupLinks,
    userLinks,
    membership,
    directory,
    broadcaster,
  );
});

/** Link ya enriquecido y compartido por Ana en el grupo. */
async function enrichedInGroup(): Promise<string> {
  const link = links.seed({
    ...jobLinkDraft(JOB_PAGE, { createdBy: ANA, now: clock.now() }),
    previewStatus: 'enriched',
    previewVersion: 2,
    ...enrichedPreview(ANA),
  });
  await groupLinks.share(
    { groupId: BACKEND, linkId: link.id, sharedBy: ANA, sharedAt: clock.now() },
    IN_MEMORY_SESSION,
  );
  return link.id;
}

function notice(linkId: string) {
  return { linkId, previewStatus: 'enriched', previewVersion: 2 } as const;
}

describe('DeliverLinkEnriched', () => {
  it('Miembro del grupo avisado', async () => {
    const linkId = await enrichedInGroup();

    const delivered = await deliver.execute(notice(linkId));

    expect(delivered).toBe(2);
    expect(broadcaster.recipients.sort()).toEqual([ANA, BETO].sort());
  });

  it('Extraño no avisado', async () => {
    const linkId = await enrichedInGroup();

    await deliver.execute(notice(linkId));

    expect(broadcaster.recipients).not.toContain(STRANGER);
  });

  it('La tarjeta se entera', async () => {
    const linkId = await enrichedInGroup();

    await deliver.execute(notice(linkId));
    const sent = broadcaster.sent[0]?.link;

    expect(sent?.id).toBe(linkId);
    expect(sent?.previewStatus).toBe('enriched');
    expect(sent?.previewVersion).toBe(2);
    expect(sent?.preview?.title).toBe('Backend Engineer');
    expect(sent?.sharedBy).toEqual({ userId: ANA, displayName: 'Ana' });
    expect(
      sent?.previewSources?.company?.source === 'manual'
        ? sent.previewSources.company.by
        : undefined,
    ).toEqual({ userId: ANA, displayName: 'Ana' });
  });

  it('Nadie escuchando', async () => {
    const linkId = await enrichedInGroup();
    broadcaster.withoutListeners();

    await expect(deliver.execute(notice(linkId))).resolves.toBe(0);
    expect(broadcaster.sent).toEqual([]);
  });

  it('also reaches whoever has the link in their private list', async () => {
    const linkId = await enrichedInGroup();
    await userLinks.save(
      { userId: CARLA, linkId, savedAt: clock.now() },
      IN_MEMORY_SESSION,
    );

    await deliver.execute(notice(linkId));

    expect(broadcaster.recipients.sort()).toEqual([ANA, BETO, CARLA].sort());
    // Por su lista privada no hay con quién compartir, así que no se nombra a nadie.
    expect(
      broadcaster.sent.find((entry) => entry.userId === CARLA)?.link.sharedBy,
    ).toBeUndefined();
  });

  it('warns each person once, even if they see the link from two places', async () => {
    const linkId = await enrichedInGroup();
    await userLinks.save(
      { userId: ANA, linkId, savedAt: clock.now() },
      IN_MEMORY_SESSION,
    );

    await deliver.execute(notice(linkId));

    expect(
      broadcaster.sent.filter((entry) => entry.userId === ANA),
    ).toHaveLength(1);
  });

  it('resolves the visible names of a notice with one query', async () => {
    const linkId = await enrichedInGroup();
    directory.calls = 0;

    await deliver.execute(notice(linkId));

    expect(directory.calls).toBe(1);
  });

  it('discards the notice of a link that no longer exists, without failing', async () => {
    await expect(deliver.execute(notice(objectId(999)))).resolves.toBe(0);
    expect(broadcaster.sent).toEqual([]);
  });

  it('El aviso no reemplaza a la base de datos', async () => {
    const linkId = await enrichedInGroup();
    // Alguien corrigió el preview entre el aviso y el reparto: lo que se manda es lo guardado, no lo que dijo el aviso.
    await links.updatePreview(linkId, 2, {
      preview: { title: 'Título corregido' },
      previewSources: {
        title: {
          value: 'Título corregido',
          source: 'manual',
          by: BETO,
          at: clock.now().toISOString(),
        },
      },
      now: clock.now(),
    });

    await deliver.execute(notice(linkId));
    const sent = broadcaster.sent[0]?.link;

    expect(sent?.preview?.title).toBe('Título corregido');
    expect(sent?.previewStatus).toBe('manual');
    expect(sent?.previewVersion).toBe(3);
  });
});
