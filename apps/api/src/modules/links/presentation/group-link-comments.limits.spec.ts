import { Writable } from 'node:stream';
import { apiErrorResponseSchema } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AttemptOutcome,
  FixedWindowCounter,
  WindowLimit,
} from '../../../infrastructure/limits/fixed-window-counter';
import { InMemoryFixedWindowCounter } from '../../../infrastructure/limits/testing/in-memory-fixed-window-counter';
import {
  createCommentsTestApp,
  type CommentsTestApp,
} from '../../../test-support/comments-test-app';

// Límite de comentarios y logs por HTTP (tarea 5.7 de group-comments): 30 por persona cada 15 minutos con el contador
// de plataforma, que falla abierto; borrar no cuenta; y el texto de un comentario no aparece en ningún log.

/** Contador de intentos que se puede tirar desde el test; si no, el de memoria. */
class SwitchableCounter implements FixedWindowCounter {
  down = false;
  inner = new InMemoryFixedWindowCounter();

  consume(key: string, limit: WindowLimit): Promise<AttemptOutcome | null> {
    return this.down ? Promise.resolve(null) : this.inner.consume(key, limit);
  }

  reset(key: string): Promise<boolean> {
    return this.inner.reset(key);
  }

  giveBack(key: string): Promise<boolean> {
    return this.down ? Promise.resolve(false) : this.inner.giveBack(key);
  }
}

/** Destino de logs en memoria: todas las líneas que escribió la app. */
class MemoryDestination extends Writable {
  readonly lines: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: () => void,
  ): void {
    this.lines.push(chunk.toString('utf8'));
    callback();
  }
}

const counter = new SwitchableCounter();
const logs = new MemoryDestination();
let fx: CommentsTestApp;
let linkId: string;

beforeAll(async () => {
  fx = await createCommentsTestApp('comments-limits', getMongoTestUri(), {
    counter,
    logDestination: logs,
  });
});

afterAll(async () => {
  await fx.close();
});

beforeEach(async () => {
  counter.down = false;
  counter.inner = new InMemoryFixedWindowCounter();
  linkId = await fx.newLink();
});

async function postMany(times: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < times; index += 1) {
    const response = await fx.post(fx.beto, linkId, `Comentario ${index}`);
    expect(response.statusCode).toBe(201);
    ids.push(response.json<{ comment: { id: string } }>().comment.id);
  }
  return ids;
}

describe('the comment limit', () => {
  it('Ventana agotada: the 31st answers 429 with Retry-After, and is not stored', async () => {
    await postMany(30);

    const response = await fx.post(fx.beto, linkId, 'Uno más');

    expect(response.statusCode).toBe(429);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
      'too_many_attempts',
    );
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(await fx.storedComments(linkId)).toBe(30);
  });

  it('Lo rechazado no gasta: with 29 used, an empty one is 400 and the next 201', async () => {
    await postMany(29);

    const empty = await fx.post(fx.beto, linkId, '   ');
    const valid = await fx.post(fx.beto, linkId, 'El 30');

    expect(empty.statusCode).toBe(400);
    expect(valid.statusCode).toBe(201);
  });

  it('a comment on a link that is not in the group gives its attempt back', async () => {
    await postMany(29);

    const missing = await fx.post(fx.beto, '66e9a00000000000000000ee', 'Hola');
    const valid = await fx.post(fx.beto, linkId, 'El 30');

    expect(missing.statusCode).toBe(404);
    expect(valid.statusCode).toBe(201);
  });

  it('Contador caído: 201', async () => {
    counter.down = true;

    const response = await fx.post(fx.beto, linkId, 'Sin contador');

    expect(response.statusCode).toBe(201);
  });

  it('Borrar no cuenta: with the window used up, deleting answers 200', async () => {
    const ids = await postMany(30);
    expect((await fx.post(fx.beto, linkId, 'Uno más')).statusCode).toBe(429);

    const response = await fx.remove(fx.beto, linkId, ids[0] ?? '');

    expect(response.statusCode).toBe(200);
  });
});

describe('the logs', () => {
  it('El texto no se registra: neither posting nor a refused delete logs it', async () => {
    logs.lines.length = 0;
    const posted = await fx.post(fx.beto, linkId, 'Piden inglés C1');
    const commentId = posted.json<{ comment: { id: string } }>().comment.id;

    const refused = await fx.remove(fx.carla, linkId, commentId);

    expect(refused.statusCode).toBe(403);
    // Algo se registró (las peticiones, el aviso que no salió sin Redis): el control de que el capturador funciona.
    expect(logs.lines.length).toBeGreaterThan(0);
    expect(logs.lines.join('')).not.toContain('Piden inglés C1');
    expect(logs.lines.join('')).not.toContain('Piden ingl');
  });

  it('does not log the note either', async () => {
    logs.lines.length = 0;

    await fx.save(fx.ana, 'https://empresa.example/careers/nota-log', {
      groupId: fx.group.id,
      note: 'Esta es la que te dije',
    });
    await fx.http.request('POST', '/api/links', {
      authorization: fx.ana.authorization,
      body: {
        url: 'https://empresa.example/careers/nota-log-2',
        note: 'Nota sin grupo secreta',
      },
    });

    expect(logs.lines.join('')).not.toContain('Esta es la que te dije');
    expect(logs.lines.join('')).not.toContain('Nota sin grupo secreta');
  });
});
