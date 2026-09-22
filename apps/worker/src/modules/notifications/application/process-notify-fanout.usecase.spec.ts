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
const GROUP = '66e9a00000000000000000g1';
const LINK = '66e9a00000000000000000l1';
const NOW = new Date('2026-09-22T12:00:00.000Z');

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
  private keyOf(k: NotifyDeliveryKey): string {
    return `${k.type}|${k.aggregateKey}|${k.userId}|${k.channel}`;
  }
  claim(
    key: NotifyDeliveryKey,
  ): Promise<'claimed' | 'already_done' | 'in_flight'> {
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
        applicationId: '66e9a00000000000000000ap',
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
});

describe('ProcessNotifyFanOut application_status_group', () => {
  it('avanisa a la unión de miembros', async () => {
    const { useCase, mailer } = build();
    await useCase.execute({
      type: 'ApplicationStatusNotify.v1',
      payload: {
        applicationId: '66e9a00000000000000000ap',
        linkId: LINK,
        actorUserId: ANA,
        status: 'in_process',
      },
    });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([
      'ana@example.com',
      'beto@example.com',
    ]);
    expect(JSON.stringify(mailer.sent)).not.toContain('stageLabel');
  });
});
