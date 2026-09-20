import { Writable } from 'node:stream';
import {
  apiErrorResponseSchema,
  type GroupDetail,
  type PublicShare,
  type SaveLinkResponse,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AttemptOutcome,
  FixedWindowCounter,
  WindowLimit,
} from '../../../infrastructure/limits/fixed-window-counter';
import { InMemoryFixedWindowCounter } from '../../../infrastructure/limits/testing/in-memory-fixed-window-counter';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';

// Límite de las rutas públicas y su log (tareas 6.9 y 6.10 de public-preview-share, D8). Los contadores son globales de
// ruta y no distinguen clientes, así que agotarlos desde el test es fijar la clave, no la IP.

/** Contador que se puede agotar por clave y tirar entero desde el test; si no, el de memoria. */
class SwitchableCounter implements FixedWindowCounter {
  down = false;
  inner = new InMemoryFixedWindowCounter();
  /** Claves cuya ventana se da por agotada. */
  readonly exhausted = new Set<string>();
  /** Claves consumidas, en orden, para comprobar el orden y el `refund`. */
  readonly consumed: string[] = [];
  readonly givenBack: string[] = [];

  consume(key: string, limit: WindowLimit): Promise<AttemptOutcome | null> {
    this.consumed.push(key);
    if (this.down) {
      return Promise.resolve(null);
    }
    if (this.exhausted.has(key)) {
      return Promise.resolve({ allowed: false, retryAfterSeconds: 300 });
    }
    return this.inner.consume(key, limit);
  }

  reset(key: string): Promise<boolean> {
    return this.inner.reset(key);
  }

  giveBack(key: string): Promise<boolean> {
    this.givenBack.push(key);
    return this.down ? Promise.resolve(false) : this.inner.giveBack(key);
  }

  /** Cuántas veces se contó esa clave desde la última limpieza. */
  countOf(key: string): number {
    return this.consumed.filter((name) => name === key).length;
  }

  clear(): void {
    this.consumed.length = 0;
    this.givenBack.length = 0;
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

const PAGE_KEY = 'links:public-page';
const PREVIEW_KEY = 'links:public-preview';
const slugKey = (slug: string) => `links:public-page:${slug}`;

const counter = new SwitchableCounter();
const logs = new MemoryDestination();

let http: LinksTestApp;
let ana: TestMember;
let group: GroupDetail;
let first: PublicShare;
let second: PublicShare;

beforeAll(async () => {
  http = await createLinksTestApp('links-public-limits', getMongoTestUri(), {
    counter,
    logDestination: logs,
  });
  ana = await http.authenticated('Ana');
  group = await http.createGroup(ana, 'Backend Bolivia');
  first = await publish('https://www.linkedin.com/jobs/view/3811111111/');
  second = await publish('https://www.linkedin.com/jobs/view/3822222222/');
});

afterAll(async () => {
  await http.close();
});

beforeEach(() => {
  counter.down = false;
  counter.exhausted.clear();
  counter.clear();
  logs.lines.length = 0;
});

async function publish(url: string): Promise<PublicShare> {
  const response = await http.request('POST', '/api/links', {
    authorization: ana.authorization,
    body: { url, groupId: group.id },
  });
  expect(response.statusCode).toBe(201);
  const share = response.json<SaveLinkResponse>().link.publicShare;
  if (share === undefined) {
    throw new Error('El grupo comparte en público: el link nace publicado');
  }
  return share;
}

function page(slug: string, headers: Record<string, string> = {}) {
  return http.request('GET', `/p/${slug}`, { headers });
}

function preview(slug: string) {
  return http.request('GET', `/api/public/previews/${slug}`);
}

describe('el límite de las rutas públicas', () => {
  it('Ventana agotada en la página', async () => {
    counter.exhausted.add(PAGE_KEY);

    const response = await page(first.slug);

    expect(response.statusCode).toBe(429);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['retry-after']).toBe('300');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toContain('Demasiadas peticiones');
    // No se llegó ni al contador del slug, así que mucho menos a las lecturas.
    expect(counter.countOf(slugKey(first.slug))).toBe(0);
  });

  it('Ventana agotada en el endpoint', async () => {
    counter.exhausted.add(PREVIEW_KEY);

    const response = await preview(first.slug);

    expect(response.statusCode).toBe(429);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
      'too_many_attempts',
    );
    expect(response.headers['retry-after']).toBe('300');
  });

  it('Los contadores son independientes', async () => {
    counter.exhausted.add(PAGE_KEY);

    await expect(preview(first.slug)).resolves.toMatchObject({
      statusCode: 200,
    });
  });

  it('Un enlace agota solo lo suyo', async () => {
    counter.exhausted.add(slugKey(first.slug));

    const burnt = await page(first.slug);
    const other = await page(second.slug);

    expect(burnt.statusCode).toBe(429);
    expect(other.statusCode).toBe(200);
  });

  it('El 429 de un enlace no gasta el contador global', async () => {
    counter.exhausted.add(slugKey(first.slug));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(page(first.slug)).resolves.toMatchObject({
        statusCode: 429,
      });
    }

    // Se consume el global y se devuelve cada vez: el saldo neto es cero.
    expect(counter.countOf(PAGE_KEY)).toBe(5);
    expect(counter.givenBack.filter((key) => key === PAGE_KEY)).toHaveLength(5);
  });

  it('Un slug mal formado no gasta la ventana', async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(page('no-es-un-slug')).resolves.toMatchObject({
        statusCode: 404,
      });
    }

    expect(counter.consumed).toEqual([]);
    await expect(page(first.slug)).resolves.toMatchObject({ statusCode: 200 });
  });

  it('El contador no responde: las dos rutas se sirven igual', async () => {
    counter.down = true;

    await expect(page(first.slug)).resolves.toMatchObject({ statusCode: 200 });
    await expect(preview(first.slug)).resolves.toMatchObject({
      statusCode: 200,
    });
  });

  it('El límite no depende de quién pide', async () => {
    await page(first.slug, { 'x-forwarded-for': '203.0.113.7' });
    await page(first.slug, { 'x-forwarded-for': '198.51.100.9' });

    // Las dos cuentan contra la misma clave, que no lleva nada de la petición.
    expect(counter.countOf(PAGE_KEY)).toBe(2);
    expect(
      counter.consumed.every(
        (key) =>
          key === PAGE_KEY ||
          key === PREVIEW_KEY ||
          key === slugKey(first.slug),
      ),
    ).toBe(true);
  });

  it('el orden es global y después el del slug', async () => {
    await page(first.slug);

    expect(counter.consumed).toEqual([PAGE_KEY, slugKey(first.slug)]);
  });
});

describe('el log de las rutas públicas', () => {
  /** Líneas del log que mencionan ese slug. */
  function linesWith(slug: string): string[] {
    return logs.lines.filter((line) => line.includes(slug));
  }

  it('El log no dice quién pidió', async () => {
    await page(first.slug, {
      'user-agent': 'WhatsApp/2.23.20.0',
      referer: 'https://chat.example/una-conversacion',
      'x-forwarded-for': '203.0.113.7',
    });

    const lines = linesWith(first.slug);
    expect(lines.length).toBeGreaterThan(0);
    const logged = lines.join('\n');
    expect(logged).toContain('"status":200');
    expect(logged).not.toContain('WhatsApp');
    expect(logged).not.toContain('203.0.113.7');
    expect(logged).not.toContain('chat.example');
  });

  it('El endpoint público también se registra', async () => {
    await preview(second.slug);

    const logged = linesWith(second.slug).join('\n');
    expect(logged).toContain(second.slug);
    expect(logged).toContain('"status":200');
  });

  it('el 404 de un enlace quemado también deja su código', async () => {
    await page('zzzzzzzzzzzz');

    expect(linesWith('zzzzzzzzzzzz').join('\n')).toContain('"status":404');
  });
});
