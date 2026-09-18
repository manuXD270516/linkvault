import {
  LINK_ENRICHED_EVENT_NAME,
  linkEnrichedMessageSchema,
  type GroupDetail,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DeliverLinkEnriched } from '../../modules/links/application/deliver-link-enriched.usecase';
import {
  enrichedPreview,
  jobLinkDraft,
} from '../../modules/links/application/testing/link-fixtures';
import {
  GROUP_LINKS_COLLECTION,
  JOB_LINKS_COLLECTION,
} from '../../modules/links/infrastructure/link.schemas';
import { JoseAccessTokenSigner } from '../../modules/auth/infrastructure/jose-access-token-signer';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../test-support/links-test-app';

// `GET /api/events` (tareas 6.8 y 6.9) sobre la app completa y un servidor de verdad: `inject` no vale aquí, porque
// resuelve cuando la respuesta termina y este flujo no termina nunca.
//
// El latido por intervalo se prueba en `sse-stream.spec.ts` con un temporizador manual: aquí se comprueba el de
// apertura, que es el que le dice al cliente que ya está dentro, y que el flujo sigue vivo después.

const SECRET = 'test-only-jwt-secret-at-least-32-chars';
const READ_AT = new Date('2026-01-02T03:04:05.000Z');

/** Conexión abierta al canal, con lo necesario para leerla y para cortarla al terminar. */
interface Channel {
  readonly status: number;
  readonly contentType: string | null;
  /** Lee hasta que lo recibido cumple la condición; rechaza si no llega a cumplirse a tiempo. */
  readonly readUntil: (
    describe: string,
    test: (received: string) => boolean,
    timeoutMs?: number,
  ) => Promise<string>;
  readonly close: () => void;
}

/** Espera que se resuelve con `'timeout'`, sin retener el proceso si el test termina antes. */
function afterMs(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    setTimeout(() => resolve('timeout'), ms).unref?.();
  });
}

describe('the events channel', () => {
  let http: LinksTestApp;
  let baseUrl: string;
  let ana: TestMember;
  let beto: TestMember;
  let stranger: TestMember;
  let group: GroupDetail;
  const open: (() => void)[] = [];

  beforeAll(async () => {
    http = await createLinksTestApp('events-http', getMongoTestUri());
    await http.app.listen(0, '127.0.0.1');
    baseUrl = await http.app.getUrl();
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
    stranger = await http.authenticated('Extraño');
    group = await http.createGroup(ana, 'Backend Bolivia');
    await http.join(beto, group);
  });

  afterEach(() => {
    for (const close of open.splice(0)) {
      close();
    }
  });

  afterAll(async () => {
    await http.close();
  });

  /** Abre el canal con la cabecera de esa persona y devuelve cómo leerlo. */
  async function channelOf(
    authorization: string | undefined,
    query = '',
  ): Promise<Channel> {
    const controller = new AbortController();
    open.push(() => controller.abort());
    const response = await fetch(`${baseUrl}/api/events${query}`, {
      headers: authorization === undefined ? {} : { authorization },
      signal: controller.signal,
    });
    const decoder = new TextDecoder();
    const reader = response.body?.getReader();
    let received = '';
    // La lectura pendiente se guarda: pedir otra mientras una sigue viva perdería el trozo que llegue a la primera.
    let pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      close: () => controller.abort(),
      async readUntil(describeIt, test, timeoutMs = 5000): Promise<string> {
        if (reader === undefined) {
          throw new Error('The channel answered without a body');
        }
        const deadline = Date.now() + timeoutMs;
        while (!test(received)) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            throw new Error(
              `The channel never sent ${describeIt}: ${JSON.stringify(received)}`,
            );
          }
          pending ??= reader.read();
          const outcome = await Promise.race([pending, afterMs(remaining)]);
          if (outcome === 'timeout') {
            continue;
          }
          pending = undefined;
          if (outcome.done) {
            throw new Error(`The channel closed before sending ${describeIt}`);
          }
          received += decoder.decode(outcome.value, { stream: true });
        }
        return received;
      },
    };
  }

  /** Oferta ya leída y compartida por Ana en el grupo. */
  async function enrichedOffer(slug: string): Promise<string> {
    const draft = jobLinkDraft(`https://empresa.example/careers/${slug}`, {
      createdBy: ana.userId,
      now: READ_AT,
    });
    const linkId = new mongoose.Types.ObjectId();
    await http.connection.collection(JOB_LINKS_COLLECTION).insertOne({
      _id: linkId,
      normalizedUrl: draft.normalizedUrl,
      urlHash: draft.urlHash,
      dedupeKey: draft.dedupeKey,
      platform: draft.platform,
      displayUrl: draft.displayUrl,
      originalUrls: [...draft.originalUrls],
      previewStatus: 'enriched',
      previewVersion: 2,
      ...enrichedPreview(ana.userId),
      previewRequestedAt: READ_AT,
      createdBy: new mongoose.Types.ObjectId(ana.userId),
      createdAt: READ_AT,
      updatedAt: READ_AT,
    });
    await http.connection.collection(GROUP_LINKS_COLLECTION).insertOne({
      groupId: new mongoose.Types.ObjectId(group.id),
      linkId,
      sharedBy: new mongoose.Types.ObjectId(ana.userId),
      sharedAt: READ_AT,
    });
    return linkId.toHexString();
  }

  it('Suscripción con sesión', async () => {
    const channel = await channelOf(ana.authorization);

    expect(channel.status).toBe(200);
    expect(channel.contentType).toBe('text/event-stream; charset=utf-8');
  });

  it('Sin sesión', async () => {
    const channel = await channelOf(undefined);

    expect(channel.status).toBe(401);
  });

  it('Credenciales fuera de la URL', async () => {
    const token = ana.authorization.replace('Bearer ', '');

    const channel = await channelOf(
      undefined,
      `?access_token=${encodeURIComponent(token)}`,
    );

    // Un token en la URL no abre nada: el guard solo lee la cabecera, así que no acaba en ningún log de acceso.
    expect(channel.status).toBe(401);
  });

  it('Sesión caducada al reconectar', async () => {
    const past = new Date(Date.now() - 3_600_000);
    const expiredSigner = new JoseAccessTokenSigner(
      { secret: SECRET, ttlSeconds: 900 },
      { now: () => past },
    );
    const { accessToken } = await expiredSigner.sign({
      userId: ana.userId,
      sessionId: '00000000-0000-4000-8000-000000000000',
    });

    const channel = await channelOf(`Bearer ${accessToken}`);

    expect(channel.status).toBe(401);
  });

  it('Latido', async () => {
    const channel = await channelOf(ana.authorization);

    const received = await channel.readUntil(': keep-alive', (text) =>
      text.includes(': keep-alive'),
    );

    // Un comentario, no un mensaje: ningún parser lo confunde con un evento.
    expect(received.startsWith(': keep-alive')).toBe(true);
    expect(received).not.toContain('event:');
  });

  it('La tarjeta se entera', async () => {
    const channel = await channelOf(beto.authorization);
    await channel.readUntil(': keep-alive', (text) =>
      text.includes(': keep-alive'),
    );
    const linkId = await enrichedOffer('la-tarjeta-se-entera');

    // El aviso entra por donde entraría el del worker: la suscripción de Redis solo llama a este caso de uso.
    await http.app
      .get(DeliverLinkEnriched, { strict: false })
      .execute({ linkId, previewStatus: 'enriched', previewVersion: 2 });
    const received = await channel.readUntil(
      'a complete message',
      (text) => text.includes('event:') && text.trimEnd().endsWith('}'),
    );
    const data = received
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice('data: '.length))
      .join('\n');

    expect(received).toContain(`event: ${LINK_ENRICHED_EVENT_NAME}`);
    const message = linkEnrichedMessageSchema.parse(JSON.parse(data));
    expect(message.link.id).toBe(linkId);
    expect(message.link.preview?.title).toBe('Backend Engineer');
    expect(message.link.previewVersion).toBe(2);
    expect(message.link.sharedBy).toEqual({
      userId: ana.userId,
      displayName: 'Ana',
    });
  });

  it('Extraño no avisado', async () => {
    const theirs = await channelOf(stranger.authorization);
    const mine = await channelOf(beto.authorization);
    await theirs.readUntil(': keep-alive', (text) =>
      text.includes(': keep-alive'),
    );
    await mine.readUntil(': keep-alive', (text) =>
      text.includes(': keep-alive'),
    );
    const linkId = await enrichedOffer('extranio-no-avisado');

    await http.app
      .get(DeliverLinkEnriched, { strict: false })
      .execute({ linkId, previewStatus: 'enriched', previewVersion: 2 });
    // El miembro del grupo sí lo recibe: es lo que hace significativo que el extraño no.
    await mine.readUntil('the notice', (text) => text.includes('event:'));

    await expect(
      theirs.readUntil('any event', (text) => text.includes('event:'), 500),
    ).rejects.toThrow(/never sent/);
  });

  it('Nadie escuchando', async () => {
    const linkId = await enrichedOffer('nadie-escuchando');

    await expect(
      http.app
        .get(DeliverLinkEnriched, { strict: false })
        .execute({ linkId, previewStatus: 'enriched', previewVersion: 2 }),
    ).resolves.toBe(0);
  });
});
