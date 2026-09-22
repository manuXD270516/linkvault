import {
  GROUP_LINK_COMMENTS_CHANNEL,
  type GroupLinkCommentsChangedPayload,
  type LinkEnrichedPayload,
} from '@linkvault/shared';
import { RedisPingDouble } from '@linkvault/testing';
import { Redis } from 'ioredis';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { createRedisSubscriberClient } from '../../../infrastructure/redis/redis-subscriber-client';
import { PostGroupLinkComment } from '../application/post-group-link-comment.usecase';
import {
  BACKEND,
  BETO,
  ANA,
  CommentsHarness,
} from '../application/testing/comments-test-harness';
import { RedisCommentNotices } from './redis-comment-notices';
import { RedisCommentsChangedPublisher } from './redis-comments-changed-publisher';
import { RedisEnrichmentNotices } from './redis-enrichment-notices';

// El aviso de comentarios contra un Redis de verdad (uno de mentira que habla RESP, sin red), con el patrón de
// `redis-enrichment-notices.integration.spec.ts` (tarea 4.6 de group-comments): lo que publica una instancia de `api`
// llega a otra por el canal, y lo que viaja por Redis no lleva el texto ni el autor.

class SilentLogger {
  readonly warnings: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }
}

const doubles: RedisPingDouble[] = [];
const clients: Redis[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.disconnect();
  }
  for (const double of doubles.splice(0)) {
    await double.close();
  }
});

/** Cliente de aplicación de una instancia: solo publica. */
function appClientOn(double: RedisPingDouble): Redis {
  const client = new Redis(double.url, { enableReadyCheck: false });
  client.on('error', () => undefined);
  clients.push(client);
  return client;
}

/** Cliente suscriptor de otra instancia, el que comparte el proceso. */
function subscriberOn(double: RedisPingDouble): Redis {
  const client = createRedisSubscriberClient(double.url);
  clients.push(client);
  return client;
}

async function eventually(happened: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !happened(); attempt += 1) {
    await delay(25);
  }
}

/** Espera a que alguien escuche el canal: `PUBLISH` contesta a cuántos llegó. */
async function untilSomeoneListens(client: Redis): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await client.publish(GROUP_LINK_COMMENTS_CHANNEL, 'ping')) > 0) {
      return;
    }
    await delay(25);
  }
  throw new Error('nobody ever subscribed to the channel');
}

describe('comment notices over a real connection', () => {
  it('what one instance publishes reaches another, next to the enrichment channel on the same connection', async () => {
    const double = await RedisPingDouble.start('up');
    doubles.push(double);
    const subscriber = subscriberOn(double);
    const received: GroupLinkCommentsChangedPayload[] = [];
    const enriched: LinkEnrichedPayload[] = [];
    await new RedisEnrichmentNotices(subscriber, new SilentLogger()).subscribe(
      (notice) => {
        enriched.push(notice);
        return Promise.resolve();
      },
    );
    await new RedisCommentNotices(subscriber, new SilentLogger()).subscribe(
      (notice) => {
        received.push(notice);
        return Promise.resolve();
      },
    );
    const publishing = appClientOn(double);
    await untilSomeoneListens(publishing);
    const notice: GroupLinkCommentsChangedPayload = {
      groupId: '66e9a0000000000000000001',
      linkId: '66e9a0000000000000000002',
      commentId: '66e9a0000000000000000003',
      change: 'deleted',
    };

    await new RedisCommentsChangedPublisher(
      publishing,
      new SilentLogger(),
    ).publish(notice);
    await eventually(() => received.length > 0);

    expect(received).toEqual([notice]);
    expect(enriched).toEqual([]);
  });

  it('El texto no viaja por Redis', async () => {
    const double = await RedisPingDouble.start('up');
    doubles.push(double);
    // Un suscriptor cualquiera del canal ve lo mismo que `MONITOR`: el mensaje tal cual.
    const spy = subscriberOn(double);
    await spy.connect();
    const raw: string[] = [];
    spy.on('message', (channel: string, message: string) => {
      if (channel === GROUP_LINK_COMMENTS_CHANNEL && message !== 'ping') {
        raw.push(message);
      }
    });
    await spy.subscribe(GROUP_LINK_COMMENTS_CHANNEL);
    const publishing = appClientOn(double);
    await untilSomeoneListens(publishing);
    const harness = new CommentsHarness();
    const post = new PostGroupLinkComment(
      harness.groupLinks,
      harness.comments,
      harness.membership,
      harness.directory,
      harness.limiter,
      new RedisCommentsChangedPublisher(publishing, new SilentLogger()),
      harness.clock,
      {
        startSession: async () => ({
          withTransaction: async (fn: () => Promise<void>) => fn(),
          endSession: async () => undefined,
        }),
      } as never,
    );
    const linkId = await harness.shared(BACKEND, ANA);

    const response = await post.execute(BETO, BACKEND, linkId, {
      text: 'Piden inglés C1',
    });
    await eventually(() => raw.length > 0);

    expect(raw).toHaveLength(1);
    expect(raw[0]).not.toContain('Piden inglés C1');
    expect(raw[0]).not.toContain(BETO);
    expect(JSON.parse(raw[0] ?? '')).toEqual({
      type: 'GroupLinkCommentsChanged.v1',
      payload: {
        groupId: BACKEND,
        linkId,
        commentId: response.comment.id,
        change: 'created',
      },
    });
  });
});
