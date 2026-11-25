import {
  isoWeekKey,
  type GroupBriefFact,
  type GroupWeeklyBrief,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupNotFound } from '../../groups/domain/errors';
import { GetGroupWeeklyBrief } from './get-group-weekly-brief.usecase';
import { InMemoryGroupLinkRepository } from './testing/in-memory-group-link.repository';
import { InMemoryGroupWeeklyBriefReader } from './testing/in-memory-group-weekly-brief.reader';
import { InMemoryJobLinkRepository } from './testing/in-memory-job-link.repository';
import { jobLinkDraft, objectId } from './testing/link-fixtures';
import {
  IN_MEMORY_SESSION,
  InMemoryGroupMembership,
  MovableClock,
} from './testing/links-test-doubles';

const ANA = objectId(1);
const STRANGER = objectId(4);
const GROUP = objectId(10);
// Miércoles 25/11/2026, semana 2026-W48.
const NOW = new Date('2026-11-25T12:00:00.000Z');
const WEEK = isoWeekKey(NOW);

let membership: InMemoryGroupMembership;
let reader: InMemoryGroupWeeklyBriefReader;
let groupLinks: InMemoryGroupLinkRepository;
let jobLinks: InMemoryJobLinkRepository;
let useCase: GetGroupWeeklyBrief;
let counter = 0;

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  membership = new InMemoryGroupMembership().withMember(GROUP, ANA, 'owner');
  reader = new InMemoryGroupWeeklyBriefReader();
  jobLinks = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(jobLinks);
  useCase = new GetGroupWeeklyBrief(
    membership,
    new MovableClock(NOW),
    reader,
    groupLinks,
    jobLinks,
  );
});

/** Una oferta guardada y compartida en el grupo; devuelve su id. */
async function offer(
  options: { expiresAt?: string; inGroup?: boolean } = {},
): Promise<string> {
  counter += 1;
  const link = jobLinks.seed(
    jobLinkDraft(`https://empresa.example/careers/${counter}`),
  );
  jobLinks.overwrite(link.id, {
    preview: {
      title: `Backend ${counter}`,
      company: 'Acme',
      ...(options.expiresAt === undefined
        ? {}
        : { expiresAt: options.expiresAt }),
    },
  });
  if (options.inGroup !== false) {
    await groupLinks.share(
      { groupId: GROUP, linkId: link.id, sharedBy: ANA, sharedAt: NOW },
      IN_MEMORY_SESSION,
    );
  }
  return link.id;
}

function briefOf(
  open: string[],
  facts: GroupBriefFact[],
  bullets: string[],
): GroupWeeklyBrief {
  return {
    version: 1,
    groupId: GROUP,
    weekKey: WEEK,
    asOf: '2026-11-25',
    computedAt: '2026-11-25T05:00:00.000Z',
    scanTruncated: false,
    facts: [
      {
        kind: 'open_offers',
        factId: 'open_offers',
        count: open.length,
        linkIds: open,
      },
      ...facts,
    ],
    bullets: bullets.map((factId) => ({ factId, source: 'template' as const })),
  };
}

function closing(ids: string[]): GroupBriefFact {
  return {
    kind: 'closing_soon',
    factId: 'closing_soon',
    count: ids.length,
    linkIds: ids,
    from: '2026-11-25',
    until: '2026-12-02',
    firstExpiresAt: '2026-11-27',
  };
}

function skill(
  ids: string[],
  key = 'docker',
  total = ids.length,
): GroupBriefFact {
  return {
    kind: 'skill_demand',
    factId: `skill_demand:${key}`,
    skillKey: key,
    skillLabel: key,
    count: ids.length,
    total,
    linkIds: ids,
  };
}

describe('GetGroupWeeklyBrief', () => {
  it('member gets the brief with offers', async () => {
    const a = await offer({ expiresAt: '2026-11-27' });
    const b = await offer();
    reader.put(
      GROUP,
      WEEK,
      briefOf(
        [a, b],
        [closing([a]), skill([a, b])],
        ['closing_soon', 'skill_demand:docker'],
      ),
    );

    const response = await useCase.execute(ANA, GROUP);

    expect(response.weekKey).toBe(WEEK);
    expect(response.brief?.openOffers).toBe(2);
    expect(response.brief?.bullets.map((b) => b.factId)).toEqual([
      'closing_soon',
      'skill_demand:docker',
    ]);
    expect(response.brief?.bullets[1]).toMatchObject({
      fact: { kind: 'skill_demand', skillLabel: 'docker', count: 2, total: 2 },
      moreCount: 0,
      missingCount: 0,
    });
    expect(response.brief?.bullets[1]?.offers.map((o) => o.linkId)).toEqual([
      a,
      b,
    ]);
    expect(JSON.stringify(response)).not.toContain('linkIds');
  });

  it('no brief this week returns null even if last week exists', async () => {
    const a = await offer();
    reader.put(
      GROUP,
      '2026-W47',
      briefOf([a], [skill([a, a])], ['skill_demand:docker']),
    );
    expect(await useCase.execute(ANA, GROUP)).toEqual({
      weekKey: WEEK,
      brief: null,
    });
  });

  it('stranger gets group_not_found', async () => {
    await expect(useCase.execute(STRANGER, GROUP)).rejects.toBeInstanceOf(
      GroupNotFound,
    );
  });

  it('closing offers carry expiresAt and others do not', async () => {
    const a = await offer({ expiresAt: '2026-11-27' });
    const b = await offer({ expiresAt: '2026-12-20' });
    reader.put(
      GROUP,
      WEEK,
      briefOf(
        [a, b],
        [closing([a]), skill([a, b])],
        ['closing_soon', 'skill_demand:docker'],
      ),
    );

    const response = await useCase.execute(ANA, GROUP);

    expect(response.brief?.bullets[0]?.offers[0]?.expiresAt).toBe('2026-11-27');
    for (const o of response.brief?.bullets[1]?.offers ?? []) {
      expect(o).not.toHaveProperty('expiresAt');
    }
  });

  it('offer removed from the group counts as missing', async () => {
    const a = await offer();
    const b = await offer();
    const gone = await offer({ inGroup: false });
    reader.put(
      GROUP,
      WEEK,
      briefOf(
        [a, b, gone],
        [skill([a, b, gone], 'docker', 3)],
        ['skill_demand:docker'],
      ),
    );

    const bullet = (await useCase.execute(ANA, GROUP)).brief?.bullets[0];

    expect(bullet?.offers.map((o) => o.linkId)).toEqual([a, b]);
    expect(bullet).toMatchObject({ moreCount: 0, missingCount: 1 });
    expect(bullet?.fact).toMatchObject({ count: 3 });
  });

  it('more than ten offers yields moreCount', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 13; i += 1) {
      ids.push(await offer());
    }
    reader.put(
      GROUP,
      WEEK,
      briefOf(ids, [skill(ids)], ['skill_demand:docker']),
    );

    const bullet = (await useCase.execute(ANA, GROUP)).brief?.bullets[0];

    expect(bullet?.offers).toHaveLength(10);
    expect(bullet).toMatchObject({ moreCount: 3, missingCount: 0 });
  });

  it('corrupt document returns null', async () => {
    reader.put(GROUP, WEEK, 'invalid');
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(await useCase.execute(ANA, GROUP)).toEqual({
      weekKey: WEEK,
      brief: null,
    });
  });

  it('a brief that fails the verifier returns null', async () => {
    const a = await offer();
    const b = await offer();
    const bad = skill([a, b]);
    reader.put(
      GROUP,
      WEEK,
      briefOf([a, b], [{ ...bad, count: 5 }], ['skill_demand:docker']),
    );
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    expect(await useCase.execute(ANA, GROUP)).toEqual({
      weekKey: WEEK,
      brief: null,
    });
    expect(String(warn.mock.calls[0]?.[0])).toContain('count_mismatch');
  });
});

describe('GetGroupWeeklyBrief reads', () => {
  it('same number of reads for 1 bullet and 4 bullets of 40 offers', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      ids.push(await offer({ expiresAt: '2026-11-28' }));
    }
    const countReads = (): number =>
      membership.membershipOfCalls +
      reader.reads +
      groupLinks.linkIdsInCalls +
      jobLinks.planCardsOfCalls;

    reader.put(
      GROUP,
      WEEK,
      briefOf(ids, [skill(ids)], ['skill_demand:docker']),
    );
    const before = countReads();
    await useCase.execute(ANA, GROUP);
    const oneBullet = countReads() - before;

    reader.put(
      GROUP,
      WEEK,
      briefOf(
        ids,
        [
          closing(ids),
          skill(ids, 'docker'),
          skill(ids, 'go'),
          {
            kind: 'shared_last_week',
            factId: 'shared_last_week',
            count: ids.length,
            linkIds: ids,
            weekKey: '2026-W47',
          },
        ],
        [
          'closing_soon',
          'skill_demand:docker',
          'shared_last_week',
          'skill_demand:go',
        ],
      ),
    );
    const mid = countReads();
    await useCase.execute(ANA, GROUP);
    const fourBullets = countReads() - mid;

    expect(oneBullet).toBe(4);
    expect(fourBullets).toBe(oneBullet);
  });

  it('writes nothing', async () => {
    const a = await offer();
    const b = await offer();
    reader.put(
      GROUP,
      WEEK,
      briefOf([a, b], [skill([a, b])], ['skill_demand:docker']),
    );
    const relations = groupLinks.size;
    const links = await jobLinks.cardsOf([a, b]);

    await useCase.execute(ANA, GROUP);

    expect(groupLinks.size).toBe(relations);
    expect(await jobLinks.cardsOf([a, b])).toEqual(links);
  });
});
