import {
  GROUP_LINK_COMMENTS_CHANNEL,
  GROUP_LINK_COMMENTS_EVENT_NAME,
  LINK_ENRICHED_CHANNEL,
  groupLinkCommentsChangedEvent,
  groupLinkCommentsMessageSchema,
  linkEnrichedEvent,
  type GroupLinkCommentsChangedPayload,
  type GroupLinkCommentsMessage,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  EventStreamRegistry,
  type EventStreamSink,
} from '../../../infrastructure/realtime/event-stream.registry';
import { EventStreamCommentsBroadcaster } from './event-stream-comments-broadcaster';
import { RedisCommentNotices } from './redis-comment-notices';
import { RedisCommentsChangedPublisher } from './redis-comments-changed-publisher';
import type { RedisSubscriber } from './redis-enrichment-notices';

// Aviso en vivo de comentarios sin Redis (tareas 4.1, 4.2 y 4.4 de group-comments): el publicador contra un cliente
// doble que falla, la suscripción contra un suscriptor doble que recibe los dos canales del proceso, y el reparto por
// el registro de conexiones del canal de eventos.

const payload: GroupLinkCommentsChangedPayload = {
  groupId: '66e9a0000000000000000001',
  linkId: '66e9a0000000000000000002',
  commentId: '66e9a0000000000000000003',
  change: 'created',
};

class RecordingLogger {
  readonly warnings: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }
}

/** Cliente de publicación doble: apunta lo publicado o falla como un Redis caído. */
class PublishingClient {
  readonly published: { channel: string; message: string }[] = [];
  down = false;

  publish(channel: string, message: string): Promise<number> {
    if (this.down) {
      return Promise.reject(new Error('Connection is closed.'));
    }
    this.published.push({ channel, message });
    return Promise.resolve(1);
  }
}

describe('RedisCommentsChangedPublisher (4.1)', () => {
  it('publishes the versioned notice on its channel, with only identifiers', async () => {
    const client = new PublishingClient();

    await new RedisCommentsChangedPublisher(client, new RecordingLogger()).publish(
      payload,
    );

    expect(client.published).toEqual([
      {
        channel: 'events:group-link.comments',
        message: JSON.stringify(groupLinkCommentsChangedEvent(payload)),
      },
    ]);
  });

  it('El texto no viaja por Redis: extra fields never reach the channel', async () => {
    const client = new PublishingClient();
    const withText = {
      ...payload,
      text: 'Piden inglés C1',
      authorId: '66e9a0000000000000000009',
    } as GroupLinkCommentsChangedPayload;

    await new RedisCommentsChangedPublisher(client, new RecordingLogger()).publish(
      withText,
    );

    const message = client.published[0]?.message ?? '';
    expect(message).not.toContain('Piden inglés C1');
    expect(message).not.toContain('66e9a0000000000000000009');
  });

  it('never throws, and warns once per streak without the body', async () => {
    const client = new PublishingClient();
    client.down = true;
    const logger = new RecordingLogger();
    const publisher = new RedisCommentsChangedPublisher(client, logger);

    await expect(publisher.publish(payload)).resolves.toBeUndefined();
    await publisher.publish(payload);

    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).not.toContain(payload.commentId);

    client.down = false;
    await publisher.publish(payload);
    client.down = true;
    await publisher.publish(payload);

    expect(logger.warnings).toHaveLength(2);
  });
});

/** Suscriptor doble ya conectado, que reparte cualquier canal a quien escucha, como el cliente compartido. */
class SharedSubscriber implements RedisSubscriber {
  status = 'ready';
  readonly subscribed: string[] = [];
  readonly unsubscribed: string[] = [];
  connects = 0;
  private readonly messageListeners = new Set<
    (channel: string, message: string) => void
  >();
  private readonly readyListeners = new Set<() => void>();

  connect(): Promise<unknown> {
    this.connects += 1;
    this.status = 'ready';
    return Promise.resolve();
  }

  subscribe(channel: string): Promise<unknown> {
    this.subscribed.push(channel);
    return Promise.resolve(1);
  }

  unsubscribe(channel: string): Promise<unknown> {
    this.unsubscribed.push(channel);
    return Promise.resolve(0);
  }

  on(event: 'message', listener: (channel: string, message: string) => void): this;
  on(event: 'ready', listener: () => void): this;
  on(
    event: 'message' | 'ready',
    listener: ((channel: string, message: string) => void) | (() => void),
  ): this {
    if (event === 'message') {
      this.messageListeners.add(
        listener as (channel: string, message: string) => void,
      );
    } else {
      this.readyListeners.add(listener as () => void);
    }
    return this;
  }

  off(event: 'message', listener: (channel: string, message: string) => void): this;
  off(event: 'ready', listener: () => void): this;
  off(
    event: 'message' | 'ready',
    listener: ((channel: string, message: string) => void) | (() => void),
  ): this {
    if (event === 'message') {
      this.messageListeners.delete(
        listener as (channel: string, message: string) => void,
      );
    } else {
      this.readyListeners.delete(listener as () => void);
    }
    return this;
  }

  deliver(channel: string, message: string): void {
    for (const listener of this.messageListeners) {
      listener(channel, message);
    }
  }

  reconnect(): void {
    for (const listener of this.readyListeners) {
      listener();
    }
  }
}

function settled(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('RedisCommentNotices (4.2)', () => {
  it('delivers only the notices of its channel from the shared subscriber', async () => {
    const client = new SharedSubscriber();
    const received: GroupLinkCommentsChangedPayload[] = [];
    await new RedisCommentNotices(client, new RecordingLogger()).subscribe(
      (notice) => {
        received.push(notice);
        return Promise.resolve();
      },
    );

    client.deliver(
      LINK_ENRICHED_CHANNEL,
      JSON.stringify(
        linkEnrichedEvent({
          linkId: payload.linkId,
          previewStatus: 'enriched',
          previewVersion: 2,
        }),
      ),
    );
    client.deliver(
      GROUP_LINK_COMMENTS_CHANNEL,
      JSON.stringify(groupLinkCommentsChangedEvent(payload)),
    );
    await settled();

    expect(client.subscribed).toEqual([GROUP_LINK_COMMENTS_CHANNEL]);
    expect(received).toEqual([payload]);
  });

  it('discards what breaks the contract without logging its content', async () => {
    const client = new SharedSubscriber();
    const logger = new RecordingLogger();
    const received: GroupLinkCommentsChangedPayload[] = [];
    await new RedisCommentNotices(client, logger).subscribe((notice) => {
      received.push(notice);
      return Promise.resolve();
    });

    client.deliver(GROUP_LINK_COMMENTS_CHANNEL, 'Piden inglés C1');
    client.deliver(
      GROUP_LINK_COMMENTS_CHANNEL,
      JSON.stringify({
        type: 'GroupLinkCommentsChanged.v1',
        payload: { ...payload, text: 'Piden inglés C1' },
      }),
    );
    await settled();

    expect(received).toEqual([]);
    expect(logger.warnings).toHaveLength(2);
    expect(logger.warnings.join(' ')).not.toContain('Piden');
  });

  it('asks for its channel again on every ready, and connects only when nobody did', async () => {
    const client = new SharedSubscriber();
    client.status = 'wait';
    await new RedisCommentNotices(client, new RecordingLogger()).subscribe(() =>
      Promise.resolve(),
    );

    expect(client.connects).toBe(1);
    client.reconnect();
    client.reconnect();
    await settled();

    expect(client.subscribed).toEqual([
      GROUP_LINK_COMMENTS_CHANNEL,
      GROUP_LINK_COMMENTS_CHANNEL,
    ]);
  });

  it('leaves the shared connection open when it stops listening, and only drops its channel', async () => {
    const client = new SharedSubscriber();
    const stop = await new RedisCommentNotices(
      client,
      new RecordingLogger(),
    ).subscribe(() => Promise.resolve());

    await stop();

    expect(client.unsubscribed).toEqual([GROUP_LINK_COMMENTS_CHANNEL]);
    expect(client.status).toBe('ready');
  });

  it('keeps listening when a delivery fails', async () => {
    const client = new SharedSubscriber();
    const logger = new RecordingLogger();
    let calls = 0;
    await new RedisCommentNotices(client, logger).subscribe(() => {
      calls += 1;
      return Promise.reject(new Error('Mongo is down'));
    });
    const message = JSON.stringify(groupLinkCommentsChangedEvent(payload));

    client.deliver(GROUP_LINK_COMMENTS_CHANNEL, message);
    client.deliver(GROUP_LINK_COMMENTS_CHANNEL, message);
    await settled();

    expect(calls).toBe(2);
    expect(logger.warnings.join(' ')).not.toContain('Mongo is down');
  });
});

class SinkDouble implements EventStreamSink {
  readonly events: { event: string; data: string }[] = [];

  send(event: string, data: string): boolean {
    this.events.push({ event, data });
    return true;
  }

  heartbeat(): boolean {
    return true;
  }

  close(): void {
    // Nada que soltar.
  }
}

describe('EventStreamCommentsBroadcaster (4.4)', () => {
  it('sends group-link.comments with the message as its body', () => {
    const registry = new EventStreamRegistry();
    const sink = new SinkDouble();
    registry.register('ana', sink);
    const broadcaster = new EventStreamCommentsBroadcaster(registry);
    const message: GroupLinkCommentsMessage = {
      ...payload,
      comments: {
        count: 1,
        revision: 1,
        sharedAt: '2026-09-19T10:00:00.000Z',
        latest: [],
      },
    };

    expect(broadcaster.hasListeners()).toBe(true);
    expect(broadcaster.send('ana', message)).toBe(1);
    expect(broadcaster.send('beto', message)).toBe(0);
    expect(sink.events[0]?.event).toBe(GROUP_LINK_COMMENTS_EVENT_NAME);
    expect(
      groupLinkCommentsMessageSchema.parse(JSON.parse(sink.events[0]?.data ?? '')),
    ).toEqual(message);
  });

  it('has no listeners without connections', () => {
    expect(
      new EventStreamCommentsBroadcaster(new EventStreamRegistry()).hasListeners(),
    ).toBe(false);
  });
});
