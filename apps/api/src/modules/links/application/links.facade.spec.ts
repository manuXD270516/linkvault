import { beforeEach, describe, expect, it } from 'vitest';
import type { JobLink } from '../domain/job-link';
import { LinksFacade } from './links.facade';
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
} from './testing/links-test-doubles';

// Escenarios de "Links disponibles para otros módulos" (spec links/sharing), con los repositorios en memoria.

const ANA = objectId(1);
const BETO = objectId(2);
const MINE = objectId(10);
const FOREIGN = objectId(11);
const now = new Date('2026-09-19T10:00:00.000Z');

let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let membership: InMemoryGroupMembership;
let facade: LinksFacade;
let privateLink: JobLink;
let groupLink: JobLink;
let foreignLink: JobLink;

beforeEach(async () => {
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  membership = new InMemoryGroupMembership()
    .withMember(MINE, ANA)
    .withMember(FOREIGN, BETO);
  facade = new LinksFacade(links, groupLinks, userLinks, membership);

  privateLink = links.seed(
    jobLinkDraft('https://www.linkedin.com/jobs/view/3811111111/'),
  );
  groupLink = links.seed(
    jobLinkDraft('https://www.linkedin.com/jobs/view/3822222222/'),
  );
  foreignLink = links.seed(
    jobLinkDraft('https://www.linkedin.com/jobs/view/3833333333/'),
  );
  await userLinks.save(
    { userId: ANA, linkId: privateLink.id, savedAt: now },
    IN_MEMORY_SESSION,
  );
  await groupLinks.seed({
    groupId: MINE,
    linkId: groupLink.id,
    sharedBy: ANA,
    sharedAt: now,
  });
  await groupLinks.seed({
    groupId: FOREIGN,
    linkId: foreignLink.id,
    sharedBy: BETO,
    sharedAt: now,
  });
});

describe('LinksFacade', () => {
  it('Otro módulo pregunta si alguien ve un link', async () => {
    await expect(facade.canRead(ANA, privateLink.id)).resolves.toBe(true);
    await expect(facade.canRead(ANA, groupLink.id)).resolves.toBe(true);
    await expect(facade.canRead(ANA, foreignLink.id)).resolves.toBe(false);
  });

  it('answers false for a link that does not exist or a malformed id', async () => {
    await expect(facade.canRead(ANA, objectId(999))).resolves.toBe(false);
    await expect(facade.canRead(ANA, 'no-es-un-id')).resolves.toBe(false);
  });

  it('Fichas de varios links a la vez', async () => {
    links.overwrite(groupLink.id, {
      previewStatus: 'enriched',
      ...enrichedPreview(ANA),
    });

    const cards = await facade.cardsOf([
      privateLink.id,
      groupLink.id,
      foreignLink.id,
      'no-es-un-id',
    ]);

    expect(cards).toHaveLength(3);
    expect(cards.find((card) => card.id === groupLink.id)).toEqual({
      id: groupLink.id,
      displayUrl: groupLink.displayUrl,
      platform: 'linkedin',
      previewStatus: 'enriched',
      title: 'Backend Engineer',
      company: 'Acme Bolivia',
    });
    expect(cards.find((card) => card.id === privateLink.id)).toEqual({
      id: privateLink.id,
      displayUrl: privateLink.displayUrl,
      platform: 'linkedin',
      previewStatus: 'pending',
    });
    expect(links.cardsOfCalls).toBe(1);
  });

  it('Qué links están en un grupo', async () => {
    const other = links.seed(
      jobLinkDraft('https://www.linkedin.com/jobs/view/3844444444/'),
    );
    await groupLinks.seed({
      groupId: MINE,
      linkId: other.id,
      sharedBy: ANA,
      sharedAt: now,
    });

    const shared = await facade.linkIdsSharedIn(MINE, [
      groupLink.id,
      other.id,
      foreignLink.id,
      'no-es-un-id',
    ]);

    expect([...shared].sort()).toEqual([groupLink.id, other.id].sort());
    expect(groupLinks.linkIdsInCalls).toBe(1);
  });

  it('answers nothing for a malformed group id', async () => {
    await expect(
      facade.linkIdsSharedIn('no-es-un-id', [groupLink.id]),
    ).resolves.toEqual(new Set());
  });

  it('matchJobSummaryOf exposes previewVersion, title and summary as description', async () => {
    const withPreview = links.seed({
      ...jobLinkDraft('https://www.linkedin.com/jobs/view/3855555555/'),
      previewStatus: 'enriched',
      previewVersion: 4,
      preview: {
        title: 'Backend Engineer',
        summary: 'Texto de la vacante',
      },
    });
    await userLinks.save(
      { userId: ANA, linkId: withPreview.id, savedAt: now },
      IN_MEMORY_SESSION,
    );

    await expect(facade.matchJobSummaryOf(withPreview.id)).resolves.toEqual({
      id: withPreview.id,
      previewVersion: 4,
      title: 'Backend Engineer',
      description: 'Texto de la vacante',
    });
    await expect(facade.matchJobSummaryOf('no-es-un-id')).resolves.toBeNull();
  });
});

// Señales de plan de «Tu semana» (D7 de weekly-plan): frescura y conteo de «conozco a alguien», nunca identidades.
describe('LinksFacade.planSignalsOf', () => {
  const G1 = objectId(31);
  const G2 = objectId(32);
  const G3 = objectId(33);
  const CARLA = objectId(3);
  const DAN = objectId(4);
  const BOB = BETO;

  let plan: InMemoryJobLinkRepository;
  let planGroupLinks: InMemoryGroupLinkRepository;
  let planMembership: InMemoryGroupMembership;
  let planFacade: LinksFacade;
  let shared: JobLink;

  beforeEach(async () => {
    plan = new InMemoryJobLinkRepository();
    planGroupLinks = new InMemoryGroupLinkRepository(plan);
    planMembership = new InMemoryGroupMembership()
      .withMember(G1, ANA)
      .withMember(G2, ANA);
    planFacade = new LinksFacade(
      plan,
      planGroupLinks,
      new InMemoryUserLinkRepository(plan),
      planMembership,
    );
    shared = plan.seed(
      jobLinkDraft('https://www.linkedin.com/jobs/view/3844444444/'),
    );
    for (const groupId of [G1, G2, G3]) {
      await planGroupLinks.seed({
        groupId,
        linkId: shared.id,
        sharedBy: ANA,
        sharedAt: now,
      });
    }
  });

  async function flag(groupId: string, userId: string): Promise<number> {
    const result = await planGroupLinks.setKnowSomeone(
      groupId,
      shared.id,
      userId,
      true,
    );
    return result?.count ?? 0;
  }

  it('planSignalsOf reports the count of the group with most flags by others', async () => {
    await flag(G1, BOB);
    await flag(G2, CARLA);
    await flag(G2, DAN);
    await flag(G2, ANA);

    const signals = await planFacade.planSignalsOf(ANA, [shared.id]);

    expect(signals.get(shared.id)).toMatchObject({
      knowSomeoneCount: 2,
      knowSomeoneGroupId: G2,
    });
  });

  it('planSignalsOf count matches the group listing minus own flag', async () => {
    await flag(G2, CARLA);
    await flag(G2, DAN);
    const listingCount = await flag(G2, ANA);

    const signals = await planFacade.planSignalsOf(ANA, [shared.id]);

    expect(signals.get(shared.id)?.knowSomeoneCount).toBe(listingCount - 1);
  });

  it('planSignalsOf with only the own flag reports zero and no group', async () => {
    await flag(G1, ANA);

    const signal = (await planFacade.planSignalsOf(ANA, [shared.id])).get(
      shared.id,
    );

    expect(signal?.knowSomeoneCount).toBe(0);
    expect(signal).not.toHaveProperty('knowSomeoneGroupId');
  });

  it('planSignalsOf ignores groups the user is not in', async () => {
    await flag(G3, BOB);
    await flag(G3, CARLA);

    const signal = (await planFacade.planSignalsOf(ANA, [shared.id])).get(
      shared.id,
    );

    expect(signal?.knowSomeoneCount).toBe(0);
  });

  it('planSignalsOf breaks a tie by groupId ascending', async () => {
    await flag(G2, CARLA);
    await flag(G1, BOB);

    const signal = (await planFacade.planSignalsOf(ANA, [shared.id])).get(
      shared.id,
    );

    expect(signal).toMatchObject({ knowSomeoneCount: 1, knowSomeoneGroupId: G1 });
  });

  it('planSignalsOf reports freshness and skips malformed ids', async () => {
    plan.overwrite(shared.id, {
      previewStatus: 'enriched',
      preview: { title: 'Backend', company: 'Acme', expiresAt: '2026-12-01' },
      closedAt: new Date('2026-11-20T00:00:00.000Z'),
    });

    const signals = await planFacade.planSignalsOf(ANA, [
      shared.id,
      'no-es-un-id',
      objectId(999),
    ]);

    expect([...signals.keys()]).toEqual([shared.id]);
    expect(signals.get(shared.id)).toEqual({
      id: shared.id,
      displayUrl: shared.displayUrl,
      title: 'Backend',
      company: 'Acme',
      closed: true,
      expiresAt: '2026-12-01',
      knowSomeoneCount: 0,
    });
  });

  it('planSignalsOf never returns flagger ids', async () => {
    await flag(G2, BOB);
    await flag(G2, CARLA);
    await flag(G2, DAN);

    const signals = await planFacade.planSignalsOf(ANA, [shared.id]);
    const json = JSON.stringify([...signals.values()]);

    for (const other of [BOB, CARLA, DAN]) {
      expect(json).not.toContain(other);
    }
    expect(signals.get(shared.id)?.knowSomeoneCount).toBe(3);
  });

  it('planSignalsOf makes the same number of queries for 3 and 150 links', async () => {
    const make = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        plan.seed(
          jobLinkDraft(
            `https://www.linkedin.com/jobs/view/${4000000000 + index}/`,
          ),
        ).id,
      );
    const three = make(3);
    const many = make(150);
    const counters = () => [
      planMembership.groupsOfCalls,
      plan.planCardsOfCalls,
      planGroupLinks.knowSomeoneOfCalls,
    ];

    const before = counters();
    await planFacade.planSignalsOf(ANA, three);
    const afterThree = counters();
    await planFacade.planSignalsOf(ANA, many);
    const afterMany = counters();

    const delta = (a: number[], b: number[]) => a.map((n, i) => n - (b[i] ?? 0));
    expect(delta(afterThree, before)).toEqual([1, 1, 1]);
    expect(delta(afterMany, afterThree)).toEqual([1, 1, 1]);
  });

  it('planSignalsOf processes only the first 200 ids', async () => {
    const ids = Array.from({ length: 201 }, (_, index) =>
      plan.seed(
        jobLinkDraft(
          `https://www.linkedin.com/jobs/view/${5000000000 + index}/`,
        ),
      ).id,
    );

    const signals = await planFacade.planSignalsOf(ANA, ids);

    expect(signals.size).toBe(200);
    expect(signals.has(ids[200] ?? '')).toBe(false);
  });
});
