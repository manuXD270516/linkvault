import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { ProcessNotifyFanOut } from './process-notify-fanout.usecase';
import type {
  NotifyDeliveryKey,
  NotifyDeliveryLedger,
  NotifyGroupDirectory,
  NotifyLinkTitles,
  NotifyMailer,
  NotifyMailMessage,
  NotifyPreferencesReader,
  NotifyPushSubscription,
  NotifyPushSubscriptions,
  NotifyUserDirectory,
  NotifyUserProfile,
  WebPushPayload,
  WebPushSender,
} from './ports/notify.ports';

const ANA = '66e9a00000000000000000a1';
const BETO = '66e9a00000000000000000b2';
const CARLOS = '66e9a00000000000000000c3';
const GROUP = '66e9a00000000000000000g1';
const GROUP2 = '66e9a00000000000000000g2';
const OTHER_GROUP = '66e9a00000000000000000g9';
const LINK = '66e9a00000000000000000l1';
const APP = '66e9a00000000000000000ap';
const NOW = new Date('2026-09-22T12:00:00.000Z');
const AT1 = '2026-09-22T12:00:00.000Z';
const AT2 = '2026-09-22T13:00:00.000Z';
const AT3 = '2026-09-22T14:00:00.000Z';

class MemPrefs implements NotifyPreferencesReader {
  readonly map = new Map<string, NotificationPreferences>();
  findByUserId(userId: string): Promise<NotificationPreferences | null> {
    return Promise.resolve(this.map.get(userId) ?? null);
  }
}

class MemGroups implements NotifyGroupDirectory {
  members = new Map<string, string[]>([[GROUP, [ANA, BETO]]]);
  linkGroups = new Map<string, string[]>([[LINK, [GROUP]]]);
  names = new Map<string, string>([[GROUP, 'Backend']]);
  memberIdsOf(groupId: string): Promise<string[]> {
    return Promise.resolve(this.members.get(groupId) ?? []);
  }
  groupIdsOfLink(linkId: string): Promise<string[]> {
    return Promise.resolve(this.linkGroups.get(linkId) ?? []);
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
      userId: BETO,
      email: 'beto@example.com',
      displayName: 'Beto',
      emailVerified: true,
      outputLanguage: 'en',
    },
    {
      userId: CARLOS,
      email: 'carlos@example.com',
      displayName: 'Carlos',
      emailVerified: true,
      outputLanguage: 'es',
    },
  ];
  profilesOf(userIds: readonly string[]): Promise<NotifyUserProfile[]> {
    return Promise.resolve(
      this.profiles.filter((p) => userIds.includes(p.userId)),
    );
  }
}

class MemPush implements NotifyPushSubscriptions {
  byUser = new Map<string, NotifyPushSubscription[]>();
  deleted: string[] = [];
  listByUserId(userId: string): Promise<readonly NotifyPushSubscription[]> {
    return Promise.resolve(this.byUser.get(userId) ?? []);
  }
  deleteEndpoint(endpoint: string): Promise<void> {
    this.deleted.push(endpoint);
    return Promise.resolve();
  }
}

class MemLedger implements NotifyDeliveryLedger {
  completed = new Set<string>();
  claims = 0;
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
    this.claims += 1;
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

class CapturingMailer implements NotifyMailer {
  sent: NotifyMailMessage[] = [];
  fail = false;
  send(message: NotifyMailMessage): Promise<void> {
    if (this.fail) {
      return Promise.reject(new Error('smtp down'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

class CapturingPush implements WebPushSender {
  sent: { sub: NotifyPushSubscription; payload: WebPushPayload }[] = [];
  fail = false;
  send(
    subscription: NotifyPushSubscription,
    payload: WebPushPayload,
  ): Promise<void> {
    if (this.fail) {
      return Promise.reject(new Error('push down'));
    }
    this.sent.push({ sub: subscription, payload });
    return Promise.resolve();
  }
}

class MemTitles implements NotifyLinkTitles {
  titleOf(): Promise<string | null> {
    return Promise.resolve('Senior Dev');
  }
}

function build(overrides: {
  prefs?: MemPrefs;
  groups?: MemGroups;
  users?: MemUsers;
  pushSubs?: MemPush;
  ledger?: MemLedger;
  mailer?: CapturingMailer;
  push?: CapturingPush;
} = {}) {
  const prefs = overrides.prefs ?? new MemPrefs();
  const groups = overrides.groups ?? new MemGroups();
  const users = overrides.users ?? new MemUsers();
  const pushSubs = overrides.pushSubs ?? new MemPush();
  const ledger = overrides.ledger ?? new MemLedger();
  const mailer = overrides.mailer ?? new CapturingMailer();
  const push = overrides.push ?? new CapturingPush();
  const useCase = new ProcessNotifyFanOut(
    prefs,
    groups,
    users,
    pushSubs,
    ledger,
    mailer,
    push,
    new MemTitles(),
    'http://localhost:4200',
    { now: () => NOW },
  );
  return { useCase, prefs, groups, users, pushSubs, ledger, mailer, push };
}

function withTwoGroups(): MemGroups {
  const groups = new MemGroups();
  groups.members.set(GROUP, [ANA, BETO]);
  groups.members.set(GROUP2, [ANA, CARLOS]);
  groups.linkGroups.set(LINK, [GROUP, GROUP2]);
  groups.names.set(GROUP2, 'Frontend');
  return groups;
}

describe('ProcessNotifyFanOut group_new_link', () => {
  it('incluye al autor por defecto y envía email a ambos', async () => {
    const { useCase, mailer } = build();
    await useCase.execute({
      type: 'GroupLinkAdded.v1',
      payload: { groupId: GROUP, linkId: LINK, actorUserId: ANA },
    });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([
      'ana@example.com',
      'beto@example.com',
    ]);
    expect(mailer.sent[0]?.templateId).toBe('group-new-link');
  });

  it('opt-out de propias acciones excluye al actor', async () => {
    const prefs = new MemPrefs();
    prefs.map.set(ANA, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      notifyOwnActions: false,
    });
    const { useCase, mailer } = build({ prefs });
    await useCase.execute({
      type: 'GroupLinkAdded.v1',
      payload: { groupId: GROUP, linkId: LINK, actorUserId: ANA },
    });
    expect(mailer.sent.map((m) => m.to)).toEqual(['beto@example.com']);
  });

  it('opt-out groupNewLink=false no entrega email ni push', async () => {
    const prefs = new MemPrefs();
    prefs.map.set(ANA, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      groupNewLink: false,
    });
    prefs.map.set(BETO, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      groupNewLink: false,
    });
    const pushSubs = new MemPush();
    pushSubs.byUser.set(ANA, [
      {
        userId: ANA,
        endpoint: 'https://push.example/a',
        p256dh: 'p',
        auth: 'a',
      },
    ]);
    const { useCase, mailer, push } = build({ prefs, pushSubs });
    await useCase.execute({
      type: 'GroupLinkAdded.v1',
      payload: { groupId: GROUP, linkId: LINK, actorUserId: ANA },
    });
    expect(mailer.sent).toHaveLength(0);
    expect(push.sent).toHaveLength(0);
  });

  it('no envía email si no verificado; push sí', async () => {
    const users = new MemUsers();
    users.profiles[0] = {
      ...users.profiles[0]!,
      emailVerified: false,
    };
    const pushSubs = new MemPush();
    pushSubs.byUser.set(ANA, [
      {
        userId: ANA,
        endpoint: 'https://push.example/a',
        p256dh: 'p',
        auth: 'a',
      },
    ]);
    const { useCase, mailer, push } = build({ users, pushSubs });
    await useCase.execute({
      type: 'GroupLinkAdded.v1',
      payload: { groupId: GROUP, linkId: LINK, actorUserId: BETO },
    });
    expect(mailer.sent.map((m) => m.to)).toEqual(['beto@example.com']);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]?.sub.userId).toBe(ANA);
  });

  it('reproceso no duplica email (ledger)', async () => {
    const { useCase, mailer, ledger } = build();
    const job = {
      type: 'GroupLinkAdded.v1' as const,
      payload: { groupId: GROUP, linkId: LINK, actorUserId: ANA },
    };
    await useCase.execute(job);
    const first = mailer.sent.length;
    await useCase.execute(job);
    expect(mailer.sent.length).toBe(first);
    expect(ledger.completed.size).toBeGreaterThan(0);
  });

  it('fallo de email no bloquea push', async () => {
    const mailer = new CapturingMailer();
    mailer.fail = true;
    const pushSubs = new MemPush();
    pushSubs.byUser.set(ANA, [
      {
        userId: ANA,
        endpoint: 'https://push.example/a',
        p256dh: 'p',
        auth: 'a',
      },
    ]);
    const { useCase, push } = build({ mailer, pushSubs });
    await useCase.execute({
      type: 'GroupLinkAdded.v1',
      payload: { groupId: GROUP, linkId: LINK, actorUserId: BETO },
    });
    expect(push.sent.length).toBeGreaterThan(0);
  });
});

describe('ProcessNotifyFanOut application_stale', () => {
  it('solo notifica al dueño', async () => {
    const { useCase, mailer } = build();
    await useCase.execute({
      type: 'ApplicationStale.v1',
      payload: {
        applicationId: APP,
        userId: ANA,
        linkId: LINK,
        status: 'applied',
        lastChangedAt: '2026-09-01T00:00:00.000Z',
        staleAfterDays: 10,
      },
    });
    expect(mailer.sent.map((m) => m.to)).toEqual(['ana@example.com']);
    expect(mailer.sent[0]?.templateId).toBe('application-stale');
  });

  it('opt-out applicationStale=false no entrega', async () => {
    const prefs = new MemPrefs();
    prefs.map.set(ANA, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      applicationStale: false,
    });
    const pushSubs = new MemPush();
    pushSubs.byUser.set(ANA, [
      {
        userId: ANA,
        endpoint: 'https://push.example/a',
        p256dh: 'p',
        auth: 'a',
      },
    ]);
    const { useCase, mailer, push } = build({ prefs, pushSubs });
    await useCase.execute({
      type: 'ApplicationStale.v1',
      payload: {
        applicationId: APP,
        userId: ANA,
        linkId: LINK,
        status: 'applied',
        lastChangedAt: '2026-09-01T00:00:00.000Z',
        staleAfterDays: 10,
      },
    });
    expect(mailer.sent).toHaveLength(0);
    expect(push.sent).toHaveLength(0);
  });
});

describe('ProcessNotifyFanOut application_status_group', () => {
  it('avisa a la unión de miembros', async () => {
    const { useCase, mailer } = build();
    await useCase.execute({
      type: 'ApplicationStatusNotify.v1',
      payload: {
        applicationId: APP,
        linkId: LINK,
        actorUserId: ANA,
        status: 'in_process',
        statusChangedAt: AT1,
      },
    });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([
      'ana@example.com',
      'beto@example.com',
    ]);
    expect(JSON.stringify(mailer.sent)).not.toContain('stageLabel');
  });

  it('payload.groupId acota solo a miembros de ese grupo (D8)', async () => {
    const groups = withTwoGroups();
    const { useCase, mailer } = build({ groups });
    await useCase.execute({
      type: 'ApplicationStatusNotify.v1',
      payload: {
        applicationId: APP,
        linkId: LINK,
        actorUserId: ANA,
        status: 'applied',
        statusChangedAt: AT1,
        groupId: GROUP,
      },
    });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([
      'ana@example.com',
      'beto@example.com',
    ]);
    expect(mailer.sent.map((m) => m.to)).not.toContain('carlos@example.com');
  });

  it('prefs.applicationStatusGroupId acota a ese grupo ∩ link (D8)', async () => {
    const groups = withTwoGroups();
    const prefs = new MemPrefs();
    prefs.map.set(BETO, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      applicationStatusGroupId: GROUP2,
    });
    prefs.map.set(CARLOS, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      applicationStatusGroupId: GROUP2,
    });
    const { useCase, mailer } = build({ groups, prefs });
    await useCase.execute({
      type: 'ApplicationStatusNotify.v1',
      payload: {
        applicationId: APP,
        linkId: LINK,
        actorUserId: ANA,
        status: 'applied',
        statusChangedAt: AT1,
      },
    });
    // BETO pref wants GROUP2 but is not a member → excluded.
    // CARLOS pref GROUP2 and is member → included.
    // ANA defaults (union) → included.
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([
      'ana@example.com',
      'carlos@example.com',
    ]);
  });

  it('pref group no está en grupos del link → 0 destinatarios con esa pref (D8)', async () => {
    const prefs = new MemPrefs();
    prefs.map.set(ANA, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      applicationStatusGroupId: OTHER_GROUP,
    });
    prefs.map.set(BETO, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      applicationStatusGroupId: OTHER_GROUP,
    });
    const { useCase, mailer } = build({ prefs });
    await useCase.execute({
      type: 'ApplicationStatusNotify.v1',
      payload: {
        applicationId: APP,
        linkId: LINK,
        actorUserId: ANA,
        status: 'applied',
        statusChangedAt: AT1,
      },
    });
    expect(mailer.sent).toHaveLength(0);
  });

  it('reopen applied→in_process→applied no suprime el segundo aviso (D6)', async () => {
    const { useCase, mailer, ledger } = build();
    const base = {
      type: 'ApplicationStatusNotify.v1' as const,
      payload: {
        applicationId: APP,
        linkId: LINK,
        actorUserId: ANA,
        status: 'applied' as const,
        statusChangedAt: AT1,
      },
    };
    await useCase.execute(base);
    await useCase.execute({
      ...base,
      payload: {
        ...base.payload,
        status: 'in_process',
        statusChangedAt: AT2,
      },
    });
    const beforeReopen = mailer.sent.length;
    await useCase.execute({
      ...base,
      payload: {
        ...base.payload,
        status: 'applied',
        statusChangedAt: AT3,
      },
    });
    expect(mailer.sent.length).toBeGreaterThan(beforeReopen);
    const aggregateKeys = [
      ...new Set(
        ledger.keys
          .filter((k) => k.type === 'application_status_group')
          .map((k) => k.aggregateKey),
      ),
    ];
    expect(aggregateKeys).toContain(`${APP}:${AT1}:union`);
    expect(aggregateKeys).toContain(`${APP}:${AT3}:union`);
    expect(aggregateKeys).toHaveLength(3);
  });
});
