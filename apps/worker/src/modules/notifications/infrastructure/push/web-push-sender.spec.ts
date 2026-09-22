import { describe, expect, it } from 'vitest';
import type { NotifyPushSubscription } from '../../application/ports/notify.ports';
import { RecordingWebPushSender } from './web-push-sender';

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
