import { beforeEach, describe, expect, it } from 'vitest';
import { VapidUnavailable } from '../domain/errors';
import type {
  NewPushSubscription,
  PushSubscription,
} from '../domain/push-subscription';
import { DeletePushSubscription } from './delete-push-subscription.usecase';
import { GetVapidPublicKey } from './get-vapid-public-key.usecase';
import type { UpsertPushResult } from './ports/push-subscription.repository.port';
import { RegisterPushSubscription } from './register-push-subscription.usecase';
import { fixedClock } from './testing/notifications-test-doubles';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const ANA = '66e9a00000000000000000a1';
const ENDPOINT = 'https://push.example/endpoint-1';

class InMemoryPushSubscriptions {
  private readonly rows = new Map<string, PushSubscription>();

  private key(userId: string, endpoint: string): string {
    return `${userId}\0${endpoint}`;
  }

  upsert(input: NewPushSubscription): Promise<UpsertPushResult> {
    const k = this.key(input.userId, input.endpoint);
    const existing = this.rows.get(k);
    if (existing) {
      const updated: PushSubscription = {
        ...existing,
        p256dh: input.p256dh,
        auth: input.auth,
      };
      this.rows.set(k, updated);
      return Promise.resolve({ subscription: updated, created: false });
    }
    this.rows.set(k, input);
    return Promise.resolve({ subscription: input, created: true });
  }

  deleteByEndpoint(userId: string, endpoint: string): Promise<void> {
    this.rows.delete(this.key(userId, endpoint));
    return Promise.resolve();
  }

  listByUserId(userId: string): Promise<readonly PushSubscription[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.userId === userId),
    );
  }

  deleteByUserId(): Promise<void> {
    return Promise.resolve();
  }

  deleteEndpoint(): Promise<void> {
    return Promise.resolve();
  }

  size(): number {
    return this.rows.size;
  }
}

describe('RegisterPushSubscription', () => {
  let repo: InMemoryPushSubscriptions;
  let register: RegisterPushSubscription;

  beforeEach(() => {
    repo = new InMemoryPushSubscriptions();
    register = new RegisterPushSubscription(repo, fixedClock(NOW));
  });

  it('primera suscripción es created', async () => {
    const result = await register.execute(ANA, {
      endpoint: ENDPOINT,
      keys: { p256dh: 'pk', auth: 'ak' },
    });
    expect(result.created).toBe(true);
    expect(repo.size()).toBe(1);
  });

  it('mismo endpoint es idempotente', async () => {
    await register.execute(ANA, {
      endpoint: ENDPOINT,
      keys: { p256dh: 'pk', auth: 'ak' },
    });
    const again = await register.execute(ANA, {
      endpoint: ENDPOINT,
      keys: { p256dh: 'pk2', auth: 'ak2' },
    });
    expect(again.created).toBe(false);
    expect(repo.size()).toBe(1);
  });
});

describe('DeletePushSubscription', () => {
  it('es idempotente', async () => {
    const repo = new InMemoryPushSubscriptions();
    const register = new RegisterPushSubscription(repo, fixedClock(NOW));
    const remove = new DeletePushSubscription(repo);
    await register.execute(ANA, {
      endpoint: ENDPOINT,
      keys: { p256dh: 'pk', auth: 'ak' },
    });
    await remove.execute(ANA, ENDPOINT);
    await expect(remove.execute(ANA, ENDPOINT)).resolves.toBeUndefined();
    expect(repo.size()).toBe(0);
  });
});

describe('GetVapidPublicKey', () => {
  it('devuelve la pública si hay claves', () => {
    const get = new GetVapidPublicKey({
      publicKey: 'BPublic',
      privateKey: 'private',
      subject: 'mailto:dev@example.com',
    });
    expect(get.execute()).toEqual({ publicKey: 'BPublic' });
  });

  it('lanza vapid_unavailable si falta la pública', () => {
    const get = new GetVapidPublicKey({
      publicKey: null,
      privateKey: null,
      subject: null,
    });
    expect(() => get.execute()).toThrow(VapidUnavailable);
  });
});
