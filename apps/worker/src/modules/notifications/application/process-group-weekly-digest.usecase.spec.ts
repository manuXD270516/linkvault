import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  GROUP_WEEKLY_DIGEST_TYPE,
  type NotificationPreferences,
} from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProcessGroupWeeklyDigest } from './process-group-weekly-digest.usecase';
import type {
  DigestGroupPage,
  DigestWindowLink,
  GroupDigestCatalog,
  NotifyDeliveryKey,
  NotifyDeliveryLedger,
  NotifyGroupDirectory,
  NotifyMailer,
  NotifyMailMessage,
  NotifyPreferencesReader,
  NotifyUserDirectory,
  NotifyUserProfile,
} from './ports/notify.ports';

const ANA = '66e9a00000000000000000a1';
const LUIS = '66e9a00000000000000000b2';
const CARLA = '66e9a00000000000000000c3';
const GROUP = '66e9a00000000000000000g1';
const WEEK = '2026-W38';
const WIN_START = new Date('2026-09-14T00:00:00.000Z');
const WIN_END = new Date('2026-09-21T00:00:00.000Z');
const NOW = new Date('2026-09-21T14:00:00.000Z');

class MemCatalog implements GroupDigestCatalog {
  groups: string[] = [GROUP];
  links = new Map<string, DigestWindowLink[]>();

  listGroupIds(params: {
    afterId: string | null;
    limit: number;
  }): Promise<DigestGroupPage> {
    const all = this.groups;
    const start =
      params.afterId === null
        ? 0
        : all.findIndex((id) => id === params.afterId) + 1;
    const slice = all.slice(start, start + params.limit);
    const last = slice[slice.length - 1];
    const nextCursor =
      last !== undefined && start + slice.length < all.length ? last : null;
    return Promise.resolve({ groupIds: slice, nextCursor });
  }

  listLinksInWindow(params: {
    groupId: string;
    windowStart: Date;
    windowEnd: Date;
    limit: number;
  }): Promise<readonly DigestWindowLink[]> {
    const rows = (this.links.get(params.groupId) ?? []).filter(
      (r) =>
        r.sharedAt >= params.windowStart && r.sharedAt < params.windowEnd,
    );
    return Promise.resolve(
      [...rows]
        .sort((a, b) => b.sharedAt.getTime() - a.sharedAt.getTime())
        .slice(0, params.limit),
    );
  }

  countLinksInWindow(params: {
    groupId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<number> {
    return this.listLinksInWindow({ ...params, limit: 10_000 }).then(
      (r) => r.length,
    );
  }
}

class MemPrefs implements NotifyPreferencesReader {
  map = new Map<string, NotificationPreferences>();
  findByUserId(userId: string): Promise<NotificationPreferences | null> {
    return Promise.resolve(this.map.get(userId) ?? null);
  }
}

class MemGroups implements NotifyGroupDirectory {
  members = new Map<string, string[]>([[GROUP, [ANA, LUIS, CARLA]]]);
  names = new Map<string, string>([[GROUP, 'Backend']]);
  memberIdsOf(groupId: string): Promise<string[]> {
    return Promise.resolve(this.members.get(groupId) ?? []);
  }
  groupIdsOfLink(): Promise<string[]> {
    return Promise.resolve([]);
  }
  groupNameOf(groupId: string): Promise<string | null> {
    return Promise.resolve(this.names.get(groupId) ?? null);
  }
}

class MemUsers implements NotifyUserDirectory {
  profiles: NotifyUserProfile[] = [
    {
      userId: ANA,
      email: 'ana@example.com',
      displayName: 'Ana',
      emailVerified: true,
      outputLanguage: 'es',
    },
    {
      userId: LUIS,
      email: 'luis@example.com',
      displayName: 'Luis',
      emailVerified: true,
      outputLanguage: 'es',
    },
    {
      userId: CARLA,
      email: 'carla@example.com',
      displayName: 'Carla',
      emailVerified: false,
      outputLanguage: 'es',
    },
  ];
  profilesOf(userIds: readonly string[]): Promise<NotifyUserProfile[]> {
    return Promise.resolve(
      this.profiles.filter((p) => userIds.includes(p.userId)),
    );
  }
}

class MemLedger implements NotifyDeliveryLedger {
  completed = new Set<string>();
  keys: NotifyDeliveryKey[] = [];
  private keyOf(k: NotifyDeliveryKey): string {
    return `${k.type}|${k.aggregateKey}|${k.userId}|${k.channel}`;
  }
  claim(
    key: NotifyDeliveryKey,
  ): Promise<'claimed' | 'already_done' | 'in_flight'> {
    this.keys.push(key);
    if (this.completed.has(this.keyOf(key))) {
      return Promise.resolve('already_done');
    }
    return Promise.resolve('claimed');
  }
  markCompleted(key: NotifyDeliveryKey): Promise<void> {
    this.completed.add(this.keyOf(key));
    return Promise.resolve();
  }
  markFailed(): Promise<void> {
    return Promise.resolve();
  }
}

class MemMailer implements NotifyMailer {
  sent: NotifyMailMessage[] = [];
  send(message: NotifyMailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

function build(
  enabled: boolean,
  catalog: MemCatalog,
  prefs: MemPrefs,
  ledger: MemLedger,
  mailer: MemMailer,
): ProcessGroupWeeklyDigest {
  return new ProcessGroupWeeklyDigest(
    enabled,
    catalog,
    new MemGroups(),
    prefs,
    new MemUsers(),
    ledger,
    mailer,
    'http://localhost:4200',
    { now: () => NOW },
  );
}

function link(
  id: string,
  sharedAt: Date,
  title: string,
): DigestWindowLink {
  return { linkId: id, sharedAt, title };
}

describe('ProcessGroupWeeklyDigest', () => {
  let catalog: MemCatalog;
  let prefs: MemPrefs;
  let ledger: MemLedger;
  let mailer: MemMailer;

  beforeEach(() => {
    catalog = new MemCatalog();
    prefs = new MemPrefs();
    ledger = new MemLedger();
    mailer = new MemMailer();
    catalog.links.set(GROUP, [
      link('l1', new Date('2026-09-15T12:00:00.000Z'), 'Oferta A'),
      link('l2', new Date('2026-09-16T12:00:00.000Z'), 'Oferta B'),
      link('l3', new Date('2026-09-17T12:00:00.000Z'), 'Oferta C'),
    ]);
  });

  it('flag off → no emails', async () => {
    const uc = build(false, catalog, prefs, ledger, mailer);
    const result = await uc.execute(WEEK);
    expect(result.emailsSent).toBe(0);
    expect(mailer.sent).toHaveLength(0);
    expect(ledger.keys).toHaveLength(0);
  });

  it('grupo con links → email a Ana (verificada, default ON)', async () => {
    const uc = build(true, catalog, prefs, ledger, mailer);
    const result = await uc.execute(WEEK);
    expect(result.emailsSent).toBe(2); // Ana + Luis; Carla no verificada
    const ana = mailer.sent.find((m) => m.to === 'ana@example.com');
    expect(ana?.templateId).toBe('group-weekly-digest');
    expect(ana?.variables.groupName).toBe('Backend');
    expect(ana?.variables.linkTitles).toEqual([
      'Oferta C',
      'Oferta B',
      'Oferta A',
    ]);
    expect(ana?.variables.preferencesUrl).toContain('/notificaciones');
    expect(ana?.variables.actionUrl).toContain(`/grupos/${GROUP}`);
    expect(ledger.completed.size).toBe(2);
    for (const key of ledger.keys) {
      expect(key.type).toBe(GROUP_WEEKLY_DIGEST_TYPE);
      expect(key.aggregateKey).toBe(`${WEEK}:${GROUP}`);
      expect(key.channel).toBe('email');
    }
  });

  it('vacío → sin email ni ledger', async () => {
    catalog.links.set(GROUP, []);
    const uc = build(true, catalog, prefs, ledger, mailer);
    await uc.execute(WEEK);
    expect(mailer.sent).toHaveLength(0);
    expect(ledger.keys).toHaveLength(0);
    expect(ledger.completed.size).toBe(0);
  });

  it('opt-out de Luis → no le envía', async () => {
    prefs.map.set(LUIS, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      groupWeeklyDigest: false,
    });
    const uc = build(true, catalog, prefs, ledger, mailer);
    await uc.execute(WEEK);
    expect(mailer.sent.map((m) => m.to)).toEqual(['ana@example.com']);
  });

  it('re-run no reenvía (ledger completed)', async () => {
    const uc = build(true, catalog, prefs, ledger, mailer);
    await uc.execute(WEEK);
    const first = mailer.sent.length;
    await uc.execute(WEEK);
    expect(mailer.sent).toHaveLength(first);
  });

  it('más de 10 títulos → tope y moreCount', async () => {
    const many: DigestWindowLink[] = [];
    for (let i = 0; i < 15; i += 1) {
      many.push(
        link(
          `lx${i}`,
          new Date(WIN_START.getTime() + (i + 1) * 3600_000),
          `T${i}`,
        ),
      );
    }
    catalog.links.set(GROUP, many);
    const uc = build(true, catalog, prefs, ledger, mailer);
    await uc.execute(WEEK);
    const ana = mailer.sent.find((m) => m.to === 'ana@example.com');
    expect(ana?.variables.linkTitles).toHaveLength(10);
    expect(ana?.variables.moreCount).toBe(5);
  });

  it('ventana excluye sharedAt fuera de W−1', async () => {
    catalog.links.set(GROUP, [
      link('out', new Date(WIN_END.getTime()), 'Fuera'),
      link('in', new Date(WIN_START.getTime()), 'Dentro'),
    ]);
    const uc = build(true, catalog, prefs, ledger, mailer);
    await uc.execute(WEEK);
    const ana = mailer.sent.find((m) => m.to === 'ana@example.com');
    expect(ana?.variables.linkTitles).toEqual(['Dentro']);
  });
});
