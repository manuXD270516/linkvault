import { getConnectionToken } from '@nestjs/mongoose';
import { getMongoTestUri } from '@linkvault/testing';
import type { Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GetWeeklyPlan } from '../modules/applications/application/get-weekly-plan.usecase';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepository,
} from '../modules/applications/application/ports/application-repository.port';
import {
  APPLICATIONS_CLOCK,
  type Clock,
} from '../modules/applications/application/ports/clock.port';
import { TrackLink } from '../modules/applications/application/track-link.usecase';
import { APPLICATIONS_COLLECTION } from '../modules/applications/infrastructure/application.schemas';
import {
  CV_FILE_STORE,
  type CvFileStore,
} from '../modules/cv/application/ports/cv-file-store.port';
import {
  CV_REPOSITORY,
  type CvRepository,
} from '../modules/cv/application/ports/cv-repository.port';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from '../modules/groups/application/ports/group-repository.port';
import {
  GROUP_LINK_COMMENT_REPOSITORY,
  type GroupLinkCommentRepository,
} from '../modules/links/application/ports/group-link-comment-repository.port';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from '../modules/links/application/ports/group-link-repository.port';
import { SaveLink } from '../modules/links/application/save-link.usecase';
import { SetKnowSomeone } from '../modules/links/application/set-know-someone.usecase';
import { UpdateLinkPreview } from '../modules/links/application/update-link-preview.usecase';
import { JOB_LINKS_COLLECTION } from '../modules/links/infrastructure/link.schemas';
import type { BackfillSearch } from '../modules/search/application/backfill-search.usecase';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../modules/users/application/ports/user-repository.port';
import {
  createLinksTestApp,
  type LinksTestApp,
} from '../test-support/links-test-app';
import { DEMO_LINKS } from './demo-seed.dataset';
import { runSeedDemo, type SeedDemoDeps } from './seed-demo.runner';

// El seed demo contra la app real y un MongoMemoryReplSet (tarea 6.2 de weekly-plan): Ana obtiene una acción de cada
// regla, también 12 días después de la primera corrida.

const DAY = 24 * 60 * 60 * 1000;
const FIRST_RUN = new Date('2026-11-25T10:00:00.000Z');

describe('demo seed and the weekly plan', () => {
  let http: LinksTestApp;
  let current = FIRST_RUN;

  beforeAll(async () => {
    http = await createLinksTestApp('seed-weekly-plan', getMongoTestUri());
    const clock = http.app.get<Clock>(APPLICATIONS_CLOCK, { strict: false });
    vi.spyOn(clock, 'now').mockImplementation(() => new Date(current));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await http.close();
  });

  function depsAt(now: Date): SeedDemoDeps {
    const get = <T>(token: object | string | symbol): T =>
      http.app.get(token as never, { strict: false }) as T;
    return {
      users: get<UserRepository>(USER_REPOSITORY),
      passwordHasher: {
        hash: (password) => Promise.resolve(`hash:${password}`),
        verify: () => Promise.resolve(true),
        verifyDummy: () => Promise.resolve(),
      },
      groups: get<GroupRepository>(GROUP_REPOSITORY),
      saveLink: get<SaveLink>(SaveLink),
      updatePreview: get<UpdateLinkPreview>(UpdateLinkPreview),
      trackLink: get<TrackLink>(TrackLink),
      applications: get<ApplicationRepository>(APPLICATION_REPOSITORY),
      groupLinks: get<GroupLinkRepository>(GROUP_LINK_REPOSITORY),
      comments: get<GroupLinkCommentRepository>(
        GROUP_LINK_COMMENT_REPOSITORY,
      ),
      setKnowSomeone: get<SetKnowSomeone>(SetKnowSomeone),
      cvRepository: get<CvRepository>(CV_REPOSITORY),
      cvFiles: {
        ...get<CvFileStore>(CV_FILE_STORE),
        put: () => Promise.reject(new Error('object store unavailable')),
      } as CvFileStore,
      connection: get<Connection>(getConnectionToken()),
      backfillSearch: {
        execute: () => Promise.resolve({ found: 0, enqueued: 0 }),
      } as unknown as BackfillSearch,
      now,
      log: () => undefined,
    };
  }

  async function planOf(anaId: string) {
    return await http.app
      .get(GetWeeklyPlan, { strict: false })
      .execute(anaId);
  }

  it('demo Ana gets one action of each rule', async () => {
    current = FIRST_RUN;

    const report = await runSeedDemo(depsAt(FIRST_RUN));
    const plan = await planOf(report.anaId);

    expect(plan.actions.map((action) => action.rule)).toEqual([
      'apply_before_close',
      'follow_up',
      'ask_know_someone',
    ]);
    expect(plan.actions.map((action) => action.linkId)).toEqual([
      report.linkIds['closingSoon'],
      report.linkIds['staleApp'],
      report.linkIds['openSalary'],
    ]);
    expect(plan.actions[0]?.reason).toMatchObject({
      kind: 'closing_soon',
      expiresAt: '2026-11-28',
      daysLeft: 3,
    });
    expect(plan.actions[2]?.reason).toMatchObject({
      kind: 'know_someone',
      count: 1,
    });
  });

  it('a second run 12 days later still yields one action of each rule', async () => {
    const later = new Date(FIRST_RUN.getTime() + 12 * DAY);
    current = later;

    const report = await runSeedDemo(depsAt(later));
    const plan = await planOf(report.anaId);

    expect(plan.actions.map((action) => action.rule)).toEqual([
      'apply_before_close',
      'follow_up',
      'ask_know_someone',
    ]);
    expect(plan.actions[0]?.reason).toMatchObject({
      kind: 'closing_soon',
      expiresAt: '2026-12-10',
      daysLeft: 3,
    });
    expect(plan.actions[2]?.linkId).toBe(report.linkIds['openSalary']);

    const links = http.connection.collection(JOB_LINKS_COLLECTION);
    const applications = http.connection.collection(APPLICATIONS_COLLECTION);
    expect(await links.countDocuments({ normalizedUrl: /demo\.linkvault\.local/ })).toBe(
      Object.keys(DEMO_LINKS).length,
    );
    expect(await applications.countDocuments({})).toBe(
      Object.keys(DEMO_LINKS).length,
    );
  });
});
