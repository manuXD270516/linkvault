import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import webpush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NotifyPushSubscription,
  NotifyPushSubscriptions,
} from '../../application/ports/notify.ports';
import {
  RecordingWebPushSender,
  WebPushVapidSender,
  createPushEndpointPolicy,
} from './web-push-sender';

describe('RecordingWebPushSender (410 purge)', () => {
  it('purges endpoint on simulated 410', async () => {
    const deleted: string[] = [];
    const sender = new RecordingWebPushSender(async (endpoint) => {
      deleted.push(endpoint);
    });
    sender.goneEndpoints.add('https://push.example/dead');
    const sub: NotifyPushSubscription = {
      userId: 'u1',
      endpoint: 'https://push.example/dead',
      p256dh: 'p',
      auth: 'a',
    };
    await sender.send(sub, { title: 't', body: 'b', url: 'http://x' });
    expect(deleted).toEqual(['https://push.example/dead']);
    expect(sender.sent).toHaveLength(0);
  });

  it('records successful sends', async () => {
    const sender = new RecordingWebPushSender();
    await sender.send(
      {
        userId: 'u1',
        endpoint: 'https://push.example/ok',
        p256dh: 'p',
        auth: 'a',
      },
      { title: 'Hi', body: 'There', url: 'http://x' },
    );
    expect(sender.sent).toHaveLength(1);
  });
});

describe('WebPushVapidSender endpoint policy', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function countingServer(): Promise<{
    port: number;
    count: () => number;
  }> {
    let connections = 0;
    const server = createServer((_request, response) => response.end());
    server.on('connection', () => {
      connections += 1;
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    servers.push(server);
    return {
      port: (server.address() as AddressInfo).port,
      count: () => connections,
    };
  }

  function senderOf(
    deleted: string[],
    policy?: (endpoint: string) => boolean,
  ): WebPushVapidSender {
    const keys = webpush.generateVAPIDKeys();
    const subscriptions: NotifyPushSubscriptions = {
      listByUserId: () => Promise.resolve([]),
      deleteEndpoint: (endpoint) => {
        deleted.push(endpoint);
        return Promise.resolve();
      },
    };
    return new WebPushVapidSender(
      {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        subject: 'mailto:ops@example.test',
      },
      subscriptions,
      policy,
    );
  }

  const PAYLOAD = { title: 't', body: 'b', url: 'http://x' };

  it('deletes a stored subscription outside the known push services without connecting', async () => {
    const server = await countingServer();
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const endpoint = `http://127.0.0.1:${server.port}/secret-subscription-path`;
    const deleted: string[] = [];
    const browserKeys = webpush.generateVAPIDKeys();
    const sub: NotifyPushSubscription = {
      userId: 'u1',
      endpoint,
      p256dh: browserKeys.publicKey,
      auth: Buffer.from('0123456789abcdef').toString('base64url'),
    };

    // Control positivo: con una política permisiva el envío sí abre una conexión hacia ese host.
    await senderOf([], () => true)
      .send(sub, PAYLOAD)
      .catch(() => undefined);
    expect(server.count()).toBe(1);

    await senderOf(deleted).send(sub, PAYLOAD);

    expect(server.count()).toBe(1);
    expect(deleted).toEqual([endpoint]);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('127.0.0.1');
    expect(logged).not.toContain('secret-subscription-path');
    expect(logged).not.toContain(endpoint);
  });

  it('deletes a stored subscription whose legacy-parsed host differs from the WHATWG host', async () => {
    const deleted: string[] = [];
    // Un punto codificado en el host: WHATWG lo decodifica y el analizador heredado no. Con una lista que lo diera por
    // bueno, solo la igualdad de hosts lo rechaza.
    const endpoint = 'https://fcm.googleapis.com%2e.example.test/x';
    const sender = senderOf(
      deleted,
      createPushEndpointPolicy(() => true),
    );
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await sender.send(
      { userId: 'u1', endpoint, p256dh: 'p', auth: 'a' },
      PAYLOAD,
    );

    expect(deleted).toEqual([endpoint]);
  });
});
