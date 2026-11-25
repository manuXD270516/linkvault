import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mongoose';
import type { PasswordHasher } from '../modules/auth/application/ports/password-hasher.port';
import type { ApplicationRepository } from '../modules/applications/application/ports/application-repository.port';
import type { TrackLink } from '../modules/applications/application/track-link.usecase';
import type { CvFileStore } from '../modules/cv/application/ports/cv-file-store.port';
import type { CvRepository } from '../modules/cv/application/ports/cv-repository.port';
import type { GroupRepository } from '../modules/groups/application/ports/group-repository.port';
import type { Group } from '../modules/groups/domain/group';
import type { SaveLink } from '../modules/links/application/save-link.usecase';
import type { SetKnowSomeone } from '../modules/links/application/set-know-someone.usecase';
import type { UpdateLinkPreview } from '../modules/links/application/update-link-preview.usecase';
import type { GroupLinkRepository } from '../modules/links/application/ports/group-link-repository.port';
import type { GroupLinkCommentRepository } from '../modules/links/application/ports/group-link-comment-repository.port';
import type { BackfillSearch } from '../modules/search/application/backfill-search.usecase';
import type { NewUser, User } from '../modules/users/domain/user';
import type { UserRepository } from '../modules/users/application/ports/user-repository.port';
import {
  DEMO_ANA,
  DEMO_GROUP_INVITE_CODE,
  DEMO_GROUP_NAME,
  DEMO_LINKS,
} from './demo-seed.dataset';
import { runSeedDemo, type SeedDemoDeps } from './seed-demo.runner';

const NOW = new Date('2026-09-23T12:00:00.000Z');
const GROUP_ID = '0000000000000000000000aa';

function demoGroup(): Group {
  return {
    id: GROUP_ID,
    name: DEMO_GROUP_NAME,
    inviteCode: DEMO_GROUP_INVITE_CODE,
    defaultVisibility: 'public',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function linkIdFor(url: string): string {
  const index = Object.values(DEMO_LINKS).findIndex((l) => l.url === url);
  return `000000000000000000000${(index + 1).toString(16).padStart(3, '0')}`;
}

describe('runSeedDemo', () => {
  it('calls BackfillSearch (never Meili) after Mongo work', async () => {
    const backfillExecute = vi.fn().mockResolvedValue({
      found: 4,
      enqueued: 4,
    });
    const deps = buildDeps({
      backfillSearch: { execute: backfillExecute } as unknown as BackfillSearch,
    });

    const report = await runSeedDemo(deps);

    expect(backfillExecute).toHaveBeenCalledTimes(1);
    expect(backfillExecute).toHaveBeenCalledWith({
      limit: 500,
      dryRun: false,
      reembed: false,
    });
    expect(report.search).toEqual({ found: 4, enqueued: 4 });
    expect(report.groupId).toBe(GROUP_ID);
  });

  it('is idempotent on a second run (no duplicate users / apps / comment)', async () => {
    const deps = buildDeps();
    const first = await runSeedDemo(deps);
    const second = await runSeedDemo(deps);

    expect(second.anaId).toBe(first.anaId);
    expect(second.bobId).toBe(first.bobId);
    expect(second.groupId).toBe(first.groupId);
    expect(second.linkIds).toEqual(first.linkIds);

    const ana = await deps.users.findByEmail(DEMO_ANA.email);
    expect(ana?.id).toBe(first.anaId);
    expect(deps.saveLink.execute).toHaveBeenCalledTimes(
      Object.keys(DEMO_LINKS).length * 2,
    );
    expect(deps.trackLink.execute).toHaveBeenCalledTimes(
      Object.keys(DEMO_LINKS).length * 2,
    );
    // Un solo comentario seed: segunda corrida no vuelve a addComment.
    expect(deps.groupLinks.addComment).toHaveBeenCalledTimes(1);
  });

  it('seeds first-run dataset: recheck, closed app, stale â‰¥11d, credentials in log', async () => {
    const lines: string[] = [];
    const deps = buildDeps({
      log: (line) => {
        lines.push(line);
      },
    });

    await runSeedDemo(deps);

    // Shared updateOne mock across collections (buildDeps).
    const { updateOne } = deps.connection.collection('probe') as unknown as {
      updateOne: ReturnType<typeof vi.fn>;
    };
    const updateSets = updateOne.mock.calls.map(
      (call) => (call[1] as { $set?: Record<string, unknown> } | undefined)?.$set,
    );

    expect(
      updateSets.some((set) => set?.['closedReason'] === 'recheck'),
    ).toBe(true);

    const closedAppStatuses = new Set(['rejected', 'withdrawn', 'expired']);
    expect(
      vi
        .mocked(deps.trackLink.execute)
        .mock.calls.some(([, req]) => closedAppStatuses.has(req.status)),
    ).toBe(true);

    const elevenDaysMs = 11 * 24 * 60 * 60 * 1000;
    const staleAt = updateSets
      .map((set) => set?.['statusChangedAt'])
      .find((value): value is Date => value instanceof Date);
    expect(staleAt).toBeDefined();
    expect(NOW.getTime() - (staleAt as Date).getTime()).toBeGreaterThanOrEqual(
      elevenDaysMs,
    );

    const logText = lines.join('\n');
    expect(logText).toContain(DEMO_ANA.email);
    expect(logText).toContain(DEMO_ANA.password);
  });
});

describe('runSeedDemo weekly plan dataset', () => {
  const DAY = 24 * 60 * 60 * 1000;

  function expiresAtWrites(deps: SeedDemoDeps, linkId: string): unknown[] {
    return vi
      .mocked(deps.updatePreview.execute)
      .mock.calls.filter(([, id]) => id === linkId)
      .map(([, , request]) => request.fields?.['expiresAt']);
  }

  it('seeds a saved link closing in three days', async () => {
    const deps = buildDeps();

    const report = await runSeedDemo(deps);

    const closingLinkId = report.linkIds['closingSoon'] ?? '';
    expect(closingLinkId).not.toBe('');
    expect(expiresAtWrites(deps, closingLinkId)).toEqual(['2026-09-26']);
    expect(
      vi
        .mocked(deps.trackLink.execute)
        .mock.calls.some(
          ([, req]) => req.linkId === closingLinkId && req.status === 'saved',
        ),
    ).toBe(true);
    // Los demás links no llevan fecha de cierre.
    expect(expiresAtWrites(deps, report.linkIds['openSalary'] ?? '')).toEqual([
      undefined,
    ]);
  });

  it('resets openSalary statusChangedAt on every run', async () => {
    const deps = buildDeps();

    await runSeedDemo(deps);
    await runSeedDemo(deps);

    const { updateOne } = deps.connection.collection('probe') as unknown as {
      updateOne: ReturnType<typeof vi.fn>;
    };
    const resets = updateOne.mock.calls.filter(
      (call) =>
        (call[1] as { $set?: { statusChangedAt?: Date } }).$set?.[
          'statusChangedAt'
        ]?.getTime() === NOW.getTime(),
    );
    expect(resets).toHaveLength(2);
  });

  it('second run moves expiresAt without duplicating links or applications', async () => {
    const deps = buildDeps();
    const first = await runSeedDemo(deps);
    const later = new Date(NOW.getTime() + 12 * DAY);

    const second = await runSeedDemo({ ...deps, now: later });

    const closingLinkId = first.linkIds['closingSoon'] ?? '';
    expect(second.linkIds).toEqual(first.linkIds);
    expect(expiresAtWrites(deps, closingLinkId)).toEqual([
      '2026-09-26',
      '2026-10-08',
    ]);
    // Mismo id de postulación en las dos corridas: el alta es un upsert por (userId, linkId).
    const trackCalls = vi
      .mocked(deps.trackLink.execute)
      .mock.results.length;
    expect(trackCalls).toBe(Object.keys(DEMO_LINKS).length * 2);
    const createdFlags = await Promise.all(
      vi.mocked(deps.trackLink.execute).mock.results.map((r) => r.value),
    );
    expect(
      createdFlags.filter((tracked) => tracked.created === true),
    ).toHaveLength(Object.keys(DEMO_LINKS).length);
  });
});

describe('runSeedDemo group brief dataset', () => {
  function skillWrites(
    deps: SeedDemoDeps,
    linkId: string,
  ): readonly (readonly string[])[] {
    return vi
      .mocked(deps.updatePreview.execute)
      .mock.calls.filter(([, id]) => id === linkId)
      .map(([, , request]) =>
        ((request.fields?.['skills'] ?? []) as readonly { name: string }[]).map(
          (skill) => skill.name,
        ),
      );
  }

  it('demo links carry the brief skills', async () => {
    const deps = buildDeps();

    const report = await runSeedDemo(deps);

    expect(skillWrites(deps, report.linkIds['openSalary'] ?? '')).toEqual([
      ['Docker', 'TypeScript', 'NestJS'],
    ]);
    expect(skillWrites(deps, report.linkIds['staleApp'] ?? '')).toEqual([
      ['Docker', 'Kotlin'],
    ]);
    expect(skillWrites(deps, report.linkIds['closingSoon'] ?? '')).toEqual([
      ['Docker', 'TypeScript', 'SQL'],
    ]);
    // Los demás links no llevan habilidades.
    expect(skillWrites(deps, report.linkIds['rejectedApp'] ?? '')).toEqual([
      [],
    ]);
  });

  it('second run does not duplicate skills', async () => {
    const deps = buildDeps();

    const first = await runSeedDemo(deps);
    await runSeedDemo({
      ...deps,
      now: new Date(NOW.getTime() + 24 * 3_600_000),
    });

    // Cada corrida fija el conjunto entero: la segunda escribe el mismo, no agrega a lo anterior.
    expect(skillWrites(deps, first.linkIds['openSalary'] ?? '')).toEqual([
      ['Docker', 'TypeScript', 'NestJS'],
      ['Docker', 'TypeScript', 'NestJS'],
    ]);
  });
});

describe('seed-demo entrypoint source', () => {
  it('does not import the Meili client from the seed process', () => {
    const source = readFileSync(
      join(__dirname, '../seed-demo.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/meili-search\.client/i);
    expect(source).not.toMatch(/MeiliSearch/);
    expect(source).toMatch(/BackfillSearch/);
    expect(source).toMatch(/assertDemoSeedAllowed/);
  });
});

function buildDeps(overrides: Partial<SeedDemoDeps> = {}): SeedDemoDeps {
  const users = new MemoryUsers();
  const passwordHasher: PasswordHasher = {
    hash: async (password) => `hash:${password}`,
    verify: async () => true,
    verifyDummy: async () => undefined,
  };

  const group = demoGroup();
  let groupPersisted = false;

  const groups = {
    findByInviteCode: vi.fn(async (code: string) =>
      groupPersisted && code === DEMO_GROUP_INVITE_CODE ? group : null,
    ),
    listGroupsOfUser: vi.fn(async () => []),
    rename: vi.fn(async () => group),
    addMember: vi.fn(async (input: { userId: string }) => ({
      groupId: GROUP_ID,
      userId: input.userId,
      role: 'member' as const,
      joinedAt: NOW,
    })),
  } as unknown as GroupRepository;

  const collectionUpdate = vi.fn(async () => ({ matchedCount: 1 }));
  const collectionInsert = vi.fn(async () => {
    groupPersisted = true;
    return { insertedId: GROUP_ID };
  });
  const connection = {
    collection: vi.fn(() => ({
      insertOne: collectionInsert,
      updateOne: collectionUpdate,
    })),
    startSession: vi.fn(async () => ({
      withTransaction: async (fn: () => Promise<void>) => {
        await fn();
      },
      endSession: async () => undefined,
    })),
  } as unknown as Connection;

  const commentsByLink = new Map<string, { text: string }[]>();
  const appIds = new Map<string, string>();

  const deps: SeedDemoDeps = {
    users,
    passwordHasher,
    groups,
    saveLink: {
      execute: vi.fn(async (_userId: string, request: { url: string }) => ({
        link: { id: linkIdFor(request.url) },
        created: true,
        shared: 'shared' as const,
      })),
    } as unknown as SaveLink,
    updatePreview: {
      execute: vi.fn(async () => ({})),
    } as unknown as UpdateLinkPreview,
    trackLink: {
      execute: vi.fn(
        async (
          userId: string,
          request: { linkId: string; status: string; stageLabel?: string },
        ) => {
          const key = `${userId}:${request.linkId}`;
          const existing = appIds.get(key);
          // 24-char hex so Types.ObjectId.isValid passes (stale statusChangedAt patch).
          const id =
            existing ??
            `00000000000000000000a${appIds.size.toString(16).padStart(3, '0')}`;
          if (existing === undefined) {
            appIds.set(key, id);
          }
          return {
            application: {
              id,
              userId,
              linkId: request.linkId,
              status: request.status,
              stageLabel: request.stageLabel,
              version: 1,
            },
            created: existing === undefined,
          };
        },
      ),
    } as unknown as TrackLink,
    applications: {
      findOwned: vi.fn(async () => null),
      changeStatus: vi.fn(async () => true),
    } as unknown as ApplicationRepository,
    groupLinks: {
      addComment: vi.fn(async (draft: { linkId: string; text: string }) => {
        const list = commentsByLink.get(draft.linkId) ?? [];
        list.push({ text: draft.text });
        commentsByLink.set(draft.linkId, list);
        return {
          comment: { id: 'c1', ...draft },
          counters: {
            count: list.length,
            revision: list.length,
            sharedAt: NOW,
          },
        };
      }),
    } as unknown as GroupLinkRepository,
    comments: {
      page: vi.fn(async (_g: string, linkId: string) => ({
        items: (commentsByLink.get(linkId) ?? []).map((c, i) => ({
          id: `00000000000000000000c${i.toString(16).padStart(2, '0')}`,
          groupId: GROUP_ID,
          linkId,
          authorId: '0000000000000000000000a1',
          text: c.text,
          createdAt: NOW,
        })),
      })),
    } as unknown as GroupLinkCommentRepository,
    setKnowSomeone: {
      execute: vi.fn(async () => ({ flaggedByMe: true, count: 1 })),
    } as unknown as SetKnowSomeone,
    cvRepository: {
      listByUser: vi.fn(async () => []),
      nextId: vi.fn(() => '0000000000000000000000c1'),
      insertAsDefault: vi.fn(async (doc) => doc),
    } as unknown as CvRepository,
    cvFiles: {
      put: vi.fn(async () => {
        throw new Error('object store unavailable in unit test');
      }),
    } as unknown as CvFileStore,
    connection,
    backfillSearch: {
      execute: vi.fn(async () => ({ found: 0, enqueued: 0 })),
    } as unknown as BackfillSearch,
    now: NOW,
    log: () => undefined,
    ...overrides,
  };

  return deps;
}

/** Users en memoria con ids ObjectId-hex (como Mongo). */
class MemoryUsers implements UserRepository {
  private readonly byEmail = new Map<string, User>();
  private seq = 1;

  create(user: NewUser): Promise<User> {
    if (this.byEmail.has(user.email)) {
      return Promise.reject(new Error('email taken'));
    }
    const id = `0000000000000000000000${this.seq.toString(16).padStart(2, '0')}`;
    this.seq += 1;
    const stored: User = { ...structuredClone(user), id };
    this.byEmail.set(user.email, stored);
    return Promise.resolve(structuredClone(stored));
  }

  findByEmail(email: string): Promise<User | null> {
    const user = this.byEmail.get(email);
    return Promise.resolve(user ? structuredClone(user) : null);
  }

  findById(id: string): Promise<User | null> {
    for (const user of this.byEmail.values()) {
      if (user.id === id) {
        return Promise.resolve(structuredClone(user));
      }
    }
    return Promise.resolve(null);
  }

  findDisplayNames(): Promise<Map<string, string>> {
    return Promise.resolve(new Map());
  }

  updateProfile(): Promise<User | null> {
    return Promise.resolve(null);
  }

  setPasswordHash(
    id: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<boolean> {
    for (const [email, user] of this.byEmail) {
      if (user.id === id) {
        this.byEmail.set(email, { ...user, passwordHash, passwordChangedAt: changedAt });
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }

  markEmailVerified(): Promise<boolean> {
    return Promise.resolve(true);
  }

  delete(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
